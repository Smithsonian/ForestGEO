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

import { GET } from './route';

function makeRequest(url: string): any {
  const request: any = new Request(url);
  request.nextUrl = new URL(url);
  return request;
}

describe('verifyprocessing route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses UploadFileID when verifying processing for a specific file', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([{ count: 7 }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ count: 0 }]);

    const response = await GET(makeRequest('http://localhost/api/verifyprocessing?schema=myschema&plotID=1&censusID=2&fileId=file-a.csv'), {
      params: Promise.resolve({})
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      processedCount: 7,
      failedCount: 1,
      remainingCount: 3,
      totalAccounted: 8,
      filteredByUpload: true,
      fileId: 'file-a.csv',
      legacyRowsDetected: false,
      mixedMetadataState: false
    });

    expect(mockExecuteQuery).toHaveBeenCalledTimes(4);
    expect(String(mockExecuteQuery.mock.calls[1][0])).toContain('cm.UploadFileID = ?');
    expect(String(mockExecuteQuery.mock.calls[3][0])).toContain('cm.UploadFileID IS NULL');
  });

  it('includes legacy JSON-only rows when file-scoped metadata is mixed', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([{ count: 7 }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([{ count: 4 }]);

    const response = await GET(makeRequest('http://localhost/api/verifyprocessing?schema=myschema&plotID=1&censusID=2&fileId=file-a.csv'), {
      params: Promise.resolve({})
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      processedCount: 11,
      failedCount: 1,
      remainingCount: 3,
      totalAccounted: 12,
      filteredByUpload: true,
      fileId: 'file-a.csv',
      legacyRowsDetected: true,
      mixedMetadataState: true
    });

    expect(mockExecuteQuery).toHaveBeenCalledTimes(5);
    expect(String(mockExecuteQuery.mock.calls[4][0])).toContain('JSON_UNQUOTE(JSON_EXTRACT');
  });
});
