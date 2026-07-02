import { describe, it, expect } from 'vitest';
import { buildTemporaryMeasurementInsertParams, parseUnsignedIntField } from '@/lib/ingestion/temporary-measurements';
import { SourceFormat } from '@/config/macros/formdetails';

const FILE = 'f.csv',
  BATCH = 'b1',
  SESSION = null,
  PLOT = 1,
  CENSUS = 2;
const lastParam = (row: any) => buildTemporaryMeasurementInsertParams(row, FILE, BATCH, SESSION, SourceFormat.csv, PLOT, CENSUS).at(-1);

describe('buildTemporaryMeasurementInsertParams publishedstemid wiring', () => {
  it('appends the parsed PublishedStemID as the final param', () => {
    expect(
      lastParam({
        tag: 'T1',
        stemtag: '1',
        spcode: 'sp',
        quadrat: 'q1',
        lx: '1',
        ly: '2',
        dbh: '10',
        hom: '1.3',
        date: '2026-01-01',
        codes: null,
        comments: null,
        publishedstemid: '5001'
      })
    ).toBe(5001);
  });
  it('yields null when publishedstemid is absent', () => {
    expect(lastParam({ tag: 'T1', spcode: 'sp', quadrat: 'q1', lx: '1', ly: '2', date: '2026-01-01' })).toBeNull();
  });
});

describe('parseUnsignedIntField', () => {
  it('accepts valid positive integers (string or number) and the unsigned ceiling', () => {
    expect(parseUnsignedIntField('5001')).toBe(5001);
    expect(parseUnsignedIntField(5001)).toBe(5001);
    expect(parseUnsignedIntField('4294967295')).toBe(4294967295);
  });
  it('rejects absent, empty, non-numeric, non-integer, non-positive, and above-ceiling values', () => {
    for (const bad of [undefined, null, '', '   ', 'abc', '1.5', '0', '-1', '4294967296']) {
      expect(parseUnsignedIntField(bad as unknown)).toBeNull();
    }
  });
});
