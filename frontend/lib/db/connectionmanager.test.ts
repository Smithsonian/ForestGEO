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
    runQueryMock.mockResolvedValueOnce([{ TreeID: 1 }]);
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
    expect(connection.query).toHaveBeenCalledWith('USE `forestgeo_testing`');
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
    const { default: ConnectionManager } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
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
      expect(workingConnection.query).toHaveBeenCalledWith(SET_ISOLATION_SQL);
      expect(workingConnection.beginTransaction).toHaveBeenCalledTimes(1);

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
      expect(workingConnection.beginTransaction).toHaveBeenCalledTimes(1);
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
    runQueryMock.mockRejectedValueOnce(timeoutError);

    const thrown = await cm.executeQuery('CALL forestgeo_test.bulkingestionprocess(?, ?)', ['f', 'b'], transactionId).then(
      () => {
        throw new Error('executeQuery resolved but runQuery rejected with a timeout');
      },
      (error: unknown) => error
    );

    // The original error survives, unwrapped.
    expect(thrown).toBe(timeoutError);

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
    runQueryMock.mockRejectedValueOnce(new primitives.QueryTimeoutError(STATEMENT_TIMEOUT_MS, TIMED_OUT_THREAD_ID));

    await expect(cm.executeQuery('UPDATE forestgeo_test.coremeasurements SET IsActive = 0', [], transactionId)).rejects.toBeInstanceOf(
      primitives.QueryTimeoutError
    );

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
    runQueryMock.mockRejectedValueOnce(sqlError);

    await expect(cm.executeQuery('SELECT * FROM forestgeo_test.nonexistent', [], transactionId)).rejects.toBe(sqlError);

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
    await expect(cm.commitTransaction(transactionId)).resolves.toBeUndefined();

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
    runQueryMock.mockRejectedValueOnce(new primitives.QueryTimeoutError(1000, DISCARDED_THREAD_ID));
    await expect(cm.executeQuery('CALL forestgeo_test.bulkingestionprocess(?, ?)', ['f', 'b'], transactionId)).rejects.toBeInstanceOf(
      primitives.QueryTimeoutError
    );

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
    expect(connection.release, 'the connection must be returned after the timeout rollback').toHaveBeenCalled();
    const { killQueryOnThread } = await import('@/lib/db/primitives');
    expect(killQueryOnThread, 'the in-flight statement must be killed by thread id before rollback').toHaveBeenCalledWith(THREAD_ID, expect.any(String));
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
    expect(connection.release).toHaveBeenCalledTimes(1);
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
});
