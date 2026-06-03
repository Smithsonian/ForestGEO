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

  it('rejects comma-join reads that reference an unassigned schema after an assigned one', async () => {
    const response = await POST(makeRequest('SELECT t.Code, o.Code FROM forestgeo_testing.attributes t, forestgeo_other.attributes o WHERE t.Code = o.Code'));

    expect(response.status).toBe(403);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('does not treat schema-looking string literals as schema references', async () => {
    const response = await POST(makeRequest("SELECT * FROM forestgeo_testing.attributes WHERE Description = 'forestgeo_other.attributes'"));

    expect(response.status).toBe(200);
    expect(mocks.executeQuery).toHaveBeenCalledWith("SELECT * FROM forestgeo_testing.attributes WHERE Description = 'forestgeo_other.attributes'");
  });

  it('still rejects multiple statements when a string literal contains comment syntax', async () => {
    const response = await POST(
      makeRequest("SELECT * FROM forestgeo_testing.attributes WHERE Description = '-- not a comment'; SELECT * FROM forestgeo_testing.attributes")
    );

    expect(response.status).toBe(403);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects non-admin SELECT statements that write server-side files', async () => {
    const response = await POST(makeRequest("SELECT * FROM forestgeo_testing.attributes INTO OUTFILE '/tmp/attributes.csv'"));

    expect(response.status).toBe(403);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects non-admin SELECT statements that read server-side files via LOAD_FILE()', async () => {
    const response = await POST(makeRequest("SELECT LOAD_FILE('/etc/passwd') FROM forestgeo_testing.attributes LIMIT 1"));

    expect(response.status).toBe(403);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects non-admin SELECT statements that acquire shared row locks via FOR SHARE', async () => {
    const response = await POST(makeRequest('SELECT * FROM forestgeo_testing.attributes WHERE Code = 1 FOR SHARE'));

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

  // Regression: a non-admin read-only SELECT must not be rejected merely because
  // it is newline-formatted, parenthesised, or expressed as a CTE.
  it('allows non-admin newline-formatted read-only SELECT scoped to an assigned schema', async () => {
    const response = await POST(makeRequest('SELECT\n  *\nFROM forestgeo_testing.attributes'));

    expect(response.status).toBe(200);
    expect(mocks.executeQuery).toHaveBeenCalledWith('SELECT\n  *\nFROM forestgeo_testing.attributes');
  });

  it('allows non-admin parenthesised read-only SELECT scoped to an assigned schema', async () => {
    const response = await POST(makeRequest('(SELECT * FROM forestgeo_testing.attributes)'));

    expect(response.status).toBe(200);
    expect(mocks.executeQuery).toHaveBeenCalledTimes(1);
  });

  it('allows non-admin CTE (WITH ... SELECT) reads scoped to an assigned schema', async () => {
    const response = await POST(makeRequest('WITH recent AS (SELECT * FROM forestgeo_testing.coremeasurements) SELECT * FROM recent'));

    expect(response.status).toBe(200);
    expect(mocks.executeQuery).toHaveBeenCalledTimes(1);
  });

  // Guard: broadening the read check must NOT let a CTE that resolves to a write through.
  it('rejects a non-admin CTE that resolves to a write (WITH ... DELETE)', async () => {
    const response = await POST(
      makeRequest(
        'WITH doomed AS (SELECT CoreMeasurementID FROM forestgeo_testing.coremeasurements) DELETE FROM forestgeo_testing.coremeasurements WHERE CoreMeasurementID IN (SELECT CoreMeasurementID FROM doomed)'
      )
    );

    expect(response.status).toBe(403);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  // Regression: schema-qualified references outside the `forestgeo_*` prefix (the
  // base `forestgeo` schema) must still be subject to the ownership check.
  it('rejects non-admin reads that join an unowned non-prefixed schema (base forestgeo)', async () => {
    const response = await POST(makeRequest('SELECT a.Code, u.Email FROM forestgeo_testing.attributes a JOIN forestgeo.users u ON 1 = 1'));

    expect(response.status).toBe(403);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });
});
