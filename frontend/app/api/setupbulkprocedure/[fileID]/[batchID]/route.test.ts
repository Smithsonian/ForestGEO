import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';

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

// Read by the ConnectionManager mock factory below, which Vitest hoists above
// this file's own top-level `const`s -- a plain const here would still be in
// its TDZ when the (also hoisted) factory runs, so it must live in vi.hoisted.
const { PHASE1_TRANSACTION_ID, SUBBATCH_TRANSACTION_ID } = vi.hoisted(() => ({
  PHASE1_TRANSACTION_ID: 'tx-1',
  SUBBATCH_TRANSACTION_ID: 'tx-subbatch'
}));

// withRouteAuthz (the Phase-3 membership guard now wrapping GET) calls auth()
// before the handler runs. A 'global' admin session clears assertSchemaAccess so
// these behavioral tests still exercise the handler. Mocking @/auth also avoids
// loading the real next-auth ESM module under the native resolver.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: 'runner@forestgeo.test', userStatus: 'global', sites: [] } }))
}));

// Lifecycle methods are bare vi.fn()s: vitest.config.mts sets restoreMocks +
// clearMocks, which wipes any .mockResolvedValue() set here before every test,
// so the needed defaults are (re)applied in beforeEach instead.
vi.mock('@/lib/db/connectionmanager', () => {
  const instance = {
    withTransaction: vi.fn(),
    executeQuery: vi.fn(),
    acquireApplicationLock: vi.fn(),
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    rollbackTransaction: vi.fn(),
    discardTransaction: vi.fn()
  };

  return {
    default: {
      getInstance: () => instance
    }
  };
});

// safeFormatQuery/isValidSchema/validateSchemaOrThrow are overridden so every
// assertion below can match literal 'forestgeo_testing.table' text instead of
// the real backtick-escaped identifier. Everything else (buildInPlaceholders
// in particular) comes from the real, pure, mysql2-free module.
vi.mock('@/lib/db/sqlsecurity', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/db/sqlsecurity')>();
  return {
    ...actual,
    safeFormatQuery: vi.fn((schema: string, sql: string) => sql.replace(/\?\?/g, schema)),
    isValidSchema: vi.fn(() => true),
    validateSchemaOrThrow: vi.fn()
  };
});

vi.mock('@/config/uploadsessiontracker', () => ({
  requireUploadSessionOwnership: requireUploadSessionOwnershipMock,
  UploadSessionOwnershipError: class UploadSessionOwnershipError extends Error {
    status: number;

    constructor(message: string, status: number = HTTPResponses.CONFLICT) {
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

const SCHEMA = 'forestgeo_testing';
const FILE_ID = 'file.csv';
const BATCH_ID = 'batch-1';
const SESSION_ID = 'session-1';
const DISCOVERED_PLOT_ID = 22;
const DISCOVERED_CENSUS_ID = 6;
const SUB_BATCH_LIKE_PATTERN = 'batch-1\\_\\_sub%';

/**
 * One grouped row per batch-family member, matching discoverBatchFamily's
 * SELECT. Both the route preamble and ingestBatch's setup run that same query.
 */
function familyRows(members: Array<{ BatchID: string; rowCount: number }> = [{ BatchID: BATCH_ID, rowCount: 5 }]) {
  return members.map(member => ({ ...member, PlotID: DISCOVERED_PLOT_ID, CensusID: DISCOVERED_CENSUS_ID, plotCount: 1, censusCount: 1 }));
}

function makeRequest(includeSessionHeader: boolean = true) {
  const url = new URL(`http://localhost/api/setupbulkprocedure/${FILE_ID}/${BATCH_ID}?schema=${SCHEMA}`);
  const req = new Request(url.toString(), {
    method: 'GET',
    headers: includeSessionHeader ? { 'x-upload-session-id': SESSION_ID } : undefined
  }) as any;
  req.nextUrl = url;
  return req;
}

function makeProps() {
  return {
    params: Promise.resolve({
      fileID: FILE_ID,
      batchID: BATCH_ID
    })
  } as any;
}

function coreMeasurementIdRows(ids: number[]) {
  return ids.map(CoreMeasurementID => ({ CoreMeasurementID }));
}

interface SetupBulkProcedureFixtureOptions {
  familyMembers?: Array<{ BatchID: string; rowCount: number }>;
  recoveryState?: { completedUploads: number; incompleteUploads: number; treeCount: number; stemCount: number; coreMeasurementCount: number };
  /** IDs the recovery's census-wide bounded capture (`CensusID = ?` only) returns. */
  recoveryCaptureIDs?: number[];
  /** IDs the same-file cleanup's bounded capture returns. */
  sameFileCaptureIDs?: number[];
  /** Whether the cross-file `SELECT 1 ... LIMIT 1` existence probe finds a candidate row. */
  crossFileCandidateExists?: boolean;
  /** IDs the cross-file (joined) cleanup's bounded capture returns. */
  crossFileCaptureIDs?: number[];
  procedureResult?: unknown;
  /**
   * Rows processSubBatch's AFTER-CALL snapshot should see for a given
   * UploadBatchID, keyed by that sub-batch ID. The BEFORE snapshot always
   * returns [] (nothing is pre-staged in these fixtures); a sub-batch only
   * "sees" its configured rows once its own CALL has run, tracked by state
   * rather than call count.
   */
  subBatchRowsAfterCall?: Record<string, Record<string, unknown>[]>;
}

/**
 * One statement-aware fixture for the whole ingestBatch path, keyed on SQL
 * text/params rather than call order or index. Audit-INSERT and bounded-DELETE
 * responses are derived from the params each statement actually receives
 * (`affectedRows = params.length` minus any known prefix), so
 * deleteCoreMeasurementsInBoundedChunksWithAudit's own "captured === audited
 * === deleted" checks pass for whatever ids a test configures, without this
 * fixture tracking separate counters per cleanup.
 */
function primeSetupBulkProcedureQueries(options: SetupBulkProcedureFixtureOptions = {}) {
  const cm = ConnectionManager.getInstance() as any;
  const familyMembers = options.familyMembers ?? [{ BatchID: BATCH_ID, rowCount: 5 }];
  const recoveryState = options.recoveryState ?? { completedUploads: 0, incompleteUploads: 0, treeCount: 0, stemCount: 0, coreMeasurementCount: 0 };
  const recoveryCaptureRows = coreMeasurementIdRows(options.recoveryCaptureIDs ?? []);
  const sameFileCaptureRows = coreMeasurementIdRows(options.sameFileCaptureIDs ?? []);
  const crossFileCandidateExists = options.crossFileCandidateExists ?? false;
  const crossFileCaptureRows = coreMeasurementIdRows(options.crossFileCaptureIDs ?? []);
  const procedureResult = options.procedureResult ?? [[{ records_failed: 0, batch_failed: 0, message: 'ok' }], {}];
  const subBatchRowsAfterCall = options.subBatchRowsAfterCall ?? {};
  const calledSubBatchIDs = new Set<string>();

  cm.acquireApplicationLock.mockResolvedValue(true);
  cm.withTransaction.mockImplementation(async (fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown>; id: string }) => Promise<unknown>) =>
    fn({ query: (sql: string, params?: unknown[]) => cm.executeQuery(sql, params), id: PHASE1_TRANSACTION_ID })
  );

  cm.executeQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const text = String(sql);

    if (text.includes('.temporarymeasurements') && text.includes('GROUP BY BatchID')) return familyRows(familyMembers);
    if (text.includes('completedUploads')) return [recoveryState];
    // processSubBatch's before/after coremeasurements scope snapshot: the
    // same statement runs twice per sub-batch attempt, before and after its
    // CALL. Return rows only once that sub-batch's CALL has actually run.
    if (text.includes('UploadFileID = ? AND UploadBatchID = ?')) {
      const subBatchID = String(params[1]);
      return calledSubBatchIDs.has(subBatchID) ? (subBatchRowsAfterCall[subBatchID] ?? []) : [];
    }
    if (text.includes('bulkingestion_caller_owns_transaction')) return {};
    if (text.includes('bulkingestionprocess')) {
      calledSubBatchIDs.add(String(params[1]));
      return procedureResult;
    }

    // Three distinct unifiedchangelog audit INSERT shapes, disambiguated by
    // which of OldRowState/NewRowState they carry.
    if (text.includes('INSERT INTO') && text.includes('.unifiedchangelog') && text.includes('OldRowState') && text.includes('NewRowState')) {
      // recordSnapshotRowsAudit's bulk VALUES insert: 8 bound values per row.
      return { affectedRows: params.length / 8 };
    }
    if (text.includes('INSERT INTO') && text.includes('.unifiedchangelog') && text.includes('OldRowState') && !text.includes('NewRowState')) {
      // recordDeletedCoreMeasurementsAudit's INSERT ... SELECT. Params are
      // [changedBy, plotID, censusID, ...ids].
      return { affectedRows: Math.max(params.length - 3, 0) };
    }

    // deleteCoreMeasurementsInBoundedChunksWithAudit's bounded DELETE: params
    // are exactly the captured ids.
    if (text.trimStart().toUpperCase().startsWith('DELETE FROM') && text.includes('.coremeasurements') && text.includes('CoreMeasurementID IN')) {
      return { affectedRows: params.length };
    }

    // Three distinct FOR-UPDATE id-capture SELECTs; most specific predicate first.
    if (text.includes('DISTINCT cm.CoreMeasurementID')) return crossFileCaptureRows;
    if (text.includes('FOR UPDATE') && text.includes('StemGUID IS NULL') && text.includes('UploadFileID = ?')) return sameFileCaptureRows;
    if (text.includes('FOR UPDATE') && text.includes('SELECT CoreMeasurementID FROM') && !text.includes('StemGUID')) return recoveryCaptureRows;

    if (text.trim().startsWith('SELECT 1')) return crossFileCandidateExists ? [{ 1: 1 }] : [];

    if (text.trimStart().toUpperCase().startsWith('DELETE')) return {};
    if (text.includes('UPDATE') && text.includes('.temporarymeasurements')) return { affectedRows: 0 };
    return [];
  });

  return cm;
}

/**
 * Shared assertion for the three audited bounded-delete cleanups (recovery,
 * same-file, cross-file): finds the sole OldRowState-only unifiedchangelog
 * audit INSERT and the sole bounded coremeasurements DELETE, requires both to
 * target exactly `expectedIDs`, both to run on PHASE1_TRANSACTION_ID, and
 * capture < audit < delete in call order — proving the audit runs before the
 * delete, not just that both happened somewhere. Requiring exactly one of
 * each also proves no delete ran against ids outside `expectedIDs`.
 */
function expectAuditedBoundedDelete(cm: any, captureCallIndex: number, expectedIDs: number[], diagnostic: string): void {
  const calls = cm.executeQuery.mock.calls as [string, unknown[], string?][];
  const isAuditInsert = (sql: string) => sql.includes('.unifiedchangelog') && sql.includes('OldRowState') && !sql.includes('NewRowState');
  const isBoundedDelete = (sql: string) =>
    sql.toUpperCase().startsWith('DELETE FROM') && sql.includes('.coremeasurements') && sql.includes('CoreMeasurementID IN');

  const auditCalls = calls.filter(([sql]) => isAuditInsert(String(sql)));
  const deleteCalls = calls.filter(([sql]) => isBoundedDelete(String(sql)));
  expect(auditCalls, diagnostic).toHaveLength(1);
  expect(deleteCalls, diagnostic).toHaveLength(1);

  const [, auditParams, auditTx] = auditCalls[0];
  const [, deleteParams, deleteTx] = deleteCalls[0];
  expect((auditParams as unknown[]).slice(3), diagnostic).toEqual(expectedIDs);
  expect(deleteParams, diagnostic).toEqual(expectedIDs);
  expect(auditTx, diagnostic).toBe(PHASE1_TRANSACTION_ID);
  expect(deleteTx, diagnostic).toBe(PHASE1_TRANSACTION_ID);

  const auditIndex = calls.findIndex(([sql]) => isAuditInsert(String(sql)));
  const deleteIndex = calls.findIndex(([sql]) => isBoundedDelete(String(sql)));
  expect(auditIndex, `${diagnostic}\ncapture must precede audit`).toBeGreaterThan(captureCallIndex);
  expect(deleteIndex, `${diagnostic}\naudit must precede delete`).toBeGreaterThan(auditIndex);
}

describe('GET /api/setupbulkprocedure/[fileID]/[batchID]', () => {
  beforeEach(() => {
    const cm = ConnectionManager.getInstance() as any;
    cm.beginTransaction.mockResolvedValue(SUBBATCH_TRANSACTION_ID);
    cm.commitTransaction.mockResolvedValue(undefined);
    cm.rollbackTransaction.mockResolvedValue(undefined);
    requireUploadSessionOwnershipMock.mockResolvedValue(undefined);
    shouldRecoverFailedInitialCensus.mockReturnValue(false);
    moveTemporaryBatchToFailedMeasurements.mockResolvedValue(0);
  });

  it('requires an upload session header before processing batches', async () => {
    const res = await GET(makeRequest(false), makeProps());

    expect(res.status).toBe(HTTPResponses.CONFLICT);
    await expect(res.json()).resolves.toEqual({
      error: 'Upload session is required for batch processing'
    });
  });

  it('validates the discovered plot/census against the active upload session before processing', async () => {
    const cm = primeSetupBulkProcedureQueries();

    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(HTTPResponses.OK);
    expect(requireUploadSessionOwnershipMock).toHaveBeenCalledWith({
      schema: SCHEMA,
      sessionId: SESSION_ID,
      plotId: DISCOVERED_PLOT_ID,
      censusId: DISCOVERED_CENSUS_ID,
      allowedStates: ['uploaded', 'processing'],
      contextLabel: `batch processing for ${FILE_ID}-${BATCH_ID}`
    });
    expect(cm.acquireApplicationLock).toHaveBeenCalledTimes(1);
  });

  it("audits a newly committed sub-batch row against the after-CALL snapshot, inside the sub-batch's own transaction", async () => {
    const newRow = {
      CoreMeasurementID: 7001,
      StemGUID: null,
      CensusID: DISCOVERED_CENSUS_ID,
      MeasurementDate: '2026-01-01',
      MeasuredDBH: 12.3,
      MeasuredHOM: 1.3,
      Description: null,
      UploadFileID: FILE_ID,
      UploadBatchID: BATCH_ID,
      RawTreeTag: '1001',
      RawStemTag: '1',
      RawSpCode: 'FAGR',
      RawQuadrat: '0101',
      RawX: 10,
      RawY: 20,
      RawPlotX: 10,
      RawPlotY: 20,
      RawCodes: null,
      RawComments: null,
      SourceRowIndex: 1,
      IsActive: 1,
      IsValidated: 0
    };
    const cm = primeSetupBulkProcedureQueries({ subBatchRowsAfterCall: { [BATCH_ID]: [newRow] } });

    const res = await GET(makeRequest(), makeProps());
    expect(res.status).toBe(HTTPResponses.OK);

    const calls = cm.executeQuery.mock.calls as [string, unknown[], string?][];
    const order = cm.executeQuery.mock.invocationCallOrder as number[];
    const diagnostic = `executed SQL:\n${calls.map(([sql]) => String(sql)).join('\n')}`;

    const callIndex = calls.findIndex(([sql]) => String(sql).includes('bulkingestionprocess'));
    const auditIndex = calls.findIndex(
      ([sql, params]) =>
        String(sql).includes('.unifiedchangelog') &&
        String(sql).includes('OldRowState') &&
        String(sql).includes('NewRowState') &&
        (params as unknown[])[1] === newRow.CoreMeasurementID
    );
    expect(callIndex, diagnostic).toBeGreaterThan(-1);
    expect(auditIndex, diagnostic).toBeGreaterThan(-1);
    expect(calls[auditIndex][2]).toBe(SUBBATCH_TRANSACTION_ID);
    expect(order[auditIndex], 'audit must run after the CALL').toBeGreaterThan(order[callIndex]);

    expect(cm.commitTransaction).toHaveBeenCalledWith(SUBBATCH_TRANSACTION_ID);
    const commitOrder = cm.commitTransaction.mock.invocationCallOrder[0];
    expect(commitOrder, 'commit must run after the audit').toBeGreaterThan(order[auditIndex]);
    expect(cm.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('narrows failed first-load cleanup to temp rows tied to incomplete uploadmetrics batches, auditing the bounded census-wide capture', async () => {
    shouldRecoverFailedInitialCensus.mockReturnValue(true);
    const recoveredCoreMeasurementIDs = [9001, 9002];
    const cm = primeSetupBulkProcedureQueries({
      recoveryState: { completedUploads: 0, incompleteUploads: 1, treeCount: 1, stemCount: 1, coreMeasurementCount: 244 },
      recoveryCaptureIDs: recoveredCoreMeasurementIDs
    });

    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(HTTPResponses.OK);

    const calls = cm.executeQuery.mock.calls as [string, unknown[], string?][];
    const executedSql = calls.map(([sql]) => String(sql));
    const diagnostic = `executed SQL:\n${executedSql.join('\n')}`;

    expect(
      executedSql.some(
        sql =>
          sql.includes('DELETE tm') &&
          sql.includes(`INNER JOIN ${SCHEMA}.uploadmetrics um`) &&
          sql.includes("um.status IN ('failed', 'processing')") &&
          sql.includes('NOT (tm.FileID = ? AND tm.BatchID = ?)')
      ),
      diagnostic
    ).toBe(true);
    expect(
      executedSql.some(sql => sql.includes(`DELETE FROM ${SCHEMA}.temporarymeasurements WHERE PlotID = ? AND CensusID = ? AND NOT (FileID = ?)`)),
      diagnostic
    ).toBe(false);

    const captureIndex = calls.findIndex(
      ([sql]) => String(sql).includes('SELECT CoreMeasurementID FROM') && String(sql).includes('FOR UPDATE') && !String(sql).includes('StemGUID')
    );
    expect(captureIndex, diagnostic).toBeGreaterThan(-1);
    expect(calls[captureIndex][1]).toEqual([DISCOVERED_CENSUS_ID]);
    expect(calls[captureIndex][2]).toBe(PHASE1_TRANSACTION_ID);

    expectAuditedBoundedDelete(cm, captureIndex, recoveredCoreMeasurementIDs, diagnostic);
  });

  it('removes stale unresolved rows from prior same-file batches, auditing exactly the captured ids in the same transaction', async () => {
    const sameFileCoreMeasurementIDs = [5101, 5102, 5103];
    const cm = primeSetupBulkProcedureQueries({
      recoveryState: { completedUploads: 1, incompleteUploads: 0, treeCount: 0, stemCount: 0, coreMeasurementCount: 244 },
      sameFileCaptureIDs: sameFileCoreMeasurementIDs
    });

    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(HTTPResponses.OK);

    const calls = cm.executeQuery.mock.calls as [string, unknown[], string?][];
    const diagnostic = `executed SQL:\n${calls.map(([sql]) => String(sql)).join('\n')}`;

    const captureIndex = calls.findIndex(([sql]) => {
      const normalizedSql = String(sql);
      return (
        normalizedSql.includes('FOR UPDATE') &&
        normalizedSql.includes('StemGUID IS NULL') &&
        normalizedSql.includes('UploadFileID = ?') &&
        // Family-sparing exclusion: on a worker retry the batch ID is reused
        // and completed sub-batches' proc-recorded failure rows live under
        // suffixed IDs — a bare-ID exclusion would delete them permanently.
        normalizedSql.includes('NOT (UploadBatchID <=> ? OR UploadBatchID LIKE ?')
      );
    });
    expect(captureIndex, diagnostic).toBeGreaterThan(-1);
    expect(calls[captureIndex][1]).toEqual([DISCOVERED_CENSUS_ID, FILE_ID, BATCH_ID, SUB_BATCH_LIKE_PATTERN]);
    expect(calls[captureIndex][2]).toBe(PHASE1_TRANSACTION_ID);

    expectAuditedBoundedDelete(cm, captureIndex, sameFileCoreMeasurementIDs, diagnostic);
  });

  it('removes stale unresolved ingestion rows that match the current staged upload even when the file name changed', async () => {
    const crossFileCoreMeasurementIDs = [6201, 6202];
    const cm = primeSetupBulkProcedureQueries({
      recoveryState: { completedUploads: 1, incompleteUploads: 0, treeCount: 0, stemCount: 0, coreMeasurementCount: 244 },
      sameFileCaptureIDs: [],
      crossFileCandidateExists: true,
      crossFileCaptureIDs: crossFileCoreMeasurementIDs
    });

    const res = await GET(makeRequest(), makeProps());

    expect(res.status).toBe(HTTPResponses.OK);

    const calls = cm.executeQuery.mock.calls as [string, unknown[], string?][];
    const diagnostic = `executed SQL:\n${calls.map(([sql]) => String(sql)).join('\n')}`;

    const candidateCall = calls.find(([sql]) => String(sql).trim().startsWith('SELECT 1'));
    expect(candidateCall, diagnostic).toBeDefined();

    const captureIndex = calls.findIndex(([sql]) => {
      const normalizedSql = String(sql);
      return (
        normalizedSql.includes('DISTINCT cm.CoreMeasurementID') &&
        normalizedSql.includes(`JOIN ${SCHEMA}.measurement_error_log mel`) &&
        normalizedSql.includes("me.ErrorSource = 'ingestion'") &&
        normalizedSql.includes(`JOIN ${SCHEMA}.temporarymeasurements tm`) &&
        normalizedSql.includes('tm.FileID = ?') &&
        normalizedSql.includes('tm.BatchID = ?') &&
        // Family-sparing (see the same-file cleanup test above).
        normalizedSql.includes('NOT (cm.UploadFileID <=> ? AND (cm.UploadBatchID <=> ? OR cm.UploadBatchID LIKE ?')
      );
    });
    expect(captureIndex, diagnostic).toBeGreaterThan(-1);
    expect(calls[captureIndex][1]).toEqual([FILE_ID, BATCH_ID, DISCOVERED_CENSUS_ID, FILE_ID, BATCH_ID, SUB_BATCH_LIKE_PATTERN]);
    expect(calls[captureIndex][2]).toBe(PHASE1_TRANSACTION_ID);

    expectAuditedBoundedDelete(cm, captureIndex, crossFileCoreMeasurementIDs, diagnostic);
  });

  // 2026-07-27 Harvard Forest incident: an unsuffixed-ID-only lookup after a
  // split returned a false "No data found" over still-staged rows.
  describe('resuming a batch whose rows were renamed into sub-batches', () => {
    const ORPHANED_SUB_BATCHES = [
      { BatchID: 'batch-1__sub001', rowCount: 10_000 },
      { BatchID: 'batch-1__sub002', rowCount: 96_227 }
    ];

    it('authorizes the orphaned rows’ scope instead of returning early', async () => {
      primeSetupBulkProcedureQueries({ familyMembers: ORPHANED_SUB_BATCHES });

      const res = await GET(makeRequest(), makeProps());
      const body = await res.json();

      expect(res.status).toBe(HTTPResponses.OK);
      // The regression: this must NOT be the 31ms no-op.
      expect(body.message).not.toBe('No data found');
      expect(requireUploadSessionOwnershipMock).toHaveBeenCalledWith(
        expect.objectContaining({ schema: SCHEMA, plotId: DISCOVERED_PLOT_ID, censusId: DISCOVERED_CENSUS_ID, sessionId: SESSION_ID })
      );
    });

    it('runs the stored procedure once per orphaned sub-batch, in lexical order', async () => {
      const cm = primeSetupBulkProcedureQueries({ familyMembers: ORPHANED_SUB_BATCHES });

      const res = await GET(makeRequest(), makeProps());
      const body = await res.json();

      const procedureCalls = cm.executeQuery.mock.calls.filter(([sql]: [string]) => String(sql).includes('bulkingestionprocess'));
      expect(procedureCalls.map(([, params]: [string, string[]]) => params[1])).toEqual(['batch-1__sub001', 'batch-1__sub002']);
      expect(body.subBatchCount).toBe(ORPHANED_SUB_BATCHES.length);
    });

    it('does not re-split orphaned sub-batches into new ones', async () => {
      const cm = primeSetupBulkProcedureQueries({ familyMembers: ORPHANED_SUB_BATCHES });

      await GET(makeRequest(), makeProps());

      const splitCalls = cm.executeQuery.mock.calls.filter(([sql]: [string]) => String(sql).includes(`UPDATE ${SCHEMA}.temporarymeasurements SET BatchID = ?`));
      expect(splitCalls).toHaveLength(0);
    });

    it('matches the sub-batch family with an escaped LIKE pattern and explicit ESCAPE', async () => {
      const cm = primeSetupBulkProcedureQueries({ familyMembers: ORPHANED_SUB_BATCHES });

      await GET(makeRequest(), makeProps());

      const familyCall = cm.executeQuery.mock.calls.find(([sql]: [string]) => String(sql).includes('GROUP BY BatchID'));
      expect(familyCall, 'expected discoverBatchFamily to have run').toBeDefined();
      const [familySQL, familyParams] = familyCall as [string, unknown[]];
      expect(String(familySQL)).toContain('BatchID = ? OR BatchID LIKE ?');
      expect(String(familySQL)).toContain("ESCAPE '\\\\'");
      // The separator's underscores are escaped so the pattern cannot match
      // an unrelated batch whose name happens to fit `??sub`.
      expect(familyParams).toEqual([FILE_ID, BATCH_ID, SUB_BATCH_LIKE_PATTERN]);
    });

    it('still reports "No data found" when the whole family is genuinely empty', async () => {
      primeSetupBulkProcedureQueries({ familyMembers: [] });

      const res = await GET(makeRequest(), makeProps());

      expect(res.status).toBe(HTTPResponses.OK);
      await expect(res.json()).resolves.toEqual({ attemptsNeeded: 0, batchFailedButHandled: false, message: 'No data found' });
      expect(requireUploadSessionOwnershipMock).not.toHaveBeenCalled();
    });
  });
});
