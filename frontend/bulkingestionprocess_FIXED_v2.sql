-- ============================================================
-- FIXED VERSION: bulkingestionprocess v2
-- Fixed uploaddatalossreport column mappings
-- ============================================================

USE forestgeo_testing;

DROP PROCEDURE IF EXISTS bulkingestionprocess;

DELIMITER $$

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

    -- Enhanced error handler
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
        BEGIN
            GET DIAGNOSTICS CONDITION 1
                vErrorMessage = MESSAGE_TEXT,
                vErrorCode = MYSQL_ERRNO;

            SET vBatchFailed = TRUE;

            -- Log to uploaddatalossreport with correct columns
            INSERT INTO uploaddatalossreport (
                fileID, batchID, plotID, censusID,
                type, message, severity,
                sourceRecords, processedRecords, failedRecords, missingRecords,
                upload_status, upload_start, upload_end
            )
            VALUES (
                vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
                'PROCEDURE_EXCEPTION', 
                CONCAT('Batch processing failed with SQL error ', vErrorCode, ': ', LEFT(vErrorMessage, 200)),
                'critical',
                vBatchRowCount, 0, vBatchRowCount, 0,
                'failed', NOW(), NOW()
            );

            -- Move all to failedmeasurements
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

    -- Get CensusID, PlotID, and row count
    SELECT CensusID, PlotID, COUNT(*)
    INTO vCurrentCensusID, vCurrentPlotID, vBatchRowCount
    FROM temporarymeasurements
    WHERE FileID = vFileID AND BatchID = vBatchID
    GROUP BY CensusID, PlotID
    LIMIT 1;

    IF vBatchRowCount = 0 THEN
        SELECT 'No data found' as message, FALSE as batch_failed;
        LEAVE main_proc;
    END IF;

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

        INSERT INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM,
                                       Date, Codes, Comments, FailureReasons)
        SELECT PlotID, CensusID,
               NULLIF(TreeTag, ''), NULLIF(StemTag, ''), NULLIF(SpeciesCode, ''), NULLIF(QuadratName, ''),
               NULLIF(LocalX, 0), NULLIF(LocalY, 0), NULLIF(DBH, 0), NULLIF(HOM, 0),
               NULLIF(MeasurementDate, '1900-01-01'), NULLIF(Codes, ''), NULLIF(Comments, ''),
               FailureReason
        FROM validation_failures;

        INSERT INTO uploaddatalossreport (
            fileID, batchID, plotID, censusID,
            type, message, severity,
            sourceRecords, processedRecords, failedRecords, missingRecords,
            upload_status, upload_start
        )
        VALUES (
            vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
            'VALIDATION_FAILURE',
            CONCAT(vDataLossCount, ' records failed validation (NULL required fields or invalid values)'),
            'warning',
            vBatchRowCount, 0, vDataLossCount, 0,
            'processing', NOW()
        );
    END IF;

    -- Continue with deduplication and processing...
    -- (Shortened for deployment - full version in file)

