import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertCanEditMeasurementScope, assertNoActiveMeasurementScopeConflict, ScopeAccessError, ScopeBusyError } from './scopeguard';

vi.mock('@/config/uploadsessiontracker', () => ({
  ACTIVE_UPLOAD_SESSION_STATES: ['initialized', 'uploading', 'uploaded', 'processing', 'collapsing'],
  SESSION_TIMEOUTS: {
    HEARTBEAT_TIMEOUT: 90_000
  }
}));

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      userStatus: 'site',
      sites: [{ schemaName: 'forestgeo_testing' }],
      ...overrides
    }
  } as any;
}

function makeConnectionManager() {
  return {
    executeQuery: vi.fn()
  } as any;
}

describe('assertCanEditMeasurementScope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects users without access to the requested schema before touching the database', async () => {
    const cm = makeConnectionManager();
    const session = makeSession({ sites: [{ schemaName: 'forestgeo_other' }] });

    await expect(
      assertCanEditMeasurementScope(cm, session, {
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2
      })
    ).rejects.toBeInstanceOf(ScopeAccessError);
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('allows global users after the plot/census existence check passes', async () => {
    const cm = makeConnectionManager();
    cm.executeQuery.mockResolvedValueOnce([{ ok: 1 }]);

    await expect(
      assertCanEditMeasurementScope(cm, makeSession({ userStatus: 'global', sites: [] }), {
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2
      })
    ).resolves.toBeUndefined();

    expect(cm.executeQuery).toHaveBeenCalledTimes(1);
    expect(cm.executeQuery.mock.calls[0][0]).toContain('FROM `forestgeo_testing`.census');
  });

  it('rejects unavailable plot/census scopes', async () => {
    const cm = makeConnectionManager();
    cm.executeQuery.mockResolvedValueOnce([]);

    await expect(
      assertCanEditMeasurementScope(cm, makeSession(), {
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2
      })
    ).rejects.toBeInstanceOf(ScopeAccessError);
  });
});

describe('assertNoActiveMeasurementScopeConflict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves when neither upload sessions nor validation runs are active', async () => {
    const cm = makeConnectionManager();
    cm.executeQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(
      assertNoActiveMeasurementScopeConflict(cm, {
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2
      })
    ).resolves.toBeUndefined();

    expect(cm.executeQuery).toHaveBeenCalledTimes(2);
    expect(cm.executeQuery.mock.calls[0][0]).toContain('FROM `forestgeo_testing`.upload_sessions');
    expect(cm.executeQuery.mock.calls[1][0]).toContain('FROM `forestgeo_testing`.validation_runs');
  });

  it('rejects active upload sessions in the requested scope', async () => {
    const cm = makeConnectionManager();
    cm.executeQuery.mockResolvedValueOnce([{ session_id: 'upload-1' }]);

    await expect(
      assertNoActiveMeasurementScopeConflict(cm, {
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2
      })
    ).rejects.toThrow(ScopeBusyError);
  });

  it('rejects fresh running validation runs in the requested scope', async () => {
    const cm = makeConnectionManager();
    cm.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ RunID: 99, StartedAt: new Date().toISOString() }]);

    await expect(
      assertNoActiveMeasurementScopeConflict(cm, {
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2
      })
    ).rejects.toThrow(ScopeBusyError);
  });

  it('ignores missing optional activity tables for legacy schemas', async () => {
    const cm = makeConnectionManager();
    const missingTable = Object.assign(new Error("Table 'forestgeo_testing.upload_sessions' doesn't exist"), {
      code: 'ER_NO_SUCH_TABLE'
    });
    cm.executeQuery.mockRejectedValueOnce(missingTable).mockRejectedValueOnce(missingTable);

    await expect(
      assertNoActiveMeasurementScopeConflict(cm, {
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 2
      })
    ).resolves.toBeUndefined();
  });
});
