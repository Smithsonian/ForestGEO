import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager';

const { loggerInfo, loggerWarn, loggerError } = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn()
}));

const { moveTemporaryBatchToFailedMeasurements } = vi.hoisted(() => ({
  moveTemporaryBatchToFailedMeasurements: vi.fn()
}));

const { shouldRecoverFailedInitialCensus } = vi.hoisted(() => ({
  shouldRecoverFailedInitialCensus: vi.fn(() => false)
}));

const { requireUploadSessionOwnershipMock } = vi.hoisted(() => ({
  requireUploadSessionOwnershipMock: vi.fn()
}));

vi.mock('@/config/connectionmanager', () => {
  const instance = {
    withTransaction: vi.fn(),
    executeQuery: vi.fn(),
    acquireApplicationLock: vi.fn()
  };

  return {
    default: {
      getInstance: () => instance
    }
  };
});

vi.mock('@/config/utils/sqlsecurity', () => ({
  safeFormatQuery: vi.fn((schema: string, sql: string) => sql.replace(/\?\?/g, schema))
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
    PROCESSING: 'processing'
  }
}));

vi.mock('@/lib/failedinitialcensusrecovery', () => ({
  shouldRecoverFailedInitialCensus
}));

vi.mock('@/lib/batchfailuretransfer', () => ({
  moveTemporaryBatchToFailedMeasurements
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: loggerInfo,
    warn: loggerWarn,
    error: loggerError
  }
}));

function makeRequest(includeSessionHeader: boolean = true) {
  const url = new URL('http://localhost/api/setupbulkprocedure/file.csv/batch-1?schema=forestgeo_testing');
  const req = new Request(url.toString(), {
    method: 'GET',
    headers: includeSessionHeader ? { 'x-upload-session-id': 'session-1' } : undefined
  }) as any;
  req.nextUrl = url;
  return req;
}

function makeProps() {
  return {
    params: Promise.resolve({
      fileID: 'file.csv',
      batchID: 'batch-1'
    })
  } as any;
}

function mockSuccessfulProcedureRun() {
  const cm = ConnectionManager.getInstance() as any;
  cm.acquireApplicationLock.mockResolvedValue(true);
  cm.withTransaction.mockImplementation(async (fn: (transactionId: string) => Promise<unknown>) => fn('tx-1'));
  cm.executeQuery
    .mockResolvedValueOnce([{ PlotID: 22, CensusID: 6, rowCount: 5 }])
    .mockResolvedValueOnce([{ completedUploads: 0, incompleteUploads: 0, treeCount: 0, stemCount: 0, coreMeasurementCount: 0 }])
    .mockResolvedValueOnce({ affectedRows: 0 })
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([[{ records_failed: 0, batch_failed: 0, message: 'ok' }], {}]);
}

describe('GET /api/setupbulkprocedure/[fileID]/[batchID]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUploadSessionOwnershipMock.mockResolvedValue(undefined);
    shouldRecoverFailedInitialCensus.mockReturnValue(false);
    moveTemporaryBatchToFailedMeasurements.mockResolvedValue(0);
  });

  it('requires an upload session header before processing batches', async () => {
    const res = await GET(makeRequest(false), makeProps());

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'Upload session is required for batch processing'
    });
  });

  it('validates the discovered plot/census against the active upload session before processing', async () => {
    const cm = ConnectionManager.getInstance() as any;
    mockSuccessfulProcedureRun();

    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(200);
    expect(requireUploadSessionOwnershipMock).toHaveBeenCalledWith({
      schema: 'forestgeo_testing',
      sessionId: 'session-1',
      plotId: 22,
      censusId: 6,
      allowedStates: ['uploaded', 'processing'],
      contextLabel: 'batch processing for file.csv-batch-1'
    });
    expect(cm.acquireApplicationLock).toHaveBeenCalledTimes(1);
  });

  it('narrows failed first-load cleanup to temp rows tied to incomplete uploadmetrics batches', async () => {
    const cm = ConnectionManager.getInstance() as any;
    shouldRecoverFailedInitialCensus.mockReturnValue(true);
    cm.acquireApplicationLock.mockResolvedValue(true);
    cm.withTransaction.mockImplementation(async (fn: (transactionId: string) => Promise<unknown>) => fn('tx-1'));
    cm.executeQuery
      .mockResolvedValueOnce([{ PlotID: 22, CensusID: 6, rowCount: 5 }])
      .mockResolvedValueOnce([{ completedUploads: 0, incompleteUploads: 1, treeCount: 1, stemCount: 1, coreMeasurementCount: 244 }])
      .mockResolvedValue({})
      .mockResolvedValue({})
      .mockResolvedValue({})
      .mockResolvedValue({})
      .mockResolvedValue({})
      .mockResolvedValue({})
      .mockResolvedValue({})
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([[{ records_failed: 0, batch_failed: 0, message: 'ok' }], {}]);

    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(200);

    const executedSql = cm.executeQuery.mock.calls.map(([sql]: [string]) => String(sql));
    expect(
      executedSql.some((sql: string) =>
        sql.includes('DELETE tm') &&
        sql.includes('INNER JOIN forestgeo_testing.uploadmetrics um') &&
        sql.includes("um.status IN ('failed', 'processing')") &&
        sql.includes('NOT (tm.FileID = ? AND tm.BatchID = ?)')
      )
    ).toBe(true);
    expect(
      executedSql.some((sql: string) => sql.includes('DELETE FROM forestgeo_testing.temporarymeasurements WHERE PlotID = ? AND CensusID = ? AND NOT (FileID = ?)'))
    ).toBe(
      false
    );
  });

  it('removes stale unresolved rows from prior same-file batches before processing', async () => {
    const cm = ConnectionManager.getInstance() as any;
    cm.acquireApplicationLock.mockResolvedValue(true);
    cm.withTransaction.mockImplementation(async (fn: (transactionId: string) => Promise<unknown>) => fn('tx-1'));
    cm.executeQuery
      .mockResolvedValueOnce([{ PlotID: 22, CensusID: 6, rowCount: 5 }])
      .mockResolvedValueOnce([{ completedUploads: 1, incompleteUploads: 0, treeCount: 0, stemCount: 0, coreMeasurementCount: 244 }])
      .mockResolvedValueOnce({ affectedRows: 244 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([[{ records_failed: 0, batch_failed: 0, message: 'ok' }], {}]);

    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(200);

    const staleFailureCleanupCall = cm.executeQuery.mock.calls.find(([sql]: [string]) => {
      const normalizedSql = String(sql);
      return (
        normalizedSql.includes('DELETE FROM forestgeo_testing.coremeasurements') &&
        normalizedSql.includes('StemGUID IS NULL') &&
        normalizedSql.includes('UploadFileID = ?') &&
        normalizedSql.includes('NOT (UploadBatchID <=> ?)')
      );
    });

    expect(staleFailureCleanupCall).toBeDefined();
  });

  it('removes stale unresolved ingestion rows that match the current staged upload even when the file name changed', async () => {
    const cm = ConnectionManager.getInstance() as any;
    cm.acquireApplicationLock.mockResolvedValue(true);
    cm.withTransaction.mockImplementation(async (fn: (transactionId: string) => Promise<unknown>) => fn('tx-1'));
    cm.executeQuery
      .mockResolvedValueOnce([{ PlotID: 22, CensusID: 6, rowCount: 5 }])
      .mockResolvedValueOnce([{ completedUploads: 1, incompleteUploads: 0, treeCount: 0, stemCount: 0, coreMeasurementCount: 244 }])
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce([{ 1: 1 }])
      .mockResolvedValueOnce({ affectedRows: 244 })
      .mockResolvedValueOnce([[{ records_failed: 0, batch_failed: 0, message: 'ok' }], {}]);

    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(200);

    const staleFailureCleanupCall = cm.executeQuery.mock.calls.find(([sql]: [string]) => {
      const normalizedSql = String(sql);
      return (
        normalizedSql.includes('DELETE cm') &&
        normalizedSql.includes('JOIN forestgeo_testing.measurement_error_log mel') &&
        normalizedSql.includes("me.ErrorSource = 'ingestion'") &&
        normalizedSql.includes('JOIN forestgeo_testing.temporarymeasurements tm') &&
        normalizedSql.includes('tm.FileID = ?') &&
        normalizedSql.includes('tm.BatchID = ?') &&
        normalizedSql.includes('NOT (cm.UploadFileID <=> ? AND cm.UploadBatchID <=> ?)')
      );
    });

    expect(staleFailureCleanupCall).toBeDefined();
  });
});
