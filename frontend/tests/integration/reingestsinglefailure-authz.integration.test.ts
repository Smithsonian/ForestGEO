import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const HTTP_NOT_FOUND = 404;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
const OUT_OF_SCOPE_SCHEMA = 'forestgeo_panama';
const INVALID_SCHEMA = 'foo;DROP';
const NONEXISTENT_ROW_ID = 999999;

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null
}));

// Default session is a 'global' admin so the guard's per-site access gate
// passes; the out-of-scope test overrides with a field-crew session scoped to a
// different schema to exercise the 403 denial. Mocking @/auth also keeps the
// real next-auth module from being loaded by Node's native ESM resolver.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

// Route the route's ConnectionManager at the shared test connection. executeQuery
// and beginTransaction are spies so the denial tests can assert NO SQL and NO
// transaction ran (the guard must reject before the handler touches the DB).
vi.mock('@/lib/db/connectionmanager', () => {
  const executeQuery = vi.fn(async (query: string, params?: unknown[]) => {
    if (!sharedState.connection) {
      throw new Error('Test DB connection not initialized');
    }
    const [rows] = await sharedState.connection.query(query, params as any[]);
    return rows;
  });
  const beginTransaction = vi.fn(async () => {
    if (!sharedState.connection) throw new Error('Test DB connection not initialized');
    await sharedState.connection.beginTransaction();
    return 'test-transaction-id';
  });
  const manager = {
    executeQuery,
    beginTransaction,
    commitTransaction: async () => {
      await sharedState.connection?.commit();
    },
    rollbackTransaction: async () => {
      await sharedState.connection?.rollback();
    },
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

describe('GET /api/reingestsinglefailure/[schema]/[targetRowID] authz', () => {
  let connection: Connection;
  let schema: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    schema = setup.config.database;
    sharedState.connection = connection;
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection);
  });

  beforeEach(async () => {
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    vi.mocked(cm.executeQuery).mockClear();
    vi.mocked(cm.beginTransaction).mockClear();
  });

  function makeRequest() {
    return new Request('http://localhost/api/reingestsinglefailure') as any;
  }

  function makeContext(overrideSchema: string, targetRowID: number) {
    return { params: Promise.resolve({ schema: overrideSchema, targetRowID: String(targetRowID) }) } as any;
  }

  it('denies an out-of-scope schema with 403 and runs no SQL / opens no transaction', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: OUT_OF_SCOPE_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/reingestsinglefailure/[schema]/[targetRowID]/route');
    const res = await GET(makeRequest(), makeContext(schema, NONEXISTENT_ROW_ID));

    expect(res.status).toBe(HTTP_FORBIDDEN);
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.beginTransaction).not.toHaveBeenCalled();
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects a structurally invalid schema with 400 and runs no SQL', async () => {
    const { GET } = await import('@/app/api/reingestsinglefailure/[schema]/[targetRowID]/route');
    const res = await GET(makeRequest(), makeContext(INVALID_SCHEMA, NONEXISTENT_ROW_ID));

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.beginTransaction).not.toHaveBeenCalled();
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('admits an authorized member past the guard into the handler (404 when no failed row matches)', async () => {
    const { GET } = await import('@/app/api/reingestsinglefailure/[schema]/[targetRowID]/route');
    const res = await GET(makeRequest(), makeContext(schema, NONEXISTENT_ROW_ID));

    // The guard admitted the member: the handler opened a transaction and ran the
    // staging shift query, which matched no failed row and returned 404. (The full
    // 200 reingestion path is covered by reingest-routes.integration.test.ts.)
    expect(res.status).toBe(HTTP_NOT_FOUND);
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.beginTransaction).toHaveBeenCalled();
    expect(cm.executeQuery).toHaveBeenCalled();
  });
});
