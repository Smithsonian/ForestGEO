-- =====================================================================================
-- Migration 2026-08-07-01: viewfulltable.StemID -> StemGUID
-- =====================================================================================
-- The 2025-09-04 identity rename (StemID => StemGUID, StemNumber => StemCrossID,
-- commit 615e83da) updated the canonical DDL and the application code, but no
-- migration carried live viewfulltable caches through the rename. Three schemas
-- kept the pre-rename column (forestgeo_panama, forestgeo_mpala, forestgeo_serc;
-- panama was created by the ctfs-migrations tooling AFTER the rename and inherited
-- the stale shape from its target schema rather than the canonical DDL).
--
-- The drift was latent until 2026-04 (3f92e448 / 3003f4b6), when app-side refresh
-- SQL in lib/measurementviewrefresh.ts began writing viewfulltable by explicit
-- column list after every single-row measurement edit. On the drifted schemas that
-- INSERT fails with "Unknown column 'StemGUID' in 'field list'" (42S22), aborting
-- the apply transaction — every measurement edit rolls back and is silently
-- discarded (measured on forestgeo_panama cocoli, 2026-08-07).
--
-- RENAME COLUMN is a metadata-only ALTER in MySQL 8: instant, and it preserves the
-- cached rows, so no scope refresh is needed afterwards. A full column-name diff
-- against the canonical DDL confirmed StemID/StemGUID is the ONLY viewfulltable
-- drift on the three schemas (measured 2026-08-07), so a targeted rename restores
-- the canonical shape exactly.
--
-- Legacy source dumps (stable_*) also carry a StemID column, but that is the
-- historical CTFS export shape, not drift — this migration only runs against
-- forestgeo_* schemas via the apply-schema-migrations runner, and only when the
-- old column is actually present.

SET @vft_exists := (
    SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'viewfulltable'
);
SET @old_column_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'viewfulltable'
      AND COLUMN_NAME = 'StemID'
);
SET @new_column_exists := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'viewfulltable'
      AND COLUMN_NAME = 'StemGUID'
);
SET @ddl := IF(@vft_exists = 0,
    'SELECT ''viewfulltable does not exist in this schema; nothing to rename'' AS Status',
    IF(@new_column_exists > 0,
        'SELECT ''viewfulltable.StemGUID already present'' AS Status',
        IF(@old_column_exists = 0,
            'SELECT ''viewfulltable has neither StemID nor StemGUID; refusing to guess'' AS Status',
            'ALTER TABLE `viewfulltable` RENAME COLUMN `StemID` TO `StemGUID`'
        )
    )
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 2026-08-07-01 complete: viewfulltable stem column matches canonical StemGUID.' AS Status;
