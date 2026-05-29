import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyTreeStemRules } from './treestem';
import { CONFLICT_REASON_INACTIVE_TREE, CONFLICT_REASON_INACTIVE_STEM, CONFLICT_REASON_DIFFERENT_QUADRAT } from '../resolvers';

vi.mock('../resolvers', () => ({
  resolveSpeciesByCode: vi.fn(async () => ({ speciesID: 1 })),
  planTreeResolution: vi.fn(),
  planStemResolution: vi.fn(),
  planQuadratResolution: vi.fn(async () => ({ quadratID: 9 })),
  CONFLICT_REASON_INACTIVE_TREE: 'matching tree is inactive',
  CONFLICT_REASON_INACTIVE_STEM: 'matching stem is inactive',
  CONFLICT_REASON_DIFFERENT_QUADRAT: 'stem exists in a different quadrat'
}));

import * as resolvers from '../resolvers';

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    cm: {} as any,
    schema: 's',
    transactionID: 'tx',
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

  // --- New signature: no effects, no errors when identity unchanged ---

  it('returns empty effects and errors when identity unchanged', async () => {
    const result = await applyTreeStemRules(makeCtx({ changedFields: new Set() }));
    expect(result.effects).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(resolvers.planTreeResolution).not.toHaveBeenCalled();
    expect(resolvers.planStemResolution).not.toHaveBeenCalled();
  });

  // --- Error emission: 7 blocking error cases ---

  it('emits TreeStemResolution species/missing when SpeciesCode is in changedFields and resolves to null', async () => {
    (resolvers.resolveSpeciesByCode as any).mockResolvedValue({ speciesID: null });
    const result = await applyTreeStemRules(
      makeCtx({
        newRow: { SpeciesCode: 'ZZZZ' },
        changedFields: new Set(['SpeciesCode'])
      })
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        kind: 'TreeStemResolution',
        subject: 'species',
        reason: 'missing',
        field: 'SpeciesCode',
        blocking: true,
        severity: 'destructive'
      })
    );
    expect(result.effects).toEqual([]);
    expect(resolvers.planTreeResolution).not.toHaveBeenCalled();
  });

  it('does NOT emit species error when SpeciesCode is not in changedFields (field unchanged)', async () => {
    (resolvers.resolveSpeciesByCode as any).mockResolvedValue({ speciesID: null });
    (resolvers.planTreeResolution as any).mockResolvedValue({
      existingTreeID: 20,
      wouldCreate: false,
      sourceTreeID: 10,
      sourceTreeRemainingStems: 2
    });
    // TreeTag changed but SpeciesCode not in changedFields
    const result = await applyTreeStemRules(
      makeCtx({
        newRow: { TreeTag: 'T2' },
        changedFields: new Set(['TreeTag'])
      })
    );
    const speciesErrors = result.errors.filter(e => e.kind === 'TreeStemResolution' && (e as any).subject === 'species');
    expect(speciesErrors).toEqual([]);
  });

  it('emits TreeStemResolution tree/inactive when planTreeResolution returns CONFLICT_REASON_INACTIVE_TREE', async () => {
    (resolvers.resolveSpeciesByCode as any).mockResolvedValue({ speciesID: 7 });
    (resolvers.planTreeResolution as any).mockResolvedValue({
      existingTreeID: null,
      wouldCreate: false,
      sourceTreeID: 10,
      sourceTreeRemainingStems: 0,
      conflictReason: CONFLICT_REASON_INACTIVE_TREE
    });
    const result = await applyTreeStemRules(
      makeCtx({
        newRow: { TreeTag: 'INACTIVE', SpeciesCode: 'AA' },
        changedFields: new Set(['TreeTag', 'SpeciesCode'])
      })
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ kind: 'TreeStemResolution', subject: 'tree', reason: 'inactive', field: 'TreeTag', blocking: true })
    );
    expect(result.effects).toEqual([]);
  });

  it('emits TreeStemResolution tree/cannot_create when planTreeResolution returns wouldCreate=false with no existing and no conflictReason (synthetic defensive fixture)', async () => {
    (resolvers.resolveSpeciesByCode as any).mockResolvedValue({ speciesID: 7 });
    // This state is not reachable with current planners in production —
    // synthetic fixture to future-proof the error surface.
    (resolvers.planTreeResolution as any).mockResolvedValue({
      existingTreeID: null,
      wouldCreate: false,
      sourceTreeID: 10,
      sourceTreeRemainingStems: 0
      // no conflictReason
    });
    const result = await applyTreeStemRules(
      makeCtx({
        newRow: { TreeTag: 'NEW', SpeciesCode: 'AA' },
        changedFields: new Set(['TreeTag', 'SpeciesCode'])
      })
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ kind: 'TreeStemResolution', subject: 'tree', reason: 'cannot_create', field: 'TreeTag', blocking: true })
    );
    expect(result.effects).toEqual([]);
  });

  it('emits TreeStemResolution quadrat/missing when QuadratName is in changedFields and planQuadratResolution returns null', async () => {
    (resolvers.planQuadratResolution as any).mockResolvedValue({ quadratID: null });
    const result = await applyTreeStemRules(
      makeCtx({
        oldRow: { TreeID: 10, TreeTag: 'T1', StemGUID: 100, StemTag: 'S1', QuadratName: 'OLD-Q', SpeciesCode: 'AA' },
        newRow: { QuadratName: 'BOGUS' },
        changedFields: new Set(['QuadratName'])
      })
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ kind: 'TreeStemResolution', subject: 'quadrat', reason: 'missing', field: 'QuadratName', blocking: true })
    );
    expect(result.effects).toEqual([]);
    expect(resolvers.planStemResolution).not.toHaveBeenCalled();
  });

  it('emits TreeStemResolution stem/inactive when planStemResolution returns CONFLICT_REASON_INACTIVE_STEM', async () => {
    (resolvers.planQuadratResolution as any).mockResolvedValue({ quadratID: 77 });
    (resolvers.planStemResolution as any).mockResolvedValue({
      existingStemGUID: null,
      wouldCreate: false,
      sourceStemGUID: 100,
      sourceStemRemainingMeasurements: 0,
      conflictReason: CONFLICT_REASON_INACTIVE_STEM
    });
    const result = await applyTreeStemRules(
      makeCtx({
        newRow: { StemTag: 'INACTIVE' },
        changedFields: new Set(['StemTag'])
      })
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ kind: 'TreeStemResolution', subject: 'stem', reason: 'inactive', field: 'StemTag', blocking: true })
    );
    expect(result.effects).toEqual([]);
  });

  it('emits TreeStemResolution stem/different_quadrat when planStemResolution returns CONFLICT_REASON_DIFFERENT_QUADRAT', async () => {
    (resolvers.planQuadratResolution as any).mockResolvedValue({ quadratID: 77 });
    (resolvers.planStemResolution as any).mockResolvedValue({
      existingStemGUID: null,
      wouldCreate: false,
      sourceStemGUID: 100,
      sourceStemRemainingMeasurements: 0,
      conflictReason: CONFLICT_REASON_DIFFERENT_QUADRAT
    });
    const result = await applyTreeStemRules(
      makeCtx({
        newRow: { QuadratName: 'Q2' },
        changedFields: new Set(['QuadratName'])
      })
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ kind: 'TreeStemResolution', subject: 'stem', reason: 'different_quadrat', field: 'QuadratName', blocking: true })
    );
    expect(result.effects).toEqual([]);
  });

  it('emits TreeStemResolution stem/cannot_create when planStemResolution returns wouldCreate=false with no existing and no conflictReason (synthetic defensive fixture)', async () => {
    (resolvers.planQuadratResolution as any).mockResolvedValue({ quadratID: 77 });
    // Synthetic fixture: not reachable with current planners in production.
    (resolvers.planStemResolution as any).mockResolvedValue({
      existingStemGUID: null,
      wouldCreate: false,
      sourceStemGUID: 100,
      sourceStemRemainingMeasurements: 0
      // no conflictReason
    });
    const result = await applyTreeStemRules(
      makeCtx({
        newRow: { StemTag: 'NEW' },
        changedFields: new Set(['StemTag'])
      })
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ kind: 'TreeStemResolution', subject: 'stem', reason: 'cannot_create', field: 'StemTag', blocking: true })
    );
    expect(result.effects).toEqual([]);
  });

  // --- Clean resolution: no errors, movedAway effects still fire ---

  it('emits no errors when planner returns a clean existing destination (R2 effect fires, no errors)', async () => {
    (resolvers.planTreeResolution as any).mockResolvedValue({
      existingTreeID: 20,
      wouldCreate: false,
      sourceTreeID: 10,
      sourceTreeRemainingStems: 3
    });
    const result = await applyTreeStemRules(makeCtx());
    expect(result.errors).toEqual([]);
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0].id).toBe('R2');
  });

  // --- R2 effect behavior (existing tests updated to destructure) ---

  it('emits R2 warn when moving to a tree with stems remaining on source', async () => {
    (resolvers.planTreeResolution as any).mockResolvedValue({
      existingTreeID: 20,
      wouldCreate: false,
      sourceTreeID: 10,
      sourceTreeRemainingStems: 2
    });
    const { effects, errors } = await applyTreeStemRules(makeCtx());
    expect(errors).toEqual([]);
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
    const { effects, errors } = await applyTreeStemRules(makeCtx());
    expect(errors).toEqual([]);
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
    const { effects, errors } = await applyTreeStemRules(makeCtx());
    expect(errors).toEqual([]);
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
    const { effects, errors } = await applyTreeStemRules(makeCtx());
    expect(errors).toEqual([]);
    expect(effects).toEqual([]);
  });

  // --- R3 effect behavior ---

  it('emits R3 warn when StemTag change moves to different stem with source remaining', async () => {
    (resolvers.planStemResolution as any).mockResolvedValue({
      existingStemGUID: 200,
      wouldCreate: false,
      sourceStemGUID: 100,
      sourceStemRemainingMeasurements: 3
    });
    const { effects, errors } = await applyTreeStemRules(
      makeCtx({
        newRow: { StemTag: 'S2' },
        changedFields: new Set(['StemTag'])
      })
    );
    expect(errors).toEqual([]);
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
    const { effects, errors } = await applyTreeStemRules(
      makeCtx({
        newRow: { QuadratName: 'Q2' },
        changedFields: new Set(['QuadratName'])
      })
    );
    expect(errors).toEqual([]);
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
    const { effects, errors } = await applyTreeStemRules(
      makeCtx({
        newRow: { StemTag: 'S2' },
        changedFields: new Set(['StemTag'])
      })
    );
    expect(errors).toEqual([]);
    expect(effects).toHaveLength(1);
    expect(effects[0].references?.stemGUIDs).toEqual([100]);
  });

  it('fires both R2 and R3 when tree and stem identities both change (no conflicts)', async () => {
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
    const { effects, errors } = await applyTreeStemRules(
      makeCtx({
        newRow: { TreeTag: 'T2', StemTag: 'S2' },
        changedFields: new Set(['TreeTag', 'StemTag'])
      })
    );
    expect(errors).toEqual([]);
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
    const { effects, errors } = await applyTreeStemRules(
      makeCtx({
        newRow: { TreeTag: 'T2', StemTag: 'S2' },
        changedFields: new Set(['TreeTag', 'StemTag'])
      })
    );
    expect(errors).toEqual([]);
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
    const { effects, errors } = await applyTreeStemRules(
      makeCtx({
        newRow: { TreeTag: 'T2', StemTag: 'S2' },
        changedFields: new Set(['TreeTag', 'StemTag'])
      })
    );
    expect(errors).toEqual([]);
    expect(effects).toHaveLength(2);
    expect(effects[0].id).toBe('R2');
    expect(effects[0].severity).toBe('warn');
    expect(effects[1].id).toBe('R3');
    expect(effects[1].severity).toBe('warn');
  });

  it('emits species error (not R2) when SpeciesCode is in changedFields and species code does not resolve', async () => {
    (resolvers.resolveSpeciesByCode as any).mockResolvedValue({ speciesID: null });
    const { effects, errors } = await applyTreeStemRules(
      makeCtx({
        newRow: { SpeciesCode: 'ZZZZ' },
        changedFields: new Set(['SpeciesCode'])
      })
    );
    expect(errors).toContainEqual(expect.objectContaining({ subject: 'species', reason: 'missing' }));
    expect(effects).toEqual([]);
    expect(resolvers.planTreeResolution).not.toHaveBeenCalled();
  });

  it('emits quadrat error (not R3) when quadrat does not resolve', async () => {
    (resolvers.planQuadratResolution as any).mockResolvedValue({ quadratID: null });
    const { effects, errors } = await applyTreeStemRules(
      makeCtx({
        newRow: { StemTag: 'S2' },
        changedFields: new Set(['StemTag'])
      })
    );
    expect(errors).toContainEqual(expect.objectContaining({ subject: 'quadrat', reason: 'missing' }));
    expect(effects).toEqual([]);
    expect(resolvers.planStemResolution).not.toHaveBeenCalled();
  });
});
