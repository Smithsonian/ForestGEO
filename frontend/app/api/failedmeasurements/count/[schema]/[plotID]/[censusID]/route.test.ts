import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAuth, mockExecuteQuery, mockCloseConnection, mockLoggerError } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockExecuteQuery: vi.fn(),
  mockCloseConnection: vi.fn(),
  mockLoggerError: vi.fn()
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      executeQuery: mockExecuteQuery,
      closeConnection: mockCloseConnection
    })
  }
}));

vi.mock('@/config/measurementerrors', () => ({
  buildFailedMeasurementsSelectQuery: vi.fn(() => 'SELECT * FROM failed_measurements_source')
}));

vi.mock('@/ailogger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: mockLoggerError }
}));

import { GET } from './route';

function request(schema = 'forestgeo_testing', plotID = '7', censusID = '3') {
  return GET(new Request('http://localhost/api/failedmeasurements/count') as any, {
    params: Promise.resolve({ schema, plotID, censusID })
  });
}

describe('failed-measurement count route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: { userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_testing' }] }
    });
    mockExecuteQuery.mockResolvedValue([{ total: 4 }]);
    mockCloseConnection.mockResolvedValue(undefined);
  });

  it('allows a non-admin site member to read the scoped count', async () => {
    const response = await request();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recordCount: 4 });
    expect(mockExecuteQuery).toHaveBeenCalledWith(expect.stringContaining('failed.PlotID = ? AND failed.CensusID = ?'), [7, 3]);
    expect(mockCloseConnection).toHaveBeenCalledTimes(1);
  });

  it('rejects a site outside the user scope before querying', async () => {
    const response = await request('forestgeo_panama');

    expect(response.status).toBe(403);
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['1abc', '3'],
    ['0', '3'],
    ['7', '-1']
  ])('rejects invalid numeric scope values %s/%s', async (plotID, censusID) => {
    const response = await request('forestgeo_testing', plotID, censusID);

    expect(response.status).toBe(400);
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  it('returns a generic error and still closes the connection when the query fails', async () => {
    mockExecuteQuery.mockRejectedValueOnce(new Error('database details'));

    const response = await request();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to count failed measurements' });
    expect(mockLoggerError).toHaveBeenCalled();
    expect(mockCloseConnection).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the database returns an invalid count', async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ total: -1 }]);

    const response = await request();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to count failed measurements' });
  });
});
