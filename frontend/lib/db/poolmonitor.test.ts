import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('chalk', () => ({
  default: {
    cyan: (value: unknown) => String(value),
    yellow: (value: unknown) => String(value),
    red: (value: unknown) => String(value)
  }
}));

vi.mock('@/ailogger', () => ({
  default: loggerMock
}));

function createFakePool(overrides: Record<string, unknown> = {}) {
  return {
    getConnection: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    query: vi.fn().mockResolvedValue([[]]),
    ...overrides
  };
}

function createFakeConnection() {
  return {
    on: vi.fn(),
    query: vi.fn().mockResolvedValue([[]])
  };
}

// A recyclable connection: a real emitter (so listenerCount/emit work) plus the
// release() method mysql2 exposes. Modelling recycling means getConnection() hands
// back this SAME object on every acquire.
function createRecyclableConnection() {
  const connection = new EventEmitter() as EventEmitter & { release: () => void };
  connection.release = () => connection.emit('release');
  return connection;
}

describe('PoolMonitor', () => {
  const originalAzureSqlServer = process.env.AZURE_SQL_SERVER;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllTimers();
    vi.resetModules();
    delete process.env.AZURE_SQL_SERVER;
    loggerMock.info.mockReset();
    loggerMock.warn.mockReset();
    loggerMock.error.mockReset();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    if (originalAzureSqlServer === undefined) {
      delete process.env.AZURE_SQL_SERVER;
    } else {
      process.env.AZURE_SQL_SERVER = originalAzureSqlServer;
    }
  });

  it('reinitializes and retries when getConnection hits a closed pool', async () => {
    const closedPoolError = new Error('Pool is closed.');
    const recoveredConnection = createFakeConnection();
    const firstPool = createFakePool({
      getConnection: vi.fn().mockRejectedValue(closedPoolError),
      end: vi.fn().mockRejectedValue(closedPoolError)
    });
    const secondPool = createFakePool({
      getConnection: vi.fn().mockResolvedValue(recoveredConnection)
    });

    const { PoolMonitor } = await vi.importActual<typeof import('./poolmonitor')>('./poolmonitor');
    const monitor = new PoolMonitor({ connectionLimit: 2 }) as unknown as {
      pool: ReturnType<typeof createFakePool>;
      poolClosed: boolean;
      reinitializePool: () => Promise<void>;
      getConnection: () => Promise<unknown>;
      closeAllConnections: () => Promise<void>;
      isPoolClosed: () => boolean;
    };

    monitor.pool = firstPool;
    monitor.poolClosed = false;
    let reinitializeCalls = 0;
    (monitor as { reinitializePool: () => Promise<void> }).reinitializePool = async () => {
      reinitializeCalls += 1;
      monitor.pool = secondPool;
      monitor.poolClosed = false;
    };

    const connection = await monitor.getConnection();
    expect(reinitializeCalls).toBe(1);
    expect(secondPool.getConnection).toHaveBeenCalledTimes(1);
    expect(connection).toHaveProperty('on');
    expect(monitor.isPoolClosed()).toBe(false);

    await monitor.closeAllConnections();
  });

  it('treats pool.end() saying already closed as a successful close', async () => {
    const closedPoolError = new Error('Pool is closed.');
    const pool = createFakePool({
      end: vi.fn().mockRejectedValue(closedPoolError)
    });

    const { PoolMonitor } = await vi.importActual<typeof import('./poolmonitor')>('./poolmonitor');
    const monitor = new PoolMonitor({}) as unknown as {
      pool: ReturnType<typeof createFakePool>;
      closeAllConnections: () => Promise<void>;
      isPoolClosed: () => boolean;
    };
    monitor.pool = pool;

    await expect(monitor.closeAllConnections()).resolves.toBeUndefined();
    expect(monitor.isPoolClosed()).toBe(true);
  });

  it('observes sleeping pooled connections without killing or reinitializing them', async () => {
    const sleepingRows = Array.from({ length: 12 }, (_, index) => ({
      ID: 100 + index,
      COMMAND: 'Sleep',
      TIME: 1000
    }));
    const pool = createFakePool({
      query: vi.fn().mockResolvedValue([sleepingRows]),
      end: vi.fn().mockResolvedValue(undefined)
    });

    const { PoolMonitor } = await vi.importActual<typeof import('./poolmonitor')>('./poolmonitor');
    const monitor = new PoolMonitor({}) as unknown as {
      pool: ReturnType<typeof createFakePool>;
      poolClosed: boolean;
      isPoolClosed: () => boolean;
      closeAllConnections: () => Promise<void>;
    };
    monitor.pool = pool;
    monitor.poolClosed = false;

    await vi.advanceTimersByTimeAsync(30000);

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('information_schema.processlist'));
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringMatching(/^KILL /));
    expect(pool.end).not.toHaveBeenCalled();
    expect(monitor.isPoolClosed()).toBe(false);

    await monitor.closeAllConnections();
  });

  it('attaches query/release listeners at most once per recycled physical connection', async () => {
    const ACQUIRE_COUNT = 5;
    const EXPECTED_LISTENER_COUNT = 1;
    const QUERY_EVENT = 'query';
    const RELEASE_EVENT = 'release';

    const recycledConnection = createRecyclableConnection();
    const pool = createFakePool({
      // Simulate mysql2 recycling: the same physical object comes back every acquire.
      getConnection: vi.fn().mockResolvedValue(recycledConnection)
    });

    const { PoolMonitor } = await vi.importActual<typeof import('./poolmonitor')>('./poolmonitor');
    const monitor = new PoolMonitor({ connectionLimit: 2 }) as unknown as {
      pool: ReturnType<typeof createFakePool>;
      poolClosed: boolean;
      resetInactivityTimer: () => void;
      getConnection: () => Promise<unknown>;
      closeAllConnections: () => Promise<void>;
    };
    monitor.pool = pool;
    monitor.poolClosed = false;

    for (let acquire = 0; acquire < ACQUIRE_COUNT; acquire += 1) {
      await monitor.getConnection();
    }

    // The core regression assertion: without the WeakSet guard these climb to
    // ACQUIRE_COUNT (5), tripping MaxListenersExceededWarning and leaking listeners.
    expect(recycledConnection.listenerCount(QUERY_EVENT)).toBe(EXPECTED_LISTENER_COUNT);
    expect(recycledConnection.listenerCount(RELEASE_EVENT)).toBe(EXPECTED_LISTENER_COUNT);

    // Behavior preserved: the single surviving listener still resets the inactivity
    // timer when the connection emits query/release. The attached arrow closures call
    // this.resetInactivityTimer() dynamically, so a post-attach spy still observes them.
    const resetSpy = vi.fn();
    monitor.resetInactivityTimer = resetSpy;

    recycledConnection.emit(QUERY_EVENT);
    recycledConnection.emit(RELEASE_EVENT);

    expect(resetSpy).toHaveBeenCalledTimes(2);

    await monitor.closeAllConnections();
  });

  /**
   * tryAcquireConnection exists for the out-of-band `KILL QUERY` that aborts a
   * timed-out statement. Two hazards it must not have:
   *
   *  - waiting forever (createManagedPool forces queueLimit: 0, so a saturated
   *    pool makes an ordinary acquisition unbounded — and a saturated pool is
   *    precisely the state the kill path runs in), and
   *  - leaking the connection that arrives after the caller gave up: mysql2 keeps
   *    the losing acquisition queued and eventually hands it a real connection
   *    that nothing would ever release.
   */
  describe('tryAcquireConnection', () => {
    const ACQUIRE_TIMEOUT_MS = 5000;

    async function makeMonitor(pool: ReturnType<typeof createFakePool>) {
      const { PoolMonitor } = await vi.importActual<typeof import('./poolmonitor')>('./poolmonitor');
      const monitor = new PoolMonitor({ connectionLimit: 2 }) as unknown as {
        pool: ReturnType<typeof createFakePool>;
        poolClosed: boolean;
        tryAcquireConnection: (timeoutMs: number) => Promise<{ status: string; connection?: unknown; error?: unknown }>;
        closeAllConnections: () => Promise<void>;
      };
      monitor.pool = pool;
      monitor.poolClosed = false;
      return monitor;
    }

    it('returns the connection when the pool answers before the deadline', async () => {
      const connection = createFakeConnection();
      const monitor = await makeMonitor(createFakePool({ getConnection: vi.fn().mockResolvedValue(connection) }));

      const result = await monitor.tryAcquireConnection(ACQUIRE_TIMEOUT_MS);

      expect(result).toEqual({ status: 'acquired', connection });
      await monitor.closeAllConnections();
    });

    it('gives up at the deadline instead of queueing forever behind a saturated pool', async () => {
      const monitor = await makeMonitor(createFakePool({ getConnection: vi.fn().mockReturnValue(new Promise(() => {})) }));

      const pending = monitor.tryAcquireConnection(ACQUIRE_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(ACQUIRE_TIMEOUT_MS);

      expect(await pending).toEqual({ status: 'timeout' });
      await monitor.closeAllConnections();
    });

    it('releases a connection that arrives AFTER the deadline rather than leaking it', async () => {
      let handOverConnection!: (connection: unknown) => void;
      const lateConnection = { release: vi.fn(), destroy: vi.fn() };
      const monitor = await makeMonitor(
        createFakePool({
          getConnection: vi.fn().mockReturnValue(
            new Promise(resolve => {
              handOverConnection = resolve;
            })
          )
        })
      );

      const pending = monitor.tryAcquireConnection(ACQUIRE_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(ACQUIRE_TIMEOUT_MS);
      expect(await pending).toEqual({ status: 'timeout' });

      // The pool finally honours the queued acquisition. Nobody is waiting for
      // it any more, so it must go straight back.
      handOverConnection(lateConnection);
      await vi.advanceTimersByTimeAsync(0);

      expect(lateConnection.release).toHaveBeenCalledTimes(1);
      await monitor.closeAllConnections();
    });

    it('destroys a late arrival that cannot be released', async () => {
      let handOverConnection!: (connection: unknown) => void;
      const lateConnection = {
        release: vi.fn(() => {
          throw new Error('already returned');
        }),
        destroy: vi.fn()
      };
      const monitor = await makeMonitor(
        createFakePool({
          getConnection: vi.fn().mockReturnValue(
            new Promise(resolve => {
              handOverConnection = resolve;
            })
          )
        })
      );

      const pending = monitor.tryAcquireConnection(ACQUIRE_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(ACQUIRE_TIMEOUT_MS);
      await pending;

      handOverConnection(lateConnection);
      await vi.advanceTimersByTimeAsync(0);

      expect(lateConnection.destroy).toHaveBeenCalledTimes(1);
      await monitor.closeAllConnections();
    });

    it('reports an acquisition failure without reinitializing the pool', async () => {
      const acquisitionError = new Error('Too many connections');
      const pool = createFakePool({ getConnection: vi.fn().mockRejectedValue(acquisitionError) });
      const monitor = await makeMonitor(pool);
      let reinitializeCalls = 0;
      (monitor as unknown as { reinitializePool: () => Promise<void> }).reinitializePool = async () => {
        reinitializeCalls += 1;
      };

      const result = await monitor.tryAcquireConnection(ACQUIRE_TIMEOUT_MS);

      expect(result).toEqual({ status: 'failed', error: acquisitionError });
      expect(reinitializeCalls, 'a best-effort kill acquisition must never tear down the whole pool').toBe(0);
      await monitor.closeAllConnections();
    });

    it('refuses to acquire from a closed pool', async () => {
      const pool = createFakePool();
      const monitor = await makeMonitor(pool);
      monitor.poolClosed = true;

      const result = await monitor.tryAcquireConnection(ACQUIRE_TIMEOUT_MS);

      expect(result.status).toBe('failed');
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });
});
