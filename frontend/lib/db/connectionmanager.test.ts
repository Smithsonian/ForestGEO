import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getConnMock, runQueryMock, loggerMock } = vi.hoisted(() => ({
  getConnMock: vi.fn(),
  runQueryMock: vi.fn(),
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// QueryTimeoutError is the real class, not a stub: ConnectionManager branches on
// `instanceof`, so a fake would make the branch untestable (and silently dead).
vi.mock('@/lib/db/primitives', async () => {
  const actual = await vi.importActual<typeof import('./primitives')>('./primitives');
  return {
    getConn: getConnMock,
    runQuery: runQueryMock,
    killQueryOnThread: vi.fn(),
    QueryTimeoutError: actual.QueryTimeoutError
  };
});

vi.mock('@/lib/connectionlogger', () => ({
  patchConnectionManager: vi.fn(),
  flushTransactionChangelog: vi.fn(),
  discardTransactionChangelog: vi.fn()
}));

vi.mock('@/ailogger', () => ({
  default: loggerMock
}));

vi.mock('chalk', () => ({
  default: {
    red: (value: unknown) => String(value),
    yellow: (value: unknown) => String(value),
    green: (value: unknown) => String(value),
    blue: (value: unknown) => String(value)
  }
}));

const LIFECYCLE_THREAD_ID = 5_630;
const STILL_PENDING = Symbol('still pending');

type LifecycleConnection = {
  threadId: number;
  query: ReturnType<typeof vi.fn>;
  beginTransaction: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};

type LifecycleMeta = {
  startedAt: number;
  deadlineAt: number;
  phase: string;
  inFlightStatements: number;
  keepAliveHandle: NodeJS.Timeout | null;
  resourceLocks: Set<string>;
};

type LifecycleInternals = {
  transactionConnections: Map<string, unknown>;
  transactionMeta: Map<string, LifecycleMeta>;
  reapedTransactions?: Map<string, { deadlineAt: number; reapedAt: number }>;
  transactionSlotQueue: Array<() => void>;
  startingTransactions: number;
  commitDeadlineMs: number;
  rollbackDeadlineMs: number;
  MAX_CONCURRENT_TRANSACTIONS: number;
};

function makeLifecycleConnection(threadId: number = LIFECYCLE_THREAD_ID): LifecycleConnection {
  return {
    threadId,
    query: vi.fn().mockResolvedValue([[]]),
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    destroy: vi.fn()
  };
}

/** Loads the real manager and returns it at a clean baseline (the singleton survives between tests). */
async function loadLifecycleManager() {
  const managerModule = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
  const manager = managerModule.default.getInstance();
  const internals = manager as unknown as LifecycleInternals;
  internals.transactionConnections.clear();
  internals.transactionMeta.clear();
  internals.reapedTransactions?.clear();
  internals.transactionSlotQueue.length = 0;
  internals.startingTransactions = 0;
  return { managerModule, ConnectionManagerClass: managerModule.default, manager, internals };
}

function slotOccupancy(internals: LifecycleInternals): number {
  return internals.transactionConnections.size + internals.startingTransactions;
}

function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The settled value, or STILL_PENDING; call after advancing timers so settled promises have run their reactions. */
async function settledValue<T>(promise: Promise<T>): Promise<T | typeof STILL_PENDING> {
  return Promise.race([promise, Promise.resolve(STILL_PENDING)]);
}

/** Never throws: the rejection value or `{ resolved }`. */
function outcomeOf<T>(promise: Promise<T>): Promise<unknown> {
  return promise.then(
    value => ({ resolved: value }),
    (error: unknown) => error
  );
}

describe('ConnectionManager.executeQuery timing', () => {
  const originalThreshold = process.env.CONNECTION_QUERY_TIMING_THRESHOLD_MS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CONNECTION_QUERY_TIMING_THRESHOLD_MS = '0';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalThreshold === undefined) {
      delete process.env.CONNECTION_QUERY_TIMING_THRESHOLD_MS;
    } else {
      process.env.CONNECTION_QUERY_TIMING_THRESHOLD_MS = originalThreshold;
    }
  });

  it('measures acquisition, schema switch, query, and total duration for pool queries', async () => {
    const query = 'SELECT * FROM forestgeo_testing.trees WHERE TreeID = ?';
    const connection = {
      query: vi.fn().mockResolvedValue([[]]),
      release: vi.fn(),
      ping: vi.fn()
    };

    getConnMock.mockResolvedValueOnce(connection);
    runQueryMock.mockImplementation(async (_connection: unknown, sql: string) => (String(sql).startsWith('USE ') ? [] : [{ TreeID: 1 }]));
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(5)
      .mockReturnValueOnce(15)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(27)
      .mockReturnValueOnce(30)
      .mockReturnValueOnce(50)
      .mockReturnValueOnce(60);

    const { default: ConnectionManager } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const result = await ConnectionManager.getInstance().executeQuery(query, [1]);

    expect(result).toEqual([{ TreeID: 1 }]);
    expect(runQueryMock).toHaveBeenCalledWith(connection, 'USE `forestgeo_testing`');
    expect(runQueryMock).toHaveBeenCalledWith(connection, query, [1]);
    expect(connection.ping).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(loggerMock.info).toHaveBeenCalledWith(
      'ConnectionManager.executeQuery timing',
      expect.objectContaining({
        schema: 'forestgeo_testing',
        acquireMs: 10,
        schemaUseMs: 7,
        queryMs: 20,
        totalMs: 60,
        failed: false,
        queryPreview: query
      })
    );
  });
});

describe('ConnectionManager.withTransaction callback failures', () => {
  it('rolls back and releases the connection when a non-async callback throws synchronously', async () => {
    const connection = {
      threadId: 998,
      query: vi.fn().mockResolvedValue([[]]),
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      ping: vi.fn()
    };
    getConnMock.mockResolvedValueOnce(connection);

    const { default: ConnectionManager } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const manager = ConnectionManager.getInstance();
    const internals = manager as unknown as {
      transactionConnections: Map<string, unknown>;
      transactionMeta: Map<string, unknown>;
      transactionSlotQueue: Array<() => void>;
      startingTransactions: number;
    };
    internals.transactionConnections.clear();
    internals.transactionMeta.clear();
    internals.transactionSlotQueue.length = 0;
    internals.startingTransactions = 0;

    await expect(
      manager.withTransaction(() => {
        throw new Error('synchronous callback failure');
      })
    ).rejects.toThrow('synchronous callback failure');

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
    expect(internals.transactionConnections.size).toBe(0);
  });
});

describe('ConnectionManager.acquireApplicationLock — idempotent re-acquire within one transaction', () => {
  // Regression for #507: MySQL's GET_LOCK is refcounted per (session, name) —
  // acquiring the same name twice on one connection needs TWO RELEASE_LOCK
  // calls to fully drop it. cleanupApplicationLocks only ever issues one
  // release per tracked name, so a second real GET_LOCK for an already-held
  // name would leave the lock stuck on the pooled connection after this
  // transaction's own commit/rollback believes it released it.
  it('issues GET_LOCK only once for a name this transaction already holds, and a single cleanup release fully drops it', async () => {
    const connection = {
      threadId: 4242,
      query: vi.fn().mockResolvedValue([[]]),
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      ping: vi.fn()
    };
    getConnMock.mockResolvedValueOnce(connection);

    const getLockCalls: unknown[][] = [];
    const releaseLockCalls: unknown[][] = [];
    runQueryMock.mockImplementation(async (_conn: unknown, query: string, params?: unknown[]) => {
      if (query.includes('GET_LOCK')) {
        getLockCalls.push(params ?? []);
        return [{ acquired: 1 }];
      }
      if (query.includes('RELEASE_LOCK')) {
        releaseLockCalls.push(params ?? []);
        return [{ released: 1 }];
      }
      return [];
    });

    const { default: ConnectionManager } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const manager = ConnectionManager.getInstance();
    const internals = manager as unknown as {
      transactionConnections: Map<string, unknown>;
      transactionMeta: Map<string, { resourceLocks: Set<string> }>;
      transactionSlotQueue: Array<() => void>;
      startingTransactions: number;
    };
    internals.transactionConnections.clear();
    internals.transactionMeta.clear();
    internals.transactionSlotQueue.length = 0;
    internals.startingTransactions = 0;

    const transactionId = await manager.beginTransaction();
    const lockName = 'ingestion-failure:unit-test-lock';

    const first = await manager.acquireApplicationLock(lockName, transactionId, 1000);
    const second = await manager.acquireApplicationLock(lockName, transactionId, 1000);

    expect(first).toBe(true);
    expect(second, 'a re-acquire of a lock this transaction already holds must still report success').toBe(true);
    expect(getLockCalls, 'the same lock name must not issue a second real GET_LOCK within one transaction').toHaveLength(1);
    expect(internals.transactionMeta.get(transactionId)?.resourceLocks.size).toBe(1);

    await manager.commitTransaction(transactionId);

    expect(releaseLockCalls, 'exactly one RELEASE_LOCK must fire for a lock acquired (tracked) exactly once').toHaveLength(1);
    expect(connection.release).toHaveBeenCalledOnce();
  });
});

describe('ConnectionManager transaction-slot accounting — beginTransaction is the single slot authority', () => {
  // Named constants (repo rule: NO MAGIC NUMBERS). These mirror the private
  // ConnectionManager values the tests reach into and the timings they drive.
  const SLOT_WAIT_TIMEOUT_MS = 60000; // acquireTransactionSlot per-waiter deadline
  const SLOT_WAIT_TIMEOUT_OVERSHOOT_MS = SLOT_WAIT_TIMEOUT_MS + 1;
  const MICROTASK_FLUSH_MS = 0; // advance-by-0 to let queued microtasks settle
  const WORKING_THREAD_ID = 777;
  const SET_ISOLATION_SQL = 'SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED';
  const START_TRANSACTION_SQL = 'START TRANSACTION';

  type SlotInternals = {
    transactionSlotQueue: Array<() => void>;
    MAX_CONCURRENT_TRANSACTIONS: number;
    transactionConnections: Map<string, unknown>;
    transactionMeta: Map<string, unknown>;
    startingTransactions: number;
    releaseTransactionSlot: () => void;
  };

  // A pooled-connection test double that lets a REAL beginTransaction run to
  // completion (SET ISOLATION + BEGIN succeed) without any live MySQL.
  function makeWorkingConnection() {
    return {
      threadId: WORKING_THREAD_ID,
      query: vi.fn().mockResolvedValue([[]]),
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      ping: vi.fn().mockResolvedValue(undefined),
      release: vi.fn()
    };
  }

  // Fill transactionConnections to the cap with inert sentinels so the slot
  // gate is saturated. Returns the sentinel ids for teardown.
  function saturateSlots(internals: SlotInternals): string[] {
    const ids: string[] = [];
    for (let i = 0; i < internals.MAX_CONCURRENT_TRANSACTIONS; i++) {
      const id = `__test_sentinel_${i}__`;
      ids.push(id);
      internals.transactionConnections.set(id, {} as unknown);
    }
    return ids;
  }

  // Return the manager to a clean baseline: drop leftover map/meta rows, drain
  // the wait queue, and zero the starting-transactions counter. The singleton
  // survives between tests, so occupancy MUST be reset or later tests inherit
  // phantom slots.
  function resetSlotState(internals: SlotInternals, sentinelIds: string[], extraTxIds: string[]) {
    for (const id of [...sentinelIds, ...extraTxIds]) {
      internals.transactionConnections.delete(id);
      internals.transactionMeta.delete(id);
    }
    internals.transactionSlotQueue.length = 0;
    internals.startingTransactions = 0;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    getConnMock.mockReset();
    runQueryMock.mockReset();
    loggerMock.info.mockReset();
    loggerMock.warn.mockReset();
    loggerMock.error.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * Regression: the slot-waiter timeout used to look up `resolve` in the queue,
   * but the queue actually stored `wrappedResolve`, so indexOf always returned
   * -1 and timed-out waiters were never spliced out. On the next slot release,
   * releaseTransactionSlot would shift the dead wrappedResolve and invoke it,
   * silently consuming a release that should have woken a live waiter.
   *
   * beginTransaction is now the single slot authority, so we drive it directly
   * (rather than withTransaction, whose retry loop would re-enqueue on timeout)
   * and assert the timed-out waiter is spliced back out of the queue.
   */
  it('splices a timed-out waiter out of the transactionSlotQueue so the next release wakes a live waiter', async () => {
    const { default: ConnectionManager } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const cm = ConnectionManager.getInstance();
    const internals = cm as unknown as SlotInternals;

    const sentinelIds = saturateSlots(internals);

    try {
      const queueLengthBaseline = internals.transactionSlotQueue.length;

      // beginTransaction reserves a slot FIRST; with the gate saturated it must
      // park on transactionSlotQueue rather than proceed to acquire a connection.
      const beginPromise = cm.beginTransaction();
      const settled = beginPromise.then(
        (id: string) => ({ ok: true as const, id }),
        (err: Error) => ({ ok: false as const, err })
      );

      // The Promise-constructor body pushes wrappedResolve synchronously; a 0ms
      // tick lets it run.
      await vi.advanceTimersByTimeAsync(MICROTASK_FLUSH_MS);
      expect(internals.transactionSlotQueue.length).toBe(queueLengthBaseline + 1);

      // Cross the per-waiter deadline: the timeout must reject AND splice the
      // waiter out of the queue.
      await vi.advanceTimersByTimeAsync(SLOT_WAIT_TIMEOUT_OVERSHOOT_MS);

      const outcome = await settled;
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.err.message).toContain('Transaction slot wait timeout');
      }

      // Under the old bug indexOf returned -1 so the queue stayed baseline+1.
      // The fix restores baseline; getConn must never have been reached (the
      // slot was never granted).
      expect(internals.transactionSlotQueue.length).toBe(queueLengthBaseline);
      expect(getConnMock).not.toHaveBeenCalled();
    } finally {
      resetSlotState(internals, sentinelIds, []);
    }
  });

  /**
   * CAP ENFORCEMENT ON THE DIRECT PATH. This is the core of the fix: a direct
   * beginTransaction() call (the path taken by ~20 route/helper callers that do
   * NOT go through withTransaction) must be gated by MAX_CONCURRENT_TRANSACTIONS.
   *
   * With the cap saturated, a fresh beginTransaction MUST park on the wait queue
   * and NOT resolve — even though a connection is readily available. It resolves
   * only once a slot is freed and released to it.
   *
   * This FAILS against the unfixed code: the old beginTransaction never called
   * acquireTransactionSlot, so it would sail past the saturated cap, resolve
   * immediately, and never touch transactionSlotQueue.
   */
  it('enforces the concurrency cap on the direct beginTransaction path: a saturated cap forces the caller to wait on the slot queue', async () => {
    const { default: ConnectionManager, TRANSACTION_BEGIN_STATEMENT_TIMEOUT_MS } =
      await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const cm = ConnectionManager.getInstance();
    const internals = cm as unknown as SlotInternals;

    const sentinelIds = saturateSlots(internals);
    const grantedTxIds: string[] = [];

    // A connection is available the instant the gate lets the caller through —
    // proving it is the CAP, not connection scarcity, that makes it wait.
    const workingConnection = makeWorkingConnection();
    getConnMock.mockResolvedValue(workingConnection);

    try {
      const queueLengthBaseline = internals.transactionSlotQueue.length;
      const occupancyBaseline = internals.transactionConnections.size + internals.startingTransactions;
      expect(occupancyBaseline).toBe(internals.MAX_CONCURRENT_TRANSACTIONS);

      let resolvedId: string | undefined;
      let didResolve = false;
      const beginPromise = cm.beginTransaction().then((id: string) => {
        didResolve = true;
        resolvedId = id;
        grantedTxIds.push(id);
        return id;
      });

      // Let every currently-schedulable microtask/timer run. Under the fix the
      // call is parked on the queue, so it MUST still be unresolved and getConn
      // MUST NOT have been called.
      await vi.advanceTimersByTimeAsync(MICROTASK_FLUSH_MS);
      expect(internals.transactionSlotQueue.length).toBe(queueLengthBaseline + 1);
      expect(didResolve).toBe(false);
      expect(getConnMock).not.toHaveBeenCalled();

      // Free one active slot and release it: the parked caller is now admitted,
      // acquires the ready connection, and begins.
      internals.transactionConnections.delete(sentinelIds.pop()!);
      internals.releaseTransactionSlot();
      await vi.advanceTimersByTimeAsync(MICROTASK_FLUSH_MS);

      await beginPromise;
      expect(didResolve).toBe(true);
      expect(resolvedId).toBeTruthy();
      expect(getConnMock).toHaveBeenCalledTimes(1);
      expect(runQueryMock).toHaveBeenCalledWith(workingConnection, SET_ISOLATION_SQL, undefined, TRANSACTION_BEGIN_STATEMENT_TIMEOUT_MS);
      expect(runQueryMock).toHaveBeenCalledWith(workingConnection, START_TRANSACTION_SQL, undefined, TRANSACTION_BEGIN_STATEMENT_TIMEOUT_MS);

      // Occupancy is unchanged: we removed one sentinel and added one real tx,
      // and the starting-counter handed its reservation to the map entry.
      const occupancyAfter = internals.transactionConnections.size + internals.startingTransactions;
      expect(occupancyAfter).toBe(internals.MAX_CONCURRENT_TRANSACTIONS);
      expect(internals.startingTransactions).toBe(0);
    } finally {
      resetSlotState(internals, sentinelIds, grantedTxIds);
    }
  });

  /**
   * A woken beginTransaction that then FAILS to acquire a connection must return
   * its reserved slot (releaseTransactionStartSlot in its finally) so the next
   * queued beginTransaction is woken and can proceed. This is the new home of
   * the old withTransaction "release a reserved start slot" regression, now that
   * beginTransaction owns the reservation.
   */
  it('a woken beginTransaction that cannot acquire a connection releases its slot so the next queued caller proceeds', async () => {
    const { default: ConnectionManager } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const cm = ConnectionManager.getInstance();
    const internals = cm as unknown as SlotInternals;

    const sentinelIds = saturateSlots(internals);
    const grantedTxIds: string[] = [];

    const CONNECTION_FAILURE_MESSAGE = 'pool exhausted (non-deadlock)';
    const workingConnection = makeWorkingConnection();
    // First admitted caller fails to get a connection (non-deadlock → throws
    // immediately); second admitted caller succeeds.
    getConnMock.mockRejectedValueOnce(new Error(CONNECTION_FAILURE_MESSAGE)).mockResolvedValueOnce(workingConnection);

    try {
      const first = cm.beginTransaction().then(
        (id: string) => {
          grantedTxIds.push(id);
          return { ok: true as const, id };
        },
        (err: Error) => ({ ok: false as const, err })
      );
      const second = cm.beginTransaction().then(
        (id: string) => {
          grantedTxIds.push(id);
          return { ok: true as const, id };
        },
        (err: Error) => ({ ok: false as const, err })
      );

      await vi.advanceTimersByTimeAsync(MICROTASK_FLUSH_MS);
      expect(internals.transactionSlotQueue.length).toBe(2);

      // Free ONE slot and wake the first caller. Its getConn rejects, so it must
      // release the reserved slot, which in turn wakes the second caller.
      internals.transactionConnections.delete(sentinelIds.pop()!);
      internals.releaseTransactionSlot();
      await vi.advanceTimersByTimeAsync(MICROTASK_FLUSH_MS);
      await vi.advanceTimersByTimeAsync(MICROTASK_FLUSH_MS);

      const firstOutcome = await first;
      expect(firstOutcome.ok).toBe(false);
      if (!firstOutcome.ok) {
        expect(firstOutcome.err.message).toContain(CONNECTION_FAILURE_MESSAGE);
      }

      const secondOutcome = await second;
      expect(secondOutcome.ok).toBe(true);
      if (secondOutcome.ok) {
        expect(secondOutcome.id).toBeTruthy();
      }
      expect(getConnMock).toHaveBeenCalledTimes(2);
      expect(runQueryMock.mock.calls.filter(([connection, sql]) => connection === workingConnection && sql === START_TRANSACTION_SQL)).toHaveLength(1);
      expect(internals.startingTransactions).toBe(0);
    } finally {
      resetSlotState(internals, sentinelIds, grantedTxIds);
    }
  });

  /**
   * Balanced release: a begin followed by commit (and, separately, rollback)
   * must return occupancy to its pre-begin value and must not spuriously shift a
   * queued waiter. Guards against a double-acquire or double-release regression.
   */
  it('restores occupancy after begin→commit and begin→rollback with no spurious waiter wakeups', async () => {
    const { default: ConnectionManager } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const cm = ConnectionManager.getInstance();
    const internals = cm as unknown as SlotInternals;

    const occupancyBefore = internals.transactionConnections.size + internals.startingTransactions;
    const grantedTxIds: string[] = [];

    try {
      // --- begin → commit ---
      const commitConnection = makeWorkingConnection();
      getConnMock.mockResolvedValueOnce(commitConnection);
      const commitTxId = await cm.beginTransaction();
      grantedTxIds.push(commitTxId);
      expect(internals.transactionConnections.size + internals.startingTransactions).toBe(occupancyBefore + 1);
      expect(internals.startingTransactions).toBe(0);

      await cm.commitTransaction(commitTxId);
      expect(commitConnection.commit).toHaveBeenCalledTimes(1);
      expect(commitConnection.release).toHaveBeenCalledTimes(1);
      expect(internals.transactionConnections.size + internals.startingTransactions).toBe(occupancyBefore);
      expect(internals.transactionSlotQueue.length).toBe(0);

      // --- begin → rollback ---
      const rollbackConnection = makeWorkingConnection();
      getConnMock.mockResolvedValueOnce(rollbackConnection);
      const rollbackTxId = await cm.beginTransaction();
      grantedTxIds.push(rollbackTxId);
      expect(internals.transactionConnections.size + internals.startingTransactions).toBe(occupancyBefore + 1);

      await cm.rollbackTransaction(rollbackTxId);
      expect(rollbackConnection.rollback).toHaveBeenCalledTimes(1);
      expect(rollbackConnection.release).toHaveBeenCalledTimes(1);
      expect(internals.transactionConnections.size + internals.startingTransactions).toBe(occupancyBefore);
      expect(internals.transactionSlotQueue.length).toBe(0);
      expect(internals.startingTransactions).toBe(0);
    } finally {
      resetSlotState(internals, [], grantedTxIds);
    }
  });
});

/**
 * A runQuery timeout inside a managed transaction destroys that transaction's
 * connection (lib/db/primitives quarantines it so a statement still in flight can
 * never re-enter the pool). The transaction is therefore over — the server rolls
 * it back when the socket closes — but the map entry used to survive.
 *
 * The consequence was a misleading 500: the caller's `catch { rollbackTransaction }`
 * found the entry, called rollback() on a closed connection, and threw
 * "Can't add new command when connection is in closed state", REPLACING the
 * QueryTimeoutError that explained what actually happened. (Verified NOT a slot
 * leak — accounting was already correct; the error was the damage.)
 */
describe('ConnectionManager transaction finalization after a statement timeout', () => {
  const TIMED_OUT_THREAD_ID = 909;
  const STATEMENT_TIMEOUT_MS = 660000;

  type TxInternals = {
    transactionConnections: Map<string, unknown>;
    transactionMeta: Map<string, unknown>;
    transactionSlotQueue: Array<() => void>;
    startingTransactions: number;
  };

  /** A connection that behaves like one mysql2 has already destroyed. */
  function makeDestroyedConnection() {
    return {
      threadId: TIMED_OUT_THREAD_ID,
      query: vi.fn().mockResolvedValue([[]]),
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockRejectedValue(new Error("Can't add new command when connection is in closed state")),
      rollback: vi.fn().mockRejectedValue(new Error("Can't add new command when connection is in closed state")),
      release: vi.fn()
    };
  }

  beforeEach(() => {
    getConnMock.mockReset();
    runQueryMock.mockReset();
    loggerMock.info.mockReset();
    loggerMock.warn.mockReset();
    loggerMock.error.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves the QueryTimeoutError and makes the caller’s later rollback a no-op', async () => {
    const primitives = await vi.importActual<typeof import('./primitives')>('./primitives');
    const { default: ConnectionManager } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const cm = ConnectionManager.getInstance();
    const internals = cm as unknown as TxInternals;

    const occupancyBefore = internals.transactionConnections.size + internals.startingTransactions;
    const queueLengthBefore = internals.transactionSlotQueue.length;

    const connection = makeDestroyedConnection();
    getConnMock.mockResolvedValueOnce(connection);
    const transactionId = await cm.beginTransaction();

    // The statement times out; primitives has already destroyed the connection.
    const timeoutError = new primitives.QueryTimeoutError(STATEMENT_TIMEOUT_MS, TIMED_OUT_THREAD_ID);
    runQueryMock.mockImplementation(async (_connection: unknown, sql: string) => {
      if (String(sql).startsWith('USE ')) return [];
      throw timeoutError;
    });

    const thrown = await cm.executeQuery('CALL forestgeo_test.bulkingestionprocess(?, ?)', ['f', 'b'], transactionId).then(
      () => {
        throw new Error('executeQuery resolved but runQuery rejected with a timeout');
      },
      (error: unknown) => error
    );

    // The original error survives, unwrapped.
    expect(thrown).toBe(timeoutError);
    expect(
      runQueryMock.mock.calls.some(([, sql]) => String(sql).startsWith('CALL')),
      'the CALL itself must time out'
    ).toBe(true);

    // The transaction is already finalized, so the caller's rollback finds
    // nothing to roll back and never touches the closed connection.
    await expect(cm.rollbackTransaction(transactionId)).resolves.toBeUndefined();
    expect(connection.rollback, 'rollback() on a destroyed connection is what threw the masking error').not.toHaveBeenCalled();

    // Bookkeeping settled exactly once, back to baseline.
    expect(internals.transactionConnections.has(transactionId)).toBe(false);
    expect(internals.transactionMeta.has(transactionId)).toBe(false);
    expect(internals.transactionConnections.size + internals.startingTransactions).toBe(occupancyBefore);
    expect(internals.transactionSlotQueue.length).toBe(queueLengthBefore);
  });

  it('discards the rolled-back transaction’s buffered changelog entries', async () => {
    const { discardTransactionChangelog, flushTransactionChangelog } = await import('@/lib/connectionlogger');
    const primitives = await vi.importActual<typeof import('./primitives')>('./primitives');
    const { default: ConnectionManager } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const cm = ConnectionManager.getInstance();

    const connection = makeDestroyedConnection();
    getConnMock.mockResolvedValueOnce(connection);
    const transactionId = await cm.beginTransaction();
    const timeoutError = new primitives.QueryTimeoutError(STATEMENT_TIMEOUT_MS, TIMED_OUT_THREAD_ID);
    runQueryMock.mockImplementation(async (_connection: unknown, sql: string) => {
      if (String(sql).startsWith('USE ')) return [];
      throw timeoutError;
    });

    await expect(cm.executeQuery('UPDATE forestgeo_test.coremeasurements SET IsActive = 0', [], transactionId)).rejects.toBeInstanceOf(
      primitives.QueryTimeoutError
    );
    expect(
      runQueryMock.mock.calls.some(([, sql]) => String(sql).startsWith('UPDATE')),
      'the UPDATE itself must time out'
    ).toBe(true);

    // The writes were rolled back by the server; flushing them would record
    // changelog entries for changes that never happened.
    expect(vi.mocked(discardTransactionChangelog)).toHaveBeenCalledWith(transactionId);
    expect(vi.mocked(flushTransactionChangelog)).not.toHaveBeenCalled();
  });

  it('leaves an ordinary query error’s transaction intact for the caller to roll back', async () => {
    const { default: ConnectionManager } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const cm = ConnectionManager.getInstance();
    const internals = cm as unknown as TxInternals;

    const connection = makeDestroyedConnection();
    connection.rollback = vi.fn().mockResolvedValue(undefined);
    getConnMock.mockResolvedValueOnce(connection);
    const transactionId = await cm.beginTransaction();

    const sqlError = new Error("Table 'x.nonexistent' doesn't exist");
    runQueryMock.mockImplementation(async (_connection: unknown, sql: string) => {
      if (String(sql).startsWith('USE ')) return [];
      throw sqlError;
    });

    await expect(cm.executeQuery('SELECT * FROM forestgeo_test.nonexistent', [], transactionId)).rejects.toBe(sqlError);
    expect(
      runQueryMock.mock.calls.some(([, sql]) => String(sql).startsWith('SELECT')),
      'the SELECT itself must reach runQuery'
    ).toBe(true);

    // Still owned by the caller: the connection is alive and the real ROLLBACK
    // must still be issued.
    expect(internals.transactionConnections.has(transactionId)).toBe(true);
    await cm.rollbackTransaction(transactionId);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });
});

/**
 * discardTransaction is for a transaction whose session state can no longer be
 * trusted (e.g. a session variable that could not be reset). Its connection must
 * be destroyed, never released back to the pool, and the transaction's
 * bookkeeping must settle exactly once through the same finalization a statement
 * timeout uses.
 */
describe('ConnectionManager.discardTransaction', () => {
  const DISCARDED_THREAD_ID = 707;
  const DISCARD_REASON = 'session flag could not be cleared';
  const PENDING_TIMER_MS = 60 * 60 * 1000;

  type TxInternals = {
    transactionConnections: Map<string, unknown>;
    transactionMeta: Map<string, { keepAliveHandle: NodeJS.Timeout | null }>;
    transactionSlotQueue: Array<() => void>;
    startingTransactions: number;
  };

  function makeLiveConnection() {
    return {
      threadId: DISCARDED_THREAD_ID,
      query: vi.fn().mockResolvedValue([[]]),
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      destroy: vi.fn()
    };
  }

  async function loadManager() {
    const { default: ConnectionManager } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const cm = ConnectionManager.getInstance();
    return { cm, internals: cm as unknown as TxInternals };
  }

  beforeEach(() => {
    getConnMock.mockReset();
    runQueryMock.mockReset();
    loggerMock.info.mockReset();
    loggerMock.warn.mockReset();
    loggerMock.error.mockReset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('destroys the connection instead of releasing it and settles timers, changelog and the slot exactly once', async () => {
    const { discardTransactionChangelog, flushTransactionChangelog } = await import('@/lib/connectionlogger');
    const { cm, internals } = await loadManager();
    const occupancyBefore = internals.transactionConnections.size + internals.startingTransactions;
    const queueLengthBefore = internals.transactionSlotQueue.length;

    const connection = makeLiveConnection();
    getConnMock.mockResolvedValueOnce(connection);
    const transactionId = await cm.beginTransaction();
    const meta = internals.transactionMeta.get(transactionId)!;
    meta.keepAliveHandle = setInterval(() => undefined, PENDING_TIMER_MS);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    cm.discardTransaction(transactionId, DISCARD_REASON);
    cm.discardTransaction(transactionId, DISCARD_REASON);
    await expect(cm.rollbackTransaction(transactionId)).resolves.toBeUndefined();
    const { TransactionNotActiveError } = await vi.importActual<typeof import('./transactionerrors')>('./transactionerrors');
    await expect(cm.commitTransaction(transactionId)).rejects.toBeInstanceOf(TransactionNotActiveError);

    expect(connection.destroy, 'the untrusted session must be destroyed exactly once').toHaveBeenCalledTimes(1);
    expect(connection.release, 'a discarded session must never return to the pool').not.toHaveBeenCalled();
    expect(connection.rollback, 'later rollback must take the already-finalized path').not.toHaveBeenCalled();
    expect(connection.commit, 'later commit must take the already-finalized path').not.toHaveBeenCalled();
    expect(clearIntervalSpy).toHaveBeenCalledWith(meta.keepAliveHandle);
    expect(vi.mocked(discardTransactionChangelog)).toHaveBeenCalledWith(transactionId);
    expect(vi.mocked(flushTransactionChangelog)).not.toHaveBeenCalled();
    expect(internals.transactionConnections.has(transactionId)).toBe(false);
    expect(internals.transactionMeta.has(transactionId)).toBe(false);
    expect(internals.transactionConnections.size + internals.startingTransactions, 'the slot must be released exactly once').toBe(occupancyBefore);
    expect(internals.transactionSlotQueue.length).toBe(queueLengthBefore);
  });

  it('still finalizes and never releases when destroy itself throws, and logs the destroy failure', async () => {
    const { cm, internals } = await loadManager();
    const occupancyBefore = internals.transactionConnections.size + internals.startingTransactions;

    const connection = makeLiveConnection();
    const destroyError = new Error('socket already torn down');
    connection.destroy.mockImplementation(() => {
      throw destroyError;
    });
    getConnMock.mockResolvedValueOnce(connection);
    const transactionId = await cm.beginTransaction();

    expect(() => cm.discardTransaction(transactionId, DISCARD_REASON)).not.toThrow();

    expect(connection.release).not.toHaveBeenCalled();
    expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining(transactionId), destroyError);
    expect(internals.transactionConnections.has(transactionId)).toBe(false);
    expect(internals.transactionConnections.size + internals.startingTransactions).toBe(occupancyBefore);
  });

  it('is a no-op for a transaction a statement timeout already finalized', async () => {
    const primitives = await vi.importActual<typeof import('./primitives')>('./primitives');
    const { cm, internals } = await loadManager();
    const occupancyBefore = internals.transactionConnections.size + internals.startingTransactions;

    const connection = makeLiveConnection();
    getConnMock.mockResolvedValueOnce(connection);
    const transactionId = await cm.beginTransaction();
    const timeoutError = new primitives.QueryTimeoutError(1000, DISCARDED_THREAD_ID);
    runQueryMock.mockImplementation(async (_connection: unknown, sql: string) => {
      if (String(sql).startsWith('USE ')) return [];
      throw timeoutError;
    });
    await expect(cm.executeQuery('CALL forestgeo_test.bulkingestionprocess(?, ?)', ['f', 'b'], transactionId)).rejects.toBeInstanceOf(
      primitives.QueryTimeoutError
    );
    expect(
      runQueryMock.mock.calls.some(([, sql]) => String(sql).startsWith('CALL')),
      'the CALL itself must time out'
    ).toBe(true);

    cm.discardTransaction(transactionId, DISCARD_REASON);

    expect(connection.destroy, 'the timeout path already owns the connection teardown').not.toHaveBeenCalled();
    expect(internals.transactionConnections.size + internals.startingTransactions, 'the slot must not be released twice').toBe(occupancyBefore);
  });

  it('lets the callback error reach the withTransaction caller after a discard, with commit and rollback as no-ops', async () => {
    const { cm, internals } = await loadManager();
    const occupancyBefore = internals.transactionConnections.size + internals.startingTransactions;

    const connection = makeLiveConnection();
    getConnMock.mockResolvedValueOnce(connection);
    const callbackError = new Error('flag reset failed');

    const outcome = cm.withTransaction(async tx => {
      cm.discardTransaction(tx.id, DISCARD_REASON);
      throw callbackError;
    });

    await expect(outcome).rejects.toBe(callbackError);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).not.toHaveBeenCalled();
    expect(internals.transactionConnections.size + internals.startingTransactions).toBe(occupancyBefore);
  });
});

describe('ConnectionManager typed transaction timeout', () => {
  const TIMEOUT_MS = 20;
  const TIMEOUT_ERROR_CODE = 'TRANSACTION_CALLBACK_TIMEOUT';
  const THREAD_ID = 4242;

  function makeConnection() {
    return {
      threadId: THREAD_ID,
      query: vi.fn().mockResolvedValue([[]]),
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      destroy: vi.fn()
    };
  }

  beforeEach(() => {
    getConnMock.mockReset();
    runQueryMock.mockReset();
    vi.clearAllMocks();
  });

  it('rejects a hung callback with TransactionCallbackTimeoutError carrying the legacy message', async () => {
    const { default: ConnectionManager, TransactionCallbackTimeoutError } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const connection = makeConnection();
    getConnMock.mockResolvedValueOnce(connection);
    const manager = ConnectionManager.getInstance();

    const outcome = await manager.withTransaction(() => new Promise<never>(() => undefined), { timeoutMs: TIMEOUT_MS }).catch((error: unknown) => error);

    console.log('[typed-timeout] outcome:', outcome);
    expect(outcome).toBeInstanceOf(TransactionCallbackTimeoutError);
    const timeoutError = outcome as InstanceType<typeof TransactionCallbackTimeoutError>;
    expect(timeoutError.code).toBe(TIMEOUT_ERROR_CODE);
    expect(timeoutError.timeoutMs).toBe(TIMEOUT_MS);
    expect(timeoutError.message).toBe(`Transaction ${timeoutError.transactionId} timed out after ${TIMEOUT_MS}ms`);
    expect(connection.destroy, 'a timed-out transaction is abandoned: its connection is quarantined').toHaveBeenCalledTimes(1);
    expect(connection.release, 'never returned to the pool').not.toHaveBeenCalled();
    expect(connection.rollback, 'no ROLLBACK: it would queue behind the running statement (A11)').not.toHaveBeenCalled();
    const { killQueryOnThread } = await import('@/lib/db/primitives');
    expect(killQueryOnThread, 'the in-flight statement must be killed by thread id').toHaveBeenCalledWith(THREAD_ID, expect.any(String));
    const internals = manager as unknown as { transactionConnections: Map<string, unknown>; transactionMeta: Map<string, unknown> };
    expect(internals.transactionConnections.has(timeoutError.transactionId), 'connection bookkeeping must be cleared').toBe(false);
    expect(internals.transactionMeta.has(timeoutError.transactionId), 'transaction metadata must be cleared').toBe(false);
  });
});

describe('ConnectionManager lock release after COMMIT (review finding 1)', () => {
  const LOCK_NAME = 'upload:file:finding1';
  const LOCK_WAIT_MS = 1_000;
  const LOST_CONNECTION_CODE = 'PROTOCOL_CONNECTION_LOST';

  beforeEach(() => {
    getConnMock.mockReset();
    runQueryMock.mockReset();
    vi.clearAllMocks();
  });

  it('reports a committed transaction as committed when RELEASE_LOCK fails afterwards', async () => {
    const { default: ConnectionManager } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const connection = {
      threadId: 4243,
      query: vi.fn().mockResolvedValue([[]]),
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      destroy: vi.fn()
    };
    getConnMock.mockResolvedValueOnce(connection);
    runQueryMock.mockImplementation(async (_conn: unknown, sql: string) => {
      if (sql.includes('GET_LOCK')) return [{ acquired: 1 }];
      if (sql.includes('RELEASE_LOCK')) {
        throw Object.assign(new Error('Connection lost: The server closed the connection.'), { code: LOST_CONNECTION_CODE });
      }
      return [];
    });
    const manager = ConnectionManager.getInstance();
    const transactionId = await manager.beginTransaction();
    const acquired = await manager.acquireApplicationLock(LOCK_NAME, transactionId, LOCK_WAIT_MS);
    expect(acquired, 'precondition: the lock must be held before COMMIT').toBe(true);

    const outcome = await manager.commitTransaction(transactionId).then(
      () => 'resolved',
      (error: unknown) => error
    );

    console.log('[finding-1] commit outcome after failed RELEASE_LOCK:', outcome);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('resolved');
    expect(connection.release, 'a session whose RELEASE_LOCK failed may still hold the lock; it must never be reused').not.toHaveBeenCalled();
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(
      runQueryMock.mock.calls.some(([, sql]) => String(sql).includes('RELEASE_LOCK')),
      'RELEASE_LOCK must actually have been attempted, otherwise the failure path was never exercised'
    ).toBe(true);
    const internals = manager as unknown as { transactionConnections: Map<string, unknown>; transactionMeta: Map<string, unknown> };
    expect(internals.transactionConnections.has(transactionId), 'connection bookkeeping must be cleared').toBe(false);
    expect(internals.transactionMeta.has(transactionId), 'transaction metadata must be cleared').toBe(false);
  });
});

describe('ConnectionManager transaction lifecycle record (#563 §1, §4)', () => {
  const REAPER_DEADLINE_MS = 1_000;
  const CALLBACK_TIMEOUT_MS = 5_000;
  const DISCARD_REASON = 'callback discarded its own transaction';
  const SET_WAIT_TIMEOUT_PREFIX = 'SET SESSION wait_timeout';
  const SET_LOCK_WAIT_PREFIX = 'SET SESSION innodb_lock_wait_timeout';
  /** Mirror connectionmanager.ts's MILLISECONDS_PER_SECOND and SESSION_TIMEOUT_BUFFER_SECONDS (module-private there). */
  const MILLISECONDS_PER_SECOND_IN_TEST = 1000;
  const SESSION_TIMEOUT_BUFFER_SECONDS_IN_TEST = 300;

  beforeEach(() => {
    vi.useFakeTimers();
    getConnMock.mockReset();
    runQueryMock.mockReset();
    runQueryMock.mockImplementation(async () => []);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('records phase active, zero statements in flight and the default 240 s reaper deadline for a direct begin', async () => {
    const { ConnectionManagerClass, manager, internals } = await loadLifecycleManager();
    getConnMock.mockResolvedValueOnce(makeLifecycleConnection());

    const transactionId = await manager.beginTransaction();
    const meta = internals.transactionMeta.get(transactionId)!;
    console.log('[lifecycle] direct begin meta:', { ...meta, resourceLocks: meta.resourceLocks.size });

    expect(meta.phase).toBe('active');
    expect(meta.inFlightStatements).toBe(0);
    expect(meta.deadlineAt - meta.startedAt).toBe(ConnectionManagerClass.DEFAULT_STALE_TRANSACTION_THRESHOLD_MS);
    expect('timeoutHandle' in meta, 'the callback timer belongs to withTransaction, not the shared meta').toBe(false);
    await manager.rollbackTransaction(transactionId);
  });

  it('uses the caller’s reaperDeadlineMs for deadlineAt', async () => {
    const { manager, internals } = await loadLifecycleManager();
    getConnMock.mockResolvedValueOnce(makeLifecycleConnection());

    const transactionId = await manager.beginTransaction({ reaperDeadlineMs: REAPER_DEADLINE_MS });
    const meta = internals.transactionMeta.get(transactionId)!;
    expect(meta.deadlineAt - meta.startedAt).toBe(REAPER_DEADLINE_MS);
    await manager.rollbackTransaction(transactionId);
  });

  it.each([0, Number.NaN, -1, Number.POSITIVE_INFINITY])(
    'U8: rejects reaperDeadlineMs=%s with RangeError before reserving a slot or a connection',
    async invalidDeadline => {
      const { manager, internals } = await loadLifecycleManager();
      const occupancyBefore = slotOccupancy(internals);
      const queueBefore = internals.transactionSlotQueue.length;

      const outcome = await outcomeOf(manager.beginTransaction({ reaperDeadlineMs: invalidDeadline }));
      console.log(`[U8] reaperDeadlineMs=${invalidDeadline} →`, outcome);

      expect(outcome).toBeInstanceOf(RangeError);
      expect(getConnMock, 'no connection may be acquired for an invalid deadline').not.toHaveBeenCalled();
      expect(slotOccupancy(internals)).toBe(occupancyBefore);
      expect(internals.transactionSlotQueue.length).toBe(queueBefore);
    }
  );

  it('begins a withTransaction with reaperDeadlineMs = timeoutMs + TRANSACTION_REAPER_GRACE_MS', async () => {
    const { ConnectionManagerClass, manager, internals } = await loadLifecycleManager();
    getConnMock.mockResolvedValueOnce(makeLifecycleConnection());
    const beginSpy = vi.spyOn(manager, 'beginTransaction');
    let observedDeadlineSpan: number | undefined;

    await manager.withTransaction(
      async tx => {
        const meta = internals.transactionMeta.get(tx.id)!;
        observedDeadlineSpan = meta.deadlineAt - meta.startedAt;
      },
      { timeoutMs: CALLBACK_TIMEOUT_MS }
    );

    console.log('[lifecycle] withTransaction begin args:', beginSpy.mock.calls, 'deadline span:', observedDeadlineSpan);
    expect(beginSpy).toHaveBeenCalledWith({ reaperDeadlineMs: CALLBACK_TIMEOUT_MS + ConnectionManagerClass.TRANSACTION_REAPER_GRACE_MS });
    expect(observedDeadlineSpan).toBe(CALLBACK_TIMEOUT_MS + ConnectionManagerClass.TRANSACTION_REAPER_GRACE_MS);
  });

  it('counts a transaction statement as in flight until it settles, on success and on failure', async () => {
    const { manager, internals } = await loadLifecycleManager();
    getConnMock.mockResolvedValueOnce(makeLifecycleConnection());
    const transactionId = await manager.beginTransaction();
    const meta = internals.transactionMeta.get(transactionId)!;

    const pendingStatement = deferred<unknown[]>();
    runQueryMock.mockImplementationOnce(() => pendingStatement.promise);
    const statement = manager.executeQuery('SELECT * FROM forestgeo_testing.trees', [], transactionId);
    await vi.advanceTimersByTimeAsync(0);
    console.log('[lifecycle] in flight while pending:', meta.inFlightStatements);
    expect(meta.inFlightStatements).toBe(1);
    pendingStatement.resolve([]);
    await statement;
    expect(meta.inFlightStatements).toBe(0);

    const statementError = new Error("Table 'forestgeo_testing.nonexistent' doesn't exist");
    runQueryMock.mockImplementationOnce(async () => {
      throw statementError;
    });
    await expect(manager.executeQuery('SELECT * FROM forestgeo_testing.nonexistent', [], transactionId)).rejects.toBe(statementError);
    expect(meta.inFlightStatements, 'a failed statement must not leave the counter raised').toBe(0);
    await manager.rollbackTransaction(transactionId);
  });

  it('arms the callback timer before the session setup: a setup statement that never settles still rejects at timeoutMs and fn never runs', async () => {
    const { manager } = await loadLifecycleManager();
    getConnMock.mockResolvedValueOnce(makeLifecycleConnection());
    runQueryMock.mockImplementation(async (_connection: unknown, sql: string) => (String(sql).startsWith(SET_WAIT_TIMEOUT_PREFIX) ? neverSettles() : []));
    const fn = vi.fn(async () => 'callback ran');
    const { TransactionCallbackTimeoutError } = await vi.importActual<typeof import('./transactionerrors')>('./transactionerrors');

    const outcome = outcomeOf(manager.withTransaction(fn, { timeoutMs: CALLBACK_TIMEOUT_MS }));
    await vi.advanceTimersByTimeAsync(CALLBACK_TIMEOUT_MS);
    const settled = await settledValue(outcome);
    await vi.advanceTimersByTimeAsync(0);
    console.log('[lifecycle] setup stall outcome:', settled, 'fn calls:', fn.mock.calls.length);

    expect(settled, 'withTransaction must reject at timeoutMs even though setup never finished').toBeInstanceOf(TransactionCallbackTimeoutError);
    expect(fn, 'the callback must never run once its deadline passed during setup').not.toHaveBeenCalled();
  });

  it('U19: a callback that discards its transaction and then hangs still rejects at timeoutMs', async () => {
    const { manager } = await loadLifecycleManager();
    getConnMock.mockResolvedValueOnce(makeLifecycleConnection());
    const { TransactionCallbackTimeoutError } = await vi.importActual<typeof import('./transactionerrors')>('./transactionerrors');

    const outcome = outcomeOf(
      manager.withTransaction(
        async tx => {
          manager.discardTransaction(tx.id, DISCARD_REASON);
          return neverSettles<string>();
        },
        { timeoutMs: CALLBACK_TIMEOUT_MS }
      )
    );
    await vi.advanceTimersByTimeAsync(CALLBACK_TIMEOUT_MS);
    const settled = await settledValue(outcome);
    console.log('[U19] discard-then-hang outcome:', settled);
    expect(settled, 'discarding must not disarm the callback timer').toBeInstanceOf(TransactionCallbackTimeoutError);
  });

  it('rethrows a ConnectionQuarantinedError from the session setup and never runs the callback (amendment 2)', async () => {
    const { manager } = await loadLifecycleManager();
    getConnMock.mockResolvedValueOnce(makeLifecycleConnection());
    const { ConnectionQuarantinedError } = await vi.importActual<typeof import('./connectionquarantine')>('./connectionquarantine');
    const cancellation = new ConnectionQuarantinedError(LIFECYCLE_THREAD_ID, 'unit test cancellation');
    runQueryMock.mockImplementation(async (_connection: unknown, sql: string) => {
      if (String(sql).startsWith(SET_WAIT_TIMEOUT_PREFIX)) throw cancellation;
      return [];
    });
    const fn = vi.fn(async () => 'callback ran');

    const outcome = await outcomeOf(manager.withTransaction(fn, { timeoutMs: CALLBACK_TIMEOUT_MS }));
    console.log('[lifecycle] setup cancellation outcome:', outcome);
    expect(outcome).toBe(cancellation);
    expect(fn).not.toHaveBeenCalled();
  });

  it('keeps warn-and-continue for an ordinary session setup failure', async () => {
    const { manager } = await loadLifecycleManager();
    getConnMock.mockResolvedValueOnce(makeLifecycleConnection());
    runQueryMock.mockImplementation(async (_connection: unknown, sql: string) => {
      if (String(sql).startsWith(SET_WAIT_TIMEOUT_PREFIX)) throw new Error('Variable is read only');
      return [];
    });

    await expect(manager.withTransaction(async () => 'callback ran', { timeoutMs: CALLBACK_TIMEOUT_MS })).resolves.toBe('callback ran');
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to apply enhanced connection settings'));
  });

  it('sends the session settings as validated integer literals with no bound parameters (ER_WRONG_TYPE_FOR_VAR, rule 12)', async () => {
    const { manager } = await loadLifecycleManager();
    getConnMock.mockResolvedValueOnce(makeLifecycleConnection());
    const expectedTimeoutSeconds = Math.ceil(CALLBACK_TIMEOUT_MS / MILLISECONDS_PER_SECOND_IN_TEST);
    const expectedSessionSeconds = expectedTimeoutSeconds + SESSION_TIMEOUT_BUFFER_SECONDS_IN_TEST;

    await manager.withTransaction(async () => 'callback ran', { timeoutMs: CALLBACK_TIMEOUT_MS });
    const setupCalls = runQueryMock.mock.calls
      .filter(([, sql]) => /^SET SESSION (wait_timeout|interactive_timeout|innodb_lock_wait_timeout)\b/.test(String(sql)))
      .map(([, sql, params]) => ({ sql: String(sql), params }));
    console.log('[lifecycle] setup statements:', setupCalls);

    expect(setupCalls).toEqual([
      { sql: `SET SESSION wait_timeout = ${expectedSessionSeconds}`, params: undefined },
      { sql: `SET SESSION interactive_timeout = ${expectedSessionSeconds}`, params: undefined },
      { sql: `SET SESSION innodb_lock_wait_timeout = ${expectedTimeoutSeconds}`, params: undefined }
    ]);
  });

  it('a setup statement that settles only after the deadline never starts the callback', async () => {
    const { manager } = await loadLifecycleManager();
    getConnMock.mockResolvedValueOnce(makeLifecycleConnection());
    const lateSetup = deferred<unknown[]>();
    runQueryMock.mockImplementation(async (_connection: unknown, sql: string) => (String(sql).startsWith(SET_LOCK_WAIT_PREFIX) ? lateSetup.promise : []));
    const fn = vi.fn(async () => 'callback ran');

    const outcome = outcomeOf(manager.withTransaction(fn, { timeoutMs: CALLBACK_TIMEOUT_MS }));
    await vi.advanceTimersByTimeAsync(CALLBACK_TIMEOUT_MS);
    await outcome;
    lateSetup.resolve([]);
    await vi.advanceTimersByTimeAsync(0);
    console.log('[lifecycle] late setup: fn calls', fn.mock.calls.length);
    expect(fn, 'a mocked runQuery cannot be cancelled, so only the timedOut guard stops the callback here').not.toHaveBeenCalled();
  });

  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])('rejects timeoutMs=%s with RangeError before beginning, without retrying', async invalidTimeout => {
    const { manager } = await loadLifecycleManager();
    const beginSpy = vi.spyOn(manager, 'beginTransaction');

    const outcome = await outcomeOf(manager.withTransaction(async () => 'never', { timeoutMs: invalidTimeout }));
    console.log(`[lifecycle] timeoutMs=${invalidTimeout} →`, outcome);

    expect(outcome).toBeInstanceOf(RangeError);
    expect(beginSpy).not.toHaveBeenCalled();
    expect(getConnMock).not.toHaveBeenCalled();
  });

  it('does not retry a RangeError from beginTransaction', async () => {
    const { manager } = await loadLifecycleManager();
    const beginSpy = vi.spyOn(manager, 'beginTransaction').mockRejectedValue(new RangeError('reaperDeadlineMs must be a finite number'));

    const outcome = await outcomeOf(manager.withTransaction(async () => 'never', { timeoutMs: CALLBACK_TIMEOUT_MS }));
    expect(outcome).toBeInstanceOf(RangeError);
    expect(beginSpy, 'a programming error is not a transient connection problem').toHaveBeenCalledTimes(1);
  });

  it('a BEGIN that deadlocks, then cannot get a connection, releases the first connection exactly once', async () => {
    const { manager, internals } = await loadLifecycleManager();
    const deadlockedConnection = makeLifecycleConnection();
    const poolExhaustedMessage = 'pool exhausted (non-deadlock)';
    const deadlock = Object.assign(new Error('Deadlock found when trying to get lock; try restarting transaction'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 });
    const isIsolationStatement = (sql: unknown) => String(sql).startsWith('SET SESSION TRANSACTION ISOLATION');
    deadlockedConnection.query.mockImplementation(async (sql: string) => {
      if (isIsolationStatement(sql)) throw deadlock;
      return [[]];
    });
    getConnMock.mockResolvedValueOnce(deadlockedConnection).mockRejectedValueOnce(new Error(poolExhaustedMessage));
    runQueryMock.mockImplementation(async (connection: unknown, sql: string) => {
      if (connection === deadlockedConnection && isIsolationStatement(sql)) throw deadlock;
      return [];
    });

    const outcome = outcomeOf(manager.beginTransaction());
    await vi.runAllTimersAsync();
    const settled = await outcome;
    console.log(
      '[begin retry] outcome:',
      settled,
      'release calls:',
      deadlockedConnection.release.mock.calls.length,
      'startingTransactions:',
      internals.startingTransactions
    );

    expect(deadlockedConnection.release, 'releasing one pooled connection twice hands it to two borrowers (E7)').toHaveBeenCalledTimes(1);
    expect(settled).toBeInstanceOf(Error);
    expect((settled as Error).message, 'the outcome must be the failed acquisition, not the deadlock').toContain(poolExhaustedMessage);
    expect(internals.startingTransactions, 'the start slot must be returned').toBe(0);
  });
});

describe('ConnectionManager confirmed lock cleanup and quarantine on failure (#563 §3.6, §3.8)', () => {
  const LOCK_NAME = 'upload:file:563-lock-cleanup';
  const LOCK_WAIT_MS = 1_000;
  const TRANSPORT_LOSS = () =>
    Object.assign(new Error('Connection lost: The server closed the connection.'), { code: 'PROTOCOL_CONNECTION_LOST', fatal: true, sqlMessage: undefined });
  const LIVE_SESSION_SERVER_ERROR = () =>
    Object.assign(new Error('Lock wait timeout exceeded; try restarting transaction'), {
      errno: 1205,
      sqlState: 'HY000',
      sqlMessage: 'Lock wait timeout exceeded; try restarting transaction'
    });
  const COMMIT_SERVER_REJECTION = () =>
    Object.assign(new Error('Got error 1 during COMMIT'), { errno: 1180, sqlState: 'HY000', sqlMessage: 'Got error 1 during COMMIT' });

  type ReleaseLockBehaviour = { label: string; respond: () => Promise<unknown>; expectRelease: number; expectDestroy: number };
  const RELEASE_LOCK_BEHAVIOURS: ReleaseLockBehaviour[] = [
    { label: '(a) transport loss', respond: async () => Promise.reject(TRANSPORT_LOSS()), expectRelease: 0, expectDestroy: 1 },
    { label: '(b) live-session server error', respond: async () => Promise.reject(LIVE_SESSION_SERVER_ERROR()), expectRelease: 0, expectDestroy: 1 },
    { label: '(c) released: 0 (not held)', respond: async () => [{ released: 0 }], expectRelease: 1, expectDestroy: 0 }
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    getConnMock.mockReset();
    runQueryMock.mockReset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function beginHoldingLock(releaseLock: () => Promise<unknown>) {
    const { manager, internals } = await loadLifecycleManager();
    const connection = makeLifecycleConnection();
    getConnMock.mockResolvedValueOnce(connection);
    runQueryMock.mockImplementation(async (_connection: unknown, sql: string) => {
      if (String(sql).includes('GET_LOCK')) return [{ acquired: 1 }];
      if (String(sql).includes('RELEASE_LOCK')) return releaseLock();
      return [];
    });
    const transactionId = await manager.beginTransaction();
    expect(await manager.acquireApplicationLock(LOCK_NAME, transactionId, LOCK_WAIT_MS), 'precondition: lock held').toBe(true);
    return { manager, internals, connection, transactionId };
  }

  it.each(RELEASE_LOCK_BEHAVIOURS)('U16 COMMIT then RELEASE_LOCK $label: commit resolves; connection released only when confirmed', async behaviour => {
    const { manager, internals, connection, transactionId } = await beginHoldingLock(behaviour.respond);
    const occupancyBefore = slotOccupancy(internals) - 1;

    const outcome = await outcomeOf(manager.commitTransaction(transactionId));
    console.log(
      `[U16 commit ${behaviour.label}] outcome:`,
      outcome,
      'release:',
      connection.release.mock.calls.length,
      'destroy:',
      connection.destroy.mock.calls.length
    );

    expect(outcome, 'nothing after an acknowledged COMMIT may turn it into a failure (becd8381)').toEqual({ resolved: undefined });
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(behaviour.expectRelease);
    expect(connection.destroy).toHaveBeenCalledTimes(behaviour.expectDestroy);
    expect(slotOccupancy(internals)).toBe(occupancyBefore);
    expect(internals.transactionMeta.has(transactionId)).toBe(false);
  });

  it.each(RELEASE_LOCK_BEHAVIOURS)('U16 ROLLBACK then RELEASE_LOCK $label: rollback resolves; connection released only when confirmed', async behaviour => {
    const { manager, internals, connection, transactionId } = await beginHoldingLock(behaviour.respond);
    const occupancyBefore = slotOccupancy(internals) - 1;

    const outcome = await outcomeOf(manager.rollbackTransaction(transactionId));
    console.log(`[U16 rollback ${behaviour.label}] outcome:`, outcome);

    expect(outcome).toEqual({ resolved: undefined });
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(behaviour.expectRelease);
    expect(connection.destroy).toHaveBeenCalledTimes(behaviour.expectDestroy);
    expect(slotOccupancy(internals)).toBe(occupancyBefore);
  });

  it('U17: a RELEASE_LOCK that never settles lets the commit resolve at the cleanup deadline and quarantines the connection', async () => {
    const { APPLICATION_LOCK_CLEANUP_DEADLINE_MS } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const { manager, connection, transactionId } = await beginHoldingLock(() => neverSettles());

    const commit = outcomeOf(manager.commitTransaction(transactionId));
    await vi.advanceTimersByTimeAsync(APPLICATION_LOCK_CLEANUP_DEADLINE_MS - 1);
    expect(await settledValue(commit), 'must wait for lock cleanup up to its deadline').toBe(STILL_PENDING);
    await vi.advanceTimersByTimeAsync(1);
    const settled = await settledValue(commit);
    console.log('[U17] commit after cleanup deadline:', settled);

    expect(settled).toEqual({ resolved: undefined });
    expect(connection.release, 'RELEASE_LOCK may still be queued on this session').not.toHaveBeenCalled();
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it('U17: a confirmed lock cleanup leaves no timer armed', async () => {
    const { manager, transactionId } = await beginHoldingLock(async () => [{ released: 1 }]);
    const timersBefore = vi.getTimerCount();
    await manager.commitTransaction(transactionId);
    console.log('[U17] timers before/after confirmed cleanup:', timersBefore, vi.getTimerCount());
    expect(vi.getTimerCount(), 'the cleanup timer must be cleared on success').toBe(timersBefore);
  });

  describe('keep-alive stops when the transaction leaves active (review P2-M)', () => {
    /** Long enough to arm the keep-alive (> 90 s). */
    const KEEP_ALIVE_TEST_TIMEOUT_MS = 100_000;
    /** Mirrors withTransaction's ping interval: min(90 s, timeoutMs / 4). */
    const KEEP_ALIVE_INTERVAL_MS = KEEP_ALIVE_TEST_TIMEOUT_MS / 4;
    const KEEP_ALIVE_SET_PREFIX = 'SET SESSION wait_timeout';

    function keepAliveSetCalls(connection: LifecycleConnection): unknown[][] {
      return connection.query.mock.calls.filter(([sql]) => String(sql).startsWith(KEEP_ALIVE_SET_PREFIX));
    }

    it('no keep-alive tick runs while a COMMIT is pending', async () => {
      const { manager } = await loadLifecycleManager();
      const connection = makeLifecycleConnection();
      const pendingCommit = deferred<void>();
      connection.commit.mockImplementation(() => pendingCommit.promise);
      getConnMock.mockResolvedValueOnce(connection);
      runQueryMock.mockImplementation(async () => []);

      const outcome = outcomeOf(manager.withTransaction(async () => 'done', { timeoutMs: KEEP_ALIVE_TEST_TIMEOUT_MS }));
      await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS);
      console.log('[keep-alive] pings while committing:', connection.ping.mock.calls.length);
      expect(connection.ping, 'the keep-alive must stop when phase leaves active').not.toHaveBeenCalled();

      pendingCommit.resolve();
      expect(await outcome).toEqual({ resolved: 'done' });
    });

    it('a ping that settles after the transaction committed sends no SET on the released connection', async () => {
      const { manager } = await loadLifecycleManager();
      const connection = makeLifecycleConnection();
      const pendingPing = deferred<void>();
      connection.ping.mockImplementation(() => pendingPing.promise);
      getConnMock.mockResolvedValueOnce(connection);
      runQueryMock.mockImplementation(async () => []);
      const callbackGate = deferred<void>();

      const outcome = outcomeOf(
        manager.withTransaction(
          async () => {
            await callbackGate.promise;
            return 'done';
          },
          { timeoutMs: KEEP_ALIVE_TEST_TIMEOUT_MS }
        )
      );
      await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS);
      expect(connection.ping, 'precondition: a keep-alive tick is mid-ping').toHaveBeenCalledTimes(1);

      callbackGate.resolve();
      expect(await outcome).toEqual({ resolved: 'done' });
      expect(connection.release, 'precondition: the connection is back in the pool').toHaveBeenCalledTimes(1);
      pendingPing.resolve();
      await vi.advanceTimersByTimeAsync(0);
      console.log('[keep-alive] SETs after release:', keepAliveSetCalls(connection));

      expect(keepAliveSetCalls(connection), 'a SET here would run on a connection another borrower now owns').toEqual([]);
    });
  });

  it('U15: a ROLLBACK error rethrows the same object and quarantines the connection', async () => {
    const { manager, internals } = await loadLifecycleManager();
    const connection = makeLifecycleConnection();
    const rollbackError = Object.assign(new Error('Lost connection to MySQL server during query'), { code: 'PROTOCOL_CONNECTION_LOST', sqlMessage: undefined });
    connection.rollback.mockRejectedValue(rollbackError);
    getConnMock.mockResolvedValueOnce(connection);
    runQueryMock.mockImplementation(async () => []);
    const transactionId = await manager.beginTransaction();
    const occupancyBefore = slotOccupancy(internals) - 1;

    const outcome = await outcomeOf(manager.rollbackTransaction(transactionId));
    console.log('[U15] rollback error outcome:', outcome);

    expect(outcome).toBe(rollbackError);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
    expect(slotOccupancy(internals)).toBe(occupancyBefore);
  });

  it('U11: a COMMIT server rejection rethrows the same object, quarantines, and discards the changelog', async () => {
    const { discardTransactionChangelog, flushTransactionChangelog } = await import('@/lib/connectionlogger');
    const { manager, internals } = await loadLifecycleManager();
    const connection = makeLifecycleConnection();
    const rejection = COMMIT_SERVER_REJECTION();
    connection.commit.mockRejectedValue(rejection);
    getConnMock.mockResolvedValueOnce(connection);
    runQueryMock.mockImplementation(async () => []);
    const transactionId = await manager.beginTransaction();
    const occupancyBefore = slotOccupancy(internals) - 1;

    const outcome = await outcomeOf(manager.commitTransaction(transactionId));
    console.log('[U11] commit rejection outcome:', outcome);

    expect(outcome, 'a definitive server rejection reaches the caller unchanged').toBe(rejection);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
    expect(vi.mocked(discardTransactionChangelog)).toHaveBeenCalledWith(transactionId);
    expect(vi.mocked(flushTransactionChangelog)).not.toHaveBeenCalled();
    expect(slotOccupancy(internals)).toBe(occupancyBefore);
  });
});

describe('ConnectionManager COMMIT fails closed and is bounded (#563 §2.4, §3.3)', () => {
  const NEVER_BEGUN_TRANSACTION_ID = 'never-begun-563';
  const CALLBACK_TIMEOUT_MS = 5_000;
  const DISCARD_REASON = 'callback discarded its own transaction';

  beforeEach(() => {
    vi.useFakeTimers();
    getConnMock.mockReset();
    runQueryMock.mockReset();
    runQueryMock.mockImplementation(async () => []);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function beginDirect(connection: LifecycleConnection) {
    const loaded = await loadLifecycleManager();
    getConnMock.mockResolvedValueOnce(connection);
    const transactionId = await loaded.manager.beginTransaction();
    return { ...loaded, transactionId };
  }

  it('U7: commit of a never-begun id and a second commit after success reject TransactionNotActiveError and touch no connection', async () => {
    const { TransactionNotActiveError } = await vi.importActual<typeof import('./transactionerrors')>('./transactionerrors');
    const connection = makeLifecycleConnection();
    const { manager, transactionId } = await beginDirect(connection);

    const neverBegun = await outcomeOf(manager.commitTransaction(NEVER_BEGUN_TRANSACTION_ID));
    await manager.commitTransaction(transactionId);
    const secondCommit = await outcomeOf(manager.commitTransaction(transactionId));
    console.log('[U7] never-begun:', neverBegun, 'second commit:', secondCommit);

    expect(neverBegun, 'today this resolves: a silent success for work that never committed').toBeInstanceOf(TransactionNotActiveError);
    expect(secondCommit).toBeInstanceOf(TransactionNotActiveError);
    expect(connection.commit, 'only the one real commit may reach the connection').toHaveBeenCalledTimes(1);
  });

  it('U9: a COMMIT with no reply by the deadline is quarantined and KILLed, never rolled back, and rejects with an unknown outcome', async () => {
    const { killQueryOnThread } = await import('@/lib/db/primitives');
    const { discardTransactionChangelog, flushTransactionChangelog } = await import('@/lib/connectionlogger');
    const { TransactionCommitOutcomeUnknownError } = await vi.importActual<typeof import('./transactionerrors')>('./transactionerrors');
    const connection = makeLifecycleConnection();
    connection.commit.mockImplementation(() => neverSettles());
    const timersBefore = vi.getTimerCount();
    const { ConnectionManagerClass, manager, internals, transactionId } = await beginDirect(connection);
    const occupancyBefore = slotOccupancy(internals) - 1;

    const commit = outcomeOf(manager.commitTransaction(transactionId));
    await vi.advanceTimersByTimeAsync(ConnectionManagerClass.DEFAULT_COMMIT_DEADLINE_MS);
    const outcome = await settledValue(commit);
    console.log('[U9] outcome:', outcome, 'destroy:', connection.destroy.mock.calls.length, 'timers:', vi.getTimerCount());

    expect(outcome).toBeInstanceOf(TransactionCommitOutcomeUnknownError);
    expect((outcome as InstanceType<typeof TransactionCommitOutcomeUnknownError>).trigger).toBe('deadline_exceeded');
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
    expect(connection.rollback, 'a ROLLBACK after a sent COMMIT could report rolled-back work that committed').not.toHaveBeenCalled();
    expect(vi.mocked(killQueryOnThread)).toHaveBeenCalledWith(LIFECYCLE_THREAD_ID, expect.any(String));
    expect(vi.mocked(discardTransactionChangelog)).toHaveBeenCalledWith(transactionId);
    expect(vi.mocked(flushTransactionChangelog)).not.toHaveBeenCalled();
    expect(slotOccupancy(internals)).toBe(occupancyBefore);
    expect(vi.getTimerCount()).toBe(timersBefore);
  });

  it('U9 variant: a COMMIT acknowledged after the deadline is logged as committed-after-deadline', async () => {
    const { COMMIT_ACKNOWLEDGED_AFTER_DEADLINE_EVENT } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const lateCommit = deferred<void>();
    const connection = makeLifecycleConnection();
    connection.commit.mockImplementation(() => lateCommit.promise);
    const { ConnectionManagerClass, manager, transactionId } = await beginDirect(connection);

    const commit = outcomeOf(manager.commitTransaction(transactionId));
    await vi.advanceTimersByTimeAsync(ConnectionManagerClass.DEFAULT_COMMIT_DEADLINE_MS);
    await commit;
    lateCommit.resolve();
    await vi.advanceTimersByTimeAsync(0);
    console.log(
      '[U9 late] warn calls:',
      loggerMock.warn.mock.calls.map(call => call[0])
    );

    expect(loggerMock.warn).toHaveBeenCalledWith(COMMIT_ACKNOWLEDGED_AFTER_DEADLINE_EVENT, expect.objectContaining({ transactionId }));
  });

  it('U10: a COMMIT transport loss (sqlMessage: undefined, as mysql2’s promise adapter builds it) is an unknown outcome carrying the original as cause', async () => {
    const { killQueryOnThread } = await import('@/lib/db/primitives');
    const { TransactionCommitOutcomeUnknownError } = await vi.importActual<typeof import('./transactionerrors')>('./transactionerrors');
    const { findRetryClassifierSubstrings } = await import('@/tests/setup/retry-classifier-substrings');
    const transportLoss = Object.assign(new Error('Connection lost: The server closed the connection.'), {
      code: 'PROTOCOL_CONNECTION_LOST',
      fatal: true,
      sqlMessage: undefined
    });
    expect(Object.prototype.hasOwnProperty.call(transportLoss, 'sqlMessage'), 'fixture must carry an OWN undefined sqlMessage, like make_done_cb.js:11').toBe(
      true
    );
    const connection = makeLifecycleConnection();
    connection.commit.mockRejectedValue(transportLoss);
    const { manager, transactionId } = await beginDirect(connection);

    const outcome = await outcomeOf(manager.commitTransaction(transactionId));
    const unknown = outcome as InstanceType<typeof TransactionCommitOutcomeUnknownError>;
    console.log('[U10] outcome:', {
      name: unknown?.name,
      trigger: unknown?.trigger,
      message: unknown?.message,
      causeCode: (unknown?.cause as { code?: string })?.code
    });

    expect(outcome, 'presence of a sqlMessage KEY must not count as a server reply').toBeInstanceOf(TransactionCommitOutcomeUnknownError);
    expect(unknown.trigger).toBe('connection_lost');
    expect(unknown.cause).toBe(transportLoss);
    expect(findRetryClassifierSubstrings(unknown.message)).toEqual([]);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
    expect(vi.mocked(killQueryOnThread)).toHaveBeenCalledWith(LIFECYCLE_THREAD_ID, expect.any(String));
  });

  it('U12: withTransaction whose COMMIT stalls rejects with the unknown outcome and never rolls back', async () => {
    const { TransactionCommitOutcomeUnknownError } = await vi.importActual<typeof import('./transactionerrors')>('./transactionerrors');
    const { ConnectionManagerClass, manager } = await loadLifecycleManager();
    const connection = makeLifecycleConnection();
    connection.commit.mockImplementation(() => neverSettles());
    getConnMock.mockResolvedValueOnce(connection);
    const rollbackSpy = vi.spyOn(manager, 'rollbackTransaction');

    const outcome = outcomeOf(manager.withTransaction(async () => 'work done', { timeoutMs: CALLBACK_TIMEOUT_MS }));
    await vi.advanceTimersByTimeAsync(ConnectionManagerClass.DEFAULT_COMMIT_DEADLINE_MS);
    const settled = await settledValue(outcome);
    console.log('[U12] outcome:', settled, 'rollback calls:', rollbackSpy.mock.calls.length);

    expect(settled).toBeInstanceOf(TransactionCommitOutcomeUnknownError);
    expect(rollbackSpy, 'no ROLLBACK may follow a COMMIT that was sent').not.toHaveBeenCalled();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it('U13: a callback that discards its transaction and returns normally makes withTransaction reject TransactionNotActiveError', async () => {
    const { TransactionNotActiveError } = await vi.importActual<typeof import('./transactionerrors')>('./transactionerrors');
    const { manager } = await loadLifecycleManager();
    const connection = makeLifecycleConnection();
    getConnMock.mockResolvedValueOnce(connection);

    const outcome = await outcomeOf(
      manager.withTransaction(async tx => {
        manager.discardTransaction(tx.id, DISCARD_REASON);
        return 'looks fine';
      })
    );
    console.log('[U13] outcome:', outcome);
    expect(outcome, 'today this resolves "looks fine" for work the server rolled back').toBeInstanceOf(TransactionNotActiveError);
    expect(connection.commit).not.toHaveBeenCalled();
  });
});

describe('ConnectionManager ROLLBACK deadline and callback-timeout abandonment (#563 §3.4, §4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getConnMock.mockReset();
    runQueryMock.mockReset();
    runQueryMock.mockImplementation(async () => []);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('U14: a ROLLBACK with no reply by the deadline is quarantined and KILLed, then resolves', async () => {
    const { killQueryOnThread } = await import('@/lib/db/primitives');
    const { ROLLBACK_DEADLINE_EXCEEDED_EVENT } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const timersBefore = vi.getTimerCount();
    const { ConnectionManagerClass, manager, internals } = await loadLifecycleManager();
    const connection = makeLifecycleConnection();
    connection.rollback.mockImplementation(() => neverSettles());
    getConnMock.mockResolvedValueOnce(connection);
    const transactionId = await manager.beginTransaction();
    const occupancyBefore = slotOccupancy(internals) - 1;

    const rollback = outcomeOf(manager.rollbackTransaction(transactionId));
    await vi.advanceTimersByTimeAsync(ConnectionManagerClass.DEFAULT_ROLLBACK_DEADLINE_MS);
    const settled = await settledValue(rollback);
    console.log('[U14] rollback outcome:', settled, 'timers:', vi.getTimerCount());

    expect(settled, 'callers roll back from catch blocks; a throw here would mask their real error').toEqual({ resolved: undefined });
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
    expect(vi.mocked(killQueryOnThread)).toHaveBeenCalledWith(LIFECYCLE_THREAD_ID, expect.any(String));
    expect(loggerMock.error).toHaveBeenCalledWith(ROLLBACK_DEADLINE_EXCEEDED_EVENT, undefined, expect.objectContaining({ transactionId }));
    expect(slotOccupancy(internals)).toBe(occupancyBefore);
    expect(vi.getTimerCount()).toBe(timersBefore);
  });

  it('R-7: a rollback while the transaction is committing sends no ROLLBACK', async () => {
    const { manager } = await loadLifecycleManager();
    const pendingCommit = deferred<void>();
    const connection = makeLifecycleConnection();
    connection.commit.mockImplementation(() => pendingCommit.promise);
    getConnMock.mockResolvedValueOnce(connection);
    const transactionId = await manager.beginTransaction();

    const commit = manager.commitTransaction(transactionId);
    await manager.rollbackTransaction(transactionId);
    pendingCommit.resolve();
    await commit;

    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });
});

describe('ConnectionManager reaper: own deadline, idle, active (#563 §2)', () => {
  const REAPER_DEADLINE_MS = 1_000;
  const PAST_REAPER_DEADLINE_MS = 1_500;
  const LONG_CALLBACK_TIMEOUT_MS = 300_000;
  const PAST_DEFAULT_THRESHOLD_MS = 241_000;
  const EVICTION_REAPER_DEADLINE_MS = 1;

  beforeEach(() => {
    vi.useFakeTimers();
    getConnMock.mockReset();
    runQueryMock.mockReset();
    runQueryMock.mockImplementation(async () => []);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('U1: a withTransaction with timeoutMs 300 000 is not reaped at 241 s and still times out at 300 s', async () => {
    const { TransactionCallbackTimeoutError } = await vi.importActual<typeof import('./transactionerrors')>('./transactionerrors');
    const { manager, internals } = await loadLifecycleManager();
    const connection = makeLifecycleConnection();
    getConnMock.mockResolvedValueOnce(connection);

    const outcome = outcomeOf(manager.withTransaction(() => neverSettles<string>(), { timeoutMs: LONG_CALLBACK_TIMEOUT_MS }));
    await vi.advanceTimersByTimeAsync(0);
    const [transactionId] = Array.from(internals.transactionMeta.keys());
    await vi.advanceTimersByTimeAsync(PAST_DEFAULT_THRESHOLD_MS);

    const reaped = await manager.cleanupStaleTransactions();
    console.log('[U1] reaped at 241 s:', reaped, 'phase:', internals.transactionMeta.get(transactionId)?.phase);
    expect(reaped, 'the issue’s scenario: an age-only reaper rolls back a healthy 300 s transaction here').toBe(0);
    expect(internals.transactionMeta.get(transactionId)?.phase).toBe('active');
    expect(connection.destroy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(LONG_CALLBACK_TIMEOUT_MS - PAST_DEFAULT_THRESHOLD_MS);
    expect(await settledValue(outcome)).toBeInstanceOf(TransactionCallbackTimeoutError);
  });

  it('U2: an idle direct transaction is reaped at exactly its 240 s deadline by quarantine, not ROLLBACK', async () => {
    const { ConnectionManagerClass, manager, internals } = await loadLifecycleManager();
    const { TRANSACTION_REAPED_EVENT } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const connection = makeLifecycleConnection();
    getConnMock.mockResolvedValueOnce(connection);
    const transactionId = await manager.beginTransaction();
    const occupancyBefore = slotOccupancy(internals) - 1;

    await vi.advanceTimersByTimeAsync(ConnectionManagerClass.DEFAULT_STALE_TRANSACTION_THRESHOLD_MS - 1);
    const beforeDeadline = await manager.cleanupStaleTransactions();
    await vi.advanceTimersByTimeAsync(1);
    const atDeadline = await manager.cleanupStaleTransactions();
    console.log('[U2] reaped before/at deadline:', beforeDeadline, atDeadline);

    expect(beforeDeadline).toBe(0);
    expect(atDeadline).toBe(1);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release, 'a reaped connection must never return to the pool').not.toHaveBeenCalled();
    expect(connection.rollback, 'a ROLLBACK over the shared connection is the double-release race').not.toHaveBeenCalled();
    expect(slotOccupancy(internals)).toBe(occupancyBefore);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      TRANSACTION_REAPED_EVENT,
      expect.objectContaining({ transactionId, threadId: LIFECYCLE_THREAD_ID, overdueMs: 0 })
    );
  });

  it('U3: a transaction whose COMMIT is pending past its deadline is not reaped and commits once', async () => {
    const { manager } = await loadLifecycleManager();
    const pendingCommit = deferred<void>();
    const connection = makeLifecycleConnection();
    connection.commit.mockImplementation(() => pendingCommit.promise);
    getConnMock.mockResolvedValueOnce(connection);
    const transactionId = await manager.beginTransaction({ reaperDeadlineMs: REAPER_DEADLINE_MS });

    const commit = outcomeOf(manager.commitTransaction(transactionId));
    await vi.advanceTimersByTimeAsync(PAST_REAPER_DEADLINE_MS);
    const reaped = await manager.cleanupStaleTransactions();
    pendingCommit.resolve();
    const committed = await commit;
    console.log('[U3] reaped:', reaped, 'commit:', committed);

    expect(reaped).toBe(0);
    expect(committed).toEqual({ resolved: undefined });
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it('U4: a transaction with a statement in flight past its deadline is not reaped and its owner commits', async () => {
    const { manager } = await loadLifecycleManager();
    const connection = makeLifecycleConnection();
    getConnMock.mockResolvedValueOnce(connection);
    const transactionId = await manager.beginTransaction({ reaperDeadlineMs: REAPER_DEADLINE_MS });
    const longStatement = deferred<unknown[]>();
    runQueryMock.mockImplementation(async (_connection: unknown, sql: string) => (String(sql).startsWith('CALL') ? longStatement.promise : []));

    const statement = manager.executeQuery('CALL RefreshViewFullTable()', [], transactionId);
    await vi.advanceTimersByTimeAsync(PAST_REAPER_DEADLINE_MS);
    const reaped = await manager.cleanupStaleTransactions();
    longStatement.resolve([]);
    await statement;
    const committed = await outcomeOf(manager.commitTransaction(transactionId));
    console.log('[U4] reaped:', reaped, 'commit:', committed);

    expect(reaped, 'a deadline-only reaper kills the full-site refresh mid-statement (§2.3)').toBe(0);
    expect(committed).toEqual({ resolved: undefined });
  });

  it('U5: after a reap, query and commit fail closed with typed errors and rollback is a no-op', async () => {
    const { TransactionNotActiveError, TransactionReapedError } = await vi.importActual<typeof import('./transactionerrors')>('./transactionerrors');
    const { manager } = await loadLifecycleManager();
    const connection = makeLifecycleConnection();
    getConnMock.mockResolvedValueOnce(connection);
    const transactionId = await manager.beginTransaction({ reaperDeadlineMs: REAPER_DEADLINE_MS });
    await vi.advanceTimersByTimeAsync(REAPER_DEADLINE_MS);
    expect(await manager.cleanupStaleTransactions()).toBe(1);

    const firstQuery = await outcomeOf(manager.executeQuery('SELECT 1', [], transactionId));
    const secondQuery = await outcomeOf(manager.executeQuery('SELECT 1', [], transactionId));
    const firstCommit = await outcomeOf(manager.commitTransaction(transactionId));
    const secondCommit = await outcomeOf(manager.commitTransaction(transactionId));
    const rollback = await outcomeOf(manager.rollbackTransaction(transactionId));
    console.log('[U5]', { firstQuery, secondQuery, firstCommit, secondCommit, rollback });

    expect(firstQuery).toBeInstanceOf(TransactionReapedError);
    expect(secondQuery, 'executeQuery must not consume the tombstone').toBeInstanceOf(TransactionReapedError);
    expect(firstCommit).toBeInstanceOf(TransactionReapedError);
    expect(secondCommit, 'commit consumed the tombstone; it still fails closed').toBeInstanceOf(TransactionNotActiveError);
    expect(rollback).toEqual({ resolved: undefined });
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('U6: tombstones are capped; the evicted oldest owner still fails closed while the newest gets TransactionReapedError', async () => {
    const { TransactionNotActiveError, TransactionReapedError } = await vi.importActual<typeof import('./transactionerrors')>('./transactionerrors');
    const { MAX_REAPED_TRANSACTION_RECORDS } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const { manager, internals } = await loadLifecycleManager();
    getConnMock.mockImplementation(async () => makeLifecycleConnection());
    const totalToReap = MAX_REAPED_TRANSACTION_RECORDS + 1;
    const reapedIds: string[] = [];

    while (reapedIds.length < totalToReap) {
      const waveSize = Math.min(internals.MAX_CONCURRENT_TRANSACTIONS, totalToReap - reapedIds.length);
      const wave: string[] = [];
      for (let index = 0; index < waveSize; index++) {
        wave.push(await manager.beginTransaction({ reaperDeadlineMs: EVICTION_REAPER_DEADLINE_MS }));
      }
      await vi.advanceTimersByTimeAsync(EVICTION_REAPER_DEADLINE_MS);
      expect(await manager.cleanupStaleTransactions()).toBe(waveSize);
      reapedIds.push(...wave);
    }

    const tombstonesBeforeCommits = internals.reapedTransactions?.size;
    const oldestCommit = await outcomeOf(manager.commitTransaction(reapedIds[0]));
    const newestCommit = await outcomeOf(manager.commitTransaction(reapedIds[reapedIds.length - 1]));
    console.log('[U6] tombstones kept:', tombstonesBeforeCommits, 'oldest:', oldestCommit, 'newest:', newestCommit);

    expect(tombstonesBeforeCommits, 'one more reap than the cap must evict exactly the oldest').toBe(MAX_REAPED_TRANSACTION_RECORDS);
    expect(oldestCommit, 'eviction must never restore silent success (R3)').toBeInstanceOf(TransactionNotActiveError);
    expect(newestCommit).toBeInstanceOf(TransactionReapedError);
  });
});
