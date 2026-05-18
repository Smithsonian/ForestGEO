import { parseArgs } from 'node:util';
import SqlString from 'sqlstring';
import {
  escapeSqlIdentifier,
  parseSharedCliArgs,
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
  'DECLARE _cur_hom FLOAT;',
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
// Entrypoint stub (Task 16 replaces the throw with real logic)
// ---------------------------------------------------------------------------

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const _args = parseCliArgsV2(argv);
  throw new Error('csv-to-sql-v2 main() not yet wired — Task 16 finishes this');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    // node:util parseArgs throws TypeError on malformed CLI input; exit 2 matches v1.
    process.exit(err instanceof TypeError ? 2 : 1);
  });
}
