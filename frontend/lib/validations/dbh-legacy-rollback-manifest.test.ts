import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildDbhExpectedManifest } from './dbh-rescore-cli';

describe('legacy DBH rollback manifest', () => {
  it('is a standalone CLI manifest with both whole procedures and matching seeds', () => {
    const root = path.join(process.cwd(), 'db/rollback');
    const manifest = buildDbhExpectedManifest(
      readFileSync(path.join(root, '2026-09-02-dbh-legacy-rules-procedures.sql'), 'utf8'),
      readFileSync(path.join(root, '2026-09-02-dbh-legacy-rules-corequeries.sql'), 'utf8'),
      'legacy-rules'
    );
    expect(manifest.procedures.BuildDBHChangePairs).toContain('PriorDBH > 0');
    expect(manifest.procedures.BuildDBHChangePairs).toContain('PresentDBH < PriorDBH * cShrinkageMultiplier');
    expect(manifest.procedures.BuildDBHChangePairs).not.toContain('cGrowthMaxMmPerYear');
    expect(manifest.seeds).toEqual([
      expect.objectContaining({ validationID: 1, definition: 'CALL RunSharedDBHChangeValidations(@p_CensusID, @p_PlotID, 1, 0);' }),
      expect.objectContaining({ validationID: 2, definition: 'CALL RunSharedDBHChangeValidations(@p_CensusID, @p_PlotID, 0, 1);' })
    ]);
  });
});
