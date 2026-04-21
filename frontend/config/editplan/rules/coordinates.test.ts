import { describe, it, expect, vi } from 'vitest';
import { applyCoordinateRules } from './coordinates';

const STEM_GUID = 42;
const SHARED_COUNT = 4;

function makeCtx(overrides: Partial<Parameters<typeof applyCoordinateRules>[0]> = {}) {
  const cm = {
    executeQuery: vi.fn(async () => [{ cnt: SHARED_COUNT }])
  } as any;
  return {
    cm,
    schema: 's',
    dataType: 'measurementssummary' as const,
    plotID: 1,
    censusID: 1,
    oldRow: { StemGUID: STEM_GUID, StemLocalX: 12.0, StemLocalY: 34.0 },
    newRow: { StemLocalX: 14.0 },
    changedFields: new Set(['StemLocalX']),
    ...overrides
  };
}

describe('applyCoordinateRules', () => {
  it('no effect when neither X nor Y changed', async () => {
    const ctx = makeCtx({ changedFields: new Set() });
    expect(await applyCoordinateRules(ctx)).toEqual([]);
    expect((ctx.cm as any).executeQuery).not.toHaveBeenCalled();
  });

  it('emits R4 when only StemLocalX changed', async () => {
    const ctx = makeCtx({ changedFields: new Set(['StemLocalX']) });
    const effects = await applyCoordinateRules(ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].id).toBe('R4');
    expect(effects[0].severity).toBe('warn');
    expect(effects[0].category).toBe('cross-row');
    expect(effects[0].affectedTable).toBe('stems');
    expect(effects[0].affectedRowCount).toBe(SHARED_COUNT);
    expect(effects[0].references?.stemGUIDs).toEqual([STEM_GUID]);
  });

  it('emits R4 when only StemLocalY changed', async () => {
    const ctx = makeCtx({
      newRow: { StemLocalY: 99.0 },
      changedFields: new Set(['StemLocalY'])
    });
    const effects = await applyCoordinateRules(ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].id).toBe('R4');
    expect(effects[0].affectedRowCount).toBe(SHARED_COUNT);
  });

  it('emits a single R4 when both X and Y change', async () => {
    const ctx = makeCtx({
      newRow: { StemLocalX: 11.0, StemLocalY: 22.0 },
      changedFields: new Set(['StemLocalX', 'StemLocalY'])
    });
    const effects = await applyCoordinateRules(ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].id).toBe('R4');
    expect(effects[0].affectedRowCount).toBe(SHARED_COUNT);
    expect((ctx.cm as any).executeQuery).toHaveBeenCalledTimes(1);
  });

  it('no effect when StemGUID on oldRow is null (failedmeasurements / unresolved)', async () => {
    const ctx = makeCtx({
      oldRow: { StemGUID: null, StemLocalX: 12.0 },
      changedFields: new Set(['StemLocalX'])
    });
    expect(await applyCoordinateRules(ctx)).toEqual([]);
    expect((ctx.cm as any).executeQuery).not.toHaveBeenCalled();
  });

  it('no effect when StemGUID on oldRow is undefined', async () => {
    const ctx = makeCtx({
      oldRow: { StemLocalX: 12.0 },
      changedFields: new Set(['StemLocalX'])
    });
    expect(await applyCoordinateRules(ctx)).toEqual([]);
    expect((ctx.cm as any).executeQuery).not.toHaveBeenCalled();
  });

  it('passes stemGUID and schema into executeQuery', async () => {
    const ctx = makeCtx();
    await applyCoordinateRules(ctx);
    const callArgs = (ctx.cm as any).executeQuery.mock.calls[0];
    expect(callArgs[0]).toContain('s.coremeasurements');
    expect(callArgs[0]).toContain('StemGUID = ?');
    expect(callArgs[1]).toEqual([STEM_GUID]);
  });

  it('handles count of 0 rows gracefully', async () => {
    const cm = { executeQuery: vi.fn(async () => [{ cnt: 0 }]) } as any;
    const ctx = makeCtx({ cm });
    const effects = await applyCoordinateRules(ctx);
    expect(effects[0].affectedRowCount).toBe(0);
  });
});
