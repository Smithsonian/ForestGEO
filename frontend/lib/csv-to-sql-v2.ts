import SqlString from 'sqlstring';
import {
  escapeSqlIdentifier,
  renderCreateStagingMeasurements,
  renderCreateStagingAttributes,
  renderInsertChunksMeasurements,
  renderInsertChunksAttributes,
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
  postCommitBody?: string;
}

// ---------------------------------------------------------------------------
// Procedure envelope renderer
// ---------------------------------------------------------------------------

/**
 * Exported legacy constants for bulk insert stages.
 */
export const LEGACY_DEFAULT_STEM_NUMBER = 0;
export const LEGACY_DEFAULT_MEASURE_ID = 0;

// Live scalars only — resprout/cursor scratch removed with the pivot.
// `_viewfulltable_installed` is populated by the Stage 0 ViewFullTable probe.
const SCALAR_DECLARES = [
  'DECLARE _message TEXT;',
  'DECLARE _census_count INT DEFAULT 0;',
  'DECLARE _target_census_id INT UNSIGNED;',
  'DECLARE _existing_dbh_count INT DEFAULT 0;',
  'DECLARE _viewfulltable_installed INT DEFAULT 0;',
  'DECLARE _lock_result INT DEFAULT 0;'
];

/**
 * Renders the full procedure SQL envelope.
 *
 * MySQL requires DECLAREs precede other statements in the procedure body.
 * After the pivot there are no cursors, so `cursorDeclarations` is kept only
 * to preserve the caller signature; passing a non-empty array is unsupported.
 *
 * GET_LOCK runs before START TRANSACTION — MySQL's GET_LOCK is non-transactional
 * and survives ROLLBACK, so acquiring it first avoids opening a transaction we
 * never use when the lock is contended.
 *
 * GET_LOCK returns 1 (acquired), 0 (timeout), or NULL (error). The two failure
 * modes have separate, operator-actionable messages — "another export running"
 * vs. "lock subsystem error" — to avoid the misleading single-message we used
 * to emit on both branches.
 *
 * `procedureName` is validated via escapeSqlIdentifier and stripped of
 * backticks for bare interpolation. `lockName` is SQL-escaped via
 * mysql2's string-literal escaping.
 */
export function renderProcedureEnvelope(opts: ProcedureEnvelopeOptions): string {
  if (opts.cursorDeclarations.length > 0) {
    throw new Error('cursorDeclarations is unsupported after the pivot; pass an empty array.');
  }
  const quoted = escapeSqlIdentifier(opts.procedureName);
  const procName = quoted.replace(/`/g, '');

  const lockLit = SqlString.escape(opts.lockName);

  const indent = (line: string) => `  ${line}`;
  const scalars = SCALAR_DECLARES.map(indent).join('\n');

  return `DROP PROCEDURE IF EXISTS ${procName};

DELIMITER //
CREATE PROCEDURE ${procName}()
main: BEGIN
${scalars}

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    DO RELEASE_LOCK(${lockLit});
    RESIGNAL;
  END;

  SET _lock_result = GET_LOCK(${lockLit}, 0);
  IF _lock_result IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'ctfs-sql export lock subsystem returned NULL (server error or invalid lock name)';
  END IF;
  IF _lock_result = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Another ctfs-sql export is running for this destination (plot, census)';
  END IF;

  START TRANSACTION;

${opts.body}

  COMMIT;
${opts.postCommitBody ? `\n${opts.postCommitBody}` : ''}
  DO RELEASE_LOCK(${lockLit});
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
 *   - DBHAttributes schema probe (post-2014f shape required; SIGNAL with
 *     install-DBCHANGES2014f message if the legacy CensusID column is present)
 *   - ViewFullTable install probe (SIGNAL with helpful install message if
 *     ctfsweb_webuser.CreateFullView is missing; the post-procedure CALL
 *     would otherwise blow up after the data committed)
 *   - SELECT COUNT(*)/MIN() INTO scalars from Census WHERE PlotID + PlotCensusNumber
 *   - IF _census_count <> 1 THEN SIGNAL block (includes the search keys in the message)
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

  const guard = `  -- Stage 0a: destination schema probes (fail before any inserts if the
  -- destination is missing required CTFSWeb post-load infrastructure).

  -- Detect a pre-DBCHANGES2014f destination — DBHAttributes.CensusID was
  -- dropped in 2014f and the Stage 9 INSERT does not supply it. Fail loudly
  -- rather than blowing up on a generic NOT NULL constraint error.
  SELECT COUNT(*) INTO _existing_dbh_count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'DBHAttributes'
      AND COLUMN_NAME = 'CensusID';
  IF _existing_dbh_count > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'DBHAttributes still has a CensusID column — apply DBCHANGES2014f.sql to the destination first.';
  END IF;
  SET _existing_dbh_count = 0;

  -- ctfsweb_webuser.CreateFullView is invoked AFTER the load commits, so if it
  -- is missing the operator gets data in but no reporting table refresh. Probe
  -- here so the load aborts cleanly with installation instructions.
  SELECT COUNT(*) INTO _viewfulltable_installed
    FROM information_schema.ROUTINES
    WHERE ROUTINE_SCHEMA = 'ctfsweb_webuser'
      AND ROUTINE_NAME = 'CreateFullView'
      AND ROUTINE_TYPE = 'PROCEDURE';
  IF _viewfulltable_installed = 0 THEN
    -- MESSAGE_TEXT is capped at 128 chars by MySQL SIGNAL; keep the key install
    -- hint terse and use the comment block above for the longer rationale.
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'ctfsweb_webuser.CreateFullView missing. Source creating_ViewFullTable.sql into the destination MySQL, then retry.';
  END IF;

  -- Stage 0: target census guard
  SELECT COUNT(*), MIN(CensusID)
    INTO _census_count, _target_census_id
    FROM Census
    WHERE PlotID = ${opts.destinationPlotId}
      AND PlotCensusNumber = ${censusLit};

  IF _census_count <> 1 THEN
    SET _message = CONCAT(
      'Expected exactly one Census row for PlotID=${opts.destinationPlotId}, PlotCensusNumber=', ${censusLit},
      '; found ', _census_count);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = _message;
  END IF;

  SET @target_census_id := _target_census_id;
  SET @target_plot_id := ${opts.destinationPlotId};
`;

  if (opts.allowReload) {
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

  -- Stage 2c: destination-contract normalization rules from Suzanne's
  -- "Upload scripts" email (TempMultiStems / TempNewPlants behavior):
  --   * For new stems (StemID IS NULL after destination lookup), default HOM
  --     to '1.3' when DBH is present but HOM is missing. The app already
  --     normalizes HOM=0 to NULL during ingestion (processbulkingestion.tsx),
  --     so HOM IS NULL is the signal that no operator value exists.
  --   * Belt-and-braces: HOM must be NULL when DBH is NULL.
  UPDATE ${m}
    SET HOM = '1.3'
    WHERE StemID IS NULL
      AND DBH IS NOT NULL
      AND DBH > 0
      AND HOM IS NULL;

  UPDATE ${m} SET HOM = NULL WHERE DBH IS NULL;
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
 *   8. New-stem natural-key uniqueness. Existing trees use TreeID; unresolved
 *      new trees use their pending Tree natural key so different new trees that
 *      share a common StemTag do not collide while TreeID is still NULL.
 *   9. No pre-existing orphan Tree for new tree keys (fail if matching Tree exists with no Stem)
 *   10. Destination string lengths for measurement natural keys, taxonomy
 *       context, comments, and attribute TSMCode.
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

${appendErr(
  m,
  'Missing required field',
  `Tag IS NULL OR Tag = '' OR StemTag IS NULL OR Mnemonic IS NULL OR Mnemonic = ''
       OR QuadratName IS NULL OR QuadratName = '' OR ExactDate IS NULL`
)}

  -- Stage 5 check 1b: empty StemTag is a destination contract failure when the
  -- destination tree already has another stem with the same empty tag. The app
  -- stores stems.StemTag with default '' NOT NULL, so legitimate "no stem tag"
  -- rows arrive here as empty strings; reject duplicates explicitly rather than
  -- silently colliding on the <=> match in Stage 2/7.
  DROP TEMPORARY TABLE IF EXISTS _stage5_empty_stemtag;
  CREATE TEMPORARY TABLE _stage5_empty_stemtag AS
    SELECT TreeID, QuadratID, COUNT(*) AS cnt
      FROM ${m}
     WHERE StemID IS NULL
       AND (StemTag IS NULL OR StemTag = '')
       AND TreeID IS NOT NULL
       AND QuadratID IS NOT NULL
     GROUP BY TreeID, QuadratID
    HAVING COUNT(*) > 1
       OR EXISTS (
            SELECT 1 FROM Stem s
             WHERE s.TreeID = TreeID
               AND s.QuadratID = QuadratID
               AND (s.StemTag IS NULL OR s.StemTag = '')
          );

  UPDATE ${m}
    SET Errors = CONCAT(COALESCE(Errors, ''), CASE WHEN Errors IS NULL THEN '' ELSE '; ' END, 'Empty StemTag collides with another stem under same Tree+Quadrat')
    WHERE StemID IS NULL
      AND (StemTag IS NULL OR StemTag = '')
      AND TreeID IS NOT NULL
      AND QuadratID IS NOT NULL
      AND EXISTS (SELECT 1 FROM _stage5_empty_stemtag e WHERE e.TreeID = ${m}.TreeID AND e.QuadratID = ${m}.QuadratID);

  DROP TEMPORARY TABLE IF EXISTS _stage5_empty_stemtag;

  -- Stage 5 check 2: taxonomy uniqueness — include the conflicting destination
  -- SpeciesID set in the error reason so operators can dedup CurrentTaxonFlag
  -- on the destination without a separate query.
  UPDATE ${m} t
    LEFT JOIN (
      SELECT TempID,
             GROUP_CONCAT(DISTINCT CONCAT(SpeciesID, IFNULL(CONCAT(':', SubSpeciesID), '')) ORDER BY SpeciesID SEPARATOR ',') AS ambiguous_ids,
             COUNT(DISTINCT CONCAT(SpeciesID, ':', COALESCE(SubSpeciesID, 0))) AS taxon_count
        FROM taxonomy_lookup
       GROUP BY TempID
    ) tx ON tx.TempID = t.TempID
    SET t.Errors = CONCAT(
      COALESCE(t.Errors, ''),
      CASE WHEN t.Errors IS NULL THEN '' ELSE '; ' END,
      'Taxonomy not uniquely resolved',
      CASE WHEN tx.ambiguous_ids IS NULL THEN '' ELSE CONCAT(' (matches ', tx.ambiguous_ids, ')') END
    )
    WHERE COALESCE(tx.taxon_count, 0) <> 1;

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

  -- Stage 5 check 7: duplicate (StemID, CensusID) destinations.
  -- Materialise the duplicate (StemID, CensusID) pairs into a separate
  -- temporary table first; MySQL cannot reference the same TEMPORARY table
  -- twice in a single UPDATE (ER_CANT_REOPEN_TABLE).
  DROP TEMPORARY TABLE IF EXISTS _stage5_dup7;
  CREATE TEMPORARY TABLE _stage5_dup7 AS
    SELECT StemID, CensusID
      FROM ${m}
     WHERE StemID IS NOT NULL AND CensusID IS NOT NULL
     GROUP BY StemID, CensusID
    HAVING COUNT(*) > 1;

  UPDATE ${m}
    SET Errors = CONCAT(COALESCE(Errors, ''), CASE WHEN Errors IS NULL THEN '' ELSE '; ' END, 'Duplicate (StemID, CensusID) destination')
    WHERE StemID IS NOT NULL AND CensusID IS NOT NULL
      AND EXISTS (SELECT 1 FROM _stage5_dup7 d WHERE d.StemID = ${m}.StemID AND d.CensusID = ${m}.CensusID);

  DROP TEMPORARY TABLE IF EXISTS _stage5_dup7;

  -- Stage 5 check 8: duplicate new-stem natural key.
  -- Same materialisation pattern to avoid ER_CANT_REOPEN_TABLE.
  DROP TEMPORARY TABLE IF EXISTS _stage5_dup8;
  CREATE TEMPORARY TABLE _stage5_dup8 AS
    SELECT CASE
             WHEN TreeID IS NOT NULL THEN CONCAT('existing:', TreeID)
             ELSE CONCAT('new:', COALESCE(Tag, ''), ':', COALESCE(SpeciesID, 'NULL'), ':', COALESCE(SubSpeciesID, 'NULL'))
           END AS TreeKey,
           StemTag,
           QuadratID
      FROM ${m}
     WHERE StemID IS NULL
     GROUP BY TreeKey, StemTag, QuadratID
    HAVING COUNT(*) > 1;

  UPDATE ${m}
    SET Errors = CONCAT(COALESCE(Errors, ''), CASE WHEN Errors IS NULL THEN '' ELSE '; ' END, 'Duplicate new-stem natural key')
    WHERE StemID IS NULL
      AND EXISTS (
        SELECT 1 FROM _stage5_dup8 d
         WHERE d.TreeKey = CASE
                 WHEN ${m}.TreeID IS NOT NULL THEN CONCAT('existing:', ${m}.TreeID)
                 ELSE CONCAT('new:', COALESCE(${m}.Tag, ''), ':', COALESCE(${m}.SpeciesID, 'NULL'), ':', COALESCE(${m}.SubSpeciesID, 'NULL'))
               END
           AND d.StemTag <=> ${m}.StemTag
           AND d.QuadratID <=> ${m}.QuadratID
      );

  DROP TEMPORARY TABLE IF EXISTS _stage5_dup8;

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

${appendErr(
  m,
  'String too long for CTFS',
  `CHAR_LENGTH(Tag) > 10
     OR CHAR_LENGTH(StemTag) > 32
     OR CHAR_LENGTH(Mnemonic) > 10
     OR CHAR_LENGTH(QuadratName) > 8
     OR CHAR_LENGTH(Comments) > 128
     OR CHAR_LENGTH(Family) > 64
     OR CHAR_LENGTH(Genus) > 64
     OR CHAR_LENGTH(SpeciesName) > 64
     OR CHAR_LENGTH(SpeciesAuthority) > 128
     OR CHAR_LENGTH(SubspeciesName) > 64`
)}

${appendErr(a, 'TSMCode too long for CTFS', `CHAR_LENGTH(TSMCode) > 10`)}

  IF EXISTS (SELECT 1 FROM ${m} WHERE Errors IS NOT NULL)
     OR EXISTS (SELECT 1 FROM ${a} WHERE Errors IS NOT NULL) THEN
    SELECT TempID, CoreMeasurementID, SourceRowIndex, Tag, StemTag, Mnemonic, QuadratName, Errors
      FROM ${m} WHERE Errors IS NOT NULL ORDER BY TempID;
    SELECT TempAttrID, CoreMeasurementID, TSMCode, Errors
      FROM ${a} WHERE Errors IS NOT NULL ORDER BY TempAttrID;
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Validation failed; see prior SELECT for per-row details';
  END IF;
`;
}

// ---------------------------------------------------------------------------
// Stage 6: Bulk-insert new Tree rows with set-based join-back
// ---------------------------------------------------------------------------

export interface StageBulkInsertOptions {
  measurementsTable: string;
}

/**
 * Renders the Stage 6 procedure-body fragment.
 *
 * Two-statement pattern:
 *   1. INSERT into Tree by deduplicating (Tag, SpeciesID, SubSpeciesID) from
 *      staging rows where TreeID IS NULL, ordered by MIN(TempID) for determinism.
 *   2. UPDATE staging to join back newly inserted Trees using LEFT JOIN Stem
 *      to bind only to Trees with no existing Stem (supports CTFS databases
 *      where the same Tag appears in different plots).
 *
 * Output is indented two spaces — it is a procedure-body fragment, not a full procedure.
 */
export function renderStage6NewTrees(opts: StageBulkInsertOptions): string {
  const m = escapeSqlIdentifier(opts.measurementsTable);
  return `  -- Stage 6: bulk insert new Trees + plot-aware join-back
  INSERT INTO Tree (Tag, SpeciesID, SubSpeciesID)
    SELECT nt.Tag, nt.SpeciesID, nt.SubSpeciesID
      FROM (
        SELECT Tag, SpeciesID, SubSpeciesID, MIN(TempID) AS first_temp_id
          FROM ${m}
         WHERE TreeID IS NULL
         GROUP BY Tag, SpeciesID, SubSpeciesID
      ) nt
     ORDER BY nt.first_temp_id;

  UPDATE ${m} t
    JOIN Tree tr ON tr.Tag = t.Tag
                AND tr.SpeciesID = t.SpeciesID
                AND tr.SubSpeciesID <=> t.SubSpeciesID
    LEFT JOIN Stem existing_stem ON existing_stem.TreeID = tr.TreeID
    SET t.TreeID = tr.TreeID
    WHERE t.TreeID IS NULL
      AND existing_stem.StemID IS NULL;
`;
}

// ---------------------------------------------------------------------------
// Stage 7: Bulk-insert new Stem rows with set-based join-back
// ---------------------------------------------------------------------------

/**
 * Renders the Stage 7 procedure-body fragment.
 *
 * Two-statement pattern:
 *   1. INSERT into Stem for rows where StemID IS NULL, using LEGACY_DEFAULT_STEM_NUMBER
 *      for StemNumber and (LX, LY) mapped to (QX, QY), ordered by TempID.
 *   2. UPDATE staging to join back newly inserted Stems using (TreeID, StemTag, QuadratID)
 *      with NULL-safe <=> for StemTag.
 *
 * Output is indented two spaces — it is a procedure-body fragment, not a full procedure.
 */
export function renderStage7NewStems(opts: StageBulkInsertOptions): string {
  const m = escapeSqlIdentifier(opts.measurementsTable);
  return `  -- Stage 7: bulk insert new Stems, set-based join-back
  INSERT INTO Stem (TreeID, StemTag, QuadratID, StemNumber, QX, QY)
    SELECT TreeID, StemTag, QuadratID, ${LEGACY_DEFAULT_STEM_NUMBER}, LX, LY
      FROM ${m}
     WHERE StemID IS NULL
     ORDER BY TempID;

  UPDATE ${m} t
    JOIN Stem s ON s.TreeID = t.TreeID
                AND s.StemTag <=> t.StemTag
                AND s.QuadratID = t.QuadratID
    SET t.StemID = s.StemID
    WHERE t.StemID IS NULL;
`;
}

// ---------------------------------------------------------------------------
// Stage 8: Bulk-insert DBH rows with set-based join-back
// ---------------------------------------------------------------------------

/**
 * Renders the Stage 8 procedure-body fragment.
 *
 * Two-statement pattern:
 *   1. INSERT into DBH using LEGACY_DEFAULT_MEASURE_ID for MeasureID,
 *      @target_census_id for CensusID, and other columns from staging,
 *      ordered by TempID.
 *   2. UPDATE staging to join back newly inserted DBH rows using (StemID, CensusID).
 *
 * Output is indented two spaces — it is a procedure-body fragment, not a full procedure.
 */
export function renderStage8DBH(opts: StageBulkInsertOptions): string {
  const m = escapeSqlIdentifier(opts.measurementsTable);
  return `  -- Stage 8: bulk insert DBH, set-based join-back
  INSERT INTO DBH (MeasureID, StemID, CensusID, DBH, HOM, PrimaryStem, ExactDate, Comments)
    SELECT ${LEGACY_DEFAULT_MEASURE_ID}, StemID, @target_census_id, DBH, HOM, PrimaryStem, ExactDate, Comments
      FROM ${m}
     ORDER BY TempID;

  UPDATE ${m} t
    JOIN DBH d ON d.StemID = t.StemID AND d.CensusID = @target_census_id
    SET t.DBHID = d.DBHID;
`;
}

// ---------------------------------------------------------------------------
// Stage 9: Bulk insert DBHAttributes
// ---------------------------------------------------------------------------

export function renderStage9DBHAttributes(opts: { measurementsTable: string; attributesTable: string }): string {
  const m = escapeSqlIdentifier(opts.measurementsTable);
  const a = escapeSqlIdentifier(opts.attributesTable);
  // JOIN on CoreMeasurementID — the natural key on both staging tables — rather
  // than positional TempID/TempMeasurementID. The previous design relied on
  // implementation-defined AUTO_INCREMENT ordering aligning with INSERT VALUES
  // tuple order, which would silently misattach attributes if MySQL ever
  // burned an AUTO_INCREMENT value between rows.
  return `  -- Stage 9: populate DBHAttributes (post-DBCHANGES2014f shape: TSMID, DBHID)
  UPDATE ${a} a
    JOIN ${m} m ON m.CoreMeasurementID = a.CoreMeasurementID
    SET a.DBHID = m.DBHID;

  INSERT INTO DBHAttributes (TSMID, DBHID)
    SELECT TSMID, DBHID
      FROM ${a}
     WHERE DBHID IS NOT NULL AND TSMID IS NOT NULL
     ORDER BY TempAttrID;
`;
}

// ---------------------------------------------------------------------------
// Stage 10: final tally
// ---------------------------------------------------------------------------

export function renderStage10(opts: { measurementsTable: string; attributesTable: string }): string {
  const m = escapeSqlIdentifier(opts.measurementsTable);
  const a = escapeSqlIdentifier(opts.attributesTable);
  // MySQL cannot open the same TEMPORARY table more than once in a single SQL
  // statement (ER_CANT_REOPEN_TABLE). The original scalar-subquery pattern
  //   SELECT (SELECT COUNT(*) FROM m), (SELECT COUNT(*) FROM m)
  // causes this error. Use a single GROUP BY scan instead.
  return `  -- Stage 10: final tally (single-scan to avoid ER_CANT_REOPEN_TABLE with TEMPORARY tables)
  SELECT COUNT(*) AS measurement_rows, COUNT(DISTINCT TreeID) AS tree_count, COUNT(DISTINCT StemID) AS stem_count
    FROM ${m};
  SELECT COUNT(*) AS attribute_rows FROM ${a};
`;
}

// ---------------------------------------------------------------------------
// Post-load: ViewFullTable handling
// ---------------------------------------------------------------------------

/**
 * Emit the post-COMMIT, post-procedure CTFSWeb reporting rebuild step.
 *
 * Suzanne's provided `creating_ViewFullTable.sql` installs `CreateFullView`
 * (and helpers) into `ctfsweb_webuser`. The Stage 0 install probe already
 * SIGNALed if the procedure was missing, so by the time we reach this point
 * the procedure is known to exist on the destination.
 *
 * `CreateFullView` does DROP/CREATE TABLE (DDL → implicit commit), so it
 * cannot live inside the load transaction. It runs outside the procedure
 * envelope so a failure here does not invalidate the just-committed data
 * load and the operator can re-run the rebuild independently.
 */
export function renderPostLoadViewFullTableCall(): string {
  return `-- Post-load: rebuild CTFSWeb ViewFullTable (DDL — runs outside the load transaction).
-- The Stage 0 install probe SIGNALed earlier if ctfsweb_webuser.CreateFullView
-- was missing, so the load only reaches this line when the procedure is
-- installed on the destination.
CALL ctfsweb_webuser.CreateFullView(DATABASE(), 'ViewFullTable');
SELECT 'ViewFullTable rebuild' AS scope, 'completed' AS status;
`;
}
