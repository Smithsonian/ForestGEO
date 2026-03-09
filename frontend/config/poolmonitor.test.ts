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

describe('PoolMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllTimers();
    vi.resetModules();
    loggerMock.info.mockReset();
    loggerMock.warn.mockReset();
    loggerMock.error.mockReset();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
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
});
