-- =====================================================================================
-- ROLLBACK for migration 2026-10-28-01 (coremeasurements index trim, issue #560)
-- =====================================================================================
-- Hand-run, one schema at a time. NOT listed in db/migrations/manifest.ts, so it stays
-- editable and no deploy ever runs it.
--
-- Recreates whichever of the five canonical indexes the migration dropped is missing:
--   idx_stemid                    (StemGUID)
--   idx_cm_stem_cid_date_dbh_hom  (StemGUID, CensusID, MeasurementDate, MeasuredDBH, MeasuredHOM)
--   idx_description               (Description)
--   idx_measurementdate           (MeasurementDate)
--   idx_cm_census_active          (CensusID, IsActive)
-- It does not recreate the three CTFS-script extras (idx_coremeasurements_census_plot,
-- idx_coremeasurements_census_plot_validation, idx_coremeasurements_census_validation):
-- each duplicates an index that stays. Idempotent: with nothing missing it runs DO 0.
--
-- Procedure
-- 1. Check that no upload is running on the schema:
--      SELECT session_id, state, last_heartbeat FROM upload_sessions
--      WHERE state IN ('initialized', 'uploading', 'uploaded', 'processing', 'collapsing');
--    The ALTER needs a brief exclusive metadata lock on coremeasurements, and every new
--    statement on the table queues behind it while it waits.
-- 2. Run it per schema:   mysql -h <host> -u <user> -p <schema> < <this file>
--    The five indexes are built online in place (ALGORITHM=INPLACE, LOCK=NONE): seconds
--    per index at Mpala size, concurrent DML continues, and the online log is capped by
--    innodb_online_alter_log_max_size (128 MiB on Azure).
-- 3. The first two statements cap this session lock waits at 60 s, the bound the
--    migration runner uses, without loosening a tighter value already set.
--    On ERROR 1205 (Lock wait timeout exceeded) nothing changed: the ALTER is atomic.
--    Find the holder:
--      SELECT ml.LOCK_TYPE, ml.LOCK_STATUS, t.PROCESSLIST_ID, t.PROCESSLIST_INFO
--      FROM performance_schema.metadata_locks ml
--      JOIN performance_schema.threads t ON t.THREAD_ID = ml.OWNER_THREAD_ID
--      WHERE ml.OBJECT_SCHEMA = '<schema>' AND ml.OBJECT_NAME = 'coremeasurements';
--    Wait for it to finish (never kill an application session without the agreement of
--    its owner) and re-run. After a partial multi-schema pass a re-run only touches the
--    schemas still missing an index.
-- 4. Revert the issue #560 changes to tablestructures.sql, lib/db/schema-contract.ts and
--    unified-measurements-migrations/62_trim_coremeasurements_redundant_indexes.sql in a
--    PR, so new sites provision the old set and the hand-run runners stop re-trimming.
-- 5. Leave the schema_migrations row 2026-10-28-01 as applied: the migration never
--    re-runs. Trimming again later needs a new migration id.
SET SESSION lock_wait_timeout = CAST(LEAST(@@SESSION.lock_wait_timeout, 60) AS UNSIGNED);
SET SESSION innodb_lock_wait_timeout = CAST(LEAST(@@SESSION.innodb_lock_wait_timeout, 60) AS UNSIGNED);
SET @create_clauses := (
  SELECT GROUP_CONCAT(CONCAT('ADD INDEX `', wanted.index_name, '` (', wanted.columns_sql, ')') ORDER BY wanted.index_name SEPARATOR ', ')
  FROM (
    SELECT 'idx_stemid' AS index_name, '`StemGUID`' AS columns_sql
    UNION ALL SELECT 'idx_cm_stem_cid_date_dbh_hom', '`StemGUID`, `CensusID`, `MeasurementDate`, `MeasuredDBH`, `MeasuredHOM`'
    UNION ALL SELECT 'idx_description', '`Description`'
    UNION ALL SELECT 'idx_measurementdate', '`MeasurementDate`'
    UNION ALL SELECT 'idx_cm_census_active', '`CensusID`, `IsActive`'
  ) wanted
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS st WHERE st.TABLE_SCHEMA = DATABASE() AND st.TABLE_NAME = 'coremeasurements' AND st.INDEX_NAME = wanted.index_name)
);
SET @sql := IF(@create_clauses IS NULL, 'DO 0', CONCAT('ALTER TABLE `coremeasurements` ', @create_clauses, ', ALGORITHM=INPLACE, LOCK=NONE'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SELECT 'Rollback 2026-10-28-01 complete: the five dropped coremeasurements indexes are present.' AS Status;
