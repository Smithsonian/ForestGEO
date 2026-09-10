-- ============================================================================
-- Data audit: does a plot's app-side quadrat origin (quadrats.StartX/StartY)
-- agree with its Smithsonian destination-side quadrat origin
-- (MIN(Coordinates.PX)/MIN(Coordinates.PY) per quadrat)?
-- ============================================================================
--
-- PURPOSE
--   Issue #475's published stem coordinates and the destination-side
--   historical repair (db/ops/2026-09-09-backfill-stem-plot-coordinates.sql)
--   compute a quadrat's origin two different ways: the app takes it straight
--   from quadrats.StartX/StartY, the destination-side repair derives it as
--   MIN(PX)/MIN(PY) over that quadrat's Coordinates corner rows. These are
--   the same number only for a plot that went through the ctfsweb migration
--   and was never re-gridded since — this script is how an operator checks
--   that assumption BEFORE trusting the app's coordinates for a repair or a
--   publish, instead of assuming it.
--
--   The app schema and the Smithsonian destination live on different MySQL
--   servers and cannot be JOINed directly, so this script's input is a
--   VALUES list an operator exports from the app schema by hand (see the
--   `inputs` section) and pastes in; the comparison itself runs entirely
--   against the destination connection.
--
-- WHAT IT REPORTS (every `SELECT '<metric>' AS metric, <expr> AS n` row)
--   inputs_ok, app_quadrats_loaded, destination_quadrats, app_quadrats,
--   app_only, destination_only, ambiguous_destination_names,
--   ambiguous_app_names, matched, origin_missing_destination,
--   origin_missing_app, origin_mismatch, origin_equal, equivalence_ok.
--
--   `report` also lists (up to 50 rows each, read-only): app-only names,
--   destination-only names, ambiguous names (destination or app side), and
--   mismatched origins (QuadratName, StartX, StartY, OriginPX, OriginPY,
--   DiffX, DiffY).
--
-- WHAT IT REFUSES
--   - Never touches any table other than its own working table — this is a
--     read-only report, no UPDATE/DELETE/INSERT against Quadrat or
--     Coordinates.
--   - Reports `equivalence_ok = 0` (never claims equivalence) whenever the
--     inputs are missing/invalid, or when any app-only name, destination-only
--     name, ambiguous name (either side), or origin mismatch exists —
--     equivalence_ok = 1 requires all of those to be exactly 0.
--   - `setup` refuses (ER_TABLE_EXISTS_ERROR) to build a second working
--     table over a still-present one from a prior run — run `cleanup` first.
--
-- TOLERANCE (@origin_tolerance, set in `inputs`, default 0.00001)
--   Both Coordinates.PX/PY (destination) and this script's own working
--   table are DECIMAL(16,5), so two distinct stored origin values can never
--   differ by less than 0.00001 — that is the smallest representable
--   nonzero difference at this precision, and it is also the default
--   tolerance. The mismatch check below uses strict `>`, so a diff of
--   exactly one unit (0.00001) still reads as equal (`origin_equal`); only
--   a diff clearly beyond it (e.g. 0.00002) is reported as
--   `origin_mismatch`. A value like 0.000005 cannot occur between two
--   values actually stored in these columns.
--
--   CAVEAT — destination still on FLOAT: DBCHANGES2014f's
--   `ALTER TABLE Coordinates MODIFY COLUMN PX/PY decimal(16,5)` is applied
--   per destination, not guaranteed everywhere. If the destination you're
--   checking still has Coordinates.PX/PY as FLOAT, float's binary rounding
--   means MIN(PX)/MIN(PY) will not exactly equal the app's decimal value
--   even for a quadrat that never moved, and every quadrat reports as
--   origin_mismatch at the default tolerance. Confirm the column type
--   before trusting a nonzero origin_mismatch count on such a destination;
--   if it's still FLOAT, record that and raise @origin_tolerance enough to
--   absorb the float imprecision before relying on equivalence_ok.
--
--   CAVEAT — app-side precision: the app's quadrats.StartX/StartY are
--   DECIMAL(12,6) — one more decimal digit than this script's DECIMAL(16,5)
--   working table. A pasted app value's sixth decimal is rounded away when
--   it loads into quadrat_origin_app_20260909; this is normally harmless
--   (finer than @origin_tolerance can ever detect at its default), but keep
--   it in mind if you lower @origin_tolerance below 0.00001.
--
-- HOW TO RUN
--   Against a client connected to the destination database (this script has
--   no `USE` line — select the database first):
--     1. Against the APP schema, run the export query documented in the
--        `inputs` section for the plot you're checking, paste its output in
--        place of the placeholder `@app_quadrat_origins` value, and delete
--        the trailing comma on the very last pasted row — the export query
--        ends every row with ',' so the rows concatenate into a VALUES
--        list, but the final row must not have one or the list is
--        malformed SQL.
--     2. Fill in `@plot_id` with the destination PlotID for the same plot.
--     3. Run `inputs`, then `setup` — reports `inputs_ok` and
--        `app_quadrats_loaded` (how many pasted rows actually loaded).
--     4. Run `report` — read-only. Review `equivalence_ok` and, if it's 0,
--        the metric breakdown and sample rows to see exactly which names or
--        origins disagree.
--     5. Run `cleanup` to drop the working table.
--
-- WORKING TABLE (created by `setup`, dropped by `cleanup`)
--   quadrat_origin_app_20260909 — its QuadratName column is declared with
--   the same collation as destination Quadrat.QuadratName (latin1_swedish_ci)
--   so the two sides compare correctly. Quadrat.QuadratName is CHAR(8), so
--   an app-side name longer than 8 characters can never match one there —
--   it will surface as a one-sided pair (app_only, or destination_only for
--   the destination row it should have matched).
-- ============================================================================

-- SECTION: inputs

SET @plot_id := NULL;              -- destination PlotID (Cocoli: fill from the inventory)
SET @origin_tolerance := 0.00001;  -- decimal(16,5) storage precision; see the header's TOLERANCE note
-- App-side quadrat origins. Produce this list with, against the app schema
-- (do not use GROUP_CONCAT for this — it silently truncates at 1024 bytes
-- by default, dropping rows for anything but a small plot):
--   SELECT CONCAT(
--       '(', '''''',
--       REPLACE(REPLACE(REPLACE(REPLACE(QuadratName, '\\', '\\\\'), '''', ''''''), '\\', '\\\\'), '''', ''''''),
--       '''''', ', ', IFNULL(StartX,'NULL'), ', ', IFNULL(StartY,'NULL'), '),'
--     )
--     FROM quadrats WHERE PlotID = <app plot id> AND IsActive = 1 ORDER BY QuadratName;
-- Do NOT use QUOTE() here — it backslash-escapes an embedded apostrophe
-- (e.g. O'BRIEN becomes 'O\'BRIEN'), and that stray backslash corrupts the
-- outer '...' literal below once pasted. The REPLACE chain instead doubles
-- every backslash and quote TWICE — once so the name round-trips through
-- the INSERT statement's own string literal, once more so that whole
-- result round-trips through the outer @app_quadrat_origins literal you
-- paste it into. Paste every returned row, in order, then delete the
-- trailing comma on the very last row (see HOW TO RUN step 1 above).
SET @app_quadrat_origins := '(''A1'', 40, 60),(''A2'', 60, 60)';  -- Cocoli: replace with the exported list

-- SECTION: setup

-- Plain CREATE TABLE (no IF NOT EXISTS / no preceding DROP): if
-- quadrat_origin_app_20260909 already exists from a prior run, this refuses
-- with ER_TABLE_EXISTS_ERROR rather than silently reusing or truncating it.
-- Run `cleanup` first. No unique key — a duplicate app-side QuadratName is
-- loaded as two rows so `ambiguous_app_names` below can report it.
-- QuadratName's charset/collation is pinned to match destination
-- Quadrat.QuadratName (see the header's WORKING TABLE note) rather than
-- inheriting the connection's default, so name comparisons below use the
-- same collation on both sides.
CREATE TABLE quadrat_origin_app_20260909 (
  QuadratName VARCHAR(64) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL,
  StartX DECIMAL(16,5) NULL,
  StartY DECIMAL(16,5) NULL
);

SET @inputs_ok := (
  @plot_id IS NOT NULL
  AND @app_quadrat_origins IS NOT NULL
  AND @app_quadrat_origins <> ''
);

-- MySQL user variables cannot hold row sets, so the only way to turn one
-- pasted VALUES-tuples string into rows is to build and PREPARE an INSERT
-- from it. When the inputs aren't usable this runs a harmless no-op ('DO 0')
-- instead, so a NULL/empty @app_quadrat_origins never reaches PREPARE as a
-- malformed statement.
SET @insert_sql := IF(
  @inputs_ok = 1,
  CONCAT('INSERT INTO quadrat_origin_app_20260909 (QuadratName, StartX, StartY) VALUES ', @app_quadrat_origins),
  'DO 0'
);
PREPARE stmt FROM @insert_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @app_quadrats_loaded := (SELECT COUNT(*) FROM quadrat_origin_app_20260909);

SELECT 'inputs_ok' AS metric, @inputs_ok AS n
UNION ALL SELECT 'app_quadrats_loaded', @app_quadrats_loaded;

-- SECTION: report

-- This statement and the four sample-row listings below it each declare
-- their own copy of the same marked CTE block (see the ORIGIN.CTES.START /
-- ORIGIN.CTES.END markers below) — CTEs do not persist across statements,
-- so the block is repeated byte-for-byte (search this file for "ORIGIN
-- CTES START" to find all five copies) rather than reimplemented per
-- listing, the same convention the
-- backfill script uses for its CANDIDATE SELECT. This statement appends one
-- more CTE, `blocker_counts`, after the shared block: every metric below
-- that gates `equivalence_ok` (app_only, destination_only,
-- ambiguous_destination_names, ambiguous_app_names, origin_mismatch) is
-- computed exactly once there, and both the per-metric rows AND
-- `equivalence_ok` read those same computed values — `equivalence_ok` never
-- restates any of the five conditions itself.
-- ORIGIN CTES START
WITH dest_origins AS (
  -- MIN(PX)/MIN(PY) per QuadratID: several Coordinates rows describe one
  -- quadrat (its corners) — same reduction the ctfsweb migration used and
  -- the backfill script documents.
  SELECT q.QuadratID, q.QuadratName, MIN(c.PX) AS OriginPX, MIN(c.PY) AS OriginPY
  FROM Quadrat q
  LEFT JOIN Coordinates c ON c.QuadratID = q.QuadratID
  WHERE q.PlotID = @plot_id
  GROUP BY q.QuadratID, q.QuadratName
),
dest_name_summary AS (
  -- Collapses same-named destination Quadrat rows so a duplicate name is
  -- reported (ambiguous_destination_names) instead of silently picking one.
  SELECT QuadratName, COUNT(*) AS row_count, MIN(OriginPX) AS OriginPX, MIN(OriginPY) AS OriginPY
  FROM dest_origins
  GROUP BY QuadratName
),
app_name_summary AS (
  SELECT QuadratName, COUNT(*) AS row_count, MIN(StartX) AS StartX, MIN(StartY) AS StartY
  FROM quadrat_origin_app_20260909
  GROUP BY QuadratName
),
matched_names AS (
  -- A name counts as matched only when it is unambiguous on BOTH sides —
  -- an ambiguous name is reported via ambiguous_destination_names /
  -- ambiguous_app_names instead, never silently matched to one of its rows.
  SELECT d.QuadratName, d.OriginPX, d.OriginPY, a.StartX, a.StartY
  FROM dest_name_summary d
  JOIN app_name_summary a ON a.QuadratName = d.QuadratName
  WHERE d.row_count = 1 AND a.row_count = 1
)
-- ORIGIN CTES END
,
blocker_counts AS (
  SELECT
    (SELECT COUNT(*) FROM app_name_summary a WHERE NOT EXISTS (SELECT 1 FROM dest_name_summary d WHERE d.QuadratName = a.QuadratName)) AS app_only,
    (SELECT COUNT(*) FROM dest_name_summary d WHERE NOT EXISTS (SELECT 1 FROM app_name_summary a WHERE a.QuadratName = d.QuadratName)) AS destination_only,
    (SELECT COUNT(*) FROM dest_name_summary WHERE row_count > 1) AS ambiguous_destination_names,
    (SELECT COUNT(*) FROM app_name_summary WHERE row_count > 1) AS ambiguous_app_names,
    (
      SELECT COUNT(*) FROM matched_names
      WHERE (OriginPX IS NOT NULL AND StartX IS NOT NULL AND ABS(OriginPX - StartX) > @origin_tolerance)
         OR (OriginPY IS NOT NULL AND StartY IS NOT NULL AND ABS(OriginPY - StartY) > @origin_tolerance)
    ) AS origin_mismatch
)
SELECT 'destination_quadrats' AS metric, (SELECT COUNT(*) FROM dest_origins) AS n
UNION ALL SELECT 'app_quadrats', (SELECT COUNT(*) FROM quadrat_origin_app_20260909)
UNION ALL SELECT 'app_only', (SELECT app_only FROM blocker_counts)
UNION ALL SELECT 'destination_only', (SELECT destination_only FROM blocker_counts)
UNION ALL SELECT 'ambiguous_destination_names', (SELECT ambiguous_destination_names FROM blocker_counts)
UNION ALL SELECT 'ambiguous_app_names', (SELECT ambiguous_app_names FROM blocker_counts)
UNION ALL SELECT 'matched', (SELECT COUNT(*) FROM matched_names)
UNION ALL SELECT 'origin_missing_destination', (
  SELECT COUNT(*) FROM matched_names WHERE OriginPX IS NULL OR OriginPY IS NULL
)
UNION ALL SELECT 'origin_missing_app', (
  SELECT COUNT(*) FROM matched_names WHERE StartX IS NULL OR StartY IS NULL
)
UNION ALL SELECT 'origin_mismatch', (SELECT origin_mismatch FROM blocker_counts)
UNION ALL SELECT 'origin_equal', (
  SELECT COUNT(*) FROM matched_names
  WHERE OriginPX IS NOT NULL AND OriginPY IS NOT NULL AND StartX IS NOT NULL AND StartY IS NOT NULL
    AND ABS(OriginPX - StartX) <= @origin_tolerance
    AND ABS(OriginPY - StartY) <= @origin_tolerance
)
UNION ALL SELECT 'equivalence_ok', (
  SELECT CASE WHEN @inputs_ok = 1
              AND app_only = 0
              AND destination_only = 0
              AND ambiguous_destination_names = 0
              AND ambiguous_app_names = 0
              AND origin_mismatch = 0
         THEN 1 ELSE 0 END
  FROM blocker_counts
);

-- Sample (up to 50): app-side names with no destination match at all.
-- ORIGIN CTES START
WITH dest_origins AS (
  -- MIN(PX)/MIN(PY) per QuadratID: several Coordinates rows describe one
  -- quadrat (its corners) — same reduction the ctfsweb migration used and
  -- the backfill script documents.
  SELECT q.QuadratID, q.QuadratName, MIN(c.PX) AS OriginPX, MIN(c.PY) AS OriginPY
  FROM Quadrat q
  LEFT JOIN Coordinates c ON c.QuadratID = q.QuadratID
  WHERE q.PlotID = @plot_id
  GROUP BY q.QuadratID, q.QuadratName
),
dest_name_summary AS (
  -- Collapses same-named destination Quadrat rows so a duplicate name is
  -- reported (ambiguous_destination_names) instead of silently picking one.
  SELECT QuadratName, COUNT(*) AS row_count, MIN(OriginPX) AS OriginPX, MIN(OriginPY) AS OriginPY
  FROM dest_origins
  GROUP BY QuadratName
),
app_name_summary AS (
  SELECT QuadratName, COUNT(*) AS row_count, MIN(StartX) AS StartX, MIN(StartY) AS StartY
  FROM quadrat_origin_app_20260909
  GROUP BY QuadratName
),
matched_names AS (
  -- A name counts as matched only when it is unambiguous on BOTH sides —
  -- an ambiguous name is reported via ambiguous_destination_names /
  -- ambiguous_app_names instead, never silently matched to one of its rows.
  SELECT d.QuadratName, d.OriginPX, d.OriginPY, a.StartX, a.StartY
  FROM dest_name_summary d
  JOIN app_name_summary a ON a.QuadratName = d.QuadratName
  WHERE d.row_count = 1 AND a.row_count = 1
)
-- ORIGIN CTES END
SELECT a.QuadratName, a.StartX, a.StartY
FROM app_name_summary a
WHERE NOT EXISTS (SELECT 1 FROM dest_name_summary d WHERE d.QuadratName = a.QuadratName)
ORDER BY a.QuadratName
LIMIT 50;

-- Sample (up to 50): destination-side names with no app-side match at all.
-- ORIGIN CTES START
WITH dest_origins AS (
  -- MIN(PX)/MIN(PY) per QuadratID: several Coordinates rows describe one
  -- quadrat (its corners) — same reduction the ctfsweb migration used and
  -- the backfill script documents.
  SELECT q.QuadratID, q.QuadratName, MIN(c.PX) AS OriginPX, MIN(c.PY) AS OriginPY
  FROM Quadrat q
  LEFT JOIN Coordinates c ON c.QuadratID = q.QuadratID
  WHERE q.PlotID = @plot_id
  GROUP BY q.QuadratID, q.QuadratName
),
dest_name_summary AS (
  -- Collapses same-named destination Quadrat rows so a duplicate name is
  -- reported (ambiguous_destination_names) instead of silently picking one.
  SELECT QuadratName, COUNT(*) AS row_count, MIN(OriginPX) AS OriginPX, MIN(OriginPY) AS OriginPY
  FROM dest_origins
  GROUP BY QuadratName
),
app_name_summary AS (
  SELECT QuadratName, COUNT(*) AS row_count, MIN(StartX) AS StartX, MIN(StartY) AS StartY
  FROM quadrat_origin_app_20260909
  GROUP BY QuadratName
),
matched_names AS (
  -- A name counts as matched only when it is unambiguous on BOTH sides —
  -- an ambiguous name is reported via ambiguous_destination_names /
  -- ambiguous_app_names instead, never silently matched to one of its rows.
  SELECT d.QuadratName, d.OriginPX, d.OriginPY, a.StartX, a.StartY
  FROM dest_name_summary d
  JOIN app_name_summary a ON a.QuadratName = d.QuadratName
  WHERE d.row_count = 1 AND a.row_count = 1
)
-- ORIGIN CTES END
SELECT d.QuadratName, d.OriginPX, d.OriginPY
FROM dest_name_summary d
WHERE NOT EXISTS (SELECT 1 FROM app_name_summary a WHERE a.QuadratName = d.QuadratName)
ORDER BY d.QuadratName
LIMIT 50;

-- Sample (up to 50): names that are ambiguous (more than one row for that
-- name) on the destination side, the app side, or both.
-- ORIGIN CTES START
WITH dest_origins AS (
  -- MIN(PX)/MIN(PY) per QuadratID: several Coordinates rows describe one
  -- quadrat (its corners) — same reduction the ctfsweb migration used and
  -- the backfill script documents.
  SELECT q.QuadratID, q.QuadratName, MIN(c.PX) AS OriginPX, MIN(c.PY) AS OriginPY
  FROM Quadrat q
  LEFT JOIN Coordinates c ON c.QuadratID = q.QuadratID
  WHERE q.PlotID = @plot_id
  GROUP BY q.QuadratID, q.QuadratName
),
dest_name_summary AS (
  -- Collapses same-named destination Quadrat rows so a duplicate name is
  -- reported (ambiguous_destination_names) instead of silently picking one.
  SELECT QuadratName, COUNT(*) AS row_count, MIN(OriginPX) AS OriginPX, MIN(OriginPY) AS OriginPY
  FROM dest_origins
  GROUP BY QuadratName
),
app_name_summary AS (
  SELECT QuadratName, COUNT(*) AS row_count, MIN(StartX) AS StartX, MIN(StartY) AS StartY
  FROM quadrat_origin_app_20260909
  GROUP BY QuadratName
),
matched_names AS (
  -- A name counts as matched only when it is unambiguous on BOTH sides —
  -- an ambiguous name is reported via ambiguous_destination_names /
  -- ambiguous_app_names instead, never silently matched to one of its rows.
  SELECT d.QuadratName, d.OriginPX, d.OriginPY, a.StartX, a.StartY
  FROM dest_name_summary d
  JOIN app_name_summary a ON a.QuadratName = d.QuadratName
  WHERE d.row_count = 1 AND a.row_count = 1
)
-- ORIGIN CTES END
SELECT QuadratName, 'destination' AS ambiguous_side, row_count
FROM dest_name_summary
WHERE row_count > 1
UNION ALL
SELECT QuadratName, 'app' AS ambiguous_side, row_count
FROM app_name_summary
WHERE row_count > 1
ORDER BY QuadratName
LIMIT 50;

-- Sample (up to 50): matched names whose origin disagrees on an axis by more
-- than @origin_tolerance.
-- ORIGIN CTES START
WITH dest_origins AS (
  -- MIN(PX)/MIN(PY) per QuadratID: several Coordinates rows describe one
  -- quadrat (its corners) — same reduction the ctfsweb migration used and
  -- the backfill script documents.
  SELECT q.QuadratID, q.QuadratName, MIN(c.PX) AS OriginPX, MIN(c.PY) AS OriginPY
  FROM Quadrat q
  LEFT JOIN Coordinates c ON c.QuadratID = q.QuadratID
  WHERE q.PlotID = @plot_id
  GROUP BY q.QuadratID, q.QuadratName
),
dest_name_summary AS (
  -- Collapses same-named destination Quadrat rows so a duplicate name is
  -- reported (ambiguous_destination_names) instead of silently picking one.
  SELECT QuadratName, COUNT(*) AS row_count, MIN(OriginPX) AS OriginPX, MIN(OriginPY) AS OriginPY
  FROM dest_origins
  GROUP BY QuadratName
),
app_name_summary AS (
  SELECT QuadratName, COUNT(*) AS row_count, MIN(StartX) AS StartX, MIN(StartY) AS StartY
  FROM quadrat_origin_app_20260909
  GROUP BY QuadratName
),
matched_names AS (
  -- A name counts as matched only when it is unambiguous on BOTH sides —
  -- an ambiguous name is reported via ambiguous_destination_names /
  -- ambiguous_app_names instead, never silently matched to one of its rows.
  SELECT d.QuadratName, d.OriginPX, d.OriginPY, a.StartX, a.StartY
  FROM dest_name_summary d
  JOIN app_name_summary a ON a.QuadratName = d.QuadratName
  WHERE d.row_count = 1 AND a.row_count = 1
)
-- ORIGIN CTES END
SELECT
  d.QuadratName,
  a.StartX,
  a.StartY,
  d.OriginPX,
  d.OriginPY,
  (a.StartX - d.OriginPX) AS DiffX,
  (a.StartY - d.OriginPY) AS DiffY
FROM dest_name_summary d
JOIN app_name_summary a ON a.QuadratName = d.QuadratName
WHERE d.row_count = 1 AND a.row_count = 1
  AND (
    (d.OriginPX IS NOT NULL AND a.StartX IS NOT NULL AND ABS(d.OriginPX - a.StartX) > @origin_tolerance)
    OR (d.OriginPY IS NOT NULL AND a.StartY IS NOT NULL AND ABS(d.OriginPY - a.StartY) > @origin_tolerance)
  )
ORDER BY d.QuadratName
LIMIT 50;

-- SECTION: cleanup

DROP TABLE IF EXISTS quadrat_origin_app_20260909;
