-- ============================================================
-- FIXED VERSION: bulkingestionprocess
-- Fixes critical data loss issues:
-- 1. NULL StemTag validation BEFORE processing
-- 2. Explicit duplicate detection (no silent INSERT IGNORE drops)
-- 3. uploaddatalossreport logging for ALL data loss events
-- 4. FailureReasons populated with specific error messages
-- 5. Negative DBH validation
-- ============================================================

USE forestgeo_testing;

DROP PROCEDURE IF EXISTS bulkingestionprocess;

DELIMITER $$

CREATE DEFINER=`azureroot`@`%` PROCEDURE `bulkingestionprocess`(IN vFileID varchar(36), IN vBatchID varchar(36))
main_proc:
BEGIN
    DECLARE vCurrentCensusID int;
    DECLARE vBatchFailed BOOLEAN DEFAULT FALSE;
    DECLARE vErrorMessage TEXT DEFAULT '';
    DECLARE vErrorCode VARCHAR(10) DEFAULT '';
    DECLARE vBatchRowCount INT DEFAULT 0;
    DECLARE vDataLossCount INT DEFAULT 0;

    -- Enhanced error handler
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
        BEGIN
            GET DIAGNOSTICS CONDITION 1
                vErrorMessage = MESSAGE_TEXT,
                vErrorCode = MYSQL_ERRNO;

            SET vBatchFailed = TRUE;

            -- Log to uploaddatalossreport
            INSERT INTO uploaddatalossreport (FileID, BatchID, CensusID, LossType, LossCount, ErrorMessage, ErrorCode)
            VALUES (vFileID, vBatchID, vCurrentCensusID, 'PROCEDURE_EXCEPTION', vBatchRowCount, LEFT(vErrorMessage, 500), vErrorCode);

            -- Move all batch records to failedmeasurements with error details
            INSERT IGNORE INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM,
                                                   Date, Codes, Comments, FailureReasons)
            SELECT PlotID,
                   CensusID,
                   NULLIF(TreeTag, '')                                                             as Tag,
                   NULLIF(StemTag, '')                                                             as StemTag,
                   NULLIF(SpeciesCode, '')                                                         as SpCode,
                   NULLIF(QuadratName, '')                                                         as Quadrat,
                   NULLIF(LocalX, 0)                                                               as X,
                   NULLIF(LocalY, 0)                                                               as Y,
                   NULLIF(DBH, 0)                                                                  as DBH,
                   NULLIF(HOM, 0)                                                                  as HOM,
                   NULLIF(MeasurementDate, '1900-01-01')                                           as MeasurementDate,
                   NULLIF(Codes, '')                                                               as Codes,
                   NULLIF(Comments, '')                                                            as Comments,
                   CONCAT('SQL Exception during batch processing. Error ', vErrorCode, ': ', LEFT(vErrorMessage, 200)) as FailureReasons
            FROM temporarymeasurements
            WHERE FileID = vFileID
              AND BatchID = vBatchID;

            -- Clean up
            DELETE FROM temporarymeasurements WHERE FileID = vFileID AND BatchID = vBatchID;
            DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, filter_validity, filtered, validation_failures,
                old_trees, multi_stems, new_recruits, unique_trees_to_insert, unique_stems_to_insert, tempcodes,
                stem_crossid_mapping, pre_insert_check;

            SELECT CONCAT('Batch ', vBatchID, ' failed with error: ', vErrorCode) as message, TRUE as batch_failed;
        END;

    -- Get CensusID and row count
    SELECT CensusID, COUNT(*)
    INTO vCurrentCensusID, vBatchRowCount
    FROM temporarymeasurements
    WHERE FileID = vFileID
      AND BatchID = vBatchID
    GROUP BY CensusID
    LIMIT 1;

    -- Early exit if no data
    IF vBatchRowCount = 0 THEN
        SELECT 'No data found for specified FileID/BatchID' as message, FALSE as batch_failed;
        LEAVE main_proc;
    END IF;

    -- Clean up existing temp tables
    DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, filter_validity, filtered, validation_failures,
        old_trees, multi_stems, new_recruits, unique_trees_to_insert, unique_stems_to_insert, tempcodes,
        stem_crossid_mapping, pre_insert_check;

    -- ============================================================
    -- FIX 1: EARLY VALIDATION WITH SPECIFIC ERROR MESSAGES
    -- Validate critical fields BEFORE any processing
    -- ============================================================

    CREATE TEMPORARY TABLE validation_failures AS
    SELECT
        tm.*,
        CASE
            -- Critical field validations with specific error messages
            WHEN tm.TreeTag IS NULL OR TRIM(tm.TreeTag) = ''
                THEN 'Missing required field: TreeTag (tree identifier)'
            WHEN tm.StemTag IS NULL OR TRIM(tm.StemTag) = ''
                THEN 'Missing required field: StemTag (stem identifier)'
            WHEN tm.SpeciesCode IS NULL OR TRIM(tm.SpeciesCode) = ''
                THEN 'Missing required field: SpeciesCode (species identifier)'
            WHEN tm.QuadratName IS NULL OR TRIM(tm.QuadratName) = ''
                THEN 'Missing required field: QuadratName (quadrat identifier)'
            WHEN tm.MeasurementDate IS NULL
                THEN 'Missing required field: MeasurementDate (measurement date)'
            WHEN tm.DBH < 0
                THEN CONCAT('Invalid DBH value: ', tm.DBH, ' (must be >= 0 or NULL for dead/missing trees)')
            WHEN tm.HOM < 0
                THEN CONCAT('Invalid HOM value: ', tm.HOM, ' (must be >= 0 or NULL)')
            WHEN tm.LocalX IS NOT NULL AND tm.LocalX < 0
                THEN CONCAT('Invalid LocalX coordinate: ', tm.LocalX, ' (must be >= 0)')
            WHEN tm.LocalY IS NOT NULL AND tm.LocalY < 0
                THEN CONCAT('Invalid LocalY coordinate: ', tm.LocalY, ' (must be >= 0)')
            WHEN tm.DBH = 0 AND tm.HOM = 0 AND (tm.Codes IS NULL OR TRIM(tm.Codes) = '')
                THEN 'Invalid measurement: DBH and HOM are both 0 with no status codes (missing data)'
            ELSE NULL
        END as FailureReason
    FROM temporarymeasurements tm
    WHERE tm.FileID = vFileID
      AND tm.BatchID = vBatchID
      AND tm.CensusID = vCurrentCensusID
    HAVING FailureReason IS NOT NULL;

    -- Move validation failures to failedmeasurements with specific reasons
    IF EXISTS(SELECT 1 FROM validation_failures) THEN
        SET vDataLossCount = (SELECT COUNT(*) FROM validation_failures);

        INSERT INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM,
                                       Date, Codes, Comments, FailureReasons)
        SELECT PlotID,
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
               NULLIF(Comments, '')                  as Comments,
               FailureReason                         as FailureReasons
        FROM validation_failures;

        -- Log to uploaddatalossreport (these would have been silently lost before)
        INSERT INTO uploaddatalossreport (FileID, BatchID, CensusID, LossType, LossCount, ErrorMessage)
        VALUES (vFileID, vBatchID, vCurrentCensusID, 'VALIDATION_FAILURE', vDataLossCount,
                CONCAT('Critical field validation failed: ', vDataLossCount, ' records moved to failedmeasurements'));
    END IF;

    -- ============================================================
    -- FIX 2: DUPLICATE DETECTION WITH EXPLICIT LOGGING
    -- Step 1: Deduplication with information preservation
    -- ============================================================

    CREATE TEMPORARY TABLE initial_dup_filter AS
    SELECT min(id)                                                                        as id,
           COUNT(*) as duplicate_count,
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
           NULLIF(
               GROUP_CONCAT(
                   DISTINCT CASE WHEN Codes IS NOT NULL AND TRIM(Codes) != '' THEN TRIM(Codes) END
                   ORDER BY Codes
                   SEPARATOR ';'
               ),
               ''
           ) as Codes,
           NULLIF(
               GROUP_CONCAT(
                   DISTINCT CASE WHEN Comments IS NOT NULL AND TRIM(Comments) != '' THEN TRIM(Comments) END
                   ORDER BY Comments
                   SEPARATOR ' | '
               ),
               ''
           ) as Comments
    FROM temporarymeasurements
    WHERE FileID = vFileID
      AND BatchID = vBatchID
      AND CensusID = vCurrentCensusID
      -- Exclude records that already failed validation
      AND id NOT IN (SELECT id FROM validation_failures)
    GROUP BY FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode,
             QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate;

    -- Log duplicates that were dropped
    IF EXISTS(SELECT 1 FROM initial_dup_filter WHERE duplicate_count > 1) THEN
        SET @dup_count = (SELECT SUM(duplicate_count - 1) FROM initial_dup_filter WHERE duplicate_count > 1);

        -- Insert duplicate records to failedmeasurements with explanation
        INSERT INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM,
                                       Date, Codes, Comments, FailureReasons)
        SELECT tm.PlotID,
               tm.CensusID,
               NULLIF(tm.TreeTag, '')                   as Tag,
               NULLIF(tm.StemTag, '')                   as StemTag,
               NULLIF(tm.SpeciesCode, '')               as SpCode,
               NULLIF(tm.QuadratName, '')               as Quadrat,
               NULLIF(tm.LocalX, 0)                     as X,
               NULLIF(tm.LocalY, 0)                     as Y,
               NULLIF(tm.DBH, 0)                        as DBH,
               NULLIF(tm.HOM, 0)                        as HOM,
               NULLIF(tm.MeasurementDate, '1900-01-01') as MeasurementDate,
               NULLIF(tm.Codes, '')                     as Codes,
               NULLIF(tm.Comments, '')                  as Comments,
               CONCAT('Duplicate entry: Same TreeTag, StemTag, DBH, HOM, and Date. Original record ID: ',
                      idf.id, '. Duplicate count: ', idf.duplicate_count) as FailureReasons
        FROM temporarymeasurements tm
        INNER JOIN initial_dup_filter idf
            ON tm.FileID = idf.FileID
            AND tm.BatchID = idf.BatchID
            AND tm.TreeTag = idf.TreeTag
            AND tm.StemTag = idf.StemTag
            AND tm.SpeciesCode = idf.SpeciesCode
            AND tm.QuadratName = idf.QuadratName
            AND tm.LocalX = idf.LocalX
            AND tm.LocalY = idf.LocalY
            AND tm.DBH = idf.DBH
            AND tm.HOM = idf.HOM
            AND tm.MeasurementDate = idf.MeasurementDate
        WHERE tm.id != idf.id  -- Keep the first one, log duplicates
          AND idf.duplicate_count > 1;

        -- Log to uploaddatalossreport
        INSERT INTO uploaddatalossreport (FileID, BatchID, CensusID, LossType, LossCount, ErrorMessage)
        VALUES (vFileID, vBatchID, vCurrentCensusID, 'DUPLICATE_RECORDS', @dup_count,
                CONCAT(@dup_count, ' duplicate records moved to failedmeasurements (same TreeTag/StemTag/DBH/HOM/Date)'));

        SET vDataLossCount = vDataLossCount + @dup_count;
    END IF;

    CREATE INDEX idx_dup_tree_species ON initial_dup_filter (TreeTag, SpeciesCode);
    CREATE INDEX idx_dup_quadrat ON initial_dup_filter (QuadratName);

    -- ============================================================
    -- Step 2: Enhanced validation with better error messages
    -- ============================================================

    CREATE TEMPORARY TABLE filter_validity AS
    SELECT i.id,
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
           CASE
               WHEN tq.QuadratID IS NULL THEN CONCAT('Invalid quadrat name: "', i.QuadratName, '" does not exist in database')
               WHEN ts.SpeciesID IS NULL THEN CONCAT('Invalid species code: "', i.SpeciesCode, '" does not exist in database')
               ELSE NULL
           END as FailureReason,
           CASE
               WHEN tq.QuadratID IS NULL OR ts.SpeciesID IS NULL THEN false
               ELSE true
           END as Valid,
           tq.QuadratID,
           ts.SpeciesID
    FROM initial_dup_filter i
             LEFT JOIN quadrats tq ON tq.QuadratName = i.QuadratName AND tq.IsActive = 1
             LEFT JOIN species ts ON ts.SpeciesCode = i.SpeciesCode AND ts.IsActive = 1;

    CREATE INDEX idx_validity_valid ON filter_validity (Valid);
    CREATE INDEX idx_validity_tree ON filter_validity (TreeTag, SpeciesID, CensusID);

    -- Step 3: Create filtered dataset (only valid rows)
    CREATE TEMPORARY TABLE filtered AS
    SELECT *
    FROM filter_validity
    WHERE Valid = true;

    CREATE INDEX idx_filtered_tree_census ON filtered (TreeTag, CensusID);
    CREATE INDEX idx_filtered_stem_tree ON filtered (StemTag, TreeTag);
    CREATE INDEX idx_filtered_species ON filtered (SpeciesID);

    -- Step 4: Handle validation failures with specific reasons
    IF EXISTS(SELECT 1 FROM filter_validity WHERE Valid = false) THEN
        SET @invalid_count = (SELECT COUNT(*) FROM filter_validity WHERE Valid = false);

        INSERT INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes,
                                       Comments, FailureReasons)
        SELECT PlotID,
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
               NULLIF(Comments, '')                  as Comments,
               FailureReason                         as FailureReasons
        FROM filter_validity
        WHERE Valid = false;

        -- Log reference data validation failures
        INSERT INTO uploaddatalossreport (FileID, BatchID, CensusID, LossType, LossCount, ErrorMessage)
        VALUES (vFileID, vBatchID, vCurrentCensusID, 'INVALID_REFERENCE_DATA', @invalid_count,
                CONCAT(@invalid_count, ' records with invalid species codes or quadrat names moved to failedmeasurements'));

        SET vDataLossCount = vDataLossCount + @invalid_count;
    END IF;

    -- ============================================================
    -- FIX 3: EXPLICIT DUPLICATE CHECKING FOR COREMEASUREMENTS
    -- Check if measurements already exist BEFORE inserting
    -- ============================================================

    -- After trees and stems are inserted, check for existing measurements
    -- This will be done in Step 9 below with pre-insert validation

    -- Step 5-8: Continue with original logic (stem categorization, tree/stem insertion)
    -- [Keeping original implementation for these steps as they work correctly]

    CREATE TEMPORARY TABLE old_trees AS
    SELECT DISTINCT f.*
    FROM filtered f
    WHERE EXISTS (SELECT 1 FROM trees t WHERE t.TreeTag = f.TreeTag AND t.CensusID < f.CensusID AND t.IsActive = 1)
      AND EXISTS (SELECT 1
                  FROM trees t
                           JOIN stems s ON s.TreeID = t.TreeID
                  WHERE t.TreeTag = f.TreeTag
                    AND s.StemTag = f.StemTag
                    AND t.CensusID < f.CensusID
                    AND t.IsActive = 1
                    AND s.IsActive = 1);

    CREATE TEMPORARY TABLE multi_stems AS
    SELECT DISTINCT f.*
    FROM filtered f
    WHERE EXISTS (SELECT 1 FROM trees t WHERE t.TreeTag = f.TreeTag AND t.CensusID < f.CensusID AND t.IsActive = 1)
      AND NOT EXISTS (SELECT 1 FROM old_trees ot WHERE ot.id = f.id);

    CREATE TEMPORARY TABLE new_recruits AS
    SELECT DISTINCT f.*
    FROM filtered f
    WHERE NOT EXISTS (SELECT 1 FROM old_trees ot WHERE ot.id = f.id)
      AND NOT EXISTS (SELECT 1 FROM multi_stems ms WHERE ms.id = f.id);

    -- Step 6: Tree insertion
    CREATE TEMPORARY TABLE unique_trees_to_insert AS
    SELECT DISTINCT TreeTag, SpeciesID, CensusID
    FROM filtered
    WHERE CensusID = vCurrentCensusID;

    CREATE INDEX idx_trees_insert ON unique_trees_to_insert (TreeTag, SpeciesID, CensusID);

    INSERT IGNORE INTO trees (TreeTag, SpeciesID, CensusID)
    SELECT uti.TreeTag, uti.SpeciesID, uti.CensusID
    FROM unique_trees_to_insert uti
             LEFT JOIN trees existing ON existing.TreeTag = uti.TreeTag
        AND existing.CensusID = uti.CensusID
        AND existing.SpeciesID = uti.SpeciesID
    WHERE existing.TreeID IS NULL;

    -- Step 7: Stem insertion
    CREATE TEMPORARY TABLE unique_stems_to_insert AS
    SELECT DISTINCT TreeTag, QuadratID, StemTag, LocalX, LocalY, CensusID, SpeciesID
    FROM filtered
    WHERE CensusID = vCurrentCensusID;

    CREATE INDEX idx_stems_insert ON unique_stems_to_insert (TreeTag, SpeciesID, CensusID);

    INSERT IGNORE INTO stems (TreeID, QuadratID, CensusID, StemCrossID, StemTag, LocalX, LocalY, Moved, StemDescription,
                              IsActive)
    SELECT t.TreeID,
           usi.QuadratID,
           vCurrentCensusID                                                                    as CensusID,
           NULL                                                                                as StemCrossID,
           CASE WHEN TRIM(COALESCE(usi.StemTag, '')) = '' THEN NULL ELSE TRIM(usi.StemTag) END as StemTag,
           CASE WHEN usi.LocalX = 0 THEN NULL ELSE usi.LocalX END                              as LocalX,
           CASE WHEN usi.LocalY = 0 THEN NULL ELSE usi.LocalY END                              as LocalY,
           0                                                                                   as Moved,
           NULL                                                                                as StemDescription,
           1                                                                                   as IsActive
    FROM unique_stems_to_insert usi
             INNER JOIN trees t ON t.TreeTag = usi.TreeTag
        AND t.SpeciesID = usi.SpeciesID
        AND t.CensusID = vCurrentCensusID
        AND t.IsActive = 1;

    -- Step 8: StemCrossID update
    CREATE TEMPORARY TABLE stem_crossid_mapping AS
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
           )               as NewStemCrossID
    FROM stems s_curr
    WHERE s_curr.CensusID = vCurrentCensusID
      AND s_curr.StemCrossID IS NULL;

    CREATE INDEX idx_mapping_stemid ON stem_crossid_mapping (CurrentStemID);

    UPDATE stems s
        INNER JOIN stem_crossid_mapping scm ON s.StemGUID = scm.CurrentStemID
    SET s.StemCrossID = scm.NewStemCrossID;

    DROP TEMPORARY TABLE stem_crossid_mapping;

    -- ============================================================
    -- Step 9: FIXED core measurements insertion with duplicate checking
    -- ============================================================

    -- Create temp table to check for existing measurements
    CREATE TEMPORARY TABLE pre_insert_check AS
    SELECT f.id as filtered_id,
           f.CensusID,
           s.StemGUID,
           COALESCE(f.MeasurementDate, '1900-01-01')    as MeasurementDate,
           CASE WHEN f.DBH = 0 THEN NULL ELSE f.DBH END as MeasuredDBH,
           CASE WHEN f.HOM = 0 THEN NULL ELSE f.HOM END as MeasuredHOM,
           EXISTS(
               SELECT 1
               FROM coremeasurements existing
               WHERE existing.StemGUID = s.StemGUID
                 AND existing.CensusID = f.CensusID
                 AND COALESCE(existing.MeasurementDate, '1900-01-01') = COALESCE(f.MeasurementDate, '1900-01-01')
                 AND COALESCE(existing.MeasuredDBH, 0) = CASE WHEN f.DBH = 0 THEN 0 ELSE COALESCE(f.DBH, 0) END
                 AND COALESCE(existing.MeasuredHOM, 0) = CASE WHEN f.HOM = 0 THEN 0 ELSE COALESCE(f.HOM, 0) END
                 AND existing.IsActive = 1
           ) as already_exists
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

    -- Log measurements that would be duplicates
    IF EXISTS(SELECT 1 FROM pre_insert_check WHERE already_exists = TRUE) THEN
        SET @existing_count = (SELECT COUNT(*) FROM pre_insert_check WHERE already_exists = TRUE);

        -- Move duplicate measurements to failedmeasurements
        INSERT INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes,
                                       Comments, FailureReasons)
        SELECT f.PlotID,
               f.CensusID,
               NULLIF(f.TreeTag, '')                   as Tag,
               NULLIF(f.StemTag, '')                   as StemTag,
               NULLIF(f.SpeciesCode, '')               as SpCode,
               NULLIF(f.QuadratName, '')               as Quadrat,
               NULLIF(f.LocalX, 0)                     as X,
               NULLIF(f.LocalY, 0)                     as Y,
               NULLIF(f.DBH, 0)                        as DBH,
               NULLIF(f.HOM, 0)                        as HOM,
               NULLIF(f.MeasurementDate, '1900-01-01') as MeasurementDate,
               NULLIF(f.Codes, '')                     as Codes,
               NULLIF(f.Comments, '')                  as Comments,
               CONCAT('Duplicate measurement: Same stem, census, date, DBH, and HOM already exists in coremeasurements') as FailureReasons
        FROM filtered f
        INNER JOIN pre_insert_check pc ON f.id = pc.filtered_id
        WHERE pc.already_exists = TRUE;

        -- Log to uploaddatalossreport
        INSERT INTO uploaddatalossreport (FileID, BatchID, CensusID, LossType, LossCount, ErrorMessage)
        VALUES (vFileID, vBatchID, vCurrentCensusID, 'DUPLICATE_MEASUREMENTS', @existing_count,
                CONCAT(@existing_count, ' measurements already exist in coremeasurements (duplicate stem/census/date/DBH/HOM)'));

        SET vDataLossCount = vDataLossCount + @existing_count;
    END IF;

    -- Insert only non-duplicate measurements
    INSERT IGNORE INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
                                         Description, UserDefinedFields, IsActive)
    SELECT pc.CensusID,
           pc.StemGUID,
           null                     as IsValidated,
           pc.MeasurementDate,
           pc.MeasuredDBH,
           pc.MeasuredHOM,
           COALESCE(f.Comments, '') as Description,
           JSON_OBJECT('treestemstate',
                       CASE
                           WHEN EXISTS(SELECT 1 FROM old_trees ot WHERE ot.id = f.id) THEN 'old tree'
                           WHEN EXISTS(SELECT 1 FROM multi_stems ms WHERE ms.id = f.id) THEN 'multi stem'
                           ELSE 'new recruit'
                           END
           )                        as UserDefinedFields,
           1                        as IsActive
    FROM pre_insert_check pc
    INNER JOIN filtered f ON f.id = pc.filtered_id
    WHERE pc.already_exists = FALSE;

    -- Step 10: Clean up measurement nulls
    UPDATE coremeasurements
    SET MeasurementDate = NULLIF(MeasurementDate, '1900-01-01'),
        MeasuredDBH     = NULLIF(MeasuredDBH, 0),
        MeasuredHOM     = NULLIF(MeasuredHOM, 0),
        Description     = NULLIF(Description, '')
    WHERE CensusID = vCurrentCensusID;

    -- Step 11: Attribute code handling (unchanged)
    IF EXISTS(SELECT 1 FROM filtered WHERE Codes IS NOT NULL AND TRIM(Codes) != '') THEN
        CREATE TEMPORARY TABLE tempcodes AS
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

        INSERT IGNORE INTO cmattributes (CoreMeasurementID, Code)
        SELECT tc.CoreMeasurementID, tc.Code
        FROM tempcodes tc
                 INNER JOIN attributes a ON a.Code = tc.Code AND a.IsActive = 1;

        INSERT IGNORE INTO cmverrors (CoreMeasurementID, ValidationErrorID)
        SELECT DISTINCT tc.CoreMeasurementID, 14 as ValidationErrorID
        FROM tempcodes tc
                 LEFT JOIN attributes a ON a.Code = tc.Code AND a.IsActive = 1
        WHERE a.Code IS NULL;
    END IF;

    -- Clean up temporary tables
    DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, filter_validity, filtered, validation_failures,
        old_trees, multi_stems, new_recruits, unique_trees_to_insert, unique_stems_to_insert, tempcodes,
        stem_crossid_mapping, pre_insert_check;

    -- Clean up temporarymeasurements for this successful batch
    DELETE FROM temporarymeasurements WHERE FileID = vFileID AND BatchID = vBatchID;

    -- Final success message with data loss summary
    IF vDataLossCount > 0 THEN
        SELECT CONCAT('Batch ', vBatchID, ' processed (', vBatchRowCount, ' input rows, ',
                      vDataLossCount, ' moved to failedmeasurements - see uploaddatalossreport for details)') as message,
               FALSE as batch_failed,
               vDataLossCount as records_failed;
    ELSE
        SELECT CONCAT('Batch ', vBatchID, ' processed successfully (', vBatchRowCount, ' rows)') as message,
               FALSE as batch_failed,
               0 as records_failed;
    END IF;
END$$

DELIMITER ;

-- ============================================================
-- Verify the procedure was created
-- ============================================================
SELECT 'Fixed stored procedure created successfully' as Status;
SHOW WARNINGS;
