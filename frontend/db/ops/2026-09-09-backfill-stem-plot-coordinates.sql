-- ============================================================================
-- Data repair: fill NULL Stem.PX/PY on Smithsonian destination stems that the
-- (pre-fix) publish exporter created without plot coordinates.
-- ============================================================================
--
-- SYMPTOM
--   Every Stem row the app's publish pipeline inserted has PX/PY = NULL.
--   Issue #475: "Publish leaves PX/PY NULL on every Stem row in the
--   Smithsonian database."
--
-- ROOT CAUSE
--   The pre-fix export procedure's Stage 7 INSERT into Stem never carried
--   PX/PY (only QX/QY, the quadrat-local offsets). The fix (see the app's
--   ctfs-export Stage 7, issue #475) makes new publishes carry PX/PY going
--   forward, but it never touches stems that were already inserted — so the
--   historical rows need a one-time destination-side repair.
--
-- WHAT THIS SCRIPT DOES
--   For a single destination PlotID and an explicit, operator-supplied list
--   of destination CensusIDs the app published:
--     1. Finds every Stem with a DBH row in one of those censuses (the exact
--        set the app's publish could have created or touched).
--     2. Derives each stem's quadrat origin as MIN(PX)/MIN(PY) per QuadratID
--        from Coordinates — the same reduction the ctfsweb migration used
--        (db/migrations/ctfs-migrations/01_migrate_all_data.sql), because
--        several Coordinates rows describe one quadrat (its corners).
--     3. Proposes PX = OriginPX + QX and PY = OriginPY + QY, independently
--        per axis.
--     4. Fills ONLY axes that are currently NULL, ONLY when the proposed
--        value is non-NULL, and ONLY when it falls within the operator-
--        supplied plot bounds (0 <= value <= dimension). Values are never
--        clamped — out-of-bounds blocks the whole run (see below).
--
--   The bounds check assumes a RECTANGULAR plot with its origin at (0,0) —
--   "in bounds" is exactly `0 <= value <= dimension` on each axis
--   independently. A nonrectangular plot needs its own documented boundary
--   check (e.g. a polygon containment test) before this script is usable for
--   it; do not run this script against a nonrectangular plot as-is. See the
--   runbook.
--
-- WHAT THIS SCRIPT REFUSES TO DO
--   - Never overwrites a non-NULL PX or PY, including a populated zero.
--     A populated value that disagrees with the computed sum is reported,
--     never changed.
--   - Never touches a stem outside the target plot, or a stem whose only
--     DBH rows fall outside the listed censuses.
--   - Never repairs anything if ANY candidate's proposed value would fall
--     outside the supplied plot bounds, or if any input is missing/invalid
--     (see `repair_allowed` below) — the run is all-or-nothing per plot.
--   - Runs no DDL inside the open transaction (DDL implicitly commits in
--     MySQL; the backup table is created and the working tables are dropped
--     outside it).
--   - Never issues COMMIT or ROLLBACK itself — the operator reviews the
--     `verification` metrics and issues exactly one of them by hand.
--
-- HOW TO RUN
--   See ../../docs/stem-plot-coordinate-backfill-runbook.md for the full
--   procedure (inventory inputs, origin-equivalence check, maintenance
--   window). In outline, against a client connected to the destination
--   database (this script has no `USE` line — select the database first):
--     1. Edit the `inputs` section below (or paste your own SET statements
--        in its place) and run it.
--     2. Run `setup` — builds the working tables and reports whether the
--        inputs themselves are usable (`inputs_ok`).
--     3. Run `preview` — read-only. Confirm `bounds_ok` = 1 and
--        `repair_allowed` = 1, and that every count matches what you expect
--        from the inventory. Do not proceed otherwise.
--     4. Run `backup` — snapshots the stems about to be repaired. Refuses
--        (ER_TABLE_EXISTS_ERROR) if a backup from a prior run is still
--        present; investigate before dropping it.
--     5. Run `transaction` — opens a transaction, re-derives candidates from
--        live data, and applies the UPDATE. Ends without committing.
--     6. Run `verification` (still inside the open transaction). Every
--        metric must read as documented below before you commit.
--     7. Issue exactly one of `COMMIT;` / `ROLLBACK;` yourself.
--     8. Run `cleanup` to drop the two working tables (not the backup).
--     9. If a repair needs undoing after COMMIT, run `rollback`, review
--        `rollback_axes_diverged`, then re-run `cleanup`.
--
-- METRICS (every `SELECT '<name>' AS metric, <expr> AS n` row emitted below)
--   inputs_ok, census_ids_listed, census_ids_found, censuses_outside_target_plot,
--   distinct_candidates, candidates_measured_outside_listed_censuses,
--   candidates_already_complete, stems_needing_repair, px_repairs, py_repairs,
--   px_missing_origin, px_missing_local, py_missing_origin, py_missing_local,
--   px_existing_disagrees, py_existing_disagrees, px_out_of_bounds,
--   py_out_of_bounds, bounds_ok, repair_allowed, rows_updated,
--   rows_updated_matches_stems_needing_repair,
--   repaired_axes_not_equal_replacement, stems_repaired_not_in_backup,
--   candidates_still_null_px, candidates_still_null_py, px_expected_still_null,
--   py_expected_still_null, fresh_rebuild_proposes, rollback_axes_diverged,
--   rollback_rows_restored.
--
-- WORKING TABLES (dropped by `cleanup`; NOT the backup table)
--   stem_px_repair_census_input_20260909, stem_px_repair_candidates_20260909
--
-- BACKUP TABLE (permanent; `cleanup` does NOT drop it; drop it by hand once
-- the repair is confirmed and no rollback is anticipated)
--   stem_px_backup_20260909
-- ============================================================================

-- SECTION: inputs

-- Cocoli is the first target plot for this repair. Fill these four values
-- from the inventory (see the runbook) before running against Cocoli or any
-- other plot — the placeholders below are NOT usable as-is and `setup`
-- reports `inputs_ok` = 0 until every one is supplied.
SET @plot_id := NULL; -- Cocoli: fill from the inventory (destination PlotID)
SET @census_ids := NULL; -- Cocoli: fill from the inventory (comma-separated destination CensusIDs the app published, e.g. '1,2')
SET @plot_dimension_x := NULL; -- Cocoli: fill from the inventory (verified plot bounds, X)
SET @plot_dimension_y := NULL; -- Cocoli: fill from the inventory (verified plot bounds, Y)

-- SECTION: setup

-- Tolerance used only by the "existing value disagrees" preview diagnostic —
-- QX/QY may still be FLOAT on an older destination and can drift a few units
-- in the sixth decimal place from the DECIMAL(16,5) sum computed here.
SET @existing_value_tolerance := 0.001;

DROP TABLE IF EXISTS stem_px_repair_census_input_20260909;
CREATE TABLE stem_px_repair_census_input_20260909 (
  CensusID INT UNSIGNED NOT NULL,
  PlotID INT UNSIGNED NOT NULL,
  PRIMARY KEY (CensusID)
);

INSERT INTO stem_px_repair_census_input_20260909 (CensusID, PlotID)
SELECT c.CensusID, c.PlotID
FROM Census c
WHERE FIND_IN_SET(c.CensusID, @census_ids);

SET @census_ids_listed := CASE
  WHEN @census_ids IS NULL OR @census_ids = '' THEN 0
  ELSE LENGTH(@census_ids) - LENGTH(REPLACE(@census_ids, ',', '')) + 1
END;
SET @census_ids_found := (SELECT COUNT(*) FROM stem_px_repair_census_input_20260909);
SET @censuses_outside_target_plot := (
  SELECT COUNT(*) FROM stem_px_repair_census_input_20260909 WHERE PlotID <> @plot_id
);
SET @inputs_ok := (
  @plot_id IS NOT NULL
  AND @census_ids IS NOT NULL AND @census_ids <> ''
  AND @plot_dimension_x IS NOT NULL
  AND @plot_dimension_y IS NOT NULL
  AND @census_ids_listed = @census_ids_found
  AND @census_ids_found > 0
  AND @censuses_outside_target_plot = 0
);

SELECT 'inputs_ok' AS metric, @inputs_ok AS n
UNION ALL SELECT 'census_ids_listed', @census_ids_listed
UNION ALL SELECT 'census_ids_found', @census_ids_found
UNION ALL SELECT 'censuses_outside_target_plot', @censuses_outside_target_plot;

DROP TABLE IF EXISTS stem_px_repair_candidates_20260909;
CREATE TABLE stem_px_repair_candidates_20260909 (
  StemID INT UNSIGNED NOT NULL PRIMARY KEY,
  QuadratID INT UNSIGNED NOT NULL,
  OriginalPX DECIMAL(16,5) NULL,
  OriginalPY DECIMAL(16,5) NULL,
  QX DECIMAL(16,5) NULL,
  QY DECIMAL(16,5) NULL,
  OriginPX DECIMAL(16,5) NULL,
  OriginPY DECIMAL(16,5) NULL,
  ProposedPX DECIMAL(16,5) NULL,
  ProposedPY DECIMAL(16,5) NULL,
  RepairPX TINYINT NOT NULL,
  RepairPY TINYINT NOT NULL,
  OutOfBoundsPX TINYINT NOT NULL,
  OutOfBoundsPY TINYINT NOT NULL,
  MeasuredOutsideListedCensuses TINYINT NOT NULL
);

-- CANDIDATE SELECT (must stay byte-identical to the copies in `transaction`
-- and `verification` — search this file for "CANDIDATE SELECT" to find all
-- three).
INSERT INTO stem_px_repair_candidates_20260909
  (StemID, QuadratID, OriginalPX, OriginalPY, QX, QY, OriginPX, OriginPY,
   ProposedPX, ProposedPY, RepairPX, RepairPY, OutOfBoundsPX, OutOfBoundsPY,
   MeasuredOutsideListedCensuses)
-- CANDIDATE SELECT START
SELECT
  s.StemID                                                              AS StemID,
  s.QuadratID                                                           AS QuadratID,
  s.PX                                                                  AS OriginalPX,
  s.PY                                                                  AS OriginalPY,
  s.QX                                                                  AS QX,
  s.QY                                                                  AS QY,
  o.OriginPX                                                            AS OriginPX,
  o.OriginPY                                                            AS OriginPY,
  CASE WHEN o.OriginPX IS NULL OR s.QX IS NULL THEN NULL ELSE o.OriginPX + s.QX END AS ProposedPX,
  CASE WHEN o.OriginPY IS NULL OR s.QY IS NULL THEN NULL ELSE o.OriginPY + s.QY END AS ProposedPY,
  CASE WHEN s.PX IS NULL
            AND o.OriginPX IS NOT NULL AND s.QX IS NOT NULL
            AND (o.OriginPX + s.QX) BETWEEN 0 AND @plot_dimension_x
       THEN 1 ELSE 0 END                                                AS RepairPX,
  CASE WHEN s.PY IS NULL
            AND o.OriginPY IS NOT NULL AND s.QY IS NOT NULL
            AND (o.OriginPY + s.QY) BETWEEN 0 AND @plot_dimension_y
       THEN 1 ELSE 0 END                                                AS RepairPY,
  CASE WHEN s.PX IS NULL
            AND o.OriginPX IS NOT NULL AND s.QX IS NOT NULL
            AND NOT ((o.OriginPX + s.QX) BETWEEN 0 AND @plot_dimension_x)
       THEN 1 ELSE 0 END                                                AS OutOfBoundsPX,
  CASE WHEN s.PY IS NULL
            AND o.OriginPY IS NOT NULL AND s.QY IS NOT NULL
            AND NOT ((o.OriginPY + s.QY) BETWEEN 0 AND @plot_dimension_y)
       THEN 1 ELSE 0 END                                                AS OutOfBoundsPY,
  CASE WHEN EXISTS (
              SELECT 1 FROM DBH d2
               WHERE d2.StemID = s.StemID
                 AND d2.CensusID NOT IN (SELECT CensusID FROM stem_px_repair_census_input_20260909)
            ) THEN 1 ELSE 0 END                                         AS MeasuredOutsideListedCensuses
FROM Stem s
JOIN Quadrat q ON q.QuadratID = s.QuadratID AND q.PlotID = @plot_id
LEFT JOIN (
  SELECT c.QuadratID AS QuadratID, MIN(c.PX) AS OriginPX, MIN(c.PY) AS OriginPY
  FROM Coordinates c
  JOIN Quadrat q2 ON q2.QuadratID = c.QuadratID AND q2.PlotID = @plot_id
  GROUP BY c.QuadratID
) o ON o.QuadratID = s.QuadratID
WHERE s.StemID IN (
  SELECT DISTINCT d.StemID
  FROM DBH d
  JOIN stem_px_repair_census_input_20260909 ci ON ci.CensusID = d.CensusID
)
-- CANDIDATE SELECT END
;

-- SECTION: preview

SELECT 'distinct_candidates' AS metric, COUNT(*) AS n FROM stem_px_repair_candidates_20260909
UNION ALL SELECT 'candidates_measured_outside_listed_censuses', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE MeasuredOutsideListedCensuses = 1
UNION ALL SELECT 'candidates_already_complete', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OriginalPX IS NOT NULL AND OriginalPY IS NOT NULL
UNION ALL SELECT 'stems_needing_repair', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE RepairPX = 1 OR RepairPY = 1
UNION ALL SELECT 'px_repairs', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE RepairPX = 1
UNION ALL SELECT 'py_repairs', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE RepairPY = 1
UNION ALL SELECT 'px_missing_origin', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OriginalPX IS NULL AND OriginPX IS NULL
UNION ALL SELECT 'px_missing_local', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OriginalPX IS NULL AND QX IS NULL
UNION ALL SELECT 'py_missing_origin', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OriginalPY IS NULL AND OriginPY IS NULL
UNION ALL SELECT 'py_missing_local', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OriginalPY IS NULL AND QY IS NULL
UNION ALL SELECT 'px_existing_disagrees', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OriginalPX IS NOT NULL AND ProposedPX IS NOT NULL AND ABS(OriginalPX - ProposedPX) > @existing_value_tolerance
UNION ALL SELECT 'py_existing_disagrees', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OriginalPY IS NOT NULL AND ProposedPY IS NOT NULL AND ABS(OriginalPY - ProposedPY) > @existing_value_tolerance
UNION ALL SELECT 'px_out_of_bounds', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OutOfBoundsPX = 1
UNION ALL SELECT 'py_out_of_bounds', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OutOfBoundsPY = 1;

SET @px_out_of_bounds := (SELECT COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OutOfBoundsPX = 1);
SET @py_out_of_bounds := (SELECT COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OutOfBoundsPY = 1);
SET @bounds_ok := (
  @plot_dimension_x IS NOT NULL AND @plot_dimension_y IS NOT NULL
  AND @px_out_of_bounds = 0 AND @py_out_of_bounds = 0
);
SET @repair_allowed := (@inputs_ok = 1 AND @bounds_ok = 1);

SELECT 'bounds_ok' AS metric, @bounds_ok AS n
UNION ALL SELECT 'repair_allowed', @repair_allowed;

-- Two samples of the rows that would be repaired. High-edge: surfaces stems
-- near the top/right of the plot, where an origin+offset arithmetic error is
-- most likely to push a proposed value out of bounds. Low-edge/non-zero-
-- origin: restricted to quadrats whose origin is NOT (0,0) — a stem whose
-- quadrat origin is zero can hide an accidental "copy QX/QY straight to
-- PX/PY" bug (the two would coincide by chance), so this sample is the one
-- that would actually reveal it. Both are read-only.
SELECT 'high edge' AS sample, StemID, QuadratID, OriginalPX, OriginalPY, QX, QY, OriginPX, OriginPY,
       ProposedPX, ProposedPY, RepairPX, RepairPY
FROM stem_px_repair_candidates_20260909
WHERE RepairPX = 1 OR RepairPY = 1
ORDER BY ProposedPX DESC, ProposedPY DESC
LIMIT 20;

SELECT 'low edge / non-zero origin' AS sample, StemID, QuadratID, OriginalPX, OriginalPY, QX, QY, OriginPX, OriginPY,
       ProposedPX, ProposedPY, RepairPX, RepairPY
FROM stem_px_repair_candidates_20260909
WHERE (RepairPX = 1 OR RepairPY = 1)
  AND (COALESCE(OriginPX, 0) <> 0 OR COALESCE(OriginPY, 0) <> 0)
ORDER BY ProposedPX ASC, ProposedPY ASC
LIMIT 20;

-- SECTION: backup

-- Plain CREATE TABLE (no IF NOT EXISTS): if stem_px_backup_20260909 already
-- exists — a prior run's backup — this refuses with ER_TABLE_EXISTS_ERROR
-- rather than silently reusing or overwriting it. Investigate before
-- dropping an existing backup by hand.
CREATE TABLE stem_px_backup_20260909 (
  StemID INT UNSIGNED PRIMARY KEY,
  OriginalPX DECIMAL(16,5),
  OriginalPY DECIMAL(16,5),
  RepairPX TINYINT NOT NULL,
  RepairPY TINYINT NOT NULL,
  ReplacementPX DECIMAL(16,5),
  ReplacementPY DECIMAL(16,5)
);

INSERT INTO stem_px_backup_20260909
  (StemID, OriginalPX, OriginalPY, RepairPX, RepairPY, ReplacementPX, ReplacementPY)
SELECT StemID, OriginalPX, OriginalPY, RepairPX, RepairPY,
       CASE WHEN RepairPX = 1 THEN ProposedPX ELSE NULL END,
       CASE WHEN RepairPY = 1 THEN ProposedPY ELSE NULL END
FROM stem_px_repair_candidates_20260909
WHERE RepairPX = 1 OR RepairPY = 1;

-- SECTION: transaction

START TRANSACTION;

-- Rebuild the candidate set from live rows inside the transaction. DML only
-- (DELETE + INSERT ... SELECT) — DDL here would implicitly commit. Identical
-- to the CANDIDATE SELECT in `setup` above.
DELETE FROM stem_px_repair_candidates_20260909;
INSERT INTO stem_px_repair_candidates_20260909
  (StemID, QuadratID, OriginalPX, OriginalPY, QX, QY, OriginPX, OriginPY,
   ProposedPX, ProposedPY, RepairPX, RepairPY, OutOfBoundsPX, OutOfBoundsPY,
   MeasuredOutsideListedCensuses)
-- CANDIDATE SELECT START
SELECT
  s.StemID                                                              AS StemID,
  s.QuadratID                                                           AS QuadratID,
  s.PX                                                                  AS OriginalPX,
  s.PY                                                                  AS OriginalPY,
  s.QX                                                                  AS QX,
  s.QY                                                                  AS QY,
  o.OriginPX                                                            AS OriginPX,
  o.OriginPY                                                            AS OriginPY,
  CASE WHEN o.OriginPX IS NULL OR s.QX IS NULL THEN NULL ELSE o.OriginPX + s.QX END AS ProposedPX,
  CASE WHEN o.OriginPY IS NULL OR s.QY IS NULL THEN NULL ELSE o.OriginPY + s.QY END AS ProposedPY,
  CASE WHEN s.PX IS NULL
            AND o.OriginPX IS NOT NULL AND s.QX IS NOT NULL
            AND (o.OriginPX + s.QX) BETWEEN 0 AND @plot_dimension_x
       THEN 1 ELSE 0 END                                                AS RepairPX,
  CASE WHEN s.PY IS NULL
            AND o.OriginPY IS NOT NULL AND s.QY IS NOT NULL
            AND (o.OriginPY + s.QY) BETWEEN 0 AND @plot_dimension_y
       THEN 1 ELSE 0 END                                                AS RepairPY,
  CASE WHEN s.PX IS NULL
            AND o.OriginPX IS NOT NULL AND s.QX IS NOT NULL
            AND NOT ((o.OriginPX + s.QX) BETWEEN 0 AND @plot_dimension_x)
       THEN 1 ELSE 0 END                                                AS OutOfBoundsPX,
  CASE WHEN s.PY IS NULL
            AND o.OriginPY IS NOT NULL AND s.QY IS NOT NULL
            AND NOT ((o.OriginPY + s.QY) BETWEEN 0 AND @plot_dimension_y)
       THEN 1 ELSE 0 END                                                AS OutOfBoundsPY,
  CASE WHEN EXISTS (
              SELECT 1 FROM DBH d2
               WHERE d2.StemID = s.StemID
                 AND d2.CensusID NOT IN (SELECT CensusID FROM stem_px_repair_census_input_20260909)
            ) THEN 1 ELSE 0 END                                         AS MeasuredOutsideListedCensuses
FROM Stem s
JOIN Quadrat q ON q.QuadratID = s.QuadratID AND q.PlotID = @plot_id
LEFT JOIN (
  SELECT c.QuadratID AS QuadratID, MIN(c.PX) AS OriginPX, MIN(c.PY) AS OriginPY
  FROM Coordinates c
  JOIN Quadrat q2 ON q2.QuadratID = c.QuadratID AND q2.PlotID = @plot_id
  GROUP BY c.QuadratID
) o ON o.QuadratID = s.QuadratID
WHERE s.StemID IN (
  SELECT DISTINCT d.StemID
  FROM DBH d
  JOIN stem_px_repair_census_input_20260909 ci ON ci.CensusID = d.CensusID
)
-- CANDIDATE SELECT END
;

-- Recompute the same preview metrics against the freshly rebuilt candidate
-- set, and re-derive @repair_allowed, immediately before the UPDATE.
SELECT 'distinct_candidates' AS metric, COUNT(*) AS n FROM stem_px_repair_candidates_20260909
UNION ALL SELECT 'candidates_measured_outside_listed_censuses', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE MeasuredOutsideListedCensuses = 1
UNION ALL SELECT 'candidates_already_complete', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OriginalPX IS NOT NULL AND OriginalPY IS NOT NULL
UNION ALL SELECT 'stems_needing_repair', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE RepairPX = 1 OR RepairPY = 1
UNION ALL SELECT 'px_repairs', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE RepairPX = 1
UNION ALL SELECT 'py_repairs', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE RepairPY = 1
UNION ALL SELECT 'px_missing_origin', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OriginalPX IS NULL AND OriginPX IS NULL
UNION ALL SELECT 'px_missing_local', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OriginalPX IS NULL AND QX IS NULL
UNION ALL SELECT 'py_missing_origin', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OriginalPY IS NULL AND OriginPY IS NULL
UNION ALL SELECT 'py_missing_local', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OriginalPY IS NULL AND QY IS NULL
UNION ALL SELECT 'px_existing_disagrees', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OriginalPX IS NOT NULL AND ProposedPX IS NOT NULL AND ABS(OriginalPX - ProposedPX) > @existing_value_tolerance
UNION ALL SELECT 'py_existing_disagrees', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OriginalPY IS NOT NULL AND ProposedPY IS NOT NULL AND ABS(OriginalPY - ProposedPY) > @existing_value_tolerance
UNION ALL SELECT 'px_out_of_bounds', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OutOfBoundsPX = 1
UNION ALL SELECT 'py_out_of_bounds', COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OutOfBoundsPY = 1;

SET @px_out_of_bounds := (SELECT COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OutOfBoundsPX = 1);
SET @py_out_of_bounds := (SELECT COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE OutOfBoundsPY = 1);
SET @bounds_ok := (
  @plot_dimension_x IS NOT NULL AND @plot_dimension_y IS NOT NULL
  AND @px_out_of_bounds = 0 AND @py_out_of_bounds = 0
);
SET @repair_allowed := (@inputs_ok = 1 AND @bounds_ok = 1);
SET @stems_needing_repair := (
  SELECT COUNT(*) FROM stem_px_repair_candidates_20260909 WHERE RepairPX = 1 OR RepairPY = 1
);

SELECT 'bounds_ok' AS metric, @bounds_ok AS n
UNION ALL SELECT 'repair_allowed', @repair_allowed
UNION ALL SELECT 'stems_needing_repair', @stems_needing_repair;

-- The only mutating statement in this file. Gated on @repair_allowed so that
-- a single out-of-bounds (or otherwise invalid) candidate blocks every
-- repair for the whole plot, not just its own row.
UPDATE Stem s
JOIN stem_px_repair_candidates_20260909 r ON r.StemID = s.StemID
SET s.PX = CASE WHEN r.RepairPX = 1 AND s.PX IS NULL THEN r.ProposedPX ELSE s.PX END,
    s.PY = CASE WHEN r.RepairPY = 1 AND s.PY IS NULL THEN r.ProposedPY ELSE s.PY END
WHERE ((r.RepairPX = 1 AND s.PX IS NULL) OR (r.RepairPY = 1 AND s.PY IS NULL))
  AND @repair_allowed = 1;

SET @rows_updated := ROW_COUNT();
SELECT 'rows_updated' AS metric, @rows_updated AS n;

-- Do NOT COMMIT or ROLLBACK here. Run the `verification` section next (still
-- inside this open transaction), review every metric against the header's
-- checklist, then issue exactly one of COMMIT; / ROLLBACK; yourself.

-- SECTION: verification

-- Because the UPDATE's WHERE only matches a row that gets at least one axis
-- changed, "rows matched" and "rows changed" coincide here, so ROW_COUNT is
-- stable regardless of the client's CLIENT_FOUND_ROWS flag.
SELECT 'rows_updated_matches_stems_needing_repair' AS metric,
       (@rows_updated = @stems_needing_repair) AS n;

SELECT 'repaired_axes_not_equal_replacement' AS metric,
       (
         (SELECT COUNT(*) FROM stem_px_backup_20260909 b JOIN Stem s ON s.StemID = b.StemID
           WHERE b.RepairPX = 1 AND NOT (s.PX <=> b.ReplacementPX))
       + (SELECT COUNT(*) FROM stem_px_backup_20260909 b JOIN Stem s ON s.StemID = b.StemID
           WHERE b.RepairPY = 1 AND NOT (s.PY <=> b.ReplacementPY))
       ) AS n;

-- Every candidate this run repaired must have a backup row — the backup is
-- the only way to undo a commit. Must be 0.
SELECT 'stems_repaired_not_in_backup' AS metric, COUNT(*) AS n
FROM stem_px_repair_candidates_20260909 r
LEFT JOIN stem_px_backup_20260909 b ON b.StemID = r.StemID
WHERE (r.RepairPX = 1 OR r.RepairPY = 1) AND b.StemID IS NULL;

SELECT 'candidates_still_null_px' AS metric, COUNT(*) AS n
FROM stem_px_repair_candidates_20260909 r JOIN Stem s ON s.StemID = r.StemID
WHERE s.PX IS NULL
UNION ALL
SELECT 'candidates_still_null_py', COUNT(*)
FROM stem_px_repair_candidates_20260909 r JOIN Stem s ON s.StemID = r.StemID
WHERE s.PY IS NULL
UNION ALL
SELECT 'px_expected_still_null', COUNT(*)
FROM stem_px_repair_candidates_20260909
WHERE OriginalPX IS NULL AND ProposedPX IS NULL
UNION ALL
SELECT 'py_expected_still_null', COUNT(*)
FROM stem_px_repair_candidates_20260909
WHERE OriginalPY IS NULL AND ProposedPY IS NULL;

-- Rebuild a fresh candidate set from live (post-update) rows and count how
-- many repairs it would still propose. Must be 0 — anything else means the
-- UPDATE above did not actually apply everything `repair_allowed` promised.
-- Identical to the CANDIDATE SELECT in `setup` and `transaction` above.
DELETE FROM stem_px_repair_candidates_20260909;
INSERT INTO stem_px_repair_candidates_20260909
  (StemID, QuadratID, OriginalPX, OriginalPY, QX, QY, OriginPX, OriginPY,
   ProposedPX, ProposedPY, RepairPX, RepairPY, OutOfBoundsPX, OutOfBoundsPY,
   MeasuredOutsideListedCensuses)
-- CANDIDATE SELECT START
SELECT
  s.StemID                                                              AS StemID,
  s.QuadratID                                                           AS QuadratID,
  s.PX                                                                  AS OriginalPX,
  s.PY                                                                  AS OriginalPY,
  s.QX                                                                  AS QX,
  s.QY                                                                  AS QY,
  o.OriginPX                                                            AS OriginPX,
  o.OriginPY                                                            AS OriginPY,
  CASE WHEN o.OriginPX IS NULL OR s.QX IS NULL THEN NULL ELSE o.OriginPX + s.QX END AS ProposedPX,
  CASE WHEN o.OriginPY IS NULL OR s.QY IS NULL THEN NULL ELSE o.OriginPY + s.QY END AS ProposedPY,
  CASE WHEN s.PX IS NULL
            AND o.OriginPX IS NOT NULL AND s.QX IS NOT NULL
            AND (o.OriginPX + s.QX) BETWEEN 0 AND @plot_dimension_x
       THEN 1 ELSE 0 END                                                AS RepairPX,
  CASE WHEN s.PY IS NULL
            AND o.OriginPY IS NOT NULL AND s.QY IS NOT NULL
            AND (o.OriginPY + s.QY) BETWEEN 0 AND @plot_dimension_y
       THEN 1 ELSE 0 END                                                AS RepairPY,
  CASE WHEN s.PX IS NULL
            AND o.OriginPX IS NOT NULL AND s.QX IS NOT NULL
            AND NOT ((o.OriginPX + s.QX) BETWEEN 0 AND @plot_dimension_x)
       THEN 1 ELSE 0 END                                                AS OutOfBoundsPX,
  CASE WHEN s.PY IS NULL
            AND o.OriginPY IS NOT NULL AND s.QY IS NOT NULL
            AND NOT ((o.OriginPY + s.QY) BETWEEN 0 AND @plot_dimension_y)
       THEN 1 ELSE 0 END                                                AS OutOfBoundsPY,
  CASE WHEN EXISTS (
              SELECT 1 FROM DBH d2
               WHERE d2.StemID = s.StemID
                 AND d2.CensusID NOT IN (SELECT CensusID FROM stem_px_repair_census_input_20260909)
            ) THEN 1 ELSE 0 END                                         AS MeasuredOutsideListedCensuses
FROM Stem s
JOIN Quadrat q ON q.QuadratID = s.QuadratID AND q.PlotID = @plot_id
LEFT JOIN (
  SELECT c.QuadratID AS QuadratID, MIN(c.PX) AS OriginPX, MIN(c.PY) AS OriginPY
  FROM Coordinates c
  JOIN Quadrat q2 ON q2.QuadratID = c.QuadratID AND q2.PlotID = @plot_id
  GROUP BY c.QuadratID
) o ON o.QuadratID = s.QuadratID
WHERE s.StemID IN (
  SELECT DISTINCT d.StemID
  FROM DBH d
  JOIN stem_px_repair_census_input_20260909 ci ON ci.CensusID = d.CensusID
)
-- CANDIDATE SELECT END
;

SELECT 'fresh_rebuild_proposes' AS metric, COUNT(*) AS n
FROM stem_px_repair_candidates_20260909
WHERE RepairPX = 1 OR RepairPY = 1;

-- SECTION: rollback

-- Only meaningful after COMMIT, and only run by hand if a repair needs
-- undoing. First reports any repaired axis that no longer matches what this
-- run wrote (someone edited it since) — those axes are reported and left
-- alone, never restored.
SELECT 'rollback_axes_diverged' AS metric,
       (
         (SELECT COUNT(*) FROM stem_px_backup_20260909 b JOIN Stem s ON s.StemID = b.StemID
           WHERE b.RepairPX = 1 AND NOT (s.PX <=> b.ReplacementPX))
       + (SELECT COUNT(*) FROM stem_px_backup_20260909 b JOIN Stem s ON s.StemID = b.StemID
           WHERE b.RepairPY = 1 AND NOT (s.PY <=> b.ReplacementPY))
       ) AS n;

SELECT b.StemID, s.PX AS CurrentPX, b.ReplacementPX, s.PY AS CurrentPY, b.ReplacementPY
FROM stem_px_backup_20260909 b
JOIN Stem s ON s.StemID = b.StemID
WHERE (b.RepairPX = 1 AND NOT (s.PX <=> b.ReplacementPX))
   OR (b.RepairPY = 1 AND NOT (s.PY <=> b.ReplacementPY))
ORDER BY b.StemID
LIMIT 20;

UPDATE Stem s
JOIN stem_px_backup_20260909 b ON b.StemID = s.StemID
SET s.PX = CASE WHEN b.RepairPX = 1 AND s.PX <=> b.ReplacementPX THEN b.OriginalPX ELSE s.PX END,
    s.PY = CASE WHEN b.RepairPY = 1 AND s.PY <=> b.ReplacementPY THEN b.OriginalPY ELSE s.PY END
WHERE (b.RepairPX = 1 AND s.PX <=> b.ReplacementPX)
   OR (b.RepairPY = 1 AND s.PY <=> b.ReplacementPY);

SELECT 'rollback_rows_restored' AS metric, ROW_COUNT() AS n;

-- SECTION: cleanup

-- Drops only the working tables. stem_px_backup_20260909 is NOT dropped —
-- remove it by hand once the repair is confirmed and no rollback is
-- anticipated.
DROP TABLE IF EXISTS stem_px_repair_candidates_20260909;
DROP TABLE IF EXISTS stem_px_repair_census_input_20260909;
