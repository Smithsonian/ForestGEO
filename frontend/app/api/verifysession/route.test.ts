import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route is now wrapped by withRouteAuthz, so auth() runs before the handler.
// A 'global' admin passes the per-site access gate.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { userStatus: 'global', sites: [] } }))
}));

const mockExecuteQuery = vi.fn();
const mockCloseConnection = vi.fn(async () => {});

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      executeQuery: mockExecuteQuery,
      closeConnection: mockCloseConnection
    })
  }
}));

vi.mock('@/lib/db/sqlsecurity', () => ({
  isValidSchema: vi.fn(() => true),
  safeFormatQuery: vi.fn((_schema: string, query: string) => query)
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import { INGESTION_ERROR_SOURCE } from '@/config/measurementerrors';
import { buildSubBatchPattern, LIKE_ESCAPE_CLAUSE } from '@/lib/uploads/batch-family';
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

    const response = await GET(makeRequest('http://localhost/api/verifysession?schema=myschema&plotID=1&censusID=2&fileID=file-a.csv'), {
      params: Promise.resolve({})
    });

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

    const response = await GET(makeRequest('http://localhost/api/verifysession?schema=myschema&plotID=1&censusID=2&fileID=file-a.csv&batchID=batch-1'), {
      params: Promise.resolve({})
    });

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
    expect(String(mockExecuteQuery.mock.calls[0][0])).toContain(`cm.UploadBatchID LIKE ? ${LIKE_ESCAPE_CLAUSE}`);
    expect(String(mockExecuteQuery.mock.calls[2][0])).toContain(`tm.BatchID LIKE ? ${LIKE_ESCAPE_CLAUSE}`);
    expect(String(mockExecuteQuery.mock.calls[3][0])).toContain('cm.UploadFileID IS NULL OR cm.UploadBatchID IS NULL');
    const [legacyProcessedSQL, legacyProcessedParams] = mockExecuteQuery.mock.calls[4];
    console.log('[legacy-batch] SQL=', legacyProcessedSQL, 'params=', legacyProcessedParams);
    expect(String(legacyProcessedSQL)).toContain(`JSON_UNQUOTE(JSON_EXTRACT(cm.UserDefinedFields, '$.uploadSession.batchID')) LIKE ? ${LIKE_ESCAPE_CLAUSE}`);
    expect(legacyProcessedParams).toEqual(['1', '2', 'file-a.csv', 'batch-1', buildSubBatchPattern('batch-1')]);
  });

  it('binds an escaped sub-batch pattern so a batchID containing LIKE wildcards cannot match another batch', async () => {
    const wildcardBatchID = 'batch_1%';
    mockExecuteQuery.mockResolvedValue([{ count: 0 }]);

    const response = await GET(
      makeRequest(`http://localhost/api/verifysession?schema=myschema&plotID=1&censusID=2&fileID=file-a.csv&batchID=${encodeURIComponent(wildcardBatchID)}`),
      { params: Promise.resolve({}) }
    );

    expect(response.status).toBe(200);
    const expectedPattern = buildSubBatchPattern(wildcardBatchID);
    expect(expectedPattern).toBe('batch\\_1\\%\\_\\_sub%');
    const [processedCall, failedCall, remainingCall] = [0, 1, 2].map(callIndex => mockExecuteQuery.mock.calls[callIndex]);
    console.log('[wildcard-batch] failed SQL=', failedCall[0], 'params=', failedCall[1]);
    for (const [sql] of [processedCall, failedCall, remainingCall]) expect(String(sql)).toContain(`LIKE ? ${LIKE_ESCAPE_CLAUSE}`);
    expect(processedCall[1]).toEqual(['1', '2', 'file-a.csv', wildcardBatchID, expectedPattern]);
    expect(failedCall[1]).toEqual(['1', '2', 'file-a.csv', wildcardBatchID, expectedPattern, INGESTION_ERROR_SOURCE]);
    expect(remainingCall[1]).toEqual(['1', '2', 'file-a.csv', wildcardBatchID, expectedPattern]);
  });
});
