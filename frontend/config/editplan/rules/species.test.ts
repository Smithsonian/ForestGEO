import { describe, it, expect, vi } from 'vitest';
import { applySpeciesRules } from './species';
import { SpeciesNotFoundError } from './context';

vi.mock('../resolvers', () => ({
  resolveSpeciesByCode: vi.fn(async (_cm: unknown, _schema: string, code: string) => {
    if (code === 'AA') return { speciesID: 1 };
    if (code === 'BB') return { speciesID: 2 };
    return { speciesID: null };
  })
}));

function makeCtx(overrides: Partial<Parameters<typeof applySpeciesRules>[0]> = {}) {
  return {
    cm: {} as any,
    schema: 's',
    dataType: 'measurementssummary' as const,
    plotID: 1,
    censusID: 1,
    oldRow: { SpeciesID: 1, SpeciesCode: 'AA' },
    newRow: { SpeciesCode: 'BB' },
    changedFields: new Set(['SpeciesCode']),
    ...overrides
  };
}

describe('applySpeciesRules', () => {
  it('no effect when SpeciesCode unchanged', async () => {
    expect(await applySpeciesRules(makeCtx({ changedFields: new Set() }))).toEqual([]);
  });

  it('emits R1a when code resolves to different species', async () => {
    const effects = await applySpeciesRules(makeCtx());
    expect(effects).toHaveLength(1);
    expect(effects[0].id).toBe('R1a');
    expect(effects[0].severity).toBe('warn');
    expect(effects[0].category).toBe('identity');
    expect(effects[0].references?.speciesID).toBe(2);
  });

  it('throws SpeciesNotFoundError for unknown code', async () => {
    await expect(applySpeciesRules(makeCtx({ newRow: { SpeciesCode: 'ZZ' } }))).rejects.toBeInstanceOf(SpeciesNotFoundError);
  });

  it('throws SpeciesNotFoundError for empty code', async () => {
    await expect(applySpeciesRules(makeCtx({ newRow: { SpeciesCode: '' } }))).rejects.toBeInstanceOf(SpeciesNotFoundError);
  });

  it('throws SpeciesNotFoundError for whitespace-only code', async () => {
    await expect(applySpeciesRules(makeCtx({ newRow: { SpeciesCode: '   ' } }))).rejects.toBeInstanceOf(SpeciesNotFoundError);
  });

  it('no effect when code resolves to same SpeciesID as oldRow', async () => {
    const ctx = makeCtx({ oldRow: { SpeciesID: 2, SpeciesCode: 'BB' }, newRow: { SpeciesCode: 'BB' } });
    expect(await applySpeciesRules(ctx)).toEqual([]);
  });
});
