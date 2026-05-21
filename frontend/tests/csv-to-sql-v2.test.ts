import { describe, it, expect } from 'vitest';
import {
  renderProcedureEnvelope,
  renderStage0,
  renderStage0bReload,
  renderStage1,
  renderStage2,
  renderStage5,
  renderStage6NewTrees,
  renderStage7NewStems,
  renderStage8DBH,
  renderStage9DBHAttributes,
  renderStage10,
  renderPostLoadViewFullTableCall,
  LEGACY_DEFAULT_STEM_NUMBER,
  LEGACY_DEFAULT_MEASURE_ID,
  type Stage1Options
} from '../lib/csv-to-sql-v2';
import { type MeasurementStagingRow, type AttributeStagingRow } from '../lib/csv-to-sql-shared';

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

  it('emits DO RELEASE_LOCK after COMMIT in the success path', () => {
    const sql = renderProcedureEnvelope(baseOpts);
    const commitIdx = sql.indexOf('COMMIT;');
    const releaseIdx = sql.indexOf("DO RELEASE_LOCK('ctfs-export:1:2')", commitIdx);
    expect(commitIdx).toBeGreaterThan(-1);
    expect(releaseIdx).toBeGreaterThan(commitIdx);
  });

  it('can emit post-commit body before releasing the lock', () => {
    const sql = renderProcedureEnvelope({ ...baseOpts, postCommitBody: "  SELECT 'post-commit' AS scope;" });
    const commitIdx = sql.indexOf('COMMIT;');
    const postIdx = sql.indexOf("SELECT 'post-commit' AS scope;");
    const releaseIdx = sql.indexOf("DO RELEASE_LOCK('ctfs-export:1:2')", postIdx);
    expect(commitIdx).toBeLessThan(postIdx);
    expect(postIdx).toBeLessThan(releaseIdx);
  });

  it('EXIT HANDLER block calls ROLLBACK, DO RELEASE_LOCK, then RESIGNAL', () => {
    const sql = renderProcedureEnvelope(baseOpts);
    const handler = sql.match(/EXIT HANDLER FOR SQLEXCEPTION\s+BEGIN[\s\S]+?END;/)?.[0];
    expect(handler).toBeDefined();
    const rb = handler!.indexOf('ROLLBACK;');
    const rl = handler!.indexOf("DO RELEASE_LOCK('ctfs-export:1:2')");
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
    // Live SCALAR_DECLARES only — resprout/cursor scratch removed with the pivot.
    expect(sql).toMatch(/DECLARE _message TEXT;/);
    expect(sql).toMatch(/DECLARE _census_count INT DEFAULT 0;/);
    expect(sql).toMatch(/DECLARE _target_census_id INT UNSIGNED;/);
    expect(sql).toMatch(/DECLARE _existing_dbh_count INT DEFAULT 0;/);
    expect(sql).toMatch(/DECLARE _viewfulltable_installed INT DEFAULT 0;/);
    expect(sql).toMatch(/DECLARE _lock_result INT DEFAULT 0;/);
    // Dead scalars were dropped with the pivot — assert their absence.
    expect(sql).not.toMatch(/DECLARE _target_plot_id /);
    expect(sql).not.toMatch(/DECLARE _target_start_date /);
    expect(sql).not.toMatch(/DECLARE _done /);
    expect(sql).not.toMatch(/DECLARE _resprout_candidates /);
    expect(sql).not.toMatch(/DECLARE _bad /);
    expect(sql).not.toMatch(/CONTINUE HANDLER FOR NOT FOUND/);
    expect(sql).toMatch(/DECLARE EXIT HANDLER FOR SQLEXCEPTION\s+BEGIN\s+ROLLBACK;\s+DO RELEASE_LOCK\('test-lock'\);\s+RESIGNAL;\s+END;/);
    // GET_LOCK now distinguishes NULL (subsystem error) from 0 (lock held).
    expect(sql).toMatch(/SET _lock_result = GET_LOCK\('test-lock', 0\);/);
    expect(sql).toMatch(/IF _lock_result IS NULL THEN/);
    expect(sql).toMatch(/lock subsystem returned NULL/);
    expect(sql).toMatch(/IF _lock_result = 0 THEN/);
    expect(sql).toMatch(/Another ctfs-sql export is running/);
    expect(sql).toMatch(/START TRANSACTION;/);
    expect(sql).toMatch(/-- body/);
    expect(sql).toMatch(/COMMIT;\s+DO RELEASE_LOCK\('test-lock'\);/);
    expect(sql).toMatch(/END \/\//);
    expect(sql).toMatch(/DELIMITER ;/);
    expect(sql).toMatch(/CALL csv_to_sql_v2_load\(\);\s*DROP PROCEDURE csv_to_sql_v2_load;/);
  });

  it('rejects non-empty cursorDeclarations (no cursors after pivot)', () => {
    expect(() =>
      renderProcedureEnvelope({
        ...baseOpts,
        cursorDeclarations: ['DECLARE cur_trees CURSOR FOR SELECT 1;'],
        body: ''
      })
    ).toThrow(/cursorDeclarations is unsupported/);
  });
});

describe('renderStage0', () => {
  it('census guard counts rows for (plot, census) pair', () => {
    const sql = renderStage0({ destinationPlotId: 1, censusNumber: '2', allowReload: false });
    expect(sql).toMatch(/SELECT COUNT\(\*\), MIN\(CensusID\)\s+INTO _census_count, _target_census_id/);
    expect(sql).toMatch(/PlotID = 1\s+AND PlotCensusNumber = '2'/);
    expect(sql).toMatch(/IF _census_count <> 1 THEN/);
    expect(sql).toMatch(/SIGNAL SQLSTATE '45000'/);
    // Search keys are surfaced in the failure message so operators don't have
    // to look up which (plot, census) pair they asked for.
    expect(sql).toMatch(/Expected exactly one Census row for PlotID=1, PlotCensusNumber=/);
  });

  it('probes for ctfsweb_webuser.CreateFullView before the data load', () => {
    const sql = renderStage0({ destinationPlotId: 1, censusNumber: '2', allowReload: false });
    expect(sql).toMatch(/ctfsweb_webuser.+CreateFullView/);
    expect(sql).toMatch(/Source creating_ViewFullTable\.sql/);
  });

  it('probes that DBHAttributes does not have a CensusID column (post-2014f)', () => {
    const sql = renderStage0({ destinationPlotId: 1, censusNumber: '2', allowReload: false });
    expect(sql).toMatch(/DBHAttributes still has a CensusID column/);
    expect(sql).toMatch(/apply DBCHANGES2014f\.sql/);
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

  it('does not emit the legacy DBHAttributes capability probe (CASE branches by CensusID-vs-no-CensusID)', () => {
    // The pivot replaced the dual-schema capability probe with a hard SIGNAL
    // for pre-2014f destinations. information_schema IS now referenced (for
    // the new probe) but the legacy @dbhattrs_has_census_id session variable
    // and the IF/ELSE branching are gone.
    const sql = renderStage0({ destinationPlotId: 1, censusNumber: '1', allowReload: false });
    expect(sql).not.toMatch(/@dbhattrs_has_census_id/);
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
    // IDLevel and SubspeciesAuthority were dropped — nothing in Stages 2/5/6/7/8/9
    // reads them, so they no longer roundtrip through staging.
    expect(sql).not.toMatch(/^\s+IDLevel\s+VARCHAR/m);
    expect(sql).not.toMatch(/^\s+SubspeciesAuthority\s+VARCHAR/m);
  });

  it('staging_measurements indexes CoreMeasurementID uniquely (Stage 9 joins on it)', () => {
    const sql = renderStage1(opts());
    expect(sql).toMatch(/UNIQUE KEY uxCoreMeasurementID \(CoreMeasurementID\)/);
  });

  it('staging text columns are wider than CTFS destination widths so Stage 5 owns width errors', () => {
    const sql = renderStage1(opts());
    expect(sql).toMatch(/Tag\s+VARCHAR\(64\)/);
    expect(sql).toMatch(/StemTag\s+VARCHAR\(64\)/);
    expect(sql).toMatch(/Mnemonic\s+VARCHAR\(64\)/);
    expect(sql).toMatch(/SpeciesAuthority\s+VARCHAR\(256\)/);
    expect(sql).toMatch(/TSMCode\s+VARCHAR\(64\) NOT NULL/);
  });

  it('staging_attributes has all required columns including Errors and indexes CoreMeasurementID', () => {
    const sql = renderStage1(opts());
    for (const col of ['TempAttrID', 'CoreMeasurementID', 'TSMCode', 'TSMID', 'DBHID', 'Errors']) {
      expect(sql).toContain(col);
    }
    // TempMeasurementID was dropped — Stage 9 joins on CoreMeasurementID instead.
    expect(sql).not.toMatch(/TempMeasurementID/);
    expect(sql).toMatch(/KEY idxCoreMeasurementID \(CoreMeasurementID\)/);
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

  it('emits INSERT chunks for attribute rows (no positional TempMeasurementID)', () => {
    const attr: AttributeStagingRow = { CoreMeasurementID: 1, TSMCode: 'LI' };
    const sql = renderStage1(opts({ attributeRows: [attr] }));
    expect(sql).toMatch(/INSERT INTO `staging_attributes` \(CoreMeasurementID, TSMCode\) VALUES/);
    expect(sql).toMatch(/\(1,'LI'\)/);
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

  it('Stage 2c applies Suzanne HOM=1.3 default for new stems (StemID IS NULL, DBH > 0, HOM IS NULL)', () => {
    const s = sql();
    expect(s).toMatch(/Stage 2c: destination-contract normalization rules/);
    expect(s).toMatch(/SET HOM = '1\.3'\s+WHERE StemID IS NULL\s+AND DBH IS NOT NULL\s+AND DBH > 0\s+AND HOM IS NULL/);
  });

  it('Stage 2c nulls out HOM when DBH is NULL (belt-and-braces)', () => {
    expect(sql()).toMatch(/UPDATE `staging_measurements` SET HOM = NULL WHERE DBH IS NULL/);
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

  it('check 1: required-field NOT NULL (catches empty strings as well as NULLs)', () => {
    expect(sql()).toMatch(/'Missing required field'/);
    // Empty strings for Tag/Mnemonic/QuadratName fail too — app schema stores
    // these with a `default ''` so the NULL-only test let collisions through.
    expect(sql()).toMatch(
      /Tag IS NULL OR Tag = '' OR StemTag IS NULL OR Mnemonic IS NULL OR Mnemonic = ''\s+OR QuadratName IS NULL OR QuadratName = '' OR ExactDate IS NULL/
    );
  });

  it("check 1b: empty StemTag collisions are caught (app schema stores StemTag with default '')", () => {
    expect(sql()).toMatch(/Empty StemTag collides with another stem under same Tree\+Quadrat/);
    expect(sql()).toMatch(/_stage5_empty_stemtag/);
  });

  it('check 2: taxonomy not uniquely resolved (error includes the conflicting destination IDs)', () => {
    expect(sql()).toMatch(/'Taxonomy not uniquely resolved'/);
    expect(sql()).toMatch(/GROUP_CONCAT\(DISTINCT CONCAT\(SpeciesID/);
    expect(sql()).toMatch(/COUNT\(DISTINCT CONCAT\(SpeciesID, ':', COALESCE\(SubSpeciesID, 0\)\)\) AS taxon_count/);
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
    expect(sql()).toMatch(/CASE\s+WHEN TreeID IS NOT NULL THEN CONCAT\('existing:', TreeID\)\s+ELSE CONCAT\('new:', COALESCE\(Tag, ''\)/);
    expect(sql()).toMatch(/GROUP BY TreeKey, StemTag, QuadratID\s+HAVING COUNT\(\*\) > 1/);
  });

  it('check 9: ambiguous pre-existing Tree (orphan)', () => {
    expect(sql()).toMatch(/'Ambiguous pre-existing Tree \(orphan\)'/);
    expect(sql()).toMatch(/FROM Tree tr\s+LEFT JOIN Stem s ON s\.TreeID = tr\.TreeID[\s\S]+s\.StemID IS NULL/);
  });

  it('check 10: string lengths for measurements + TSMCode width for attributes', () => {
    expect(sql()).toMatch(/CHAR_LENGTH\(Tag\) > 10/);
    expect(sql()).toMatch(/CHAR_LENGTH\(StemTag\) > 32/);
    expect(sql()).toMatch(/CHAR_LENGTH\(Mnemonic\) > 10/);
    expect(sql()).toMatch(/CHAR_LENGTH\(QuadratName\) > 8/);
    expect(sql()).toMatch(/CHAR_LENGTH\(Comments\) > 128/);
    expect(sql()).toMatch(/CHAR_LENGTH\(Family\) > 64/);
    expect(sql()).toMatch(/CHAR_LENGTH\(SpeciesAuthority\) > 128/);
    expect(sql()).toMatch(/CHAR_LENGTH\(SubspeciesName\) > 64/);
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

  it('final SELECT for attributes carries trace columns (no positional TempMeasurementID)', () => {
    expect(sql()).toMatch(/SELECT TempAttrID, CoreMeasurementID, TSMCode, Errors\s+FROM `staging_attributes` WHERE Errors IS NOT NULL ORDER BY TempAttrID/);
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
  const sql = () => renderStage6NewTrees({ measurementsTable: 'staging_measurements' });

  it('emits no cursor primitives', () => {
    for (const kw of ['CURSOR FOR', 'OPEN ', 'FETCH ', 'CLOSE ']) {
      expect(sql()).not.toContain(kw);
    }
  });

  it('inserts DISTINCT (Tag, SpeciesID, SubSpeciesID) ordered by MIN(TempID)', () => {
    expect(sql()).toMatch(
      /INSERT INTO Tree \(Tag, SpeciesID, SubSpeciesID\)\s+SELECT nt\.Tag, nt\.SpeciesID, nt\.SubSpeciesID\s+FROM \(\s*SELECT Tag, SpeciesID, SubSpeciesID, MIN\(TempID\) AS first_temp_id/
    );
    expect(sql()).toMatch(/GROUP BY Tag, SpeciesID, SubSpeciesID\s+\) nt\s+ORDER BY nt\.first_temp_id/);
  });

  it('join-back uses LEFT JOIN Stem to bind to the newly inserted no-stem Tree', () => {
    expect(sql()).toMatch(/JOIN Tree tr ON tr\.Tag = t\.Tag\s+AND tr\.SpeciesID = t\.SpeciesID\s+AND tr\.SubSpeciesID <=> t\.SubSpeciesID/);
    expect(sql()).toMatch(/LEFT JOIN Stem existing_stem ON existing_stem\.TreeID = tr\.TreeID/);
    expect(sql()).toMatch(/SET t\.TreeID = tr\.TreeID\s+WHERE t\.TreeID IS NULL\s+AND existing_stem\.StemID IS NULL/);
  });
});

describe('renderStage7NewStems', () => {
  const sql = () => renderStage7NewStems({ measurementsTable: 'staging_measurements' });

  it('emits no cursor primitives', () => {
    for (const kw of ['CURSOR FOR', 'OPEN ', 'FETCH ', 'CLOSE ']) {
      expect(sql()).not.toContain(kw);
    }
  });

  it('inserts with LEGACY_DEFAULT_STEM_NUMBER = 0 hardcoded in literal', () => {
    expect(sql()).toMatch(/SELECT TreeID, StemTag, QuadratID, 0, LX, LY/);
  });

  it('join-back uses (TreeID, StemTag, QuadratID) with NULL-safe StemTag', () => {
    expect(sql()).toMatch(/JOIN Stem s ON s\.TreeID = t\.TreeID\s+AND s\.StemTag <=> t\.StemTag\s+AND s\.QuadratID = t\.QuadratID/);
  });
});

describe('renderStage8DBH', () => {
  const sql = () => renderStage8DBH({ measurementsTable: 'staging_measurements' });

  it('emits no cursor primitives', () => {
    for (const kw of ['CURSOR FOR', 'OPEN ', 'FETCH ', 'CLOSE ']) {
      expect(sql()).not.toContain(kw);
    }
  });

  it('inserts with LEGACY_DEFAULT_MEASURE_ID = 0 and @target_census_id', () => {
    expect(sql()).toMatch(/SELECT 0, StemID, @target_census_id, DBH, HOM, PrimaryStem, ExactDate, Comments/);
  });

  it('join-back uses (StemID, CensusID = @target_census_id)', () => {
    expect(sql()).toMatch(/JOIN DBH d ON d\.StemID = t\.StemID AND d\.CensusID = @target_census_id\s+SET t\.DBHID = d\.DBHID/);
  });
});

describe('legacy default constants', () => {
  it('exports LEGACY_DEFAULT_STEM_NUMBER = 0', () => {
    expect(LEGACY_DEFAULT_STEM_NUMBER).toBe(0);
  });

  it('exports LEGACY_DEFAULT_MEASURE_ID = 0', () => {
    expect(LEGACY_DEFAULT_MEASURE_ID).toBe(0);
  });
});

describe('renderStage9DBHAttributes', () => {
  const sql = () => renderStage9DBHAttributes({ measurementsTable: 'staging_measurements', attributesTable: 'staging_attributes' });

  it('emits two statements: DBHID join-back via CoreMeasurementID + bulk INSERT', () => {
    // JOIN on CoreMeasurementID instead of positional TempID/TempMeasurementID —
    // see render-procedure docs for rationale.
    expect(sql()).toMatch(
      /UPDATE `staging_attributes` a\s+JOIN `staging_measurements` m ON m\.CoreMeasurementID = a\.CoreMeasurementID\s+SET a\.DBHID = m\.DBHID/
    );
    expect(sql()).toMatch(/INSERT INTO DBHAttributes \(TSMID, DBHID\)\s+SELECT TSMID, DBHID\s+FROM `staging_attributes`/);
  });

  it('filters out staging_attributes rows with NULL DBHID or TSMID', () => {
    expect(sql()).toMatch(/WHERE DBHID IS NOT NULL AND TSMID IS NOT NULL/);
  });

  it('orders inserts by TempAttrID for deterministic output', () => {
    expect(sql()).toMatch(/ORDER BY TempAttrID/);
  });

  it('does NOT emit a capability-probe IF/ELSE branch', () => {
    const s = sql();
    expect(s).not.toMatch(/@dbhattrs_has_census_id/);
    expect(s).not.toMatch(/IF .+ THEN/);
    expect(s).not.toMatch(/END IF/);
  });

  it('does NOT include CensusID in the DBHAttributes INSERT column list', () => {
    expect(sql()).not.toMatch(/INSERT INTO DBHAttributes \([^)]*CensusID[^)]*\)/);
    expect(sql()).not.toMatch(/SELECT @target_census_id, TSMID, DBHID/);
  });

  it('rejects invalid table identifiers', () => {
    expect(() => renderStage9DBHAttributes({ measurementsTable: 'a; DROP TABLE x', attributesTable: 'staging_attributes' })).toThrow(/Invalid SQL identifier/);
    expect(() => renderStage9DBHAttributes({ measurementsTable: 'staging_measurements', attributesTable: 'b; DROP TABLE y' })).toThrow(
      /Invalid SQL identifier/
    );
  });
});

describe('renderStage10', () => {
  const sql = () => renderStage10({ measurementsTable: 'staging_measurements', attributesTable: 'staging_attributes' });

  it('emits two SELECT statements: one measurement tally and one attribute count', () => {
    const s = sql();
    // Single-scan measurement tally (avoids ER_CANT_REOPEN_TABLE with TEMPORARY tables)
    expect(s).toMatch(/SELECT COUNT\(\*\) AS measurement_rows.*COUNT\(DISTINCT TreeID\) AS tree_count.*COUNT\(DISTINCT StemID\) AS stem_count/s);
    // Separate attribute count
    expect(s).toMatch(/SELECT COUNT\(\*\) AS attribute_rows\s+FROM `staging_attributes`/);
    // Must not use scalar subqueries that re-open the same temp table
    expect(s).not.toMatch(/\(SELECT COUNT\([^)]+\) FROM `staging_measurements`\) AS measurement_rows/);
  });

  it('does NOT emit any DELETE, INSERT, or UPDATE — read-only tally', () => {
    const s = sql();
    expect(s).not.toMatch(/\b(DELETE|INSERT|UPDATE)\b/i);
  });

  it('does NOT reference the old tempTable shape', () => {
    expect(sql()).not.toMatch(/TempAllTrees/);
  });

  it('rejects invalid table identifiers', () => {
    expect(() => renderStage10({ measurementsTable: 'a; DROP TABLE x', attributesTable: 'staging_attributes' })).toThrow(/Invalid SQL identifier/);
  });
});

describe('renderPostLoadViewFullTableCall', () => {
  it("emits CALL ctfsweb_webuser.CreateFullView(DATABASE(), 'ViewFullTable'); after the load procedure", () => {
    const sql = renderPostLoadViewFullTableCall();
    expect(sql).toMatch(/CALL ctfsweb_webuser\.CreateFullView\(DATABASE\(\), 'ViewFullTable'\);/);
    expect(sql).toMatch(/runs outside the load transaction/);
  });

  it('does not wrap the CALL in DELIMITER //, so it runs as a top-level statement', () => {
    const sql = renderPostLoadViewFullTableCall();
    expect(sql).not.toMatch(/DELIMITER/);
    expect(sql).not.toMatch(/CREATE PROCEDURE/);
  });
});
