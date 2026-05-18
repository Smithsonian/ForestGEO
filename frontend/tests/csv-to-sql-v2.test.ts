import { describe, it, expect } from 'vitest';
import {
  parseCliArgsV2,
  renderProcedureEnvelope,
  renderStage0,
  renderStage1,
  renderStage2,
  renderStage2bResprout,
  renderStage3,
  renderStage4,
  renderStage5,
  renderStage6NewTrees,
  renderStage7NewStems,
  renderStage8DBH,
  renderStage9PrimaryAndAttrs,
  renderStage10
} from '../lib/csv-to-sql-v2';
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

describe('renderStage3', () => {
  it('classifies via case expression', () => {
    const sql = renderStage3({ tempTable: 'TempAllTrees' });
    expect(sql).toMatch(/UPDATE `TempAllTrees` SET Tagged =\s+CASE\s+WHEN TreeID IS NULL THEN 'N'\s+WHEN StemID IS NULL THEN 'M'\s+ELSE 'O'\s+END;/);
  });
});

describe('renderStage4', () => {
  const defaultSql = () => renderStage4({ tempTable: 'TempAllTrees' });

  it('zeroes DBH = NULL WHERE DBH = 0 as the first statement', () => {
    const sql = defaultSql();
    const nullifyIdx = sql.indexOf('UPDATE `TempAllTrees` SET DBH = NULL WHERE DBH = 0;');
    expect(nullifyIdx).toBeGreaterThan(0);
    // Must appear before the prior_census_order CREATE
    const createTableIdx = sql.indexOf('CREATE TEMPORARY TABLE prior_census_order');
    expect(nullifyIdx).toBeLessThan(createTableIdx);
  });

  it('creates prior_census_order as a TEMPORARY TABLE', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/DROP TEMPORARY TABLE IF EXISTS prior_census_order;/);
    expect(sql).toMatch(/CREATE TEMPORARY TABLE prior_census_order AS/);
  });

  it('WHERE clause filters by PlotID = @target_plot_id AND CensusID <> @target_census_id', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/WHERE PlotID = @target_plot_id\s+AND CensusID <> @target_census_id/);
  });

  it('StartDate branch uses StartDate < @target_start_date (excludes same-or-later dates)', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/StartDate IS NOT NULL AND @target_start_date IS NOT NULL AND StartDate < @target_start_date/);
  });

  it('numeric fallback uses CAST ... < CAST ... to exclude candidate census numbers >= target', () => {
    const sql = defaultSql();
    // The WHERE clause must cast both sides and require strictly less-than
    expect(sql).toMatch(
      /CAST\(PlotCensusNumber AS DECIMAL\(20,5\)\)\s+< CAST\(\(SELECT PlotCensusNumber FROM Census WHERE CensusID = @target_census_id\) AS DECIMAL\(20,5\)\)/
    );
  });

  it('numeric fallback only fires when StartDate comparison is unavailable (date is NULL on either side)', () => {
    const sql = defaultSql();
    // The OR branch for numeric fallback must be guarded by a NULL check on date
    expect(sql).toMatch(/\(@target_start_date IS NULL OR StartDate IS NULL\)/);
  });

  it('ORDER BY ranks by StartDate DESC first, then numeric PlotCensusNumber DESC', () => {
    const sql = defaultSql();
    const orderByIdx = sql.indexOf('ORDER BY');
    expect(orderByIdx).toBeGreaterThan(0);
    const orderByFragment = sql.slice(orderByIdx, orderByIdx + 400);
    // StartDate CASE must appear before PlotCensusNumber CASE in ORDER BY
    const startDateCaseIdx = orderByFragment.indexOf('CASE WHEN StartDate IS NOT NULL AND @target_start_date IS NOT NULL');
    const pcnCaseIdx = orderByFragment.indexOf('CASE WHEN PlotCensusNumber REGEXP');
    expect(startDateCaseIdx).toBeGreaterThan(0);
    expect(pcnCaseIdx).toBeGreaterThan(startDateCaseIdx);
  });

  it('HOM inheritance UPDATE only applies to Tagged = O rows with HOM IS NULL and DBH IS NOT NULL', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/WHERE t\.HOM IS NULL AND t\.DBH IS NOT NULL AND t\.Tagged = 'O'/);
  });

  it('HOM inheritance joins DBH through prior_census_order on rk = 1', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/JOIN prior_census_order p ON p\.CensusID = d\.CensusID AND p\.rk = 1/);
  });

  it('final fallback sets HOM = 1.3 WHERE HOM IS NULL AND DBH IS NOT NULL (no Tagged filter)', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/UPDATE `TempAllTrees` SET HOM = 1\.3\s+WHERE HOM IS NULL AND DBH IS NOT NULL;/);
    // The final fallback must NOT restrict to Tagged = 'O'
    const finalUpdateIdx = sql.lastIndexOf('UPDATE `TempAllTrees` SET HOM = 1.3');
    expect(finalUpdateIdx).toBeGreaterThan(0);
    const finalFragment = sql.slice(finalUpdateIdx, finalUpdateIdx + 80);
    expect(finalFragment).not.toMatch(/Tagged/);
  });

  it('final fallback UPDATE comes after the HOM inheritance UPDATE', () => {
    const sql = defaultSql();
    const inheritanceIdx = sql.indexOf('SET t.HOM = prev.HOM');
    const fallbackIdx = sql.indexOf('SET HOM = 1.3');
    expect(inheritanceIdx).toBeGreaterThan(0);
    expect(fallbackIdx).toBeGreaterThan(inheritanceIdx);
  });

  it('is a procedure-body fragment (no procedure envelope, no DELIMITER, no TRANSACTION)', () => {
    const sql = defaultSql();
    expect(sql).not.toMatch(/DROP PROCEDURE/);
    expect(sql).not.toMatch(/DELIMITER/);
    expect(sql).not.toMatch(/CREATE PROCEDURE/);
    expect(sql).not.toMatch(/START TRANSACTION/);
    expect(sql).not.toMatch(/COMMIT/);
    expect(sql).toMatch(/^  -- Stage 4:/m);
  });

  it('uses backtick-quoted identifier for custom tempTable name', () => {
    const sql = renderStage4({ tempTable: 'MyCustomStaging' });
    expect(sql).toMatch(/`MyCustomStaging`/);
    expect(sql).not.toMatch(/TempAllTrees/);
  });

  it('rejects an invalid tempTable identifier (injection guard)', () => {
    expect(() => renderStage4({ tempTable: 'bad name; DROP TABLE' })).toThrow(/Invalid SQL identifier/);
  });
});

describe('renderStage5', () => {
  const defaultSql = () => renderStage5({ tempTable: 'TempAllTrees' });

  it('check 1: missing required staged values flags TempIDs where any required column IS NULL', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/SELECT GROUP_CONCAT\(DISTINCT TempID\) INTO _bad/);
    expect(sql).toMatch(/WHERE Tag IS NULL OR StemTag IS NULL OR Mnemonic IS NULL OR QuadratName IS NULL OR ExactDate IS NULL/);
    expect(sql).toMatch(/Missing required values in TempIDs: /);
  });

  it('check 2: NULL QuadratID reports DISTINCT QuadratName', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/SELECT GROUP_CONCAT\(DISTINCT QuadratName\) INTO _bad\s+FROM `TempAllTrees`\s+WHERE QuadratID IS NULL/);
    expect(sql).toMatch(/Unknown quadrats: /);
  });

  it('check 3: NULL SpeciesID reports DISTINCT Mnemonic', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/SELECT GROUP_CONCAT\(DISTINCT Mnemonic\) INTO _bad\s+FROM `TempAllTrees`\s+WHERE SpeciesID IS NULL/);
    expect(sql).toMatch(/Unknown species mnemonics: /);
  });

  it('check 4: ambiguous tree lookup joins tree_lookup TreeCount > 1', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/JOIN tree_lookup tl ON tl\.Tag = t\.Tag\s+WHERE tl\.TreeCount > 1/);
    expect(sql).toMatch(/SELECT GROUP_CONCAT\(DISTINCT t\.Tag\) INTO _bad/);
    expect(sql).toMatch(/Ambiguous tree tags: /);
  });

  it('check 5: ambiguous stem lookup joins stem_lookup StemCount > 1 with NULL-safe StemTag', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/JOIN stem_lookup sl ON sl\.TreeID = t\.TreeID AND sl\.StemTag <=> t\.StemTag\s+WHERE sl\.StemCount > 1/);
    expect(sql).toMatch(/GROUP_CONCAT\(DISTINCT CONCAT\(t\.Tag, '\/', COALESCE\(t\.StemTag, 'NULL'\)\)\)/);
    expect(sql).toMatch(/Ambiguous stem lookup: /);
  });

  it('check 6: HOM inheritance check fires when O rows exist but prior_census_order is empty', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM `TempAllTrees` WHERE Tagged = 'O'\)/);
    expect(sql).toMatch(/\(SELECT COUNT\(\*\) FROM prior_census_order\) = 0/);
    expect(sql).toMatch(/HOM inheritance requires prior census ordering but no orderable prior census exists for plot/);
  });

  it('check 7: unknown TSMCode tokens uses a recursive CTE that splits Codes on ";"', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/WITH RECURSIVE numbers AS/);
    expect(sql).toMatch(/SUBSTRING_INDEX\(SUBSTRING_INDEX\(t\.Codes, ';', n\.n\), ';', -1\)/);
    expect(sql).toMatch(/LEFT JOIN TSMAttributes tsm ON tsm\.TSMCode = e\.token/);
    expect(sql).toMatch(/WHERE tsm\.TSMID IS NULL AND e\.token NOT IN \('', '\*'\)/);
    expect(sql).toMatch(/Unknown TSMCodes: /);
  });

  it('check 7: code-splitting CTE excludes empty and "*" tokens', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/e\.token NOT IN \('', '\*'\)/);
  });

  it('check 8: duplicate (StemID, CensusID) destinations groups and HAVING COUNT(*) > 1', () => {
    const sql = defaultSql();
    expect(sql).toMatch(/GROUP BY StemID, CensusID/);
    expect(sql).toMatch(/HAVING COUNT\(\*\) > 1/);
    expect(sql).toMatch(/Duplicate \(StemID, CensusID\) DBH destinations: /);
  });

  it('all 8 SIGNALs use SQLSTATE 45000', () => {
    const sql = defaultSql();
    const matches = sql.match(/SIGNAL SQLSTATE '45000'/g) ?? [];
    expect(matches.length).toBe(8);
  });

  it('all 8 checks render in documented order', () => {
    const sql = defaultSql();
    const idx1 = sql.indexOf('Missing required values in TempIDs');
    const idx2 = sql.indexOf('Unknown quadrats');
    const idx3 = sql.indexOf('Unknown species mnemonics');
    const idx4 = sql.indexOf('Ambiguous tree tags');
    const idx5 = sql.indexOf('Ambiguous stem lookup');
    const idx6 = sql.indexOf('HOM inheritance requires prior census ordering');
    const idx7 = sql.indexOf('Unknown TSMCodes');
    const idx8 = sql.indexOf('Duplicate (StemID, CensusID) DBH destinations');
    expect(idx1).toBeGreaterThan(0);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
    expect(idx4).toBeGreaterThan(idx3);
    expect(idx5).toBeGreaterThan(idx4);
    expect(idx6).toBeGreaterThan(idx5);
    expect(idx7).toBeGreaterThan(idx6);
    expect(idx8).toBeGreaterThan(idx7);
  });

  it('resets _bad to NULL before each check', () => {
    const sql = defaultSql();
    const resets = sql.match(/SET _bad = NULL;/g) ?? [];
    expect(resets.length).toBe(8);
  });

  it('is a procedure-body fragment (no procedure envelope, no DELIMITER, no TRANSACTION)', () => {
    const sql = defaultSql();
    expect(sql).not.toMatch(/DROP PROCEDURE/);
    expect(sql).not.toMatch(/DELIMITER/);
    expect(sql).not.toMatch(/CREATE PROCEDURE/);
    expect(sql).not.toMatch(/START TRANSACTION/);
    expect(sql).not.toMatch(/COMMIT/);
    expect(sql).toMatch(/^  -- Stage 5:/m);
  });

  it('uses backtick-quoted identifier for custom tempTable name', () => {
    const sql = renderStage5({ tempTable: 'MyCustomStaging' });
    expect(sql).toMatch(/`MyCustomStaging`/);
    expect(sql).not.toMatch(/TempAllTrees/);
  });

  it('rejects an invalid tempTable identifier (injection guard)', () => {
    expect(() => renderStage5({ tempTable: 'bad name; DROP TABLE' })).toThrow(/Invalid SQL identifier/);
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

describe('renderStage9PrimaryAndAttrs', () => {
  const defaultResult = () => renderStage9PrimaryAndAttrs({ tempTable: 'TempAllTrees' });

  // --- 9a (bodyPre) ---

  it('bodyPre builds primary_marker_map via DROP/CREATE and a recursive CTE', () => {
    const { bodyPre } = defaultResult();
    expect(bodyPre).toMatch(/DROP TEMPORARY TABLE IF EXISTS primary_marker_map;/);
    expect(bodyPre).toMatch(/CREATE TEMPORARY TABLE primary_marker_map AS/);
    expect(bodyPre).toMatch(/WITH RECURSIVE numbers AS/);
  });

  it('bodyPre CTE explodes Codes on ";" using SUBSTRING_INDEX double-pass', () => {
    const { bodyPre } = defaultResult();
    expect(bodyPre).toMatch(/TRIM\(SUBSTRING_INDEX\(SUBSTRING_INDEX\(t\.Codes, ';', n\.n\), ';', -1\)\) AS token/);
  });

  it('bodyPre joins TSMAttributes and filters to main/secondary markers only', () => {
    const { bodyPre } = defaultResult();
    expect(bodyPre).toMatch(/JOIN TSMAttributes tsm ON tsm\.TSMCode = e\.token/);
    expect(bodyPre).toMatch(/WHERE LOWER\(tsm\.Description\) IN \('main', 'secondary'\)/);
    expect(bodyPre).toMatch(/LOWER\(tsm\.Description\) AS marker/);
  });

  it('bodyPre SIGNALs when a row carries both main and secondary markers', () => {
    const { bodyPre } = defaultResult();
    expect(bodyPre).toMatch(/SIGNAL SQLSTATE '45000'/);
    expect(bodyPre).toMatch(/Both main and secondary markers present on TempIDs: /);
  });

  it('bodyPre both-marker check wraps GROUP BY in a subquery so SELECT INTO gets a scalar', () => {
    const { bodyPre } = defaultResult();
    // The outer SELECT...INTO must be wrapped around a subquery that does the HAVING
    expect(bodyPre).toMatch(
      /SELECT GROUP_CONCAT\(DISTINCT t\.TempID\) INTO _bad FROM \(\s+SELECT TempID\s+FROM primary_marker_map\s+GROUP BY TempID\s+HAVING COUNT\(DISTINCT marker\) > 1\s+\) t;/
    );
  });

  it('bodyPre resets _bad to NULL before the both-marker check', () => {
    const { bodyPre } = defaultResult();
    const resetIdx = bodyPre.indexOf('SET _bad = NULL;');
    const signalIdx = bodyPre.indexOf('SIGNAL SQLSTATE');
    expect(resetIdx).toBeGreaterThan(0);
    expect(resetIdx).toBeLessThan(signalIdx);
  });

  it('bodyPre UPDATE sets staging PrimaryStem to m.marker (the literal string from TSMAttributes)', () => {
    const { bodyPre } = defaultResult();
    expect(bodyPre).toMatch(/UPDATE `TempAllTrees` t\s+JOIN primary_marker_map m ON m\.TempID = t\.TempID\s+SET t\.PrimaryStem = m\.marker;/);
  });

  it('bodyPre is a procedure-body fragment (no procedure envelope, no DELIMITER, no TRANSACTION)', () => {
    const { bodyPre } = defaultResult();
    expect(bodyPre).not.toMatch(/DROP PROCEDURE/);
    expect(bodyPre).not.toMatch(/DELIMITER/);
    expect(bodyPre).not.toMatch(/CREATE PROCEDURE/);
    expect(bodyPre).not.toMatch(/START TRANSACTION/);
    expect(bodyPre).not.toMatch(/COMMIT/);
    expect(bodyPre).toMatch(/^  -- Stage 9a:/m);
  });

  // --- 9b (bodyPost) ---

  it('bodyPost inserts into DBHAttributes with columns (DBHID, TSMID) only — no CensusID', () => {
    const { bodyPost } = defaultResult();
    // Must match exactly (DBHID, TSMID) with no extra columns
    expect(bodyPost).toMatch(/INSERT INTO DBHAttributes \(DBHID, TSMID\)/);
    expect(bodyPost).not.toMatch(/CensusID/);
  });

  it('bodyPost selects DISTINCT (DBHID, TSMID) pairs', () => {
    const { bodyPost } = defaultResult();
    expect(bodyPost).toMatch(/SELECT DISTINCT e\.DBHID, tsm\.TSMID/);
  });

  it('bodyPost only processes rows where DBHID IS NOT NULL', () => {
    const { bodyPost } = defaultResult();
    expect(bodyPost).toMatch(/AND t\.DBHID IS NOT NULL/);
  });

  it('bodyPost excludes main and secondary markers via WHERE NOT IN clause on Description', () => {
    const { bodyPost } = defaultResult();
    expect(bodyPost).toMatch(/WHERE LOWER\(tsm\.Description\) NOT IN \('main', 'secondary'\)/);
  });

  it('bodyPost excludes empty tokens and "*" tokens', () => {
    const { bodyPost } = defaultResult();
    expect(bodyPost).toMatch(/AND e\.token NOT IN \('', '\*'\)/);
  });

  it('bodyPost uses a recursive CTE for the Codes explosion', () => {
    const { bodyPost } = defaultResult();
    expect(bodyPost).toMatch(/WITH RECURSIVE numbers AS/);
    expect(bodyPost).toMatch(/TRIM\(SUBSTRING_INDEX\(SUBSTRING_INDEX\(t\.Codes, ';', n\.n\), ';', -1\)\) AS token/);
  });

  it('bodyPost joins TSMAttributes to resolve TSMID from each token', () => {
    const { bodyPost } = defaultResult();
    expect(bodyPost).toMatch(/JOIN TSMAttributes tsm ON tsm\.TSMCode = e\.token/);
  });

  it('bodyPost is a procedure-body fragment (no procedure envelope, no DELIMITER, no TRANSACTION)', () => {
    const { bodyPost } = defaultResult();
    expect(bodyPost).not.toMatch(/DROP PROCEDURE/);
    expect(bodyPost).not.toMatch(/DELIMITER/);
    expect(bodyPost).not.toMatch(/CREATE PROCEDURE/);
    expect(bodyPost).not.toMatch(/START TRANSACTION/);
    expect(bodyPost).not.toMatch(/COMMIT/);
    expect(bodyPost).toMatch(/^  -- Stage 9b:/m);
  });

  it('uses backtick-quoted identifier for custom tempTable name in both fragments', () => {
    const { bodyPre, bodyPost } = renderStage9PrimaryAndAttrs({ tempTable: 'MyCustomStaging' });
    expect(bodyPre).toMatch(/`MyCustomStaging`/);
    expect(bodyPost).toMatch(/`MyCustomStaging`/);
    expect(bodyPre).not.toMatch(/TempAllTrees/);
    expect(bodyPost).not.toMatch(/TempAllTrees/);
  });

  it('rejects an invalid tempTable identifier (injection guard)', () => {
    expect(() => renderStage9PrimaryAndAttrs({ tempTable: 'bad name; DROP TABLE' })).toThrow(/Invalid SQL identifier/);
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
