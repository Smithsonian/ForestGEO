import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  startRun: vi.fn(),
  poolInstance: { pool: {} }
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/provisioning/orchestrator', () => ({ startRun: mocks.startRun }));
vi.mock('@/config/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: () => mocks.poolInstance
}));

import { POST } from './route';

const VALID_INPUT = {
  site: {
    siteName: 'Test Forest',
    schemaName: 'forestgeo_test_forest',
    sqDimX: 20,
    sqDimY: 20,
    defaultUOMDBH: 'mm',
    defaultUOMHOM: 'm',
    doubleDataEntry: false,
    location: 'Panama',
    country: 'Panama'
  },
  plot: {
    plotName: 'Main Plot',
    dimensionX: 500,
    dimensionY: 500,
    area: 250000,
    globalX: 0,
    globalY: 0,
    globalZ: 0,
    plotShape: 'square' as const,
    description: 'Primary research plot',
    defaultDimensionUnits: 'm',
    defaultCoordinateUnits: 'm',
    defaultAreaUnits: 'm2',
    defaultDBHUnits: 'mm',
    defaultHOMUnits: 'm'
  },
  quadrats: {
    mode: 'grid' as const,
    quadratSizeX: 20,
    quadratSizeY: 20,
    namingPattern: 'sequential' as const
  }
};

function makePostRequest(body: unknown): Request {
  return new Request('http://localhost/api/admin/provision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function makeRawBodyRequest(rawBody: string): Request {
  return new Request('http://localhost/api/admin/provision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody
  });
}

describe('POST /api/admin/provision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when there is no session', async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await POST(makePostRequest(VALID_INPUT));

    expect(res.status).toBe(401);
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it('returns 403 when the authenticated user is not global (db admin role)', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'dbadmin@example.com', userStatus: 'db admin' } });

    const res = await POST(makePostRequest(VALID_INPUT));

    expect(res.status).toBe(403);
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it('returns 403 when the authenticated user is a field crew member', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'crew@example.com', userStatus: 'field crew' } });

    const res = await POST(makePostRequest(VALID_INPUT));

    expect(res.status).toBe(403);
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it('returns 400 with error details when the JSON body is malformed', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'admin@example.com', userStatus: 'global' } });

    const res = await POST(makeRawBodyRequest('not valid json {{{'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toHaveProperty('error');
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it('returns 400 with a structured errors array when the schema validation fails', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'admin@example.com', userStatus: 'global' } });

    const invalidInput = {
      site: {
        siteName: '',
        schemaName: 'INVALID_SCHEMA_NAME',
        sqDimX: -1,
        sqDimY: 20,
        defaultUOMDBH: 'mm',
        defaultUOMHOM: 'm',
        doubleDataEntry: false,
        location: 'Panama',
        country: 'Panama'
      },
      plot: VALID_INPUT.plot,
      quadrats: VALID_INPUT.quadrats
    };

    const res = await POST(makePostRequest(invalidInput));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toHaveProperty('errors');
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0]).toHaveProperty('field');
    expect(body.errors[0]).toHaveProperty('message');
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it('returns 202 with runId when a global admin submits valid provisioning input', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'admin@example.com', userStatus: 'global' } });
    mocks.startRun.mockResolvedValue({ runId: 42 });

    const res = await POST(makePostRequest(VALID_INPUT));
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toEqual({ runId: 42 });
    expect(mocks.startRun).toHaveBeenCalledOnce();
    expect(mocks.startRun).toHaveBeenCalledWith({
      input: expect.objectContaining({ site: expect.objectContaining({ schemaName: 'forestgeo_test_forest' }) }),
      startedBy: 'admin@example.com',
      catalogPool: mocks.poolInstance.pool
    });
  });

  it('returns 409 when startRun throws because a run is already in progress for that schema', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'admin@example.com', userStatus: 'global' } });
    mocks.startRun.mockRejectedValue(new Error('A provisioning run is already in progress for schema forestgeo_test_forest'));

    const res = await POST(makePostRequest(VALID_INPUT));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('already in progress');
  });
});
