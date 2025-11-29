/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19-12.0.2-MariaDB, for osx10.19 (x86_64)
--
-- Host: forestgeo-mysqldataserver.mysql.database.azure.com    Database: forestgeo_panama
-- ------------------------------------------------------
-- Server version	8.0.42-azure

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*M!100616 SET @OLD_NOTE_VERBOSITY=@@NOTE_VERBOSITY, NOTE_VERBOSITY=0 */;

--
-- Dumping routines for database 'forestgeo_panama'
--
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
/*!50003 DROP PROCEDURE IF EXISTS `bulkingestionprocess` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
DELIMITER ;;
CREATE DEFINER=`azureroot`@`%` PROCEDURE `bulkingestionprocess`(IN vFileID varchar(36), IN vBatchID varchar(36))
main_proc:
BEGIN
    DECLARE vCurrentCensusID int;
    DECLARE vCurrentPlotID int;
    DECLARE vBatchFailed BOOLEAN DEFAULT FALSE;
    DECLARE vErrorMessage TEXT DEFAULT '';
    DECLARE vErrorCode VARCHAR(10) DEFAULT '';
    DECLARE vBatchRowCount INT DEFAULT 0;
    DECLARE vDataLossCount INT DEFAULT 0;
    DECLARE vProcessedCount INT DEFAULT 0;
    DECLARE vUploadId VARCHAR(50);

    -- Error handler with proper logging
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
        BEGIN
            GET DIAGNOSTICS CONDITION 1
                vErrorMessage = MESSAGE_TEXT,
                vErrorCode = MYSQL_ERRNO;

            SET vBatchFailed = TRUE;
            SET vUploadId = CONCAT(vFileID, '-', vBatchID);

            -- Log to uploadmetrics
            INSERT IGNORE INTO uploadmetrics (
                uploadId, fileID, batchID, schema_name, plotID, censusID,
                sourceRecords, processedRecords, failedRecords, missingRecords,
                dataLossDetected, status, errorMessage, startTime, endTime
            ) VALUES (
                vUploadId, vFileID, vBatchID, DATABASE(),
                COALESCE(vCurrentPlotID, 0), COALESCE(vCurrentCensusID, 0),
                vBatchRowCount, 0, vBatchRowCount, 0,
                1, 'failed', CONCAT('Error ', vErrorCode, ': ', LEFT(vErrorMessage, 200)),
                NOW(), NOW()
            )
            ON DUPLICATE KEY UPDATE
                status = 'failed',
                failedRecords = vBatchRowCount,
                errorMessage = CONCAT('Error ', vErrorCode, ': ', LEFT(vErrorMessage, 200)),
                endTime = NOW();

            -- Log to uploadintegrityalerts
            INSERT IGNORE INTO uploadintegrityalerts (
                uploadId, fileID, batchID, plotID, censusID,
                type, message, severity,
                sourceRecords, processedRecords, failedRecords, missingRecords
            ) VALUES (
                vUploadId, vFileID, vBatchID,
                COALESCE(vCurrentPlotID, 0), COALESCE(vCurrentCensusID, 0),
                'PROCEDURE_EXCEPTION',
                CONCAT('SQL error ', vErrorCode, ': ', LEFT(vErrorMessage, 200)),
                'critical',
                vBatchRowCount, 0, vBatchRowCount, 0
            );

            -- Move all batch to failedmeasurements
            INSERT IGNORE INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM,
                                                   Date, Codes, Comments, FailureReasons)
            SELECT PlotID, CensusID,
                   NULLIF(TreeTag, ''), NULLIF(StemTag, ''), NULLIF(SpeciesCode, ''), NULLIF(QuadratName, ''),
                   NULLIF(LocalX, 0), NULLIF(LocalY, 0), NULLIF(DBH, 0), NULLIF(HOM, 0),
                   NULLIF(MeasurementDate, '1900-01-01'), NULLIF(Codes, ''), NULLIF(Comments, ''),
                   CONCAT('SQL Exception: Error ', vErrorCode, ': ', LEFT(vErrorMessage, 150))
            FROM temporarymeasurements
            WHERE FileID = vFileID AND BatchID = vBatchID;

            DELETE FROM temporarymeasurements WHERE FileID = vFileID AND BatchID = vBatchID;

            DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, filter_validity, filtered, validation_failures,
                old_trees, multi_stems, new_recruits, unique_trees_to_insert, unique_stems_to_insert, tempcodes,
                stem_crossid_mapping, pre_insert_check;

            SELECT CONCAT('Batch ', vBatchID, ' failed: ', vErrorCode) as message, TRUE as batch_failed;
        END;

    SET @disable_triggers = 0;

    -- FIX: Set connection collation to match database to prevent collation errors in JSON_TABLE
    SET collation_connection = 'utf8mb4_0900_ai_ci';

    SET vUploadId = CONCAT(vFileID, '-', vBatchID);

    -- Get census info
    SELECT CensusID, PlotID, COUNT(*)
    INTO vCurrentCensusID, vCurrentPlotID, vBatchRowCount
    FROM temporarymeasurements
    WHERE FileID = vFileID AND BatchID = vBatchID
    GROUP BY CensusID, PlotID
    LIMIT 1;

    IF vBatchRowCount = 0 THEN
        SET @disable_triggers = 0;
        SELECT 'No data found' as message, FALSE as batch_failed;
        LEAVE main_proc;
    END IF;

    -- Idempotency check: Skip if this batch has already been processed
    IF EXISTS (
        SELECT 1 FROM coremeasurements cm
        WHERE cm.CensusID = vCurrentCensusID
          AND JSON_UNQUOTE(JSON_EXTRACT(cm.UserDefinedFields, '$.uploadSession.batchID')) = vBatchID
        LIMIT 1
    ) THEN
        -- Batch already processed, skip and clean up temporarymeasurements
        DELETE FROM temporarymeasurements WHERE FileID = vFileID AND BatchID = vBatchID;
        SET @disable_triggers = 0;
        SELECT CONCAT('Batch ', vBatchID, ' already processed, skipped') as message, FALSE as batch_failed;
        LEAVE main_proc;
    END IF;

    -- Initialize metrics
    INSERT IGNORE INTO uploadmetrics (
        uploadId, fileID, batchID, schema_name, plotID, censusID,
        sourceRecords, processedRecords, failedRecords, missingRecords,
        status, startTime
    ) VALUES (
        vUploadId, vFileID, vBatchID, DATABASE(),
        vCurrentPlotID, vCurrentCensusID,
        vBatchRowCount, 0, 0, 0,
        'processing', NOW()
    );

    DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, filter_validity, filtered, validation_failures,
        old_trees, multi_stems, new_recruits, unique_trees_to_insert, unique_stems_to_insert, tempcodes,
        stem_crossid_mapping, pre_insert_check;

    -- ============================================================
    -- FIX 1: EARLY VALIDATION WITH SPECIFIC ERROR MESSAGES
    -- ============================================================
    CREATE TEMPORARY TABLE validation_failures AS
    SELECT tm.*,
        CASE
            WHEN tm.TreeTag IS NULL OR TRIM(tm.TreeTag) = ''
                THEN 'Missing required field: TreeTag'
            WHEN tm.StemTag IS NULL OR TRIM(tm.StemTag) = ''
                THEN 'Missing required field: StemTag'
            WHEN tm.SpeciesCode IS NULL OR TRIM(tm.SpeciesCode) = ''
                THEN 'Missing required field: SpeciesCode'
            WHEN tm.QuadratName IS NULL OR TRIM(tm.QuadratName) = ''
                THEN 'Missing required field: QuadratName'
            WHEN tm.MeasurementDate IS NULL
                THEN 'Missing required field: MeasurementDate'
            -- String length validations (CRITICAL - prevent SQL errors)
            WHEN LENGTH(tm.TreeTag) > 20
                THEN CONCAT('TreeTag exceeds maximum length of 20 characters: "', LEFT(tm.TreeTag, 25), '..." (', LENGTH(tm.TreeTag), ' chars)')
            WHEN LENGTH(tm.StemTag) > 10
                THEN CONCAT('StemTag exceeds maximum length of 10 characters: "', tm.StemTag, '" (', LENGTH(tm.StemTag), ' chars)')
            WHEN LENGTH(tm.SpeciesCode) > 25
                THEN CONCAT('SpeciesCode exceeds maximum length of 25 characters: "', tm.SpeciesCode, '" (', LENGTH(tm.SpeciesCode), ' chars)')
            WHEN tm.Comments IS NOT NULL AND LENGTH(tm.Comments) > 255
                THEN CONCAT('Comments exceed maximum length of 255 characters (', LENGTH(tm.Comments), ' chars, truncated)')
            WHEN tm.Codes IS NOT NULL AND LENGTH(tm.Codes) > 255
                THEN CONCAT('Codes exceed maximum length of 255 characters (', LENGTH(tm.Codes), ' chars, truncated)')
            -- Numeric validations
            WHEN tm.DBH < 0
                THEN CONCAT('Invalid DBH: ', tm.DBH, ' (must be >= 0 or NULL)')
            WHEN tm.HOM < 0
                THEN CONCAT('Invalid HOM: ', tm.HOM, ' (must be >= 0 or NULL)')
            WHEN tm.LocalX IS NOT NULL AND tm.LocalX < 0
                THEN CONCAT('Invalid LocalX: ', tm.LocalX)
            WHEN tm.LocalY IS NOT NULL AND tm.LocalY < 0
                THEN CONCAT('Invalid LocalY: ', tm.LocalY)
            WHEN tm.DBH = 0 AND tm.HOM = 0 AND (tm.Codes IS NULL OR TRIM(tm.Codes) = '')
                THEN 'Missing measurement data: DBH and HOM both 0 with no codes'
            ELSE NULL
        END as FailureReason
    FROM temporarymeasurements tm
    WHERE tm.FileID = vFileID AND tm.BatchID = vBatchID AND tm.CensusID = vCurrentCensusID
    HAVING FailureReason IS NOT NULL;

    IF EXISTS(SELECT 1 FROM validation_failures) THEN
        SET vDataLossCount = (SELECT COUNT(*) FROM validation_failures);

        INSERT IGNORE INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM,
                                       Date, Codes, Comments, FailureReasons)
        SELECT PlotID, CensusID,
               NULLIF(TreeTag, ''), NULLIF(StemTag, ''), NULLIF(SpeciesCode, ''), NULLIF(QuadratName, ''),
               NULLIF(LocalX, 0), NULLIF(LocalY, 0), NULLIF(DBH, 0), NULLIF(HOM, 0),
               NULLIF(MeasurementDate, '1900-01-01'), NULLIF(Codes, ''), NULLIF(Comments, ''),
               FailureReason
        FROM validation_failures;

        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity,
            sourceRecords, processedRecords, failedRecords, missingRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
            'VALIDATION_FAILURE',
            CONCAT(vDataLossCount, ' records failed validation (NULL required fields or invalid values)'),
            'warning',
            vBatchRowCount, 0, vDataLossCount, 0
        );
    END IF;

    -- ============================================================
    -- FIX 2: DUPLICATE DETECTION WITH EXPLICIT LOGGING
    -- ============================================================
    CREATE TEMPORARY TABLE initial_dup_filter AS
    SELECT min(id) as id,
           COUNT(*) as duplicate_count,
           FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode,
           QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate,
           NULLIF(GROUP_CONCAT(DISTINCT CASE WHEN Codes IS NOT NULL AND TRIM(Codes) != '' THEN TRIM(Codes) END
                   ORDER BY Codes SEPARATOR ';'), '') as Codes,
           NULLIF(GROUP_CONCAT(DISTINCT CASE WHEN Comments IS NOT NULL AND TRIM(Comments) != '' THEN TRIM(Comments) END
                   ORDER BY Comments SEPARATOR ' | '), '') as Comments
    FROM temporarymeasurements
    WHERE FileID = vFileID AND BatchID = vBatchID AND CensusID = vCurrentCensusID
      AND id NOT IN (SELECT id FROM validation_failures)
    GROUP BY FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode,
             QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate;

    IF EXISTS(SELECT 1 FROM initial_dup_filter WHERE duplicate_count > 1) THEN
        SET @dup_count = (SELECT SUM(duplicate_count - 1) FROM initial_dup_filter WHERE duplicate_count > 1);

        INSERT IGNORE INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM,
                                       Date, Codes, Comments, FailureReasons)
        SELECT tm.PlotID, tm.CensusID,
               NULLIF(tm.TreeTag, ''), NULLIF(tm.StemTag, ''), NULLIF(tm.SpeciesCode, ''), NULLIF(tm.QuadratName, ''),
               NULLIF(tm.LocalX, 0), NULLIF(tm.LocalY, 0), NULLIF(tm.DBH, 0), NULLIF(tm.HOM, 0),
               NULLIF(tm.MeasurementDate, '1900-01-01'), NULLIF(tm.Codes, ''), NULLIF(tm.Comments, ''),
               CONCAT('Duplicate entry: Same TreeTag/StemTag/DBH/HOM/Date. Original record ID: ', idf.id)
        FROM temporarymeasurements tm
        INNER JOIN initial_dup_filter idf
            ON tm.FileID = idf.FileID AND tm.BatchID = idf.BatchID
            AND tm.TreeTag = idf.TreeTag AND tm.StemTag = idf.StemTag
            AND tm.SpeciesCode = idf.SpeciesCode AND tm.QuadratName = idf.QuadratName
            AND COALESCE(tm.LocalX, 0) = COALESCE(idf.LocalX, 0)
            AND COALESCE(tm.LocalY, 0) = COALESCE(idf.LocalY, 0)
            AND COALESCE(tm.DBH, 0) = COALESCE(idf.DBH, 0)
            AND COALESCE(tm.HOM, 0) = COALESCE(idf.HOM, 0)
            AND COALESCE(tm.MeasurementDate, '1900-01-01') = COALESCE(idf.MeasurementDate, '1900-01-01')
        WHERE tm.id != idf.id AND idf.duplicate_count > 1;

        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity,
            sourceRecords, processedRecords, failedRecords, missingRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
            'DUPLICATE_RECORDS',
            CONCAT(@dup_count, ' duplicate records detected and moved to failedmeasurements'),
            'info',
            vBatchRowCount, 0, @dup_count, 0
        );

        SET vDataLossCount = vDataLossCount + @dup_count;

        UPDATE uploadmetrics
        SET duplicatesDetected = 1
        WHERE uploadId = vUploadId;
    END IF;

    CREATE INDEX idx_dup_tree_species ON initial_dup_filter (TreeTag, SpeciesCode);
    CREATE INDEX idx_dup_quadrat ON initial_dup_filter (QuadratName);

    -- Continue with rest of original procedure...
    CREATE TEMPORARY TABLE filter_validity AS
    SELECT i.id, i.FileID, i.BatchID, i.PlotID, i.CensusID, i.TreeTag,
           IFNULL(i.StemTag, '') as StemTag, i.SpeciesCode, i.QuadratName,
           IFNULL(i.LocalX, 0) as LocalX, IFNULL(i.LocalY, 0) as LocalY,
           IFNULL(i.DBH, 0) as DBH, IFNULL(i.HOM, 0) as HOM,
           i.MeasurementDate, i.Codes, i.Comments,
           CASE
               WHEN tq.QuadratID IS NULL THEN CONCAT('Invalid quadrat name: "', i.QuadratName, '" not found in database')
               WHEN ts.SpeciesID IS NULL THEN CONCAT('Invalid species code: "', i.SpeciesCode, '" not found in database')
               ELSE NULL
           END as FailureReason,
           CASE WHEN tq.QuadratID IS NULL OR ts.SpeciesID IS NULL THEN false ELSE true END as Valid,
           tq.QuadratID, ts.SpeciesID
    FROM initial_dup_filter i
    LEFT JOIN quadrats tq ON tq.QuadratName = i.QuadratName AND tq.IsActive = 1
    LEFT JOIN species ts ON ts.SpeciesCode = i.SpeciesCode AND ts.IsActive = 1;

    CREATE INDEX idx_validity_valid ON filter_validity (Valid);
    CREATE INDEX idx_validity_tree ON filter_validity (TreeTag, SpeciesID, CensusID);

    CREATE TEMPORARY TABLE filtered AS SELECT * FROM filter_validity WHERE Valid = true;

    CREATE INDEX idx_filtered_tree_census ON filtered (TreeTag, CensusID);
    CREATE INDEX idx_filtered_stem_tree ON filtered (StemTag, TreeTag);
    CREATE INDEX idx_filtered_species ON filtered (SpeciesID);

    IF EXISTS(SELECT 1 FROM filter_validity WHERE Valid = false) THEN
        SET @invalid_count = (SELECT COUNT(*) FROM filter_validity WHERE Valid = false);

        INSERT IGNORE INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes,
                                       Comments, FailureReasons)
        SELECT PlotID, CensusID,
               NULLIF(TreeTag, ''), NULLIF(StemTag, ''), NULLIF(SpeciesCode, ''), NULLIF(QuadratName, ''),
               NULLIF(LocalX, 0), NULLIF(LocalY, 0), NULLIF(DBH, 0), NULLIF(HOM, 0),
               NULLIF(MeasurementDate, '1900-01-01'), NULLIF(Codes, ''), NULLIF(Comments, ''),
               FailureReason
        FROM filter_validity WHERE Valid = false;

        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity,
            sourceRecords, processedRecords, failedRecords, missingRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
            'INVALID_REFERENCE_DATA',
            CONCAT(@invalid_count, ' records with invalid species codes or quadrat names'),
            'warning',
            vBatchRowCount, 0, @invalid_count, 0
        );

        SET vDataLossCount = vDataLossCount + @invalid_count;

        UPDATE uploadmetrics
        SET referentialIntegrityPassed = 0
        WHERE uploadId = vUploadId;
    ELSE
        UPDATE uploadmetrics
        SET referentialIntegrityPassed = 1
        WHERE uploadId = vUploadId;
    END IF;

    -- Rest of original procedure (stem categorization, tree/stem insertion, measurements)
    CREATE TEMPORARY TABLE old_trees AS
    SELECT DISTINCT f.*
    FROM filtered f
    WHERE EXISTS (SELECT 1 FROM trees t WHERE t.TreeTag = f.TreeTag AND t.CensusID < f.CensusID AND t.IsActive = 1)
      AND EXISTS (SELECT 1 FROM trees t JOIN stems s ON s.TreeID = t.TreeID
                  WHERE t.TreeTag = f.TreeTag AND s.StemTag = f.StemTag
                    AND t.CensusID < f.CensusID AND t.IsActive = 1 AND s.IsActive = 1);

    CREATE TEMPORARY TABLE multi_stems AS
    SELECT DISTINCT f.* FROM filtered f
    WHERE EXISTS (SELECT 1 FROM trees t WHERE t.TreeTag = f.TreeTag AND t.CensusID < f.CensusID AND t.IsActive = 1)
      AND NOT EXISTS (SELECT 1 FROM old_trees ot WHERE ot.id = f.id);

    CREATE TEMPORARY TABLE new_recruits AS
    SELECT DISTINCT f.* FROM filtered f
    WHERE NOT EXISTS (SELECT 1 FROM old_trees ot WHERE ot.id = f.id)
      AND NOT EXISTS (SELECT 1 FROM multi_stems ms WHERE ms.id = f.id);

    -- ================================================================
    -- CRITICAL CROSS-CENSUS VALIDATIONS
    -- These validations check consistency with previous census data
    -- ================================================================

    -- VALIDATION 1: Quadrat Change Detection (HARD FAILURE)
    -- Trees cannot physically move between quadrats between censuses
    -- NOTE: QuadratName is unique per PlotID, so we compare QuadratNames within same plot
    CREATE TEMPORARY TABLE quadrat_mismatch_failures AS
    SELECT DISTINCT f.id, f.QuadratName as CurrentQuadrat,
           prev_stem.PrevQuadratName as PrevQuadrat,
           CONCAT('Quadrat mismatch: Previous census quadrat was "', prev_stem.PrevQuadratName,
                  '", current is "', f.QuadratName,
                  '". Trees cannot change quadrats between censuses. ',
                  'Please verify TreeTag is correct or contact administrator if tree was genuinely moved.')
           as FailureReason,
           f.PlotID, f.CensusID, f.TreeTag as Tag, f.StemTag, f.SpeciesCode as SpCode,
           f.QuadratName as Quadrat, f.LocalX as X, f.LocalY as Y, f.DBH, f.HOM,
           f.MeasurementDate as Date, f.Codes, f.Comments
    FROM old_trees f
    INNER JOIN (
        -- Get most recent previous census stem with quadrat name
        SELECT t.TreeTag, s.StemTag, q.QuadratName as PrevQuadratName
        FROM stems s
        INNER JOIN trees t ON s.TreeID = t.TreeID AND s.CensusID = t.CensusID
        INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
        INNER JOIN (
            SELECT t2.TreeTag, s2.StemTag, MAX(t2.CensusID) as MaxCensusID
            FROM trees t2
            JOIN stems s2 ON s2.TreeID = t2.TreeID AND s2.CensusID = t2.CensusID
            WHERE t2.CensusID < vCurrentCensusID
              AND t2.IsActive = 1
              AND s2.IsActive = 1
            GROUP BY t2.TreeTag, s2.StemTag
        ) max_census ON t.TreeTag = max_census.TreeTag
            AND s.StemTag = max_census.StemTag
            AND t.CensusID = max_census.MaxCensusID
        WHERE t.IsActive = 1 AND s.IsActive = 1
    ) prev_stem ON prev_stem.TreeTag = f.TreeTag
        AND prev_stem.StemTag = f.StemTag
    WHERE prev_stem.PrevQuadratName != f.QuadratName;

    -- VALIDATION 2: Coordinate Drift Detection (HARD FAILURE)
    -- Flag coordinates that drift >10m within same quadrat
    -- NOTE: Compares stems with same QuadratName (quadrat names are unique per plot)
    CREATE TEMPORARY TABLE coordinate_drift_failures AS
    SELECT DISTINCT f.id,
           prev_stem.PrevX, prev_stem.PrevY,
           f.LocalX as CurrentX, f.LocalY as CurrentY,
           ROUND(SQRT(POW(f.LocalX - prev_stem.PrevX, 2) + POW(f.LocalY - prev_stem.PrevY, 2)), 2) as DriftDistance,
           CONCAT('Coordinate drift: ',
                  ROUND(SQRT(POW(f.LocalX - prev_stem.PrevX, 2) + POW(f.LocalY - prev_stem.PrevY, 2)), 2),
                  'm from previous census (>10m threshold). ',
                  'Previous: (', prev_stem.PrevX, ', ', prev_stem.PrevY, '), ',
                  'Current: (', f.LocalX, ', ', f.LocalY, '). ',
                  'Please verify coordinates or mark as approved if tree genuinely moved.')
           as FailureReason,
           f.PlotID, f.CensusID, f.TreeTag as Tag, f.StemTag, f.SpeciesCode as SpCode,
           f.QuadratName as Quadrat, f.LocalX as X, f.LocalY as Y, f.DBH, f.HOM,
           f.MeasurementDate as Date, f.Codes, f.Comments
    FROM old_trees f
    INNER JOIN (
        -- Get most recent previous census stem with same quadrat name
        SELECT t.TreeTag, s.StemTag, s.LocalX as PrevX, s.LocalY as PrevY, q.QuadratName as PrevQuadratName
        FROM stems s
        INNER JOIN trees t ON s.TreeID = t.TreeID AND s.CensusID = t.CensusID
        INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
        INNER JOIN (
            SELECT t2.TreeTag, s2.StemTag, MAX(t2.CensusID) as MaxCensusID
            FROM trees t2
            JOIN stems s2 ON s2.TreeID = t2.TreeID AND s2.CensusID = t2.CensusID
            WHERE t2.CensusID < vCurrentCensusID
              AND t2.IsActive = 1
              AND s2.IsActive = 1
              AND s2.LocalX IS NOT NULL
              AND s2.LocalY IS NOT NULL
            GROUP BY t2.TreeTag, s2.StemTag
        ) max_census ON t.TreeTag = max_census.TreeTag
            AND s.StemTag = max_census.StemTag
            AND t.CensusID = max_census.MaxCensusID
        WHERE t.IsActive = 1 AND s.IsActive = 1
    ) prev_stem ON prev_stem.TreeTag = f.TreeTag
        AND prev_stem.StemTag = f.StemTag
        AND prev_stem.PrevQuadratName = f.QuadratName  -- Same quadrat NAME
    WHERE f.LocalX IS NOT NULL
      AND f.LocalY IS NOT NULL
      AND SQRT(POW(f.LocalX - prev_stem.PrevX, 2) + POW(f.LocalY - prev_stem.PrevY, 2)) > 10.0;

    -- Move hard validation failures to failedmeasurements
    IF EXISTS(SELECT 1 FROM quadrat_mismatch_failures) OR EXISTS(SELECT 1 FROM coordinate_drift_failures) THEN
        SET @cross_census_failures = (
            SELECT COUNT(*) FROM (
                SELECT id FROM quadrat_mismatch_failures
                UNION
                SELECT id FROM coordinate_drift_failures
            ) combined
        );

        -- Insert quadrat mismatch failures
        INSERT IGNORE INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM,
                                       Date, Codes, Comments, FailureReasons)
        SELECT PlotID, CensusID,
               NULLIF(Tag, ''), NULLIF(StemTag, ''), NULLIF(SpCode, ''), NULLIF(Quadrat, ''),
               NULLIF(X, 0), NULLIF(Y, 0), NULLIF(DBH, 0), NULLIF(HOM, 0),
               NULLIF(Date, '1900-01-01'), NULLIF(Codes, ''), NULLIF(Comments, ''),
               FailureReason
        FROM quadrat_mismatch_failures;

        -- Insert coordinate drift failures
        INSERT IGNORE INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM,
                                       Date, Codes, Comments, FailureReasons)
        SELECT PlotID, CensusID,
               NULLIF(Tag, ''), NULLIF(StemTag, ''), NULLIF(SpCode, ''), NULLIF(Quadrat, ''),
               NULLIF(X, 0), NULLIF(Y, 0), NULLIF(DBH, 0), NULLIF(HOM, 0),
               NULLIF(Date, '1900-01-01'), NULLIF(Codes, ''), NULLIF(Comments, ''),
               FailureReason
        FROM coordinate_drift_failures;

        -- Alert for cross-census validation failures
        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity,
            sourceRecords, processedRecords, failedRecords, missingRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
            'CROSS_CENSUS_VALIDATION_FAILURE',
            CONCAT(@cross_census_failures, ' records failed cross-census validation (quadrat changes, coordinate drift)'),
            'error',
            vBatchRowCount, 0, @cross_census_failures, 0
        );

        SET vDataLossCount = vDataLossCount + @cross_census_failures;

        -- Remove failed records from filtered table
        DELETE FROM filtered WHERE id IN (SELECT id FROM quadrat_mismatch_failures);
        DELETE FROM filtered WHERE id IN (SELECT id FROM coordinate_drift_failures);
        DELETE FROM old_trees WHERE id IN (SELECT id FROM quadrat_mismatch_failures);
        DELETE FROM old_trees WHERE id IN (SELECT id FROM coordinate_drift_failures);
        DELETE FROM multi_stems WHERE id IN (SELECT id FROM quadrat_mismatch_failures);
        DELETE FROM multi_stems WHERE id IN (SELECT id FROM coordinate_drift_failures);
    END IF;

    DROP TEMPORARY TABLE IF EXISTS quadrat_mismatch_failures, coordinate_drift_failures;

    CREATE TEMPORARY TABLE unique_trees_to_insert AS
    SELECT DISTINCT TreeTag, SpeciesID, CensusID FROM filtered WHERE CensusID = vCurrentCensusID;

    CREATE INDEX idx_trees_insert ON unique_trees_to_insert (TreeTag, SpeciesID, CensusID);

    INSERT IGNORE INTO trees (TreeTag, SpeciesID, CensusID)
    SELECT uti.TreeTag, uti.SpeciesID, uti.CensusID
    FROM unique_trees_to_insert uti
    LEFT JOIN trees existing ON existing.TreeTag = uti.TreeTag
        AND existing.CensusID = uti.CensusID AND existing.SpeciesID = uti.SpeciesID
    WHERE existing.TreeID IS NULL;

    CREATE TEMPORARY TABLE unique_stems_to_insert AS
    SELECT DISTINCT TreeTag, QuadratID, StemTag, LocalX, LocalY, CensusID, SpeciesID
    FROM filtered WHERE CensusID = vCurrentCensusID;

    CREATE INDEX idx_stems_insert ON unique_stems_to_insert (TreeTag, SpeciesID, CensusID);

    INSERT IGNORE INTO stems (TreeID, QuadratID, CensusID, StemCrossID, StemTag, LocalX, LocalY, Moved, StemDescription, IsActive)
    SELECT t.TreeID, usi.QuadratID, vCurrentCensusID, NULL,
           CASE WHEN TRIM(COALESCE(usi.StemTag, '')) = '' THEN NULL ELSE TRIM(usi.StemTag) END,
           CASE WHEN usi.LocalX = 0 THEN NULL ELSE usi.LocalX END,
           CASE WHEN usi.LocalY = 0 THEN NULL ELSE usi.LocalY END,
           0, NULL, 1
    FROM unique_stems_to_insert usi
    INNER JOIN trees t ON t.TreeTag = usi.TreeTag AND t.SpeciesID = usi.SpeciesID
        AND t.CensusID = vCurrentCensusID AND t.IsActive = 1;

    CREATE TEMPORARY TABLE stem_crossid_mapping AS
    SELECT s_curr.StemGUID as CurrentStemID,
           COALESCE((SELECT s_prev.StemCrossID FROM stems s_prev
                     INNER JOIN trees t_prev ON s_prev.TreeID = t_prev.TreeID
                     INNER JOIN trees t_curr ON t_curr.TreeID = s_curr.TreeID
                     WHERE t_prev.TreeTag = t_curr.TreeTag AND s_prev.StemTag = s_curr.StemTag
                       AND t_prev.CensusID < vCurrentCensusID
                       AND t_prev.IsActive = 1 AND s_prev.IsActive = 1 AND s_prev.StemCrossID IS NOT NULL
                     ORDER BY t_prev.CensusID DESC LIMIT 1),
                   s_curr.StemGUID) as NewStemCrossID
    FROM stems s_curr
    WHERE s_curr.CensusID = vCurrentCensusID AND s_curr.StemCrossID IS NULL;

    CREATE INDEX idx_mapping_stemid ON stem_crossid_mapping (CurrentStemID);

    UPDATE stems s
    INNER JOIN stem_crossid_mapping scm ON s.StemGUID = scm.CurrentStemID
    SET s.StemCrossID = scm.NewStemCrossID;

    DROP TEMPORARY TABLE stem_crossid_mapping;

    INSERT IGNORE INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
                                         Description, UserDefinedFields, IsActive)
    SELECT f.CensusID, s.StemGUID, null,
           COALESCE(f.MeasurementDate, '1900-01-01'),
           CASE WHEN f.DBH = 0 THEN NULL ELSE f.DBH END,
           CASE WHEN f.HOM = 0 THEN NULL ELSE f.HOM END,
           COALESCE(f.Comments, ''),
           JSON_OBJECT(
               'treestemstate',
               CASE
                   WHEN EXISTS(SELECT 1 FROM old_trees ot WHERE ot.id = f.id) THEN 'old tree'
                   WHEN EXISTS(SELECT 1 FROM multi_stems ms WHERE ms.id = f.id) THEN 'multi stem'
                   ELSE 'new recruit'
               END,
               'uploadSession', JSON_OBJECT(
                   'fileID', vFileID,
                   'batchID', vBatchID
               )
           ), 1
    FROM filtered f
    INNER JOIN trees t ON t.TreeTag = f.TreeTag AND t.SpeciesID = f.SpeciesID
        AND t.CensusID = f.CensusID AND t.IsActive = 1
    INNER JOIN stems s ON s.TreeID = t.TreeID AND s.StemTag = f.StemTag
        AND s.QuadratID = f.QuadratID AND s.CensusID = f.CensusID AND s.IsActive = 1
    -- Idempotency check: prevent duplicate processing of the same batch
    WHERE NOT EXISTS (
        SELECT 1 FROM coremeasurements cm_check
        WHERE cm_check.StemGUID = s.StemGUID
          AND cm_check.CensusID = f.CensusID
          AND JSON_UNQUOTE(JSON_EXTRACT(cm_check.UserDefinedFields, '$.uploadSession.batchID')) = vBatchID
    );

    SET vProcessedCount = ROW_COUNT();

    UPDATE coremeasurements
    SET MeasurementDate = NULLIF(MeasurementDate, '1900-01-01'),
        MeasuredDBH = NULLIF(MeasuredDBH, 0),
        MeasuredHOM = NULLIF(MeasuredHOM, 0),
        Description = NULLIF(Description, '')
    WHERE CensusID = vCurrentCensusID;

    IF EXISTS(SELECT 1 FROM filtered WHERE Codes IS NOT NULL AND TRIM(Codes) != '') THEN
        CREATE TEMPORARY TABLE tempcodes AS
        SELECT cm.CoreMeasurementID, trim(jt.code) as Code
        FROM filtered f
        INNER JOIN trees t ON t.TreeTag = f.TreeTag AND t.SpeciesID = f.SpeciesID
            AND t.CensusID = f.CensusID AND t.IsActive = 1
        INNER JOIN stems s ON s.TreeID = t.TreeID AND s.StemTag = f.StemTag
            AND s.QuadratID = f.QuadratID AND s.CensusID = f.CensusID AND s.IsActive = 1
        INNER JOIN coremeasurements cm ON cm.StemGUID = s.StemGUID
            AND cm.CensusID = f.CensusID AND cm.IsActive = 1,
        json_table(
            if(f.Codes = '' or trim(f.Codes) = '', '[]',
               concat('["', replace(trim(f.Codes), ';', '","'), '"]')),
            '$[*]' columns (code varchar(10) COLLATE utf8mb4_0900_ai_ci path '$')
        ) jt
        WHERE f.Codes is not null AND trim(f.Codes) != '';

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

    -- =====================================================
    -- SOFT VALIDATIONS: Accept but flag in cmverrors
    -- =====================================================

    -- VALIDATION 3: Species Mismatch Detection (SOFT - Accept but Flag)
    -- TreeTag with different SpeciesID than previous census
    CREATE TEMPORARY TABLE species_mismatch_records AS
    SELECT DISTINCT cm.CoreMeasurementID,
           t.TreeTag,
           sp.SpeciesCode as CurrentSpeciesCode,
           prev_tree.PrevSpeciesID,
           sp_prev.SpeciesCode as PrevSpeciesCode
    FROM coremeasurements cm
    INNER JOIN stems s ON cm.StemGUID = s.StemGUID AND s.CensusID = vCurrentCensusID
    INNER JOIN trees t ON s.TreeID = t.TreeID AND t.CensusID = vCurrentCensusID
    INNER JOIN species sp ON t.SpeciesID = sp.SpeciesID
    INNER JOIN (
        -- Get most recent previous census for each TreeTag
        SELECT t2.TreeTag, t2.SpeciesID as PrevSpeciesID
        FROM trees t2
        INNER JOIN (
            SELECT TreeTag, MAX(CensusID) as MaxCensusID
            FROM trees
            WHERE CensusID < vCurrentCensusID
              AND IsActive = 1
            GROUP BY TreeTag
        ) max_tree ON t2.TreeTag = max_tree.TreeTag
            AND t2.CensusID = max_tree.MaxCensusID
        WHERE t2.IsActive = 1
    ) prev_tree ON prev_tree.TreeTag = t.TreeTag
        AND prev_tree.PrevSpeciesID != t.SpeciesID  -- Different species
    INNER JOIN species sp_prev ON prev_tree.PrevSpeciesID = sp_prev.SpeciesID
    WHERE cm.CensusID = vCurrentCensusID
      AND cm.IsActive = 1;

    INSERT IGNORE INTO cmverrors (CoreMeasurementID, ValidationErrorID)
    SELECT DISTINCT CoreMeasurementID, 20 as ValidationErrorID
    FROM species_mismatch_records;

    IF EXISTS(SELECT 1 FROM species_mismatch_records) THEN
        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity,
            sourceRecords, processedRecords, failedRecords, missingRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
            'SPECIES_MISMATCH',
            CONCAT((SELECT COUNT(*) FROM species_mismatch_records),
                   ' record(s) with species code different from previous census. ',
                   'Review for potential tree re-identification or data entry errors.'),
            'warning',
            vBatchRowCount, vProcessedCount, 0, 0
        );
    END IF;

    DROP TEMPORARY TABLE IF EXISTS species_mismatch_records;

    -- VALIDATION 4: Same-Batch TreeTag with Different SpeciesID (SOFT - Accept but Flag)
    -- Multiple rows in same batch with same TreeTag but different SpeciesID
    CREATE TEMPORARY TABLE same_batch_species_conflicts AS
    SELECT DISTINCT cm.CoreMeasurementID,
           t.TreeTag,
           sp.SpeciesCode as CurrentSpeciesCode,
           first_occurrence.SpeciesCode as FirstSpeciesCode
    FROM coremeasurements cm
    INNER JOIN stems s ON cm.StemGUID = s.StemGUID AND s.CensusID = vCurrentCensusID
    INNER JOIN trees t ON s.TreeID = t.TreeID AND t.CensusID = vCurrentCensusID
    INNER JOIN species sp ON t.SpeciesID = sp.SpeciesID
    INNER JOIN (
        SELECT tm1.TreeTag, tm1.SpeciesCode
        FROM temporarymeasurements tm1
        INNER JOIN (
            SELECT TreeTag, MIN(id) as first_id
            FROM temporarymeasurements
            WHERE FileID = vFileID AND BatchID = vBatchID
            GROUP BY TreeTag
        ) tm_first ON tm1.TreeTag = tm_first.TreeTag AND tm1.id = tm_first.first_id
        WHERE tm1.FileID = vFileID AND tm1.BatchID = vBatchID
    ) first_occurrence ON t.TreeTag = first_occurrence.TreeTag
    WHERE cm.CensusID = vCurrentCensusID
      AND cm.IsActive = 1
      AND sp.SpeciesCode != first_occurrence.SpeciesCode;

    INSERT IGNORE INTO cmverrors (CoreMeasurementID, ValidationErrorID)
    SELECT DISTINCT CoreMeasurementID, 21 as ValidationErrorID
    FROM same_batch_species_conflicts;

    IF EXISTS(SELECT 1 FROM same_batch_species_conflicts) THEN
        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity,
            sourceRecords, processedRecords, failedRecords, missingRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
            'SAME_BATCH_SPECIES_CONFLICT',
            CONCAT((SELECT COUNT(*) FROM same_batch_species_conflicts),
                   ' record(s) with same TreeTag but different species codes within same batch. ',
                   'First occurrence was treated as correct.'),
            'warning',
            vBatchRowCount, vProcessedCount, 0, 0
        );
    END IF;

    DROP TEMPORARY TABLE IF EXISTS same_batch_species_conflicts;

    -- =====================================================
    -- ENHANCEMENT: Data Quality Warnings (Info-level)
    -- =====================================================

    -- Warning 1: Same-date measurements with different DBH values
    -- This could indicate: (A) remeasurement correction, or (B) data entry error
    INSERT IGNORE INTO uploadintegrityalerts (
        uploadId, fileID, batchID, plotID, censusID,
        type, message, severity,
        sourceRecords, processedRecords, failedRecords, missingRecords
    )
    SELECT vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
           'MULTIPLE_DBH_SAME_DATE',
           CONCAT('Found ', COUNT(DISTINCT dups.TreeTag), ' tree(s) with multiple measurements on same date with different DBH values'),
           'info',
           vBatchRowCount, vProcessedCount, 0, 0
    FROM (
        SELECT t.TreeTag, s.StemTag, cm.MeasurementDate, COUNT(DISTINCT cm.MeasuredDBH) as dbh_count
        FROM coremeasurements cm
        JOIN stems s ON cm.StemGUID = s.StemGUID AND s.IsActive = 1
        JOIN trees t ON s.TreeID = t.TreeID AND t.IsActive = 1
        WHERE cm.CensusID = vCurrentCensusID
          AND cm.MeasurementDate IS NOT NULL
          AND cm.MeasuredDBH IS NOT NULL
        GROUP BY t.TreeTag, s.StemTag, cm.MeasurementDate
        HAVING dbh_count > 1
    ) dups
    HAVING COUNT(DISTINCT dups.TreeTag) > 0;

    -- Warning 2: Future dates (>10 years from now)
    -- Could indicate typos (e.g., 2002 → 2202)
    INSERT IGNORE INTO uploadintegrityalerts (
        uploadId, fileID, batchID, plotID, censusID,
        type, message, severity,
        sourceRecords, processedRecords, failedRecords, missingRecords
    )
    SELECT vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
           'FUTURE_DATE_WARNING',
           CONCAT('Found ', COUNT(*), ' measurement(s) with dates more than 10 years in the future'),
           'info',
           vBatchRowCount, vProcessedCount, 0, 0
    FROM coremeasurements cm
    WHERE cm.CensusID = vCurrentCensusID
      AND cm.MeasurementDate > DATE_ADD(NOW(), INTERVAL 10 YEAR)
    HAVING COUNT(*) > 0;

    -- Warning 3: Extreme growth rates (>10 cm/year DBH increase)
    -- Detect unusually high growth rates that may indicate data entry errors
    INSERT IGNORE INTO uploadintegrityalerts (
        uploadId, fileID, batchID, plotID, censusID,
        type, message, severity,
        sourceRecords, processedRecords, failedRecords, missingRecords
    )
    SELECT vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
           'EXTREME_GROWTH_RATE',
           CONCAT('Found ', COUNT(*), ' measurement(s) with extreme growth rates (>10 cm/year DBH increase)'),
           'info',
           vBatchRowCount, vProcessedCount, 0, 0
    FROM (
        SELECT curr.CoreMeasurementID,
               (curr.MeasuredDBH - prev.MeasuredDBH) / NULLIF(DATEDIFF(curr.MeasurementDate, prev.MeasurementDate) / 365.25, 0) as growth_rate
        FROM coremeasurements curr
        JOIN coremeasurements prev ON curr.StemGUID = prev.StemGUID
            AND prev.CensusID < vCurrentCensusID
            AND prev.MeasurementDate < curr.MeasurementDate
            AND prev.MeasuredDBH IS NOT NULL
        WHERE curr.CensusID = vCurrentCensusID
          AND curr.MeasuredDBH IS NOT NULL
          AND curr.MeasurementDate IS NOT NULL
        ORDER BY curr.StemGUID, prev.MeasurementDate DESC
    ) growth
    WHERE growth.growth_rate > 10
    HAVING COUNT(*) > 0;

    DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, filter_validity, filtered, validation_failures,
        old_trees, multi_stems, new_recruits, unique_trees_to_insert, unique_stems_to_insert, tempcodes,
        stem_crossid_mapping, pre_insert_check;

    DELETE FROM temporarymeasurements WHERE FileID = vFileID AND BatchID = vBatchID;

    -- Final metrics update
    UPDATE uploadmetrics
    SET processedRecords = vProcessedCount,
        failedRecords = vDataLossCount,
        missingRecords = 0,
        dataLossDetected = IF(vDataLossCount > 0, 1, 0),
        status = 'completed',
        endTime = NOW()
    WHERE uploadId = vUploadId;

    SET @disable_triggers = 0;

    IF vDataLossCount > 0 THEN
        SELECT CONCAT('Batch ', vBatchID, ' processed: ', vProcessedCount, ' valid, ',
                      vDataLossCount, ' failed (see failedmeasurements and uploadintegrityalerts)') as message,
               FALSE as batch_failed, vDataLossCount as records_failed;
    ELSE
        SELECT CONCAT('Batch ', vBatchID, ' processed successfully: ', vProcessedCount, ' records') as message,
               FALSE as batch_failed, 0 as records_failed;
    END IF;
END ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;

-- Dump completed on 2025-11-29  9:21:52
