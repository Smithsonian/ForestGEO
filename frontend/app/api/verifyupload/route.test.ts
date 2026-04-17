import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager';

const { loggerInfo, loggerError } = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerError: vi.fn()
}));

vi.mock('@/config/connectionmanager', () => {
  const executeQuery = vi.fn();
  const closeConnection = vi.fn().mockResolvedValue(undefined);
  const instance = { executeQuery, closeConnection };
  return {
    default: {
      getInstance: () => instance
    }
  };
});

vi.mock('@/config/utils/sqlsecurity', () => ({
  safeFormatQuery: vi.fn((schema: string, sql: string) => sql.replace(/\?\?/g, schema))
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: loggerInfo,
    error: loggerError,
    warn: vi.fn()
  }
}));

function makeRequest(query: Record<string, string>) {
  const url = new URL('http://localhost/api/verifyupload');
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  const req = new Request(url.toString(), { method: 'GET' }) as any;
  req.nextUrl = url;
  return req;
}

describe('GET /api/verifyupload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verifies a specific batch when batchID is provided', async () => {
    const cm = ConnectionManager.getInstance() as any;
    cm.executeQuery.mockResolvedValueOnce([{ count: 131 }]);

    const res = await GET(
      makeRequest({
        schema: 'forestgeo_testing',
        fileName: 'SERC_census4_2025(1).csv',
        batchID: 'batch-131',
        plotID: '22',
        censusID: '6'
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      count: 131,
      fileName: 'SERC_census4_2025(1).csv',
      batchID: 'batch-131',
      scope: 'batch',
      schema: 'forestgeo_testing',
      plotID: '22',
      censusID: '6',
      verified: true
    });

    expect(String(cm.executeQuery.mock.calls[0][0])).toContain('BatchID = ?');
    expect(cm.executeQuery.mock.calls[0][1]).toEqual(['SERC_census4_2025(1).csv', 'batch-131', '22', '6']);
    expect(cm.closeConnection).toHaveBeenCalledTimes(1);
  });

  it('falls back to file-level verification when batchID is absent', async () => {
    const cm = ConnectionManager.getInstance() as any;
    cm.executeQuery.mockResolvedValueOnce([{ count: 33430 }]);

    const res = await GET(
      makeRequest({
        schema: 'forestgeo_testing',
        fileName: 'SERC_census1_2025.csv',
        plotID: '22',
        censusID: '3'
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope).toBe('file');
    expect(body.batchID).toBeNull();
    expect(String(cm.executeQuery.mock.calls[0][0])).not.toContain('BatchID = ?');
    expect(cm.executeQuery.mock.calls[0][1]).toEqual(['SERC_census1_2025.csv', '22', '3']);
    expect(cm.closeConnection).toHaveBeenCalledTimes(1);
  });
});
