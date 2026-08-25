import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';

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

// withRouteAuthz (the Phase-3 membership guard now wrapping GET) calls auth()
// before the handler runs. A 'global' admin session clears assertSchemaAccess so
// these behavioral tests still exercise the handler. Mocking @/auth also avoids
// loading the real next-auth ESM module under the native resolver.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: 'runner@forestgeo.test', userStatus: 'global', sites: [] } }))
}));

vi.mock('@/lib/db/connectionmanager', () => {
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

vi.mock('@/lib/db/sqlsecurity', () => ({
  safeFormatQuery: vi.fn((schema: string, sql: string) => sql.replace(/\?\?/g, schema)),
  isValidSchema: vi.fn(() => true),
  validateSchemaOrThrow: vi.fn()
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

/**
 * One grouped row per batch-family member, matching discoverBatchFamily's
 * SELECT. Both the route preamble and ingestBatch's setup run that same query.
 */
function familyRows(members: Array<{ BatchID: string; rowCount: number }> = [{ BatchID: 'batch-1', rowCount: 5 }]) {
  return members.map(member => ({ ...member, PlotID: 22, CensusID: 6, plotCount: 1, censusCount: 1 }));
}

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
  cm.withTransaction.mockImplementation(async (fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown>; id: string }) => Promise<unknown>) =>
    fn({ query: (sql: string, params?: unknown[]) => cm.executeQuery(sql, params), id: 'tx-1' })
  );
  cm.executeQuery
    .mockResolvedValueOnce(familyRows()) // route preamble: batch-family discovery for ownership check
    .mockResolvedValueOnce(familyRows()) // ingestBatch setup: batch-family discovery (plot/census + row count)
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
    cm.withTransaction.mockImplementation(async (fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown>; id: string }) => Promise<unknown>) =>
      fn({ query: (sql: string, params?: unknown[]) => cm.executeQuery(sql, params), id: 'tx-1' })
    );
    cm.executeQuery
      .mockResolvedValueOnce(familyRows()) // route preamble: batch-family discovery for ownership check
      .mockResolvedValueOnce(familyRows()) // ingestBatch setup: batch-family discovery (plot/census + row count)
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
      executedSql.some(
        (sql: string) =>
          sql.includes('DELETE tm') &&
          sql.includes('INNER JOIN forestgeo_testing.uploadmetrics um') &&
          sql.includes("um.status IN ('failed', 'processing')") &&
          sql.includes('NOT (tm.FileID = ? AND tm.BatchID = ?)')
      )
    ).toBe(true);
    expect(
      executedSql.some((sql: string) =>
        sql.includes('DELETE FROM forestgeo_testing.temporarymeasurements WHERE PlotID = ? AND CensusID = ? AND NOT (FileID = ?)')
      )
    ).toBe(false);
  });

  it('removes stale unresolved rows from prior same-file batches before processing', async () => {
    const cm = ConnectionManager.getInstance() as any;
    cm.acquireApplicationLock.mockResolvedValue(true);
    cm.withTransaction.mockImplementation(async (fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown>; id: string }) => Promise<unknown>) =>
      fn({ query: (sql: string, params?: unknown[]) => cm.executeQuery(sql, params), id: 'tx-1' })
    );
    cm.executeQuery
      .mockResolvedValueOnce(familyRows()) // route preamble: batch-family discovery for ownership check
      .mockResolvedValueOnce(familyRows()) // ingestBatch setup: batch-family discovery (plot/census + row count)
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
        // Family-sparing exclusion: on a worker retry the batch ID is reused
        // and completed sub-batches' proc-recorded failure rows live under
        // suffixed IDs — a bare-ID exclusion would delete them permanently.
        normalizedSql.includes('NOT (UploadBatchID <=> ? OR UploadBatchID LIKE ?')
      );
    });

    expect(staleFailureCleanupCall).toBeDefined();
  });

  it('removes stale unresolved ingestion rows that match the current staged upload even when the file name changed', async () => {
    const cm = ConnectionManager.getInstance() as any;
    cm.acquireApplicationLock.mockResolvedValue(true);
    cm.withTransaction.mockImplementation(async (fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown>; id: string }) => Promise<unknown>) =>
      fn({ query: (sql: string, params?: unknown[]) => cm.executeQuery(sql, params), id: 'tx-1' })
    );
    cm.executeQuery
      .mockResolvedValueOnce(familyRows()) // route preamble: batch-family discovery for ownership check
      .mockResolvedValueOnce(familyRows()) // ingestBatch setup: batch-family discovery (plot/census + row count)
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
        // Family-sparing (see the same-file cleanup test above).
        normalizedSql.includes('NOT (cm.UploadFileID <=> ? AND (cm.UploadBatchID <=> ? OR cm.UploadBatchID LIKE ?')
      );
    });

    expect(staleFailureCleanupCall).toBeDefined();
  });

  /**
   * 2026-07-27 Harvard Forest incident. Attempt 1 split 106,227 rows into
   * `__sub001`/`__sub002` and then died at Azure's 240s front-end limit. The
   * automatic retry looked up the unsuffixed BatchID, found nothing, and
   * returned 200 "No data found" in 31ms — a false success over rows that were
   * still fully staged.
   */
  describe('resuming a batch whose rows were renamed into sub-batches', () => {
    const ORPHANED_SUB_BATCHES = [
      { BatchID: 'batch-1__sub001', rowCount: 10_000 },
      { BatchID: 'batch-1__sub002', rowCount: 96_227 }
    ];

    /**
     * SQL-aware mock standing in for the post-incident database: the rows exist
     * ONLY under `__subNNN`. A lookup restricted to the unsuffixed BatchID
     * therefore returns nothing, exactly as it did in production — so a handler
     * that does not query the family cannot pass these tests.
     */
    function mockOrphanedSubBatchRun() {
      const cm = ConnectionManager.getInstance() as any;
      cm.acquireApplicationLock.mockResolvedValue(true);
      cm.withTransaction.mockImplementation(
        async (fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown>; id: string }) => Promise<unknown>) =>
          fn({ query: (sql: string, params?: unknown[]) => cm.executeQuery(sql, params), id: 'tx-1' })
      );
      cm.executeQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        const text = String(sql);

        if (text.includes('FROM forestgeo_testing.temporarymeasurements')) {
          // Only a family-scoped lookup sees the orphaned rows.
          return text.includes('BatchID LIKE ?') ? familyRows(ORPHANED_SUB_BATCHES) : [];
        }
        if (text.includes('completedUploads')) {
          return [{ completedUploads: 0, incompleteUploads: 0, treeCount: 0, stemCount: 0, coreMeasurementCount: 0 }];
        }
        if (text.includes('bulkingestionprocess')) {
          return [[{ records_failed: 0, batch_failed: 0, message: `ok:${String(params?.[1])}` }], {}];
        }
        if (text.startsWith('DELETE') || text.includes('UPDATE forestgeo_testing.temporarymeasurements')) {
          return { affectedRows: 0 };
        }
        return [];
      });
      return cm;
    }

    it('authorizes the orphaned rows’ scope instead of returning early', async () => {
      mockOrphanedSubBatchRun();

      const res = await GET(makeRequest(), makeProps());
      const body = await res.json();

      expect(res.status).toBe(200);
      // The regression: this must NOT be the 31ms no-op.
      expect(body.message).not.toBe('No data found');
      // Ownership is verified against the scope discovered from the orphans.
      expect(requireUploadSessionOwnershipMock).toHaveBeenCalledWith(
        expect.objectContaining({ schema: 'forestgeo_testing', plotId: 22, censusId: 6, sessionId: 'session-1' })
      );
    });

    it('runs the stored procedure once per orphaned sub-batch, in lexical order', async () => {
      const cm = mockOrphanedSubBatchRun();

      const res = await GET(makeRequest(), makeProps());
      const body = await res.json();

      const procedureCalls = cm.executeQuery.mock.calls.filter(([sql]: [string]) => String(sql).includes('bulkingestionprocess'));
      expect(procedureCalls.map(([, params]: [string, string[]]) => params[1])).toEqual(['batch-1__sub001', 'batch-1__sub002']);
      expect(body.subBatchCount).toBe(ORPHANED_SUB_BATCHES.length);
    });

    it('does not re-split orphaned sub-batches into new ones', async () => {
      const cm = mockOrphanedSubBatchRun();

      await GET(makeRequest(), makeProps());

      // Nothing remains under the original ID, so there is nothing to split.
      const splitCalls = cm.executeQuery.mock.calls.filter(([sql]: [string]) =>
        String(sql).includes('UPDATE forestgeo_testing.temporarymeasurements SET BatchID = ?')
      );
      expect(splitCalls).toHaveLength(0);
    });

    it('matches the sub-batch family with an escaped LIKE pattern and explicit ESCAPE', async () => {
      const cm = mockOrphanedSubBatchRun();

      await GET(makeRequest(), makeProps());

      const [familySQL, familyParams] = cm.executeQuery.mock.calls[0];
      expect(String(familySQL)).toContain('BatchID = ? OR BatchID LIKE ?');
      expect(String(familySQL)).toContain("ESCAPE '\\\\'");
      // The separator's underscores are escaped so the pattern cannot match
      // an unrelated batch whose name happens to fit `??sub`.
      expect(familyParams).toEqual(['file.csv', 'batch-1', 'batch-1\\_\\_sub%']);
    });

    it('still reports "No data found" when the whole family is genuinely empty', async () => {
      const cm = ConnectionManager.getInstance() as any;
      cm.executeQuery.mockResolvedValue([]);

      const res = await GET(makeRequest(), makeProps());

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ attemptsNeeded: 0, batchFailedButHandled: false, message: 'No data found' });
      expect(requireUploadSessionOwnershipMock).not.toHaveBeenCalled();
    });
  });
});
