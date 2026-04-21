import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeEdit, DisallowedFieldError, TargetNotFoundError } from './analyzer';
import { analyzeBulk } from './bulkanalyzer';
import { applyDuplicateRules } from './rules/duplicates';
import { Effect } from './types';

vi.mock('./rules/species', () => ({
  applySpeciesRules: vi.fn(async () => [])
}));
vi.mock('./rules/treestem', () => ({
  applyTreeStemRules: vi.fn(async () => [])
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
  vi.mocked(applyTreeStemRules).mockResolvedValue([]);
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
    await expect(
      analyzeEdit(cm, SCHEMA, 'measurementssummary', PLOT_ID, CENSUS_ID, TARGET_ID, { MeasuredDBH: 16 })
    ).rejects.toBeInstanceOf(TargetNotFoundError);
  });

  it('binds plotID and censusID into the lookup query so out-of-scope targets are rejected', async () => {
    const cm = makeConnectionManager(null);
    await expect(
      analyzeEdit(cm, SCHEMA, 'measurementssummary', 999, 888, TARGET_ID, { MeasuredDBH: 16 })
    ).rejects.toBeInstanceOf(TargetNotFoundError);
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
});

describe('applyDuplicateRules (R6)', () => {
  it('returns [] when count <= 0', () => {
    expect(applyDuplicateRules(0)).toEqual([]);
    expect(applyDuplicateRules(-1)).toEqual([]);
  });

  it('returns a single destructive R6 effect when count > 0', () => {
    const effects = applyDuplicateRules(3);
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
      duplicateMeasurementIDsToDelete: [101, 102]
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

  it('aggregates affectedRowCount across repeated effect ids using max severity', async () => {
    const cm = makeConnectionManager(MEASUREMENT_OLD_ROW);
    const calls: Array<ReturnType<typeof makeEffect>[]> = [
      [makeEffect('R4', 'info', 3)],
      [makeEffect('R4', 'warn', 5)]
    ];
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
