import { describe, it, expect } from 'vitest';
import { parseCliArgsV2 } from '../lib/csv-to-sql-v2';

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
});
