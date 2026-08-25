import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
const OUT_OF_SCOPE_SCHEMA = 'forestgeo_panama';
const SEARCH_DATA_TYPE = 'species';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null
}));

// Default session is a 'global' admin so the route's auth() gate and
// assertSchemaAccess pass; individual tests override with mockResolvedValueOnce
// to exercise the non-admin denial path.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

// Route ConnectionManager.executeQuery at the shared test connection so authorized
// requests hit the real isolated test schema. executeQuery is a spy so denial
// tests can prove no SQL ran.
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

function paramsFor(dataType: string) {
  return { params: Promise.resolve({ dataType }) };
}

describe('GET /api/formsearch/[dataType] authz', () => {
  let connection: Connection;
  let testData: TestData;
  let schema: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
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

  it('denies an out-of-scope schema with 403 and runs no SQL', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: OUT_OF_SCOPE_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/formsearch/[dataType]/route');
    const req = new NextRequest(`http://localhost/api/formsearch/${SEARCH_DATA_TYPE}?schema=${schema}`);
    const res = await GET(req as any, paramsFor(SEARCH_DATA_TYPE));

    expect(res.status).toBe(HTTP_FORBIDDEN);
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects a structurally invalid schema with 400 and runs no SQL', async () => {
    const { GET } = await import('@/app/api/formsearch/[dataType]/route');
    const req = new NextRequest('http://localhost/api/formsearch/species?schema=foo%3BDROP');
    const res = await GET(req as any, paramsFor(SEARCH_DATA_TYPE));

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('returns 200 with seeded species codes for an authorized member request', async () => {
    // testData seeds species rows, so the result must be non-empty (non-vacuous).
    expect(testData.species.length).toBeGreaterThan(0);

    const { GET } = await import('@/app/api/formsearch/[dataType]/route');
    const req = new NextRequest(`http://localhost/api/formsearch/${SEARCH_DATA_TYPE}?schema=${schema}`);
    const res = await GET(req as any, paramsFor(SEARCH_DATA_TYPE));

    expect(res.status).toBe(HTTP_OK);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });
});
