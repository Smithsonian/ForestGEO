-- =====================================================================================
-- Migration Script 46: Add UNIQUE (SpeciesCode, IsActive) to species
-- =====================================================================================
-- Purpose:
--   The species table currently relies on uq_species_sig (a generated column
--   concatenating SpeciesCode + SpeciesName + SubspeciesName + IDLevel +
--   SpeciesAuthority + SubspeciesAuthority + FieldFamily + Description) for
--   uniqueness. Any difference in any of those eight fields produces a "different"
--   species, which is exactly how the Ngel Nyaki incident occurred: a re-uploaded
--   species list with mangled SpeciesAuthority text (every period replaced with
--   the literal characters "N/A") slipped past the constraint and created a full
--   second copy of the list under different SpeciesIDs. Downstream lookups in
--   bulkingestionprocess then fanned every measurement out across two species,
--   causing ~48,000 measurement failures with the inscrutable "source row resolved
--   to multiple candidate measurements" error.
--
--   This migration installs a tighter constraint matching the genus and roles
--   pattern: UNIQUE (SpeciesCode, IsActive). At most one IsActive=1 row per code
--   can exist at any time, which is what the bulk ingestion resolver actually
--   assumes.
--
--   If pre-existing duplicates would block the constraint, the ALTER will fail
--   with MySQL's native ERROR 1062 ("Duplicate entry '<code>-1' for key
--   'species.uq_species_active_code'") -- which already names the offending key
--   and SpeciesCode. Auto-cleanup is intentionally NOT performed because the
--   right resolution depends on which downstream trees/stems/measurements
--   reference each duplicate SpeciesID, and a wrong choice silently destroys
--   data via ON DELETE CASCADE.
--
--   Idempotent via the conditional ALTER pattern.
-- =====================================================================================

SET @idx_exists := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'species'
      AND INDEX_NAME   = 'uq_species_active_code'
);

SET @ddl := IF(@idx_exists > 0,
    'SELECT ''uq_species_active_code already exists'' AS Status',
    'ALTER TABLE species ADD UNIQUE KEY uq_species_active_code (SpeciesCode, IsActive)'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 46 complete: uq_species_active_code ensured.' AS Status;
