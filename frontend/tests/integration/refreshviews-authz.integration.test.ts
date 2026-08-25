import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
const OUT_OF_SCOPE_SCHEMA = 'forestgeo_panama';
const INVALID_SCHEMA = 'foo;DROP';
const VALID_VIEW = 'viewfulltable';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null
}));

// Default session is a 'global' admin so the guard's per-site access gate
// passes; the out-of-scope test overrides with a field-crew session scoped to a
// different schema to exercise the 403 denial. Mocking @/auth also keeps the
// real next-auth module (whose lib/env.js imports the extensionless
// `next/server` subpath) from being loaded by Node's native ESM resolver.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

// Route the route's ConnectionManager at the shared test connection so an
// authorized refresh runs the real CALL against a populated schema. executeQuery
// is a spy so the denial tests can assert NO SQL ran.
vi.mock('@/lib/db/connectionmanager', () => {
  const executeQuery = vi.fn(async (query: string, params?: unknown[]) => {
    if (!sharedState.connection) {
      throw new Error('Test DB connection not initialized');
    }
    const [rows] = await sharedState.connection.query(query, params as any[]);
    return rows;
  });
  const manager = {
    executeQuery,
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      await sharedState.connection.beginTransaction();
      return 'test-transaction-id';
    },
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

describe('POST /api/refreshviews/[view]/[schema] authz', () => {
  let connection: Connection;
  let testData: TestData;
  let schema: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
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
  });

  function makeRequest() {
    return new Request('http://localhost/api/refreshviews', { method: 'POST' }) as any;
  }

  function makeContext(overrideSchema: string) {
    return { params: Promise.resolve({ view: VALID_VIEW, schema: overrideSchema }) } as any;
  }

  it('denies an out-of-scope schema with 403 and runs no SQL', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: OUT_OF_SCOPE_SCHEMA }] }
    } as any);

    const { POST } = await import('@/app/api/refreshviews/[view]/[schema]/route');
    const res = await POST(makeRequest(), makeContext(schema));

    expect(res.status).toBe(HTTP_FORBIDDEN);
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects a structurally invalid schema with 400 and runs no SQL', async () => {
    const { POST } = await import('@/app/api/refreshviews/[view]/[schema]/route');
    const res = await POST(makeRequest(), makeContext(INVALID_SCHEMA));

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('refreshes the view and returns 200 for an authorized member request', async () => {
    const { POST } = await import('@/app/api/refreshviews/[view]/[schema]/route');
    const res = await POST(makeRequest(), makeContext(schema));

    expect(res.status).toBe(HTTP_OK);
    const body = await res.json();
    expect(body.success).toBe(true);
    // The route ran the RefreshViewFullTable CALL against the real schema.
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).toHaveBeenCalled();
    expect(testData.plots.length).toBeGreaterThan(0);
  });
});
