-- =====================================================================================
-- Migration 2026-07-29-02: repair the PublishedStemID storage contract
-- =====================================================================================
-- stems.PublishedStemID, its lookup index, and coremeasurements.RawPublishedStemID
-- were introduced in db/sql/tablestructures.sql, so every schema provisioned from
-- the current canonical DDL already has them. Schemas provisioned from an older
-- deployment of the app do not, and no manifest migration added them — the only
-- script that did (unified-measurements-migrations/60_add_published_stemid.sql) is
-- run by hand and is not part of the deploy-time manifest. A newly provisioned site
-- therefore failed the schema-contract gate and blocked every dev deployment.
--
-- bulkingestionprocess reads stems.PublishedStemID directly, so a schema missing
-- these columns cannot receive the ingestion procedures either.
--
-- Additive and nullable: ADD COLUMN on InnoDB runs in-place and permits concurrent
-- DML, existing rows get NULL (correct for "no SI-assigned ID recorded"), and the
-- information_schema guards make every step a no-op on schemas that already
-- migrated.

-- stems.PublishedStemID
SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stems'
      AND COLUMN_NAME = 'PublishedStemID'
);
SET @ddl := IF(@col_exists > 0,
    'SELECT ''stems.PublishedStemID already present'' AS Status',
    'ALTER TABLE `stems` ADD COLUMN `PublishedStemID` int unsigned NULL'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- stems.idx_stems_publishedstemid
SET @idx_exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stems'
      AND INDEX_NAME = 'idx_stems_publishedstemid'
);
SET @ddl := IF(@idx_exists > 0,
    'SELECT ''stems.idx_stems_publishedstemid already present'' AS Status',
    'CREATE INDEX `idx_stems_publishedstemid` ON `stems` (`PublishedStemID`)'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- coremeasurements.RawPublishedStemID
SET @col_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'coremeasurements'
      AND COLUMN_NAME = 'RawPublishedStemID'
);
SET @ddl := IF(@col_exists > 0,
    'SELECT ''coremeasurements.RawPublishedStemID already present'' AS Status',
    'ALTER TABLE `coremeasurements` ADD COLUMN `RawPublishedStemID` int unsigned NULL'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The conflict code the ingestion procedure writes for these columns must exist in
-- the error catalog, or PublishedStemID conflicts are recorded against nothing.
INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
VALUES ('ingestion', 'PUBLISHED_STEMID_CONFLICT', 'Uploaded PublishedStemID conflicts with an existing stem identity');

SELECT 'Migration 2026-07-29-02 complete: PublishedStemID storage columns, index, and conflict error seed ensured.' AS Status;
