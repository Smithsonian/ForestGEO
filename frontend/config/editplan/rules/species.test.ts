import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applySpeciesRules } from './species';
import { SpeciesNotFoundError } from './context';
import type { SpeciesCorrectionSummary } from '../types';

vi.mock('../resolvers', () => ({
  // Matches resolveSpeciesByCode's real LOWER(SpeciesCode)=LOWER(?) comparison.
  resolveSpeciesByCode: vi.fn(async (_cm: unknown, _schema: string, code: string) => {
    const upper = code.trim().toUpperCase();
    if (upper === 'AA') return { speciesID: 1 };
    if (upper === 'BB') return { speciesID: 2 };
    return { speciesID: null };
  })
}));

vi.mock('../tree-species-correction', () => ({
  planSpeciesCorrection: vi.fn()
}));

import * as resolvers from '../resolvers';
import { planSpeciesCorrection } from '../tree-species-correction';

function makeCtx(overrides: Partial<Parameters<typeof applySpeciesRules>[0]> = {}) {
  return {
    cm: {} as any,
    schema: 's',
    transactionID: 'tx',
    dataType: 'measurementssummary' as const,
    plotID: 3,
    censusID: 7,
    oldRow: { TreeID: 100, SpeciesID: 1, SpeciesCode: 'AA', StemGUID: 200, CoreMeasurementID: 42 },
    newRow: { SpeciesCode: 'BB' },
    changedFields: new Set(['SpeciesCode']),
    ...overrides
  };
}

const CORRECTION: SpeciesCorrectionSummary = {
  version: 1,
  targetTreeID: 100,
  treeTag: 'T-100',
  plotID: 3,
  censusID: 7,
  oldSpeciesID: 1,
  oldSpeciesCode: 'AA',
  newSpeciesID: 2,
  newSpeciesCode: 'BB',
  activeStemCount: 2,
  inactiveStemCount: 1,
  activeMeasurementCount: 3,
  inactiveMeasurementCount: 1,
  stems: [
    { stemGUID: 200, censusID: 7, quadratID: 9, isActive: true },
    { stemGUID: 201, censusID: 7, quadratID: 9, isActive: true },
    { stemGUID: 202, censusID: 7, quadratID: 9, isActive: false }
  ],
  measurements: [
    { coreMeasurementID: 42, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' },
    { coreMeasurementID: 43, stemGUID: 200, censusID: 7, isActive: true, priorRawSpCode: 'AA' },
    { coreMeasurementID: 44, stemGUID: 201, censusID: 7, isActive: true, priorRawSpCode: null },
    { coreMeasurementID: 45, stemGUID: 202, censusID: 7, isActive: false, priorRawSpCode: 'aa' }
  ]
};

beforeEach(() => {
  vi.clearAllMocks();
  (resolvers.resolveSpeciesByCode as any).mockImplementation(async (_cm: unknown, _schema: string, code: string) => {
    const upper = code.trim().toUpperCase();
    if (upper === 'AA') return { speciesID: 1 };
    if (upper === 'BB') return { speciesID: 2 };
    return { speciesID: null };
  });
  (planSpeciesCorrection as any).mockResolvedValue({ status: 'ok', correction: CORRECTION });
});

describe('applySpeciesRules', () => {
  // --- No-op paths: nothing to correct, planner never consulted ---

  it('returns empty result when SpeciesCode is not in changedFields', async () => {
    const result = await applySpeciesRules(makeCtx({ changedFields: new Set() }));
    expect(result).toEqual({ effects: [], errors: [] });
    expect(planSpeciesCorrection).not.toHaveBeenCalled();
  });

  it('returns empty result when the new code resolves to the same SpeciesID as oldRow (case-only spelling)', async () => {
    const result = await applySpeciesRules(makeCtx({ oldRow: { TreeID: 100, SpeciesID: 2, SpeciesCode: 'BB' }, newRow: { SpeciesCode: 'bb' } }));
    expect(result).toEqual({ effects: [], errors: [] });
    expect(planSpeciesCorrection).not.toHaveBeenCalled();
  });

  // --- Code resolution failures (unchanged from pre-#427 behavior) ---

  it('throws SpeciesNotFoundError for an unknown code', async () => {
    await expect(applySpeciesRules(makeCtx({ newRow: { SpeciesCode: 'ZZ' } }))).rejects.toBeInstanceOf(SpeciesNotFoundError);
    expect(planSpeciesCorrection).not.toHaveBeenCalled();
  });

  it('throws SpeciesNotFoundError for an empty code', async () => {
    await expect(applySpeciesRules(makeCtx({ newRow: { SpeciesCode: '' } }))).rejects.toBeInstanceOf(SpeciesNotFoundError);
  });

  it('throws SpeciesNotFoundError for a whitespace-only code', async () => {
    await expect(applySpeciesRules(makeCtx({ newRow: { SpeciesCode: '   ' } }))).rejects.toBeInstanceOf(SpeciesNotFoundError);
  });

  // --- Mixed-identity gate (#427): species correction cannot be combined
  // with an actual tree/stem/quadrat identity change in the same edit ---

  it('blocks with mixed_identity when TreeTag is also actually changed, without consulting the planner', async () => {
    const result = await applySpeciesRules(makeCtx({ newRow: { SpeciesCode: 'BB', TreeTag: 'T2' }, changedFields: new Set(['SpeciesCode', 'TreeTag']) }));
    expect(result.errors).toEqual([
      expect.objectContaining({ kind: 'TreeStemResolution', subject: 'species', reason: 'mixed_identity', field: 'SpeciesCode', blocking: true })
    ]);
    expect(result.effects).toEqual([]);
    expect(result.speciesCorrection).toBeUndefined();
    expect(planSpeciesCorrection).not.toHaveBeenCalled();
  });

  it('blocks with mixed_identity when StemTag is also actually changed', async () => {
    const result = await applySpeciesRules(makeCtx({ newRow: { SpeciesCode: 'BB', StemTag: 'S2' }, changedFields: new Set(['SpeciesCode', 'StemTag']) }));
    expect(result.errors).toEqual([expect.objectContaining({ reason: 'mixed_identity' })]);
    expect(planSpeciesCorrection).not.toHaveBeenCalled();
  });

  it('blocks with mixed_identity when QuadratName is also actually changed', async () => {
    const result = await applySpeciesRules(
      makeCtx({ newRow: { SpeciesCode: 'BB', QuadratName: 'Q2' }, changedFields: new Set(['SpeciesCode', 'QuadratName']) })
    );
    expect(result.errors).toEqual([expect.objectContaining({ reason: 'mixed_identity' })]);
    expect(planSpeciesCorrection).not.toHaveBeenCalled();
  });

  it('names every mixed identity field in the error message', async () => {
    const result = await applySpeciesRules(
      makeCtx({
        newRow: { SpeciesCode: 'BB', TreeTag: 'T2', StemTag: 'S2' },
        changedFields: new Set(['SpeciesCode', 'TreeTag', 'StemTag'])
      })
    );
    expect(result.errors[0].message).toContain('TreeTag/StemTag');
  });

  it('does NOT block when TreeTag/StemTag/QuadratName are present in the payload but unchanged (not in changedFields)', async () => {
    // A full-row payload may legitimately echo back the identity fields at
    // their current values. changedFields is the analyzer's authoritative
    // diff, so unchanged identity values must not trigger mixed_identity.
    const result = await applySpeciesRules(
      makeCtx({
        newRow: { SpeciesCode: 'BB', TreeTag: 'T1', StemTag: 'S1', QuadratName: 'Q1' },
        changedFields: new Set(['SpeciesCode'])
      })
    );
    expect(result.errors).toEqual([]);
    expect(planSpeciesCorrection).toHaveBeenCalledTimes(1);
  });

  // --- Unlinked / missing tree guard ---

  it('blocks with tree/missing when oldRow.TreeID is not a positive number (unlinked row)', async () => {
    const result = await applySpeciesRules(makeCtx({ oldRow: { TreeID: 0, SpeciesID: 1, SpeciesCode: 'AA' } }));
    expect(result.errors).toEqual([expect.objectContaining({ subject: 'tree', reason: 'missing', field: 'TreeTag' })]);
    expect(planSpeciesCorrection).not.toHaveBeenCalled();
  });

  // --- Planner status -> structured preview error mapping ---

  it('calls planSpeciesCorrection with the resolved destination species, edited stem/measurement and ctx scope', async () => {
    await applySpeciesRules(makeCtx());
    expect(planSpeciesCorrection).toHaveBeenCalledWith(
      {},
      's',
      { treeID: 100, plotID: 3, censusID: 7, newSpeciesID: 2, editedStemGUID: 200, editedCoreMeasurementID: 42 },
      'tx'
    );
  });

  it('returns empty result on no_correction (planner-level re-check found nothing to correct)', async () => {
    (planSpeciesCorrection as any).mockResolvedValue({ status: 'no_correction', message: 'Tree 100 already has species 2; nothing to correct' });
    const result = await applySpeciesRules(makeCtx());
    expect(result).toEqual({ effects: [], errors: [] });
  });

  it('maps source_missing to a tree/missing TreeStemResolution error', async () => {
    (planSpeciesCorrection as any).mockResolvedValue({ status: 'source_missing', message: 'Tree 100 not found in census 7' });
    const result = await applySpeciesRules(makeCtx());
    expect(result.errors).toEqual([
      expect.objectContaining({ subject: 'tree', reason: 'missing', field: 'TreeTag', message: 'Tree 100 not found in census 7' })
    ]);
    expect(result.effects).toEqual([]);
    expect(result.speciesCorrection).toBeUndefined();
  });

  it('maps source_inactive to a tree/inactive TreeStemResolution error', async () => {
    (planSpeciesCorrection as any).mockResolvedValue({
      status: 'source_inactive',
      message: 'Tree 100 (TreeTag "T-100") is inactive',
      treeID: 100
    });
    const result = await applySpeciesRules(makeCtx());
    expect(result.errors).toEqual([
      expect.objectContaining({ subject: 'tree', reason: 'inactive', field: 'TreeTag', message: 'Tree 100 (TreeTag "T-100") is inactive' })
    ]);
    expect(result.effects).toEqual([]);
  });

  it('maps destination_species_missing to a species/missing TreeStemResolution error', async () => {
    (planSpeciesCorrection as any).mockResolvedValue({ status: 'destination_species_missing', message: 'Species 2 not found' });
    const result = await applySpeciesRules(makeCtx());
    expect(result.errors).toEqual([expect.objectContaining({ subject: 'species', reason: 'missing', field: 'SpeciesCode', message: 'Species 2 not found' })]);
    expect(result.effects).toEqual([]);
  });

  it('maps destination_species_inactive to a species/inactive TreeStemResolution error', async () => {
    (planSpeciesCorrection as any).mockResolvedValue({ status: 'destination_species_inactive', message: 'Species 2 is inactive', speciesID: 2 });
    const result = await applySpeciesRules(makeCtx());
    expect(result.errors).toEqual([
      expect.objectContaining({ subject: 'species', reason: 'inactive', field: 'SpeciesCode', message: 'Species 2 is inactive' })
    ]);
    expect(result.effects).toEqual([]);
  });

  it('maps destination_exists to a species/destination_exists TreeStemResolution error', async () => {
    (planSpeciesCorrection as any).mockResolvedValue({
      status: 'destination_exists',
      message: 'A tree with TreeTag "T-100" already exists under the target species in census 7 (TreeID 555); refusing to merge',
      destinationTreeID: 555,
      destinationIsActive: true
    });
    const result = await applySpeciesRules(makeCtx());
    expect(result.errors).toEqual([
      expect.objectContaining({
        subject: 'species',
        reason: 'destination_exists',
        field: 'SpeciesCode',
        message: 'A tree with TreeTag "T-100" already exists under the target species in census 7 (TreeID 555); refusing to merge'
      })
    ]);
    expect(result.effects).toEqual([]);
    expect(result.speciesCorrection).toBeUndefined();
  });

  it('maps scope_inconsistent to a tree/inconsistent_scope TreeStemResolution error', async () => {
    (planSpeciesCorrection as any).mockResolvedValue({
      status: 'scope_inconsistent',
      message: "Stem 201 on tree 100 is linked to census 8, not the tree's census 7",
      treeID: 100
    });
    const result = await applySpeciesRules(makeCtx());
    expect(result.errors).toEqual([
      expect.objectContaining({
        subject: 'tree',
        reason: 'inconsistent_scope',
        field: 'TreeTag',
        message: "Stem 201 on tree 100 is linked to census 8, not the tree's census 7"
      })
    ]);
    expect(result.effects).toEqual([]);
  });

  it('maps edited_stem_missing to a stem/missing TreeStemResolution error', async () => {
    (planSpeciesCorrection as any).mockResolvedValue({ status: 'edited_stem_missing', message: 'Stem 200 is not attached to tree 100' });
    const result = await applySpeciesRules(makeCtx());
    expect(result.errors).toEqual([
      expect.objectContaining({ subject: 'stem', reason: 'missing', field: 'StemTag', message: 'Stem 200 is not attached to tree 100' })
    ]);
    expect(result.effects).toEqual([]);
  });

  it('maps edited_stem_inactive to a stem/inactive TreeStemResolution error', async () => {
    (planSpeciesCorrection as any).mockResolvedValue({ status: 'edited_stem_inactive', message: 'Stem 200 is inactive', stemGUID: 200 });
    const result = await applySpeciesRules(makeCtx());
    expect(result.errors).toEqual([expect.objectContaining({ subject: 'stem', reason: 'inactive', field: 'StemTag', message: 'Stem 200 is inactive' })]);
    expect(result.effects).toEqual([]);
  });

  it('maps edited_measurement_missing to a stem/missing TreeStemResolution error', async () => {
    (planSpeciesCorrection as any).mockResolvedValue({ status: 'edited_measurement_missing', message: 'Measurement 42 is not attached to stem 200' });
    const result = await applySpeciesRules(makeCtx());
    expect(result.errors).toEqual([
      expect.objectContaining({ subject: 'stem', reason: 'missing', field: 'StemTag', message: 'Measurement 42 is not attached to stem 200' })
    ]);
    expect(result.effects).toEqual([]);
  });

  it('maps edited_measurement_inactive to a stem/inactive TreeStemResolution error', async () => {
    (planSpeciesCorrection as any).mockResolvedValue({ status: 'edited_measurement_inactive', message: 'Measurement 42 is inactive', coreMeasurementID: 42 });
    const result = await applySpeciesRules(makeCtx());
    expect(result.errors).toEqual([expect.objectContaining({ subject: 'stem', reason: 'inactive', field: 'StemTag', message: 'Measurement 42 is inactive' })]);
    expect(result.effects).toEqual([]);
  });

  it('maps edited_measurement_moved to a stem/inconsistent_scope TreeStemResolution error (F8: CM moved to a different stem since preview)', async () => {
    (planSpeciesCorrection as any).mockResolvedValue({
      status: 'edited_measurement_moved',
      message: 'Edited measurement 42 is attached to stem 201, not the previewed stem 200',
      coreMeasurementID: 42,
      expectedStemGUID: 200,
      actualStemGUID: 201
    });
    const result = await applySpeciesRules(makeCtx());
    expect(result.errors).toEqual([
      expect.objectContaining({
        subject: 'stem',
        reason: 'inconsistent_scope',
        field: 'StemTag',
        message: 'Edited measurement 42 is attached to stem 201, not the previewed stem 200'
      })
    ]);
    expect(result.effects).toEqual([]);
    expect(result.speciesCorrection).toBeUndefined();
  });

  it('maps source_identity_invalid to a tree/inconsistent_scope TreeStemResolution error (F9: NULL/blank source identity held, not fabricated)', async () => {
    (planSpeciesCorrection as any).mockResolvedValue({
      status: 'source_identity_invalid',
      message: 'Tree 100 has a missing/blank TreeTag; refusing to correct species for a tree whose identity cannot be restored',
      treeID: 100
    });
    const result = await applySpeciesRules(makeCtx());
    expect(result.errors).toEqual([
      expect.objectContaining({
        subject: 'tree',
        reason: 'inconsistent_scope',
        field: 'TreeTag',
        message: 'Tree 100 has a missing/blank TreeTag; refusing to correct species for a tree whose identity cannot be restored'
      })
    ]);
    expect(result.effects).toEqual([]);
    expect(result.speciesCorrection).toBeUndefined();
  });

  it('maps destination_species_code_missing to a species/inconsistent_scope TreeStemResolution error (F9: NULL/blank destination code held, not fabricated)', async () => {
    (planSpeciesCorrection as any).mockResolvedValue({
      status: 'destination_species_code_missing',
      message: 'Destination species 2 has a missing/blank canonical species code; refusing to correct species to an identity that cannot be restored',
      speciesID: 2
    });
    const result = await applySpeciesRules(makeCtx());
    expect(result.errors).toEqual([
      expect.objectContaining({
        subject: 'species',
        reason: 'inconsistent_scope',
        field: 'SpeciesCode',
        message: 'Destination species 2 has a missing/blank canonical species code; refusing to correct species to an identity that cannot be restored'
      })
    ]);
    expect(result.effects).toEqual([]);
  });

  // --- Successful correction: one tree-wide R1a effect + typed summary ---

  it('emits a single tree-wide R1a effect with correct references and active/inactive counts on ok', async () => {
    const result = await applySpeciesRules(makeCtx());
    expect(result.errors).toEqual([]);
    expect(result.effects).toHaveLength(1);
    const [effect] = result.effects;
    expect(effect).toMatchObject({
      id: 'R1a',
      severity: 'warn',
      category: 'identity',
      affectedTable: 'trees',
      affectedRowCount: 1
    });
    expect(effect.references).toEqual({
      treeIDs: [100],
      speciesID: 2,
      coreMeasurementIDs: [42, 43, 44, 45],
      stemGUIDs: [200, 201, 202]
    });
    // references is derived from the per-member stems/measurements arrays
    // (not a flat ID list on the summary), so this is also an implicit check
    // that it reads from correction.stems/correction.measurements.
    expect(effect.detail).toContain('AA');
    expect(effect.detail).toContain('BB');
    expect(effect.detail).toContain('2 active, 1 inactive');
    expect(effect.detail).toContain('3 active, 1 inactive');
  });

  it('returns the full planner correction summary unchanged for downstream consumption', async () => {
    const result = await applySpeciesRules(makeCtx());
    expect(result.speciesCorrection).toBe(CORRECTION);
  });
});
