/**
 * ConnectionManager with the REAL runQuery (spec §3.2, U21–U25). Only the pool monitor, the changelog logger and
 * ailogger are mocked, so quarantine cancellation and runQuery timers are exercised end to end without MySQL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionQuarantinedError } from './connectionquarantine';
import { QueryTimeoutError } from './primitives';
import { TransactionCallbackTimeoutError } from './transactionerrors';

const { getConnectionMock, tryAcquireConnectionMock, killConnection } = vi.hoisted(() => ({
  getConnectionMock: vi.fn(),
  tryAcquireConnectionMock: vi.fn(),
  killConnection: { query: vi.fn(), release: vi.fn(), destroy: vi.fn() }
}));

vi.mock('@/lib/db/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: () => ({
    getConnection: getConnectionMock,
    tryAcquireConnection: tryAcquireConnectionMock,
    signalActivity: () => undefined
  })
}));
vi.mock('@/lib/connectionlogger', () => ({
  patchConnectionManager: vi.fn(),
  flushTransactionChangelog: vi.fn(),
  discardTransactionChangelog: vi.fn()
}));
vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('chalk', () => ({
  default: {
    red: (value: unknown) => String(value),
    yellow: (value: unknown) => String(value),
    green: (value: unknown) => String(value),
    blue: (value: unknown) => String(value)
  }
}));

// The shared test setup replaces '@/lib/db/connectionmanager' with a stub, so the real module is loaded explicitly.
const {
  default: ConnectionManager,
  APPLICATION_LOCK_CLEANUP_DEADLINE_MS,
  TRANSACTION_BEGIN_STATEMENT_TIMEOUT_MS
} = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');

const CANCELLATION_THREAD_ID = 5_631;
const LOCK_NAME = 'upload:file:563-cancellation';
const LOCK_WAIT_MS = 1_000;
const ROWS_OK: [unknown[], unknown[]] = [[], []];
const STILL_PENDING = Symbol('still pending');
/** primitives.ts DEFAULT_QUERY_TIMEOUT_MS: the bound a USE inherits (A21). */
const RUNQUERY_DEFAULT_TIMEOUT_MS = 660_000;

type StatementResponder = (sql: string, params?: unknown[]) => Promise<unknown>;

/** The settled value, or STILL_PENDING; call after advancing timers so settled promises have run their reactions. */
async function settledValue<T>(promise: Promise<T>): Promise<T | typeof STILL_PENDING> {
  return Promise.race([promise, Promise.resolve(STILL_PENDING)]);
}

function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

/** A pooled-connection double whose query()/execute() answers come from `respond`; every other command succeeds. */
function makeScriptedConnection(respond: StatementResponder) {
  return {
    threadId: CANCELLATION_THREAD_ID,
    query: vi.fn((sql: string, params?: unknown[]) => respond(sql, params)),
    execute: vi.fn((sql: string, params?: unknown[]) => respond(sql, params)),
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    destroy: vi.fn()
  };
}

type CancellationInternals = {
  transactionConnections: Map<string, unknown>;
  transactionMeta: Map<string, { inFlightStatements: number }>;
  reapedTransactions?: Map<string, unknown>;
  transactionSlotQueue: Array<() => void>;
  startingTransactions: number;
};

function managerAtBaseline() {
  const manager = ConnectionManager.getInstance();
  const internals = manager as unknown as CancellationInternals;
  internals.transactionConnections.clear();
  internals.transactionMeta.clear();
  internals.reapedTransactions?.clear();
  internals.transactionSlotQueue.length = 0;
  internals.startingTransactions = 0;
  return { manager, internals };
}

function slotOccupancy(internals: CancellationInternals): number {
  return internals.transactionConnections.size + internals.startingTransactions;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  killConnection.query.mockResolvedValue(ROWS_OK);
  tryAcquireConnectionMock.mockResolvedValue({ status: 'acquired', connection: killConnection });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('lock cleanup with the real runQuery (U24, R5)', () => {
  it('U24: a RELEASE_LOCK that never settles is cancelled by the quarantine, so no 660 s runQuery timer survives', async () => {
    const { manager, internals } = managerAtBaseline();
    const connection = makeScriptedConnection(async sql => {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], []];
      if (sql.includes('RELEASE_LOCK')) return neverSettles();
      return ROWS_OK;
    });
    getConnectionMock.mockResolvedValueOnce(connection);
    const timersBefore = vi.getTimerCount();
    const occupancyBefore = slotOccupancy(internals);

    const transactionId = await manager.beginTransaction();
    expect(await manager.acquireApplicationLock(LOCK_NAME, transactionId, LOCK_WAIT_MS)).toBe(true);
    let commitSettled = false;
    const commit = manager.commitTransaction(transactionId).then(() => (commitSettled = true));

    await vi.advanceTimersByTimeAsync(APPLICATION_LOCK_CLEANUP_DEADLINE_MS);
    await commit;
    console.log('[U24] committed:', commitSettled, 'timers before/after:', timersBefore, vi.getTimerCount(), 'destroy:', connection.destroy.mock.calls.length);

    expect(commitSettled).toBe(true);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
    expect(vi.getTimerCount(), 'a plain destroy() would leave the RELEASE_LOCK wrapper’s 660 s timer armed (+1)').toBe(timersBefore);
    expect(slotOccupancy(internals)).toBe(occupancyBefore);
  });
});

describe('callback-timeout abandonment with the real runQuery (U25, R5)', () => {
  const CALLBACK_TIMEOUT_MS = 2_000;
  const LONG_STATEMENT_SQL = 'SELECT SLEEP(100) AS slept';

  it('U25: the callback’s pending statement is cancelled with ConnectionQuarantinedError when the timeout fires, and no timer survives', async () => {
    const { manager, internals } = managerAtBaseline();
    const connection = makeScriptedConnection(async sql => (sql.startsWith('SELECT SLEEP') ? neverSettles() : ROWS_OK));
    getConnectionMock.mockResolvedValueOnce(connection);
    const timersBefore = vi.getTimerCount();
    const occupancyBefore = slotOccupancy(internals);
    let statementOutcome: unknown = 'pending';

    const outcome = manager
      .withTransaction(
        async tx => {
          statementOutcome = await tx.query(LONG_STATEMENT_SQL).then(
            () => 'resolved',
            (error: unknown) => error
          );
          return 'callback finished';
        },
        { timeoutMs: CALLBACK_TIMEOUT_MS }
      )
      .then(
        () => 'resolved',
        (error: unknown) => error
      );

    await vi.advanceTimersByTimeAsync(CALLBACK_TIMEOUT_MS);
    const settled = await outcome;
    await vi.advanceTimersByTimeAsync(0);
    console.log('[U25] withTransaction:', settled, 'statement:', statementOutcome, 'timers:', timersBefore, vi.getTimerCount());

    expect(settled).toBeInstanceOf(TransactionCallbackTimeoutError);
    expect(statementOutcome, 'the abandoned statement must be cancelled now, not after its 660 s timer').toBeInstanceOf(ConnectionQuarantinedError);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(killConnection.query).toHaveBeenCalledWith(`KILL QUERY ${CANCELLATION_THREAD_ID}`);
    expect(vi.getTimerCount()).toBe(timersBefore);
    expect(slotOccupancy(internals)).toBe(occupancyBefore);
  });
});

describe('the manager’s own statements are bounded (U21, U22, U23, U23b — R4)', () => {
  const REAPER_DEADLINE_MS = 1_000;
  const PAST_REAPER_DEADLINE_MS = 1_500;
  const SETUP_TIMEOUT_MS = 5_000;
  const STALLED_SCHEMA_QUERY = 'SELECT * FROM forestgeo_stalled_use.trees';
  const START_TRANSACTION_PATTERN = /^\s*START\s+TRANSACTION\b/i;

  it('U21: a stalled USE is counted in flight, so it is never reaped, and is bounded at 660 s', async () => {
    const { manager, internals } = managerAtBaseline();
    const connection = makeScriptedConnection(async sql => (sql.startsWith('USE ') ? neverSettles() : ROWS_OK));
    getConnectionMock.mockResolvedValueOnce(connection);
    const timersBefore = vi.getTimerCount();
    const occupancyBefore = slotOccupancy(internals);
    const transactionId = await manager.beginTransaction({ reaperDeadlineMs: REAPER_DEADLINE_MS });

    const statement = manager.executeQuery(STALLED_SCHEMA_QUERY, [], transactionId).then(
      () => 'resolved',
      (error: unknown) => error
    );
    await vi.advanceTimersByTimeAsync(PAST_REAPER_DEADLINE_MS);
    const reapedWhileInFlight = await manager.cleanupStaleTransactions();
    await vi.advanceTimersByTimeAsync(RUNQUERY_DEFAULT_TIMEOUT_MS - PAST_REAPER_DEADLINE_MS);
    const outcome = await settledValue(statement);
    console.log('[U21] reaped while USE in flight:', reapedWhileInFlight, 'outcome at 660 s:', outcome, 'timers:', timersBefore, vi.getTimerCount());

    expect(reapedWhileInFlight).toBe(0);
    expect(outcome, 'an unbounded raw USE hangs forever and pins the slot').toBeInstanceOf(QueryTimeoutError);
    expect(internals.transactionConnections.has(transactionId)).toBe(false);
    expect(slotOccupancy(internals)).toBe(occupancyBefore);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(killConnection.query).toHaveBeenCalledWith(`KILL QUERY ${CANCELLATION_THREAD_ID}`);
    expect(vi.getTimerCount()).toBe(timersBefore);
  });

  it('U22: a stalled setup SET SESSION ends at timeoutMs, the callback never runs, and nothing leaks', async () => {
    const { manager, internals } = managerAtBaseline();
    const connection = makeScriptedConnection(async sql => (sql.startsWith('SET SESSION wait_timeout') ? neverSettles() : ROWS_OK));
    getConnectionMock.mockResolvedValueOnce(connection);
    const timersBefore = vi.getTimerCount();
    const occupancyBefore = slotOccupancy(internals);
    const fn = vi.fn(async () => 'callback ran');

    const outcome = manager.withTransaction(fn, { timeoutMs: SETUP_TIMEOUT_MS }).then(
      () => 'resolved',
      (error: unknown) => error
    );
    await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS);
    const settled = await settledValue(outcome);
    await vi.advanceTimersByTimeAsync(0);
    console.log('[U22] outcome:', settled, 'fn calls:', fn.mock.calls.length, 'timers:', timersBefore, vi.getTimerCount());

    expect(settled).toBeInstanceOf(TransactionCallbackTimeoutError);
    expect(fn, 'the cancelled setup must stop the callback (amendment 2)').not.toHaveBeenCalled();
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(slotOccupancy(internals)).toBe(occupancyBefore);
    expect(vi.getTimerCount()).toBe(timersBefore);
  });

  it('U23: a stalled START TRANSACTION is bounded, quarantined, and returns its start slot', async () => {
    const { manager, internals } = managerAtBaseline();
    const connection = makeScriptedConnection(async sql => (START_TRANSACTION_PATTERN.test(sql) ? neverSettles() : ROWS_OK));
    getConnectionMock.mockResolvedValueOnce(connection);
    const occupancyBefore = slotOccupancy(internals);

    const outcome = manager.beginTransaction().then(
      () => 'resolved',
      (error: unknown) => error
    );
    await vi.advanceTimersByTimeAsync(TRANSACTION_BEGIN_STATEMENT_TIMEOUT_MS);
    const settled = await settledValue(outcome);
    console.log('[U23] outcome:', settled, 'startingTransactions:', internals.startingTransactions);

    expect(settled).toBeInstanceOf(QueryTimeoutError);
    expect(internals.startingTransactions).toBe(0);
    expect(slotOccupancy(internals)).toBe(occupancyBefore);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release, 'a quarantined connection must not be released').not.toHaveBeenCalled();
    expect(killConnection.query).toHaveBeenCalledWith(`KILL QUERY ${CANCELLATION_THREAD_ID}`);
  });

  it('U23b: a stalled isolation SET is bounded the same way (AC 13)', async () => {
    const { manager, internals } = managerAtBaseline();
    const connection = makeScriptedConnection(async sql => (sql.startsWith('SET SESSION TRANSACTION ISOLATION') ? neverSettles() : ROWS_OK));
    getConnectionMock.mockResolvedValueOnce(connection);
    const occupancyBefore = slotOccupancy(internals);

    const outcome = manager.beginTransaction().then(
      () => 'resolved',
      (error: unknown) => error
    );
    await vi.advanceTimersByTimeAsync(TRANSACTION_BEGIN_STATEMENT_TIMEOUT_MS);
    const settled = await settledValue(outcome);
    console.log('[U23b] outcome:', settled, 'startingTransactions:', internals.startingTransactions);

    expect(settled, 'today the isolation SET goes raw over connection.query with no bound').toBeInstanceOf(QueryTimeoutError);
    expect(internals.startingTransactions).toBe(0);
    expect(slotOccupancy(internals)).toBe(occupancyBefore);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
  });
});
