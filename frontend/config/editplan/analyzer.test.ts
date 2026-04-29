import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeEdit, assertEditPlanCanApply, DisallowedFieldError, EditPlanUnapplicableError, RoleForbiddenFieldError, TargetNotFoundError } from './analyzer';
import { analyzeBulk, assertBulkPlanCanApply, BulkPlanUnapplicableError } from './bulkanalyzer';
import { applyDuplicateRules } from './rules/duplicates';
import { SpeciesNotFoundError } from './rules/context';
import { DuplicateDeletion, Effect } from './types';

vi.mock('./rules/species', () => ({
  applySpeciesRules: vi.fn(async () => [])
}));
vi.mock('./rules/treestem', () => ({
  applyTreeStemRules: vi.fn(async () => ({ effects: [], errors: [] }))
}));
vi.mock('./rules/coordinates', () => ({
  applyCoordinateRules: vi.fn(async () => [])
}));
vi.mock('./rules/attributes', () => ({
  applyAttributeRules: vi.fn(async () => [])
}));

import { applySpeciesRules } from './rules/species';
import { applyTreeStemRules } from './rules/treestem';
import { applyCoordinateRules } from './rules/coordinates';
import { applyAttributeRules } from './rules/attributes';

const MEASUREMENT_OLD_ROW = {
  CoreMeasurementID: 42,
  CensusID: 7,
  PlotID: 3,
  MeasurementDate: '2024-06-01',
  MeasuredDBH: 15,
  MeasuredHOM: 1.3,
  Description: 'old',
  Attributes: 'A',
  TreeTag: 'T-1',
  TreeID: 100,
  SpeciesCode: 'AA',
  SpeciesID: 9,
  StemTag: 'S-1',
  StemGUID: 200,
  StemLocalX: 10,
  StemLocalY: 20,
  QuadratName: 'Q1'
};

const FAILED_OLD_ROW = {
  CoreMeasurementID: 99,
  CensusID: 7,
  PlotID: 3,
  Tag: 'T-1',
  StemTag: 'S-1',
  SpCode: 'AA',
  Quadrat: 'Q1',
  X: 10,
  Y: 20,
  DBH: 15,
  HOM: 1.3,
  Date: '2024-06-01',
  Codes: 'alive',
  Comments: 'ok'
};

function makeConnectionManager(oldRow: Record<string, unknown> | null) {
  return {
    executeQuery: vi.fn(async () => (oldRow ? [oldRow] : []))
  } as any;
}

beforeEach(() => {
  vi.mocked(applySpeciesRules).mockResolvedValue([]);
  vi.mocked(applyTreeStemRules).mockResolvedValue({ effects: [], errors: [] });
  vi.mocked(applyCoordinateRules).mockResolvedValue([]);
  vi.mocked(applyAttributeRules).mockResolvedValue([]);
});

describe('analyzeEdit', () => {
  const SCHEMA = 'forestgeo_testing';
  const PLOT_ID = 3;
  const CENSUS_ID = 7;
  const TARGET_ID = 42;

  it('dispatches to all rule modules and returns a signed plan with info severity when no effects', async () => {
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);
    const plan = await analyzeEdit(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, TARGET_ID, {
      MeasuredDBH: 16
    });

    expect(applySpeciesRules).toHaveBeenCalledTimes(1);
    expect(applyTreeStemRules).toHaveBeenCalledTimes(1);
    expect(applyCoordinateRules).toHaveBeenCalledTimes(1);
    expect(applyAttributeRules).toHaveBeenCalledTimes(1);
    expect(plan.dataType).toBe('measurementssummary');
    expect(plan.targetID).toBe(TARGET_ID);
    expect(plan.effects).toEqual([]);
    expect(plan.maxSeverity).toBe('info');
    expect(plan.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.fieldChanges).toHaveLength(1);
    expect(plan.fieldChanges[0]).toMatchObject({ field: 'MeasuredDBH', from: 15, to: 16 });
  });

  it('builds changedFields only for fields that differ from oldRow', async () => {
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);
    await analyzeEdit(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, TARGET_ID, {
      MeasuredDBH: 15, // unchanged
      MeasuredHOM: 1.5 // changed
    });

    const ctx = vi.mocked(applySpeciesRules).mock.calls[0][0];
    expect(ctx.changedFields.has('MeasuredHOM')).toBe(true);
    expect(ctx.changedFields.has('MeasuredDBH')).toBe(false);
  });

  it('computes maxSeverity via SEVERITY_RANK (destructive > warn > info)', async () => {
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);
    vi.mocked(applySpeciesRules).mockResolvedValueOnce([makeEffect('R1a', 'warn')]);
    vi.mocked(applyAttributeRules).mockResolvedValueOnce([makeEffect('R5', 'destructive')]);
    vi.mocked(applyCoordinateRules).mockResolvedValueOnce([makeEffect('R4', 'info')]);

    const plan = await analyzeEdit(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, TARGET_ID, {
      MeasuredDBH: 16
    });
    expect(plan.maxSeverity).toBe('destructive');
    expect(plan.effects).toHaveLength(3);
  });

  it('throws DisallowedFieldError when new row contains a field outside the allowlist', async () => {
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);
    await expect(
      analyzeEdit(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, TARGET_ID, {
        SpeciesName: 'Foo bar' // not in the allowlist
      })
    ).rejects.toBeInstanceOf(DisallowedFieldError);
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('throws TargetNotFoundError when loadCurrentRow returns no row (unknown id or out of scope)', async () => {
    const cm = makeConnectionManager(null);
    await expect(analyzeEdit(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, TARGET_ID, { MeasuredDBH: 16 })).rejects.toBeInstanceOf(
      TargetNotFoundError
    );
  });

  it('binds plotID and censusID into the lookup query so out-of-scope targets are rejected', async () => {
    const cm = makeConnectionManager(null);
    await expect(analyzeEdit(cm, SCHEMA, 'measurementssummary', 999, 888, TARGET_ID, { MeasuredDBH: 16 })).rejects.toBeInstanceOf(TargetNotFoundError);
    const callParams = cm.executeQuery.mock.calls[0][1];
    expect(callParams).toEqual([TARGET_ID, 888, 999]);
  });

  it('uses the failedmeasurements raw-col alias shape', async () => {
    const cm = makeConnectionManager(FAILED_OLD_ROW);
    const plan = await analyzeEdit(cm, SCHEMA, 'failedmeasurements', PLOT_ID, CENSUS_ID, 99, {
      DBH: 20
    });
    expect(plan.fieldChanges).toEqual([{ field: 'DBH', from: 15, to: 20 }]);
  });

  it('canonicalizes lowercase aliased keys before allowlist check (measurementssummary)', async () => {
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);
    const plan = await analyzeEdit(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, TARGET_ID, {
      measuredDBH: 16 // lowercase alias
    });
    expect(plan.fieldChanges).toEqual([{ field: 'MeasuredDBH', from: 15, to: 16 }]);
  });

  it('canonicalizes raw-col aliases for failedmeasurements surface', async () => {
    const cm = makeConnectionManager(FAILED_OLD_ROW);
    const plan = await analyzeEdit(cm, SCHEMA, 'failedmeasurements', PLOT_ID, CENSUS_ID, 99, {
      RawDBH: 20
    });
    expect(plan.fieldChanges).toEqual([{ field: 'DBH', from: 15, to: 20 }]);
  });

  it('skips measurement rules for the failedmeasurements surface (failed rows are row-local)', async () => {
    // Failed measurements have StemGUID IS NULL: no species link, no linked
    // stem/tree row, no cmattributes. The ramification rules can't fire on
    // them; dispatching would be misleading. Assert the dispatch is gated.
    const cm = makeConnectionManager(FAILED_OLD_ROW);
    vi.mocked(applySpeciesRules).mockResolvedValue([makeEffect('R1a', 'warn', 1)]);
    vi.mocked(applyTreeStemRules).mockResolvedValue({ effects: [makeEffect('R2', 'destructive', 1)], errors: [] });
    vi.mocked(applyCoordinateRules).mockResolvedValue([makeEffect('R4', 'warn', 1)]);
    vi.mocked(applyAttributeRules).mockResolvedValue([makeEffect('R5', 'destructive', 1)]);

    const plan = await analyzeEdit(cm, SCHEMA, 'failedmeasurements', PLOT_ID, CENSUS_ID, 99, {
      DBH: 20,
      Codes: 'alive;dead'
    });

    expect(plan.effects).toEqual([]);
    expect(plan.maxSeverity).toBe('info');
    expect(applySpeciesRules).not.toHaveBeenCalled();
    expect(applyTreeStemRules).not.toHaveBeenCalled();
    expect(applyCoordinateRules).not.toHaveBeenCalled();
    expect(applyAttributeRules).not.toHaveBeenCalled();
  });

  it('still dispatches rules for the measurementssummary surface', async () => {
    // Regression guard: the skip above is gated on dataType, not a fallthrough.
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);
    vi.mocked(applyCoordinateRules).mockResolvedValue([makeEffect('R4', 'warn', 1)]);

    const plan = await analyzeEdit(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, TARGET_ID, {
      StemLocalX: 50
    });

    expect(applySpeciesRules).toHaveBeenCalledTimes(1);
    expect(applyTreeStemRules).toHaveBeenCalledTimes(1);
    expect(applyCoordinateRules).toHaveBeenCalledTimes(1);
    expect(applyAttributeRules).toHaveBeenCalledTimes(1);
    expect(plan.effects).toHaveLength(1);
    expect(plan.maxSeverity).toBe('warn');
  });

  it('marks SpeciesCode edits as blocking for field crew without running downstream rules', async () => {
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);
    vi.mocked(applySpeciesRules).mockResolvedValue([makeEffect('R1a', 'warn', 1)]);

    const plan = await analyzeEdit(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, TARGET_ID, { SpeciesCode: 'BB' }, undefined, { role: 'field crew' });

    expect(plan.canApply).toBe(false);
    expect(plan.maxSeverity).toBe('destructive');
    expect(plan.errors).toEqual([
      expect.objectContaining({
        kind: 'RoleForbiddenField',
        field: 'SpeciesCode',
        role: 'field crew',
        blocking: true
      })
    ]);
    expect(plan.effects[0]).toMatchObject({ id: 'AUTH_ROLE_FORBIDDEN_FIELD_SpeciesCode', severity: 'destructive' });
    expect(applySpeciesRules).not.toHaveBeenCalled();
  });

  it('marks failed-measurement SpCode edits as blocking for lead technicians', async () => {
    const cm = makeConnectionManager(FAILED_OLD_ROW);

    const plan = await analyzeEdit(cm, SCHEMA, 'failedmeasurements', PLOT_ID, CENSUS_ID, 99, { SpCode: 'BB' }, undefined, { role: 'lead technician' });

    expect(plan.canApply).toBe(false);
    expect(plan.errors?.[0]).toMatchObject({ field: 'SpCode', role: 'lead technician' });
  });

  it('maxSeverity is destructive when errors contain a blocking TreeStemResolution error and effects array is empty', async () => {
    // This is the gap identified in Task 9: a plan with only treestem errors
    // (no destructive effect) was reporting maxSeverity: 'info' while
    // simultaneously setting canApply: false. The reducer must fold errors in.
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);
    const treeStemError: import('./types').TreeStemResolutionPreviewError = {
      kind: 'TreeStemResolution',
      subject: 'tree',
      reason: 'missing',
      field: 'TreeTag',
      message: 'Tree T-99 not found in plot/census.',
      severity: 'destructive',
      blocking: true
    };
    vi.mocked(applyTreeStemRules).mockResolvedValueOnce({ effects: [], errors: [treeStemError] });

    const plan = await analyzeEdit(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, TARGET_ID, {
      TreeTag: 'T-99'
    });

    expect(plan.effects).toHaveLength(0);
    expect(plan.errors).toHaveLength(1);
    expect(plan.canApply).toBe(false);
    // maxSeverity must reflect the error severity, not just the (empty) effects list
    expect(plan.maxSeverity).toBe('destructive');
  });

  it('maxSeverity uses highest severity across both errors and effects', async () => {
    // Confirm precedence: if effects have 'warn' and errors have 'destructive',
    // the result is 'destructive', and vice versa.
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);
    const treeStemError: import('./types').TreeStemResolutionPreviewError = {
      kind: 'TreeStemResolution',
      subject: 'stem',
      reason: 'inactive',
      field: 'StemTag',
      message: 'Stem S-1 is inactive.',
      severity: 'destructive',
      blocking: true
    };
    vi.mocked(applyTreeStemRules).mockResolvedValueOnce({ effects: [], errors: [treeStemError] });
    vi.mocked(applySpeciesRules).mockResolvedValueOnce([makeEffect('R1a', 'warn')]);

    const plan = await analyzeEdit(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, TARGET_ID, {
      StemTag: 'S-99'
    });

    expect(plan.effects).toHaveLength(1);
    expect(plan.errors).toHaveLength(1);
    expect(plan.maxSeverity).toBe('destructive');
  });
});

describe('applyDuplicateRules (R6)', () => {
  it('returns [] when given an empty array', () => {
    expect(applyDuplicateRules([])).toEqual([]);
  });

  it('returns a single destructive R6 effect whose affectedRowCount equals the number of pairs', () => {
    const pairs: DuplicateDeletion[] = [
      { coreMeasurementID: 10, survivorCoreMeasurementID: 1 },
      { coreMeasurementID: 20, survivorCoreMeasurementID: 1 },
      { coreMeasurementID: 30, survivorCoreMeasurementID: 1 }
    ];
    const effects = applyDuplicateRules(pairs);
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      id: 'R6',
      severity: 'destructive',
      category: 'destructive',
      affectedTable: 'coremeasurements',
      affectedRowCount: 3
    });
  });
});

describe('analyzeBulk', () => {
  const SCHEMA = 'forestgeo_testing';
  const PLOT_ID = 3;
  const CENSUS_ID = 7;

  it('produces row plans for matched/new/invalid and aggregates surfaced effects', async () => {
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);
    vi.mocked(applySpeciesRules).mockResolvedValue([makeEffect('R1a', 'warn', 1)]);

    const bulkPlan = await analyzeBulk(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, {
      matched: [
        { rowIndex: 0, targetID: 42, newRow: { MeasuredDBH: 16 } },
        { rowIndex: 1, targetID: 43, newRow: { MeasuredDBH: 17 } }
      ],
      newRows: [{ rowIndex: 2, newRow: { MeasuredDBH: 18 } }],
      invalid: [{ rowIndex: 3, reason: 'ambiguous match key' }],
      duplicateMeasurementIDsToDelete: [
        { coreMeasurementID: 101, survivorCoreMeasurementID: 42 },
        { coreMeasurementID: 102, survivorCoreMeasurementID: 43 }
      ]
    });

    expect(bulkPlan.rowCount).toBe(4);
    const byStatus = Object.fromEntries(bulkPlan.rowPlans.map(rp => [rp.rowIndex, rp.status]));
    expect(byStatus).toEqual({ 0: 'matched', 1: 'matched', 2: 'new', 3: 'invalid' });

    const r1a = bulkPlan.aggregateEffects.find(e => e.id === 'R1a');
    expect(r1a).toBeTruthy();
    expect(r1a!.affectedRowCount).toBe(2); // two matched rows each contributed 1
    expect(r1a!.severity).toBe('warn');

    const r6 = bulkPlan.aggregateEffects.find(e => e.id === 'R6');
    expect(r6).toBeTruthy();
    expect(r6!.severity).toBe('destructive');
    expect(r6!.affectedRowCount).toBe(2);

    expect(bulkPlan.maxSeverity).toBe('destructive');
    expect(bulkPlan.planHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('marks matched rows with no fieldChanges as unchanged', async () => {
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);
    const bulkPlan = await analyzeBulk(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, {
      matched: [{ rowIndex: 0, targetID: 42, newRow: { MeasuredDBH: 15 } }], // unchanged value
      newRows: [],
      invalid: [],
      duplicateMeasurementIDsToDelete: []
    });
    expect(bulkPlan.rowPlans[0].status).toBe('unchanged');
  });

  it('invalid rows (R9) do not contribute to aggregateEffects', async () => {
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);
    const bulkPlan = await analyzeBulk(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, {
      matched: [],
      newRows: [],
      invalid: [
        { rowIndex: 0, reason: 'bad key' },
        { rowIndex: 1, reason: 'missing tag' }
      ],
      duplicateMeasurementIDsToDelete: []
    });
    expect(bulkPlan.aggregateEffects).toEqual([]);
    expect(bulkPlan.maxSeverity).toBe('info');
    expect(bulkPlan.rowPlans.every(rp => rp.status === 'invalid')).toBe(true);
  });

  it('maxSeverity is info when no surfaced effects exist', async () => {
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);
    const bulkPlan = await analyzeBulk(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, {
      matched: [{ rowIndex: 0, targetID: 42, newRow: { MeasuredDBH: 16 } }],
      newRows: [],
      invalid: [],
      duplicateMeasurementIDsToDelete: []
    });
    expect(bulkPlan.maxSeverity).toBe('info');
  });

  it('carries row-level role errors into the aggregate bulk plan', async () => {
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);

    const bulkPlan = await analyzeBulk(
      cm,
      SCHEMA,
      'measurementssummary',
      PLOT_ID,
      CENSUS_ID,
      {
        matched: [{ rowIndex: 4, targetID: 42, newRow: { SpeciesCode: 'BB' } }],
        newRows: [],
        invalid: [],
        duplicateMeasurementIDsToDelete: []
      },
      undefined,
      { role: 'field crew' }
    );

    expect(bulkPlan.canApply).toBe(false);
    expect(bulkPlan.maxSeverity).toBe('destructive');
    expect(bulkPlan.errors?.[0]).toMatchObject({ field: 'SpeciesCode', rowIndex: 4 });
  });

  it('converts TargetNotFoundError from a matched row into an invalid-row entry (does not crash the batch)', async () => {
    // Second matched row's loadCurrentRow returns empty → TargetNotFoundError.
    // analyzeBulk must catch it and mark that row invalid, letting the rest
    // of the batch continue. This is the drift path between match and apply.
    const cm = {
      executeQuery: vi.fn().mockResolvedValueOnce([MEASUREMENT_OLD_ROW]).mockResolvedValueOnce([])
    } as any;

    const bulkPlan = await analyzeBulk(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, {
      matched: [
        { rowIndex: 0, targetID: 42, newRow: { MeasuredDBH: 16 } },
        { rowIndex: 9, targetID: 999, newRow: { MeasuredDBH: 17 } }
      ],
      newRows: [],
      invalid: [],
      duplicateMeasurementIDsToDelete: []
    });

    expect(bulkPlan.rowPlans).toHaveLength(2);
    const missing = bulkPlan.rowPlans.find(rp => rp.rowIndex === 9);
    expect(missing?.status).toBe('invalid');
    expect(missing?.targetID).toBe(999);
    expect(missing?.reason).toMatch(/no longer active/i);
    const kept = bulkPlan.rowPlans.find(rp => rp.rowIndex === 0);
    expect(kept?.status).toBe('matched');
  });

  it('converts SpeciesNotFoundError from a matched row into an invalid-row entry (does not crash the batch)', async () => {
    // Mirrors the TargetNotFoundError test above: applySpeciesRules can throw
    // on the second matched row (unknown species code, e.g. user typed 'CHANGED'
    // or the species was deactivated mid-batch). analyzeBulk must catch it and
    // demote that row to status:'invalid' with a "Species not found" reason —
    // not bubble up and 500 the entire upload.
    vi.mocked(applySpeciesRules).mockImplementation(async ctx => {
      if (ctx.newRow.SpeciesCode === 'UNKNOWN_SP') {
        throw new SpeciesNotFoundError('UNKNOWN_SP');
      }
      return [];
    });

    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);

    const bulkPlan = await analyzeBulk(
      cm,
      SCHEMA,
      'measurementssummary',
      PLOT_ID,
      CENSUS_ID,
      {
        matched: [
          { rowIndex: 0, targetID: 42, newRow: { MeasuredDBH: 16 } },
          { rowIndex: 1, targetID: 43, newRow: { SpeciesCode: 'UNKNOWN_SP' } }
        ],
        newRows: [],
        invalid: [],
        duplicateMeasurementIDsToDelete: []
      },
      undefined,
      // SpeciesCode edits are role-gated to global/db admin in
      // isFieldEditableByRole. Without an explicit role, analyzeEdit short-
      // circuits with a RoleForbidden error and never reaches applySpeciesRules
      // — so the SpeciesNotFoundError catch under test would not fire.
      { role: 'global' }
    );

    expect(bulkPlan.rowPlans).toHaveLength(2);
    const bad = bulkPlan.rowPlans.find(rp => rp.rowIndex === 1);
    expect(bad?.status).toBe('invalid');
    expect(bad?.reason).toBe('Species not found: UNKNOWN_SP');
    const good = bulkPlan.rowPlans.find(rp => rp.rowIndex === 0);
    expect(good?.status).toBe('matched');
  });

  it('aggregates affectedRowCount across repeated effect ids using max severity', async () => {
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);
    const calls: Array<ReturnType<typeof makeEffect>[]> = [[makeEffect('R4', 'info', 3)], [makeEffect('R4', 'warn', 5)]];
    vi.mocked(applyCoordinateRules).mockImplementation(async () => calls.shift() ?? []);

    const bulkPlan = await analyzeBulk(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, {
      matched: [
        { rowIndex: 0, targetID: 42, newRow: { MeasuredDBH: 16 } },
        { rowIndex: 1, targetID: 43, newRow: { MeasuredDBH: 17 } }
      ],
      newRows: [],
      invalid: [],
      duplicateMeasurementIDsToDelete: []
    });

    const r4 = bulkPlan.aggregateEffects.find(e => e.id === 'R4');
    expect(r4).toBeTruthy();
    expect(r4!.affectedRowCount).toBe(8);
    expect(r4!.severity).toBe('warn');
  });

  it('populates canonicalNewRow on new-status RowPlans using revision-insert mode', async () => {
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);

    const bulkPlan = await analyzeBulk(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, {
      matched: [],
      newRows: [{ rowIndex: 5, newRow: { tag: 'T99', stemtag: 'S99', dbh: '12.5', date: '2026-04-22' } }],
      invalid: [],
      duplicateMeasurementIDsToDelete: []
    });

    const newRowPlan = bulkPlan.rowPlans.find(rp => rp.rowIndex === 5);
    expect(newRowPlan?.status).toBe('new');
    expect(newRowPlan?.canonicalNewRow).toBeDefined();
    expect(newRowPlan?.canonicalNewRow).toMatchObject({ TreeTag: 'T99', StemTag: 'S99', MeasuredDBH: 12.5, MeasurementDate: '2026-04-22' });
  });

  it('maxSeverity is destructive when a row plan has only a TreeStemResolution error and no destructive effect', async () => {
    // Regression for Task 9: bulk maxSeverity was computed only from
    // aggregateEffects. A row with only blocking errors (no effects) produced
    // canApply:false but maxSeverity:'info' — a visible UX inconsistency.
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);
    const treeStemError: import('./types').TreeStemResolutionPreviewError = {
      kind: 'TreeStemResolution',
      subject: 'tree',
      reason: 'missing',
      field: 'TreeTag',
      message: 'Tree T-99 not found in plot/census.',
      severity: 'destructive',
      blocking: true
    };
    vi.mocked(applyTreeStemRules).mockResolvedValueOnce({ effects: [], errors: [treeStemError] });

    const bulkPlan = await analyzeBulk(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, {
      matched: [{ rowIndex: 0, targetID: 42, newRow: { TreeTag: 'T-99' } }],
      newRows: [],
      invalid: [],
      duplicateMeasurementIDsToDelete: []
    });

    expect(bulkPlan.aggregateEffects).toHaveLength(0);
    expect(bulkPlan.errors).toHaveLength(1);
    expect(bulkPlan.errors?.[0]).toMatchObject({ kind: 'TreeStemResolution', rowIndex: 0 });
    expect(bulkPlan.canApply).toBe(false);
    // The key assertion: errors must drive maxSeverity, not just effects
    expect(bulkPlan.maxSeverity).toBe('destructive');
  });

  it('does not populate canonicalNewRow on invalid RowPlans', async () => {
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);

    const bulkPlan = await analyzeBulk(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, {
      matched: [],
      newRows: [],
      invalid: [{ rowIndex: 3, reason: 'bad key' }],
      duplicateMeasurementIDsToDelete: []
    });

    const invalidPlan = bulkPlan.rowPlans.find(rp => rp.rowIndex === 3);
    expect(invalidPlan?.status).toBe('invalid');
    expect(invalidPlan?.canonicalNewRow).toBeUndefined();
  });

  it('propagates structured duplicate pairs onto BulkEditPlan.duplicateDeletions as an immutable copy', async () => {
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);
    const DUPLICATE_PAIRS: DuplicateDeletion[] = [
      { coreMeasurementID: 101, survivorCoreMeasurementID: 42 },
      { coreMeasurementID: 102, survivorCoreMeasurementID: 43 }
    ];

    const bulkPlan = await analyzeBulk(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, {
      matched: [
        { rowIndex: 0, targetID: 42, newRow: { MeasuredDBH: 16 } },
        { rowIndex: 1, targetID: 43, newRow: { MeasuredDBH: 17 } }
      ],
      newRows: [],
      invalid: [],
      duplicateMeasurementIDsToDelete: DUPLICATE_PAIRS
    });

    expect(bulkPlan.duplicateDeletions).toEqual(DUPLICATE_PAIRS);
    // Confirm it's a copy, not the same reference
    expect(bulkPlan.duplicateDeletions).not.toBe(DUPLICATE_PAIRS);
  });
});

describe('assertEditPlanCanApply', () => {
  const ROLE_ERROR: import('./types').RoleForbiddenFieldPreviewError = {
    kind: 'RoleForbiddenField',
    field: 'SpeciesCode',
    role: 'field crew',
    message: 'SpeciesCode can only be edited by global or db admin users.',
    severity: 'destructive',
    blocking: true
  };

  const TREESTEM_ERROR: import('./types').TreeStemResolutionPreviewError = {
    kind: 'TreeStemResolution',
    subject: 'tree',
    reason: 'missing',
    field: 'TreeTag',
    message: 'Tree T-99 not found in plot/census.',
    severity: 'destructive',
    blocking: true
  };

  it('throws RoleForbiddenFieldError when plan has only role errors', () => {
    const plan: import('./types').EditPlan = {
      dataType: 'measurementssummary',
      targetID: 42,
      fieldChanges: [],
      effects: [],
      errors: [ROLE_ERROR],
      canApply: false,
      maxSeverity: 'destructive',
      planHash: 'abc',
      generatedAt: new Date().toISOString()
    };
    expect(() => assertEditPlanCanApply(plan)).toThrow(RoleForbiddenFieldError);
  });

  it('throws EditPlanUnapplicableError when plan has only treestem errors', () => {
    const plan: import('./types').EditPlan = {
      dataType: 'measurementssummary',
      targetID: 42,
      fieldChanges: [],
      effects: [],
      errors: [TREESTEM_ERROR],
      canApply: false,
      maxSeverity: 'destructive',
      planHash: 'abc',
      generatedAt: new Date().toISOString()
    };
    expect(() => assertEditPlanCanApply(plan)).toThrow(EditPlanUnapplicableError);
    try {
      assertEditPlanCanApply(plan);
    } catch (err) {
      expect(err).toBeInstanceOf(EditPlanUnapplicableError);
      expect((err as EditPlanUnapplicableError).blockingErrors).toEqual([TREESTEM_ERROR]);
    }
  });

  it('throws RoleForbiddenFieldError (role priority) when plan has both role and treestem errors', () => {
    const plan: import('./types').EditPlan = {
      dataType: 'measurementssummary',
      targetID: 42,
      fieldChanges: [],
      effects: [],
      errors: [ROLE_ERROR, TREESTEM_ERROR],
      canApply: false,
      maxSeverity: 'destructive',
      planHash: 'abc',
      generatedAt: new Date().toISOString()
    };
    expect(() => assertEditPlanCanApply(plan)).toThrow(RoleForbiddenFieldError);
  });

  it('throws EditPlanUnapplicableError with empty blockingErrors when canApply is false and errors array is empty', () => {
    const plan: import('./types').EditPlan = {
      dataType: 'measurementssummary',
      targetID: 42,
      fieldChanges: [],
      effects: [],
      errors: [],
      canApply: false,
      maxSeverity: 'info',
      planHash: 'abc',
      generatedAt: new Date().toISOString()
    };
    try {
      assertEditPlanCanApply(plan);
      expect.fail('Expected assertEditPlanCanApply to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EditPlanUnapplicableError);
      expect((err as EditPlanUnapplicableError).blockingErrors).toEqual([]);
    }
  });

  it('passes silently when canApply is not false and errors is empty', () => {
    const plan: import('./types').EditPlan = {
      dataType: 'measurementssummary',
      targetID: 42,
      fieldChanges: [],
      effects: [],
      errors: [],
      canApply: true,
      maxSeverity: 'info',
      planHash: 'abc',
      generatedAt: new Date().toISOString()
    };
    expect(() => assertEditPlanCanApply(plan)).not.toThrow();
  });
});

describe('assertBulkPlanCanApply', () => {
  const ROLE_ERROR: import('./types').RoleForbiddenFieldPreviewError = {
    kind: 'RoleForbiddenField',
    field: 'SpeciesCode',
    role: 'field crew',
    message: 'SpeciesCode can only be edited by global or db admin users.',
    severity: 'destructive',
    blocking: true,
    rowIndex: 0
  };

  const TREESTEM_ERROR: import('./types').TreeStemResolutionPreviewError = {
    kind: 'TreeStemResolution',
    subject: 'tree',
    reason: 'missing',
    field: 'TreeTag',
    message: 'Tree T-99 not found in plot/census.',
    severity: 'destructive',
    blocking: true,
    rowIndex: 1
  };

  function makeMinimalBulkPlan(errors: import('./types').PreviewError[], canApply: boolean): import('./types').BulkEditPlan {
    return {
      dataType: 'measurementssummary',
      rowCount: 2,
      rowPlans: [],
      aggregateEffects: [],
      errors,
      canApply,
      maxSeverity: 'destructive',
      planHash: 'abc',
      generatedAt: new Date().toISOString(),
      duplicateDeletions: []
    };
  }

  it('throws RoleForbiddenFieldError when bulk plan has only role errors', () => {
    const plan = makeMinimalBulkPlan([ROLE_ERROR], false);
    expect(() => assertBulkPlanCanApply(plan)).toThrow(RoleForbiddenFieldError);
  });

  it('throws BulkPlanUnapplicableError when bulk plan has only treestem errors', () => {
    const plan = makeMinimalBulkPlan([TREESTEM_ERROR], false);
    expect(() => assertBulkPlanCanApply(plan)).toThrow(BulkPlanUnapplicableError);
    try {
      assertBulkPlanCanApply(plan);
    } catch (err) {
      expect(err).toBeInstanceOf(BulkPlanUnapplicableError);
      expect((err as BulkPlanUnapplicableError).blockingErrors).toEqual([TREESTEM_ERROR]);
    }
  });

  it('throws RoleForbiddenFieldError (role priority) when bulk plan has both role and treestem errors', () => {
    const plan = makeMinimalBulkPlan([ROLE_ERROR, TREESTEM_ERROR], false);
    expect(() => assertBulkPlanCanApply(plan)).toThrow(RoleForbiddenFieldError);
  });

  it('throws BulkPlanUnapplicableError with empty blockingErrors when canApply is false and errors array is empty', () => {
    const plan = makeMinimalBulkPlan([], false);
    try {
      assertBulkPlanCanApply(plan);
      expect.fail('Expected assertBulkPlanCanApply to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BulkPlanUnapplicableError);
      expect((err as BulkPlanUnapplicableError).blockingErrors).toEqual([]);
    }
  });

  it('passes silently when canApply is not false and errors is empty', () => {
    const plan = makeMinimalBulkPlan([], true);
    expect(() => assertBulkPlanCanApply(plan)).not.toThrow();
  });
});

function makeEffect(id: string, severity: Effect['severity'], affectedRowCount: number = 1): Effect {
  return {
    id,
    severity,
    category: severity === 'destructive' ? 'destructive' : 'cross-row',
    title: `title-${id}`,
    detail: `detail-${id}`,
    affectedTable: 'coremeasurements',
    affectedRowCount
  };
}
