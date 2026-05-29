# CTFS Export Pivot: App-Generated SQL Artifact - Design

**Date:** 2026-05-19
**Status:** Designed; supersedes [2026-05-18-csv-to-sql-v2-design.md](2026-05-18-csv-to-sql-v2-design.md) for the destination procedure shape; introduces an app-side export endpoint that did not exist before.
**Author:** brainstormed with Claude after senior-dev code review of `feat/csv-to-sql-v2`.
**Predecessor:** v2 design (2026-05-18) attempted to consume the legacy ctfsweb measurement CSV format and re-derive every decision in destination SQL. This pivot moves the decisions back into the app, where the validated data already lives, and reduces the destination to identity reconciliation and bulk inserts.

## Problem

The current `feat/csv-to-sql-v2` branch consumes a 10-column CSV (`tag, stemtag, spcode, quadrat, lx, ly, dbh, hom, date, codes`) — the historical ctfsweb measurement export format. That CSV deliberately drops every decision the app's validation pipeline made: tree/stem identity, O/M/N classification, HOM inheritance, resprout look-back, code parsing, DBH=0 semantics. v2 re-derives all of it in ~1000 lines of MySQL inside a generated stored procedure.

The app's schema (`frontend/sqlscripting/tablestructures.sql:666-748`) already carries most of what v2 re-derives: validated measurements in `coremeasurements` with resolved `MeasuredDBH`/`MeasuredHOM`, identity in `trees`/`stems`, taxonomy in `species`/`genus`/`family`, and materialized codes in `cmattributes`. The important exception is CTFS `DBH.PrimaryStem`: Suzanne confirmed that `main` / `secondary` are not consistently represented as CTFS TSM attribute descriptions and most sites do not have those attributes now. The export must therefore **not** infer `DBH.PrimaryStem` from `cmattributes` descriptions. MVP behavior is `DBH.PrimaryStem = NULL` unless a future explicit app field or site-specific mapping is added.

This pivot eliminates the lossy intermediate. The app emits the destination artifact directly from validated data.

## Architecture

Two layers:

1. **App side** — a new Next.js endpoint reads validated `coremeasurements` for a target `(PlotID, CensusID)` and emits a self-contained `.sql` artifact that targets the on-prem CTFS schema.
2. **Destination side** — a slimmed-down version of the v2 stored procedure runs on the on-prem CTFS MySQL, doing only destination identity reconciliation (Tag/StemTag → CTFS TreeID/StemID) and bulk inserts. The procedure has a unique generated name per artifact so concurrent operators don't clobber each other's `CREATE PROCEDURE`.

The destination procedure is ephemeral (DROP/CREATE/CALL/DROP within the artifact, transaction-wrapped, EXIT HANDLER for rollback) — same envelope as v2 but with a per-artifact name and a much smaller body.

Operator workflow: in the app, choose a finished census → choose the destination CTFSWeb `PlotID` (usually `1`, but not assumed) → click "Export to CTFS" → download `.sql` → run against the on-prem MySQL.

## Identity Fold

The app and CTFS have different identity models. This section is load-bearing — get the language wrong and downstream code makes invalid assumptions.

- App `trees(TreeID, TreeTag, SpeciesID, CensusID)` is **per-census**. Same physical tree appears as a new `trees` row per census. Uniqueness is `(TreeTag, SpeciesID, CensusID)`.
- App `stems(StemGUID, TreeID, StemTag, CensusID, ...)` is **per-census**. Uniqueness is `(TreeID, StemTag, CensusID)`.
- CTFS `Tree(TreeID, Tag, SpeciesID, ...)` is **identity-only** across all censuses.
- CTFS `Stem(StemID, TreeID, StemTag, ...)` is **identity-only** across all censuses; `DBH` carries the census.

**Fold direction:** the app projects each census-scoped row into CTFS natural keys (`Tag`, `StemTag`, `Mnemonic`, `QuadratName`, `TSMCode`, `PlotCensusNumber`). The destination procedure does the per-key lookup and folds the projected rows against existing CTFS `Tree`/`Stem` rows by natural-key equality.

**The app does not pre-resolve cross-census CTFS identity.** Doing so would require a deliberate `ctfs_identity_map` table in the app that pairs app-side identity with CTFS-side identity for a specific destination DB; that table does not exist and is out of scope for this work. The destination is authoritative for its own primary keys.

**App `PlotID` is not CTFS `PlotID`.** In normal app provisioning, `plots.PlotID` is an app-local MySQL `AUTO_INCREMENT` value. Some historical migration paths preserved legacy CTFS `Site.PlotID`, but the app model does not guarantee that equality. Suzanne confirmed that the important behavior is matching an existing CTFSWeb `PlotID`, not creating a new one; in most CTFSWeb databases that value is `1`. The MVP therefore makes the researcher/operator choose the **destination CTFS `PlotID`** explicitly (the UI may prefill `1`), and the generated SQL refuses to run unless that `PlotID` already has the target `Census.PlotCensusNumber`. The destination Stage 0 census guard uses `(destinationPlotID, PlotCensusNumber)`, never the app `plotID` route segment.

## App-Side Export Endpoint

**Route:** `/api/export/ctfs-sql/[schema]/[plotID]/[censusID]` — a dedicated route, **not** under `app/api/formdownload`. The `formdownload` endpoint is a JSON form-export with filter semantics; a CTFS `.sql` export has different auth, options, content-type, filename, and operator workflow.

**Method:** `GET` returning `application/sql` with `Content-Disposition: attachment; filename=ctfs-export-<plot>-<census>-<ts>.sql`.

**Query params:**

| Param | Required | Notes |
|---|---:|---|
| `destinationPlotID` | yes | Existing CTFS destination `Census.PlotID`. The UI may prefill `1`, but must not silently reuse the app `plotID`; the values are not guaranteed to match. Future work can replace this with a stored per-site mapping. |
| `allowReload` | no | Boolean. Bakes `--allow-reload` semantics into the generated artifact. |
| `reloadDryRun` | no | Boolean. Generates a dry-run artifact (Section "Reload Semantics"). Implies `allowReload`. |

**Precondition — "Finished Census":** the endpoint refuses to export if any of these hold for `coremeasurements` rows in scope:

1. `IsValidated IS NOT TRUE` (rejects both `FALSE` and `NULL` — do not implement this as `IsValidated <> TRUE`, because SQL three-valued logic would let `NULL` through).
2. An unresolved row exists in `measurement_error_log` for the measurement (`COALESCE(IsResolved, FALSE) = FALSE`).
3. `StemGUID IS NULL` (a failure marker per the existing data model).
4. The joined `stems` or `trees` row has `IsActive = 0` or `DeletedAt IS NOT NULL`.
5. Any exported `cmattributes.Code` does not resolve to an active row in the app `attributes` table. This should be impossible after validation, but the app has no FK from `cmattributes.Code` to `attributes.Code`, so the export endpoint must defend the artifact boundary.
6. A species row is missing the taxonomy fields needed to attempt destination lookup: app `SpeciesCode`, `SpeciesName`, `Genus`, and `Family`; for subspecies rows, app `SubspeciesName` must also be present. Suzanne confirmed several sites use CTFS `SubSpecies`, so rows with subspecies must be exported with a real `SubSpeciesID` lookup, not rejected by default and not silently written as `NULL`.
7. Any destination-bound value exceeds the legacy CTFS column width: `Tree.Tag` 10 chars, `Stem.StemTag` 32 chars, `Quadrat.QuadratName` 8 chars, `TSMAttributes.TSMCode` 10 chars, `DBH.Comments` 128 chars, CTFS `Species.Mnemonic`/`SubSpecies.Mnemonic` 10 chars, taxonomy names 64 chars, taxonomy authorities 128 chars. Fail in the app before generating SQL so the researcher gets row-level feedback.
8. Zero exportable rows remain after the above filters.

Each rejection returns HTTP 400 with a structured body listing the disqualifying CoreMeasurementIDs (capped at a reasonable display count). Operators must fix in the app first.

**Security and audit requirements:**

- The route must require an authenticated app session and must verify the user can access the requested `schema`, `plotID`, and `censusID`.
- `allowReload` is destructive on the destination database. Generating an `allowReload=true` artifact requires an elevated export/admin permission, not ordinary view access.
- `reloadDryRun=true` may be available to the same users who can export, because it does not persist destination changes, but it still exposes destination table names and should be treated as operational access.
- Suzanne's initial answer is "the PI or data manager of each plot" for export/reload authority, with Jess/David asked to confirm. Treat exact role mapping as unresolved until the app permission model is chosen.
- The app should write an audit event when an artifact is generated: user id, schema, source app `PlotID`, destination CTFS `PlotID`, `CensusID`, `PlotCensusNumber`, row count, options, and filename.

**Output structure:** the generated `.sql` file has these sections in order:

1. **Header comment** — generation timestamp, source app schema, source app `PlotID`, destination CTFS `PlotID`, app `CensusID`, `PlotCensusNumber`, row count, options. Timestamp lives only in this header so deterministic tests can normalize it.
2. **Procedure envelope opener** — `DROP PROCEDURE IF EXISTS <unique_name>; DELIMITER //; CREATE PROCEDURE <unique_name>() ...`. The unique name is `csv_to_sql_v2_load_<destinationPlotId>_<safeCensusSlug>_<shortRandom>` where `safeCensusSlug` is an identifier-safe slug derived from `PlotCensusNumber` (non `[A-Za-z0-9_]` chars replaced; length capped) and `shortRandom` is an 8-character hex suffix produced by `crypto.randomBytes(4).toString('hex')` at endpoint-generation time. Never interpolate raw `PlotCensusNumber` into a procedure identifier; legacy CTFS declares it as `char(16)` and sites may use non-identifier labels. The suffix prevents `DROP PROCEDURE` / `CREATE PROCEDURE` collisions between concurrent exports.
3. **Scalar/cursor DECLAREs** — much smaller set than v2 (no cursors needed at all under the set-based design).
4. **`GET_LOCK('ctfs-export:<destinationPlotId>:<PlotCensusNumber>', 0)`** — fails fast if another export is mutating the same destination `(plot, census)`. The lock name is a SQL string literal with normal string escaping, not an identifier. The lock covers data mutation only; the unique procedure name handles DDL-collision concerns separately.
5. **`START TRANSACTION` + `EXIT HANDLER FOR SQLEXCEPTION`** — rollback + `RELEASE_LOCK` + RESIGNAL.
6. **Stage 0 — census guard + reload behavior** (see Section "Reload Semantics").
7. **Stage 1 — two temporary staging tables**:
   - `staging_measurements` — one row per `coremeasurements` row, with pre-resolved fields plus traceability columns.
   - `staging_attributes` — one row per active `cmattributes` entry, referencing `staging_measurements` by app-side `CoreMeasurementID`.
8. **Stage 1 INSERTs** — chunked at 1000 rows per multi-row VALUES tuple, mirroring v1's chunk strategy.
9. **Stage 2 — destination identity lookup** (Section "Destination Procedure").
10. **Stage 5 — contract checks** (Section "Destination Procedure").
11. **Stages 6 / 7 / 8 / 9** — set-based bulk inserts (Section "Destination Procedure").
12. **Stage 10 — final tally** + `RELEASE_LOCK` on the success path.
13. **Procedure envelope closer** — `COMMIT; END //; DELIMITER ;; CALL <unique_name>(); DROP PROCEDURE <unique_name>;`.

**Staging row shape:**

`staging_measurements` columns:
- Traceability: `TempID` (autoinc PK), `CoreMeasurementID` (from app), `SourceRowIndex` (from app's original CSV row index if present).
- Natural keys for destination lookup: `Tag`, `StemTag`, `Mnemonic` (from app `species.SpeciesCode`), `QuadratName`, `PlotCensusNumber`.
- Taxonomy lookup context: `Family`, `Genus`, `SpeciesName`, `SpeciesAuthority`, `SubspeciesName`, `SubspeciesAuthority`, `IDLevel`. These are needed because CTFS uses separate `Family`, `Genus`, `Species`, and `SubSpecies` tables, and Suzanne confirmed several sites actively use subspecies on `Tree` rows.
- Resolved fields from app: `DBH` (already null if zero, already validated), `HOM` (already chosen — no inheritance needed), `ExactDate`, `Comments`, `LX`, `LY`, `PrimaryStem` (`NULL` in the MVP; not inferred from TSM descriptions).
- Destination-resolved holes (populated by Stage 2): `TreeID`, `StemID`, `SpeciesID`, `SubSpeciesID`, `QuadratID`, `CensusID`, `DBHID`.
- Error reporting: `Errors VARCHAR(256)` for SELECT-then-SIGNAL.

`staging_attributes` columns:
- `TempAttrID` (autoinc PK), `CoreMeasurementID` (app-side, for tracing), `TempMeasurementID` (FK-like reference to `staging_measurements.TempID`), `TSMCode` (resolved by Stage 2 to `TSMID`), `TSMID` (populated by Stage 2), `DBHID` (populated by Stage 8).

The app emits both tables' INSERTs from the same query result set (one query returns measurements joined with attributes; the export TS code splits the rows into the two staging tables).

**PrimaryStem and attributes:** app ingestion materializes every valid uploaded code into `cmattributes`; it does not store a separate app-side `PrimaryStem`. Suzanne confirmed that `main` / `secondary` are not consistently represented in CTFS `TSMAttributes` and most sites do not have them. Therefore the MVP does not split marker codes and does not derive `PrimaryStem` from app `attributes.Description`:

- `DBH.PrimaryStem` is inserted as `NULL`.
- Every active app `cmattributes.Code` becomes a `staging_attributes` row and must resolve to a CTFS `TSMAttributes.TSMCode`.
- A future enhancement can add an explicit app `PrimaryStem` field or a site-specific mapping if CTFSWeb users still need `DBH.PrimaryStem` populated.

## Destination Procedure

The destination procedure is intentionally narrow: identity reconciliation against CTFS, contract validation, and bulk inserts. Every stage that re-derived data in v2 is removed.

### Stage 0 — Census guard

Same as v2 in shape, but the `PlotID` value is the explicit destination CTFS `PlotID`, not the app `plotID`: `SELECT COUNT(*), MIN(CensusID), MIN(StartDate)` for `(destinationPlotID, PlotCensusNumber)`. SIGNAL if the pair doesn't resolve to exactly one Census row. Populates `@target_census_id`, `@target_plot_id`, `@target_start_date`.

Suzanne confirmed the CTFSWeb databases use the newer `DBHAttributes` schema from `DBCHANGES2014f.sql`, where `DBHAttributes` has `DBHID` and `TSMID` and no `CensusID`. The generated artifact should therefore target the new shape directly and should not carry the older dual-schema capability probe.

### Stage 0b — Reload behavior

See Section "Reload Semantics" below for the full reload-mode design (dry-run, real-run count emission, no-default orphan deletion).

### Stage 1 — Staging tables

Both temp tables created with `ENGINE=InnoDB` so they participate in the transaction's MVCC. App-emitted INSERTs populate them.

### Stage 2 — Destination identity lookup

Set-based UPDATEs:

```sql
UPDATE staging_measurements SET CensusID = @target_census_id;

UPDATE staging_measurements t
  JOIN Quadrat q ON q.QuadratName = t.QuadratName AND q.PlotID = @target_plot_id
  SET t.QuadratID = q.QuadratID;

-- Taxonomy lookup through Family -> Genus -> Species -> SubSpecies.
-- Subspecies rows must produce a non-NULL SubSpeciesID.
DROP TEMPORARY TABLE IF EXISTS taxonomy_lookup;
CREATE TEMPORARY TABLE taxonomy_lookup AS
  SELECT t.TempID,
         MIN(sp.SpeciesID) AS SpeciesID,
         MIN(ss.SubSpeciesID) AS SubSpeciesID,
         COUNT(DISTINCT CONCAT(sp.SpeciesID, ':', COALESCE(ss.SubSpeciesID, 0))) AS TaxonCount
    FROM staging_measurements t
    JOIN Family fam ON fam.Family = t.Family
    JOIN Genus gen ON gen.Genus = t.Genus AND gen.FamilyID = fam.FamilyID
    JOIN Species sp ON sp.GenusID = gen.GenusID
                   AND sp.SpeciesName = t.SpeciesName
                   AND sp.CurrentTaxonFlag = 1
    LEFT JOIN SubSpecies ss ON ss.SpeciesID = sp.SpeciesID
                           AND ss.SubSpeciesName = t.SubspeciesName
                           AND ss.CurrentTaxonFlag = 1
   WHERE (t.SubspeciesName IS NULL AND ss.SubSpeciesID IS NULL)
      OR (t.SubspeciesName IS NOT NULL AND ss.SubSpeciesID IS NOT NULL)
   GROUP BY t.TempID;

UPDATE staging_measurements t
  JOIN taxonomy_lookup tx ON tx.TempID = t.TempID AND tx.TaxonCount = 1
  SET t.SpeciesID = tx.SpeciesID,
      t.SubSpeciesID = tx.SubSpeciesID;

-- Tree lookup (CTFS Tree has no PlotID; scope via Stem -> Quadrat -> Plot)
DROP TEMPORARY TABLE IF EXISTS tree_lookup;
CREATE TEMPORARY TABLE tree_lookup AS
  SELECT tr.Tag,
         tr.SpeciesID,
         tr.SubSpeciesID,
         MIN(tr.TreeID) AS TreeID,
         COUNT(DISTINCT tr.TreeID) AS TreeCount
    FROM Tree tr
    JOIN Stem s ON s.TreeID = tr.TreeID
    JOIN Quadrat q ON q.QuadratID = s.QuadratID
   WHERE q.PlotID = @target_plot_id
   GROUP BY tr.Tag, tr.SpeciesID, tr.SubSpeciesID;

UPDATE staging_measurements t
  JOIN tree_lookup tl ON tl.Tag = t.Tag
                     AND tl.SpeciesID = t.SpeciesID
                     AND tl.SubSpeciesID <=> t.SubSpeciesID
                     AND tl.TreeCount = 1
  SET t.TreeID = tl.TreeID;

-- Stem lookup (also plot-scoped)
DROP TEMPORARY TABLE IF EXISTS stem_lookup;
CREATE TEMPORARY TABLE stem_lookup AS
  SELECT s.TreeID, s.StemTag, MIN(s.StemID) AS StemID, COUNT(*) AS StemCount
    FROM Stem s
    JOIN Quadrat q ON q.QuadratID = s.QuadratID
   WHERE q.PlotID = @target_plot_id
   GROUP BY s.TreeID, s.StemTag;

UPDATE staging_measurements t
  JOIN stem_lookup sl ON sl.TreeID = t.TreeID
                     AND sl.StemTag <=> t.StemTag
                     AND sl.StemCount = 1
  SET t.StemID = sl.StemID;

-- TSMID resolution for attributes
UPDATE staging_attributes a
  JOIN TSMAttributes tsm ON tsm.TSMCode = a.TSMCode
  SET a.TSMID = tsm.TSMID;
```

No Stage 2b. No resprout look-back. No O/M/N classification.

### Stage 5 — Contract checks

Destination-contract checks (not general data-validity checks — the app already did those). Each writes per-row reason into the `Errors` column on the affected staging rows, then a single SELECT-then-SIGNAL at the end emits the full failure set:

1. **Required-field NOT NULL** on `staging_measurements`: `Tag`, `StemTag`, `Mnemonic`, `QuadratName`, `ExactDate`. (Destination contract: CTFS-side load requires these.)
2. **Taxonomy lookup resolved exactly once**: every row must resolve to exactly one CTFS `(SpeciesID, SubSpeciesID)` combination. This includes both ordinary species rows and subspecies rows; unknown or ambiguous taxonomy is a destination-contract failure.
3. **Tree-key uniqueness on the destination plot**: `tree_lookup.TreeCount > 1` for any referenced `(Tag, SpeciesID, SubSpeciesID)`. CTFS DDL has no direct `Tree.PlotID`; existing trees are scoped through `Stem -> Quadrat -> Plot`. Suzanne confirmed Panama has overlapping tree tags across plots, so global `Tree.Tag` uniqueness is invalid.
4. **Stem uniqueness on the destination tree**: `stem_lookup.StemCount > 1` for any referenced `(TreeID, StemTag)`.
5. **Unknown quadrat** on CTFS Quadrat.
6. **Unknown TSMCode** on CTFS TSMAttributes (joined via `staging_attributes`).
7. **No duplicate `(StemID, CensusID)`** destinations within the batch.
8. **`(TreeID, StemTag, QuadratID)` uniqueness among new-stem rows** (where `StemID IS NULL` after Stage 2) — required so Stage 7's join-back is unambiguous.
9. **No pre-existing orphan Tree for new tree keys**: before Stage 6 inserts a new CTFS `Tree`, fail if a matching `Tree(Tag, SpeciesID, SubSpeciesID)` already exists with no `Stem` rows. Such a row cannot be plot-scoped through `Quadrat`, and Stage 6's inserted-tree join-back would be ambiguous. Matching trees in other plots that already have stems must not block the load.
10. **Destination string lengths** as a second line of defense: enforce CTFS widths for `Tag`, `StemTag`, `QuadratName`, `TSMCode`, `Comments`, and taxonomy strings even though the app endpoint should have rejected these earlier.

All checks run; all populate `Errors`; one SIGNAL at the end with a `SELECT TempID, CoreMeasurementID, SourceRowIndex, Tag, StemTag, Mnemonic, QuadratName, Errors FROM staging_measurements WHERE Errors IS NOT NULL ORDER BY TempID` immediately preceding the SIGNAL. Same pattern for `staging_attributes` errors. The `_message` is short and stable ("Validation failed; see prior SELECT for per-row details") — no `LEFT(_, 128)` truncation.

### Stage 6 — Bulk insert new Trees

```sql
INSERT INTO Tree (Tag, SpeciesID, SubSpeciesID)
  SELECT nt.Tag, nt.SpeciesID, nt.SubSpeciesID
    FROM (
      SELECT Tag, SpeciesID, SubSpeciesID, MIN(TempID) AS first_temp_id
        FROM staging_measurements
       WHERE TreeID IS NULL
       GROUP BY Tag, SpeciesID, SubSpeciesID
    ) nt
   ORDER BY nt.first_temp_id;  -- deterministic insert order

UPDATE staging_measurements t
  JOIN Tree tr ON tr.Tag = t.Tag
              AND tr.SpeciesID = t.SpeciesID
              AND tr.SubSpeciesID <=> t.SubSpeciesID
  LEFT JOIN Stem existing_stem ON existing_stem.TreeID = tr.TreeID
  SET t.TreeID = tr.TreeID
  WHERE t.TreeID IS NULL
    AND existing_stem.StemID IS NULL;
```

The join-back deliberately uses the newly inserted no-stem `Tree` row rather than global `(Tag, SpeciesID, SubSpeciesID)` uniqueness. This is required because Suzanne confirmed some CTFS databases, especially Panama, can have the same tag in different plots. Stage 5 must fail first if a matching orphan `Tree` already exists, because an orphan cannot be scoped to a plot.

### Stage 7 — Bulk insert new Stems

```sql
INSERT INTO Stem (TreeID, StemTag, QuadratID, StemNumber, QX, QY)
  SELECT TreeID, StemTag, QuadratID, 0, LX, LY
    FROM staging_measurements
    WHERE StemID IS NULL
    ORDER BY TempID;

UPDATE staging_measurements t
  JOIN Stem s ON s.TreeID = t.TreeID
              AND s.StemTag <=> t.StemTag
              AND s.QuadratID = t.QuadratID
  SET t.StemID = s.StemID
  WHERE t.StemID IS NULL;
```

`StemNumber = 0` is the legacy ctfsweb convention; documented as a named constant `LEGACY_DEFAULT_STEM_NUMBER` in the rendering TS code.

### Stage 8 — Bulk insert DBH

```sql
INSERT INTO DBH (MeasureID, StemID, CensusID, DBH, HOM, PrimaryStem, ExactDate, Comments)
  SELECT 0, StemID, @target_census_id, DBH, HOM, PrimaryStem, ExactDate, Comments
    FROM staging_measurements
    ORDER BY TempID;

UPDATE staging_measurements t
  JOIN DBH d ON d.StemID = t.StemID AND d.CensusID = @target_census_id
  SET t.DBHID = d.DBHID;
```

`MeasureID = 0` is the legacy ctfsweb convention; `LEGACY_DEFAULT_MEASURE_ID` constant.

### Stage 9 — Bulk insert DBHAttributes

```sql
UPDATE staging_attributes a
  JOIN staging_measurements m ON m.TempID = a.TempMeasurementID
  SET a.DBHID = m.DBHID;

INSERT INTO DBHAttributes (TSMID, DBHID)
  SELECT TSMID, DBHID
    FROM staging_attributes
    WHERE DBHID IS NOT NULL AND TSMID IS NOT NULL
    ORDER BY TempAttrID;
```

Suzanne confirmed all target CTFSWeb databases use the newer `DBHAttributes` shape. The canonical fixture for this work should apply `DBCHANGES2014f.sql` or otherwise drop `DBHAttributes.CensusID` so tests match production.

### Stage 10 — Final tally

```sql
SELECT
  (SELECT COUNT(*) FROM staging_measurements) AS measurement_rows,
  (SELECT COUNT(*) FROM staging_attributes)   AS attribute_rows,
  (SELECT COUNT(DISTINCT TreeID) FROM staging_measurements) AS tree_count,
  (SELECT COUNT(DISTINCT StemID) FROM staging_measurements) AS stem_count;
SELECT RELEASE_LOCK('ctfs-export:<destinationPlotId>:<PlotCensusNumber>');
```

Intent is one-result-set summary the operator can paste into a ticket: how many measurements landed, how many attribute rows, distinct trees and stems touched.

### Post-load — ViewFullTable handling

Suzanne confirmed that CTFSWeb had a separate step to create/rebuild `ViewFullTable` after the data had been loaded successfully, and she will provide the procedure used for that step. The artifact cannot silently stop at `Tree` / `Stem` / `DBH` / `DBHAttributes` and leave CTFSWeb's reporting table stale.

Implementation requirement: once the procedure is available, append the `ViewFullTable` rebuild step after Stage 10's successful inserts and before the final COMMIT, or emit an explicit post-load SELECT instruction if the rebuild must run outside the transaction. Until that procedure is incorporated, production release is blocked.

## Reload Semantics

`--allow-reload` semantics on the destination are deliberately narrower than the current v2:

**Default `allowReload` real run:**

1. Verify Stage 0 (census exists).
2. Emit `SELECT 'DBHAttributes to delete' AS scope, COUNT(*) AS n FROM DBHAttributes da JOIN DBH d ON d.DBHID = da.DBHID WHERE d.CensusID = @target_census_id;` (and same for DBH).
3. `DELETE` `DBHAttributes` for the target census by joining through `DBH` (`DELETE da FROM DBHAttributes da JOIN DBH d ON d.DBHID = da.DBHID WHERE d.CensusID = @target_census_id;`). This targets the newer `DBHAttributes(DBHID, TSMID)` schema Suzanne confirmed.
4. `DELETE` `DBH` for the target census.
5. **Do not delete orphan Stem/Tree rows.** Stage 0b captures the set of Stem/Tree IDs that *used to* have DBH only in the target census (before the DELETEs in steps 3-4) into a temp table `reload_orphan_candidates`. After the DELETEs, emit two count SELECTs: number of those stems now without any remaining DBH, and number of those trees now without any remaining Stem. Operator sees the orphan-candidate counts in the result stream and decides whether to prune manually outside this script. Identity-table deletion can break FK references outside this script's knowledge and changes CTFS PKs unpredictably — out of scope for default reload.
6. Continue with normal insert path.

**`reloadDryRun` mode:** the procedure body wraps Stage 0b in `SAVEPOINT reload_dry`. After emitting the count SELECTs, executes a `ROLLBACK TO SAVEPOINT reload_dry`, COMMITs the (now empty) transaction, releases lock, and returns without proceeding to Stage 1+. Operator sees what would have been deleted with proof the DELETEs are syntactically valid against the current schema.

Fatal export/load errors remain separate from reload cleanup. Suzanne noted CTFSWeb would not upload until fatal errors were fixed; the app should return structured row-level failures and may add a downloadable failure report for manual correction, but the SQL reload path itself should not attempt identity cleanup.

**Future scope (not in this pivot):** an explicit `--prune-orphans` mode that re-introduces identity-table deletion with an explicit operator opt-in.

## Generated SQL Determinism

The generated `.sql` body (everything below the header comment) is byte-deterministic for the same input. The header comment carries a generation timestamp and is the *only* nondeterministic section. Tests assert determinism by normalizing the header before comparison (strip the leading comment block delimited by `-- BEGIN HEADER` / `-- END HEADER` markers, then diff).

## Migration

**v1 (`lib/csv-to-sql.ts`):** ~90 lines after the prior refactor, mostly re-exports for "existing third-party imports." Grep confirms no callers within the repo. Deletable after this pivot lands and any out-of-repo consumers (if discovered) are notified. Out of scope for this design; tracked as a follow-up.

**v2 (`lib/csv-to-sql-v2.ts`):** the rendering library is reused by the new app endpoint. Strip the CLI entrypoint (lines 1050+) — the endpoint replaces it. Keep stage renderers that are still in use (envelope, Stage 0, Stage 1, Stage 2, Stage 5 contract subset, Stages 6/7/8 rewritten as set-based, Stage 10). Delete: `renderStage2bResprout`, `renderStage3`, the HOM-inheritance half of `renderStage4`, the data-validity half of `renderStage5`, `renderStage9PrimaryAndAttrs`. Replace it with a smaller Stage 9 renderer that inserts `staging_attributes` into the newer `DBHAttributes(TSMID, DBHID)` shape. Adjust `renderStage1`'s staging-table DDL to the two-table shape (measurements + attributes).

**Existing v2 unit tests:** keep tests for surviving stages; delete tests for deleted stages. Integration tests under `tests/integration/csv-to-sql-v2.integration.test.ts` will be largely rewritten because input CSVs are replaced by app-database fixtures.

**`CTFSWebForms` form-type in `formdownload`:** deprecate but don't delete. Operators with stale exports in flight need a grace period. Mark with a JSDoc `@deprecated use /api/export/ctfs-sql instead`.

## Testing

### App-side endpoint

- Requires authenticated access to the requested schema/plot/census; unauthorized requests return 401/403.
- Requires elevated permission for `allowReload=true`; ordinary export permission is not enough.
- Requires explicit `destinationPlotID`; it never silently reuses the app `plotID`.
- Returns 400 with structured body when any in-scope measurement has `IsValidated IS NOT TRUE`.
- Returns 400 when any in-scope measurement has unresolved `measurement_error_log`.
- Returns 400 when `StemGUID IS NULL` on any in-scope measurement.
- Returns 400 when inactive `stems` / `trees` joins exist in scope.
- Returns 400 when a `cmattributes.Code` does not resolve to an active app `attributes` row.
- Does not reject rows merely because they have `SubspeciesName`; instead, the generated artifact carries taxonomy context for destination-side `SubSpeciesID` lookup.
- Returns 400 when destination-bound strings exceed CTFS widths (`Tag`, `StemTag`, `QuadratName`, `TSMCode`, `Comments`).
- Returns 400 with "no exportable rows" when the filtered set is empty.
- Returns 404 when `(PlotID, CensusID)` does not exist.
- PrimaryStem is `NULL` in the MVP; app attributes are exported as `DBHAttributes` rows rather than being interpreted as `main` / `secondary` markers.
- Generated `.sql` body (excluding header) is byte-identical on repeat invocation with the same input.
- Procedure name slug test: non-identifier `PlotCensusNumber` values (e.g. `2024a`, `recensus-1`) are safe in comments/string literals but never raw in procedure identifiers.
- Generated `.sql` parses with `lib/provisioning/sql-runner.ts:splitSqlFile` (which handles `DELIMITER //`).
- Generated `.sql` runs successfully against `tests/fixtures/csv-to-sql-v2/canonical-ddl.sql` for a representative golden fixture (TBD during implementation).

### Destination procedure (integration)

- All Section C stages exercised against the canonical CTFS DDL fixture.
- Mid-flight rollback: tamper with a TSMAttributes row between Stage 5 and Stage 9 to fire SQLEXCEPTION after Stages 6/7/8 successfully wrote rows. Verify destination counts unchanged.
- `allowReload` real run with prior DBHAttributes: target-census `DBHAttributes` and `DBH` rows are cleaned and reloaded; orphan Stem/Tree candidates are reported via SELECT but not deleted.
- `reloadDryRun`: count SELECTs emitted, zero rows touched in any destination table.
- Concurrent-run lock: two simultaneous procedures on the same `(plotId, censusNumber)` — second SIGNALs with the lock-failure message. (Different `(plotId, censusNumber)` pairs run concurrently without issue.)
- Stage 5 contract failures: SELECT result set arrives before SIGNAL; result set contains `CoreMeasurementID`, `SourceRowIndex`, and `Errors` columns for tracing back to app rows.
- DBHAttributes insert targets the newer post-`DBCHANGES2014f.sql` schema without `CensusID`.
- Subspecies mapping: an app row with `SubspeciesName` resolves to CTFS `Tree.SubSpeciesID`; unknown or ambiguous CTFS subspecies produces a Stage 5 SELECT-then-SIGNAL failure.
- Panama overlap regression: destination contains the same `Tag` in a different plot; a new tree in the target plot inserts and joins back to the new no-stem `Tree` row, not to the other plot's existing tree.
- Tree join-back regression: a destination containing the same `Tag` in a different species/ambiguous context must fail or bind by `(Tag, SpeciesID, SubSpeciesID)`, never by Tag alone.
- ViewFullTable handling test is added once Suzanne provides the refresh procedure.

### Performance

Generate synthetic app-database fixtures at two scales: a SERC-sized 44k-row fixture and a tropical large-census fixture of at least 500k measurement rows. Suzanne noted tropical plots can have 300k-400k records and Lambir exceeded 500k records in a fourth census. Measure end-to-end wall-clock from endpoint hit to destination COMMIT and record memory/artifact size. Record as **baseline**, not budget. Budget set in a follow-up after the measurement lands.

## Out of Scope (Follow-ups)

- `--prune-orphans` mode for reload (identity-table deletion with explicit opt-in).
- `ctfs_identity_map` app table for pre-resolving CTFS IDs at export time (eliminates Stage 2 entirely).
- Direct DB-to-DB push (skip the `.sql` artifact, connect to on-prem MySQL from the app).
- Explicit app-side `PrimaryStem` capture or site-specific mapping. MVP writes `DBH.PrimaryStem = NULL`.
- Deletion of `lib/csv-to-sql.ts` (v1) and its re-export shims.
- Deletion of the `CTFSWebForms` legacy CSV form-type.

## Open Questions

- **ViewFullTable rebuild procedure:** Suzanne will attach the procedure used by CTFSWeb. Incorporate it before production release.
- **PrimaryStem future behavior:** Suzanne confirmed `main` / `secondary` are not consistently present as TSM attributes. Decide later whether the app should collect explicit `PrimaryStem` data or whether `NULL` is acceptable long-term.
- **Export/reload permission mapping:** Suzanne suggested PI or data manager of each plot, with Jess/David to confirm exact roles.
- **Lock-name collision across sites:** `GET_LOCK('ctfs-export:<destinationPlotId>:<PlotCensusNumber>', 0)` is server-scoped. If multiple ForestGEO instances export to the same on-prem CTFS MySQL with overlapping destination `(PlotID, PlotCensusNumber)` pairs from different source schemas, the lock prevents serialization across sources too — which is probably what we want, but flag for verification.
- **Validation precondition completeness:** Section "App-Side Export Endpoint" lists the current disqualifiers from `measurementstatefilters.ts:17` and adjacent data-model conventions. If the app's "is this measurement truly exportable" definition evolves (e.g., new flag added to `coremeasurements`), this list must be updated. Treat the export endpoint as a consumer of a shared "exportable measurement" SQL fragment, not as the source of that definition.

## Suzanne Answers Incorporated

Received 2026-05-19:

1. Destination CTFS `PlotID` must match an existing CTFSWeb plot. Let the user choose it for MVP; most cases are `PlotID = 1`.
2. CTFSWeb databases use the newer `DBHAttributes(DBHID, TSMID)` schema without `CensusID`.
3. `main` and `secondary` are not consistently stored as TSM attribute descriptions; most sites do not have these attributes now. Do not infer `DBH.PrimaryStem` from TSM descriptions in MVP.
4. CTFSWeb had a post-load step to create/rebuild `ViewFullTable`; Suzanne will provide the procedure.
5. Several sites use subspecies. CTFS taxonomy is `Family -> Genus -> Species -> SubSpecies`; the export must support `Tree.SubSpeciesID`.
6. Some CTFS databases contain multiple plots with overlapping tree tags, especially Panama. Plot-tag should be unique within each plot, not globally.
7. Tentative export authority is plot PI or data manager; Jess/David still need to confirm exact app roles.
8. Fatal errors should be fixed before upload. The app should surface/download row-level failures for manual correction; reload should not silently prune identity rows.
9. Large tropical censuses can be 300k-400k records, and Lambir has exceeded 500k records.
