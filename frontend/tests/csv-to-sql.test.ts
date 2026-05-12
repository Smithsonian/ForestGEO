import { describe, it, expect } from 'vitest';
import { parseCliArgs, escapeSqlValue } from '../lib/csv-to-sql';

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
