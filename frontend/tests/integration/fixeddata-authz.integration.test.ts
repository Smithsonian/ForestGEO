import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
const OUT_OF_SCOPE_SCHEMA = 'forestgeo_panama';
const INVALID_SCHEMA = 'foo;DROP';
const DATA_TYPE = 'attributes';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null
}));

// Default session is a 'global' admin so the guard's per-site gate passes; the
// out-of-scope tests override with a field-crew session scoped to a different
// schema to exercise the 403 denial on the inline GET AND the re-exported
// POST/DELETE write paths (the highest-risk methods on this catch-all route).
// Mocking @/auth also keeps the real next-auth module from being loaded by
// Node's native ESM resolver.
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
// and beginTransaction are spies so the denial tests can assert NO SQL / NO
// transaction ran when the guard rejects an out-of-scope schema.
vi.mock('@/lib/db/connectionmanager', () => {
  const executeQuery = vi.fn(async (query: string, params?: unknown[]) => {
    if (!sharedState.connection) {
      throw new Error('Test DB connection not initialized');
    }
    const [rows] = await sharedState.connection.query(query, params as any[]);
    return rows;
  });
  const beginTransaction = vi.fn(async () => 'test-transaction-id');
  const manager = {
    executeQuery,
    beginTransaction,
    withTransaction: vi.fn(async () => {
      throw new Error('withTransaction should not run on a denied request');
    }),
    commitTransaction: async () => undefined,
    rollbackTransaction: async () => undefined,
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

describe('fixeddata/[dataType]/[[...slugs]] authz (inline GET + re-exported POST/DELETE)', () => {
  let connection: Connection;
  let testData: TestData;
  let schema: string;
  let plotID: number;
  let censusNumber: number;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    schema = setup.config.database;
    plotID = testData.plots[0].plotID;
    censusNumber = testData.census[0].plotCensusNumber;
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

  async function scopeAttackerToOtherSchema() {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: OUT_OF_SCOPE_SCHEMA }] }
    } as any);
  }

  function getRequest() {
    return new Request('http://localhost/api/fixeddata') as any;
  }

  function getContext(overrideSchema: string) {
    return { params: Promise.resolve({ dataType: DATA_TYPE, slugs: [overrideSchema, '0', '25', String(plotID), String(censusNumber)] }) } as any;
  }

  it('GET: denies an out-of-scope schema with 403 and runs no SQL', async () => {
    await scopeAttackerToOtherSchema();
    const { GET } = await import('@/app/api/fixeddata/[dataType]/[[...slugs]]/route');
    const res = await GET(getRequest(), getContext(schema));

    expect(res.status).toBe(HTTP_FORBIDDEN);
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('GET: rejects a structurally invalid schema with 400 and runs no SQL', async () => {
    const { GET } = await import('@/app/api/fixeddata/[dataType]/[[...slugs]]/route');
    const res = await GET(getRequest(), getContext(INVALID_SCHEMA));

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('GET: runs the paginated query for an authorized member request (200)', async () => {
    const { GET } = await import('@/app/api/fixeddata/[dataType]/[[...slugs]]/route');
    const res = await GET(getRequest(), getContext(schema));

    expect(res.status).toBe(HTTP_OK);
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).toHaveBeenCalled();
  });

  it('re-exported POST: denies an out-of-scope schema with 403 and starts no transaction', async () => {
    await scopeAttackerToOtherSchema();
    const { POST } = await import('@/app/api/fixeddata/[dataType]/[[...slugs]]/route');
    const req = new Request('http://localhost/api/fixeddata', {
      method: 'POST',
      body: JSON.stringify({ newRow: { Code: 'ZZZ', Description: 'x' } }),
      headers: { 'content-type': 'application/json' }
    }) as any;
    const res = await POST(req, { params: Promise.resolve({ dataType: DATA_TYPE, slugs: [schema, 'code', String(plotID), '1'] }) } as any);

    expect(res.status).toBe(HTTP_FORBIDDEN);
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).not.toHaveBeenCalled();
    expect(cm.beginTransaction).not.toHaveBeenCalled();
  });

  it('re-exported DELETE: denies an out-of-scope schema with 403 and starts no transaction', async () => {
    await scopeAttackerToOtherSchema();
    const { DELETE } = await import('@/app/api/fixeddata/[dataType]/[[...slugs]]/route');
    const req = new Request('http://localhost/api/fixeddata', {
      method: 'DELETE',
      body: JSON.stringify({ newRow: { Code: 'ZZZ' } }),
      headers: { 'content-type': 'application/json' }
    }) as any;
    const res = await DELETE(req, { params: Promise.resolve({ dataType: DATA_TYPE, slugs: [schema, 'code'] }) } as any);

    expect(res.status).toBe(HTTP_FORBIDDEN);
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).not.toHaveBeenCalled();
    expect(cm.beginTransaction).not.toHaveBeenCalled();
  });
});
