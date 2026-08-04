-- =====================================================================================
-- Migration 2026-08-04-02: plots.GlobalCoordinatesEPSG
-- =====================================================================================
-- GlobalX/GlobalY/GlobalZ carry a bare number with no record of the coordinate
-- reference system it was measured in. Live schemas already disagree: legacy
-- CTFS-derived sites store lon/lat decimal degrees, while newly provisioned
-- sites are entered as projected meters (forestgeo_ldw's origin is NAD83 / UTM
-- zone 16N). A bare 567225 is uninterpretable without the zone and datum, and
-- the cross-census location validations silently assume a linear system.
--
-- This column records the EPSG identifier of the system the global coordinates
-- are expressed in (26916 = NAD83 / UTM zone 16N, 4326 = WGS 84 lon/lat).
-- NULL means "not recorded", the honest answer for every pre-existing row until
-- each site's system is confirmed and backfilled.

SET @table_exists := (
    SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'plots'
);
SET @column_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'plots'
      AND COLUMN_NAME = 'GlobalCoordinatesEPSG'
);
SET @ddl := IF(@table_exists = 0,
    'SELECT ''plots does not exist in this schema; nothing to add'' AS Status',
    IF(@column_exists > 0,
        'SELECT ''plots.GlobalCoordinatesEPSG already present'' AS Status',
        'ALTER TABLE `plots` ADD COLUMN `GlobalCoordinatesEPSG` INT UNSIGNED NULL AFTER `GlobalZ`'
    )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 2026-08-04-02 complete: plots.GlobalCoordinatesEPSG ensured.' AS Status;
