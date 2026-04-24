import { describe, expect, it } from 'vitest';
import { queryKey, stableStringify } from './queryKey';

describe('stableStringify', () => {
  it('produces identical output regardless of key order', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it('sorts nested object keys', () => {
    expect(stableStringify({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}');
  });

  it('preserves array order', () => {
    expect(stableStringify({ xs: [3, 1, 2] })).toBe('{"xs":[3,1,2]}');
  });

  it('handles primitives', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify('s')).toBe('"s"');
  });
});

describe('queryKey', () => {
  it('returns the 3-tuple with a canonical scope key', () => {
    expect(queryKey('grid:measurements', { siteSchema: 'foo', plotID: 1, censusID: 2 })).toEqual([
      'grid:measurements',
      'foo|1|2',
      undefined
    ]);
  });

  it('treats missing scope fields as empty string', () => {
    expect(queryKey('grid:errors', {})).toEqual(['grid:errors', '||', undefined]);
  });

  it('serializes params deterministically', () => {
    const a = queryKey('grid:measurements', { siteSchema: 'f' }, { page: 0, sort: 'asc' });
    const b = queryKey('grid:measurements', { siteSchema: 'f' }, { sort: 'asc', page: 0 });
    expect(a[2]).toBe(b[2]);
  });
});
