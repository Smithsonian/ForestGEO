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
    mockExecuteQuery
      .mockResolvedValueOnce([{ count: 5 }])
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ count: 0 }]);

    const response = await GET(makeRequest('http://localhost/api/verifysession?schema=myschema&plotID=1&censusID=2&fileID=file-a.csv'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      processedCount: 5,
      failedCount: 2,
      remainingCount: 1,
      totalAccounted: 7,
      scope: 'file',
      fileID: 'file-a.csv',
      legacyRowsDetected: false,
      mixedMetadataState: false
    });

    expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
    expect(String(mockExecuteQuery.mock.calls[0][0])).toContain('cm.UploadFileID = ?');
    expect(String(mockExecuteQuery.mock.calls[0][0])).not.toContain('JSON_EXTRACT');
    expect(String(mockExecuteQuery.mock.calls[2][0])).toContain('temporarymeasurements');
    expect(String(mockExecuteQuery.mock.calls[3][0])).toContain('cm.UploadFileID IS NULL');
  });

  it('sums direct and legacy uploadSession JSON rows when metadata is mixed', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ count: 4 }])
      .mockResolvedValueOnce([{ count: 3 }]);

    const response = await GET(makeRequest('http://localhost/api/verifysession?schema=myschema&plotID=1&censusID=2&fileID=file-a.csv&batchID=batch-1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      processedCount: 5,
      failedCount: 1,
      remainingCount: 0,
      totalAccounted: 6,
      scope: 'batch',
      fileID: 'file-a.csv',
      batchID: 'batch-1',
      legacyRowsDetected: true,
      mixedMetadataState: true
    });

    expect(mockExecuteQuery).toHaveBeenCalledTimes(5);
    expect(String(mockExecuteQuery.mock.calls[0][0])).toContain("cm.UploadBatchID LIKE CONCAT(?, '__sub%')");
    expect(String(mockExecuteQuery.mock.calls[2][0])).toContain("tm.BatchID LIKE CONCAT(?, '__sub%')");
    expect(String(mockExecuteQuery.mock.calls[3][0])).toContain('cm.UploadFileID IS NULL OR cm.UploadBatchID IS NULL');
    expect(String(mockExecuteQuery.mock.calls[4][0])).toContain('JSON_UNQUOTE(JSON_EXTRACT');
  });
});
