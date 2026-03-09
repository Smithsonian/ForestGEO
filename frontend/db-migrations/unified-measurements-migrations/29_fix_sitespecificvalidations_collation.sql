-- =====================================================================================
-- Migration Script 29: Fix sitespecificvalidations collation
-- =====================================================================================
-- Purpose:
--   - Convert sitespecificvalidations from legacy utf8mb3_general_ci to utf8mb4_0900_ai_ci
--   - This table was the only one in the schema still using the old collation
--   - The mismatch caused "Illegal mix of collations" errors when joining
--     measurement_errors.ErrorCode against CAST(ValidationID AS CHAR)
-- =====================================================================================

ALTER TABLE sitespecificvalidations
    CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

SELECT 'Migration 29 complete: sitespecificvalidations converted to utf8mb4_0900_ai_ci.' AS Status;
