-- =====================================================================================
-- Migration Script 44: Make stems.StemTag NOT NULL DEFAULT ''
-- =====================================================================================
-- Purpose:
--   The stems table has a unique constraint ux_stems_treeid_stemtag_census on
--   (TreeID, StemTag, CensusID). MySQL UNIQUE treats NULL as distinct, so multiple
--   stems on the same tree at the same census with StemTag IS NULL would slip past
--   the constraint. Empty string '' on the other hand is a real value and DOES
--   collide in UNIQUE indexes, so the constraint is fully effective for empty
--   strings.
--
--   Cross-schema audit: zero rows currently have NULL or empty StemTag in any
--   schema. The closest existing convention is the literal '0' used at Ngel Nyaki
--   for untagged stems. So this migration is purely a forward-looking guard:
--   convert any future NULLs to '' and forbid them at the column level so the
--   uniqueness constraint can never be silently bypassed.
--
--   Idempotent via the conditional ALTER pattern.
-- =====================================================================================

-- Defensive backfill: convert any NULLs to empty string before the NOT NULL conversion.
-- The audit shows zero rows match this filter today, but we run it anyway in case the
-- migration is applied to a future schema where state has drifted.
UPDATE stems SET StemTag = '' WHERE StemTag IS NULL;

SET @col_nullable := (
    SELECT IS_NULLABLE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'stems'
      AND COLUMN_NAME  = 'StemTag'
);

SET @ddl := IF(@col_nullable = 'YES',
    'ALTER TABLE stems MODIFY COLUMN StemTag VARCHAR(10) NOT NULL DEFAULT ''''',
    'SELECT ''stems.StemTag already NOT NULL'' AS Status'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 44 complete: stems.StemTag is NOT NULL DEFAULT ''''.' AS Status;
