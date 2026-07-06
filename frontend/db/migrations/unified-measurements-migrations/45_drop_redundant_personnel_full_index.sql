-- =====================================================================================
-- Migration Script 45: Drop redundant uq_personnel_full signature index
-- =====================================================================================
-- Purpose:
--   The personnel table currently has two unique constraints:
--
--     personnel_FirstName_LastName_RoleID__uindex  -- (FirstName, LastName, IsActive)
--     uq_personnel_full                            -- (unique_sig generated column,
--                                                     concatenating ~all metadata)
--
--   The named index already enforces uniqueness on the semantic key. The signature
--   index is the same anti-pattern that produced the species and quadrats fan-out
--   bugs: any difference in any concatenated metadata field is treated as a new
--   "distinct" personnel record, even when FirstName and LastName match. Keeping
--   it around invites the same class of failure for personnel as we just fixed
--   for species and quadrats.
--
--   Cross-schema audit: every schema has the index, zero schemas have personnel
--   duplicates by (FirstName, LastName), so dropping the signature index is safe.
--
--   Idempotent via the conditional drop pattern.
-- =====================================================================================

SET @idx_exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'personnel'
      AND INDEX_NAME   = 'uq_personnel_full'
);

SET @ddl := IF(@idx_exists > 0,
    'ALTER TABLE personnel DROP INDEX uq_personnel_full',
    'SELECT ''uq_personnel_full already absent'' AS Status'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- The generated unique_sig column itself is left in place: dropping it would
-- require a separate ALTER and migrating any code that references it. The column
-- is INVISIBLE and unused outside the dropped index, so leaving it costs nothing
-- but a small amount of storage.

SELECT 'Migration 45 complete: uq_personnel_full ensured absent.' AS Status;
