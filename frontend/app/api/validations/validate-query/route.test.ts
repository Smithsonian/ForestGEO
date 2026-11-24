import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';

const ROUTE_CONTEXT = { params: Promise.resolve({}) };

// Route is now wrapped by withRouteAuthz, so auth() runs before the handler.
// A 'global' admin passes the per-site access gate.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { userStatus: 'global', sites: [] } }))
}));

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}));

vi.mock('@/lib/db/connectionmanager', async () => {
  const actual = await vi.importActual<any>('@/lib/db/connectionmanager').catch(() => ({}));

  const instance = {
    executeQuery: vi.fn(async () => []),
    closeConnection: vi.fn(async () => {})
  };

  return {
    ...actual,
    default: {
      ...(actual?.default ?? {}),
      getInstance: vi.fn(() => instance)
    }
  };
});

function makeRequest(schema: string, query: string) {
  const request = new Request(`http://localhost/api/validations/validate-query?schema=${schema}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query })
  }) as any;
  request.nextUrl = new URL(`http://localhost/api/validations/validate-query?schema=${schema}`);
  request.json = async () => ({ query });
  return request;
}

describe('POST /api/validations/validate-query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts schema-prefixed stored procedure calls for the selected schema', async () => {
    const connectionManager = (ConnectionManager as any).getInstance();
    const executeQuery = vi.spyOn(connectionManager, 'executeQuery');
    vi.spyOn(connectionManager, 'closeConnection').mockResolvedValue(undefined);

    executeQuery.mockResolvedValueOnce([{ ROUTINE_NAME: 'RunSharedCrossCensusLocationValidations' }]).mockResolvedValueOnce([]);

    const response = await POST(
      makeRequest('forestgeo_testing', 'CALL forestgeo_testing.RunSharedCrossCensusLocationValidations(@p_CensusID, @p_PlotID, 1, 0)'),
      ROUTE_CONTEXT
    );

    expect(response.status).toBe(HTTPResponses.OK);
    await expect(response.json()).resolves.toEqual({
      isValid: true,
      errors: [],
      warnings: []
    });

    expect(executeQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('FROM INFORMATION_SCHEMA.ROUTINES'), [
      'forestgeo_testing',
      'RunSharedCrossCensusLocationValidations'
    ]);
  });

  it('hides a connection failure behind a fixed message instead of reporting it as a query error', async () => {
    const connectionManager = (ConnectionManager as any).getInstance();
    const transportFailure = Object.assign(new Error('connect ETIMEDOUT forestgeo-secret-host.mysql.database.azure.com:3306'), {
      code: 'ETIMEDOUT',
      sqlMessage: undefined
    });
    vi.spyOn(connectionManager, 'executeQuery').mockRejectedValueOnce(transportFailure).mockResolvedValue([]);
    vi.spyOn(connectionManager, 'closeConnection').mockResolvedValue(undefined);

    const response = await POST(makeRequest('forestgeo_testing', 'SELECT * FROM species'), ROUTE_CONTEXT);
    const text = await response.text();
    console.log('[validate-query transport failure]', response.status, text);

    const body = JSON.parse(text);
    expect(body.isValid).toBe(false);
    expect(body.errors[0]).toMatch(/could not be checked right now/);
    expect(text).not.toContain('forestgeo-secret-host');
    expect(ailogger.error).toHaveBeenCalledWith('Query validation could not run:', transportFailure);
  });

  it('hides a failure in the server-owned routine lookup for a CALL', async () => {
    const connectionManager = (ConnectionManager as any).getInstance();
    const lookupFailure = Object.assign(new Error("SELECT command denied to user 'app'@'%' for table 'ROUTINES'"), {
      sqlMessage: "SELECT command denied to user 'app'@'%' for table 'ROUTINES'"
    });
    vi.spyOn(connectionManager, 'executeQuery').mockRejectedValueOnce(lookupFailure).mockResolvedValue([]);
    vi.spyOn(connectionManager, 'closeConnection').mockResolvedValue(undefined);

    const response = await POST(makeRequest('forestgeo_testing', 'CALL RunSharedCrossCensusLocationValidations(@p_CensusID, @p_PlotID, 1, 0)'), ROUTE_CONTEXT);
    const text = await response.text();
    console.log('[validate-query routine lookup failure]', response.status, text);

    expect(JSON.parse(text).errors[0]).toMatch(/could not be checked right now/);
    expect(text).not.toContain('command denied');
  });

  it("still explains MySQL's reply about the user's own query", async () => {
    const connectionManager = (ConnectionManager as any).getInstance();
    const unknownColumn = Object.assign(new Error("Unknown column 'dbhh' in 'field list'"), { sqlMessage: "Unknown column 'dbhh' in 'field list'" });
    vi.spyOn(connectionManager, 'executeQuery').mockRejectedValueOnce(unknownColumn).mockResolvedValue([]);
    vi.spyOn(connectionManager, 'closeConnection').mockResolvedValue(undefined);

    const response = await POST(makeRequest('forestgeo_testing', 'SELECT dbhh FROM coremeasurements'), ROUTE_CONTEXT);
    const body = await response.json();
    console.log('[validate-query unknown column]', response.status, JSON.stringify(body));

    expect(body.isValid).toBe(false);
    expect(body.errors[0]).toBe("Column 'dbhh' does not exist");
  });

  it('rejects schema-prefixed calls that target a different schema', async () => {
    const connectionManager = (ConnectionManager as any).getInstance();
    vi.spyOn(connectionManager, 'closeConnection').mockResolvedValue(undefined);

    const response = await POST(
      makeRequest('forestgeo_testing', 'CALL other_schema.RunSharedCrossCensusLocationValidations(@p_CensusID, @p_PlotID, 1, 0)'),
      ROUTE_CONTEXT
    );

    expect(response.status).toBe(HTTPResponses.OK);
    await expect(response.json()).resolves.toEqual({
      isValid: false,
      errors: ["Stored procedure call targets schema 'other_schema', but the selected schema is 'forestgeo_testing'"],
      warnings: []
    });
  });
});
