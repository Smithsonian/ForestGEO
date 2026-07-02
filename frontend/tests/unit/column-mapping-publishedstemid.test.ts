import { describe, it, expect } from 'vitest';
import { legacyCsvHeaderKey } from '@/lib/column-mapping/fields';

describe('publishedstemid column mapping', () => {
  it('resolves explicit aliases to publishedstemid', () => {
    for (const header of ['PublishedStemID', 'published_stem_id', 'SI_StemID', 'ctfs_stemid']) {
      expect(legacyCsvHeaderKey(header)).toBe('publishedstemid');
    }
  });

  it("does not hijack ArcGIS identity fields or the app's own StemID/StemGUID labels", () => {
    // A bare StemID header must NOT map to publishedstemid: the app labels its internal StemGUID as
    // "stemID" in its own grids and CSV/form exports, so auto-mapping a re-uploaded export would feed
    // StemGUID into the SI identifier. Only explicit unambiguous aliases resolve (see fields.ts).
    expect(legacyCsvHeaderKey('StemID')).not.toBe('publishedstemid');
    expect(legacyCsvHeaderKey('GlobalID')).toBe('globalid');
    expect(legacyCsvHeaderKey('StemGUID')).toBe('stemguid');
  });
});
