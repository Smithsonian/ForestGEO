import { describe, it, expect, vi } from 'vitest';
import {
  MeasurementResolutionError,
  resolveMeasurementSummaryQuadratID,
  resolveMeasurementSummaryTree,
  resolveMeasurementSummaryStem
} from './resolvers-mutating';
import type ConnectionManager from '@/config/connectionmanager';

// ---------------------------------------------------------------------------
// Minimal ConnectionManager stub that returns caller-supplied rows.
// ---------------------------------------------------------------------------
function makeConnectionManager(rowSequence: unknown[][]): Pick<ConnectionManager, 'executeQuery'> {
  let callIndex = 0;
  return {
    executeQuery: vi.fn(async () => {
      const rows = rowSequence[callIndex] ?? [];
      callIndex++;
      return rows;
    })
  };
}

const TEST_SCHEMA = 'forestgeo_test';

async function expectMeasurementResolutionError(call: Promise<unknown>): Promise<MeasurementResolutionError> {
  await expect(call).rejects.toBeInstanceOf(MeasurementResolutionError);
  const err = await call.catch((error: unknown) => error);
  expect(err).toBeInstanceOf(MeasurementResolutionError);
  return err as MeasurementResolutionError;
}

// ---------------------------------------------------------------------------
// resolveMeasurementSummaryQuadratID
// ---------------------------------------------------------------------------
describe('resolveMeasurementSummaryQuadratID', () => {
  it('returns QuadratID directly when a valid positive QuadratID is supplied', async () => {
    const cm = makeConnectionManager([]);
    const result = await resolveMeasurementSummaryQuadratID(cm as unknown as ConnectionManager, TEST_SCHEMA, {
      QuadratID: 7,
      QuadratName: 'QTA',
      PlotID: 1
    });
    expect(result).toBe(7);
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('throws MeasurementResolutionError(quadrat, missing) when PlotID is absent', async () => {
    const cm = makeConnectionManager([]);
    const call = resolveMeasurementSummaryQuadratID(cm as unknown as ConnectionManager, TEST_SCHEMA, {
      QuadratID: null,
      QuadratName: 'QTA',
      PlotID: null
    });
    const err = await expectMeasurementResolutionError(call);
    expect(err.subject).toBe('quadrat');
    expect(err.reason).toBe('missing');
    expect(err.message).toBe('Plot not found for quadrat lookup');
  });

  it('throws MeasurementResolutionError(quadrat, missing) when QuadratName is blank', async () => {
    const cm = makeConnectionManager([]);
    const call = resolveMeasurementSummaryQuadratID(cm as unknown as ConnectionManager, TEST_SCHEMA, {
      QuadratID: null,
      QuadratName: '   ',
      PlotID: 3
    });
    const err = await expectMeasurementResolutionError(call);
    expect(err.subject).toBe('quadrat');
    expect(err.reason).toBe('missing');
    expect(err.message).toBe('Quadrat not found for stem resolution');
  });

  it('throws MeasurementResolutionError(quadrat, missing) when the DB returns no matching quadrat', async () => {
    const cm = makeConnectionManager([
      [
        /* empty result set */
      ]
    ]);
    const call = resolveMeasurementSummaryQuadratID(cm as unknown as ConnectionManager, TEST_SCHEMA, {
      QuadratID: null,
      QuadratName: 'NoSuchQuadrat',
      PlotID: 3
    });
    const err = await expectMeasurementResolutionError(call);
    expect(err.subject).toBe('quadrat');
    expect(err.reason).toBe('missing');
    expect(err.message).toBe('Quadrat not found');
  });

  it('returns the QuadratID from the DB when a matching quadrat is found', async () => {
    const cm = makeConnectionManager([[{ QuadratID: 42 }]]);
    const result = await resolveMeasurementSummaryQuadratID(cm as unknown as ConnectionManager, TEST_SCHEMA, {
      QuadratID: null,
      QuadratName: 'QTA',
      PlotID: 3
    });
    expect(result).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// resolveMeasurementSummaryTree
// ---------------------------------------------------------------------------
describe('resolveMeasurementSummaryTree', () => {
  it('throws MeasurementResolutionError(tree, missing) when TreeTag is absent', async () => {
    const cm = makeConnectionManager([]);
    const call = resolveMeasurementSummaryTree(cm as unknown as ConnectionManager, TEST_SCHEMA, {
      TreeTag: null,
      SpeciesID: 5,
      CensusID: 10
    });
    const err = await expectMeasurementResolutionError(call);
    expect(err.subject).toBe('tree');
    expect(err.reason).toBe('missing');
    expect(err.message).toBe('TreeTag not found for tree resolution');
  });

  it('throws MeasurementResolutionError(species, missing) when SpeciesID is null', async () => {
    const cm = makeConnectionManager([]);
    const call = resolveMeasurementSummaryTree(cm as unknown as ConnectionManager, TEST_SCHEMA, {
      TreeTag: 'T100',
      SpeciesID: null,
      CensusID: 10
    });
    const err = await expectMeasurementResolutionError(call);
    expect(err.subject).toBe('species');
    expect(err.reason).toBe('missing');
    expect(err.message).toBe('Species not found for tree resolution');
  });

  it('throws MeasurementResolutionError(tree, inactive) when the matching tree row is inactive', async () => {
    const cm = makeConnectionManager([[{ TreeID: 99, IsActive: 0 }]]);
    const call = resolveMeasurementSummaryTree(cm as unknown as ConnectionManager, TEST_SCHEMA, {
      TreeTag: 'T-INACTIVE',
      SpeciesID: 5,
      CensusID: 10
    });
    const err = await expectMeasurementResolutionError(call);
    expect(err.subject).toBe('tree');
    expect(err.reason).toBe('inactive');
    expect(err.message).toContain('T-INACTIVE');
  });

  it('returns an existing active TreeID without inserting', async () => {
    const cm = makeConnectionManager([[{ TreeID: 77, IsActive: 1 }]]);
    const result = await resolveMeasurementSummaryTree(cm as unknown as ConnectionManager, TEST_SCHEMA, {
      TreeTag: 'T100',
      SpeciesID: 5,
      CensusID: 10
    });
    expect(result).toBe(77);
    expect(cm.executeQuery).toHaveBeenCalledTimes(1);
  });

  it('inserts a new tree row and returns insertId when no match exists', async () => {
    const cm = makeConnectionManager([
      [], // SELECT returns empty
      { insertId: 123 } as unknown as never[] // INSERT result
    ]);
    const result = await resolveMeasurementSummaryTree(cm as unknown as ConnectionManager, TEST_SCHEMA, {
      TreeTag: 'T-BRAND-NEW',
      SpeciesID: 5,
      CensusID: 10
    });
    expect(result).toBe(123);
    expect(cm.executeQuery).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// resolveMeasurementSummaryStem
// ---------------------------------------------------------------------------
describe('resolveMeasurementSummaryStem', () => {
  const BASE_STEM_DATA = {
    TreeID: 10,
    TreeTag: 'T100',
    CensusID: 5,
    StemTag: 'S100A',
    QuadratID: 3,
    StemLocalX: null,
    StemLocalY: null
  };

  it('throws MeasurementResolutionError(stem, missing) when StemTag is absent', async () => {
    const cm = makeConnectionManager([]);
    const call = resolveMeasurementSummaryStem(cm as unknown as ConnectionManager, TEST_SCHEMA, {
      ...BASE_STEM_DATA,
      StemTag: null
    });
    const err = await expectMeasurementResolutionError(call);
    expect(err.subject).toBe('stem');
    expect(err.reason).toBe('missing');
    expect(err.message).toBe('StemTag not found for stem resolution');
  });

  it('throws MeasurementResolutionError(quadrat, missing) when QuadratID is null', async () => {
    const cm = makeConnectionManager([]);
    const call = resolveMeasurementSummaryStem(cm as unknown as ConnectionManager, TEST_SCHEMA, {
      ...BASE_STEM_DATA,
      QuadratID: null
    });
    const err = await expectMeasurementResolutionError(call);
    expect(err.subject).toBe('quadrat');
    expect(err.reason).toBe('missing');
    expect(err.message).toBe('Quadrat not found for stem resolution');
  });

  it('throws MeasurementResolutionError(stem, inactive) when the blocking stem row is inactive', async () => {
    const cm = makeConnectionManager([
      [], // exact-match SELECT → no hit
      [{ StemGUID: 55, QuadratID: 3, IsActive: 0 }] // blocking SELECT → inactive blocker
    ]);
    const call = resolveMeasurementSummaryStem(cm as unknown as ConnectionManager, TEST_SCHEMA, BASE_STEM_DATA);
    const err = await expectMeasurementResolutionError(call);
    expect(err.subject).toBe('stem');
    expect(err.reason).toBe('inactive');
    expect(err.message).toContain('S100A');
  });

  it('throws MeasurementResolutionError(stem, different_quadrat) when the blocking stem is in a different quadrat', async () => {
    const DIFFERENT_QUADRAT_ID = 999;
    const cm = makeConnectionManager([
      [], // exact-match SELECT → no hit
      [{ StemGUID: 66, QuadratID: DIFFERENT_QUADRAT_ID, IsActive: 1 }]
    ]);
    const call = resolveMeasurementSummaryStem(cm as unknown as ConnectionManager, TEST_SCHEMA, BASE_STEM_DATA);
    const err = await expectMeasurementResolutionError(call);
    expect(err.subject).toBe('stem');
    expect(err.reason).toBe('different_quadrat');
    expect(err.message).toContain('T100');
    expect(err.message).toContain('S100A');
  });

  it('returns an existing active StemGUID on an exact match (no insert)', async () => {
    const cm = makeConnectionManager([[{ StemGUID: 88 }]]);
    const result = await resolveMeasurementSummaryStem(cm as unknown as ConnectionManager, TEST_SCHEMA, BASE_STEM_DATA);
    expect(result).toBe(88);
    expect(cm.executeQuery).toHaveBeenCalledTimes(1);
  });

  it('inserts a new stem row and returns insertId when no blocking row exists', async () => {
    const cm = makeConnectionManager([
      [], // exact-match SELECT → no hit
      [], // blocking SELECT → no blocker
      { insertId: 200 } as unknown as never[] // INSERT result
    ]);
    const result = await resolveMeasurementSummaryStem(cm as unknown as ConnectionManager, TEST_SCHEMA, BASE_STEM_DATA);
    expect(result).toBe(200);
    expect(cm.executeQuery).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// MeasurementResolutionError class invariants
// ---------------------------------------------------------------------------
describe('MeasurementResolutionError', () => {
  it('is an instance of Error', () => {
    const err = new MeasurementResolutionError('tree', 'missing', 'some message');
    expect(err).toBeInstanceOf(Error);
  });

  it('carries the subject and reason tuple', () => {
    const err = new MeasurementResolutionError('stem', 'different_quadrat', 'stem in wrong quadrat');
    expect(err.subject).toBe('stem');
    expect(err.reason).toBe('different_quadrat');
    expect(err.message).toBe('stem in wrong quadrat');
    expect(err.name).toBe('MeasurementResolutionError');
  });
});
