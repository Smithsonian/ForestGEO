import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { buildSubBatchID } from '@/lib/uploads/batch-family';

const { loggerInfo, loggerWarn, loggerError, loggerDebug } = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  loggerDebug: vi.fn()
}));

const { requireUploadSessionOwnershipMock } = vi.hoisted(() => ({
  requireUploadSessionOwnershipMock: vi.fn()
}));

// withRouteAuthz (the Phase-3 membership guard now wrapping GET) calls auth()
// before the handler runs. A 'global' admin session clears assertSchemaAccess so
// this behavioral test still exercises the handler. Mocking @/auth also avoids
// loading the real next-auth ESM module under the native resolver.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: 'runner@forestgeo.test', userStatus: 'global', sites: [] } }))
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const executeQuery = vi.fn();
  const instance = { executeQuery };
  return {
    default: {
      getInstance: () => instance
    }
  };
});

vi.mock('@/lib/db/sqlsecurity', () => ({
  safeFormatQuery: vi.fn((schema: string, sql: string) => sql.replace(/\?\?/g, schema)),
  isValidSchema: vi.fn(() => true)
}));

vi.mock('@/config/uploadsessiontracker', () => ({
  requireUploadSessionOwnership: requireUploadSessionOwnershipMock,
  UploadSessionOwnershipError: class UploadSessionOwnershipError extends Error {
    status: number;

    constructor(message: string, status: number = 409) {
      super(message);
      this.status = status;
    }
  },
  UploadSessionState: {
    UPLOADED: 'uploaded',
    PROCESSING: 'processing',
    COLLAPSING: 'collapsing'
  }
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: loggerInfo,
    warn: loggerWarn,
    error: loggerError,
    debug: loggerDebug
  }
}));

function makeRequest() {
  const url = new URL('http://localhost/api/setupbulkprocessor/forestgeo_testing/22/6');
  const req = new Request(url.toString(), {
    method: 'GET',
    headers: { 'x-upload-session-id': 'session-1' }
  }) as any;
  req.nextUrl = url;
  return req;
}

function makeProps() {
  return {
    params: Promise.resolve({
      schema: 'forestgeo_testing',
      plotID: '22',
      censusID: '6'
    })
  } as any;
}

describe('GET /api/setupbulkprocessor/[schema]/[plotID]/[censusID]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUploadSessionOwnershipMock.mockResolvedValue(undefined);
  });

  it('returns one original batch ID for a file staged as sub-batch members', async () => {
    const PREPARTITIONED_FILE = 'SERC_census4_2025(1).csv';
    const ORIGINAL_BATCH_ID = 'b';
    const cm = ConnectionManager.getInstance() as any;
    cm.executeQuery.mockResolvedValueOnce([
      { FileID: PREPARTITIONED_FILE, BatchID: buildSubBatchID(ORIGINAL_BATCH_ID, 1), maxRowID: '104' },
      { FileID: PREPARTITIONED_FILE, BatchID: buildSubBatchID(ORIGINAL_BATCH_ID, 2), maxRowID: '108' },
      { FileID: PREPARTITIONED_FILE, BatchID: buildSubBatchID(ORIGINAL_BATCH_ID, 3), maxRowID: '109' }
    ]);

    const res = await GET(makeRequest(), makeProps());
    const body = await res.json();
    const [sql, params] = cm.executeQuery.mock.calls[0];
    console.log(`[setupbulkprocessor-family] status=${res.status} body=${JSON.stringify(body)} warnings=${loggerWarn.mock.calls.length}`);

    expect(res.status).toBe(HTTPResponses.OK);
    expect(body).toEqual([{ fileID: PREPARTITIONED_FILE, batchID: ORIGINAL_BATCH_ID }]);
    expect(String(sql)).toContain('GROUP BY FileID, BatchID');
    expect(params).toEqual(['22', '6']);
    expect(loggerWarn, 'members of one family are not competing batches').not.toHaveBeenCalled();
  });

  it('selects the family holding the newest staged row per file and warns when a file has several families', async () => {
    const REUPLOADED_FILE = 'SERC_census4_2025(1).csv';
    const LEGACY_FILE = 'SERC_census4_failures.csv';
    const cm = ConnectionManager.getInstance() as any;
    cm.executeQuery.mockResolvedValueOnce([
      { FileID: REUPLOADED_FILE, BatchID: buildSubBatchID('older-batch', 1), maxRowID: '40' },
      { FileID: REUPLOADED_FILE, BatchID: buildSubBatchID('newer-batch', 1), maxRowID: '90' },
      { FileID: REUPLOADED_FILE, BatchID: buildSubBatchID('older-batch', 2), maxRowID: '50' },
      { FileID: LEGACY_FILE, BatchID: 'only-batch', maxRowID: '12' }
    ]);

    const res = await GET(makeRequest(), makeProps());
    const body = await res.json();
    console.log(`[setupbulkprocessor-newest] status=${res.status} body=${JSON.stringify(body)} warnings=${JSON.stringify(loggerWarn.mock.calls)}`);

    expect(res.status).toBe(HTTPResponses.OK);
    expect(body).toEqual([
      { fileID: REUPLOADED_FILE, batchID: 'newer-batch' },
      { fileID: LEGACY_FILE, batchID: 'only-batch' }
    ]);
    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining(`Multiple staged batch families for file ${REUPLOADED_FILE}`));
  });
});
