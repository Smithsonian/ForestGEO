import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecuteQuery = vi.fn();
const mockCloseConnection = vi.fn(async () => {});

vi.mock('@/config/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      executeQuery: mockExecuteQuery,
      closeConnection: mockCloseConnection
    })
  }
}));

vi.mock('@/config/utils/sqlsecurity', () => ({
  safeFormatQuery: vi.fn((_schema: string, query: string) => query)
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import { GET } from './route';

function makeRequest(url: string): any {
  const request: any = new Request(url);
  request.nextUrl = new URL(url);
  return request;
}

describe('verifysession route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses direct upload tracking columns on the fast path for file verification', async () => {
    mockExecuteQuery.mockResolvedValueOnce([{ count: 5 }]).mockResolvedValueOnce([{ count: 2 }]);

    const response = await GET(makeRequest('http://localhost/api/verifysession?schema=myschema&plotID=1&censusID=2&fileID=file-a.csv'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      processedCount: 5,
      failedCount: 2,
      totalAccounted: 7,
      scope: 'file',
      fileID: 'file-a.csv'
    });

    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
    expect(String(mockExecuteQuery.mock.calls[0][0])).toContain('cm.UploadFileID = ?');
    expect(String(mockExecuteQuery.mock.calls[0][0])).not.toContain('JSON_EXTRACT');
  });

  it('falls back to legacy uploadSession JSON fields only when direct matches are absent', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ count: 4 }]);

    const response = await GET(makeRequest('http://localhost/api/verifysession?schema=myschema&plotID=1&censusID=2&fileID=file-a.csv&batchID=batch-1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      processedCount: 4,
      failedCount: 1,
      totalAccounted: 5,
      scope: 'batch',
      fileID: 'file-a.csv',
      batchID: 'batch-1'
    });

    expect(mockExecuteQuery).toHaveBeenCalledTimes(3);
    expect(String(mockExecuteQuery.mock.calls[0][0])).toContain('cm.UploadBatchID = ?');
    expect(String(mockExecuteQuery.mock.calls[2][0])).toContain('JSON_EXTRACT');
  });
});
