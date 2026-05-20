import SqlString from 'sqlstring';
import { escapeSqlIdentifier, renderCreateStagingTable, renderInsertChunks, type StagingRow } from './csv-to-sql-shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcedureEnvelopeOptions {
  procedureName: string;
  lockName: string;
  cursorDeclarations: string[];
  body: string;
}

// ---------------------------------------------------------------------------
// Procedure envelope renderer
// ---------------------------------------------------------------------------

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
 *
 * GET_LOCK is acquired before START TRANSACTION — MySQL's GET_LOCK is
 * non-transactional and survives ROLLBACK, so acquiring it before the
 * transaction means we don't open a transaction we won't use if the lock
 * is held.
 *
 * `procedureName` is validated via escapeSqlIdentifier and stripped of
 * backticks for bare interpolation. `lockName` is SQL-escaped via
 * mysql2's string-literal escaping.
 */
export function renderProcedureEnvelope(opts: ProcedureEnvelopeOptions): string {
  // Validate procedure name and strip backticks for bare interpolation
  const quoted = escapeSqlIdentifier(opts.procedureName);
  const procName = quoted.replace(/`/g, '');

  // SQL-escape the lock name for string literal
  const lockLit = SqlString.escape(opts.lockName);

  const indent = (line: string) => `  ${line}`;

  const scalars = SCALAR_DECLARES.map(indent).join('\n');
  const cursors = opts.cursorDeclarations.length > 0 ? '\n\n' + opts.cursorDeclarations.map(indent).join('\n') : '';

  return `DROP PROCEDURE IF EXISTS ${procName};

DELIMITER //
CREATE PROCEDURE ${procName}()
main: BEGIN
${scalars}${cursors}

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET _done = TRUE;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RELEASE_LOCK(${lockLit});
    RESIGNAL;
  END;

  IF GET_LOCK(${lockLit}, 0) <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Another ctfs-sql export is running for this destination (plot, census)';
  END IF;

  START TRANSACTION;

${opts.body}

  COMMIT;
  RELEASE_LOCK(${lockLit});
END //
DELIMITER ;

CALL ${procName}();
DROP PROCEDURE ${procName};
`;
}

// ---------------------------------------------------------------------------
// Stage 0: Census guard and reload cleanup
// ---------------------------------------------------------------------------

export interface Stage0Options {
  destinationPlotId: number;
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
  if (!Number.isInteger(opts.destinationPlotId) || opts.destinationPlotId < 0) {
    throw new Error(`destinationPlotId must be a non-negative integer; got: ${opts.destinationPlotId}`);
  }

  const censusLit = SqlString.escape(opts.censusNumber);

  const guard = `  -- Stage 0: target census guard
  SELECT COUNT(*), MIN(CensusID), MIN(StartDate)
    INTO _census_count, _target_census_id, _target_start_date
    FROM Census
    WHERE PlotID = ${opts.destinationPlotId}
      AND PlotCensusNumber = ${censusLit};

  IF _census_count <> 1 THEN
    SET _message = CONCAT('Expected exactly one Census row for PlotID + PlotCensusNumber; found ', _census_count);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = _message;
  END IF;

  SET @target_census_id := _target_census_id;
  SET @target_plot_id := ${opts.destinationPlotId};
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
  DROP TEMPORARY TABLE IF EXISTS reload_stems_to_check;
  DROP TEMPORARY TABLE IF EXISTS reload_trees_to_check;

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

  DROP TEMPORARY TABLE IF EXISTS tree_lookup;
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

  DROP TEMPORARY TABLE IF EXISTS stem_lookup;
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
 *   - Reads PrimaryStem from staging. The renderer that populates that column
 *     (previously Stage 9a) was removed in this pruning pass; a later task in
 *     the pivot reintroduces a simpler population step before Stage 8 runs.
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
  plotId: number;
  censusNumber: string;
  allowReload: boolean;
  tempTable: string;
  stagingRows: StagingRow[];
}

/**
 * Composes every stage renderer into one .sql file string.
 *
 * Stage ordering (after pivot, deleted stages 2b/3/4/9):
 *
 *   Stage 0 -> 1 -> 2 -> 5 -> 6 -> 7 -> 8 -> 10
 *
 * Cursor declarations from Stages 6/7/8 are collected and emitted by the
 * procedure envelope between the scalar DECLAREs and the NOT FOUND handler,
 * matching MySQL's required declaration order.
 *
 * NOTE: This is a transitional stub. In a later task, the app endpoint will
 * call the individual renderers directly instead of using this composer.
 */
export function renderFullPipeline(opts: RenderFullPipelineOptions): string {
  const { plotId, censusNumber, allowReload, tempTable, stagingRows } = opts;

  const stage6 = renderStage6NewTrees({ tempTable });
  const stage7 = renderStage7NewStems({ tempTable });
  const stage8 = renderStage8DBH({ tempTable });

  const body = [
    renderStage0({ destinationPlotId: plotId, censusNumber, allowReload }),
    renderStage1({ tempTable, stagingRows }),
    renderStage2({ tempTable }),
    renderStage5({ tempTable }),
    stage6.body,
    stage7.body,
    stage8.body,
    renderStage10({ tempTable })
  ].join('\n\n');

  return renderProcedureEnvelope({
    procedureName: 'csv_to_sql_v2_load', // placeholder; orchestrator (later task) supplies a unique per-artifact name
    lockName: 'ctfs-export:legacy:placeholder', // placeholder; orchestrator supplies real lock name
    cursorDeclarations: [stage6.cursorDeclaration, stage7.cursorDeclaration, stage8.cursorDeclaration],
    body
  });
}
