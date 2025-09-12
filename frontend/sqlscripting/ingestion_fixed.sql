-- =====================================================================================
-- FIXED BULK INGESTION PROCESSING PROCEDURE
-- =====================================================================================
-- This version fixes critical data loss issues in the original procedure:
-- 1. Removes overly restrictive validation that rejected valid rows
-- 2. Simplifies stem categorization to be more inclusive
-- 3. Ensures all valid measurement data is processed
-- =====================================================================================

DROP PROCEDURE IF EXISTS bulkingestionprocess_fixed;

CREATE
    DEFINER = azureroot@`%` PROCEDURE bulkingestionprocess_fixed(IN vFileID varchar(36), IN vBatchID varchar(36))
main_proc:
BEGIN
    DECLARE vCurrentCensusID int;
    DECLARE vBatchFailed BOOLEAN DEFAULT FALSE;
    DECLARE vErrorMessage TEXT DEFAULT '';
    DECLARE vErrorCode VARCHAR(10) DEFAULT '';
    
    -- Enhanced error handler that moves failed batches to failedmeasurements
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
        BEGIN
            GET DIAGNOSTICS CONDITION 1
                vErrorMessage = MESSAGE_TEXT,
                vErrorCode = MYSQL_ERRNO;
                
            SET vBatchFailed = TRUE;
            
            -- Log the error for debugging
            INSERT IGNORE INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes, Comments)
            SELECT DISTINCT PlotID,
                            CensusID,
                            CONCAT('BATCH_FAILED_', vFileID) as Tag,
                            vBatchID as StemTag,
                            CONCAT('ERROR_', vErrorCode) as SpCode,
                            'SYSTEM_ERROR' as Quadrat,
                            -1 as X,
                            -1 as Y,
                            -1 as DBH,
                            -1 as HOM,
                            NOW() as Date,
                            CONCAT('SQL_ERROR:', vErrorCode) as Codes,
                            CONCAT('Batch processing failed: ', LEFT(vErrorMessage, 200)) as Comments
            FROM temporarymeasurements
            WHERE FileID = vFileID AND BatchID = vBatchID
            LIMIT 1;
            
            -- Move all remaining temporarymeasurements for this batch to failedmeasurements
            -- This ensures no data is lost when the procedure fails
            INSERT IGNORE INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes, Comments)
            SELECT DISTINCT PlotID,
                            CensusID,
                            NULLIF(TreeTag, '') as Tag,
                            NULLIF(StemTag, '') as StemTag,
                            NULLIF(SpeciesCode, '') as SpCode,
                            NULLIF(QuadratName, '') as Quadrat,
                            NULLIF(LocalX, 0) as X,
                            NULLIF(LocalY, 0) as Y,
                            NULLIF(DBH, 0) as DBH,
                            NULLIF(HOM, 0) as HOM,
                            NULLIF(MeasurementDate, '1900-01-01') as MeasurementDate,
                            NULLIF(CONCAT(IFNULL(Codes, ''), ';PROC_FAILED:', vErrorCode), ';PROC_FAILED:') as Codes,
                            NULLIF(CONCAT(IFNULL(Comments, ''), ' [PROC_ERROR: ', LEFT(vErrorMessage, 100), ']'), ' [PROC_ERROR: ]') as Comments
            FROM temporarymeasurements
            WHERE FileID = vFileID AND BatchID = vBatchID;
            
            -- Clean up the temporary measurements after moving to failed
            DELETE FROM temporarymeasurements WHERE FileID = vFileID AND BatchID = vBatchID;
            
            -- Clean up temporary tables on error
            DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, filter_validity, filtered,
                old_trees, multi_stems, new_recruits, unique_trees_to_insert, unique_stems_to_insert, tempcodes;
            -- Table locks are automatically released on procedure exit
            SET @disable_triggers = 0;
            
            -- Return success instead of resignaling, since we handled the error by moving to failedmeasurements
            SELECT CONCAT('Batch ', vBatchID, ' moved to failedmeasurements due to error: ', vErrorCode) as message;
        END;

    SET @disable_triggers = 0;

    -- Note: Explicit table locking is not allowed in stored procedures
    -- MySQL handles locking automatically for transactional operations

    SELECT CensusID
    INTO vCurrentCensusID
    FROM temporarymeasurements
    WHERE FileID = vFileID
      AND BatchID = vBatchID
    LIMIT 1;

    IF (SELECT COUNT(*) FROM temporarymeasurements WHERE FileID = vFileID AND BatchID = vBatchID) = 0 THEN
        SET @disable_triggers = 0;
        -- Table locks are automatically released on procedure exit
        SELECT 'No data found for specified FileID/BatchID' as message;
        LEAVE main_proc;
    END IF;

    -- Clean up temporary tables
    DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, filter_validity, filtered,
        old_trees, multi_stems, new_recruits, unique_trees_to_insert, unique_stems_to_insert, tempcodes;

    -- Step 1: Deduplicate input data (MEMORY - small, fast lookups)
    CREATE TEMPORARY TABLE initial_dup_filter ENGINE = MEMORY AS
    SELECT min(id)                                                                        as id,
           FileID,
           BatchID,
           PlotID,
           CensusID,
           TreeTag,
           StemTag,
           SpeciesCode,
           QuadratName,
           LocalX,
           LocalY,
           DBH,
           HOM,
           MeasurementDate,
           max(case when Codes is not null and trim(Codes) != '' then Codes end)          as Codes,
           max(case when Comments is not null and trim(Comments) != '' then Comments end) as Comments
    FROM temporarymeasurements
    WHERE FileID = vFileID
      AND BatchID = vBatchID
      AND CensusID = vCurrentCensusID
    GROUP BY FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode,
             QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate;

    -- Step 2: Basic validation with memory optimization
    CREATE TEMPORARY TABLE filter_validity ENGINE = MEMORY AS
    SELECT DISTINCT i.id,
                    i.FileID,
                    i.BatchID,
                    i.PlotID,
                    i.CensusID,
                    i.TreeTag,
                    IFNULL(i.StemTag, '') as StemTag,
                    i.SpeciesCode,
                    i.QuadratName,
                    IFNULL(i.LocalX, 0)   as LocalX,
                    IFNULL(i.LocalY, 0)   as LocalY,
                    IFNULL(i.DBH, 0)      as DBH,
                    IFNULL(i.HOM, 0)      as HOM,
                    i.MeasurementDate,
                    i.Codes,
                    i.Comments,
                    -- Enhanced validation to filter early and reduce dataset size
                    CASE
                        WHEN i.TreeTag IS NULL OR i.MeasurementDate IS NULL OR
                             tq.QuadratID IS NULL OR ts.SpeciesID IS NULL OR
                             (i.DBH = 0 AND i.HOM = 0 AND (i.Codes IS NULL OR TRIM(i.Codes) = ''))
                            THEN false
                        ELSE true
                        END               as Valid,
                    -- Count invalid attribute codes
                    IFNULL(
                            (SELECT sum(if(a.Code is null, 1, 0))
                             FROM json_table(
                                          if(i.Codes is null or trim(i.Codes) = '', '[]',
                                             concat('["', replace(trim(i.Codes), ';', '","'), '"]')
                                          ),
                                          '$[*]' columns ( code varchar(10) path '$')
                                  ) jt
                                      LEFT JOIN attributes a ON a.Code = jt.code),
                            0
                    )                     as invalid_count
    FROM initial_dup_filter i
             LEFT JOIN quadrats tq ON tq.QuadratName = i.QuadratName AND tq.IsActive = 1
             LEFT JOIN species ts ON ts.SpeciesCode = i.SpeciesCode AND ts.IsActive = 1;

    -- Step 3: Filter out only truly invalid rows (MEMORY - result set should be small)
    CREATE TEMPORARY TABLE filtered ENGINE = MEMORY AS
    SELECT DISTINCT fv.*
    FROM filter_validity fv
    WHERE fv.Valid = true
      AND fv.invalid_count = 0;

    -- Add indexes for performance
    CREATE INDEX idx_filtered_treetag ON filtered (TreeTag);
    CREATE INDEX idx_filtered_stemtag ON filtered (StemTag);
    CREATE INDEX idx_filtered_id ON filtered (id);

    -- Step 4: Insert failed measurements (only truly failed ones)
    INSERT IGNORE INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes,
                                           Comments)
    SELECT DISTINCT PlotID,
                    CensusID,
                    NULLIF(TreeTag, '')                   as Tag,
                    NULLIF(StemTag, '')                   as StemTag,
                    NULLIF(SpeciesCode, '')               as SpCode,
                    NULLIF(QuadratName, '')               as Quadrat,
                    NULLIF(LocalX, 0)                     as X,
                    NULLIF(LocalY, 0)                     as Y,
                    NULLIF(DBH, 0)                        as DBH,
                    NULLIF(HOM, 0)                        as HOM,
                    NULLIF(MeasurementDate, '1900-01-01') as MeasurementDate,
                    NULLIF(Codes, '')                     as Codes,
                    NULLIF(Comments, '')                  as Comments
    FROM filter_validity fv
    WHERE fv.Valid = false
       OR fv.invalid_count > 0;

    -- Step 5: Optimized stem categorization with efficient JOINs
    -- Old trees: stems that existed in previous census (MEMORY - typically small result set)
    CREATE TEMPORARY TABLE old_trees ENGINE = MEMORY AS
    SELECT DISTINCT f.*
    FROM filtered f
             INNER JOIN trees t ON t.TreeTag = f.TreeTag AND t.CensusID < f.CensusID AND t.IsActive = 1
             INNER JOIN stems s ON s.TreeID = t.TreeID AND s.StemTag = f.StemTag AND s.IsActive = 1;

    -- Multi stems: trees that exist but this is a new stem (MEMORY - small result set)
    CREATE TEMPORARY TABLE multi_stems ENGINE = MEMORY AS
    SELECT DISTINCT f.*
    FROM filtered f
             INNER JOIN trees t ON t.TreeTag = f.TreeTag AND t.CensusID < f.CensusID AND t.IsActive = 1
             LEFT JOIN old_trees ot ON ot.id = f.id
    WHERE ot.id IS NULL;

    -- New recruits: everything else (completely new trees) (MEMORY - typically small result set)
    CREATE TEMPORARY TABLE new_recruits ENGINE = MEMORY AS
    SELECT DISTINCT f.*
    FROM filtered f
             LEFT JOIN old_trees ot ON ot.id = f.id
             LEFT JOIN multi_stems ms ON ms.id = f.id
    WHERE ot.id IS NULL
      AND ms.id IS NULL;

    -- Step 6: Create unified tree insertion list (MEMORY - small unique list)
    CREATE TEMPORARY TABLE unique_trees_to_insert ENGINE = MEMORY AS
    SELECT DISTINCT TreeTag, SpeciesCode, CensusID
    FROM (SELECT TreeTag, SpeciesCode, CensusID
          FROM old_trees
          UNION
          SELECT TreeTag, SpeciesCode, CensusID
          FROM multi_stems
          UNION
          SELECT TreeTag, SpeciesCode, CensusID
          FROM new_recruits) combined
    WHERE CensusID = vCurrentCensusID;

    -- Step 7: Insert trees
    INSERT IGNORE INTO trees (TreeTag, SpeciesID, CensusID)
    SELECT BINARY uti.TreeTag, ts.SpeciesID, uti.CensusID
    FROM unique_trees_to_insert uti
             JOIN species ts ON ts.SpeciesCode = uti.SpeciesCode AND ts.IsActive = 1
    WHERE NOT EXISTS (SELECT 1
                      FROM trees t
                      WHERE t.TreeTag = uti.TreeTag
                        AND t.CensusID = uti.CensusID
                        AND t.SpeciesID = ts.SpeciesID);

    -- Step 8: Create unified stem insertion list (MEMORY - unique stems only)
    CREATE TEMPORARY TABLE unique_stems_to_insert ENGINE = MEMORY AS
    SELECT DISTINCT TreeTag, QuadratName, StemTag, LocalX, LocalY, CensusID, SpeciesCode
    FROM (SELECT TreeTag, QuadratName, StemTag, LocalX, LocalY, CensusID, SpeciesCode
          FROM old_trees
          UNION
          SELECT TreeTag, QuadratName, StemTag, LocalX, LocalY, CensusID, SpeciesCode
          FROM multi_stems
          UNION
          SELECT TreeTag, QuadratName, StemTag, LocalX, LocalY, CensusID, SpeciesCode
          FROM new_recruits) combined
    WHERE CensusID = vCurrentCensusID;

    -- Step 9: Insert stems with enhanced validation
    INSERT IGNORE INTO stems (TreeID, QuadratID, CensusID, StemCrossID, StemTag, LocalX, LocalY, Moved, StemDescription,
                              IsActive)
    SELECT DISTINCT t.TreeID,
                    tq.QuadratID,
                    vCurrentCensusID                                                                    as CensusID,
                    NULL                                                                                as StemCrossID,
                    CASE WHEN TRIM(COALESCE(usi.StemTag, '')) = '' THEN NULL ELSE TRIM(usi.StemTag) END as StemTag,
                    CASE WHEN usi.LocalX = 0 THEN NULL ELSE usi.LocalX END                              as LocalX,
                    CASE WHEN usi.LocalY = 0 THEN NULL ELSE usi.LocalY END                              as LocalY,
                    0                                                                                   as Moved,
                    NULL                                                                                as StemDescription,
                    1                                                                                   as IsActive
    FROM unique_stems_to_insert usi
             JOIN quadrats tq ON tq.QuadratName = usi.QuadratName AND tq.IsActive = 1
             JOIN species ts ON ts.SpeciesCode = usi.SpeciesCode AND ts.IsActive = 1
             JOIN trees t
                  ON t.TreeTag = usi.TreeTag AND t.SpeciesID = ts.SpeciesID AND t.CensusID = vCurrentCensusID AND
                     t.IsActive = 1;

    -- Step 10: Set StemCrossID with proper cross-census tracking
    -- This ensures stems are tracked across censuses while maintaining unique StemGUID per census
    
    -- First, handle stems that exist in previous censuses (reuse existing StemCrossID)
    UPDATE stems s_current
    INNER JOIN stems s_previous ON (
        s_current.TreeID = s_previous.TreeID AND
        s_current.StemTag = s_previous.StemTag AND
        s_current.QuadratID = s_previous.QuadratID AND
        s_current.LocalX = s_previous.LocalX AND
        s_current.LocalY = s_previous.LocalY AND
        s_previous.CensusID < s_current.CensusID AND
        s_previous.StemCrossID IS NOT NULL AND
        s_previous.IsActive = 1
    )
    SET s_current.StemCrossID = s_previous.StemCrossID
    WHERE s_current.CensusID = vCurrentCensusID 
      AND s_current.StemCrossID IS NULL
      AND s_current.IsActive = 1;
    
    -- Then, assign new StemCrossID to truly new stems (those not found in previous censuses)
    -- Get the next available StemCrossID base
    SET @next_stem_cross_id = (SELECT COALESCE(MAX(StemCrossID), 0) + 1 FROM stems WHERE StemCrossID IS NOT NULL);
    
    -- Assign incremental StemCrossID values to new stems
    UPDATE stems s1
    JOIN (
        SELECT StemGUID, (@next_stem_cross_id + ROW_NUMBER() OVER (ORDER BY StemGUID) - 1) as new_cross_id
        FROM stems 
        WHERE CensusID = vCurrentCensusID 
          AND StemCrossID IS NULL 
          AND IsActive = 1
    ) s2 ON s1.StemGUID = s2.StemGUID
    SET s1.StemCrossID = s2.new_cross_id
    WHERE s1.CensusID = vCurrentCensusID 
      AND s1.StemCrossID IS NULL
      AND s1.IsActive = 1;

    -- Step 11: Insert core measurements with proper state classification
    INSERT IGNORE INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
                                         Description, UserDefinedFields, IsActive)
    SELECT DISTINCT f.CensusID,
                    s.StemGUID,
                    null                                         as IsValidated,
                    COALESCE(f.MeasurementDate, '1900-01-01')    as MeasurementDate,
                    CASE WHEN f.DBH = 0 THEN NULL ELSE f.DBH END as MeasuredDBH,
                    CASE WHEN f.HOM = 0 THEN NULL ELSE f.HOM END as MeasuredHOM,
                    COALESCE(f.Comments, '')                     as Description,
                    JSON_OBJECT('treestemstate', f.state)        as UserDefinedFields,
                    1                                            as IsActive
    FROM (SELECT ot.id              as id,
                 ot.CensusID        as CensusID,
                 ot.TreeTag         as TreeTag,
                 ot.StemTag         as StemTag,
                 ot.QuadratName     as QuadratName,
                 ot.MeasurementDate as MeasurementDate,
                 ot.DBH             as DBH,
                 ot.HOM             as HOM,
                 ot.Comments        as Comments,
                 'old tree'         as state,
                 ot.SpeciesCode     as SpeciesCode
          FROM old_trees ot
          UNION
          SELECT ms.id              as id,
                 ms.CensusID        as CensusID,
                 ms.TreeTag         as TreeTag,
                 ms.StemTag         as StemTag,
                 ms.QuadratName     as QuadratName,
                 ms.MeasurementDate as MeasurementDate,
                 ms.DBH             as DBH,
                 ms.HOM             as HOM,
                 ms.Comments        as Comments,
                 'multi stem'       as state,
                 ms.SpeciesCode     as SpeciesCode
          FROM multi_stems ms
          UNION
          SELECT nr.id              as id,
                 nr.CensusID        as CensusID,
                 nr.TreeTag         as TreeTag,
                 nr.StemTag         as StemTag,
                 nr.QuadratName     as QuadratName,
                 nr.MeasurementDate as MeasurementDate,
                 nr.DBH             as DBH,
                 nr.HOM             as HOM,
                 nr.Comments        as Comments,
                 'new recruit'      as state,
                 nr.SpeciesCode     as SpeciesCode
          FROM new_recruits nr) as f
             JOIN quadrats tq ON tq.QuadratName = f.QuadratName AND tq.IsActive = 1
             JOIN species ts ON ts.SpeciesCode = f.SpeciesCode AND ts.IsActive = 1
             JOIN trees t
                  ON t.TreeTag = f.TreeTag AND t.SpeciesID = ts.SpeciesID AND t.CensusID = f.CensusID AND t.IsActive = 1
             JOIN stems s ON s.StemTag = f.StemTag AND s.QuadratID = tq.QuadratID AND s.TreeID = t.TreeID AND
                             s.CensusID = f.CensusID AND s.IsActive = 1;

    -- Step 12: Clean up measurement nulls
    UPDATE coremeasurements
    SET MeasurementDate = NULLIF(MeasurementDate, '1900-01-01'),
        MeasuredDBH     = NULLIF(MeasuredDBH, 0),
        MeasuredHOM     = NULLIF(MeasuredHOM, 0),
        Description     = NULLIF(Description, '')
    WHERE CensusID = vCurrentCensusID;

    -- Step 13: Handle attribute codes (MEMORY - codes are typically small)
    CREATE TEMPORARY TABLE tempcodes ENGINE = MEMORY AS
    SELECT cm.CoreMeasurementID,
           trim(jt.code) as Code
    FROM filtered f
             JOIN quadrats tq ON tq.QuadratName = f.QuadratName AND tq.IsActive = 1
             JOIN species ts ON ts.SpeciesCode = f.SpeciesCode AND ts.IsActive = 1
             JOIN trees t
                  ON t.TreeTag = f.TreeTag AND t.SpeciesID = ts.SpeciesID AND t.CensusID = f.CensusID AND t.IsActive = 1
             JOIN stems s ON s.StemTag = f.StemTag AND s.TreeID = t.TreeID AND s.QuadratID = tq.QuadratID AND
                             s.CensusID = f.CensusID AND s.IsActive = 1
             JOIN coremeasurements cm ON cm.StemGUID = s.StemGUID AND cm.CensusID = f.CensusID AND cm.IsActive = 1,
         json_table(
                 if(f.Codes = '' or trim(f.Codes) = '', '[]',
                    concat('["', replace(trim(f.Codes), ';', '","'), '"]')),
                 '$[*]' columns ( code varchar(10) path '$')
         ) jt
    WHERE f.Codes is not null
      AND trim(f.Codes) != '';

    INSERT IGNORE INTO cmattributes (CoreMeasurementID, Code)
    SELECT tc.CoreMeasurementID, tc.Code
    FROM tempcodes tc
             JOIN attributes a ON a.Code = tc.Code AND a.IsActive = 1;

    -- Clean up temporary tables
    DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, filter_validity, filtered,
        old_trees, multi_stems, new_recruits, unique_trees_to_insert, unique_stems_to_insert, tempcodes;

    -- Clean up temporarymeasurements for this successful batch
    DELETE FROM temporarymeasurements WHERE FileID = vFileID AND BatchID = vBatchID;
    
    -- Table locks are automatically released on procedure exit
    
    SET @disable_triggers = 0;
    
    -- Return success message
    SELECT CONCAT('Batch ', vBatchID, ' processed successfully') as message, FALSE as batch_failed;
END;