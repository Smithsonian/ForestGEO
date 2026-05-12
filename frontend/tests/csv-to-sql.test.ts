import { describe, it, expect } from 'vitest';
import { parseCliArgs, escapeSqlValue, mapCsvRowToStagingRow, type StagingRow } from '../lib/csv-to-sql';

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
