import { describe, it, expect } from 'vitest';
import {
  renderFullPipeline,
  renderProcedureEnvelope,
  renderStage0,
  renderStage0bReload,
  renderStage1,
  renderStage2,
  renderStage5,
  renderStage6NewTrees,
  renderStage7NewStems,
  renderStage8DBH,
  renderStage10,
  type Stage1Options
} from '../lib/csv-to-sql-v2';
import { mapCsvRowToStagingRow, type MeasurementStagingRow, type AttributeStagingRow } from '../lib/csv-to-sql-shared';

describe('renderProcedureEnvelope', () => {
  const baseOpts = {
    procedureName: 'csv_to_sql_v2_load_1_2_abc12345',
    lockName: 'ctfs-export:1:2',
    cursorDeclarations: [] as string[],
    body: '  -- body'
  };

  it('uses the supplied procedureName in DROP/CREATE/CALL/DROP', () => {
    const sql = renderProcedureEnvelope(baseOpts);
    expect(sql).toMatch(/DROP PROCEDURE IF EXISTS csv_to_sql_v2_load_1_2_abc12345;/);
    expect(sql).toMatch(/CREATE PROCEDURE csv_to_sql_v2_load_1_2_abc12345\(\)/);
    expect(sql).toMatch(/CALL csv_to_sql_v2_load_1_2_abc12345\(\);/);
    expect(sql.match(/DROP PROCEDURE csv_to_sql_v2_load_1_2_abc12345;/g)?.length).toBeGreaterThanOrEqual(1);
    expect(sql).not.toMatch(/csv_to_sql_v2_load(?!_)/); // no bare legacy name
  });

  it('emits GET_LOCK before START TRANSACTION', () => {
    const sql = renderProcedureEnvelope(baseOpts);
    const lockIdx = sql.indexOf("GET_LOCK('ctfs-export:1:2', 0)");
    const txIdx = sql.indexOf('START TRANSACTION');
    expect(lockIdx).toBeGreaterThan(-1);
    expect(txIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeLessThan(txIdx);
  });

  it('emits RELEASE_LOCK after COMMIT in the success path', () => {
    const sql = renderProcedureEnvelope(baseOpts);
    const commitIdx = sql.indexOf('COMMIT;');
    const releaseIdx = sql.indexOf("RELEASE_LOCK('ctfs-export:1:2')", commitIdx);
    expect(commitIdx).toBeGreaterThan(-1);
    expect(releaseIdx).toBeGreaterThan(commitIdx);
  });

  it('EXIT HANDLER block calls ROLLBACK, RELEASE_LOCK, then RESIGNAL', () => {
    const sql = renderProcedureEnvelope(baseOpts);
    const handler = sql.match(/EXIT HANDLER FOR SQLEXCEPTION\s+BEGIN[\s\S]+?END;/)?.[0];
    expect(handler).toBeDefined();
    const rb = handler!.indexOf('ROLLBACK;');
    const rl = handler!.indexOf("RELEASE_LOCK('ctfs-export:1:2')");
    const rs = handler!.indexOf('RESIGNAL;');
    expect(rb).toBeGreaterThan(-1);
    expect(rl).toBeGreaterThan(rb);
    expect(rs).toBeGreaterThan(rl);
  });

  it('rejects invalid procedureName via escapeSqlIdentifier', () => {
    expect(() => renderProcedureEnvelope({ ...baseOpts, procedureName: 'bad name; DROP TABLE' })).toThrow(/Invalid SQL identifier/);
  });

  it('escapes lockName through SqlString.escape (single quotes doubled, etc.)', () => {
    const sql = renderProcedureEnvelope({ ...baseOpts, lockName: "x'y" });
    // mysql2's escape uses backslash escaping: 'x\'y'
    expect(sql).toMatch(/GET_LOCK\('x\\'y', 0\)/);
  });

  it('emits drop/delimiter/create/declares/handler/lock/tx/body/commit/release/end/call/drop', () => {
    const sql = renderProcedureEnvelope({ ...baseOpts, procedureName: 'csv_to_sql_v2_load', lockName: 'test-lock' });
    expect(sql).toMatch(/DROP PROCEDURE IF EXISTS csv_to_sql_v2_load;/);
    expect(sql).toMatch(/DELIMITER \/\//);
    expect(sql).toMatch(/CREATE PROCEDURE csv_to_sql_v2_load\(\)/);
    expect(sql).toMatch(/main: BEGIN/);
    expect(sql).toMatch(/DECLARE _message TEXT;/);
    expect(sql).toMatch(/DECLARE _census_count INT DEFAULT 0;/);
    expect(sql).toMatch(/DECLARE _target_census_id INT UNSIGNED;/);
    expect(sql).toMatch(/DECLARE _target_plot_id INT UNSIGNED;/);
    expect(sql).toMatch(/DECLARE _target_start_date DATE;/);
    expect(sql).toMatch(/DECLARE _done BOOL DEFAULT FALSE;/);
    expect(sql).toMatch(/DECLARE _existing_dbh_count INT DEFAULT 0;/);
    expect(sql).toMatch(/DECLARE _resprout_candidates INT DEFAULT 0;/);
    expect(sql).toMatch(/DECLARE _bad TEXT;/);
    expect(sql).toMatch(/DECLARE _new_tree_id INT UNSIGNED;/);
    expect(sql).toMatch(/DECLARE _new_stem_id INT UNSIGNED;/);
    expect(sql).toMatch(/DECLARE _new_dbh_id INT UNSIGNED;/);
    expect(sql).toMatch(/DECLARE _cur_temp_id INT UNSIGNED;/);
    expect(sql).toMatch(/DECLARE _cur_tag VARCHAR\(10\);/);
    expect(sql).toMatch(/DECLARE _cur_stem_tag VARCHAR\(32\);/);
    expect(sql).toMatch(/DECLARE CONTINUE HANDLER FOR NOT FOUND SET _done = TRUE;/);
    expect(sql).toMatch(/DECLARE EXIT HANDLER FOR SQLEXCEPTION\s+BEGIN\s+ROLLBACK;\s+RELEASE_LOCK\('test-lock'\);\s+RESIGNAL;\s+END;/);
    expect(sql).toMatch(/GET_LOCK\('test-lock', 0\)/);
    expect(sql).toMatch(/START TRANSACTION;/);
    expect(sql).toMatch(/-- body/);
    expect(sql).toMatch(/COMMIT;\s+RELEASE_LOCK\('test-lock'\);/);
    expect(sql).toMatch(/END \/\//);
    expect(sql).toMatch(/DELIMITER ;/);
    expect(sql).toMatch(/CALL csv_to_sql_v2_load\(\);\s*DROP PROCEDURE csv_to_sql_v2_load;/);
  });

  it('declaration order is variables -> cursors -> handlers', () => {
    const sql = renderProcedureEnvelope({
      ...baseOpts,
      cursorDeclarations: ['DECLARE cur_trees CURSOR FOR SELECT 1;'],
      body: ''
    });
    const cursorIdx = sql.indexOf('cur_trees CURSOR');
    const lastScalarIdx = sql.indexOf('_cur_stem_id INT UNSIGNED');
    const notFoundIdx = sql.indexOf('CONTINUE HANDLER FOR NOT FOUND');
    const exitHandlerIdx = sql.indexOf('EXIT HANDLER FOR SQLEXCEPTION');
    expect(lastScalarIdx).toBeGreaterThan(0);
    expect(cursorIdx).toBeGreaterThan(lastScalarIdx);
    expect(notFoundIdx).toBeGreaterThan(cursorIdx);
    expect(exitHandlerIdx).toBeGreaterThan(notFoundIdx);
  });

  it('cursor declarations must contain no handler (caller responsibility)', () => {
    // This is documented in the test as a reminder; renderer doesn't validate inputs.
    const sql = renderProcedureEnvelope({
      ...baseOpts,
      cursorDeclarations: ['DECLARE cur_x CURSOR FOR SELECT 1;'],
      body: ''
    });
    // Sanity: the shared NOT FOUND handler appears exactly once.
    const handlerMatches = sql.match(/CONTINUE HANDLER FOR NOT FOUND/g) ?? [];
    expect(handlerMatches.length).toBe(1);
  });
});

describe('renderStage0', () => {
  it('census guard counts rows for (plot, census) pair', () => {
    const sql = renderStage0({ destinationPlotId: 1, censusNumber: '2', allowReload: false });
    expect(sql).toMatch(/SELECT COUNT\(\*\), MIN\(CensusID\), MIN\(StartDate\)\s+INTO _census_count, _target_census_id, _target_start_date/);
    expect(sql).toMatch(/PlotID = 1\s+AND PlotCensusNumber = '2'/);
    expect(sql).toMatch(/IF _census_count <> 1 THEN/);
    expect(sql).toMatch(/SIGNAL SQLSTATE '45000'/);
  });

  it('sets @target_census_id and @target_plot_id session variables', () => {
    const sql = renderStage0({ destinationPlotId: 42, censusNumber: '3', allowReload: false });
    expect(sql).toMatch(/SET @target_census_id := _target_census_id;/);
    expect(sql).toMatch(/SET @target_plot_id := 42;/);
  });

  it('uses destinationPlotId in the census guard WHERE clause', () => {
    const sql = renderStage0({ destinationPlotId: 42, censusNumber: '7', allowReload: false });
    expect(sql).toMatch(/WHERE PlotID = 42/);
    expect(sql).toMatch(/AND PlotCensusNumber = '7'/);
    expect(sql).toMatch(/SET @target_plot_id := 42/);
  });

  it('rejects non-integer destinationPlotId', () => {
    expect(() => renderStage0({ destinationPlotId: 1.5 as any, censusNumber: '1', allowReload: false })).toThrow(
      /destinationPlotId must be a non-negative integer/
    );
    expect(() => renderStage0({ destinationPlotId: '1' as any, censusNumber: '1', allowReload: false })).toThrow(
      /destinationPlotId must be a non-negative integer/
    );
    expect(() => renderStage0({ destinationPlotId: -1, censusNumber: '1', allowReload: false })).toThrow(/destinationPlotId must be a non-negative integer/);
  });

  it('does not emit a DBHAttributes capability probe (spec dropped this)', () => {
    const sql = renderStage0({ destinationPlotId: 1, censusNumber: '1', allowReload: false });
    expect(sql).not.toMatch(/@dbhattrs_has_census_id/);
    expect(sql).not.toMatch(/information_schema/i);
  });

  it('escapes census number to prevent injection', () => {
    const sql = renderStage0({ destinationPlotId: 1, censusNumber: "2'; DROP TABLE Tree; --", allowReload: false });
    expect(sql).toContain("PlotCensusNumber = '2\\'; DROP TABLE Tree; --'");
    expect(sql).not.toContain("PlotCensusNumber = '2'; DROP TABLE Tree; --'");
  });

  it('without --allow-reload, refuses populated census', () => {
    const sql = renderStage0({ destinationPlotId: 1, censusNumber: '2', allowReload: false });
    expect(sql).toMatch(/SELECT COUNT\(\*\) INTO _existing_dbh_count\s+FROM DBH\s+WHERE CensusID = @target_census_id/);
    expect(sql).toMatch(/IF _existing_dbh_count > 0 THEN/);
    expect(sql).toMatch(/Pass --allow-reload to overwrite/);
  });

  it('without --allow-reload, does not emit reload temp tables', () => {
    const sql = renderStage0({ destinationPlotId: 1, censusNumber: '2', allowReload: false });
    expect(sql).not.toMatch(/reload_stems_to_check/);
    expect(sql).not.toMatch(/reload_trees_to_check/);
  });

  it('with allowReload=true returns only the census guard (Stage 0b is now a separate renderer)', () => {
    const sql = renderStage0({ destinationPlotId: 1, censusNumber: '2', allowReload: true });
    expect(sql).toMatch(/Stage 0: target census guard/);
    expect(sql).not.toMatch(/reload_orphan_candidates|reload_stems_to_check|DBHAttributes to delete/);
  });

  it('output is a procedure-body fragment indented two spaces (no procedure envelope)', () => {
    const sql = renderStage0({ destinationPlotId: 1, censusNumber: '2', allowReload: false });
    expect(sql).not.toMatch(/DROP PROCEDURE/);
    expect(sql).not.toMatch(/DELIMITER/);
    expect(sql).not.toMatch(/CREATE PROCEDURE/);
    expect(sql).not.toMatch(/START TRANSACTION/);
    expect(sql).not.toMatch(/COMMIT/);
    // Body fragments are indented two spaces
    expect(sql).toMatch(/^  -- Stage 0:/m);
  });
});

describe('renderStage0bReload', () => {
  it('real mode populates reload_orphan_candidates before any DELETE', () => {
    const sql = renderStage0bReload({ mode: 'real' });
    const candIdx = sql.indexOf('CREATE TEMPORARY TABLE reload_orphan_candidates');
    const firstDeleteIdx = sql.indexOf('  DELETE da');
    expect(candIdx).toBeGreaterThan(-1);
    expect(firstDeleteIdx).toBeGreaterThan(-1);
    expect(candIdx).toBeLessThan(firstDeleteIdx);
  });

  it('real mode emits count SELECTs before each DELETE', () => {
    const sql = renderStage0bReload({ mode: 'real' });
    expect(sql).toMatch(
      /SELECT 'DBHAttributes to delete' AS scope,\s*COUNT\(\*\) AS n[\s\S]+FROM DBHAttributes da[\s\S]+JOIN DBH d ON d\.DBHID = da\.DBHID[\s\S]+WHERE d\.CensusID = @target_census_id/
    );
    expect(sql).toMatch(/SELECT 'DBH to delete' AS scope,\s*COUNT\(\*\) AS n[\s\S]+FROM DBH[\s\S]+WHERE CensusID = @target_census_id/);
    expect(sql.indexOf("'DBHAttributes to delete'")).toBeLessThan(sql.indexOf('DELETE da'));
    expect(sql.indexOf("'DBH to delete'")).toBeLessThan(sql.indexOf('DELETE FROM DBH'));
  });

  it('real mode deletes DBHAttributes via JOIN through DBH (schema-agnostic)', () => {
    const sql = renderStage0bReload({ mode: 'real' });
    expect(sql).toMatch(/DELETE da[\s\S]+FROM DBHAttributes da[\s\S]+JOIN DBH d ON d\.DBHID = da\.DBHID[\s\S]+WHERE d\.CensusID = @target_census_id/);
  });

  it('real mode deletes DBH for target census', () => {
    const sql = renderStage0bReload({ mode: 'real' });
    expect(sql).toMatch(/DELETE FROM DBH WHERE CensusID = @target_census_id/);
  });

  it('real mode NEVER deletes Stem or Tree rows', () => {
    const sql = renderStage0bReload({ mode: 'real' });
    expect(sql).not.toMatch(/DELETE\s+(\w+\s+)?FROM Stem/i);
    expect(sql).not.toMatch(/DELETE\s+(\w+\s+)?FROM Tree/i);
  });

  it('real mode emits orphan-count SELECTs AFTER the DELETEs', () => {
    const sql = renderStage0bReload({ mode: 'real' });
    const lastDeleteIdx = sql.lastIndexOf('DELETE FROM DBH');
    expect(sql).toMatch(/'Orphan stems after reload'/);
    expect(sql).toMatch(/'Orphan trees after reload'/);
    expect(sql.indexOf("'Orphan stems after reload'")).toBeGreaterThan(lastDeleteIdx);
    expect(sql.indexOf("'Orphan trees after reload'")).toBeGreaterThan(lastDeleteIdx);
  });

  it('dry-run mode wraps body in SAVEPOINT + ROLLBACK TO SAVEPOINT', () => {
    const sql = renderStage0bReload({ mode: 'dry-run' });
    expect(sql).toMatch(/SAVEPOINT reload_dry/);
    expect(sql).toMatch(/ROLLBACK TO SAVEPOINT reload_dry/);
    expect(sql.indexOf('SAVEPOINT reload_dry')).toBeLessThan(sql.indexOf('ROLLBACK TO SAVEPOINT reload_dry'));
  });

  it('dry-run mode does NOT emit LEAVE main', () => {
    const sql = renderStage0bReload({ mode: 'dry-run' });
    expect(sql).not.toMatch(/LEAVE\s+main/);
  });
});

describe('renderStage1', () => {
  const opts = (overrides: Partial<Stage1Options> = {}): Stage1Options => ({
    measurementsTable: 'staging_measurements',
    attributesTable: 'staging_attributes',
    measurementRows: [],
    attributeRows: [],
    ...overrides
  });

  it('emits DROP + CREATE for both tables, both ENGINE=InnoDB TEMPORARY', () => {
    const sql = renderStage1(opts());
    expect(sql).toMatch(/DROP TEMPORARY TABLE IF EXISTS `staging_measurements`;/);
    expect(sql).toMatch(/CREATE TEMPORARY TABLE `staging_measurements` \(/);
    expect(sql).toMatch(/DROP TEMPORARY TABLE IF EXISTS `staging_attributes`;/);
    expect(sql).toMatch(/CREATE TEMPORARY TABLE `staging_attributes` \(/);
    expect((sql.match(/ENGINE=InnoDB/g) || []).length).toBe(2);
  });

  it('staging_measurements has all required columns including taxonomy context and Errors', () => {
    const sql = renderStage1(opts());
    for (const col of [
      'TempID',
      'CoreMeasurementID',
      'SourceRowIndex',
      'Tag',
      'StemTag',
      'Mnemonic',
      'QuadratName',
      'PlotCensusNumber',
      'Family',
      'Genus',
      'SpeciesName',
      'SpeciesAuthority',
      'SubspeciesName',
      'SubspeciesAuthority',
      'IDLevel',
      'DBH',
      'HOM',
      'ExactDate',
      'Comments',
      'LX',
      'LY',
      'PrimaryStem',
      'TreeID',
      'StemID',
      'SpeciesID',
      'SubSpeciesID',
      'QuadratID',
      'CensusID',
      'DBHID',
      'Errors'
    ]) {
      expect(sql).toContain(col);
    }
  });

  it('staging_attributes has all required columns including Errors', () => {
    const sql = renderStage1(opts());
    for (const col of ['TempAttrID', 'CoreMeasurementID', 'TempMeasurementID', 'TSMCode', 'TSMID', 'DBHID', 'Errors']) {
      expect(sql).toContain(col);
    }
  });

  it('emits no INSERT statements when both row arrays are empty', () => {
    const sql = renderStage1(opts());
    expect(sql).not.toMatch(/INSERT INTO/);
  });

  it('emits INSERT chunks for measurement rows', () => {
    const row: MeasurementStagingRow = {
      CoreMeasurementID: 1,
      SourceRowIndex: 1,
      Tag: 'T1',
      StemTag: 'S1',
      Mnemonic: 'FOO',
      QuadratName: 'A1',
      PlotCensusNumber: '1',
      Family: 'Fooaceae',
      Genus: 'Foo',
      SpeciesName: 'foo',
      SpeciesAuthority: 'L.',
      SubspeciesName: null,
      SubspeciesAuthority: null,
      IDLevel: 'species',
      DBH: 12.3,
      HOM: '1.3',
      ExactDate: '2024-06-01',
      Comments: null,
      LX: 1.0,
      LY: 1.0,
      PrimaryStem: null
    };
    const sql = renderStage1(opts({ measurementRows: [row] }));
    expect(sql).toMatch(/INSERT INTO `staging_measurements` \(/);
    expect(sql).toMatch(/'T1','S1','FOO'/);
    expect(sql).toMatch(/'Fooaceae','Foo','foo','L\.'/);
  });

  it('emits INSERT chunks for attribute rows', () => {
    const attr: AttributeStagingRow = { CoreMeasurementID: 1, TempMeasurementID: 1, TSMCode: 'LI' };
    const sql = renderStage1(opts({ attributeRows: [attr] }));
    expect(sql).toMatch(/INSERT INTO `staging_attributes` \(/);
    expect(sql).toMatch(/\(1,1,'LI'\)/);
  });

  it('chunks at 1000 rows per multi-row VALUES', () => {
    const row: MeasurementStagingRow = {
      CoreMeasurementID: 1,
      SourceRowIndex: 1,
      Tag: 'T1',
      StemTag: 'S1',
      Mnemonic: 'FOO',
      QuadratName: 'A1',
      PlotCensusNumber: '1',
      Family: 'F',
      Genus: 'G',
      SpeciesName: 'foo',
      SpeciesAuthority: null,
      SubspeciesName: null,
      SubspeciesAuthority: null,
      IDLevel: null,
      DBH: null,
      HOM: null,
      ExactDate: '2024-06-01',
      Comments: null,
      LX: null,
      LY: null,
      PrimaryStem: null
    };
    const rows = Array.from({ length: 1500 }, (_, i) => ({ ...row, CoreMeasurementID: i + 1 }));
    const sql = renderStage1(opts({ measurementRows: rows }));
    const inserts = sql.match(/INSERT INTO `staging_measurements`/g) || [];
    expect(inserts.length).toBe(2); // 1000 + 500
  });
});

describe('renderStage2', () => {
  const opts = { measurementsTable: 'staging_measurements', attributesTable: 'staging_attributes' };
  const sql = () => renderStage2(opts);

  it('first statement sets CensusID from session variable', () => {
    const s = sql();
    expect(s.indexOf('UPDATE `staging_measurements` SET CensusID = @target_census_id')).toBeLessThan(s.indexOf('JOIN Quadrat'));
  });

  it('QuadratID lookup joins Quadrat on QuadratName + plot scope', () => {
    expect(sql()).toMatch(/JOIN Quadrat q ON q\.QuadratName = t\.QuadratName AND q\.PlotID = @target_plot_id\s+SET t\.QuadratID = q\.QuadratID/);
  });

  it('taxonomy_lookup joins through Family -> Genus -> Species (LEFT JOIN SubSpecies)', () => {
    const s = sql();
    expect(s).toMatch(/CREATE TEMPORARY TABLE taxonomy_lookup AS/);
    expect(s).toMatch(/JOIN Family fam ON fam\.Family = t\.Family/);
    expect(s).toMatch(/JOIN Genus gen ON gen\.Genus = t\.Genus AND gen\.FamilyID = fam\.FamilyID/);
    expect(s).toMatch(/JOIN Species sp ON sp\.GenusID = gen\.GenusID\s+AND sp\.SpeciesName = t\.SpeciesName\s+AND sp\.CurrentTaxonFlag = 1/);
    expect(s).toMatch(/LEFT JOIN SubSpecies ss ON ss\.SpeciesID = sp\.SpeciesID\s+AND ss\.SubSpeciesName = t\.SubspeciesName\s+AND ss\.CurrentTaxonFlag = 1/);
  });

  it('taxonomy_lookup WHERE clause matches subspecies-present on both sides', () => {
    expect(sql()).toMatch(
      /\(t\.SubspeciesName IS NULL AND ss\.SubSpeciesID IS NULL\)\s+OR\s+\(t\.SubspeciesName IS NOT NULL AND ss\.SubSpeciesID IS NOT NULL\)/
    );
  });

  it('taxonomy_lookup TaxonCount uses COUNT(DISTINCT CONCAT(SpeciesID, :, COALESCE(SubSpeciesID, 0)))', () => {
    expect(sql()).toMatch(/COUNT\(DISTINCT CONCAT\(sp\.SpeciesID, ':', COALESCE\(ss\.SubSpeciesID, 0\)\)\) AS TaxonCount/);
  });

  it('taxonomy write-back sets both SpeciesID and SubSpeciesID where TaxonCount = 1', () => {
    expect(sql()).toMatch(
      /JOIN taxonomy_lookup tx ON tx\.TempID = t\.TempID AND tx\.TaxonCount = 1\s+SET t\.SpeciesID = tx\.SpeciesID,\s+t\.SubSpeciesID = tx\.SubSpeciesID/
    );
  });

  it('tree_lookup groups by (Tag, SpeciesID, SubSpeciesID) and is plot-scoped via Stem -> Quadrat', () => {
    const s = sql();
    expect(s).toMatch(/CREATE TEMPORARY TABLE tree_lookup AS/);
    expect(s).toMatch(
      /FROM Tree tr\s+JOIN Stem s ON s\.TreeID = tr\.TreeID\s+JOIN Quadrat q ON q\.QuadratID = s\.QuadratID\s+WHERE q\.PlotID = @target_plot_id\s+GROUP BY tr\.Tag, tr\.SpeciesID, tr\.SubSpeciesID/
    );
  });

  it('tree write-back uses NULL-safe <=> on SubSpeciesID, not IS NULL', () => {
    const s = sql();
    expect(s).toMatch(/tl\.Tag = t\.Tag\s+AND tl\.SpeciesID = t\.SpeciesID\s+AND tl\.SubSpeciesID <=> t\.SubSpeciesID\s+AND tl\.TreeCount = 1/);
    expect(s).not.toMatch(/tl\.SubSpeciesID IS NULL/);
  });

  it('stem_lookup plot-scoped and grouped by (TreeID, StemTag)', () => {
    const s = sql();
    expect(s).toMatch(/CREATE TEMPORARY TABLE stem_lookup AS/);
    expect(s).toMatch(/GROUP BY s\.TreeID, s\.StemTag/);
  });

  it('stem write-back uses NULL-safe <=> on StemTag', () => {
    expect(sql()).toMatch(/sl\.TreeID = t\.TreeID\s+AND sl\.StemTag <=> t\.StemTag\s+AND sl\.StemCount = 1/);
  });

  it('TSMID resolution UPDATE joins staging_attributes to TSMAttributes by TSMCode', () => {
    expect(sql()).toMatch(/UPDATE `staging_attributes` a\s+JOIN TSMAttributes tsm ON tsm\.TSMCode = a\.TSMCode\s+SET a\.TSMID = tsm\.TSMID/);
  });

  it('does not join on Mnemonic anywhere in Stage 2', () => {
    expect(sql()).not.toMatch(/JOIN .+ ON .+Mnemonic/);
  });

  it('DROP TEMPORARY TABLE IF EXISTS precedes each CREATE TEMPORARY TABLE', () => {
    const s = sql();
    for (const t of ['taxonomy_lookup', 'tree_lookup', 'stem_lookup']) {
      const drop = s.indexOf(`DROP TEMPORARY TABLE IF EXISTS ${t}`);
      const create = s.indexOf(`CREATE TEMPORARY TABLE ${t}`);
      expect(drop).toBeGreaterThan(-1);
      expect(create).toBeGreaterThan(drop);
    }
  });

  it('rejects invalid measurementsTable identifier (injection guard)', () => {
    expect(() => renderStage2({ measurementsTable: 'a; DROP TABLE x', attributesTable: 'staging_attributes' })).toThrow(/Invalid SQL identifier/);
  });
});

describe('renderStage5', () => {
  const opts = { measurementsTable: 'staging_measurements', attributesTable: 'staging_attributes' };
  const sql = () => renderStage5(opts);

  it('check 1: required-field NOT NULL', () => {
    expect(sql()).toMatch(/'Missing required field'/);
    expect(sql()).toMatch(/Tag IS NULL OR StemTag IS NULL OR Mnemonic IS NULL OR QuadratName IS NULL OR ExactDate IS NULL/);
  });

  it('check 2: taxonomy not uniquely resolved', () => {
    expect(sql()).toMatch(/'Taxonomy not uniquely resolved'/);
    expect(sql()).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM taxonomy_lookup tx[\s\S]+tx\.TaxonCount = 1/);
  });

  it('check 3: ambiguous tree key (TreeCount > 1)', () => {
    expect(sql()).toMatch(/'Ambiguous tree key'/);
    expect(sql()).toMatch(/tl\.TreeCount > 1/);
  });

  it('check 4: ambiguous stem key (StemCount > 1)', () => {
    expect(sql()).toMatch(/'Ambiguous stem key'/);
    expect(sql()).toMatch(/sl\.StemCount > 1/);
  });

  it('check 5: unknown quadrat', () => {
    expect(sql()).toMatch(/'Unknown quadrat'/);
    expect(sql()).toMatch(/QuadratID IS NULL AND QuadratName IS NOT NULL/);
  });

  it('check 6: unknown TSMCode on staging_attributes', () => {
    expect(sql()).toMatch(/'Unknown TSMCode'/);
    expect(sql()).toMatch(/UPDATE `staging_attributes`[\s\S]+TSMID IS NULL AND TSMCode IS NOT NULL/);
  });

  it('check 7: duplicate (StemID, CensusID)', () => {
    expect(sql()).toMatch(/'Duplicate \(StemID, CensusID\) destination'/);
    expect(sql()).toMatch(/GROUP BY StemID, CensusID\s+HAVING COUNT\(\*\) > 1/);
  });

  it('check 8: duplicate new-stem natural key', () => {
    expect(sql()).toMatch(/'Duplicate new-stem natural key'/);
    expect(sql()).toMatch(/GROUP BY TreeID, StemTag, QuadratID\s+HAVING COUNT\(\*\) > 1/);
  });

  it('check 9: ambiguous pre-existing Tree (orphan)', () => {
    expect(sql()).toMatch(/'Ambiguous pre-existing Tree \(orphan\)'/);
    expect(sql()).toMatch(/FROM Tree tr\s+LEFT JOIN Stem s ON s\.TreeID = tr\.TreeID[\s\S]+s\.StemID IS NULL/);
  });

  it('check 10: string lengths for measurements + TSMCode width for attributes', () => {
    expect(sql()).toMatch(/CHAR_LENGTH\(Tag\) > 10 OR CHAR_LENGTH\(StemTag\) > 32 OR CHAR_LENGTH\(QuadratName\) > 8 OR CHAR_LENGTH\(Comments\) > 128/);
    expect(sql()).toMatch(/'TSMCode too long for CTFS'/);
    expect(sql()).toMatch(/CHAR_LENGTH\(TSMCode\) > 10/);
  });

  it('errors are accumulated via CONCAT, not overwritten', () => {
    expect(sql()).toMatch(/SET Errors = CONCAT\(COALESCE\(Errors, ''\), CASE WHEN Errors IS NULL THEN '' ELSE '; ' END,/);
  });

  it('final SIGNAL is gated on EXISTS in either staging table', () => {
    expect(sql()).toMatch(
      /IF EXISTS \(SELECT 1 FROM `staging_measurements` WHERE Errors IS NOT NULL\)\s+OR EXISTS \(SELECT 1 FROM `staging_attributes` WHERE Errors IS NOT NULL\) THEN/
    );
  });

  it('final SELECT for measurements carries CoreMeasurementID + SourceRowIndex for tracing', () => {
    expect(sql()).toMatch(
      /SELECT TempID, CoreMeasurementID, SourceRowIndex, Tag, StemTag, Mnemonic, QuadratName, Errors\s+FROM `staging_measurements` WHERE Errors IS NOT NULL ORDER BY TempID/
    );
  });

  it('final SELECT for attributes carries trace columns', () => {
    expect(sql()).toMatch(
      /SELECT TempAttrID, CoreMeasurementID, TempMeasurementID, TSMCode, Errors\s+FROM `staging_attributes` WHERE Errors IS NOT NULL ORDER BY TempAttrID/
    );
  });

  it('uses one stable short SIGNAL message; no LEFT(_,128) truncation', () => {
    expect(sql()).toMatch(/SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Validation failed; see prior SELECT for per-row details'/);
    expect(sql()).not.toMatch(/LEFT\([^,]+, 128\)/);
  });

  it('no SET _bad = NULL pattern remains', () => {
    expect(sql()).not.toMatch(/SET _bad = NULL/);
  });

  it('rejects invalid measurementsTable identifier', () => {
    expect(() => renderStage5({ measurementsTable: 'a; DROP TABLE x', attributesTable: 'staging_attributes' })).toThrow(/Invalid SQL identifier/);
  });

  it('rejects invalid attributesTable identifier', () => {
    expect(() => renderStage5({ measurementsTable: 'staging_measurements', attributesTable: 'a; DROP TABLE x' })).toThrow(/Invalid SQL identifier/);
  });

  it('is a procedure-body fragment (no procedure envelope, no DELIMITER, no TRANSACTION)', () => {
    expect(sql()).not.toMatch(/DROP PROCEDURE/);
    expect(sql()).not.toMatch(/DELIMITER/);
    expect(sql()).not.toMatch(/CREATE PROCEDURE/);
    expect(sql()).not.toMatch(/START TRANSACTION/);
    expect(sql()).not.toMatch(/COMMIT/);
    expect(sql()).toMatch(/^  -- Stage 5:/m);
  });
});

describe('renderStage6NewTrees', () => {
  it('returns cursorDeclaration without handler', () => {
    const { cursorDeclaration } = renderStage6NewTrees({ tempTable: 'TempAllTrees' });
    expect(cursorDeclaration).toMatch(/DECLARE cur_new_trees CURSOR FOR/);
    expect(cursorDeclaration).not.toMatch(/HANDLER/); // shared handler lives in envelope
  });

  it('body opens, fetches, inserts, captures LAST_INSERT_ID, updates staging, closes', () => {
    const { body } = renderStage6NewTrees({ tempTable: 'TempAllTrees' });
    expect(body).toMatch(/OPEN cur_new_trees;/);
    expect(body).toMatch(/FETCH cur_new_trees INTO/);
    expect(body).toMatch(/INSERT INTO Tree \(Tag, SpeciesID, SubSpeciesID\) VALUES/);
    expect(body).toMatch(/SET _new_tree_id = LAST_INSERT_ID\(\);/);
    expect(body).toMatch(/UPDATE `TempAllTrees` SET TreeID = _new_tree_id/);
    expect(body).toMatch(/CLOSE cur_new_trees;/);
  });

  it('does not reference Tree.PlotID', () => {
    const { body } = renderStage6NewTrees({ tempTable: 'TempAllTrees' });
    expect(body).not.toMatch(/Tree.*PlotID|PlotID.*Tree/);
  });
});

describe('renderStage7NewStems', () => {
  it('cursor declaration has no handler', () => {
    const { cursorDeclaration } = renderStage7NewStems({ tempTable: 'TempAllTrees' });
    expect(cursorDeclaration).toMatch(/DECLARE cur_new_stems CURSOR FOR/);
    expect(cursorDeclaration).not.toMatch(/HANDLER/);
  });

  it('INSERT shape includes explicit StemNumber=0', () => {
    const { body } = renderStage7NewStems({ tempTable: 'TempAllTrees' });
    expect(body).toMatch(
      /INSERT INTO Stem \(TreeID, StemTag, QuadratID, StemNumber, QX, QY\)\s+VALUES \(_cur_tree_id, _cur_stem_tag, _cur_quadrat_id, 0, _cur_x, _cur_y\);/
    );
  });

  it('per-TempID write-back', () => {
    const { body } = renderStage7NewStems({ tempTable: 'TempAllTrees' });
    expect(body).toMatch(/UPDATE `TempAllTrees` SET StemID = _new_stem_id WHERE TempID = _cur_temp_id;/);
  });

  it('cursor selects per-row TempID, TreeID, StemTag, QuadratID, X, Y where StemID IS NULL', () => {
    const { cursorDeclaration } = renderStage7NewStems({ tempTable: 'TempAllTrees' });
    expect(cursorDeclaration).toMatch(/SELECT TempID, TreeID, StemTag, QuadratID, X, Y/);
    expect(cursorDeclaration).toMatch(/WHERE StemID IS NULL/);
  });
});

describe('renderStage8DBH', () => {
  it('cursor declaration has no handler', () => {
    const { cursorDeclaration } = renderStage8DBH({ tempTable: 'TempAllTrees' });
    expect(cursorDeclaration).toMatch(/DECLARE cur_dbh CURSOR FOR/);
    expect(cursorDeclaration).not.toMatch(/HANDLER/);
  });

  it('INSERT includes explicit MeasureID=0, StemID, CensusID from @target_census_id, and Comments', () => {
    const { body } = renderStage8DBH({ tempTable: 'TempAllTrees' });
    expect(body).toMatch(
      /INSERT INTO DBH \(MeasureID, StemID, CensusID, DBH, HOM, PrimaryStem, ExactDate, Comments\)\s+VALUES \(0, _cur_stem_id, @target_census_id, _cur_dbh, _cur_hom, _cur_primary_stem, _cur_exact_date, _cur_comments\);/
    );
  });

  it('per-TempID write-back of DBHID', () => {
    const { body } = renderStage8DBH({ tempTable: 'TempAllTrees' });
    expect(body).toMatch(/UPDATE `TempAllTrees` SET DBHID = _new_dbh_id WHERE TempID = _cur_temp_id;/);
  });

  it('cursor selects TempID, StemID, DBH, HOM, PrimaryStem, ExactDate, Comments over all rows', () => {
    const { cursorDeclaration } = renderStage8DBH({ tempTable: 'TempAllTrees' });
    expect(cursorDeclaration).toMatch(/SELECT TempID, StemID, DBH, HOM, PrimaryStem, ExactDate, Comments/);
    expect(cursorDeclaration).toMatch(/ORDER BY TempID/);
    expect(cursorDeclaration).not.toMatch(/WHERE/);
  });
});

describe('renderStage10', () => {
  it('emits final tally with all four counts', () => {
    const sql = renderStage10({ tempTable: 'TempAllTrees' });
    expect(sql).toMatch(
      /SELECT\s+SUM\(Tagged = 'O'\) AS old_trees,\s+SUM\(Tagged = 'M'\) AS multi_stems,\s+SUM\(Tagged = 'N'\) AS new_plants,\s+COUNT\(\*\) AS total\s+FROM `TempAllTrees`;/
    );
  });
});

describe('renderFullPipeline', () => {
  const SAMPLE_CSV_ROW = {
    tag: 'T001',
    stemtag: 'S001',
    spcode: 'QURU',
    quadrat: 'A01',
    lx: '1.5',
    ly: '2.5',
    dbh: '12.3',
    hom: '1.3',
    date: '2024-03-15',
    codes: 'A'
  };

  const sampleRow = mapCsvRowToStagingRow(SAMPLE_CSV_ROW, 7, '4');

  const baseArgs = () => ({
    plotId: 7,
    censusNumber: '4',
    allowReload: false,
    tempTable: 'TempAllTrees'
  });

  it('returns a non-empty string', () => {
    const sql = renderFullPipeline({ ...baseArgs(), stagingRows: [sampleRow] });
    expect(typeof sql).toBe('string');
    expect(sql.length).toBeGreaterThan(0);
  });

  it('contains the procedure envelope (DROP/CREATE/END/CALL/DROP) with placeholder procedure name', () => {
    const sql = renderFullPipeline({ ...baseArgs(), stagingRows: [sampleRow] });
    // renderFullPipeline uses a placeholder name; tests verify the structure exists
    expect(sql).toMatch(/DROP PROCEDURE IF EXISTS csv_to_sql_v2_load;/);
    expect(sql).toMatch(/CREATE PROCEDURE csv_to_sql_v2_load\(\)/);
    expect(sql).toMatch(/END \/\//);
    expect(sql).toMatch(/CALL csv_to_sql_v2_load\(\);/);
    expect(sql).toMatch(/DROP PROCEDURE csv_to_sql_v2_load;/);
  });

  it('emits 8 stage headers in order after pivot: 0, 1, 2, 5, 6, 7, 8, 10', () => {
    const sql = renderFullPipeline({ ...baseArgs(), stagingRows: [sampleRow] });
    const headers = ['-- Stage 0:', '-- Stage 1:', '-- Stage 2:', '-- Stage 5:', '-- Stage 6:', '-- Stage 7:', '-- Stage 8:', '-- Stage 10:'];
    const indices = headers.map(h => sql.indexOf(h));
    for (let i = 0; i < indices.length; i++) {
      expect(indices[i], `header missing: ${headers[i]}`).toBeGreaterThan(0);
    }
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i], `expected ${headers[i]} (at ${indices[i]}) to appear after ${headers[i - 1]} (at ${indices[i - 1]})`).toBeGreaterThan(indices[i - 1]);
    }
  });

  it('does not emit deleted stage headers (2b, 3, 4, 9a, 9b)', () => {
    const sql = renderFullPipeline({ ...baseArgs(), stagingRows: [sampleRow] });
    expect(sql).not.toMatch(/-- Stage 2b:/);
    expect(sql).not.toMatch(/-- Stage 3:/);
    expect(sql).not.toMatch(/-- Stage 4:/);
    expect(sql).not.toMatch(/-- Stage 9a:/);
    expect(sql).not.toMatch(/-- Stage 9b:/);
  });

  it('declares cur_new_trees, cur_new_stems, cur_dbh inside main: BEGIN before the EXIT HANDLER', () => {
    const sql = renderFullPipeline({ ...baseArgs(), stagingRows: [sampleRow] });
    const mainBeginIdx = sql.indexOf('main: BEGIN');
    const curTreesIdx = sql.indexOf('cur_new_trees CURSOR');
    const curStemsIdx = sql.indexOf('cur_new_stems CURSOR');
    const curDbhIdx = sql.indexOf('cur_dbh CURSOR');
    const exitHandlerIdx = sql.indexOf('EXIT HANDLER FOR SQLEXCEPTION');
    expect(mainBeginIdx).toBeGreaterThan(0);
    expect(curTreesIdx).toBeGreaterThan(mainBeginIdx);
    expect(curStemsIdx).toBeGreaterThan(mainBeginIdx);
    expect(curDbhIdx).toBeGreaterThan(mainBeginIdx);
    expect(curTreesIdx).toBeLessThan(exitHandlerIdx);
    expect(curStemsIdx).toBeLessThan(exitHandlerIdx);
    expect(curDbhIdx).toBeLessThan(exitHandlerIdx);
  });

  it('emits cursor declarations after scalar declares and before the NOT FOUND handler', () => {
    const sql = renderFullPipeline({ ...baseArgs(), stagingRows: [sampleRow] });
    const lastScalarIdx = sql.indexOf('_cur_stem_id INT UNSIGNED');
    const firstCursorIdx = sql.indexOf('cur_new_trees CURSOR');
    const notFoundIdx = sql.indexOf('CONTINUE HANDLER FOR NOT FOUND');
    expect(lastScalarIdx).toBeGreaterThan(0);
    expect(firstCursorIdx).toBeGreaterThan(lastScalarIdx);
    expect(notFoundIdx).toBeGreaterThan(firstCursorIdx);
  });

  it('honors a custom tempTable name in every stage', () => {
    const args = { plotId: 7, censusNumber: '4', allowReload: false, tempTable: 'MyCustomStaging' };
    const sql = renderFullPipeline({ ...args, stagingRows: [sampleRow] });
    expect(sql).toMatch(/`MyCustomStaging`/);
    expect(sql).not.toMatch(/`TempAllTrees`/);
  });
});
