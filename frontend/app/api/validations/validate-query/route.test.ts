import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';

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
