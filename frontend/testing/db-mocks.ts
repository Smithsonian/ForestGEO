// test/app-mocks.ts
import { afterEach, beforeEach, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';

// -----------------------------
// Light chalk + logger stubs
// -----------------------------
vi.mock('chalk', () => ({
  default: {
    red: (s: any) => String(s),
    yellow: (s: any) => String(s),
    cyan: (s: any) => String(s)
  },
  red: (s: any) => String(s),
  yellow: (s: any) => String(s),
  cyan: (s: any) => String(s)
}));

vi.mock('@/ailogger', () => {
  const noop = vi.fn();
  return {
    default: {
      info: noop,
      warn: noop,
      error: noop,
      debug: noop
    }
  };
});

// ----------------------------------------------------
// In-memory “connection” with pluggable responses
// ----------------------------------------------------
type QueryResult = any;
type ExecuteResult = any;

// Simple queue so each call can return the next enqueued result (or throw the next enqueued error)
const queryQueue: Array<() => Promise<[QueryResult, any]>> = [];
const executeQueue: Array<() => Promise<[ExecuteResult, any]>> = [];

// Public helpers for tests to control DB outputs
export function __pushQueryResult(result: any) {
  queryQueue.push(async () => [result, undefined]);
}
export function __pushExecuteResult(result: any) {
  executeQueue.push(async () => [result, undefined]);
}
export function __pushQueryError(error: unknown) {
  queryQueue.push(async () => {
    throw error;
  });
}
export function __pushExecuteError(error: unknown) {
  executeQueue.push(async () => {
    throw error;
  });
}
export function __clearDbQueues() {
  queryQueue.length = 0;
  executeQueue.length = 0;
}

// A minimal PoolConnection stub that matches what your code uses
class MockConnection implements Partial<PoolConnection> {
  // no-op listeners to satisfy `.on('query'|'release', ...)`
  on = vi.fn();

  async ping(): Promise<void> {
    // succeed unless a test deliberately enqueues a failure via __pushQueryError and calls query/execute
    return;
  }

  async query(sql: string, params?: any[]): Promise<[any, any]> {
    if (queryQueue.length) return queryQueue.shift()!();
    // Default: echo shape similar to mysql2
    return [{ ok: true, sql, params }, undefined];
  }

  async execute(sql: string, params?: any[]): Promise<[any, any]> {
    if (executeQueue.length) return executeQueue.shift()!();
    return [{ ok: true, sql, params }, undefined];
  }

  release(): void {
    // trigger any release listeners
    try {
      // simulate an emitted 'release' event
      const listeners = (this.on.mock.calls as Array<[string, (...args: unknown[]) => void]>).filter(([evt]) => evt === 'release').map(([, fn]) => fn);

      listeners.forEach(fn => fn());
    } catch {}
  }
}

const sharedConnection = new MockConnection();

// --------------------------------------------
// Mock PoolMonitor class used in your project
// --------------------------------------------
class MockPoolMonitor {
  // signatures your code touches
  public pool = {} as any;
  private closed = false;

  constructor(_config: any) {
    // no timers, no intervals
  }

  async getConnection(): Promise<PoolConnection> {
    // simulate activity-side effects
    this.signalActivity();
    return sharedConnection as unknown as PoolConnection;
  }

  async closeAllConnections(): Promise<void> {
    this.closed = true;
  }

  isPoolClosed(): boolean {
    return this.closed;
  }

  signalActivity(): void {
    // no-op
  }
}

// -------------------------------------------------------
// Make imports resolve to our mock PoolMonitor singleton
// -------------------------------------------------------
let singletonMonitor: MockPoolMonitor | null = null;

vi.mock('@/config/poolmonitor', () => ({
  PoolMonitor: MockPoolMonitor
}));

vi.mock('@/config/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: () => {
    if (!singletonMonitor) {
      // config isn’t used by the mock, but the real module would pass PoolOptions
      singletonMonitor = new MockPoolMonitor({});
    }
    return singletonMonitor!;
  }
}));

// ----------------------------------------
// Optional: mock mysql2/promise createPool
// (not strictly needed since PoolMonitor is mocked,
// but harmless if something imports it directly)
// ----------------------------------------
vi.mock('mysql2/promise', async origImport => {
  const mod = await ((await origImport()) as any);
  return {
    ...mod,
    createPool: vi.fn(() => ({
      // only minimal surface; tests shouldn’t reach here with our PoolMonitor mock
      getConnection: async () => sharedConnection as unknown as PoolConnection,
      query: async (...args: any[]) => sharedConnection.query(args[0], args[1]),
      end: async () => {},
      on: vi.fn()
    }))
  };
});

// ----------------------------------------
// Global env defaults (safe for tests)
// ----------------------------------------
process.env.AZURE_SQL_USER = process.env.AZURE_SQL_USER ?? 'user';
process.env.AZURE_SQL_PASSWORD = process.env.AZURE_SQL_PASSWORD ?? 'pass';
process.env.AZURE_SQL_SERVER = process.env.AZURE_SQL_SERVER ?? 'localhost';
process.env.AZURE_SQL_PORT = process.env.AZURE_SQL_PORT ?? '3306';
process.env.AZURE_SQL_CATALOG_SCHEMA = process.env.AZURE_SQL_CATALOG_SCHEMA ?? 'testdb';

// ----------------------------------------
// Reset helpers between tests
// ----------------------------------------
beforeEach(() => {
  __clearDbQueues();
  vi.clearAllMocks();
});

afterEach(() => {
  // ensure the connection gets “released” in tests that acquired it
  sharedConnection.release();
});
