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

vi.mock('@/lib/db/primitives', () => ({
  getConn: getConnMock,
  runQuery: runQueryMock
}));

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
