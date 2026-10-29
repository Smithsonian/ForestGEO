// lib/uploads/ingest-batch.test.ts
//
// Unit tests for the failed-first-census recovery (#562) and its place before ingestBatch's setup.
// No database: a scripted ConnectionManager double classifies every statement, answers it from a script,
// records it with its transaction id, and hands each withTransaction call its own id. Every assertion prints
// the statement log, so a failure shows exactly which statement ran where.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ manager: null as unknown }));
const { errorLogMock } = vi.hoisted(() => ({ errorLogMock: vi.fn() }));

vi.mock('@/lib/db/connectionmanager', () => ({ default: { getInstance: () => state.manager } }));
vi.mock('@/lib/db/sqlsecurity', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/db/sqlsecurity')>();
  return { ...actual, safeFormatQuery: (schema: string, sql: string) => sql.replace(/\?\?/g, schema) };
});
vi.mock('@/lib/batchfailuretransfer', () => ({ moveTemporaryBatchToFailedMeasurements: vi.fn() }));
vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: errorLogMock, debug: vi.fn() } }));
vi.mock('@/lib/db/primitives', () => ({
  QueryTimeoutError: class QueryTimeoutError extends Error {},
  isKilledConnectionError: () => false,
  isKilledStatementError: () => false
}));

import type ConnectionManager from '@/lib/db/connectionmanager';
import { CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE } from '@/lib/ingestion/temporary-measurements';
import { CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS } from '@/lib/uploads/stage-measurements';
import { BatchFamilyScopeError, getIngestionBatchSize } from '@/lib/uploads/batch-family';
import { MYSQL_DEADLOCK_ERRNO, MYSQL_DEADLOCK_ERROR_CODE } from '@/lib/db/deadlock-retry';
import {
  FAILED_CENSUS_RECOVERY_FAILED_EVENT,
  FAILED_CENSUS_RECOVERY_FINAL_READ_LIMIT,
  OversizedSubBatchError,
  recoverFailedInitialCensusInBoundedTransactions,
  SETUP_PHASE_TIMEOUT_MS,
  type FailedCensusRecoveryParams
} from './ingest-batch';

const WINDOW = CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE;
const SCHEMA = 'forestgeo_testing';
const FILE_ID = 'incoming.csv';
const BATCH_ID = 'incoming-batch';
const PLOT_ID = 5;
const CENSUS_ID = 7;
const OTHER_CENSUS_ID = 99;
const CHANGED_BY = 'recovery-unit-test';
const HELD_BACK_ROWS = 5;
const STAGED_INCOMING_ROWS = 4;
const AUDIT_PREFIX_PARAM_COUNT = 3; // [changedBy, plotID, censusID, ...ids]
const FAILED_SUB_BATCHES = 42;
const LOCK_WAIT_TIMEOUT = { code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205 } as const;

const RECOVERY_PARAMS: FailedCensusRecoveryParams = {
  schema: SCHEMA,
  fileID: FILE_ID,
  batchID: BATCH_ID,
  plotID: PLOT_ID,
  censusID: CENSUS_ID,
  changedBy: CHANGED_BY
};
const DUE_WITH_ONLY_RESIDUAL_MEASUREMENTS = {
  completedUploads: 0,
  incompleteUploads: FAILED_SUB_BATCHES,
  treeCount: 0,
  stemCount: 0,
  coreMeasurementCount: 2 * WINDOW + HELD_BACK_ROWS
};
const NOT_DUE = { completedUploads: 1, incompleteUploads: 0, treeCount: 0, stemCount: 0, coreMeasurementCount: HELD_BACK_ROWS };
const INCOMING_FAMILY = [{ BatchID: BATCH_ID, PlotID: PLOT_ID, CensusID: CENSUS_ID, rowCount: STAGED_INCOMING_ROWS, plotCount: 1, censusCount: 1 }];

export type RecoveryStatementKind =
  | 'state_read'
  | 'guard'
  | 'census_lock'
  | 'family_discovery'
  | 'recovery_scope_read'
  | 'final_read'
  | 'recovery_window_lock'
  | 'delete_audit'
  | 'measurement_delete'
  | 'summary_delete'
  | 'stems_delete'
  | 'trees_delete'
  | 'staged_delete'
  | 'alerts_delete'
  | 'metrics_delete'
  | 'other';

const STATEMENT_KIND_PATTERNS: ReadonlyArray<readonly [RecoveryStatementKind, RegExp]> = [
  ['state_read', /AS completedUploads,[\s\S]*AS coreMeasurementCount/],
  ['guard', /^\s*SELECT COUNT\(\*\) AS completedUploads FROM \S+\.uploadmetrics/],
  ['census_lock', /^\s*SELECT CensusID FROM \S+\.census WHERE CensusID = \? FOR UPDATE\s*$/],
  ['family_discovery', /GROUP BY BatchID/],
  ['recovery_scope_read', /^\s*SELECT CoreMeasurementID FROM \S+\.coremeasurements\s+WHERE CensusID = \?\s+ORDER BY CoreMeasurementID\s*$/],
  ['final_read', /^\s*SELECT CoreMeasurementID FROM \S+\.coremeasurements WHERE CensusID = \? ORDER BY CoreMeasurementID LIMIT \d+\s*$/],
  [
    'recovery_window_lock',
    /^\s*SELECT \/\*\+ INDEX\(coremeasurements PRIMARY\) \*\/ CoreMeasurementID FROM \S+\.coremeasurements\s+WHERE \(CensusID = \?\) AND CoreMeasurementID IN/
  ],
  ['delete_audit', /^\s*INSERT INTO \S+\.unifiedchangelog/],
  ['measurement_delete', /^\s*DELETE FROM \S+\.coremeasurements WHERE CoreMeasurementID IN/],
  ['summary_delete', /^\s*DELETE FROM \S+\.measurementssummary/],
  ['stems_delete', /^\s*DELETE FROM \S+\.stems WHERE CensusID/],
  ['trees_delete', /^\s*DELETE FROM \S+\.trees WHERE CensusID/],
  ['staged_delete', /^\s*DELETE tm\s+FROM \S+\.temporarymeasurements tm/],
  ['alerts_delete', /^\s*DELETE FROM \S+\.uploadintegrityalerts/],
  ['metrics_delete', /^\s*DELETE FROM \S+\.uploadmetrics WHERE PlotID = \? AND CensusID = \?/]
];

const DESTRUCTIVE_KINDS: ReadonlySet<RecoveryStatementKind> = new Set([
  'recovery_window_lock',
  'delete_audit',
  'measurement_delete',
  'summary_delete',
  'stems_delete',
  'trees_delete',
  'staged_delete',
  'alerts_delete',
  'metrics_delete'
]);
const WINDOW_TRANSACTION_KINDS: RecoveryStatementKind[] = ['census_lock', 'guard', 'recovery_window_lock', 'delete_audit', 'measurement_delete'];
const FINAL_RESIDUE_KINDS: RecoveryStatementKind[] = ['summary_delete', 'stems_delete', 'trees_delete', 'staged_delete', 'alerts_delete', 'metrics_delete'];
const FINAL_TRANSACTION_KINDS: RecoveryStatementKind[] = [
  'census_lock',
  'guard',
  'final_read',
  'recovery_window_lock',
  'delete_audit',
  'measurement_delete',
  ...FINAL_RESIDUE_KINDS
];

function classifyRecoveryStatement(sql: string): RecoveryStatementKind {
  return STATEMENT_KIND_PATTERNS.find(([, pattern]) => pattern.test(sql))?.[0] ?? 'other';
}

interface RecordedStatement {
  kind: RecoveryStatementKind;
  sql: string;
  params: unknown[];
  transactionID: string | undefined;
}
interface RecordedTransaction {
  id: string;
  timeoutMs: number | undefined;
  end: 'open' | 'committed' | 'rolled_back';
}
interface RecoveryScript {
  recoveryState: Record<string, number>;
  familyRows?: Array<Record<string, unknown>>;
  scopeReads?: number[][];
  finalReads?: number[][];
  guardCompletedUploads?: number[];
  censusRowExists?: boolean;
  /** Throws `makeError()` instead of running the `occurrence`-th (1-based) statement of `kind`, counted over the whole call. */
  failure?: { kind: RecoveryStatementKind; occurrence: number; makeError: () => Error };
}

function sequentialIDs(count: number, first = 1): number[] {
  return Array.from({ length: count }, (_, index) => first + index);
}

function idRows(ids: number[]) {
  return ids.map(id => ({ CoreMeasurementID: id }));
}

function deadlockShapedError(): Error {
  return Object.assign(new Error('Deadlock found when trying to get lock; try restarting transaction'), {
    code: MYSQL_DEADLOCK_ERROR_CODE,
    errno: MYSQL_DEADLOCK_ERRNO
  });
}

function createRecoveryHarness(script: RecoveryScript) {
  const statements: RecordedStatement[] = [];
  const transactions: RecordedTransaction[] = [];
  const scopeReads = [...(script.scopeReads ?? [])];
  const finalReads = [...(script.finalReads ?? [])];
  const guardResults = [...(script.guardCompletedUploads ?? [])];
  const seenByKind = new Map<RecoveryStatementKind, number>();

  const render = () =>
    statements
      .map(
        statement =>
          `${statement.transactionID ?? 'no-tx'} ${statement.kind} ${statement.sql.replace(/\s+/g, ' ').slice(0, 110)} params#${statement.params.length}`
      )
      .join('\n');

  const takeScripted = (queue: number[][], label: string): number[] => {
    const next = queue.shift();
    if (!next) throw new Error(`the recovery issued an unscripted ${label}. Log:\n${render()}`);
    return next;
  };

  const respond = (kind: RecoveryStatementKind, sql: string, params: unknown[]): unknown => {
    switch (kind) {
      case 'state_read':
        return [script.recoveryState];
      case 'family_discovery':
        return script.familyRows ?? INCOMING_FAMILY;
      case 'recovery_scope_read':
        return idRows(takeScripted(scopeReads, 'scope read'));
      case 'final_read':
        return idRows(takeScripted(finalReads, 'final read'));
      case 'census_lock':
        return script.censusRowExists === false ? [] : [{ CensusID: CENSUS_ID }];
      case 'guard':
        return [{ completedUploads: guardResults.shift() ?? 0 }];
      case 'recovery_window_lock':
        return idRows(params.slice(1) as number[]);
      case 'delete_audit':
        return { affectedRows: params.length - AUDIT_PREFIX_PARAM_COUNT };
      case 'measurement_delete':
        return { affectedRows: params.length };
      default:
        return /^\s*SELECT/i.test(sql) ? [] : { affectedRows: 0 };
    }
  };

  const executeQuery = vi.fn(async (sql: string, params: unknown[] = [], transactionID?: string) => {
    const kind = classifyRecoveryStatement(String(sql));
    const occurrence = (seenByKind.get(kind) ?? 0) + 1;
    seenByKind.set(kind, occurrence);
    statements.push({ kind, sql: String(sql), params, transactionID });
    if (script.failure && script.failure.kind === kind && script.failure.occurrence === occurrence) throw script.failure.makeError();
    return respond(kind, String(sql), params);
  });

  const withTransaction = vi.fn(
    async (fn: (tx: { id: string; query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<unknown>, options?: { timeoutMs?: number }) => {
      const record: RecordedTransaction = { id: `tx-${transactions.length + 1}`, timeoutMs: options?.timeoutMs, end: 'open' };
      transactions.push(record);
      try {
        const result = await fn({ id: record.id, query: (sql, params) => executeQuery(sql, params ?? [], record.id) });
        record.end = 'committed';
        return result;
      } catch (error: unknown) {
        record.end = 'rolled_back';
        throw error;
      }
    }
  );

  const manager = {
    executeQuery,
    withTransaction,
    acquireApplicationLock: vi.fn(async () => true),
    beginTransaction: vi.fn(async () => 'tx-subbatch'),
    commitTransaction: vi.fn(async () => undefined),
    rollbackTransaction: vi.fn(async () => undefined),
    discardTransaction: vi.fn(async () => undefined)
  };

  return {
    manager: manager as unknown as ConnectionManager,
    raw: manager,
    statements,
    transactions,
    render,
    kindsIn: (transactionID: string | undefined) => statements.filter(statement => statement.transactionID === transactionID).map(statement => statement.kind),
    paramsOf: (transactionID: string, kind: RecoveryStatementKind) =>
      statements.filter(statement => statement.transactionID === transactionID && statement.kind === kind).map(statement => statement.params)
  };
}

describe('recoverFailedInitialCensusInBoundedTransactions (#562)', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  it('U7a: runs every slice but the last as its own window transaction and holds the last slice back into the final transaction with all residue (catches: one transaction for everything; no held-back slice; census lock or guard missing or after a destructive statement)', async () => {
    const scopeIDs = sequentialIDs(2 * WINDOW + HELD_BACK_ROWS);
    const heldBack = scopeIDs.slice(2 * WINDOW);
    const harness = createRecoveryHarness({ recoveryState: DUE_WITH_ONLY_RESIDUAL_MEASUREMENTS, scopeReads: [scopeIDs], finalReads: [heldBack] });

    const result = await recoverFailedInitialCensusInBoundedTransactions(harness.manager, RECOVERY_PARAMS);
    console.log(`[U7a] result=${JSON.stringify(result)} transactions=${JSON.stringify(harness.transactions)}\n${harness.render()}`);

    expect(result).toMatchObject({ outcome: 'recovered', deletedRows: scopeIDs.length, windowCount: 2, deadlockRetries: 0 });
    expect(harness.kindsIn(undefined), 'outside any transaction: the state read, the non-locking discovery, the one scope read').toEqual([
      'state_read',
      'family_discovery',
      'recovery_scope_read'
    ]);
    expect(harness.transactions.map(transaction => [transaction.timeoutMs, transaction.end])).toEqual([
      [CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS, 'committed'],
      [CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS, 'committed'],
      [SETUP_PHASE_TIMEOUT_MS, 'committed']
    ]);
    expect(harness.kindsIn('tx-1'), harness.render()).toEqual(WINDOW_TRANSACTION_KINDS);
    expect(harness.kindsIn('tx-2'), harness.render()).toEqual(WINDOW_TRANSACTION_KINDS);
    expect(harness.kindsIn('tx-3'), harness.render()).toEqual(FINAL_TRANSACTION_KINDS);
    expect(harness.paramsOf('tx-1', 'recovery_window_lock')).toEqual([[CENSUS_ID, ...scopeIDs.slice(0, WINDOW)]]);
    expect(harness.paramsOf('tx-2', 'recovery_window_lock')).toEqual([[CENSUS_ID, ...scopeIDs.slice(WINDOW, 2 * WINDOW)]]);
    expect(harness.paramsOf('tx-3', 'recovery_window_lock')).toEqual([[CENSUS_ID, ...heldBack]]);
    const finalRead = harness.statements.find(statement => statement.kind === 'final_read')!;
    expect(finalRead.sql).toContain(`LIMIT ${FAILED_CENSUS_RECOVERY_FINAL_READ_LIMIT}`);
    expect(FAILED_CENSUS_RECOVERY_FINAL_READ_LIMIT).toBe(WINDOW + 1);
    const stagedDelete = harness.statements.find(statement => statement.kind === 'staged_delete')!;
    expect(stagedDelete.params, 'the incoming family is spared').toEqual([PLOT_ID, CENSUS_ID, FILE_ID, BATCH_ID, `${BATCH_ID}\\_\\_sub%`]);
  });

  it.each([
    ['window 2', [0, 1], 'tx-2', WINDOW, 1],
    ['the final transaction', [0, 0, 1], 'tx-3', 2 * WINDOW, 2]
  ])(
    'U8a: a completed upload seen by the guard in %s ends the recovery there with nothing deleted in it (catches: guard checked once, or after deleting)',
    async (_label, guardCompletedUploads, supersededTransaction, deletedBefore, windowsCommitted) => {
      const scopeIDs = sequentialIDs(2 * WINDOW + HELD_BACK_ROWS);
      const harness = createRecoveryHarness({
        recoveryState: DUE_WITH_ONLY_RESIDUAL_MEASUREMENTS,
        scopeReads: [scopeIDs],
        finalReads: [scopeIDs.slice(2 * WINDOW)],
        guardCompletedUploads
      });

      const result = await recoverFailedInitialCensusInBoundedTransactions(harness.manager, RECOVERY_PARAMS);
      console.log(`[U8a ${supersededTransaction}] result=${JSON.stringify(result)}\n${harness.render()}`);

      expect(result).toMatchObject({ outcome: 'superseded', deletedRows: deletedBefore, windowCount: windowsCommitted });
      expect(harness.kindsIn(supersededTransaction)).toEqual(['census_lock', 'guard']);
      expect(harness.transactions.at(-1)!.id, 'no transaction after the superseded one').toBe(supersededTransaction);
    }
  );

  it('U10a: a census that is not due costs one read and no transaction (catches: discovery or a transaction in the common case)', async () => {
    const harness = createRecoveryHarness({ recoveryState: NOT_DUE });
    const result = await recoverFailedInitialCensusInBoundedTransactions(harness.manager, RECOVERY_PARAMS);
    console.log(`[U10a not due] ${JSON.stringify(result)}\n${harness.render()}`);
    expect(result.outcome).toBe('not_due');
    expect(harness.statements.map(statement => statement.kind)).toEqual(['state_read']);
    expect(harness.transactions).toHaveLength(0);
  });

  it.each([
    ['a family staged for another census', [{ ...INCOMING_FAMILY[0], CensusID: OTHER_CENSUS_ID }], BatchFamilyScopeError],
    ['an oversized member', [{ ...INCOMING_FAMILY[0], BatchID: `${BATCH_ID}__sub001`, rowCount: getIngestionBatchSize() + 1 }], OversizedSubBatchError]
  ])(
    'U10a: %s throws today’s error before anything is deleted (catches: recovering on a mis-scoped or tampered request)',
    async (_label, familyRows, expectedError) => {
      const harness = createRecoveryHarness({ recoveryState: DUE_WITH_ONLY_RESIDUAL_MEASUREMENTS, familyRows });
      await expect(recoverFailedInitialCensusInBoundedTransactions(harness.manager, RECOVERY_PARAMS)).rejects.toBeInstanceOf(expectedError);
      console.log(`[U10a ${_label}]\n${harness.render()}`);
      expect(harness.transactions).toHaveLength(0);
      expect(harness.statements.some(statement => DESTRUCTIVE_KINDS.has(statement.kind))).toBe(false);
    }
  );

  it('U10a: no staged family means not due (setup will report noDataFound)', async () => {
    const harness = createRecoveryHarness({ recoveryState: DUE_WITH_ONLY_RESIDUAL_MEASUREMENTS, familyRows: [] });
    const result = await recoverFailedInitialCensusInBoundedTransactions(harness.manager, RECOVERY_PARAMS);
    expect(result.outcome).toBe('not_due');
    expect(harness.transactions).toHaveLength(0);
  });

  it('U11: a census row that vanished supersedes the recovery with nothing deleted (catches: deleting a vanished census)', async () => {
    const harness = createRecoveryHarness({
      recoveryState: DUE_WITH_ONLY_RESIDUAL_MEASUREMENTS,
      scopeReads: [sequentialIDs(HELD_BACK_ROWS)],
      censusRowExists: false
    });
    const result = await recoverFailedInitialCensusInBoundedTransactions(harness.manager, RECOVERY_PARAMS);
    console.log(`[U11 no census] ${JSON.stringify(result)}\n${harness.render()}`);
    expect(result).toMatchObject({ outcome: 'superseded', deletedRows: 0 });
    expect(harness.kindsIn('tx-1')).toEqual(['census_lock']);
    expect(harness.transactions).toHaveLength(1);
  });

  it('U11: a final read that finds more than a window ends that transaction unchanged and starts over (catches: an oversized final transaction)', async () => {
    const arrived = sequentialIDs(WINDOW + 1, 1);
    const harness = createRecoveryHarness({
      recoveryState: DUE_WITH_ONLY_RESIDUAL_MEASUREMENTS,
      scopeReads: [sequentialIDs(HELD_BACK_ROWS), arrived],
      finalReads: [arrived, arrived.slice(WINDOW)]
    });
    const result = await recoverFailedInitialCensusInBoundedTransactions(harness.manager, RECOVERY_PARAMS);
    console.log(`[U11 rows arrived] ${JSON.stringify(result)}\n${harness.render()}`);
    expect(harness.kindsIn('tx-1')).toEqual(['census_lock', 'guard', 'final_read']);
    expect(harness.kindsIn('tx-2')).toEqual(WINDOW_TRANSACTION_KINDS);
    expect(harness.kindsIn('tx-3')).toEqual(FINAL_TRANSACTION_KINDS);
    expect(harness.statements.filter(statement => statement.kind === 'recovery_scope_read')).toHaveLength(2);
    expect(result).toMatchObject({ outcome: 'recovered', deletedRows: WINDOW + 1, windowCount: 1 });
  });

  it('U14a: a deadlock on a window re-runs that whole transaction from the census lock; a guard that now sees a completed upload stops it (catches: resuming inside a rolled-back transaction; a retry that skips the census lock or the guard)', async () => {
    const scopeIDs = sequentialIDs(2 * WINDOW + HELD_BACK_ROWS);
    const harness = createRecoveryHarness({
      recoveryState: DUE_WITH_ONLY_RESIDUAL_MEASUREMENTS,
      scopeReads: [scopeIDs],
      guardCompletedUploads: [0, 1],
      failure: { kind: 'recovery_window_lock', occurrence: 1, makeError: deadlockShapedError }
    });
    const result = await recoverFailedInitialCensusInBoundedTransactions(harness.manager, RECOVERY_PARAMS);
    console.log(`[U14a window] ${JSON.stringify(result)} transactions=${JSON.stringify(harness.transactions)}\n${harness.render()}`);
    expect(harness.transactions.map(transaction => transaction.end)).toEqual(['rolled_back', 'committed']);
    expect(harness.kindsIn('tx-1')).toEqual(['census_lock', 'guard', 'recovery_window_lock']);
    expect(harness.kindsIn('tx-2'), 'the retry starts again from the census lock and the guard').toEqual(['census_lock', 'guard']);
    expect(result).toMatchObject({ outcome: 'superseded', deletedRows: 0, windowCount: 0, deadlockRetries: 1 });
  });

  it('U14a: a deadlock on the final transaction’s metrics DELETE re-runs the final transaction, which completes (catches: no recovery-side retry)', async () => {
    const scopeIDs = sequentialIDs(HELD_BACK_ROWS);
    const harness = createRecoveryHarness({
      recoveryState: DUE_WITH_ONLY_RESIDUAL_MEASUREMENTS,
      scopeReads: [scopeIDs],
      finalReads: [scopeIDs, scopeIDs],
      failure: { kind: 'metrics_delete', occurrence: 1, makeError: deadlockShapedError }
    });
    const result = await recoverFailedInitialCensusInBoundedTransactions(harness.manager, RECOVERY_PARAMS);
    console.log(`[U14a final] ${JSON.stringify(result)}\n${harness.render()}`);
    expect(harness.transactions.map(transaction => transaction.end)).toEqual(['rolled_back', 'committed']);
    expect(harness.kindsIn('tx-2')).toEqual(FINAL_TRANSACTION_KINDS);
    expect(result).toMatchObject({ outcome: 'recovered', deadlockRetries: 1 });
  });

  it('U14a: a lock wait timeout is not retried (catches: retrying non-deadlock errors)', async () => {
    const lockWaitTimeout = Object.assign(new Error('Lock wait timeout exceeded; try restarting transaction'), LOCK_WAIT_TIMEOUT);
    const harness = createRecoveryHarness({
      recoveryState: DUE_WITH_ONLY_RESIDUAL_MEASUREMENTS,
      scopeReads: [sequentialIDs(2 * WINDOW + HELD_BACK_ROWS)],
      failure: { kind: 'recovery_window_lock', occurrence: 1, makeError: () => lockWaitTimeout }
    });
    await expect(recoverFailedInitialCensusInBoundedTransactions(harness.manager, RECOVERY_PARAMS)).rejects.toBe(lockWaitTimeout);
    expect(harness.transactions.map(transaction => transaction.end)).toEqual(['rolled_back']);
    console.log(`[U14a 1205] failure log=${JSON.stringify(errorLogMock.mock.calls)}`);
    expect(errorLogMock, 'a failed recovery logs how far it got (ailogger.error(message, error, context))').toHaveBeenCalledWith(
      FAILED_CENSUS_RECOVERY_FAILED_EVENT,
      lockWaitTimeout,
      expect.objectContaining({ censusID: CENSUS_ID, deletedRows: 0, windowCount: 0, deadlockRetries: 0, errorMessage: lockWaitTimeout.message })
    );
  });
});
