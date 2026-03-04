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

describe('verifyprocessing route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses UploadFileID when verifying processing for a specific file', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([{ count: 7 }])
      .mockResolvedValueOnce([{ count: 1 }]);

    const response = await GET(makeRequest('http://localhost/api/verifyprocessing?schema=myschema&plotID=1&censusID=2&fileId=file-a.csv'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      processedCount: 7,
      failedCount: 1,
      remainingCount: 3,
      totalAccounted: 8,
      filteredByUpload: true,
      fileId: 'file-a.csv'
    });

    expect(mockExecuteQuery).toHaveBeenCalledTimes(3);
    expect(String(mockExecuteQuery.mock.calls[1][0])).toContain('cm.UploadFileID = ?');
  });
});
