import SqlString from 'sqlstring';
import {
  escapeSqlIdentifier,
  renderCreateStagingTable,
  renderInsertChunks,
  renderCreateStagingMeasurements,
  renderCreateStagingAttributes,
  renderInsertChunksMeasurements,
  renderInsertChunksAttributes,
  type StagingRow,
  type MeasurementStagingRow,
  type AttributeStagingRow
} from './csv-to-sql-shared';

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
// Stage 0: Census guard
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
 * With --allow-reload: returns only the census guard (reload cleanup is produced by renderStage0bReload).
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

  if (opts.allowReload) {
    // Reload cleanup is now produced by renderStage0bReload; composer is responsible for including it.
    return guard;
  }

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

// ---------------------------------------------------------------------------
// Stage 0b: Reload cleanup with orphan reporting
// ---------------------------------------------------------------------------

export interface Stage0bOptions {
  mode: 'real' | 'dry-run';
}

/**
 * Renders the Stage 0b reload procedure-body fragment.
 *
 * Real mode:
 *   - Populates reload_orphan_candidates TEMPORARY TABLE BEFORE any DELETE
 *   - Emits SELECT COUNT for DBHAttributes and DBH scope BEFORE the DELETEs
 *   - Deletes DBHAttributes and DBH for the target census (schema-agnostic JOIN DELETE for attrs)
 *   - NEVER deletes Stem or Tree rows
 *   - Emits orphan-count SELECTs AFTER the DELETEs to report orphan stems/trees
 *
 * Dry-run mode:
 *   - Wraps the real-mode body in SAVEPOINT reload_dry ... ROLLBACK TO SAVEPOINT reload_dry
 *   - Does NOT emit LEAVE main — the composer decides whether to skip subsequent stages
 *
 * Output is indented two spaces — it is a procedure-body fragment, not a full procedure.
 */
export function renderStage0bReload(opts: Stage0bOptions): string {
  const body = `  -- Stage 0b: reload — capture orphan candidates BEFORE any DELETE
  DROP TEMPORARY TABLE IF EXISTS reload_orphan_candidates;
  CREATE TEMPORARY TABLE reload_orphan_candidates AS
    SELECT DISTINCT s.StemID, s.TreeID
      FROM Stem s
      JOIN DBH d_target ON d_target.StemID = s.StemID AND d_target.CensusID = @target_census_id
      LEFT JOIN DBH d_other ON d_other.StemID = s.StemID AND d_other.CensusID <> @target_census_id
     WHERE d_other.DBHID IS NULL;

  SELECT 'DBHAttributes to delete' AS scope,
         COUNT(*) AS n
    FROM DBHAttributes da
    JOIN DBH d ON d.DBHID = da.DBHID
   WHERE d.CensusID = @target_census_id;

  SELECT 'DBH to delete' AS scope,
         COUNT(*) AS n
    FROM DBH
   WHERE CensusID = @target_census_id;

  DELETE da
    FROM DBHAttributes da
    JOIN DBH d ON d.DBHID = da.DBHID
   WHERE d.CensusID = @target_census_id;

  DELETE FROM DBH WHERE CensusID = @target_census_id;

  SELECT 'Orphan stems after reload' AS scope,
         COUNT(*) AS n
    FROM reload_orphan_candidates roc
    LEFT JOIN DBH d ON d.StemID = roc.StemID
   WHERE d.DBHID IS NULL;

  SELECT 'Orphan trees after reload' AS scope,
         COUNT(*) AS n
    FROM (SELECT DISTINCT TreeID FROM reload_orphan_candidates) roc_t
    LEFT JOIN Stem s ON s.TreeID = roc_t.TreeID
   WHERE s.StemID IS NULL;
`;

  if (opts.mode === 'real') return body;
  return `  SAVEPOINT reload_dry;
${body}
  ROLLBACK TO SAVEPOINT reload_dry;
`;
}

// ---------------------------------------------------------------------------
// Stage 1: Temporary InnoDB staging tables (measurements + attributes)
// ---------------------------------------------------------------------------

export interface Stage1Options {
  measurementsTable: string;
  attributesTable: string;
  measurementRows: MeasurementStagingRow[];
  attributeRows: AttributeStagingRow[];
}

/**
 * Renders the Stage 1 procedure-body fragment.
 *
 * Emits:
 *   - DROP TEMPORARY TABLE IF EXISTS + CREATE TEMPORARY TABLE for staging_measurements
 *   - DROP TEMPORARY TABLE IF EXISTS + CREATE TEMPORARY TABLE for staging_attributes
 *   - INSERT INTO ... VALUES chunks for all measurement rows
 *   - INSERT INTO ... VALUES chunks for all attribute rows
 *
 * If both row arrays are empty, only the DDL is emitted (no INSERT statements).
 *
 * Output is indented two spaces at the section boundary — it is a
 * procedure-body fragment, not a full procedure.
 */
export function renderStage1(opts: Stage1Options): string {
  const mDdl = renderCreateStagingMeasurements(opts.measurementsTable);
  const aDdl = renderCreateStagingAttributes(opts.attributesTable);
  const mInserts = renderInsertChunksMeasurements(opts.measurementsTable, opts.measurementRows).join('\n');
  const aInserts = renderInsertChunksAttributes(opts.attributesTable, opts.attributeRows).join('\n');

  const parts = ['  -- Stage 1: temporary staging (measurements + attributes)', mDdl, aDdl];
  if (mInserts) parts.push(mInserts);
  if (aInserts) parts.push(aInserts);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Stage 2: Lookup resolution
// ---------------------------------------------------------------------------

export interface Stage2Options {
  measurementsTable: string;
  attributesTable: string;
}

/**
 * Renders the Stage 2 procedure-body fragment.
 *
 * Emits, in order:
 *   1. UPDATE measurementsTable SET CensusID = @target_census_id
 *   2. UPDATE measurementsTable JOIN Quadrat to resolve QuadratID
 *   3. CREATE TEMPORARY TABLE taxonomy_lookup — joins through Family → Genus → Species → SubSpecies
 *      with a 2-arm WHERE clause ensuring subspecies presence matches on both sides
 *   4. UPDATE measurementsTable JOIN taxonomy_lookup (TaxonCount = 1) to write back SpeciesID + SubSpeciesID
 *   5. CREATE TEMPORARY TABLE tree_lookup — scoped via Tree → Stem → Quadrat → @target_plot_id
 *      (Tree has no PlotID column; scope must come from the Stem/Quadrat join chain)
 *      Groups by (Tag, SpeciesID, SubSpeciesID)
 *   6. UPDATE measurementsTable JOIN tree_lookup (TreeCount = 1) with NULL-safe <=> on SubSpeciesID
 *      to write back TreeID
 *   7. CREATE TEMPORARY TABLE stem_lookup — scoped via Stem → Quadrat → @target_plot_id
 *   8. UPDATE measurementsTable JOIN stem_lookup with NULL-safe StemTag (<=>) and StemCount = 1
 *      to write back StemID
 *   9. UPDATE attributesTable JOIN TSMAttributes to resolve TSMID
 *
 * Ambiguous matches (TreeCount > 1 or StemCount > 1) are intentionally left
 * unresolved in staging so Stage 5 can SIGNAL them.
 *
 * Output is indented two spaces — it is a procedure-body fragment, not a full procedure.
 */
export function renderStage2(opts: Stage2Options): string {
  const m = escapeSqlIdentifier(opts.measurementsTable);
  const a = escapeSqlIdentifier(opts.attributesTable);
  return `  -- Stage 2: destination identity lookup
  UPDATE ${m} SET CensusID = @target_census_id;

  UPDATE ${m} t
    JOIN Quadrat q ON q.QuadratName = t.QuadratName AND q.PlotID = @target_plot_id
    SET t.QuadratID = q.QuadratID;

  -- Taxonomy lookup through Family -> Genus -> Species -> SubSpecies.
  -- Subspecies rows must produce a non-NULL SubSpeciesID; non-subspecies rows must produce NULL.
  DROP TEMPORARY TABLE IF EXISTS taxonomy_lookup;
  CREATE TEMPORARY TABLE taxonomy_lookup AS
    SELECT t.TempID,
           MIN(sp.SpeciesID)    AS SpeciesID,
           MIN(ss.SubSpeciesID) AS SubSpeciesID,
           COUNT(DISTINCT CONCAT(sp.SpeciesID, ':', COALESCE(ss.SubSpeciesID, 0))) AS TaxonCount
      FROM ${m} t
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

  UPDATE ${m} t
    JOIN taxonomy_lookup tx ON tx.TempID = t.TempID AND tx.TaxonCount = 1
    SET t.SpeciesID = tx.SpeciesID,
        t.SubSpeciesID = tx.SubSpeciesID;

  -- Tree lookup (CTFS Tree has no PlotID; scope via Stem -> Quadrat -> Plot)
  DROP TEMPORARY TABLE IF EXISTS tree_lookup;
  CREATE TEMPORARY TABLE tree_lookup AS
    SELECT tr.Tag,
           tr.SpeciesID,
           tr.SubSpeciesID,
           MIN(tr.TreeID)            AS TreeID,
           COUNT(DISTINCT tr.TreeID) AS TreeCount
      FROM Tree tr
      JOIN Stem s ON s.TreeID = tr.TreeID
      JOIN Quadrat q ON q.QuadratID = s.QuadratID
     WHERE q.PlotID = @target_plot_id
     GROUP BY tr.Tag, tr.SpeciesID, tr.SubSpeciesID;

  UPDATE ${m} t
    JOIN tree_lookup tl ON tl.Tag = t.Tag
                       AND tl.SpeciesID = t.SpeciesID
                       AND tl.SubSpeciesID <=> t.SubSpeciesID
                       AND tl.TreeCount = 1
    SET t.TreeID = tl.TreeID;

  -- Stem lookup (also plot-scoped)
  DROP TEMPORARY TABLE IF EXISTS stem_lookup;
  CREATE TEMPORARY TABLE stem_lookup AS
    SELECT s.TreeID,
           s.StemTag,
           MIN(s.StemID) AS StemID,
           COUNT(*)      AS StemCount
      FROM Stem s
      JOIN Quadrat q ON q.QuadratID = s.QuadratID
     WHERE q.PlotID = @target_plot_id
     GROUP BY s.TreeID, s.StemTag;

  UPDATE ${m} t
    JOIN stem_lookup sl ON sl.TreeID = t.TreeID
                       AND sl.StemTag <=> t.StemTag
                       AND sl.StemCount = 1
    SET t.StemID = sl.StemID;

  -- TSMID resolution for attributes
  UPDATE ${a} a
    JOIN TSMAttributes tsm ON tsm.TSMCode = a.TSMCode
    SET a.TSMID = tsm.TSMID;
`;
}

// ---------------------------------------------------------------------------
// Stage 5: Destination contract checks
// ---------------------------------------------------------------------------

export interface Stage5Options {
  measurementsTable: string;
  attributesTable: string;
}

/**
 * Renders the Stage 5 procedure-body fragment.
 *
 * Ten destination-contract checks run in sequence. Each writes per-row reason
 * into the `Errors` column on the affected staging rows via CONCAT, then a
 * single gated SIGNAL at the end emits the full failure set.
 *
 * Checks (in order, per spec lines 219-228):
 *   1. Required-field NOT NULL on staging_measurements: Tag, StemTag, Mnemonic, QuadratName, ExactDate
 *   2. Taxonomy lookup resolved exactly once (TempID in taxonomy_lookup with TaxonCount = 1)
 *   3. Tree-key uniqueness on destination plot (tree_lookup.TreeCount > 1 means failure)
 *   4. Stem uniqueness on destination tree (stem_lookup.StemCount > 1 means failure)
 *   5. Unknown quadrat (QuadratID IS NULL after Stage 2)
 *   6. Unknown TSMCode on staging_attributes (TSMID IS NULL after Stage 2)
 *   7. No duplicate (StemID, CensusID) destinations within the batch
 *   8. (TreeID, StemTag, QuadratID) uniqueness among new-stem rows (StemID IS NULL)
 *   9. No pre-existing orphan Tree for new tree keys (fail if matching Tree exists with no Stem)
 *   10. Destination string lengths: Tag>10, StemTag>32, QuadratName>8, Comments>128 for measurements; TSMCode>10 for attributes
 *
 * After all checks, a single IF EXISTS block emits SELECTs of failed rows from
 * both tables and a SIGNAL with a stable short message.
 *
 * Output is indented two spaces — it is a procedure-body fragment, not a full procedure.
 */
export function renderStage5(opts: Stage5Options): string {
  const m = escapeSqlIdentifier(opts.measurementsTable);
  const a = escapeSqlIdentifier(opts.attributesTable);

  const appendErr = (table: string, reason: string, predicate: string) =>
    `  UPDATE ${table}
    SET Errors = CONCAT(COALESCE(Errors, ''), CASE WHEN Errors IS NULL THEN '' ELSE '; ' END, '${reason}')
    WHERE ${predicate};
`;

  return `  -- Stage 5: destination contract checks

${appendErr(m, 'Missing required field', `Tag IS NULL OR StemTag IS NULL OR Mnemonic IS NULL OR QuadratName IS NULL OR ExactDate IS NULL`)}

${appendErr(
  m,
  'Taxonomy not uniquely resolved',
  `NOT EXISTS (
       SELECT 1 FROM taxonomy_lookup tx
       WHERE tx.TempID = ${m}.TempID AND tx.TaxonCount = 1
     )`
)}

${appendErr(
  m,
  'Ambiguous tree key',
  `SpeciesID IS NOT NULL AND EXISTS (
       SELECT 1 FROM tree_lookup tl
       WHERE tl.Tag = ${m}.Tag AND tl.SpeciesID = ${m}.SpeciesID
         AND tl.SubSpeciesID <=> ${m}.SubSpeciesID AND tl.TreeCount > 1
     )`
)}

${appendErr(
  m,
  'Ambiguous stem key',
  `TreeID IS NOT NULL AND EXISTS (
       SELECT 1 FROM stem_lookup sl
       WHERE sl.TreeID = ${m}.TreeID AND sl.StemTag <=> ${m}.StemTag AND sl.StemCount > 1
     )`
)}

${appendErr(m, 'Unknown quadrat', `QuadratID IS NULL AND QuadratName IS NOT NULL`)}

${appendErr(a, 'Unknown TSMCode', `TSMID IS NULL AND TSMCode IS NOT NULL`)}

${appendErr(
  m,
  'Duplicate (StemID, CensusID) destination',
  `StemID IS NOT NULL AND CensusID IS NOT NULL AND TempID IN (
     SELECT TempID FROM (
       SELECT TempID
         FROM ${m}
        WHERE StemID IS NOT NULL AND CensusID IS NOT NULL
        GROUP BY StemID, CensusID
       HAVING COUNT(*) > 1
     ) dup_outer
   )`
)}

${appendErr(
  m,
  'Duplicate new-stem natural key',
  `StemID IS NULL AND TempID IN (
     SELECT TempID FROM (
       SELECT TempID
         FROM ${m}
        WHERE StemID IS NULL
        GROUP BY TreeID, StemTag, QuadratID
       HAVING COUNT(*) > 1
     ) dup_outer
   )`
)}

${appendErr(
  m,
  'Ambiguous pre-existing Tree (orphan)',
  `TreeID IS NULL AND SpeciesID IS NOT NULL AND EXISTS (
     SELECT 1 FROM Tree tr
      LEFT JOIN Stem s ON s.TreeID = tr.TreeID
      WHERE tr.Tag = ${m}.Tag
        AND tr.SpeciesID = ${m}.SpeciesID
        AND tr.SubSpeciesID <=> ${m}.SubSpeciesID
        AND s.StemID IS NULL
   )`
)}

${appendErr(m, 'String too long for CTFS', `CHAR_LENGTH(Tag) > 10 OR CHAR_LENGTH(StemTag) > 32 OR CHAR_LENGTH(QuadratName) > 8 OR CHAR_LENGTH(Comments) > 128`)}

${appendErr(a, 'TSMCode too long for CTFS', `CHAR_LENGTH(TSMCode) > 10`)}

  IF EXISTS (SELECT 1 FROM ${m} WHERE Errors IS NOT NULL)
     OR EXISTS (SELECT 1 FROM ${a} WHERE Errors IS NOT NULL) THEN
    SELECT TempID, CoreMeasurementID, SourceRowIndex, Tag, StemTag, Mnemonic, QuadratName, Errors
      FROM ${m} WHERE Errors IS NOT NULL ORDER BY TempID;
    SELECT TempAttrID, CoreMeasurementID, TempMeasurementID, TSMCode, Errors
      FROM ${a} WHERE Errors IS NOT NULL ORDER BY TempAttrID;
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Validation failed; see prior SELECT for per-row details';
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
 *   Stage 0 -> [0b] -> 1 -> 2 -> 5 -> 6 -> 7 -> 8 -> 10
 *
 * Stage 0b (reload cleanup) is included only when allowReload is true.
 *
 * Cursor declarations from Stages 6/7/8 are collected and emitted by the
 * procedure envelope between the scalar DECLAREs and the NOT FOUND handler,
 * matching MySQL's required declaration order.
 *
 * NOTE: This is a transitional stub. In a later task, the app endpoint will
 * call the individual renderers directly instead of using this composer.
 *
 * Stage 1 now uses the new two-table signature; this composer calls it with
 * empty measurement/attribute arrays as a placeholder. The legacy RenderFullPipelineOptions
 * stagingRows field is now dead-weight; the new pipeline will replace it entirely.
 */
export function renderFullPipeline(opts: RenderFullPipelineOptions): string {
  const { plotId, censusNumber, allowReload, tempTable } = opts;

  const stage6 = renderStage6NewTrees({ tempTable });
  const stage7 = renderStage7NewStems({ tempTable });
  const stage8 = renderStage8DBH({ tempTable });

  const body = [
    renderStage0({ destinationPlotId: plotId, censusNumber, allowReload }),
    allowReload ? renderStage0bReload({ mode: 'real' }) : '',
    renderStage1({
      measurementsTable: 'staging_measurements',
      attributesTable: 'staging_attributes',
      measurementRows: [],
      attributeRows: []
    }),
    renderStage2({ measurementsTable: 'staging_measurements', attributesTable: 'staging_attributes' }),
    renderStage5({ measurementsTable: 'staging_measurements', attributesTable: 'staging_attributes' }),
    stage6.body,
    stage7.body,
    stage8.body,
    renderStage10({ tempTable })
  ]
    .filter(Boolean)
    .join('\n\n');

  return renderProcedureEnvelope({
    procedureName: 'csv_to_sql_v2_load', // placeholder; orchestrator (later task) supplies a unique per-artifact name
    lockName: 'ctfs-export:legacy:placeholder', // placeholder; orchestrator supplies real lock name
    cursorDeclarations: [stage6.cursorDeclaration, stage7.cursorDeclaration, stage8.cursorDeclaration],
    body
  });
}
