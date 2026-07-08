import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase } from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
const OUT_OF_SCOPE_SCHEMA = 'forestgeo_panama';
const EMPTY_ROUTE_CONTEXT = { params: Promise.resolve({}) };
const SEEDED_QUERY_NAME = 'authz-smoke-query';
const SEEDED_QUERY_DESCRIPTION = 'seeded enabled postvalidation query for the authz test';

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

describe('GET /api/postvalidation authz', () => {
  let connection: Connection;
  let schema: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    schema = setup.config.database;
    sharedState.connection = connection;
    // Seed one enabled postvalidation query so the authorized path returns 200
    // rather than the 404 the route emits for an empty result set.
    await connection.query(`INSERT INTO ${schema}.postvalidationqueries (QueryName, QueryDefinition, Description, IsEnabled) VALUES (?, ?, ?, b'1')`, [
      SEEDED_QUERY_NAME,
      'SELECT 1',
      SEEDED_QUERY_DESCRIPTION
    ]);
  });

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection);
  });

  beforeEach(async () => {
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    vi.mocked(cm.executeQuery).mockClear();
  });

  it('denies an out-of-scope schema with 403 and runs no SQL', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: OUT_OF_SCOPE_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/postvalidation/route');
    const req = new NextRequest(`http://localhost/api/postvalidation?schema=${schema}`);
    const res = await GET(req as any, EMPTY_ROUTE_CONTEXT);

    expect(res.status).toBe(HTTP_FORBIDDEN);
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects a structurally invalid schema with 400 and runs no SQL', async () => {
    const { GET } = await import('@/app/api/postvalidation/route');
    const req = new NextRequest('http://localhost/api/postvalidation?schema=foo%3BDROP');
    const res = await GET(req as any, EMPTY_ROUTE_CONTEXT);

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('returns 200 with the seeded enabled query for an authorized member request', async () => {
    const { GET } = await import('@/app/api/postvalidation/route');
    const req = new NextRequest(`http://localhost/api/postvalidation?schema=${schema}`);
    const res = await GET(req as any, EMPTY_ROUTE_CONTEXT);

    expect(res.status).toBe(HTTP_OK);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    const seeded = body.find((row: { queryName: string }) => row.queryName === SEEDED_QUERY_NAME);
    expect(seeded).toBeTruthy();
    expect(seeded.queryDescription).toBe(SEEDED_QUERY_DESCRIPTION);
  });
});
