/**
 * ConnectionManager with the REAL runQuery (spec §3.2, U21–U25). Only the pool monitor, the changelog logger and
 * ailogger are mocked, so quarantine cancellation and runQuery timers are exercised end to end without MySQL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const { default: ConnectionManager, APPLICATION_LOCK_CLEANUP_DEADLINE_MS } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');

const CANCELLATION_THREAD_ID = 5_631;
const LOCK_NAME = 'upload:file:563-cancellation';
const LOCK_WAIT_MS = 1_000;
const ROWS_OK: [unknown[], unknown[]] = [[], []];

type StatementResponder = (sql: string, params?: unknown[]) => Promise<unknown>;

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
