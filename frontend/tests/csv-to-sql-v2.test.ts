import { describe, it, expect } from 'vitest';
import {
  renderFullPipeline,
  renderProcedureEnvelope,
  renderStage0,
  renderStage1,
  renderStage2,
  renderStage5,
  renderStage6NewTrees,
  renderStage7NewStems,
  renderStage8DBH,
  renderStage10
} from '../lib/csv-to-sql-v2';
import { mapCsvRowToStagingRow } from '../lib/csv-to-sql-shared';

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

  it('with --allow-reload, emits scoped cleanup', () => {
    const sql = renderStage0({ destinationPlotId: 1, censusNumber: '2', allowReload: true });
    expect(sql).toMatch(/CREATE TEMPORARY TABLE reload_stems_to_check/);
    expect(sql).toMatch(/CREATE TEMPORARY TABLE reload_trees_to_check/);
    expect(sql).toMatch(/DELETE da\s+FROM DBHAttributes da/);
    expect(sql).toMatch(/DELETE FROM DBH WHERE CensusID = @target_census_id;/);
    expect(sql).toMatch(/DELETE s\s+FROM Stem s\s+JOIN reload_stems_to_check/);
    expect(sql).toMatch(/DELETE tr\s+FROM Tree tr\s+JOIN reload_trees_to_check/);
    expect(sql).not.toMatch(/Pass --allow-reload to overwrite/);
  });

  it('with --allow-reload, DELETEs in FK order (DBHAttributes before DBH, Stem before Tree)', () => {
    const sql = renderStage0({ destinationPlotId: 1, censusNumber: '2', allowReload: true });
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
