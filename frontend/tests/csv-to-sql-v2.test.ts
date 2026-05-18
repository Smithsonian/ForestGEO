import { describe, it, expect } from 'vitest';
import { parseCliArgsV2, renderProcedureEnvelope } from '../lib/csv-to-sql-v2';

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
