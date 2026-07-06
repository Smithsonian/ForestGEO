-- =====================================================================================
-- Migration Script 26: Backfill coremeasurements upload tracking columns
-- =====================================================================================
-- Purpose:
--   - Normalize legacy successful rows that only carry upload metadata inside
--     UserDefinedFields.uploadSession.*
--   - Make UploadFileID / UploadBatchID the consistent source of truth for
--     verification, idempotency, and retry flows
--   - Report any rows that still have uploadSession metadata but incomplete or
--     conflicting direct upload tracking columns after the backfill
-- =====================================================================================

SET @schema = DATABASE();

UPDATE coremeasurements
SET UploadFileID = COALESCE(
        UploadFileID,
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(UserDefinedFields, '$.uploadSession.fileID')), 'null')
    ),
    UploadBatchID = COALESCE(
        UploadBatchID,
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(UserDefinedFields, '$.uploadSession.batchID')), 'null')
    )
WHERE JSON_EXTRACT(UserDefinedFields, '$.uploadSession') IS NOT NULL
  AND (UploadFileID IS NULL OR UploadBatchID IS NULL);

SET @backfilled_rows = ROW_COUNT();

SELECT COUNT(*) INTO @remaining_rows_with_metadata_gaps
FROM coremeasurements
WHERE JSON_EXTRACT(UserDefinedFields, '$.uploadSession') IS NOT NULL
  AND (UploadFileID IS NULL OR UploadBatchID IS NULL);

SELECT COUNT(*) INTO @remaining_successful_rows_with_metadata_gaps
FROM coremeasurements
WHERE StemGUID IS NOT NULL
  AND JSON_EXTRACT(UserDefinedFields, '$.uploadSession') IS NOT NULL
  AND (UploadFileID IS NULL OR UploadBatchID IS NULL);

SELECT COUNT(*) INTO @conflicting_rows
FROM coremeasurements
WHERE JSON_EXTRACT(UserDefinedFields, '$.uploadSession') IS NOT NULL
  AND (
      (UploadFileID IS NOT NULL
       AND UploadFileID <> NULLIF(JSON_UNQUOTE(JSON_EXTRACT(UserDefinedFields, '$.uploadSession.fileID')), 'null'))
      OR
      (UploadBatchID IS NOT NULL
       AND UploadBatchID <> NULLIF(JSON_UNQUOTE(JSON_EXTRACT(UserDefinedFields, '$.uploadSession.batchID')), 'null'))
  );

SELECT
    @backfilled_rows AS backfilled_rows,
    @remaining_rows_with_metadata_gaps AS remaining_rows_with_metadata_gaps,
    @remaining_successful_rows_with_metadata_gaps AS remaining_successful_rows_with_metadata_gaps,
    @conflicting_rows AS conflicting_rows,
    CASE
        WHEN @remaining_successful_rows_with_metadata_gaps = 0 AND @conflicting_rows = 0
            THEN 'Migration 26 complete: coremeasurements upload tracking columns normalized.'
        ELSE CONCAT(
            'Migration 26 warning: ',
            @remaining_successful_rows_with_metadata_gaps,
            ' successful row(s) still have incomplete upload tracking columns and ',
            @conflicting_rows,
            ' row(s) have conflicting direct-vs-JSON upload metadata.'
        )
    END AS Status;
