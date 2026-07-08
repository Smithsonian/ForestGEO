import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
const OUT_OF_SCOPE_SCHEMA = 'forestgeo_panama';
const EMPTY_ROUTE_CONTEXT = { params: Promise.resolve({}) };
// A syntactically valid query so EXPLAIN would succeed if the handler ever ran it.
const PROBE_QUERY = 'SELECT 1';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const executeQuery = vi.fn(async (query: string, params?: unknown[]) => {
    if (!sharedState.connection) {
      throw new Error('Test DB connection not initialized');
    }
    const [rows] = await sharedState.connection.query(query, params as any[]);
    return rows;
  });
  const manager = { executeQuery, closeConnection: async () => undefined };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

function makePostRequest(schema: string, query: string) {
  return new NextRequest(`http://localhost/api/validations/validate-query?schema=${schema}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query })
  });
}

describe('POST /api/validations/validate-query authz', () => {
  let connection: Connection;
  let schema: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    schema = setup.config.database;
    sharedState.connection = connection;
  });

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection);
  });

  beforeEach(async () => {
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    vi.mocked(cm.executeQuery).mockClear();
  });

  it('denies an out-of-scope schema with 403 and never runs the EXPLAIN / any SQL', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: OUT_OF_SCOPE_SCHEMA }] }
    } as any);

    const { POST } = await import('@/app/api/validations/validate-query/route');
    const res = await POST(makePostRequest(schema, PROBE_QUERY) as any, EMPTY_ROUTE_CONTEXT);

    expect(res.status).toBe(HTTP_FORBIDDEN);
    // Proves the guard short-circuits BEFORE `EXPLAIN <query>` (or any other query) executes.
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects a structurally invalid schema with 400 and runs no SQL', async () => {
    const { POST } = await import('@/app/api/validations/validate-query/route');
    const res = await POST(makePostRequest('foo%3BDROP', PROBE_QUERY) as any, EMPTY_ROUTE_CONTEXT);

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('runs the EXPLAIN and returns 200 for an authorized member request', async () => {
    const { POST } = await import('@/app/api/validations/validate-query/route');
    const res = await POST(makePostRequest(schema, PROBE_QUERY) as any, EMPTY_ROUTE_CONTEXT);

    expect(res.status).toBe(HTTP_OK);
    const body = await res.json();
    expect(body).toHaveProperty('isValid');
    expect(body).toHaveProperty('errors');
    expect(body).toHaveProperty('warnings');
    // The handler ran (EXPLAIN + schema introspection) for the in-scope caller.
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).toHaveBeenCalled();
  });
});
