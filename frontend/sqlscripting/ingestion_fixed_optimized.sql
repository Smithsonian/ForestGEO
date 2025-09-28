-- =====================================================================================
-- OPTIMIZED BULK INGESTION PROCESSING PROCEDURE
-- =====================================================================================
-- This version includes efficiency optimizations:
-- 1. Reduced redundant index usage patterns
-- 2. Optimized JOIN order and conditions
-- 3. Better temporary table indexing strategy
-- 4. Reduced SELECT operations and improved query patterns
-- 5. Enhanced error handling with minimal performance impact
-- =====================================================================================

DROP PROCEDURE IF EXISTS bulkingestionprocess;

CREATE
    DEFINER = azureroot@`%` PROCEDURE bulkingestionprocess(IN vFileID varchar(36), IN vBatchID varchar(36))
main_proc:
BEGIN
    DECLARE vCurrentCensusID int;
    DECLARE vBatchFailed BOOLEAN DEFAULT FALSE;
    DECLARE vErrorMessage TEXT DEFAULT '';
    DECLARE vErrorCode VARCHAR(10) DEFAULT '';
    DECLARE vBatchRowCount INT DEFAULT 0;
    
    -- Enhanced error handler that moves failed batches to failedmeasurements
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
        BEGIN
            GET DIAGNOSTICS CONDITION 1
                vErrorMessage = MESSAGE_TEXT,
                vErrorCode = MYSQL_ERRNO;
                
            SET vBatchFailed = TRUE;
            
            -- Log the error for debugging (single INSERT with LIMIT 1 for efficiency)
            INSERT IGNORE INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes, Comments)
            SELECT PlotID,
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
            INSERT IGNORE INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes, Comments)
            SELECT PlotID,
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
                old_trees, multi_stems, new_recruits, unique_trees_to_insert, unique_stems_to_insert, tempcodes, stem_crossid_mapping;
            -- Table locks are automatically released on procedure exit
            SET @disable_triggers = 0;
            
            -- Return success instead of resignaling, since we handled the error by moving to failedmeasurements
            SELECT CONCAT('Batch ', vBatchID, ' moved to failedmeasurements due to error: ', vErrorCode) as message;
        END;

    SET @disable_triggers = 0;

    -- Note: Explicit table locking is not allowed in stored procedures
    -- MySQL handles locking automatically for transactional operations

    -- Optimized: Single query to get both CensusID and row count
    SELECT CensusID, COUNT(*)
    INTO vCurrentCensusID, vBatchRowCount
    FROM temporarymeasurements
    WHERE FileID = vFileID AND BatchID = vBatchID
    GROUP BY CensusID
    LIMIT 1;

    -- Early exit if no data found
    IF vBatchRowCount = 0 THEN
        SET @disable_triggers = 0;
        -- Table locks are automatically released on procedure exit
        SELECT 'No data found for specified FileID/BatchID' as message;
        LEAVE main_proc;
    END IF;

    -- Clean up any existing temporary tables
    DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, filter_validity, filtered,
        old_trees, multi_stems, new_recruits, unique_trees_to_insert, unique_stems_to_insert, tempcodes;

    -- Step 1: Optimized deduplication with strategic indexing
    CREATE TEMPORARY TABLE initial_dup_filter ENGINE = MEMORY AS
    SELECT min(id) as id,
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
           max(case when Codes is not null and trim(Codes) != '' then Codes end) as Codes,
           max(case when Comments is not null and trim(Comments) != '' then Comments end) as Comments
    FROM temporarymeasurements
    WHERE FileID = vFileID
      AND BatchID = vBatchID
      AND CensusID = vCurrentCensusID
    GROUP BY FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode,
             QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate;

    -- Add strategic indexes for better JOIN performance
    CREATE INDEX idx_dup_tree_species ON initial_dup_filter (TreeTag, SpeciesCode);
    CREATE INDEX idx_dup_quadrat ON initial_dup_filter (QuadratName);

    -- Step 2: Optimized validation with reduced subqueries
    CREATE TEMPORARY TABLE filter_validity ENGINE = MEMORY AS
    SELECT i.id,
           i.FileID,
           i.BatchID,
           i.PlotID,
           i.CensusID,
           i.TreeTag,
           IFNULL(i.StemTag, '') as StemTag,
           i.SpeciesCode,
           i.QuadratName,
           IFNULL(i.LocalX, 0) as LocalX,
           IFNULL(i.LocalY, 0) as LocalY,
           IFNULL(i.DBH, 0) as DBH,
           IFNULL(i.HOM, 0) as HOM,
           i.MeasurementDate,
           i.Codes,
           i.Comments,
           -- Simplified validation logic - defer complex attribute validation to later step
           CASE
               WHEN i.TreeTag IS NULL OR i.MeasurementDate IS NULL OR
                    tq.QuadratID IS NULL OR ts.SpeciesID IS NULL OR
                    (i.DBH = 0 AND i.HOM = 0 AND (i.Codes IS NULL OR TRIM(i.Codes) = ''))
                   THEN false
               ELSE true
           END as Valid,
           tq.QuadratID,
           ts.SpeciesID
    FROM initial_dup_filter i
    LEFT JOIN quadrats tq ON tq.QuadratName = i.QuadratName AND tq.IsActive = 1
    LEFT JOIN species ts ON ts.SpeciesCode = i.SpeciesCode AND ts.IsActive = 1;

    -- Add indexes for subsequent operations
    CREATE INDEX idx_validity_valid ON filter_validity (Valid);
    CREATE INDEX idx_validity_tree ON filter_validity (TreeTag, SpeciesID, CensusID);

    -- Step 3: Create filtered dataset (only valid rows)
    CREATE TEMPORARY TABLE filtered ENGINE = MEMORY AS
    SELECT *
    FROM filter_validity
    WHERE Valid = true;

    -- Strategic indexing for performance-critical JOINs
    CREATE INDEX idx_filtered_tree_census ON filtered (TreeTag, CensusID);
    CREATE INDEX idx_filtered_stem_tree ON filtered (StemTag, TreeTag);
    CREATE INDEX idx_filtered_species ON filtered (SpeciesID);

    -- Step 4: Handle validation failures efficiently
    INSERT IGNORE INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes, Comments)
    SELECT PlotID,
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
           NULLIF(Codes, '') as Codes,
           NULLIF(Comments, '') as Comments
    FROM filter_validity
    WHERE Valid = false;

    -- Step 5: Optimized stem categorization with better index usage
    -- Use EXISTS instead of JOINs where possible for better performance
    CREATE TEMPORARY TABLE old_trees ENGINE = MEMORY AS
    SELECT DISTINCT f.*
    FROM filtered f
    WHERE EXISTS (SELECT 1 FROM trees t WHERE t.TreeTag = f.TreeTag AND t.CensusID < f.CensusID AND t.IsActive = 1)
      AND EXISTS (SELECT 1 FROM trees t 
                  JOIN stems s ON s.TreeID = t.TreeID 
                  WHERE t.TreeTag = f.TreeTag AND s.StemTag = f.StemTag AND t.CensusID < f.CensusID AND t.IsActive = 1 AND s.IsActive = 1);

    CREATE TEMPORARY TABLE multi_stems ENGINE = MEMORY AS
    SELECT DISTINCT f.*
    FROM filtered f
    WHERE EXISTS (SELECT 1 FROM trees t WHERE t.TreeTag = f.TreeTag AND t.CensusID < f.CensusID AND t.IsActive = 1)
      AND NOT EXISTS (SELECT 1 FROM old_trees ot WHERE ot.id = f.id);

    CREATE TEMPORARY TABLE new_recruits ENGINE = MEMORY AS
    SELECT DISTINCT f.*
    FROM filtered f
    WHERE NOT EXISTS (SELECT 1 FROM old_trees ot WHERE ot.id = f.id)
      AND NOT EXISTS (SELECT 1 FROM multi_stems ms WHERE ms.id = f.id);

    -- Step 6: Optimized tree insertion with batch processing
    CREATE TEMPORARY TABLE unique_trees_to_insert ENGINE = MEMORY AS
    SELECT DISTINCT TreeTag, SpeciesID, CensusID
    FROM filtered
    WHERE CensusID = vCurrentCensusID;

    -- Add index for the INSERT operation
    CREATE INDEX idx_trees_insert ON unique_trees_to_insert (TreeTag, SpeciesID, CensusID);

    -- Optimized tree insertion using LEFT JOIN for better performance
    INSERT IGNORE INTO trees (TreeTag, SpeciesID, CensusID)
    SELECT uti.TreeTag, uti.SpeciesID, uti.CensusID
    FROM unique_trees_to_insert uti
    LEFT JOIN trees existing ON existing.TreeTag = uti.TreeTag 
                            AND existing.CensusID = uti.CensusID 
                            AND existing.SpeciesID = uti.SpeciesID
    WHERE existing.TreeID IS NULL;

    -- Step 7: Optimized stem insertion
    CREATE TEMPORARY TABLE unique_stems_to_insert ENGINE = MEMORY AS
    SELECT DISTINCT TreeTag, QuadratID, StemTag, LocalX, LocalY, CensusID, SpeciesID
    FROM filtered
    WHERE CensusID = vCurrentCensusID;

    -- Add composite index for optimal JOIN performance
    CREATE INDEX idx_stems_insert ON unique_stems_to_insert (TreeTag, SpeciesID, CensusID);

    INSERT IGNORE INTO stems (TreeID, QuadratID, CensusID, StemCrossID, StemTag, LocalX, LocalY, Moved, StemDescription, IsActive)
    SELECT t.TreeID,
           usi.QuadratID,
           vCurrentCensusID as CensusID,
           NULL as StemCrossID,
           CASE WHEN TRIM(COALESCE(usi.StemTag, '')) = '' THEN NULL ELSE TRIM(usi.StemTag) END as StemTag,
           CASE WHEN usi.LocalX = 0 THEN NULL ELSE usi.LocalX END as LocalX,
           CASE WHEN usi.LocalY = 0 THEN NULL ELSE usi.LocalY END as LocalY,
           0 as Moved,
           NULL as StemDescription,
           1 as IsActive
    FROM unique_stems_to_insert usi
    INNER JOIN trees t ON t.TreeTag = usi.TreeTag 
                      AND t.SpeciesID = usi.SpeciesID 
                      AND t.CensusID = vCurrentCensusID 
                      AND t.IsActive = 1;

    -- Step 8: Fixed StemCrossID update using temporary table to avoid MySQL error 1093
    -- Create temporary table with stem cross reference mapping
    CREATE TEMPORARY TABLE stem_crossid_mapping ENGINE = MEMORY AS
    SELECT s_curr.StemGUID as CurrentStemID,
           COALESCE(
               (SELECT s_prev.StemCrossID
                FROM stems s_prev
                INNER JOIN trees t_prev ON s_prev.TreeID = t_prev.TreeID
                INNER JOIN trees t_curr ON t_curr.TreeID = s_curr.TreeID
                WHERE t_prev.TreeTag = t_curr.TreeTag
                  AND s_prev.StemTag = s_curr.StemTag
                  AND t_prev.CensusID < vCurrentCensusID
                  AND t_prev.IsActive = 1
                  AND s_prev.IsActive = 1
                  AND s_prev.StemCrossID IS NOT NULL
                ORDER BY t_prev.CensusID DESC
                LIMIT 1),
               s_curr.StemGUID
           ) as NewStemCrossID
    FROM stems s_curr
    WHERE s_curr.CensusID = vCurrentCensusID
      AND s_curr.StemCrossID IS NULL;

    -- Add index for efficient update
    CREATE INDEX idx_mapping_stemid ON stem_crossid_mapping (CurrentStemID);

    -- Update stems using the mapping table
    UPDATE stems s
    INNER JOIN stem_crossid_mapping scm ON s.StemGUID = scm.CurrentStemID
    SET s.StemCrossID = scm.NewStemCrossID;

    -- Clean up the mapping table
    DROP TEMPORARY TABLE stem_crossid_mapping;

    -- Step 9: Optimized core measurements insertion
    -- Use a single UNION query instead of multiple temp tables for better performance
    INSERT IGNORE INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description, UserDefinedFields, IsActive)
    SELECT f.CensusID,
           s.StemGUID,
           null as IsValidated,
           COALESCE(f.MeasurementDate, '1900-01-01') as MeasurementDate,
           CASE WHEN f.DBH = 0 THEN NULL ELSE f.DBH END as MeasuredDBH,
           CASE WHEN f.HOM = 0 THEN NULL ELSE f.HOM END as MeasuredHOM,
           COALESCE(f.Comments, '') as Description,
           JSON_OBJECT('treestemstate', 
               CASE 
                   WHEN EXISTS(SELECT 1 FROM old_trees ot WHERE ot.id = f.id) THEN 'old tree'
                   WHEN EXISTS(SELECT 1 FROM multi_stems ms WHERE ms.id = f.id) THEN 'multi stem'
                   ELSE 'new recruit'
               END
           ) as UserDefinedFields,
           1 as IsActive
    FROM filtered f
    INNER JOIN trees t ON t.TreeTag = f.TreeTag 
                      AND t.SpeciesID = f.SpeciesID 
                      AND t.CensusID = f.CensusID 
                      AND t.IsActive = 1
    INNER JOIN stems s ON s.TreeID = t.TreeID 
                      AND s.StemTag = f.StemTag 
                      AND s.QuadratID = f.QuadratID 
                      AND s.CensusID = f.CensusID 
                      AND s.IsActive = 1;

    -- Step 10: Clean up measurement nulls (batch operation)
    UPDATE coremeasurements
    SET MeasurementDate = NULLIF(MeasurementDate, '1900-01-01'),
        MeasuredDBH     = NULLIF(MeasuredDBH, 0),
        MeasuredHOM     = NULLIF(MeasuredHOM, 0),
        Description     = NULLIF(Description, '')
    WHERE CensusID = vCurrentCensusID;

    -- Step 11: Optimized attribute code handling
    -- Only process rows that actually have codes to avoid unnecessary JSON parsing
    IF EXISTS(SELECT 1 FROM filtered WHERE Codes IS NOT NULL AND TRIM(Codes) != '') THEN
        CREATE TEMPORARY TABLE tempcodes ENGINE = MEMORY AS
        SELECT cm.CoreMeasurementID,
               trim(jt.code) as Code
        FROM filtered f
        INNER JOIN trees t ON t.TreeTag = f.TreeTag 
                          AND t.SpeciesID = f.SpeciesID 
                          AND t.CensusID = f.CensusID 
                          AND t.IsActive = 1
        INNER JOIN stems s ON s.TreeID = t.TreeID 
                          AND s.StemTag = f.StemTag 
                          AND s.QuadratID = f.QuadratID 
                          AND s.CensusID = f.CensusID 
                          AND s.IsActive = 1
        INNER JOIN coremeasurements cm ON cm.StemGUID = s.StemGUID 
                                      AND cm.CensusID = f.CensusID 
                                      AND cm.IsActive = 1,
        json_table(
            if(f.Codes = '' or trim(f.Codes) = '', '[]',
               concat('["', replace(trim(f.Codes), ';', '","'), '"]')),
            '$[*]' columns ( code varchar(10) path '$')
        ) jt
        WHERE f.Codes is not null
          AND trim(f.Codes) != '';

        -- Only insert valid attribute codes
        INSERT IGNORE INTO cmattributes (CoreMeasurementID, Code)
        SELECT tc.CoreMeasurementID, tc.Code
        FROM tempcodes tc
        INNER JOIN attributes a ON a.Code = tc.Code AND a.IsActive = 1;
    END IF;

    -- Clean up temporary tables
    DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, filter_validity, filtered,
        old_trees, multi_stems, new_recruits, unique_trees_to_insert, unique_stems_to_insert, tempcodes, stem_crossid_mapping;

    -- Clean up temporarymeasurements for this successful batch
    DELETE FROM temporarymeasurements WHERE FileID = vFileID AND BatchID = vBatchID;
    

    SET @disable_triggers = 0;
    
    -- Return success message
    SELECT CONCAT('Batch ', vBatchID, ' processed successfully (', vBatchRowCount, ' rows)') as message, FALSE as batch_failed;
END;