import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { SETUP_FAILURE_CODES, setupFailureSummary } from '@/lib/uploads/setup-failure';
import { CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE } from '@/lib/ingestion/temporary-measurements';

const { loggerInfo, loggerDebug, loggerWarn, loggerError } = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerDebug: vi.fn(),
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
    debug: loggerDebug,
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
const DRIFTED_PLOT_ID = 23;
const SUB_BATCH_LIKE_PATTERN = 'batch-1\\_\\_sub%';

/**
 * One grouped row per batch-family member, matching discoverBatchFamily's
 * SELECT. Both the route preamble and ingestBatch's setup run that same query.
 */
function familyRows(
  members: Array<{ BatchID: string; rowCount: number }> = [{ BatchID: BATCH_ID, rowCount: 5 }],
  plotID: number = DISCOVERED_PLOT_ID,
  censusID: number = DISCOVERED_CENSUS_ID
) {
  return members.map(member => ({ ...member, PlotID: plotID, CensusID: censusID, plotCount: 1, censusCount: 1 }));
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
  // Rows the fixture has "deleted": every later read, confirmation and lock statement stops returning them,
  // exactly as the database would once the bounded DELETE ran.
  const deletedCoreMeasurementIDs = new Set<number>();
  const configuredCaptureIDs = new Set<number>([
    ...(options.recoveryCaptureIDs ?? []),
    ...(options.sameFileCaptureIDs ?? []),
    ...(options.crossFileCaptureIDs ?? [])
  ]);
  const remaining = (rows: Array<{ CoreMeasurementID: number }>) => rows.filter(row => !deletedCoreMeasurementIDs.has(row.CoreMeasurementID));

  cm.acquireApplicationLock.mockResolvedValue(true);
  let withTransactionCalls = 0;
  cm.withTransaction.mockImplementation(async (fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown>; id: string }) => Promise<unknown>) => {
    withTransactionCalls += 1;
    const id = `tx-${withTransactionCalls}`;
    return fn({ query: (sql: string, params?: unknown[]) => cm.executeQuery(sql, params, id), id });
  });

  cm.executeQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const text = String(sql);

    if (text.includes('.temporarymeasurements') && text.includes('GROUP BY BatchID')) return familyRows(familyMembers);
    if (/\.census WHERE CensusID = \? FOR UPDATE/.test(text)) return [{ CensusID: params[0] }];
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

    // deleteCoreMeasurementsInBoundedChunksWithAudit's bounded DELETE: params are exactly the locked ids.
    if (text.trimStart().toUpperCase().startsWith('DELETE FROM') && text.includes('.coremeasurements') && text.includes('CoreMeasurementID IN')) {
      for (const id of params) deletedCoreMeasurementIDs.add(Number(id));
      return { affectedRows: params.length };
    }

    // A window's lock statement (primary-key hint, explicit id list): it finds the requested ids that a cleanup
    // was configured to capture and that are not deleted yet.
    if (text.includes('/*+') && text.includes('CoreMeasurementID IN')) {
      return coreMeasurementIdRows(
        params.filter((value): value is number => typeof value === 'number' && configuredCaptureIDs.has(value) && !deletedCoreMeasurementIDs.has(value))
      );
    }

    // The walk's read and its locking confirmation, per cleanup; most specific predicate first.
    if (text.includes('DISTINCT cm.CoreMeasurementID')) return remaining(crossFileCaptureRows);
    if (text.includes('StemGUID IS NULL') && text.includes('UploadFileID = ?')) return remaining(sameFileCaptureRows);
    if (text.includes('SELECT CoreMeasurementID FROM') && !text.includes('StemGUID')) return remaining(recoveryCaptureRows);

    if (text.trim().startsWith('SELECT 1')) return crossFileCandidateExists ? [{ 1: 1 }] : [];

    if (text.trimStart().toUpperCase().startsWith('DELETE')) return {};
    if (text.includes('UPDATE') && text.includes('.temporarymeasurements')) return { affectedRows: 0 };
    return [];
  });

  return cm;
}

const WALK_CONFIRMATION_PATTERN = new RegExp(`LIMIT ${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE}\\s+FOR UPDATE(?: OF [\\w, ]+)?\\s*$`);

interface WalkStatementIndexes {
  readIndex: number;
  lockIndex: number;
  confirmationIndex: number;
}

/**
 * Finds, among the statements `isScopeStatement` recognises, the walk's one unlocked read, its first window lock
 * (recognised by the primary-key hint) and its locking confirmation (recognised by `LIMIT <window> FOR UPDATE`).
 */
function locateWalkStatements(calls: [string, unknown[], string?][], isScopeStatement: (sql: string) => boolean, diagnostic: string): WalkStatementIndexes {
  const indexOfScope = (matches: (sql: string) => boolean) => calls.findIndex(([sql]) => isScopeStatement(String(sql)) && matches(String(sql)));
  const indexes = {
    readIndex: indexOfScope(sql => /^\s*SELECT/.test(sql) && !sql.includes('FOR UPDATE') && !sql.includes('/*+')),
    lockIndex: indexOfScope(sql => sql.includes('/*+')),
    confirmationIndex: indexOfScope(sql => WALK_CONFIRMATION_PATTERN.test(sql))
  };
  expect(
    Object.values(indexes).every(index => index > -1),
    `${diagnostic}\nwalk statement indexes: ${JSON.stringify(indexes)}`
  ).toBe(true);
  expect(indexes.readIndex, `${diagnostic}\nread precedes lock`).toBeLessThan(indexes.lockIndex);
  expect(indexes.lockIndex, `${diagnostic}\nlock precedes confirmation`).toBeLessThan(indexes.confirmationIndex);
  return indexes;
}

/**
 * Shared assertion for the three audited bounded-delete cleanups (recovery,
 * same-file, cross-file): finds the sole OldRowState-only unifiedchangelog
 * audit INSERT and the sole bounded coremeasurements DELETE, requires both to
 * target exactly `expectedIDs` on `expectedTransactionID`, and lock < audit <
 * delete in call order — proving the audit runs before the delete, not just
 * that both happened somewhere. Requiring exactly one of each also proves no
 * delete ran against ids outside `expectedIDs`.
 */
function expectAuditedBoundedDelete(cm: any, lockCallIndex: number, expectedIDs: number[], expectedTransactionID: string, diagnostic: string): void {
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
  expect(auditTx, diagnostic).toBe(expectedTransactionID);
  expect(deleteTx, diagnostic).toBe(expectedTransactionID);

  const auditIndex = calls.findIndex(([sql]) => isAuditInsert(String(sql)));
  const deleteIndex = calls.findIndex(([sql]) => isBoundedDelete(String(sql)));
  expect(auditIndex, `${diagnostic}\nlock must precede audit`).toBeGreaterThan(lockCallIndex);
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

  it('rejects scope drift between upload-session authorization and setup entry', async () => {
    const cm = primeSetupBulkProcedureQueries();
    const fixture = cm.executeQuery.getMockImplementation();
    let familyReads = 0;
    cm.executeQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (!String(sql).includes('GROUP BY BatchID')) return fixture(sql, params);
      familyReads++;
      return familyReads === 1 ? familyRows() : familyRows([{ BatchID: BATCH_ID, rowCount: 5 }], DRIFTED_PLOT_ID);
    });

    const res = await GET(makeRequest(), makeProps());

    expect(requireUploadSessionOwnershipMock).toHaveBeenCalledWith(expect.objectContaining({ plotId: DISCOVERED_PLOT_ID, censusId: DISCOVERED_CENSUS_ID }));
    expect(res.status).toBe(HTTPResponses.SERVICE_UNAVAILABLE);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining(`expected plot=${DISCOVERED_PLOT_ID}, census=${DISCOVERED_CENSUS_ID}`)
    });
    expect(cm.executeQuery.mock.calls.some(([sql]: [string]) => String(sql).includes('bulkingestionprocess'))).toBe(false);
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

  it('recovers a dirty failed first-load census in its own transactions before setup, auditing the held-back slice and narrowing the staged-row cleanup to incomplete uploadmetrics batches', async () => {
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
          sql.includes('NOT (tm.FileID = ? AND (tm.BatchID = ? OR tm.BatchID LIKE ?')
      ),
      diagnostic
    ).toBe(true);
    expect(
      executedSql.some(sql => sql.includes(`DELETE FROM ${SCHEMA}.temporarymeasurements WHERE PlotID = ? AND CensusID = ? AND NOT (FileID = ?)`)),
      diagnostic
    ).toBe(false);

    const censusLockCall = calls.find(([sql]) => /\.census WHERE CensusID = \? FOR UPDATE/.test(String(sql)));
    expect(censusLockCall, diagnostic).toBeDefined();
    const recoveryTransactionID = String(censusLockCall![2]);
    const setupTransactionID = String(cm.acquireApplicationLock.mock.calls[0][1]);
    expect(recoveryTransactionID, 'the recovery runs in its own transaction').not.toBe(setupTransactionID);
    expect(
      calls.find(
        ([sql, , transactionID]) => /^\s*SELECT CoreMeasurementID FROM/.test(String(sql)) && transactionID === undefined && !String(sql).includes('LIMIT')
      ),
      'one scope read outside any transaction'
    ).toBeDefined();
    const lockIndex = calls.findIndex(([sql]) => String(sql).includes('/*+ INDEX(coremeasurements PRIMARY) */') && String(sql).includes('(CensusID = ?)'));
    expect(lockIndex, diagnostic).toBeGreaterThan(-1);
    expect(calls[lockIndex][1]).toEqual([DISCOVERED_CENSUS_ID, ...recoveredCoreMeasurementIDs]);
    expect(calls[lockIndex][2]).toBe(recoveryTransactionID);

    expectAuditedBoundedDelete(cm, lockIndex, recoveredCoreMeasurementIDs, recoveryTransactionID, diagnostic);
    const setupDeletes = calls.filter(([sql, , transactionID]) => transactionID === setupTransactionID && /^\s*DELETE/i.test(String(sql)));
    expect(
      setupDeletes.map(([sql]) => String(sql)),
      'setup runs no recovery DELETE'
    ).toEqual([]);
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

    const sameFileScopeParams = [DISCOVERED_CENSUS_ID, FILE_ID, BATCH_ID, SUB_BATCH_LIKE_PATTERN];
    const { readIndex, lockIndex, confirmationIndex } = locateWalkStatements(
      calls,
      normalizedSql =>
        normalizedSql.includes('StemGUID IS NULL') &&
        normalizedSql.includes('UploadFileID = ?') &&
        // Family-sparing exclusion: on a worker retry the batch ID is reused
        // and completed sub-batches' proc-recorded failure rows live under
        // suffixed IDs — a bare-ID exclusion would delete them permanently.
        normalizedSql.includes('NOT (UploadBatchID <=> ? OR UploadBatchID LIKE ?'),
      diagnostic
    );
    expect(calls[readIndex][1]).toEqual(sameFileScopeParams);
    expect(calls[lockIndex][1]).toEqual([...sameFileScopeParams, ...sameFileCoreMeasurementIDs]);
    expect(calls[confirmationIndex][1]).toEqual(sameFileScopeParams);
    expect(calls[lockIndex][2]).toBe(PHASE1_TRANSACTION_ID);

    expectAuditedBoundedDelete(cm, lockIndex, sameFileCoreMeasurementIDs, PHASE1_TRANSACTION_ID, diagnostic);
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

    // The JOIN binds the incoming family (FileID, BatchID, LIKE pattern) before the WHERE's census and exclusion params.
    const crossFileScopeParams = [FILE_ID, BATCH_ID, SUB_BATCH_LIKE_PATTERN, DISCOVERED_CENSUS_ID, FILE_ID, BATCH_ID, SUB_BATCH_LIKE_PATTERN];
    const { readIndex, lockIndex, confirmationIndex } = locateWalkStatements(
      calls,
      normalizedSql =>
        normalizedSql.includes('DISTINCT cm.CoreMeasurementID') &&
        normalizedSql.includes(`JOIN ${SCHEMA}.measurement_error_log mel`) &&
        normalizedSql.includes("me.ErrorSource = 'ingestion'") &&
        normalizedSql.includes(`JOIN ${SCHEMA}.temporarymeasurements tm`) &&
        normalizedSql.includes('tm.FileID = ?') &&
        normalizedSql.includes('tm.BatchID = ?') &&
        // Family-sparing (see the same-file cleanup test above).
        normalizedSql.includes('NOT (cm.UploadFileID <=> ? AND (cm.UploadBatchID <=> ? OR cm.UploadBatchID LIKE ?'),
      diagnostic
    );
    expect(calls[readIndex][1]).toEqual(crossFileScopeParams);
    expect(calls[lockIndex][1]).toEqual([...crossFileScopeParams, ...crossFileCoreMeasurementIDs]);
    expect(calls[confirmationIndex][1]).toEqual(crossFileScopeParams);
    expect(calls[lockIndex][2]).toBe(PHASE1_TRANSACTION_ID);

    const crossFileLockingStatements = calls
      .map(([sql]) => String(sql))
      .filter(sql => sql.includes('DISTINCT cm.CoreMeasurementID') && sql.includes('FOR UPDATE'));
    console.log(`[R1 cross-file locks]\n${crossFileLockingStatements.map(sql => sql.replace(/\s+/g, ' ').slice(-60)).join('\n')}`);
    expect(crossFileLockingStatements.length, `${diagnostic}\nexpected a window lock and a confirmation`).toBe(2);
    for (const sql of crossFileLockingStatements) {
      expect(sql, 'C3 locks only measurement and link rows (spec D11)').toMatch(/FOR UPDATE OF cm, mel\s*$/);
    }

    expectAuditedBoundedDelete(cm, lockIndex, crossFileCoreMeasurementIDs, PHASE1_TRANSACTION_ID, diagnostic);
  });

  // 2026-07-27 Harvard Forest incident: an unsuffixed-ID-only lookup after a
  // split returned a false "No data found" over still-staged rows.
  describe('resuming a batch whose rows were renamed into sub-batches', () => {
    // Each member holds at most one batch of rows: setup rejects a larger member.
    const ORPHANED_SUB_BATCHES = [
      { BatchID: 'batch-1__sub001', rowCount: 10_000 },
      { BatchID: 'batch-1__sub002', rowCount: 6_227 }
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

    it('treats sub-batch members as the normal staged shape and does not warn about recovery', async () => {
      primeSetupBulkProcedureQueries({ familyMembers: ORPHANED_SUB_BATCHES });
      loggerWarn.mockClear();

      const res = await GET(makeRequest(), makeProps());

      expect(res.status).toBe(HTTPResponses.OK);
      const orphanWarnings = loggerWarn.mock.calls.filter(([message]) => /orphan/i.test(String(message)));
      expect(orphanWarnings, `unexpected orphan warnings: ${JSON.stringify(orphanWarnings)}`).toEqual([]);
      expect(loggerDebug).toHaveBeenCalledWith(expect.stringContaining('sub-batch member(s)'));
    });

    it('answers an oversized member with a permanent 422 and never calls the procedure', async () => {
      const OVERSIZED_MEMBER_ROWS = 96_227;
      const cm = primeSetupBulkProcedureQueries({
        familyMembers: [ORPHANED_SUB_BATCHES[0], { BatchID: 'batch-1__sub002', rowCount: OVERSIZED_MEMBER_ROWS }]
      });

      const res = await GET(makeRequest(), makeProps());
      const body = await res.json();
      console.log('[oversized member] status:', res.status, 'body:', body);

      expect(res.status).toBe(HTTPResponses.UNPROCESSABLE_ENTITY);
      expect(body).toEqual({
        error: setupFailureSummary(SETUP_FAILURE_CODES.oversizedSubBatch),
        code: SETUP_FAILURE_CODES.oversizedSubBatch
      });
      expect(cm.executeQuery.mock.calls.some(([sql]: [string]) => String(sql).includes('bulkingestionprocess'))).toBe(false);
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
