import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyTreeStemRules } from './treestem';

vi.mock('../resolvers', () => ({
  resolveSpeciesByCode: vi.fn(async () => ({ speciesID: 1 })),
  planTreeResolution: vi.fn(),
  planStemResolution: vi.fn(),
  planQuadratResolution: vi.fn(async () => ({ quadratID: 9 }))
}));

import * as resolvers from '../resolvers';

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    cm: {} as any,
    schema: 's',
    dataType: 'measurementssummary' as const,
    plotID: 1,
    censusID: 1,
    oldRow: { TreeID: 10, TreeTag: 'T1', StemGUID: 100, StemTag: 'S1', QuadratName: 'Q', SpeciesCode: 'AA' },
    newRow: { TreeTag: 'T2' },
    changedFields: new Set(['TreeTag']),
    ...overrides
  } as Parameters<typeof applyTreeStemRules>[0];
}

describe('applyTreeStemRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (resolvers.resolveSpeciesByCode as any).mockResolvedValue({ speciesID: 1 });
    (resolvers.planQuadratResolution as any).mockResolvedValue({ quadratID: 9 });
  });

  it('no effects when identity unchanged', async () => {
    const effects = await applyTreeStemRules(makeCtx({ changedFields: new Set() }));
    expect(effects).toEqual([]);
    expect(resolvers.planTreeResolution).not.toHaveBeenCalled();
    expect(resolvers.planStemResolution).not.toHaveBeenCalled();
  });

  it('emits R2 warn when moving to a tree with stems remaining on source', async () => {
    (resolvers.planTreeResolution as any).mockResolvedValue({
      existingTreeID: 20,
      wouldCreate: false,
      sourceTreeID: 10,
      sourceTreeRemainingStems: 2
    });
    const effects = await applyTreeStemRules(makeCtx());
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      id: 'R2',
      severity: 'warn',
      category: 'identity',
      affectedTable: 'trees',
      affectedRowCount: 1
    });
    expect(effects[0].references?.treeIDs).toEqual([20, 10]);
  });

  it('promotes R2 to destructive when source tree orphans', async () => {
    (resolvers.planTreeResolution as any).mockResolvedValue({
      existingTreeID: 20,
      wouldCreate: false,
      sourceTreeID: 10,
      sourceTreeRemainingStems: 0
    });
    const effects = await applyTreeStemRules(makeCtx());
    expect(effects).toHaveLength(1);
    expect(effects[0].id).toBe('R2');
    expect(effects[0].severity).toBe('destructive');
  });

  it('R2 references contain only source when destination is new', async () => {
    (resolvers.planTreeResolution as any).mockResolvedValue({
      existingTreeID: null,
      wouldCreate: true,
      sourceTreeID: 10,
      sourceTreeRemainingStems: 3
    });
    const effects = await applyTreeStemRules(makeCtx());
    expect(effects).toHaveLength(1);
    expect(effects[0].references?.treeIDs).toEqual([10]);
    expect(effects[0].severity).toBe('warn');
  });

  it('no R2 when planTreeResolution returns same tree (no move)', async () => {
    (resolvers.planTreeResolution as any).mockResolvedValue({
      existingTreeID: 10,
      wouldCreate: false,
      sourceTreeID: 10,
      sourceTreeRemainingStems: 0
    });
    const effects = await applyTreeStemRules(makeCtx());
    expect(effects).toEqual([]);
  });

  it('emits R3 warn when StemTag change moves to different stem with source remaining', async () => {
    (resolvers.planStemResolution as any).mockResolvedValue({
      existingStemGUID: 200,
      wouldCreate: false,
      sourceStemGUID: 100,
      sourceStemRemainingMeasurements: 3
    });
    const effects = await applyTreeStemRules(
      makeCtx({
        newRow: { StemTag: 'S2' },
        changedFields: new Set(['StemTag'])
      })
    );
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      id: 'R3',
      severity: 'warn',
      category: 'identity',
      affectedTable: 'stems',
      affectedRowCount: 1
    });
    expect(effects[0].references?.stemGUIDs).toEqual([100, 200]);
  });

  it('promotes R3 to destructive when source stem orphans', async () => {
    (resolvers.planStemResolution as any).mockResolvedValue({
      existingStemGUID: 200,
      wouldCreate: false,
      sourceStemGUID: 100,
      sourceStemRemainingMeasurements: 0
    });
    const effects = await applyTreeStemRules(
      makeCtx({
        newRow: { QuadratName: 'Q2' },
        changedFields: new Set(['QuadratName'])
      })
    );
    expect(effects).toHaveLength(1);
    expect(effects[0].id).toBe('R3');
    expect(effects[0].severity).toBe('destructive');
  });

  it('R3 references contain only source when destination is new', async () => {
    (resolvers.planStemResolution as any).mockResolvedValue({
      existingStemGUID: null,
      wouldCreate: true,
      sourceStemGUID: 100,
      sourceStemRemainingMeasurements: 2
    });
    const effects = await applyTreeStemRules(
      makeCtx({
        newRow: { StemTag: 'S2' },
        changedFields: new Set(['StemTag'])
      })
    );
    expect(effects).toHaveLength(1);
    expect(effects[0].references?.stemGUIDs).toEqual([100]);
  });

  it('fires both R2 and R3 when tree and stem identities both change', async () => {
    (resolvers.planTreeResolution as any).mockResolvedValue({
      existingTreeID: 20,
      wouldCreate: false,
      sourceTreeID: 10,
      sourceTreeRemainingStems: 1
    });
    (resolvers.planStemResolution as any).mockResolvedValue({
      existingStemGUID: 200,
      wouldCreate: false,
      sourceStemGUID: 100,
      sourceStemRemainingMeasurements: 0
    });
    const effects = await applyTreeStemRules(
      makeCtx({
        newRow: { TreeTag: 'T2', StemTag: 'S2' },
        changedFields: new Set(['TreeTag', 'StemTag'])
      })
    );
    expect(effects).toHaveLength(2);
    expect(effects[0].id).toBe('R2');
    expect(effects[0].severity).toBe('warn');
    expect(effects[1].id).toBe('R3');
    expect(effects[1].severity).toBe('destructive');
  });

  // Cascade worst case: a single-measurement stem on a single-stem tree moves to a new
  // tree + new stem identity. Both source tree and source stem lose their last child in
  // the same plan, so both rules must report destructive severity. The analyzer sums
  // these into a single destructive maxSeverity which is what the UI gates on.
  it('emits R2 destructive + R3 destructive when both source tree and source stem orphan simultaneously', async () => {
    (resolvers.planTreeResolution as any).mockResolvedValue({
      existingTreeID: 20,
      wouldCreate: false,
      sourceTreeID: 10,
      sourceTreeRemainingStems: 0
    });
    (resolvers.planStemResolution as any).mockResolvedValue({
      existingStemGUID: 200,
      wouldCreate: false,
      sourceStemGUID: 100,
      sourceStemRemainingMeasurements: 0
    });
    const effects = await applyTreeStemRules(
      makeCtx({
        newRow: { TreeTag: 'T2', StemTag: 'S2' },
        changedFields: new Set(['TreeTag', 'StemTag'])
      })
    );
    expect(effects).toHaveLength(2);
    expect(effects[0]).toMatchObject({ id: 'R2', severity: 'destructive', affectedTable: 'trees' });
    expect(effects[1]).toMatchObject({ id: 'R3', severity: 'destructive', affectedTable: 'stems' });
    expect(effects[0].references?.treeIDs).toEqual([20, 10]);
    expect(effects[1].references?.stemGUIDs).toEqual([100, 200]);
  });

  // Cascade benign case: both identities change but neither source is orphaned
  // (source tree keeps other stems, source stem keeps other measurements). Both
  // rules fire at warn severity — no destructive escalation.
  it('emits R2 warn + R3 warn when neither source orphans during a dual identity move', async () => {
    (resolvers.planTreeResolution as any).mockResolvedValue({
      existingTreeID: 20,
      wouldCreate: false,
      sourceTreeID: 10,
      sourceTreeRemainingStems: 3
    });
    (resolvers.planStemResolution as any).mockResolvedValue({
      existingStemGUID: 200,
      wouldCreate: false,
      sourceStemGUID: 100,
      sourceStemRemainingMeasurements: 5
    });
    const effects = await applyTreeStemRules(
      makeCtx({
        newRow: { TreeTag: 'T2', StemTag: 'S2' },
        changedFields: new Set(['TreeTag', 'StemTag'])
      })
    );
    expect(effects).toHaveLength(2);
    expect(effects[0].id).toBe('R2');
    expect(effects[0].severity).toBe('warn');
    expect(effects[1].id).toBe('R3');
    expect(effects[1].severity).toBe('warn');
  });

  it('skips R2 when species code does not resolve', async () => {
    (resolvers.resolveSpeciesByCode as any).mockResolvedValue({ speciesID: null });
    const effects = await applyTreeStemRules(makeCtx());
    expect(effects).toEqual([]);
    expect(resolvers.planTreeResolution).not.toHaveBeenCalled();
  });

  it('skips R3 when quadrat does not resolve', async () => {
    (resolvers.planQuadratResolution as any).mockResolvedValue({ quadratID: null });
    const effects = await applyTreeStemRules(
      makeCtx({
        newRow: { StemTag: 'S2' },
        changedFields: new Set(['StemTag'])
      })
    );
    expect(effects).toEqual([]);
    expect(resolvers.planStemResolution).not.toHaveBeenCalled();
  });
});
