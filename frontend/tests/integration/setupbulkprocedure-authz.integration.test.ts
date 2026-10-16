import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Per-site authorization regression suite for
 * GET /api/setupbulkprocedure/[fileID]/[batchID].
 *
 * Phase-3 posture: the route previously authorized via an upload-session TOKEN
 * (`requireUploadSessionOwnership`) only. We layer an explicit user→schema
 * membership gate (`withRouteAuthz` + `fromQuery('schema')`) ON TOP of the
 * retained token check.
 *
 * Contract pinned here:
 *   - a non-admin session outside the requested schema gets 403, and the
 *     membership gate short-circuits BEFORE the token check and before any SQL.
 *     The token is mocked to "would-pass" so a 403 proves the MEMBERSHIP gate.
 *   - an authorized member WITH a valid (mocked) token reaches the ingestion
 *     setup + procedure path (200).
 */

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

const MEMBER_SCHEMA = 'forestgeo_panama';
const FOREIGN_SCHEMA = 'forestgeo_serc';

const ADMIN_EMAIL = 'admin@forestgeo.test';
const ATTACKER_EMAIL = 'attacker@forestgeo.test';
const MEMBER_EMAIL = 'member@forestgeo.test';

const TEST_FILE_ID = 'file.csv';
const TEST_BATCH_ID = 'batch-1';
const TEST_SESSION_ID = 'session-1';
const TEST_PLOT_ID = 22;
const TEST_CENSUS_ID = 6;
const TEST_ROW_COUNT = 5;
const DRIFTED_PLOT_ID = 23;
const SUBBATCH_TRANSACTION_ID = 'tx-subbatch';

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: ADMIN_EMAIL, userStatus: 'global', sites: [] } }))
}));

vi.mock('@/ailogger', () => ({
  default: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }
}));

vi.mock('@/lib/db/sqlsecurity', () => ({
  safeFormatQuery: vi.fn((schema: string, sql: string) => sql.replace(/\?\?/g, schema)),
  isValidSchema: vi.fn(() => true),
  validateSchemaOrThrow: vi.fn()
}));

const { requireUploadSessionOwnershipMock, MockUploadSessionOwnershipError } = vi.hoisted(() => {
  class MockUploadSessionOwnershipError extends Error {
    status: number;
    constructor(message: string, status = 409) {
      super(message);
      this.status = status;
    }
  }
  return { requireUploadSessionOwnershipMock: vi.fn(), MockUploadSessionOwnershipError };
});

vi.mock('@/config/uploadsessiontracker', () => ({
  requireUploadSessionOwnership: requireUploadSessionOwnershipMock,
  UploadSessionOwnershipError: MockUploadSessionOwnershipError,
  UploadSessionState: { UPLOADED: 'uploaded', PROCESSING: 'processing' }
}));

vi.mock('@/lib/failedinitialcensusrecovery', () => ({
  shouldRecoverFailedInitialCensus: vi.fn(() => false)
}));

vi.mock('@/lib/batchfailuretransfer', () => ({
  moveTemporaryBatchToFailedMeasurements: vi.fn(async () => 0)
}));

const dbSpies = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  acquireApplicationLock: vi.fn(async () => true),
  withTransaction: vi.fn(),
  beginTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn()
}));

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      executeQuery: dbSpies.executeQuery,
      acquireApplicationLock: dbSpies.acquireApplicationLock,
      withTransaction: dbSpies.withTransaction,
      beginTransaction: dbSpies.beginTransaction,
      commitTransaction: dbSpies.commitTransaction,
      rollbackTransaction: dbSpies.rollbackTransaction
    })
  }
}));

function buildRequest(schema: string): NextRequest {
  return new NextRequest(`http://localhost/api/setupbulkprocedure/${TEST_FILE_ID}/${TEST_BATCH_ID}?schema=${schema}`, {
    method: 'GET',
    headers: { 'x-upload-session-id': TEST_SESSION_ID }
  });
}

function makeContext() {
  return { params: Promise.resolve({ fileID: TEST_FILE_ID, batchID: TEST_BATCH_ID }) } as any;
}

function primeSuccessfulProcedureRun(options: { driftAfterAuthorization?: boolean } = {}) {
  dbSpies.acquireApplicationLock.mockResolvedValue(true);
  dbSpies.withTransaction.mockImplementation(
    async (fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown>; id: string }) => Promise<unknown>) =>
      fn({ query: (sql: string, params?: unknown[]) => dbSpies.executeQuery(sql, params), id: 'tx-1' })
  );
  dbSpies.beginTransaction.mockResolvedValue(SUBBATCH_TRANSACTION_ID);
  dbSpies.commitTransaction.mockResolvedValue(undefined);
  dbSpies.rollbackTransaction.mockResolvedValue(undefined);
  // Keyed on statement text, not call order: ingestBatch's per-sub-batch transaction
  // and audit statements (#507/#527) must not shift which response a query receives.
  let familyReads = 0;
  dbSpies.executeQuery.mockImplementation(async (sql: string) => {
    const text = String(sql);
    if (text.includes('.temporarymeasurements') && text.includes('GROUP BY BatchID')) {
      familyReads++;
      const scopeDrifted = options.driftAfterAuthorization && familyReads > 1;
      return [
        {
          BatchID: TEST_BATCH_ID,
          PlotID: scopeDrifted ? DRIFTED_PLOT_ID : TEST_PLOT_ID,
          CensusID: TEST_CENSUS_ID,
          rowCount: TEST_ROW_COUNT,
          plotCount: 1,
          censusCount: 1
        }
      ];
    }
    if (text.includes('completedUploads')) return [{ completedUploads: 0, incompleteUploads: 0, treeCount: 0, stemCount: 0, coreMeasurementCount: 0 }];
    if (text.includes('bulkingestion_caller_owns_transaction')) return {};
    if (text.includes('bulkingestionprocess')) return [[{ records_failed: 0, batch_failed: 0, message: 'ok' }], {}];
    if (text.includes('UPDATE') && text.includes('.temporarymeasurements')) return { affectedRows: 0 };
    if (text.trimStart().toUpperCase().startsWith('DELETE')) return { affectedRows: 0 };
    return [];
  });
}

describe('GET /api/setupbulkprocedure/[fileID]/[batchID] authz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUploadSessionOwnershipMock.mockResolvedValue(undefined);
    dbSpies.acquireApplicationLock.mockResolvedValue(true);
  });

  it('denies a non-admin user outside the schema scope with 403 BEFORE the token check or any SQL', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: ATTACKER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/setupbulkprocedure/[fileID]/[batchID]/route');
    const res = await GET(buildRequest(FOREIGN_SCHEMA), makeContext());

    expect(res.status).toBe(HTTP_FORBIDDEN);
    expect(requireUploadSessionOwnershipMock).not.toHaveBeenCalled();
    expect(dbSpies.withTransaction).not.toHaveBeenCalled();
    expect(dbSpies.executeQuery).not.toHaveBeenCalled();
  });

  it('allows a non-admin member with a valid token to reach the procedure path (200)', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: MEMBER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);
    primeSuccessfulProcedureRun();

    const { GET } = await import('@/app/api/setupbulkprocedure/[fileID]/[batchID]/route');
    const res = await GET(buildRequest(MEMBER_SCHEMA), makeContext());

    expect(res.status).toBe(HTTP_OK);
    // Retained token check ran for the member, and the setup transaction executed.
    expect(requireUploadSessionOwnershipMock).toHaveBeenCalledTimes(1);
    expect(requireUploadSessionOwnershipMock).toHaveBeenCalledWith(expect.objectContaining({ schema: MEMBER_SCHEMA, plotId: 22, censusId: 6 }));
    expect(dbSpies.withTransaction).toHaveBeenCalled();
    const procedureCalls = dbSpies.executeQuery.mock.calls.filter(
      ([sql]: [string]) => String(sql).includes('CALL') && String(sql).includes('bulkingestionprocess')
    );
    expect(procedureCalls, 'the member must reach the bulkingestionprocess CALL').toHaveLength(1);
    expect(dbSpies.commitTransaction).toHaveBeenCalledWith(SUBBATCH_TRANSACTION_ID);
    expect(dbSpies.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('rejects a family whose scope changes after upload-session authorization', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: MEMBER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);
    primeSuccessfulProcedureRun({ driftAfterAuthorization: true });

    const { GET } = await import('@/app/api/setupbulkprocedure/[fileID]/[batchID]/route');
    const res = await GET(buildRequest(MEMBER_SCHEMA), makeContext());

    expect(requireUploadSessionOwnershipMock).toHaveBeenCalledWith(expect.objectContaining({ plotId: TEST_PLOT_ID, censusId: TEST_CENSUS_ID }));
    expect(res.status).toBe(503);
    expect(dbSpies.executeQuery.mock.calls.some(([sql]) => String(sql).includes('bulkingestionprocess'))).toBe(false);
  });
});
