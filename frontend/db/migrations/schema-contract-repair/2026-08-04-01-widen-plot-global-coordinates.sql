-- =====================================================================================
-- Migration 2026-08-04-01: widen global plot coordinates to DECIMAL(15,6)
-- =====================================================================================
-- Provisioning run 5 (forestgeo_ldw, 2026-08-04) failed at insert_plot with
-- "Out of range value for column 'GlobalY' at row 1". The admin entered the plot
-- origin as NAD83 / UTM zone 16N meters (567225 E, 4343000 N) — the correct kind
-- of value, since the cross-census location validations do linear arithmetic on
-- these columns (LocalX + StartX + GlobalX) — but a UTM northing cannot fit
-- DECIMAL(12,6)'s ±999,999.999999 ceiling, and viewfulltable's DECIMAL(10,6)
-- copies cannot even hold a UTM easting.
--
-- DECIMAL(15,6) because southern-hemisphere UTM northings reach exactly
-- 10,000,000 m (8 integer digits), and 9 integer digits store in the same
-- 7 bytes as 8. Widening DECIMAL precision is lossless for every stored value.

SET @plots_exists := (
    SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'plots'
);
SET @plots_narrow := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'plots'
      AND COLUMN_NAME IN ('GlobalX', 'GlobalY', 'GlobalZ')
      AND COLUMN_TYPE <> 'decimal(15,6)'
);
SET @ddl := IF(@plots_exists = 0,
    'SELECT ''plots does not exist in this schema; nothing to widen'' AS Status',
    IF(@plots_narrow = 0,
        'SELECT ''plots.GlobalX/GlobalY/GlobalZ already DECIMAL(15,6)'' AS Status',
        'ALTER TABLE `plots`
             MODIFY COLUMN `GlobalX` DECIMAL(15,6) NULL,
             MODIFY COLUMN `GlobalY` DECIMAL(15,6) NULL,
             MODIFY COLUMN `GlobalZ` DECIMAL(15,6) NULL'
    )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @vft_exists := (
    SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'viewfulltable'
);
SET @vft_narrow := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'viewfulltable'
      AND COLUMN_NAME IN ('PlotGlobalX', 'PlotGlobalY', 'PlotGlobalZ')
      AND COLUMN_TYPE <> 'decimal(15,6)'
);
SET @ddl := IF(@vft_exists = 0,
    'SELECT ''viewfulltable does not exist in this schema; nothing to widen'' AS Status',
    IF(@vft_narrow = 0,
        'SELECT ''viewfulltable.PlotGlobalX/PlotGlobalY/PlotGlobalZ already DECIMAL(15,6)'' AS Status',
        'ALTER TABLE `viewfulltable`
             MODIFY COLUMN `PlotGlobalX` DECIMAL(15,6) NULL,
             MODIFY COLUMN `PlotGlobalY` DECIMAL(15,6) NULL,
             MODIFY COLUMN `PlotGlobalZ` DECIMAL(15,6) NULL'
    )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 2026-08-04-01 complete: global plot coordinates widened to DECIMAL(15,6).' AS Status;
