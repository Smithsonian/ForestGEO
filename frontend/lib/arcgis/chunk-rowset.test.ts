import { describe, it, expect } from 'vitest';
import { chunkFileRowSet } from './chunk-rowset';
import type { FileRowSet } from '@/config/macros/formdetails';

function makeRowSet(n: number): FileRowSet {
  const set: FileRowSet = {};
  for (let i = 0; i < n; i++)
    set[`row-${i}`] = {
      tag: String(i),
      stemtag: null,
      spcode: null,
      quadrat: null,
      lx: null,
      ly: null,
      dbh: null,
      hom: null,
      date: null,
      codes: '',
      comments: null
    };
  return set;
}

describe('chunkFileRowSet', () => {
  it('splits into chunks no larger than the requested size', () => {
    const chunks = chunkFileRowSet(makeRowSet(2500), 1000);
    expect(chunks.map(c => Object.keys(c).length)).toEqual([1000, 1000, 500]);
  });

  it('preserves keys and values', () => {
    const chunks = chunkFileRowSet(makeRowSet(3), 2);
    expect(chunks[0]['row-0'].tag).toBe('0');
    expect(chunks[1]['row-2'].tag).toBe('2');
  });

  it('returns [] for an empty row set', () => {
    expect(chunkFileRowSet({}, 1000)).toEqual([]);
  });

  it('throws RangeError for a non-positive size', () => {
    expect(() => chunkFileRowSet(makeRowSet(1), 0)).toThrow(RangeError);
  });
});
