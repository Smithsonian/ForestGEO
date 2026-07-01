import { describe, it, expect } from 'vitest';
import { legacyCsvHeaderKey } from '@/lib/column-mapping/fields';

describe('publishedstemid column mapping', () => {
  it('resolves explicit aliases to publishedstemid', () => {
    for (const header of ['PublishedStemID', 'published_stem_id', 'StemID', 'SI_StemID', 'ctfs_stemid']) {
      expect(legacyCsvHeaderKey(header)).toBe('publishedstemid');
    }
  });

  it('does not hijack ArcGIS identity fields', () => {
    expect(legacyCsvHeaderKey('GlobalID')).toBe('globalid');
    expect(legacyCsvHeaderKey('StemGUID')).toBe('stemguid');
  });
});
