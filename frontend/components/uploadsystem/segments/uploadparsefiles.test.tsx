import { describe, expect, it } from 'vitest';
import { SourceFormat } from '@/config/macros/formdetails';
import { seedMapping, validateMapping } from '@/lib/column-mapping/mapping';

// Pure-logic guard that mirrors the component's gating rule, so the rule is regression-protected
// even though full render wiring depends on the concrete header source.
describe('CSV mapping gating rule', () => {
  it('is invalid when a required field is unmapped', () => {
    const meta = { format: SourceFormat.csv as const, headers: ['X_Coord', 'Y_Coord', 'Sp', 'quadrat', 'date'] }; // no tag
    expect(validateMapping(seedMapping(meta), meta).valid).toBe(false);
  });

  it('is valid when all required fields map', () => {
    const meta = { format: SourceFormat.csv as const, headers: ['tag', 'Sp', 'quadrat', 'X_Coord', 'Y_Coord', 'date'] };
    expect(validateMapping(seedMapping(meta), meta).valid).toBe(true);
  });

  it('rejects a mapping whose source column is absent from a second file (per-file validation)', () => {
    const fileA = { format: SourceFormat.csv as const, headers: ['tag', 'Sp', 'quadrat', 'X_Coord', 'Y_Coord', 'date'] };
    const fileB = { format: SourceFormat.csv as const, headers: ['tag', 'Sp', 'quadrat', 'lx', 'ly', 'date'] }; // renamed coords
    const mapping = seedMapping(fileA);
    expect(validateMapping(mapping, fileA).valid).toBe(true);
    const vB = validateMapping(mapping, fileB);
    expect(vB.valid).toBe(false);
    expect(vB.missingSourceColumns).toEqual(expect.arrayContaining(['X_Coord', 'Y_Coord']));
  });
});
