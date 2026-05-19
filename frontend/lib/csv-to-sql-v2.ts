import * as fs from 'node:fs';
import { parseArgs } from 'node:util';
import SqlString from 'sqlstring';
import {
  escapeSqlIdentifier,
  mapCsvRowToStagingRow,
  parseSharedCliArgs,
  readCsvFile,
  renderCreateStagingTable,
  renderInsertChunks,
  type SharedCliArgs,
  type StagingRow
} from './csv-to-sql-shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CliArgsV2 extends SharedCliArgs {
  allowReload: boolean;
}

export interface ProcedureEnvelopeOptions {
  cursorDeclarations: string[];
  body: string;
}

// ---------------------------------------------------------------------------
// Procedure envelope renderer
// ---------------------------------------------------------------------------

const PROCEDURE_NAME = 'csv_to_sql_v2_load';

/**
 * All scalar and cursor-fetch variable declarations for the procedure.
 * These must appear before any cursor DECLAREs in the MySQL procedure body.
 */
const SCALAR_DECLARES = [
  'DECLARE _message TEXT;',
  'DECLARE _census_count INT DEFAULT 0;',
  'DECLARE _target_census_id INT UNSIGNED;',
  'DECLARE _target_plot_id INT UNSIGNED;',
  'DECLARE _target_start_date DATE;',
  'DECLARE _done BOOL DEFAULT FALSE;',
  'DECLARE _existing_dbh_count INT DEFAULT 0;',
  'DECLARE _resprout_candidates INT DEFAULT 0;',
  'DECLARE _bad TEXT;',
  'DECLARE _new_tree_id INT UNSIGNED;',
  'DECLARE _new_stem_id INT UNSIGNED;',
  'DECLARE _new_dbh_id INT UNSIGNED;',
  'DECLARE _cur_temp_id INT UNSIGNED;',
  'DECLARE _cur_tag VARCHAR(10);',
  'DECLARE _cur_stem_tag VARCHAR(32);',
  'DECLARE _cur_species_id INT UNSIGNED;',
  'DECLARE _cur_subspecies_id INT UNSIGNED;',
  'DECLARE _cur_first_temp_id INT UNSIGNED;',
  'DECLARE _cur_tree_id INT UNSIGNED;',
  'DECLARE _cur_quadrat_id INT UNSIGNED;',
  'DECLARE _cur_x FLOAT;',
  'DECLARE _cur_y FLOAT;',
  'DECLARE _cur_dbh FLOAT;',
  'DECLARE _cur_hom VARCHAR(16);',
  'DECLARE _cur_primary_stem VARCHAR(20);',
  'DECLARE _cur_exact_date DATE;',
  'DECLARE _cur_comments VARCHAR(256);',
  'DECLARE _cur_stem_id INT UNSIGNED;'
];

/**
 * Renders the full procedure SQL envelope.
 *
 * MySQL requires declaration order inside a procedure body:
 *   1. Variable DECLAREs (scalars + fetch variables)
 *   2. Cursor DECLAREs (plain DECLARE cur_X CURSOR FOR ...)
 *   3. Handler DECLAREs (HANDLER FOR NOT FOUND, then EXIT HANDLER)
 *
 * Caller-supplied `cursorDeclarations` must be plain DECLARE...CURSOR FOR...
 * statements — no handlers. The shared CONTINUE HANDLER FOR NOT FOUND is
 * emitted here and covers all cursors declared above it.
 */
export function renderProcedureEnvelope(opts: ProcedureEnvelopeOptions): string {
  const indent = (line: string) => `  ${line}`;

  const scalars = SCALAR_DECLARES.map(indent).join('\n');
  const cursors = opts.cursorDeclarations.length > 0 ? '\n\n' + opts.cursorDeclarations.map(indent).join('\n') : '';

  return `DROP PROCEDURE IF EXISTS ${PROCEDURE_NAME};

DELIMITER //
CREATE PROCEDURE ${PROCEDURE_NAME}()
main: BEGIN
${scalars}${cursors}

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET _done = TRUE;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

${opts.body}

  COMMIT;
END //
DELIMITER ;

CALL ${PROCEDURE_NAME}();
DROP PROCEDURE ${PROCEDURE_NAME};
`;
}

// ---------------------------------------------------------------------------
// Stage 0: Census guard and reload cleanup
// ---------------------------------------------------------------------------

export interface Stage0Options {
  plotId: number;
  censusNumber: string;
  allowReload: boolean;
}

/**
 * Renders the Stage 0 procedure-body fragment.
 *
 * Always emits:
 *   - SELECT COUNT(*)/MIN() INTO scalars from Census WHERE PlotID + PlotCensusNumber
 *   - IF _census_count <> 1 THEN SIGNAL block
 *   - SET @target_census_id and @target_plot_id session variables
 *
 * Without --allow-reload: counts DBH rows for the census and SIGNALs if any exist.
 * With --allow-reload: creates scoped temp tables for affected stems/trees, then
 *   DELETEs in FK order (DBHAttributes → DBH → orphaned Stems → orphaned Trees).
 *
 * Output is indented two spaces — it is a procedure-body fragment, not a full procedure.
 */
export function renderStage0(opts: Stage0Options): string {
  const censusLit = SqlString.escape(opts.censusNumber);

  const guard = `  -- Stage 0: target census guard
  SELECT COUNT(*), MIN(CensusID), MIN(StartDate)
    INTO _census_count, _target_census_id, _target_start_date
    FROM Census
    WHERE PlotID = ${opts.plotId}
      AND PlotCensusNumber = ${censusLit};

  IF _census_count <> 1 THEN
    SET _message = CONCAT('Expected exactly one Census row for PlotID + PlotCensusNumber; found ', _census_count);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = _message;
  END IF;

  SET @target_census_id := _target_census_id;
  SET @target_plot_id := ${opts.plotId};
`;

  if (!opts.allowReload) {
    return (
      guard +
      `
  -- Stage 0b: refuse populated census (no --allow-reload)
  SELECT COUNT(*) INTO _existing_dbh_count
    FROM DBH
    WHERE CensusID = @target_census_id;

  IF _existing_dbh_count > 0 THEN
    SET _message = CONCAT('Census already loaded (', _existing_dbh_count, ' DBH rows). Pass --allow-reload to overwrite.');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = _message;
  END IF;
`
    );
  }

  return (
    guard +
    `
  -- Stage 0b: --allow-reload scoped cleanup
  CREATE TEMPORARY TABLE reload_stems_to_check AS
    SELECT DISTINCT d.StemID
      FROM DBH d
      WHERE d.CensusID = @target_census_id;

  CREATE TEMPORARY TABLE reload_trees_to_check AS
    SELECT DISTINCT s.TreeID
      FROM Stem s
      JOIN reload_stems_to_check rs ON rs.StemID = s.StemID;

  DELETE da
    FROM DBHAttributes da
    JOIN DBH d ON d.DBHID = da.DBHID
    WHERE d.CensusID = @target_census_id;

  DELETE FROM DBH WHERE CensusID = @target_census_id;

  DELETE s
    FROM Stem s
    JOIN reload_stems_to_check rs ON rs.StemID = s.StemID
    LEFT JOIN DBH remaining ON remaining.StemID = s.StemID
    WHERE remaining.DBHID IS NULL;

  DELETE tr
    FROM Tree tr
    JOIN reload_trees_to_check rt ON rt.TreeID = tr.TreeID
    LEFT JOIN Stem remaining ON remaining.TreeID = tr.TreeID
    WHERE remaining.StemID IS NULL;
`
  );
}

// ---------------------------------------------------------------------------
// Stage 1: Temporary InnoDB staging table
// ---------------------------------------------------------------------------

export interface Stage1Options {
  tempTable: string;
  stagingRows: StagingRow[];
}

/**
 * Renders the Stage 1 procedure-body fragment.
 *
 * Emits:
 *   - DROP TEMPORARY TABLE IF EXISTS + CREATE TEMPORARY TABLE ... ENGINE=InnoDB
 *   - INSERT INTO ... VALUES chunks for all staging rows
 *
 * Output is indented two spaces at the section boundary — it is a
 * procedure-body fragment, not a full procedure.
 */
export function renderStage1(opts: Stage1Options): string {
  const ddl = renderCreateStagingTable({
    tableName: opts.tempTable,
    engine: 'InnoDB',
    temporary: true
  });
  const inserts = renderInsertChunks(opts.tempTable, opts.stagingRows).join('\n');
  return `  -- Stage 1: temporary staging
${ddl}

${inserts}`;
}

// ---------------------------------------------------------------------------
// Stage 2: Lookup resolution
// ---------------------------------------------------------------------------

export interface Stage2Options {
  tempTable: string;
}

/**
 * Renders the Stage 2 procedure-body fragment.
 *
 * Emits, in order:
 *   1. UPDATE tempTable SET CensusID = @target_census_id
 *   2. UPDATE tempTable JOIN Quadrat to resolve QuadratID
 *   3. UPDATE tempTable JOIN Species (CurrentTaxonFlag = 1) to resolve SpeciesID
 *   4. CREATE TEMPORARY TABLE tree_lookup — scoped via Tree → Stem → Quadrat → @target_plot_id
 *      (Tree has no PlotID column; scope must come from the Stem/Quadrat join chain)
 *   5. UPDATE tempTable JOIN tree_lookup (TreeCount = 1) to write back TreeID
 *   6. CREATE TEMPORARY TABLE stem_lookup — scoped via Stem → Quadrat → @target_plot_id
 *   7. UPDATE tempTable JOIN stem_lookup with NULL-safe StemTag (<=>) and StemCount = 1
 *      to write back StemID
 *
 * Ambiguous matches (TreeCount > 1 or StemCount > 1) are intentionally left
 * unresolved in staging so Stage 5 can SIGNAL them.
 *
 * Output is indented two spaces — it is a procedure-body fragment, not a full procedure.
 */
export function renderStage2(opts: Stage2Options): string {
  const t = escapeSqlIdentifier(opts.tempTable);
  return `  -- Stage 2: lookup resolution
  UPDATE ${t} SET CensusID = @target_census_id;

  UPDATE ${t} t
    JOIN Quadrat q ON q.QuadratName = t.QuadratName AND q.PlotID = @target_plot_id
    SET t.QuadratID = q.QuadratID;

  UPDATE ${t} t
    JOIN Species s ON s.Mnemonic = t.Mnemonic AND s.CurrentTaxonFlag = 1
    SET t.SpeciesID = s.SpeciesID;

  CREATE TEMPORARY TABLE tree_lookup AS
    SELECT tr.Tag,
           MIN(tr.TreeID) AS TreeID,
           COUNT(DISTINCT tr.TreeID) AS TreeCount
      FROM Tree tr
      JOIN Stem s ON s.TreeID = tr.TreeID
      JOIN Quadrat q ON q.QuadratID = s.QuadratID
     WHERE q.PlotID = @target_plot_id
     GROUP BY tr.Tag;

  UPDATE ${t} t
    JOIN tree_lookup tl ON tl.Tag = t.Tag AND tl.TreeCount = 1
    SET t.TreeID = tl.TreeID;

  CREATE TEMPORARY TABLE stem_lookup AS
    SELECT s.TreeID,
           s.StemTag,
           MIN(s.StemID) AS StemID,
           COUNT(*) AS StemCount
      FROM Stem s
      JOIN Quadrat q ON q.QuadratID = s.QuadratID
     WHERE q.PlotID = @target_plot_id
     GROUP BY s.TreeID, s.StemTag;

  UPDATE ${t} t
    JOIN stem_lookup sl ON sl.TreeID = t.TreeID
                       AND sl.StemTag <=> t.StemTag
                       AND sl.StemCount = 1
    SET t.StemID = sl.StemID;
`;
}

// ---------------------------------------------------------------------------
// Stage 2b: Legacy resprout look-back
// ---------------------------------------------------------------------------

export interface Stage2bOptions {
  tempTable: string;
}

/**
 * Renders the Stage 2b procedure-body fragment.
 *
 * Mirrors the legacy ctfsweb Dataupload.php:354-400 look-back: when a staging row
 * has TreeID NOT NULL AND StemID IS NULL after Stage 2 (we know the tree but not
 * which existing stem), conditionally reuse a prior census's StemID for that stem.
 *
 * Eligibility (all must hold for reuse):
 *   1. Current row's Codes does NOT contain a stem-lost/resprout marker.
 *   2. There exists a strictly-prior census on the same plot.
 *   3. That prior census had exactly one measured stem on the tree.
 *   4. The prior measurement had no dead-code.
 *   5. Prior DBH >= 10 OR the prior measurement carried a resprout-code.
 *
 * When eligible, the most-recent eligible prior CensusID's StemID is written to
 * the staging row. Otherwise StemID stays NULL — Stage 7 will then insert a new
 * Stem (normal M-bucket path). Stage 2b never SIGNALs broadly for M rows.
 *
 * Output is indented two spaces — it is a procedure-body fragment, not a full procedure.
 */
export function renderStage2bResprout(opts: Stage2bOptions): string {
  const t = escapeSqlIdentifier(opts.tempTable);
  return `  -- Stage 2b: legacy resprout look-back (Dataupload.php:354-400)
  DROP TEMPORARY TABLE IF EXISTS resprout_codes;
  DROP TEMPORARY TABLE IF EXISTS dead_codes;
  DROP TEMPORARY TABLE IF EXISTS resprout_codes_str;
  DROP TEMPORARY TABLE IF EXISTS current_row_excluded;
  DROP TEMPORARY TABLE IF EXISTS claimed_stem_ids;
  DROP TEMPORARY TABLE IF EXISTS resprout_candidates;

  CREATE TEMPORARY TABLE resprout_codes AS
    SELECT TSMID FROM TSMAttributes WHERE LOWER(Description) LIKE '%stem lost%';

  CREATE TEMPORARY TABLE dead_codes AS
    SELECT TSMID FROM TSMAttributes WHERE LOWER(Description) LIKE '%dead%';

  CREATE TEMPORARY TABLE resprout_codes_str AS
    SELECT TSMCode FROM TSMAttributes WHERE LOWER(Description) LIKE '%stem lost%';

  CREATE TEMPORARY TABLE current_row_excluded AS
    SELECT DISTINCT t.TempID
      FROM ${t} t
      JOIN resprout_codes_str rc
        ON FIND_IN_SET(rc.TSMCode, REPLACE(t.Codes, ';', ',')) > 0
      WHERE t.TreeID IS NOT NULL AND t.StemID IS NULL;

  CREATE TEMPORARY TABLE claimed_stem_ids AS
    SELECT t.TempID, t.StemID
      FROM ${t} t
      WHERE t.StemID IS NOT NULL;

  CREATE TEMPORARY TABLE resprout_candidates AS
    SELECT t.TempID,
           prior_dbh.StemID AS PriorStemID,
           prior_c.CensusID AS PriorCensusID,
           prior_dbh.DBH    AS PriorDBH,
           (CASE WHEN EXISTS (
              SELECT 1
                FROM DBHAttributes da
                JOIN dead_codes dc ON dc.TSMID = da.TSMID
                WHERE da.DBHID = prior_dbh.DBHID
              ) THEN 1 ELSE 0 END) AS HasDeadCode,
           (CASE WHEN EXISTS (
              SELECT 1
                FROM DBHAttributes da
                JOIN resprout_codes rc ON rc.TSMID = da.TSMID
                WHERE da.DBHID = prior_dbh.DBHID
              ) THEN 1 ELSE 0 END) AS HasResproutCode
      FROM ${t} t
      JOIN Census prior_c
        ON prior_c.PlotID = @target_plot_id
       AND prior_c.CensusID <> @target_census_id
       AND (
         (prior_c.StartDate IS NOT NULL AND @target_start_date IS NOT NULL AND prior_c.StartDate < @target_start_date)
         OR (
           @target_start_date IS NULL
           AND prior_c.PlotCensusNumber REGEXP '^-?[0-9]+(\\\\.[0-9]+)?$'
         )
       )
      JOIN DBH prior_dbh
        ON prior_dbh.CensusID = prior_c.CensusID
      JOIN Stem s ON s.StemID = prior_dbh.StemID AND s.TreeID = t.TreeID
      LEFT JOIN current_row_excluded x ON x.TempID = t.TempID
      WHERE t.TreeID IS NOT NULL
        AND t.StemID IS NULL
        AND x.TempID IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM claimed_stem_ids c
           WHERE c.StemID = prior_dbh.StemID
             AND c.TempID <> t.TempID
        )
        AND (
          SELECT COUNT(DISTINCT d2.StemID)
            FROM DBH d2
            JOIN Stem s2 ON s2.StemID = d2.StemID
            WHERE d2.CensusID = prior_c.CensusID
              AND s2.TreeID = t.TreeID
        ) = 1;

  UPDATE ${t} t
    JOIN (
      SELECT TempID, PriorStemID,
             ROW_NUMBER() OVER (PARTITION BY TempID ORDER BY PriorCensusID DESC) AS rk
        FROM resprout_candidates
        WHERE HasDeadCode = 0
          AND (PriorDBH >= 10 OR HasResproutCode = 1)
    ) chosen ON chosen.TempID = t.TempID AND chosen.rk = 1
    SET t.StemID = chosen.PriorStemID;
`;
}

// ---------------------------------------------------------------------------
// Stage 3: O/M/N classification
// ---------------------------------------------------------------------------

export interface Stage3Options {
  tempTable: string;
}

/**
 * Renders the Stage 3 procedure-body fragment.
 *
 * Classifies each staging row into one of three buckets:
 *   O (Old)     — TreeID and StemID both resolved by Stage 2/2b
 *   M (Missing) — TreeID resolved but StemID still NULL (new stem on known tree)
 *   N (New)     — TreeID NULL (tree not yet in the database)
 *
 * A single UPDATE with a CASE expression writes the Tag column, which
 * later stages use to route rows into the correct insert/update path.
 *
 * Output is indented two spaces — it is a procedure-body fragment, not a full procedure.
 */
export function renderStage3(opts: Stage3Options): string {
  const t = escapeSqlIdentifier(opts.tempTable);
  return `  -- Stage 3: O/M/N classification
  UPDATE ${t} SET Tagged =
    CASE
      WHEN TreeID IS NULL THEN 'N'
      WHEN StemID IS NULL THEN 'M'
      ELSE 'O'
    END;
`;
}

// ---------------------------------------------------------------------------
// Stage 4: Cleanups + deterministic HOM inheritance
// ---------------------------------------------------------------------------

export interface Stage4Options {
  tempTable: string;
}

/**
 * Renders the Stage 4 procedure-body fragment.
 *
 * Emits, in order:
 *   1. Zero-out DBH=0 rows (treats zero as "not measured")
 *   2. Build `prior_census_order` temp table ranking prior censuses deterministically:
 *      - Primary: StartDate DESC when both target and candidate have a StartDate
 *        and candidate StartDate < target StartDate
 *      - Fallback: numeric PlotCensusNumber DESC, strictly less than target's numeric value,
 *        used only when dates cannot be compared (either side is NULL)
 *      Rows that qualify under neither ordering are excluded from the table entirely.
 *   3. Inherit HOM from the top-ranked prior census for O-tagged rows with HOM IS NULL
 *   4. Fall back to 1.3 for any remaining HOM IS NULL rows where DBH IS NOT NULL
 *
 * The numeric fallback explicitly excludes candidate PlotCensusNumber >= target's numeric
 * value to prevent look-back at higher-numbered censuses when StartDate is missing.
 *
 * Output is indented two spaces — it is a procedure-body fragment, not a full procedure.
 */
export function renderStage4(opts: Stage4Options): string {
  const t = escapeSqlIdentifier(opts.tempTable);
  return `  -- Stage 4: cleanups and deterministic HOM inheritance

  UPDATE ${t} SET DBH = NULL WHERE DBH = 0;

  DROP TEMPORARY TABLE IF EXISTS prior_census_order;
  CREATE TEMPORARY TABLE prior_census_order AS
    SELECT CensusID, StartDate, PlotCensusNumber,
           ROW_NUMBER() OVER (
             ORDER BY
               CASE WHEN StartDate IS NOT NULL AND @target_start_date IS NOT NULL
                    THEN StartDate END DESC,
               CASE WHEN PlotCensusNumber REGEXP '^-?[0-9]+(\\.{1}[0-9]+)?$'
                         AND (SELECT PlotCensusNumber FROM Census WHERE CensusID = @target_census_id) REGEXP '^-?[0-9]+(\\.{1}[0-9]+)?$'
                    THEN CAST(PlotCensusNumber AS DECIMAL(20,5)) END DESC
           ) AS rk
      FROM Census
      WHERE PlotID = @target_plot_id
        AND CensusID <> @target_census_id
        AND (
          (StartDate IS NOT NULL AND @target_start_date IS NOT NULL AND StartDate < @target_start_date)
          OR (
            (@target_start_date IS NULL OR StartDate IS NULL)
            AND PlotCensusNumber REGEXP '^-?[0-9]+(\\.{1}[0-9]+)?$'
            AND (SELECT PlotCensusNumber FROM Census WHERE CensusID = @target_census_id) REGEXP '^-?[0-9]+(\\.{1}[0-9]+)?$'
            AND CAST(PlotCensusNumber AS DECIMAL(20,5))
                < CAST((SELECT PlotCensusNumber FROM Census WHERE CensusID = @target_census_id) AS DECIMAL(20,5))
          )
        );

  UPDATE ${t} t
    JOIN (
      SELECT d.StemID, d.HOM
        FROM DBH d
        JOIN prior_census_order p ON p.CensusID = d.CensusID AND p.rk = 1
    ) prev ON prev.StemID = t.StemID
    SET t.HOM = prev.HOM
    WHERE t.HOM IS NULL AND t.DBH IS NOT NULL AND t.Tagged = 'O';

  UPDATE ${t} SET HOM = '1.3'
    WHERE HOM IS NULL AND DBH IS NOT NULL;
`;
}

// ---------------------------------------------------------------------------
// Stage 5: Eight fail-loud sanity checks
// ---------------------------------------------------------------------------

export interface Stage5Options {
  tempTable: string;
}

/**
 * Renders the Stage 5 procedure-body fragment.
 *
 * Eight sanity checks run in sequence. Each follows the same template:
 *   - SELECT GROUP_CONCAT(DISTINCT <value>) INTO _bad FROM ... WHERE <predicate>;
 *   - IF _bad IS NOT NULL THEN SIGNAL SQLSTATE '45000' with a descriptive message.
 *
 * The shared `_bad TEXT` variable declared in the procedure envelope is reset to
 * NULL before each check so a prior NULL aggregate result does not bleed into
 * the next predicate.
 *
 * Checks (in order):
 *   1. Missing required staged values (Tag/StemTag/Mnemonic/QuadratName/ExactDate)
 *   2. Unresolved QuadratID after Stage 2
 *   3. Unresolved SpeciesID after Stage 2
 *   4. Ambiguous tree lookup (tree_lookup.TreeCount > 1)
 *   5. Ambiguous stem lookup (stem_lookup.StemCount > 1)
 *   6. HOM inheritance required but no orderable prior census exists
 *   7. Unknown TSMCode tokens in staging Codes (recursive CTE split on ';';
 *      empty tokens and '*' are excluded)
 *   8. Duplicate (StemID, CensusID) DBH destinations
 *
 * Output is indented two spaces — it is a procedure-body fragment, not a full procedure.
 */
export function renderStage5(opts: Stage5Options): string {
  const t = escapeSqlIdentifier(opts.tempTable);
  return `  -- Stage 5: eight fail-loud sanity checks

  SET _bad = NULL;
  SELECT GROUP_CONCAT(DISTINCT TempID) INTO _bad
    FROM ${t}
    WHERE Tag IS NULL OR StemTag IS NULL OR Mnemonic IS NULL OR QuadratName IS NULL OR ExactDate IS NULL;
  IF _bad IS NOT NULL THEN
    SET _message = CONCAT('Missing required values in TempIDs: ', _bad);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = _message;
  END IF;

  SET _bad = NULL;
  SELECT GROUP_CONCAT(DISTINCT QuadratName) INTO _bad
    FROM ${t}
    WHERE QuadratID IS NULL;
  IF _bad IS NOT NULL THEN
    SET _message = CONCAT('Unknown quadrats: ', _bad);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = _message;
  END IF;

  SET _bad = NULL;
  SELECT GROUP_CONCAT(DISTINCT Mnemonic) INTO _bad
    FROM ${t}
    WHERE SpeciesID IS NULL;
  IF _bad IS NOT NULL THEN
    SET _message = CONCAT('Unknown species mnemonics: ', _bad);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = _message;
  END IF;

  SET _bad = NULL;
  SELECT GROUP_CONCAT(DISTINCT t.Tag) INTO _bad
    FROM ${t} t
    JOIN tree_lookup tl ON tl.Tag = t.Tag
    WHERE tl.TreeCount > 1;
  IF _bad IS NOT NULL THEN
    SET _message = CONCAT('Ambiguous tree tags: ', _bad);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = _message;
  END IF;

  SET _bad = NULL;
  SELECT GROUP_CONCAT(DISTINCT CONCAT(t.Tag, '/', COALESCE(t.StemTag, 'NULL'))) INTO _bad
    FROM ${t} t
    JOIN stem_lookup sl ON sl.TreeID = t.TreeID AND sl.StemTag <=> t.StemTag
    WHERE sl.StemCount > 1;
  IF _bad IS NOT NULL THEN
    SET _message = CONCAT('Ambiguous stem lookup: ', _bad);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = _message;
  END IF;

  SET _bad = NULL;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM ${t} WHERE Tagged = 'O')
              AND (SELECT COUNT(*) FROM prior_census_order) = 0
              THEN 'no orderable prior census' END INTO _bad;
  IF _bad IS NOT NULL THEN
    SET _message = CONCAT('HOM inheritance requires prior census ordering but no orderable prior census exists for plot: ', _bad);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = _message;
  END IF;

  -- Precompute max token count in a session variable so the recursive CTE
  -- only references the TEMPORARY staging table ONCE — MySQL forbids reopening
  -- a TEMPORARY table within a single statement (ER_CANT_REOPEN_TABLE).
  SELECT COALESCE(MAX(LENGTH(Codes) - LENGTH(REPLACE(Codes, ';', '')) + 1), 1)
    INTO @max_code_tokens
    FROM ${t}
    WHERE Codes IS NOT NULL;

  SET _bad = NULL;
  WITH RECURSIVE numbers AS (
    SELECT 1 AS n
    UNION ALL
    SELECT n + 1 FROM numbers WHERE n < @max_code_tokens
  ),
  exploded AS (
    SELECT t.TempID,
           TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(t.Codes, ';', n.n), ';', -1)) AS token
      FROM ${t} t
      JOIN numbers n
        ON n.n <= LENGTH(t.Codes) - LENGTH(REPLACE(t.Codes, ';', '')) + 1
      WHERE t.Codes IS NOT NULL AND t.Codes <> ''
  )
  SELECT GROUP_CONCAT(DISTINCT e.token) INTO _bad
    FROM exploded e
    LEFT JOIN TSMAttributes tsm ON tsm.TSMCode = e.token
    WHERE tsm.TSMID IS NULL AND e.token NOT IN ('', '*');
  IF _bad IS NOT NULL THEN
    SET _message = CONCAT('Unknown TSMCodes: ', _bad);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = _message;
  END IF;

  SET _bad = NULL;
  SELECT GROUP_CONCAT(DISTINCT pair) INTO _bad
    FROM (
      SELECT CONCAT(StemID, '/', CensusID) AS pair
        FROM ${t}
        WHERE StemID IS NOT NULL AND CensusID IS NOT NULL
        GROUP BY StemID, CensusID
        HAVING COUNT(*) > 1
    ) dup;
  IF _bad IS NOT NULL THEN
    SET _message = CONCAT('Duplicate (StemID, CensusID) DBH destinations: ', _bad);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = _message;
  END IF;
`;
}

// ---------------------------------------------------------------------------
// Stage 6: Cursor-driven new Tree inserts
// ---------------------------------------------------------------------------

export interface CursorStageResult {
  cursorDeclaration: string;
  body: string;
}

/**
 * Renders the Stage 6 cursor declaration and body fragment.
 *
 * The cursor declaration is bare (no handler) — the envelope emits the single
 * shared CONTINUE HANDLER FOR NOT FOUND after all cursor declarations.
 *
 * The body:
 *   - Opens cur_new_trees, iterating over DISTINCT (Tag, SpeciesID, SubSpeciesID)
 *     rows where Tagged = 'N', ordered by first_temp_id for determinism.
 *   - Inserts one Tree row per distinct tag, captures LAST_INSERT_ID(), and
 *     back-fills TreeID into every staging row with that Tag.
 *   - Resets _done to FALSE after the loop so later cursors see a clean flag.
 *
 * Tree has no PlotID column; scoping is via the Quadrat join chain, which is
 * already resolved in Stage 2.
 */
export function renderStage6NewTrees(opts: { tempTable: string }): CursorStageResult {
  const t = escapeSqlIdentifier(opts.tempTable);
  return {
    cursorDeclaration: `DECLARE cur_new_trees CURSOR FOR
    SELECT DISTINCT Tag, SpeciesID, SubSpeciesID, MIN(TempID) AS first_temp_id
      FROM ${t}
      WHERE Tagged = 'N'
      GROUP BY Tag, SpeciesID, SubSpeciesID
      ORDER BY first_temp_id;`,
    body: `  -- Stage 6: insert new Tree rows row-by-row
  SET _done = FALSE;
  OPEN cur_new_trees;
  read_new_trees: LOOP
    FETCH cur_new_trees INTO _cur_tag, _cur_species_id, _cur_subspecies_id, _cur_first_temp_id;
    IF _done THEN LEAVE read_new_trees; END IF;
    INSERT INTO Tree (Tag, SpeciesID, SubSpeciesID) VALUES (_cur_tag, _cur_species_id, _cur_subspecies_id);
    SET _new_tree_id = LAST_INSERT_ID();
    UPDATE ${t} SET TreeID = _new_tree_id
      WHERE Tagged = 'N' AND Tag = _cur_tag;
  END LOOP;
  CLOSE cur_new_trees;
  SET _done = FALSE;
`
  };
}

// ---------------------------------------------------------------------------
// Stage 7: Cursor-driven new Stem inserts
// ---------------------------------------------------------------------------

/**
 * Renders the Stage 7 cursor declaration and body fragment.
 *
 * The cursor declaration is bare (no handler) — the envelope emits the single
 * shared CONTINUE HANDLER FOR NOT FOUND after all cursor declarations.
 *
 * The body:
 *   - Opens cur_new_stems, iterating over every staging row where StemID IS
 *     NULL (i.e. rows whose stem was not resolved in Stages 2/2b).
 *   - Inserts one Stem row per staging row with explicit StemNumber = 0, then
 *     captures LAST_INSERT_ID() and writes the generated StemID back to that
 *     specific staging row via its TempID primary key.
 *   - Resets _done to FALSE after the loop so later cursors see a clean flag.
 */
export function renderStage7NewStems(opts: { tempTable: string }): CursorStageResult {
  const t = escapeSqlIdentifier(opts.tempTable);
  return {
    cursorDeclaration: `DECLARE cur_new_stems CURSOR FOR
    SELECT TempID, TreeID, StemTag, QuadratID, X, Y
      FROM ${t}
      WHERE StemID IS NULL
      ORDER BY TempID;`,
    body: `  -- Stage 7: insert new Stem rows row-by-row
  SET _done = FALSE;
  OPEN cur_new_stems;
  read_new_stems: LOOP
    FETCH cur_new_stems INTO _cur_temp_id, _cur_tree_id, _cur_stem_tag, _cur_quadrat_id, _cur_x, _cur_y;
    IF _done THEN LEAVE read_new_stems; END IF;
    INSERT INTO Stem (TreeID, StemTag, QuadratID, StemNumber, QX, QY)
      VALUES (_cur_tree_id, _cur_stem_tag, _cur_quadrat_id, 0, _cur_x, _cur_y);
    SET _new_stem_id = LAST_INSERT_ID();
    UPDATE ${t} SET StemID = _new_stem_id WHERE TempID = _cur_temp_id;
  END LOOP;
  CLOSE cur_new_stems;
  SET _done = FALSE;
`
  };
}

// ---------------------------------------------------------------------------
// Stage 8: Cursor-driven DBH inserts
// ---------------------------------------------------------------------------

/**
 * Renders the Stage 8 cursor declaration and body fragment.
 *
 * The cursor declaration is bare (no handler) — the envelope emits the single
 * shared CONTINUE HANDLER FOR NOT FOUND after all cursor declarations.
 *
 * The body:
 *   - Opens cur_dbh, iterating over EVERY staging row ordered by TempID.
 *   - Inserts one DBH row per staging row with explicit MeasureID = 0, then
 *     captures LAST_INSERT_ID() and writes the generated DBHID back to that
 *     specific staging row via its TempID primary key.
 *   - Reads PrimaryStem from staging — that column is populated by Stage 9a
 *     which runs before Stage 8 in the composer's ordering.
 *   - Resets _done to FALSE after the loop so later cursors see a clean flag.
 */
export function renderStage8DBH(opts: { tempTable: string }): CursorStageResult {
  const t = escapeSqlIdentifier(opts.tempTable);
  return {
    cursorDeclaration: `DECLARE cur_dbh CURSOR FOR
    SELECT TempID, StemID, DBH, HOM, PrimaryStem, ExactDate, Comments
      FROM ${t}
      ORDER BY TempID;`,
    body: `  -- Stage 8: insert DBH rows row-by-row
  SET _done = FALSE;
  OPEN cur_dbh;
  read_dbh: LOOP
    FETCH cur_dbh INTO _cur_temp_id, _cur_stem_id, _cur_dbh, _cur_hom, _cur_primary_stem, _cur_exact_date, _cur_comments;
    IF _done THEN LEAVE read_dbh; END IF;
    INSERT INTO DBH (MeasureID, StemID, CensusID, DBH, HOM, PrimaryStem, ExactDate, Comments)
      VALUES (0, _cur_stem_id, @target_census_id, _cur_dbh, _cur_hom, _cur_primary_stem, _cur_exact_date, _cur_comments);
    SET _new_dbh_id = LAST_INSERT_ID();
    UPDATE ${t} SET DBHID = _new_dbh_id WHERE TempID = _cur_temp_id;
  END LOOP;
  CLOSE cur_dbh;
  SET _done = FALSE;
`
  };
}

// ---------------------------------------------------------------------------
// Stage 9: PrimaryStem derivation (9a) + DBHAttributes explosion (9b)
// ---------------------------------------------------------------------------

export interface Stage9Result {
  bodyPre: string;
  bodyPost: string;
}

/**
 * Renders the Stage 9 body fragments.
 *
 * Stage 9 is split around Stage 8 in the composer's ordering:
 *
 * **9a (bodyPre)** — runs BEFORE Stage 8:
 *   Derives PrimaryStem on staging rows by exploding the Codes field and joining
 *   TSMAttributes to find 'main' and 'secondary' marker tokens. SIGNALs if any
 *   row carries both markers simultaneously. Writes the resolved marker string
 *   ('main' or 'secondary') back to PrimaryStem on the staging row.
 *
 * **9b (bodyPost)** — runs AFTER Stage 8:
 *   Explodes Codes into DBHAttributes(DBHID, TSMID), excluding 'main'/'secondary'
 *   marker tokens, empty tokens, and '*'. Only rows with a non-NULL DBHID
 *   (written by Stage 8) are eligible.
 *
 * MySQL does not permit WITH RECURSIVE inside a derived table in all versions,
 * so 9b uses a top-level WITH RECURSIVE that wraps the entire INSERT.
 *
 * Output is indented two spaces — these are procedure-body fragments, not full procedures.
 */
export function renderStage9PrimaryAndAttrs(opts: { tempTable: string }): Stage9Result {
  const t = escapeSqlIdentifier(opts.tempTable);

  const bodyPre = `  -- Stage 9a: derive PrimaryStem from main/secondary markers in Codes
  -- Precompute max token count in a session variable so the recursive CTE
  -- only references the TEMPORARY staging table ONCE — MySQL forbids reopening
  -- a TEMPORARY table within a single statement (ER_CANT_REOPEN_TABLE).
  SELECT COALESCE(MAX(LENGTH(Codes) - LENGTH(REPLACE(Codes, ';', '')) + 1), 1)
    INTO @max_code_tokens
    FROM ${t}
    WHERE Codes IS NOT NULL;

  DROP TEMPORARY TABLE IF EXISTS primary_marker_map;
  CREATE TEMPORARY TABLE primary_marker_map AS
    WITH RECURSIVE numbers AS (
      SELECT 1 AS n
      UNION ALL
      SELECT n + 1 FROM numbers WHERE n < @max_code_tokens
    ),
    exploded AS (
      SELECT t.TempID,
             TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(t.Codes, ';', n.n), ';', -1)) AS token
        FROM ${t} t
        JOIN numbers n
          ON n.n <= LENGTH(t.Codes) - LENGTH(REPLACE(t.Codes, ';', '')) + 1
        WHERE t.Codes IS NOT NULL AND t.Codes <> ''
    )
    SELECT e.TempID, LOWER(tsm.Description) AS marker
      FROM exploded e
      JOIN TSMAttributes tsm ON tsm.TSMCode = e.token
      WHERE LOWER(tsm.Description) IN ('main', 'secondary');

  -- Fail if any row has BOTH main and secondary markers
  SET _bad = NULL;
  SELECT GROUP_CONCAT(DISTINCT t.TempID) INTO _bad FROM (
    SELECT TempID
      FROM primary_marker_map
      GROUP BY TempID
      HAVING COUNT(DISTINCT marker) > 1
  ) t;
  IF _bad IS NOT NULL THEN
    SET _message = CONCAT('Both main and secondary markers present on TempIDs: ', _bad);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = _message;
  END IF;

  -- Apply: set PrimaryStem to 'main' or 'secondary' on the affected staging rows
  UPDATE ${t} t
    JOIN primary_marker_map m ON m.TempID = t.TempID
    SET t.PrimaryStem = m.marker;
`;

  const bodyPost = `  -- Stage 9b: explode Codes into DBHAttributes (DBHID, TSMID), excluding markers/empty/'*'
  -- Precompute max token count in a session variable so the recursive CTE
  -- only references the TEMPORARY staging table ONCE — MySQL forbids reopening
  -- a TEMPORARY table within a single statement (ER_CANT_REOPEN_TABLE).
  SELECT COALESCE(MAX(LENGTH(Codes) - LENGTH(REPLACE(Codes, ';', '')) + 1), 1)
    INTO @max_code_tokens
    FROM ${t}
    WHERE Codes IS NOT NULL;

  -- MySQL requires the WITH clause inside INSERT (between INSERT and SELECT),
  -- not before the INSERT keyword — \`WITH ... INSERT\` is a syntax error.
  INSERT INTO DBHAttributes (DBHID, TSMID)
  WITH RECURSIVE numbers AS (
    SELECT 1 AS n
    UNION ALL
    SELECT n + 1 FROM numbers WHERE n < @max_code_tokens
  )
    SELECT DISTINCT e.DBHID, tsm.TSMID
      FROM (
        SELECT t.DBHID,
               TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(t.Codes, ';', n.n), ';', -1)) AS token
          FROM ${t} t
          JOIN numbers n
            ON n.n <= LENGTH(t.Codes) - LENGTH(REPLACE(t.Codes, ';', '')) + 1
          WHERE t.Codes IS NOT NULL AND t.Codes <> ''
            AND t.DBHID IS NOT NULL
      ) e
      JOIN TSMAttributes tsm ON tsm.TSMCode = e.token
      WHERE LOWER(tsm.Description) NOT IN ('main', 'secondary')
        AND e.token NOT IN ('', '*');
`;

  return { bodyPre, bodyPost };
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

/**
 * Flags that are v2-specific and unknown to `parseSharedCliArgs`.
 * Filter these out before delegating to the shared parser.
 */
const V2_BOOLEAN_FLAGS = ['--allow-reload'] as const;

function stripV2Flags(argv: string[]): string[] {
  return argv.filter(arg => !(V2_BOOLEAN_FLAGS as readonly string[]).includes(arg));
}

export function parseCliArgsV2(argv: string[]): CliArgsV2 {
  const { values } = parseArgs({
    args: argv,
    options: {
      input: { type: 'string' },
      site: { type: 'string' },
      'plot-id': { type: 'string' },
      'census-number': { type: 'string' },
      output: { type: 'string' },
      'temp-table': { type: 'string' },
      'allow-reload': { type: 'boolean', default: false }
    },
    strict: true
  });

  // v2 default output is <input>.v2.sql — appended verbatim, not replacing .csv.
  // We synthesize --output before delegating to parseSharedCliArgs so the shared
  // helper's defaultOutputPath logic (which strips .csv) is never reached.
  const effectiveOutput = values.output ?? `${values.input}.v2.sql`;
  const augmentedArgv = values.output ? stripV2Flags(argv) : [...stripV2Flags(argv), '--output', effectiveOutput];

  const shared = parseSharedCliArgs(augmentedArgv);
  return { ...shared, allowReload: Boolean(values['allow-reload']) };
}

// ---------------------------------------------------------------------------
// Stage 10: final tally
// ---------------------------------------------------------------------------

export function renderStage10(opts: { tempTable: string }): string {
  const t = escapeSqlIdentifier(opts.tempTable);
  return `  -- Stage 10: final tally
  SELECT
    SUM(Tagged = 'O') AS old_trees,
    SUM(Tagged = 'M') AS multi_stems,
    SUM(Tagged = 'N') AS new_plants,
    COUNT(*) AS total
    FROM ${t};
`;
}

// ---------------------------------------------------------------------------
// Pipeline composer
// ---------------------------------------------------------------------------

export interface RenderFullPipelineOptions {
  args: CliArgsV2;
  stagingRows: StagingRow[];
}

/**
 * Composes every stage renderer into one .sql file string.
 *
 * Stage ordering (critical — Stage 9a must precede Stage 8 because DBH reads
 * PrimaryStem from staging; Stage 9b must follow Stage 8 because DBHAttributes
 * needs DBHID from Stage 8):
 *
 *   Stage 0 -> 1 -> 2 -> 2b -> 3 -> 4 -> 5 -> 6 -> 7 -> 9a -> 8 -> 9b -> 10
 *
 * Cursor declarations from Stages 6/7/8 are collected and emitted by the
 * procedure envelope between the scalar DECLAREs and the NOT FOUND handler,
 * matching MySQL's required declaration order.
 */
export function renderFullPipeline(opts: RenderFullPipelineOptions): string {
  const { args, stagingRows } = opts;
  const tempTable = args.tempTable;

  const stage6 = renderStage6NewTrees({ tempTable });
  const stage7 = renderStage7NewStems({ tempTable });
  const stage8 = renderStage8DBH({ tempTable });
  const stage9 = renderStage9PrimaryAndAttrs({ tempTable });

  const body = [
    renderStage0({ plotId: args.plotId, censusNumber: args.censusNumber, allowReload: args.allowReload }),
    renderStage1({ tempTable, stagingRows }),
    renderStage2({ tempTable }),
    renderStage2bResprout({ tempTable }),
    renderStage3({ tempTable }),
    renderStage4({ tempTable }),
    renderStage5({ tempTable }),
    stage6.body,
    stage7.body,
    stage9.bodyPre,
    stage8.body,
    stage9.bodyPost,
    renderStage10({ tempTable })
  ].join('\n\n');

  return renderProcedureEnvelope({
    cursorDeclarations: [stage6.cursorDeclaration, stage7.cursorDeclaration, stage8.cursorDeclaration],
    body
  });
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

const EXIT_CODE_CLI_PARSE_ERROR = 2;
const EXIT_CODE_IO_OR_RENDER_ERROR = 1;

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let args: CliArgsV2;
  try {
    args = parseCliArgsV2(argv);
  } catch (err) {
    console.error('CLI error:', err instanceof Error ? err.message : String(err));
    process.exit(EXIT_CODE_CLI_PARSE_ERROR);
  }

  let rows, stagingRows;
  try {
    rows = readCsvFile(args.input);
    stagingRows = rows.map(r => mapCsvRowToStagingRow(r, args.plotId, args.censusNumber));
  } catch (err) {
    console.error('Failed to read CSV:', err instanceof Error ? err.message : String(err));
    process.exit(EXIT_CODE_IO_OR_RENDER_ERROR);
  }

  if (stagingRows.length === 0) {
    console.error(`No data rows in CSV: ${args.input}. Nothing to load.`);
    process.exit(EXIT_CODE_IO_OR_RENDER_ERROR);
  }

  try {
    const sql = renderFullPipeline({ args, stagingRows });
    fs.writeFileSync(args.output, sql, 'utf8');
    console.log(`Wrote ${args.output} (${stagingRows.length} rows)`);
  } catch (err) {
    console.error('Failed to render or write SQL:', err instanceof Error ? err.message : String(err));
    process.exit(EXIT_CODE_IO_OR_RENDER_ERROR);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_CODE_IO_OR_RENDER_ERROR);
  });
}
