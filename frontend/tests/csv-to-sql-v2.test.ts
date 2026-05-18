import { describe, it, expect } from 'vitest';
import { parseCliArgsV2, renderProcedureEnvelope, renderStage0, renderStage1, renderStage2, renderStage2bResprout } from '../lib/csv-to-sql-v2';
import { mapCsvRowToStagingRow } from '../lib/csv-to-sql-shared';

describe('parseCliArgsV2', () => {
  const baseArgs = ['--input', '/in.csv', '--site', 'SERC', '--plot-id', '1', '--census-number', '2'];

  it('parses required args', () => {
    expect(parseCliArgsV2(baseArgs)).toMatchObject({
      input: '/in.csv',
      site: 'SERC',
      plotId: 1,
      censusNumber: '2',
      allowReload: false,
      tempTable: 'TempAllTrees'
    });
  });

  it('defaults output to <input>.v2.sql', () => {
    expect(parseCliArgsV2(baseArgs).output).toBe('/in.csv.v2.sql');
  });

  it('parses --allow-reload as boolean', () => {
    expect(parseCliArgsV2([...baseArgs, '--allow-reload']).allowReload).toBe(true);
  });

  it('rejects missing required arg', () => {
    expect(() => parseCliArgsV2(['--input', '/in.csv'])).toThrow();
  });

  it('honors explicit --output', () => {
    expect(parseCliArgsV2([...baseArgs, '--output', '/tmp/x.sql']).output).toBe('/tmp/x.sql');
  });

  it('rejects unknown flag', () => {
    expect(() => parseCliArgsV2([...baseArgs, '--garbage'])).toThrow();
  });
});

describe('renderProcedureEnvelope', () => {
  it('emits drop/delimiter/create/declares/handler/tx/body/commit/end/call/drop', () => {
    const sql = renderProcedureEnvelope({ cursorDeclarations: [], body: '  -- BODY --' });
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
    expect(sql).toMatch(/DECLARE EXIT HANDLER FOR SQLEXCEPTION\s+BEGIN\s+ROLLBACK;\s+RESIGNAL;\s+END;/);
    expect(sql).toMatch(/START TRANSACTION;/);
    expect(sql).toMatch(/-- BODY --/);
    expect(sql).toMatch(/COMMIT;\s+END \/\//);
    expect(sql).toMatch(/DELIMITER ;/);
    expect(sql).toMatch(/CALL csv_to_sql_v2_load\(\);\s*DROP PROCEDURE csv_to_sql_v2_load;/);
  });

  it('declaration order is variables -> cursors -> handlers', () => {
    const sql = renderProcedureEnvelope({
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
    const sql = renderStage0({ plotId: 1, censusNumber: '2', allowReload: false });
    expect(sql).toMatch(/SELECT COUNT\(\*\), MIN\(CensusID\), MIN\(StartDate\)\s+INTO _census_count, _target_census_id, _target_start_date/);
    expect(sql).toMatch(/PlotID = 1\s+AND PlotCensusNumber = '2'/);
    expect(sql).toMatch(/IF _census_count <> 1 THEN/);
    expect(sql).toMatch(/SIGNAL SQLSTATE '45000'/);
  });

  it('sets @target_census_id and @target_plot_id session variables', () => {
    const sql = renderStage0({ plotId: 42, censusNumber: '3', allowReload: false });
    expect(sql).toMatch(/SET @target_census_id := _target_census_id;/);
    expect(sql).toMatch(/SET @target_plot_id := 42;/);
  });

  it('escapes census number to prevent injection', () => {
    const sql = renderStage0({ plotId: 1, censusNumber: "2'; DROP TABLE Tree; --", allowReload: false });
    expect(sql).toContain("PlotCensusNumber = '2\\'; DROP TABLE Tree; --'");
    expect(sql).not.toContain("PlotCensusNumber = '2'; DROP TABLE Tree; --'");
  });

  it('without --allow-reload, refuses populated census', () => {
    const sql = renderStage0({ plotId: 1, censusNumber: '2', allowReload: false });
    expect(sql).toMatch(/SELECT COUNT\(\*\) INTO _existing_dbh_count\s+FROM DBH\s+WHERE CensusID = @target_census_id/);
    expect(sql).toMatch(/IF _existing_dbh_count > 0 THEN/);
    expect(sql).toMatch(/Pass --allow-reload to overwrite/);
  });

  it('without --allow-reload, does not emit reload temp tables', () => {
    const sql = renderStage0({ plotId: 1, censusNumber: '2', allowReload: false });
    expect(sql).not.toMatch(/reload_stems_to_check/);
    expect(sql).not.toMatch(/reload_trees_to_check/);
  });

  it('with --allow-reload, emits scoped cleanup', () => {
    const sql = renderStage0({ plotId: 1, censusNumber: '2', allowReload: true });
    expect(sql).toMatch(/CREATE TEMPORARY TABLE reload_stems_to_check/);
    expect(sql).toMatch(/CREATE TEMPORARY TABLE reload_trees_to_check/);
    expect(sql).toMatch(/DELETE da\s+FROM DBHAttributes da/);
    expect(sql).toMatch(/DELETE FROM DBH WHERE CensusID = @target_census_id;/);
    expect(sql).toMatch(/DELETE s\s+FROM Stem s\s+JOIN reload_stems_to_check/);
    expect(sql).toMatch(/DELETE tr\s+FROM Tree tr\s+JOIN reload_trees_to_check/);
    expect(sql).not.toMatch(/Pass --allow-reload to overwrite/);
  });

  it('with --allow-reload, DELETEs in FK order (DBHAttributes before DBH, Stem before Tree)', () => {
    const sql = renderStage0({ plotId: 1, censusNumber: '2', allowReload: true });
    const dbhAttrIdx = sql.indexOf('DELETE da');
    const dbhIdx = sql.indexOf('DELETE FROM DBH');
    const stemIdx = sql.indexOf('DELETE s\n');
    const treeIdx = sql.indexOf('DELETE tr\n');
    expect(dbhAttrIdx).toBeGreaterThan(0);
    expect(dbhIdx).toBeGreaterThan(dbhAttrIdx);
    expect(stemIdx).toBeGreaterThan(dbhIdx);
    expect(treeIdx).toBeGreaterThan(stemIdx);
  });

  it('output is a procedure-body fragment indented two spaces (no procedure envelope)', () => {
    const sql = renderStage0({ plotId: 1, censusNumber: '2', allowReload: false });
    expect(sql).not.toMatch(/DROP PROCEDURE/);
    expect(sql).not.toMatch(/DELIMITER/);
    expect(sql).not.toMatch(/CREATE PROCEDURE/);
    expect(sql).not.toMatch(/START TRANSACTION/);
    expect(sql).not.toMatch(/COMMIT/);
    // Body fragments are indented two spaces
    expect(sql).toMatch(/^  -- Stage 0:/m);
  });
});

describe('renderStage1', () => {
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

  it('renders CREATE TEMPORARY TABLE and ENGINE=InnoDB; no occurrence of MyISAM', () => {
    const sql = renderStage1({ tempTable: 'TempAllTrees', stagingRows: [sampleRow] });
    expect(sql).toMatch(/CREATE TEMPORARY TABLE `TempAllTrees`/);
    expect(sql).toMatch(/ENGINE=InnoDB/);
    expect(sql).not.toMatch(/MyISAM/);
  });

  it('renders DROP TEMPORARY TABLE IF EXISTS (not plain DROP TABLE)', () => {
    const sql = renderStage1({ tempTable: 'TempAllTrees', stagingRows: [sampleRow] });
    expect(sql).toMatch(/DROP TEMPORARY TABLE IF EXISTS `TempAllTrees`;/);
    // Plain DROP TABLE without TEMPORARY keyword must not appear
    expect(sql).not.toMatch(/DROP TABLE(?! IF EXISTS|.*TEMPORARY)/);
    expect(sql).not.toMatch(/DROP TABLE `TempAllTrees`/);
  });

  it('renders INSERT INTO ... VALUES chunks given staging rows', () => {
    const secondRow = mapCsvRowToStagingRow({ ...SAMPLE_CSV_ROW, tag: 'T002', stemtag: 'S002' }, 7, '4');
    const sql = renderStage1({ tempTable: 'TempAllTrees', stagingRows: [sampleRow, secondRow] });
    expect(sql).toMatch(/INSERT INTO `TempAllTrees` \(QuadratName, Tag, StemTag/);
    expect(sql).toMatch(/VALUES/);
    // Both tags should appear as escaped SQL strings
    expect(sql).toContain("'T001'");
    expect(sql).toContain("'T002'");
  });

  it('with zero staging rows, still renders the DDL and does not crash', () => {
    const sql = renderStage1({ tempTable: 'TempAllTrees', stagingRows: [] });
    expect(sql).toMatch(/CREATE TEMPORARY TABLE `TempAllTrees`/);
    expect(sql).toMatch(/ENGINE=InnoDB/);
    // No INSERT statements should appear
    expect(sql).not.toMatch(/INSERT INTO/);
  });
});

describe('renderStage2', () => {
  const defaultSql = () => renderStage2({ tempTable: 'TempAllTrees' });

  it('first statement sets CensusID from session variable', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/UPDATE `TempAllTrees` SET CensusID = @target_census_id;/);
    // Must be the first UPDATE (CensusID update precedes any JOIN updates)
    const censusUpdateIdx = sql.indexOf('UPDATE `TempAllTrees` SET CensusID');
    const quadratUpdateIdx = sql.indexOf('UPDATE `TempAllTrees` t');
    expect(censusUpdateIdx).toBeGreaterThan(0);
    expect(censusUpdateIdx).toBeLessThan(quadratUpdateIdx);
  });

  it('QuadratID update joins Quadrat on QuadratName and PlotID = @target_plot_id', () => {
    const sql = defaultSql();
    expect(sql).toMatch(
      /UPDATE `TempAllTrees` t\s+JOIN Quadrat q ON q\.QuadratName = t\.QuadratName AND q\.PlotID = @target_plot_id\s+SET t\.QuadratID = q\.QuadratID;/
    );
  });

  it('SpeciesID update joins Species filtering by CurrentTaxonFlag = 1', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/JOIN Species s ON s\.Mnemonic = t\.Mnemonic AND s\.CurrentTaxonFlag = 1/);
    expect(sql).toMatch(/SET t\.SpeciesID = s\.SpeciesID;/);
  });

  it('tree_lookup is a TEMPORARY TABLE with MIN(TreeID) and COUNT(DISTINCT TreeID) as TreeCount', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/CREATE TEMPORARY TABLE tree_lookup AS/);
    expect(sql).toMatch(/MIN\(tr\.TreeID\) AS TreeID/);
    expect(sql).toMatch(/COUNT\(DISTINCT tr\.TreeID\) AS TreeCount/);
    expect(sql).toMatch(/GROUP BY tr\.Tag/);
  });

  it('tree_lookup scopes via Stem -> Quadrat -> @target_plot_id (no Tree.PlotID)', () => {
    const sql = defaultSql();
    // Must have the full join chain: Tree JOIN Stem JOIN Quadrat WHERE q.PlotID
    expect(sql).toMatch(
      /FROM Tree tr\s+JOIN Stem s ON s\.TreeID = tr\.TreeID\s+JOIN Quadrat q ON q\.QuadratID = s\.QuadratID\s+WHERE q\.PlotID = @target_plot_id/
    );
  });

  it('TreeID write-back joins tree_lookup with TreeCount = 1', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/JOIN tree_lookup tl ON tl\.Tag = t\.Tag AND tl\.TreeCount = 1\s+SET t\.TreeID = tl\.TreeID;/);
  });

  it('stem_lookup is a TEMPORARY TABLE with MIN(StemID) and COUNT(*) as StemCount', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/CREATE TEMPORARY TABLE stem_lookup AS/);
    expect(sql).toMatch(/MIN\(s\.StemID\) AS StemID/);
    expect(sql).toMatch(/COUNT\(\*\) AS StemCount/);
    expect(sql).toMatch(/GROUP BY s\.TreeID, s\.StemTag/);
  });

  it('stem_lookup scopes via Quadrat -> @target_plot_id', () => {
    const sql = defaultSql();
    // stem_lookup block: Stem JOIN Quadrat WHERE q.PlotID
    const stemLookupIdx = sql.indexOf('CREATE TEMPORARY TABLE stem_lookup');
    expect(stemLookupIdx).toBeGreaterThan(0);
    const stemLookupFragment = sql.slice(stemLookupIdx);
    expect(stemLookupFragment).toMatch(/FROM Stem s\s+JOIN Quadrat q ON q\.QuadratID = s\.QuadratID\s+WHERE q\.PlotID = @target_plot_id/);
  });

  it('StemID write-back uses NULL-safe <=> on StemTag and requires StemCount = 1', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/sl\.StemTag <=> t\.StemTag/);
    expect(sql).toMatch(/sl\.StemCount = 1/);
    expect(sql).toMatch(/SET t\.StemID = sl\.StemID;/);
  });

  it('never references Tree.PlotID or tr.PlotID', () => {
    const sql = defaultSql();
    expect(sql).not.toMatch(/Tree\.PlotID/);
    expect(sql).not.toMatch(/tr\.PlotID/);
  });

  it('is a procedure-body fragment (no procedure envelope, no DELIMITER, no TRANSACTION)', () => {
    const sql = defaultSql();
    expect(sql).not.toMatch(/DROP PROCEDURE/);
    expect(sql).not.toMatch(/DELIMITER/);
    expect(sql).not.toMatch(/CREATE PROCEDURE/);
    expect(sql).not.toMatch(/START TRANSACTION/);
    expect(sql).not.toMatch(/COMMIT/);
    expect(sql).toMatch(/^  -- Stage 2:/m);
  });

  it('uses backtick-quoted identifier for custom tempTable name', () => {
    const sql = renderStage2({ tempTable: 'MyCustomStaging' });
    expect(sql).toMatch(/`MyCustomStaging`/);
    expect(sql).not.toMatch(/TempAllTrees/);
  });

  it('rejects an invalid tempTable identifier (injection guard)', () => {
    expect(() => renderStage2({ tempTable: 'bad name; DROP TABLE' })).toThrow(/Invalid SQL identifier/);
  });
});

describe('renderStage2bResprout', () => {
  const defaultSql = () => renderStage2bResprout({ tempTable: 'TempAllTrees' });

  it('builds resprout_codes from TSMAttributes Description LIKE %stem lost%', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/CREATE TEMPORARY TABLE resprout_codes AS\s+SELECT TSMID FROM TSMAttributes WHERE LOWER\(Description\) LIKE '%stem lost%'/);
  });

  it('builds dead_codes from TSMAttributes Description LIKE %dead%', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/CREATE TEMPORARY TABLE dead_codes AS\s+SELECT TSMID FROM TSMAttributes WHERE LOWER\(Description\) LIKE '%dead%'/);
  });

  it('builds resprout_codes_str (TSMCode form) for staging-Codes string matching', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/CREATE TEMPORARY TABLE resprout_codes_str AS\s+SELECT TSMCode FROM TSMAttributes WHERE LOWER\(Description\) LIKE '%stem lost%'/);
  });

  it('derives current_row_excluded from staging Codes via FIND_IN_SET', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/CREATE TEMPORARY TABLE current_row_excluded AS/);
    expect(sql).toMatch(/FIND_IN_SET\(rc\.TSMCode, REPLACE\(t\.Codes, ';', ','\)\) > 0/);
    expect(sql).toMatch(/WHERE t\.TreeID IS NOT NULL AND t\.StemID IS NULL/);
  });

  it('resprout_candidates joins prior Census strictly before target (by date OR numeric PlotCensusNumber)', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/CREATE TEMPORARY TABLE resprout_candidates AS/);
    expect(sql).toMatch(/prior_c\.PlotID = @target_plot_id/);
    expect(sql).toMatch(/prior_c\.CensusID <> @target_census_id/);
    expect(sql).toMatch(/prior_c\.StartDate < @target_start_date/);
    expect(sql).toMatch(/PlotCensusNumber REGEXP/);
  });

  it('resprout_candidates restricts via Stem.TreeID = staging TreeID and prior DBH.CensusID', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/JOIN DBH prior_dbh\s+ON prior_dbh\.CensusID = prior_c\.CensusID/);
    expect(sql).toMatch(/JOIN Stem s ON s\.StemID = prior_dbh\.StemID AND s\.TreeID = t\.TreeID/);
  });

  it('resprout_candidates requires prior census to have exactly one measured stem on the tree', () => {
    const sql = defaultSql();
    expect(sql).toMatch(
      /SELECT COUNT\(DISTINCT d2\.StemID\)\s+FROM DBH d2\s+JOIN Stem s2 ON s2\.StemID = d2\.StemID\s+WHERE d2\.CensusID = prior_c\.CensusID\s+AND s2\.TreeID = t\.TreeID\s+\) = 1/
    );
  });

  it('resprout_candidates restricts to staging rows where TreeID NOT NULL AND StemID IS NULL and not excluded', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/WHERE t\.TreeID IS NOT NULL\s+AND t\.StemID IS NULL\s+AND x\.TempID IS NULL/);
  });

  it('resprout_candidates flags HasDeadCode via DBHAttributes JOIN dead_codes', () => {
    const sql = defaultSql();
    expect(sql).toMatch(
      /CASE WHEN EXISTS \(\s+SELECT 1\s+FROM DBHAttributes da\s+JOIN dead_codes dc ON dc\.TSMID = da\.TSMID\s+WHERE da\.DBHID = prior_dbh\.DBHID\s+\) THEN 1 ELSE 0 END\) AS HasDeadCode/
    );
  });

  it('resprout_candidates flags HasResproutCode via DBHAttributes JOIN resprout_codes', () => {
    const sql = defaultSql();
    expect(sql).toMatch(
      /CASE WHEN EXISTS \(\s+SELECT 1\s+FROM DBHAttributes da\s+JOIN resprout_codes rc ON rc\.TSMID = da\.TSMID\s+WHERE da\.DBHID = prior_dbh\.DBHID\s+\) THEN 1 ELSE 0 END\) AS HasResproutCode/
    );
  });

  it('final UPDATE fires only when HasDeadCode = 0 AND (PriorDBH >= 10 OR HasResproutCode = 1)', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/WHERE HasDeadCode = 0\s+AND \(PriorDBH >= 10 OR HasResproutCode = 1\)/);
  });

  it('final UPDATE picks the most recent eligible prior via ROW_NUMBER() ORDER BY PriorCensusID DESC', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/ROW_NUMBER\(\) OVER \(PARTITION BY TempID ORDER BY PriorCensusID DESC\) AS rk/);
    expect(sql).toMatch(/chosen\.rk = 1/);
    expect(sql).toMatch(/SET t\.StemID = chosen\.PriorStemID;/);
  });

  it('does not SIGNAL — Stage 2b never errors broadly for M rows', () => {
    const sql = defaultSql();
    expect(sql).not.toMatch(/SIGNAL/);
  });

  it('never references Tree.PlotID or tr.PlotID', () => {
    const sql = defaultSql();
    expect(sql).not.toMatch(/Tree\.PlotID/);
    expect(sql).not.toMatch(/tr\.PlotID/);
  });

  it('is a procedure-body fragment (no procedure envelope, no DELIMITER, no TRANSACTION)', () => {
    const sql = defaultSql();
    expect(sql).not.toMatch(/DROP PROCEDURE/);
    expect(sql).not.toMatch(/DELIMITER/);
    expect(sql).not.toMatch(/CREATE PROCEDURE/);
    expect(sql).not.toMatch(/START TRANSACTION/);
    expect(sql).not.toMatch(/COMMIT/);
    expect(sql).toMatch(/^  -- Stage 2b:/m);
  });

  it('uses backtick-quoted identifier for custom tempTable name', () => {
    const sql = renderStage2bResprout({ tempTable: 'MyCustomStaging' });
    expect(sql).toMatch(/`MyCustomStaging`/);
    expect(sql).not.toMatch(/TempAllTrees/);
  });

  it('rejects an invalid tempTable identifier (injection guard)', () => {
    expect(() => renderStage2bResprout({ tempTable: 'bad name; DROP TABLE' })).toThrow(/Invalid SQL identifier/);
  });
});
