-- ============================================================================
-- Data cleanup: remove the auto-generated placeholder quadrat grid that is
-- duplicating a plot's real quadrats.
-- ============================================================================
--
-- SYMPTOM
--   A plot shows ~2x the expected number of quadrats (e.g. Cooks Branch shows
--   1052 instead of 527). Two naming schemes coexist: an auto-generated
--   sequential grid (Q00001, Q00002, …) AND the site's real quadrats under a
--   different scheme (e.g. C01, D01, E01, …).
--
-- ROOT CAUSE
--   Provisioning seeded a placeholder Q##### grid. The site later uploaded its
--   real quadrats via a Revisions upload, which matches by QuadratName and
--   appends every non-matching row. Because Q##### never matches C01…, all the
--   real quadrats were ADDED on top of the placeholders instead of replacing
--   them.
--
-- WHAT THIS SCRIPT DOES
--   Deletes ONLY the Q##### placeholder quadrats, and ONLY those not referenced
--   by any stem, and ONLY when a real (non-placeholder) quadrat set also exists
--   in the same plot. This makes it impossible to cascade-delete stems or
--   measurements, and impossible to wipe a plot that legitimately uses Q#####
--   names.
--
-- HOW TO RUN
--   1. Point your client at the site schema (edit the USE line below).
--   2. Set @plot_name to the affected plot.
--   3. Run the PREVIEW section and confirm the counts make sense.
--   4. Run the TRANSACTION section, re-check the post-delete count, then COMMIT
--      (or ROLLBACK if anything looks wrong).
--
-- The placeholder pattern matches the provisioning generator exactly: a literal
-- 'Q' followed by 5 digits (see lib/provisioning/grid-generator.ts,
-- SEQUENTIAL_PAD_WIDTH = 5). Adjust @placeholder_pattern only if your generator
-- padding differs.
-- ============================================================================

USE `forestgeo_cooksbranch`;

SET @plot_name := 'Cook Branch';
SET @placeholder_pattern := '^Q[0-9]{5}$';

SELECT PlotID INTO @plot_id FROM plots WHERE PlotName = @plot_name LIMIT 1;

-- ---------------------------------------------------------------------------
-- PREVIEW  (read-only — safe to run first)
-- ---------------------------------------------------------------------------

-- Breakdown of active quadrats for the plot: total / placeholders / real.
SELECT
  @plot_id                                                                        AS plot_id,
  COUNT(*)                                                                        AS active_quadrats_total,
  SUM(QuadratName REGEXP @placeholder_pattern)                                    AS placeholder_quadrats,
  SUM(QuadratName NOT REGEXP @placeholder_pattern OR QuadratName IS NULL)         AS real_quadrats
FROM quadrats
WHERE PlotID = @plot_id
  AND IsActive = 1;

-- Placeholders that are referenced by a stem. These will be PRESERVED by the
-- delete below (expected to be 0 for a placeholder grid that was never measured
-- against). If this is > 0, investigate before proceeding.
SELECT COUNT(*) AS placeholders_referenced_by_stems
FROM quadrats q
WHERE q.PlotID = @plot_id
  AND q.IsActive = 1
  AND q.QuadratName REGEXP @placeholder_pattern
  AND EXISTS (SELECT 1 FROM stems s WHERE s.QuadratID = q.QuadratID);

-- Exact rows that WOULD be deleted (placeholders, active, not stem-referenced).
SELECT QuadratID, QuadratName, StartX, StartY
FROM quadrats q
WHERE q.PlotID = @plot_id
  AND q.IsActive = 1
  AND q.QuadratName REGEXP @placeholder_pattern
  AND NOT EXISTS (SELECT 1 FROM stems s WHERE s.QuadratID = q.QuadratID)
ORDER BY QuadratName;

-- ---------------------------------------------------------------------------
-- TRANSACTION  (mutating — review the preview first)
-- ---------------------------------------------------------------------------

START TRANSACTION;

-- Safety gate: only delete placeholders when the plot ALSO has a real,
-- non-placeholder active quadrat set. Prevents wiping a plot that legitimately
-- uses Q##### names.
SELECT EXISTS (
  SELECT 1 FROM quadrats
  WHERE PlotID = @plot_id
    AND IsActive = 1
    AND (QuadratName NOT REGEXP @placeholder_pattern OR QuadratName IS NULL)
) INTO @real_set_exists;

DELETE q
FROM quadrats q
WHERE q.PlotID = @plot_id
  AND q.IsActive = 1
  AND q.QuadratName REGEXP @placeholder_pattern
  AND NOT EXISTS (SELECT 1 FROM stems s WHERE s.QuadratID = q.QuadratID)
  AND @real_set_exists = 1;

-- Post-delete count — should equal the plot's expected real quadrat count.
SELECT COUNT(*) AS active_quadrats_after
FROM quadrats
WHERE PlotID = @plot_id
  AND IsActive = 1;

-- Review the number above, then finish with exactly one of:
--   COMMIT;
--   ROLLBACK;
