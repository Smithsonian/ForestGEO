-- =====================================================================================
-- Migration Script 20: Migrate legacy failedmeasurements/cmverrors into unified model
-- =====================================================================================
-- Purpose:
--   - Move failedmeasurements rows into unresolved coremeasurements rows
--   - Convert failedmeasurements reason text into measurement_error_log ingestion links
--   - Convert cmverrors rows into measurement_error_log validation links
-- =====================================================================================

SET @schema = DATABASE();
SET @migrated_failed_rows = 0;
SET @linked_failed_errors = 0;
SET @migrated_cmv_rows = 0;

SELECT COUNT(*) INTO @has_failedmeasurements
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'failedmeasurements';

SET @sql = IF(
    @has_failedmeasurements = 1,
    'INSERT INTO coremeasurements
      (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description,
       UploadFileID, UploadBatchID, RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY,
       RawCodes, RawComments, SourceRowIndex, IsActive)
     SELECT fm.CensusID,
            NULL,
            FALSE,
            fm.Date,
            fm.DBH,
            fm.HOM,
            LEFT(COALESCE(fm.FailureReasons, ''Legacy failed measurement''), 255),
            fm.FileID,
            fm.BatchID,
            fm.Tag,
            fm.StemTag,
            fm.SpCode,
            fm.Quadrat,
            fm.X,
            fm.Y,
            fm.Codes,
            fm.Comments,
            fm.FailedMeasurementID,
            1
     FROM failedmeasurements fm
     WHERE NOT EXISTS (
         SELECT 1
         FROM coremeasurements cm
         WHERE cm.UploadFileID <=> fm.FileID
           AND cm.UploadBatchID <=> fm.BatchID
           AND cm.SourceRowIndex <=> fm.FailedMeasurementID
           AND cm.StemGUID IS NULL
     )',
    'SELECT ''failedmeasurements table not found; skipped failed row migration'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
SET @migrated_failed_rows = ROW_COUNT();
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    @has_failedmeasurements = 1,
    'INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
     SELECT cm.CoreMeasurementID,
            me.ErrorID,
            FALSE
     FROM failedmeasurements fm
              JOIN coremeasurements cm
                   ON cm.UploadFileID <=> fm.FileID
                       AND cm.UploadBatchID <=> fm.BatchID
                       AND cm.SourceRowIndex <=> fm.FailedMeasurementID
                       AND cm.StemGUID IS NULL
              JOIN measurement_errors me
                   ON me.ErrorSource = ''ingestion''
                       AND me.ErrorCode = CASE
                                              WHEN LOWER(COALESCE(fm.FailureReasons, '''')) LIKE ''%missing required field: treetag%''
                                                  THEN ''MISSING_FIELD_TREETAG''
                                              WHEN LOWER(COALESCE(fm.FailureReasons, '''')) LIKE ''%missing required field: stemtag%''
                                                  THEN ''MISSING_FIELD_STEMTAG''
                                              WHEN LOWER(COALESCE(fm.FailureReasons, '''')) LIKE ''%invalid quadrat%''
                                                   OR LOWER(COALESCE(fm.FailureReasons, '''')) LIKE ''%quadrat name%''
                                                  THEN ''INVALID_QUADRAT''
                                              WHEN LOWER(COALESCE(fm.FailureReasons, '''')) LIKE ''%invalid species%''
                                                   OR LOWER(COALESCE(fm.FailureReasons, '''')) LIKE ''%species code%''
                                                  THEN ''INVALID_SPECIES''
                                              WHEN LOWER(COALESCE(fm.FailureReasons, '''')) LIKE ''%quadrat mismatch%''
                                                  THEN ''QUADRAT_MISMATCH''
                                              WHEN LOWER(COALESCE(fm.FailureReasons, '''')) LIKE ''%coordinate drift%''
                                                  THEN ''COORDINATE_DRIFT''
                                              WHEN LOWER(COALESCE(fm.FailureReasons, '''')) LIKE ''%duplicate%''
                                                  THEN ''DUPLICATE_ENTRY''
                                              WHEN LOWER(COALESCE(fm.FailureReasons, '''')) LIKE ''%invalid dbh%''
                                                   OR LOWER(COALESCE(fm.FailureReasons, '''')) LIKE ''%negative dbh%''
                                                  THEN ''NEGATIVE_DBH''
                                              WHEN LOWER(COALESCE(fm.FailureReasons, '''')) LIKE ''%invalid hom%''
                                                   OR LOWER(COALESCE(fm.FailureReasons, '''')) LIKE ''%negative hom%''
                                                  THEN ''NEGATIVE_HOM''
                                              WHEN LOWER(COALESCE(fm.FailureReasons, '''')) LIKE ''%exceeds maximum length%''
                                                   OR LOWER(COALESCE(fm.FailureReasons, '''')) LIKE ''%field too long%''
                                                  THEN ''FIELD_TOO_LONG''
                                              WHEN LOWER(COALESCE(fm.FailureReasons, '''')) LIKE ''%missing measurement data%''
                                                  THEN ''MISSING_MEASUREMENT_DATA''
                                              ELSE ''SQL_EXCEPTION''
                        END',
    'SELECT ''failedmeasurements table not found; skipped ingestion error log migration'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
SET @linked_failed_errors = ROW_COUNT();
DEALLOCATE PREPARE stmt;

SELECT COUNT(*) INTO @has_cmverrors
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'cmverrors';

SET @sql = IF(
    @has_cmverrors = 1,
    'INSERT INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
     SELECT DISTINCT ''validation'',
                     CAST(cmv.ValidationErrorID AS CHAR),
                     CONCAT(''Validation '', cmv.ValidationErrorID, '' flagged this row'')
     FROM cmverrors cmv
     WHERE cmv.ValidationErrorID IS NOT NULL
     ON DUPLICATE KEY UPDATE ErrorMessage = measurement_errors.ErrorMessage',
    'SELECT ''cmverrors table not found; skipped validation error seed from cmverrors'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    @has_cmverrors = 1,
    'INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
     SELECT cmv.CoreMeasurementID,
            me.ErrorID,
            FALSE
     FROM cmverrors cmv
              JOIN measurement_errors me
                   ON me.ErrorSource = ''validation''
                       AND me.ErrorCode = CAST(cmv.ValidationErrorID AS CHAR)
     WHERE cmv.CoreMeasurementID IS NOT NULL
       AND cmv.ValidationErrorID IS NOT NULL',
    'SELECT ''cmverrors table not found; skipped cmverrors migration'' AS Status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
SET @migrated_cmv_rows = ROW_COUNT();
DEALLOCATE PREPARE stmt;

SELECT CONCAT('Migration 20 complete: failed rows inserted=', @migrated_failed_rows,
              ', failed errors linked=', @linked_failed_errors,
              ', cmverrors linked=', @migrated_cmv_rows) AS Status;
