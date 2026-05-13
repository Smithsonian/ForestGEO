import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFileSync as readFile } from 'fs';
import {
  parseCliArgs,
  escapeSqlValue,
  mapCsvRowToStagingRow,
  renderCreateTable,
  renderInsertChunks,
  readCsvFile,
  main,
  type StagingRow
} from '../lib/csv-to-sql';
import { splitSqlFile } from '../lib/provisioning/sql-runner';

describe('parseCliArgs', () => {
  const baseArgv = ['--input', 'foo.csv', '--site', 'SERC', '--plot-id', '1', '--census-number', '2'];

  it('returns typed args when all required flags present', () => {
    const args = parseCliArgs(baseArgv);
    expect(args).toEqual({
      input: 'foo.csv',
      site: 'SERC',
      plotId: 1,
      censusNumber: 2,
      output: 'foo.sql',
      tempTable: 'TempAllTrees'
    });
  });

  it('throws when --input is missing', () => {
    const argv = ['--site', 'SERC', '--plot-id', '1', '--census-number', '2'];
    expect(() => parseCliArgs(argv)).toThrow(/--input/);
  });

  it('throws when --site is missing', () => {
    const argv = ['--input', 'foo.csv', '--plot-id', '1', '--census-number', '2'];
    expect(() => parseCliArgs(argv)).toThrow(/--site/);
  });

  it('throws when --plot-id is missing', () => {
    const argv = ['--input', 'foo.csv', '--site', 'SERC', '--census-number', '2'];
    expect(() => parseCliArgs(argv)).toThrow(/--plot-id/);
  });

  it('throws when --census-number is missing', () => {
    const argv = ['--input', 'foo.csv', '--site', 'SERC', '--plot-id', '1'];
    expect(() => parseCliArgs(argv)).toThrow(/--census-number/);
  });

  it('throws when --plot-id is not an integer', () => {
    const argv = ['--input', 'foo.csv', '--site', 'SERC', '--plot-id', 'abc', '--census-number', '2'];
    expect(() => parseCliArgs(argv)).toThrow(/plot-id.*integer/i);
  });

  it('throws when --census-number is not an integer', () => {
    const argv = ['--input', 'foo.csv', '--site', 'SERC', '--plot-id', '1', '--census-number', '2.5'];
    expect(() => parseCliArgs(argv)).toThrow(/census-number.*integer/i);
  });

  it('honors explicit --output', () => {
    const args = parseCliArgs([...baseArgv, '--output', '/tmp/explicit.sql']);
    expect(args.output).toBe('/tmp/explicit.sql');
  });

  it('honors explicit --temp-table', () => {
    const args = parseCliArgs([...baseArgv, '--temp-table', 'MyStaging']);
    expect(args.tempTable).toBe('MyStaging');
  });

  it('defaults --output by replacing .csv with .sql', () => {
    const args = parseCliArgs(['--input', '/path/to/SERC_c2_no_priors.csv', '--site', 'SERC', '--plot-id', '1', '--census-number', '2']);
    expect(args.output).toBe('/path/to/SERC_c2_no_priors.sql');
  });

  it('defaults --output by appending .sql when input has no .csv extension', () => {
    const args = parseCliArgs(['--input', '/path/to/data', '--site', 'SERC', '--plot-id', '1', '--census-number', '2']);
    expect(args.output).toBe('/path/to/data.sql');
  });
});

describe('escapeSqlValue', () => {
  it('emits NULL for null', () => {
    expect(escapeSqlValue(null)).toBe('NULL');
  });

  it('emits integers verbatim', () => {
    expect(escapeSqlValue(15)).toBe('15');
    expect(escapeSqlValue(0)).toBe('0');
    expect(escapeSqlValue(-3)).toBe('-3');
  });

  it('emits floats via String() (trailing zeros stripped)', () => {
    expect(escapeSqlValue(1.3)).toBe('1.3');
    expect(escapeSqlValue(1.305)).toBe('1.305');
  });

  it('quotes strings', () => {
    expect(escapeSqlValue('FRPE')).toBe("'FRPE'");
  });

  it('doubles single quotes inside strings', () => {
    expect(escapeSqlValue("O'Brien")).toBe("'O''Brien'");
  });

  it('doubles backslashes inside strings', () => {
    expect(escapeSqlValue('path\\to')).toBe("'path\\\\to'");
  });

  it('handles both single-quote and backslash in same string', () => {
    expect(escapeSqlValue("a'b\\c")).toBe("'a''b\\\\c'");
  });

  it('emits empty quoted string for empty input (caller maps empty->NULL upstream)', () => {
    expect(escapeSqlValue('')).toBe("''");
  });
});

describe('mapCsvRowToStagingRow', () => {
  const baseRow = {
    tag: '10001',
    stemtag: '10001',
    spcode: 'FRPE',
    quadrat: '121',
    lx: '4.1',
    ly: '5.2',
    dbh: '15',
    hom: '1.30',
    date: '2014-05-27',
    codes: 'LI'
  };

  it('maps a fully-populated row', () => {
    const result = mapCsvRowToStagingRow(baseRow, 1, 2);
    expect(result).toEqual<StagingRow>({
      QuadratName: '121',
      Tag: '10001',
      StemTag: '10001',
      Mnemonic: 'FRPE',
      DBH: 15,
      HOM: 1.3,
      Codes: 'LI',
      ExactDate: '2014-05-27',
      X: 4.1,
      Y: 5.2,
      PlotID: 1,
      PlotCensusNumber: 2
    });
  });

  it('maps empty string cells to null for all columns', () => {
    const result = mapCsvRowToStagingRow(
      {
        tag: '',
        stemtag: '',
        spcode: '',
        quadrat: '',
        lx: '',
        ly: '',
        dbh: '',
        hom: '',
        date: '',
        codes: ''
      },
      1,
      2
    );
    expect(result.Tag).toBeNull();
    expect(result.StemTag).toBeNull();
    expect(result.Mnemonic).toBeNull();
    expect(result.QuadratName).toBeNull();
    expect(result.DBH).toBeNull();
    expect(result.HOM).toBeNull();
    expect(result.X).toBeNull();
    expect(result.Y).toBeNull();
    expect(result.ExactDate).toBeNull();
    expect(result.Codes).toBeNull();
  });

  it('trims string columns and treats whitespace-only as null', () => {
    const result = mapCsvRowToStagingRow({ ...baseRow, tag: '  10001  ', codes: '   ' }, 1, 2);
    expect(result.Tag).toBe('10001');
    expect(result.Codes).toBeNull();
  });

  it('passes plot/census constants onto every row', () => {
    const r1 = mapCsvRowToStagingRow(baseRow, 7, 3);
    expect(r1.PlotID).toBe(7);
    expect(r1.PlotCensusNumber).toBe(3);
  });

  it('preserves DBH=0 verbatim (does NOT convert to null in v1)', () => {
    const result = mapCsvRowToStagingRow({ ...baseRow, dbh: '0' }, 1, 2);
    expect(result.DBH).toBe(0);
  });

  it('preserves codes with semicolons as a single string', () => {
    const result = mapCsvRowToStagingRow({ ...baseRow, codes: 'LI;M;A' }, 1, 2);
    expect(result.Codes).toBe('LI;M;A');
  });

  it('treats the literal string "NULL" as null in numeric columns', () => {
    const result = mapCsvRowToStagingRow({ ...baseRow, dbh: 'NULL', hom: 'NULL' }, 1, 2);
    expect(result.DBH).toBeNull();
    expect(result.HOM).toBeNull();
  });

  it('treats the literal string "NULL" as null in string columns', () => {
    const result = mapCsvRowToStagingRow({ ...baseRow, codes: 'NULL', tag: 'NULL' }, 1, 2);
    expect(result.Codes).toBeNull();
    expect(result.Tag).toBeNull();
  });

  it('treats "null"/"Null" case-insensitively as null', () => {
    const result = mapCsvRowToStagingRow({ ...baseRow, dbh: 'null', hom: 'Null' }, 1, 2);
    expect(result.DBH).toBeNull();
    expect(result.HOM).toBeNull();
  });

  it('treats "NULL" as null in the date column', () => {
    const result = mapCsvRowToStagingRow({ ...baseRow, date: 'NULL' }, 1, 2);
    expect(result.ExactDate).toBeNull();
  });

  it('throws when dbh is not numeric', () => {
    expect(() => mapCsvRowToStagingRow({ ...baseRow, dbh: 'abc' }, 1, 2)).toThrow(/dbh.*abc/);
  });

  it('throws when lx is not numeric', () => {
    expect(() => mapCsvRowToStagingRow({ ...baseRow, lx: 'NaN' }, 1, 2)).toThrow(/lx/);
  });

  it('throws when date is not YYYY-MM-DD', () => {
    expect(() => mapCsvRowToStagingRow({ ...baseRow, date: '5/27/2014' }, 1, 2)).toThrow(/date.*5\/27\/2014/);
  });

  it('throws when a required header is missing from the row object', () => {
    const partial = { ...baseRow } as Record<string, string>;
    delete partial.dbh;
    expect(() => mapCsvRowToStagingRow(partial, 1, 2)).toThrow(/dbh/);
  });
});

describe('renderCreateTable', () => {
  const ddl = renderCreateTable('TempAllTrees');

  it('includes a DROP TABLE IF EXISTS for the table', () => {
    expect(ddl).toMatch(/DROP TABLE IF EXISTS `TempAllTrees`;/);
  });

  it('includes CREATE TABLE for the table with backticks', () => {
    expect(ddl).toMatch(/CREATE TABLE `TempAllTrees`/);
  });

  it('includes ENGINE=MyISAM', () => {
    expect(ddl).toMatch(/ENGINE=MyISAM/);
  });

  it('declares all 25 columns from the legacy DDL', () => {
    const columns = [
      'TempID',
      'QuadratName',
      'Subquad',
      'Tag',
      'StemTag',
      'Mnemonic',
      'DBH',
      'Codes',
      'HOM',
      'Comments',
      'TreeID',
      'StemID',
      'ExactDate',
      'QuadratID',
      'X',
      'Y',
      'SpeciesID',
      'SubSpeciesID',
      'DBHID',
      'PlotCensusNumber',
      'CensusID',
      'PrimaryStem',
      'PlotID',
      'Errors',
      'Tagged'
    ];
    for (const col of columns) {
      expect(ddl).toContain(col);
    }
  });

  it('declares the legacy types/widths', () => {
    expect(ddl).toMatch(/TempID\s+INT UNSIGNED AUTO_INCREMENT/);
    expect(ddl).toMatch(/QuadratName\s+VARCHAR\(12\)/);
    expect(ddl).toMatch(/StemTag\s+VARCHAR\(32\)/);
    expect(ddl).toMatch(/DBH\s+FLOAT\(8\) DEFAULT NULL/);
    expect(ddl).toMatch(/Codes\s+VARCHAR\(50\) DEFAULT NULL/);
    expect(ddl).toMatch(/Comments\s+VARCHAR\(256\) DEFAULT NULL/);
    expect(ddl).toMatch(/PrimaryStem\s+VARCHAR\(20\)/);
    expect(ddl).toMatch(/ExactDate\s+DATE/);
  });

  it('declares PRIMARY KEY and the four indexes', () => {
    expect(ddl).toMatch(/PRIMARY KEY \(TempID\)/);
    expect(ddl).toMatch(/KEY `indexTagStemTag` \(`Tag`,`StemTag`\)/);
    expect(ddl).toMatch(/KEY `indexTreeIDStemID` \(`TreeID`,`StemID`\)/);
    expect(ddl).toMatch(/KEY `indexQuadratNamePlotID` \(`QuadratName`,`PlotID`\)/);
    expect(ddl).toMatch(/KEY `indexMnemonic` \(`Mnemonic`\)/);
  });

  it('honors a different table name', () => {
    const other = renderCreateTable('MyStaging');
    expect(other).toMatch(/DROP TABLE IF EXISTS `MyStaging`;/);
    expect(other).toMatch(/CREATE TABLE `MyStaging`/);
    expect(other).not.toMatch(/`TempAllTrees`/);
  });
});

function makeRow(overrides: Partial<StagingRow> = {}): StagingRow {
  return {
    QuadratName: '121',
    Tag: '10001',
    StemTag: '10001',
    Mnemonic: 'FRPE',
    DBH: 15,
    HOM: 1.3,
    Codes: 'LI',
    ExactDate: '2014-05-27',
    X: 4.1,
    Y: 5.2,
    PlotID: 1,
    PlotCensusNumber: 2,
    ...overrides
  };
}

describe('renderInsertChunks', () => {
  it('returns [] for 0 rows', () => {
    expect(renderInsertChunks('TempAllTrees', [])).toEqual([]);
  });

  it('returns one INSERT for 1 row', () => {
    const out = renderInsertChunks('TempAllTrees', [makeRow()]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^INSERT INTO `TempAllTrees`/);
    expect(out[0]).toMatch(/;$/);
  });

  it('lists columns in the documented order', () => {
    const out = renderInsertChunks('TempAllTrees', [makeRow()]);
    expect(out[0]).toContain('(QuadratName, Tag, StemTag, Mnemonic, DBH, HOM, Codes, ExactDate, X, Y, PlotID, PlotCensusNumber)');
  });

  it('emits NULL for null fields', () => {
    const out = renderInsertChunks('TempAllTrees', [makeRow({ DBH: null, HOM: null, Codes: null })]);
    const valuesMatch = out[0].match(/VALUES\s*(\(.*\))/s);
    expect(valuesMatch).not.toBeNull();
    const occurrences = (valuesMatch![1].match(/NULL/g) ?? []).length;
    expect(occurrences).toBe(3);
  });

  it('emits one INSERT for 1000 rows', () => {
    const rows = Array.from({ length: 1000 }, () => makeRow());
    expect(renderInsertChunks('TempAllTrees', rows)).toHaveLength(1);
  });

  it('emits two INSERTs for 1001 rows', () => {
    const rows = Array.from({ length: 1001 }, () => makeRow());
    const out = renderInsertChunks('TempAllTrees', rows);
    expect(out).toHaveLength(2);
  });

  it('emits three INSERTs for 2500 rows (1000+1000+500)', () => {
    const rows = Array.from({ length: 2500 }, () => makeRow());
    const out = renderInsertChunks('TempAllTrees', rows);
    expect(out).toHaveLength(3);
    const firstTupleCount = out[0].split('),').length;
    expect(firstTupleCount).toBe(1000);
    const lastTupleCount = out[2].split('),').length;
    expect(lastTupleCount).toBe(500);
  });

  it('respects a custom chunkSize', () => {
    const rows = Array.from({ length: 5 }, () => makeRow());
    const out = renderInsertChunks('TempAllTrees', rows, 2);
    expect(out).toHaveLength(3);
  });

  it('quotes the table name with backticks', () => {
    const out = renderInsertChunks('MyStaging', [makeRow()]);
    expect(out[0]).toMatch(/^INSERT INTO `MyStaging`/);
  });

  it('serializes a row with mixed values correctly', () => {
    const out = renderInsertChunks('TempAllTrees', [makeRow({ Tag: "O'Brien", Codes: 'LI;M;A', DBH: 0, HOM: null })]);
    expect(out[0]).toContain("'121'");
    expect(out[0]).toContain("'O''Brien'");
    expect(out[0]).toContain("'LI;M;A'");
    expect(out[0]).toContain(',0,');
    expect(out[0]).toMatch(/,NULL,/);
  });
});

function makeTempCsv(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'csv-to-sql-test-'));
  const path = join(dir, 'sample.csv');
  writeFileSync(path, content, 'utf-8');
  return path;
}

describe('readCsvFile', () => {
  it('reads a small CSV with the standard header order', () => {
    const path = makeTempCsv('tag,stemtag,spcode,quadrat,lx,ly,dbh,hom,date,codes\n' + '10001,10001,FRPE,121,4.1,5.2,15,1.30,2014-05-27,LI\n');
    const rows = readCsvFile(path);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      tag: '10001',
      stemtag: '10001',
      spcode: 'FRPE',
      quadrat: '121',
      lx: '4.1',
      ly: '5.2',
      dbh: '15',
      hom: '1.30',
      date: '2014-05-27',
      codes: 'LI'
    });
    rmSync(path, { recursive: true, force: true });
  });

  it('reads a CSV with quadrat-first header order', () => {
    const path = makeTempCsv('quadrat,tag,stemtag,spcode,lx,ly,dbh,hom,date,codes\n' + '121,10001,10001,FRPE,4.1,5.2,15,1.30,2014-05-27,LI\n');
    const rows = readCsvFile(path);
    expect(rows[0].quadrat).toBe('121');
    expect(rows[0].tag).toBe('10001');
    rmSync(path, { recursive: true, force: true });
  });

  it('throws when a required header is missing', () => {
    const path = makeTempCsv('tag,stemtag,spcode,quadrat,lx,ly,dbh,hom,date\n' + '10001,10001,FRPE,121,4.1,5.2,15,1.30,2014-05-27\n');
    expect(() => readCsvFile(path)).toThrow(/codes/);
    rmSync(path, { recursive: true, force: true });
  });

  it('warns about extra headers but does not throw', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const path = makeTempCsv('tag,stemtag,spcode,quadrat,lx,ly,dbh,hom,date,codes,foo\n' + '10001,10001,FRPE,121,4.1,5.2,15,1.30,2014-05-27,LI,extra\n');
    const rows = readCsvFile(path);
    expect(rows).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toMatch(/foo/);
    warnSpy.mockRestore();
    rmSync(path, { recursive: true, force: true });
  });

  it('skips trailing blank lines', () => {
    const path = makeTempCsv('tag,stemtag,spcode,quadrat,lx,ly,dbh,hom,date,codes\n' + '10001,10001,FRPE,121,4.1,5.2,15,1.30,2014-05-27,LI\n\n\n');
    const rows = readCsvFile(path);
    expect(rows).toHaveLength(1);
    rmSync(path, { recursive: true, force: true });
  });
});

describe('main (end-to-end)', () => {
  it('writes a SQL file with DDL + one INSERT for a 5-row CSV', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'csv-to-sql-e2e-'));
    const inputPath = join(dir, 'tiny.csv');
    const outputPath = join(dir, 'tiny.sql');

    writeFileSync(
      inputPath,
      'tag,stemtag,spcode,quadrat,lx,ly,dbh,hom,date,codes\n' +
        '10001,10001,FRPE,121,4.1,5.2,15,1.30,2014-05-27,LI\n' +
        '10002,10002,FRPE,121,6.3,4.2,6.1,1.30,2014-05-27,LI;M;A\n' +
        '10003,10003,FRPE,121,5.6,7.1,20.5,1.30,2014-05-27,LI\n' +
        '10004,10004,PAQU2,111,9.5,7.8,1.1,1.30,2014-05-27,LI\n' +
        '10005,10005,PAQU2,111,2.0,3.0,,,2014-05-27,\n',
      'utf-8'
    );

    await main(['--input', inputPath, '--site', 'SERC', '--plot-id', '1', '--census-number', '2', '--output', outputPath]);

    const sql = readFile(outputPath, 'utf-8');
    expect(sql).toMatch(/DROP TABLE IF EXISTS `TempAllTrees`;/);
    expect(sql).toMatch(/CREATE TABLE `TempAllTrees`/);
    expect(sql).toMatch(/INSERT INTO `TempAllTrees`/);

    const insertCount = (sql.match(/INSERT INTO/g) ?? []).length;
    expect(insertCount).toBe(1);

    const tupleCount = (sql.match(/^\s+\(/gm) ?? []).length;
    expect(tupleCount).toBe(5);

    const stmts = splitSqlFile(sql);
    expect(stmts.length).toBe(3);

    rmSync(dir, { recursive: true, force: true });
  });

  it('respects --temp-table override', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'csv-to-sql-e2e-'));
    const inputPath = join(dir, 't.csv');
    const outputPath = join(dir, 't.sql');
    writeFileSync(inputPath, 'tag,stemtag,spcode,quadrat,lx,ly,dbh,hom,date,codes\n' + '10001,10001,FRPE,121,4.1,5.2,15,1.30,2014-05-27,LI\n', 'utf-8');
    await main(['--input', inputPath, '--site', 'SERC', '--plot-id', '1', '--census-number', '2', '--output', outputPath, '--temp-table', 'MyStaging']);
    const sql = readFile(outputPath, 'utf-8');
    expect(sql).toMatch(/`MyStaging`/);
    expect(sql).not.toMatch(/`TempAllTrees`/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws when a CSV row has a non-numeric dbh', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'csv-to-sql-e2e-'));
    const inputPath = join(dir, 'bad.csv');
    const outputPath = join(dir, 'bad.sql');
    writeFileSync(inputPath, 'tag,stemtag,spcode,quadrat,lx,ly,dbh,hom,date,codes\n' + '10001,10001,FRPE,121,4.1,5.2,abc,1.30,2014-05-27,LI\n', 'utf-8');
    await expect(main(['--input', inputPath, '--site', 'SERC', '--plot-id', '1', '--census-number', '2', '--output', outputPath])).rejects.toThrow(/dbh/);
    rmSync(dir, { recursive: true, force: true });
  });
});
