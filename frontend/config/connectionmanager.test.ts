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

describe('ConnectionManager.withTransaction — slot-timeout queue cleanup', () => {
  /**
   * Regression: the slot-waiter timeout used to look up `resolve` in the queue,
   * but the queue actually stored `wrappedResolve`, so indexOf always returned
   * -1 and timed-out waiters were never spliced out. On the next slot release,
   * releaseTransactionSlot would shift the dead wrappedResolve and invoke it,
   * silently consuming a release that should have woken a live waiter.
   *
   * The queue is private; this test drives the exact public shape — push a
   * waiter, time it out, then call releaseTransactionSlot — and asserts the
   * queue is empty after timeout (so the next live release reaches a real
   * waiter, not a corpse).
   */
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('splices a timed-out waiter out of the transactionSlotQueue so the next release wakes a live waiter', async () => {
    const { default: ConnectionManager } = await vi.importActual<typeof import('./connectionmanager')>('./connectionmanager');
    const cm = ConnectionManager.getInstance();
    const internals = cm as unknown as {
      transactionSlotQueue: Array<() => void>;
      MAX_CONCURRENT_TRANSACTIONS: number;
      transactionConnections: Map<string, unknown>;
    };

    // Saturate the slot gate so withTransaction's first action is to wait on
    // transactionSlotQueue. We do NOT exercise the rest of the transaction
    // lifecycle — beginTransaction will never be reached.
    const cap = internals.MAX_CONCURRENT_TRANSACTIONS;
    const sentinelIds: string[] = [];
    for (let i = 0; i < cap; i++) {
      const id = `__test_sentinel_${i}__`;
      sentinelIds.push(id);
      internals.transactionConnections.set(id, {} as unknown);
    }

    try {
      // Snapshot the queue length AT THE INSTANT the waiter is enqueued. The
      // production code inserts wrappedResolve synchronously inside withTransaction
      // before any await beyond the Promise constructor, so we can read the length
      // immediately after firing the call.
      const queueLengthBaseline = internals.transactionSlotQueue.length;

      // Drive the production code through the slot wait. The handler we pass
      // is never invoked — the timeout will reject before we'd ever get there.
      const txPromise = cm.withTransaction(async () => {
        throw new Error('callback should be unreachable: timeout must fire first');
      });

      // Catch unhandled-rejection on the dangling promise; we'll assert on it below.
      const settled = txPromise.then(
        () => ({ ok: true as const }),
        (err: Error) => ({ ok: false as const, err })
      );

      // Synchronously after enqueuing, the queue MUST have grown by one. Use a
      // 0ms tick so the Promise constructor body runs.
      await vi.advanceTimersByTimeAsync(0);
      expect(internals.transactionSlotQueue.length).toBe(queueLengthBaseline + 1);

      // Advance past the 60s deadline; the timeout must reject AND splice.
      await vi.advanceTimersByTimeAsync(60001);

      const outcome = await settled;
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.err.message).toContain('Transaction slot wait timeout');
      }

      // Under the old bug indexOf returned -1 (queue stored wrappedResolve, the
      // splice looked up the unwrapped resolve), so the queue length would still
      // be baseline+1. The fix restores baseline.
      expect(internals.transactionSlotQueue.length).toBe(queueLengthBaseline);
    } finally {
      for (const id of sentinelIds) {
        internals.transactionConnections.delete(id);
      }
    }
  });
});
