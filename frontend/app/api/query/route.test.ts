import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  executeQuery: vi.fn(),
  loggerError: vi.fn()
}));

vi.mock('@/auth', () => ({
  auth: mocks.auth
}));

vi.mock('@/config/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      executeQuery: mocks.executeQuery
    })
  }
}));

vi.mock('@/ailogger', () => ({
  default: {
    error: mocks.loggerError
  }
}));

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/query', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as any;
}

describe('POST /api/query authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeQuery.mockResolvedValue([{ ok: 1 }]);
    mocks.auth.mockResolvedValue({
      user: {
        email: 'field@example.com',
        userStatus: 'field crew',
        sites: [{ schemaName: 'forestgeo_testing' }],
        allsites: []
      }
    });
  });

  it('rejects unauthenticated callers', async () => {
    mocks.auth.mockResolvedValueOnce(null);

    const response = await POST(makeRequest('SELECT * FROM forestgeo_testing.attributes'));

    expect(response.status).toBe(401);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects callers when permissions are unavailable', async () => {
    mocks.auth.mockResolvedValueOnce({ user: { email: 'field@example.com', permissionsUnavailable: true, sites: [], allsites: [] } });

    const response = await POST(makeRequest('SELECT * FROM forestgeo_testing.attributes'));

    expect(response.status).toBe(503);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('allows non-admin read-only SQL scoped to an assigned site schema', async () => {
    const response = await POST(makeRequest('SELECT * FROM forestgeo_testing.attributes'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ ok: 1 }]);
    expect(mocks.executeQuery).toHaveBeenCalledWith('SELECT * FROM forestgeo_testing.attributes');
  });

  it('rejects non-admin write SQL even when the schema is assigned', async () => {
    const response = await POST(
      makeRequest({
        query: 'DELETE FROM ??.temporarymeasurements WHERE PlotID = ?',
        params: ['forestgeo_testing', 1],
        format: true
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects non-admin SQL against unassigned schemas', async () => {
    const response = await POST(makeRequest('SELECT * FROM forestgeo_other.attributes'));

    expect(response.status).toBe(403);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('allows administrators to execute formatted write SQL', async () => {
    mocks.auth.mockResolvedValueOnce({
      user: {
        email: 'admin@example.com',
        userStatus: 'db admin',
        sites: [],
        allsites: []
      }
    });

    const response = await POST(
      makeRequest({
        query: 'DELETE FROM ??.temporarymeasurements WHERE PlotID = ?',
        params: ['forestgeo_testing', 1],
        format: true
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.executeQuery).toHaveBeenCalledWith('DELETE FROM `forestgeo_testing`.temporarymeasurements WHERE PlotID = 1');
  });
});
