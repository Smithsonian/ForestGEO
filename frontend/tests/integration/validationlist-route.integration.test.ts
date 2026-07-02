import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null
}));

// Default session is a 'global' admin so the route's auth() gate and
// assertSchemaAccess pass; individual tests override with mockResolvedValueOnce
// to exercise the non-admin denial path. Mocking @/auth also keeps the real
// next-auth module (whose lib/env.js imports the extensionless `next/server`
// subpath) from being loaded by Node's native ESM resolver, which cannot resolve it.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

// Route the route's ConnectionManager.executeQuery at the shared test connection
// so authorized requests execute against the real isolated test schema.
vi.mock('@/config/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[]) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      const [rows] = await sharedState.connection.query(query, params as any[]);
      return rows;
    }
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

describe('GET /api/validations/validationlist authz + injection', () => {
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

  it('denies a schema outside the user site scope with 403', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_panama' }] }
    } as any);
    const { GET } = await import('@/app/api/validations/validationlist/route');
    const req = new NextRequest(`http://localhost/api/validations/validationlist?schema=${schema}`);
    const res = await GET(req as any);
    expect(res.status).toBe(HTTP_FORBIDDEN);
  });

  it('rejects a structurally invalid schema without hitting SQL', async () => {
    const { GET } = await import('@/app/api/validations/validationlist/route');
    const req = new NextRequest('http://localhost/api/validations/validationlist?schema=foo%3BDROP');
    const res = await GET(req as any);
    expect(res.status).toBe(HTTP_BAD_REQUEST);
    expect((await res.json()).code).toBe('INVALID_SCHEMA');
  });

  it('returns the coreValidations map for an authorized (admin) request', async () => {
    const { GET } = await import('@/app/api/validations/validationlist/route');
    const req = new NextRequest(`http://localhost/api/validations/validationlist?schema=${schema}`);
    const res = await GET(req as any);
    expect(res.status).toBe(HTTP_OK);
    const body = await res.json();
    expect(body).toHaveProperty('coreValidations');
    expect(typeof body.coreValidations).toBe('object');
    // The setup seeds enabled sitespecificvalidations rows, so the map must be non-empty;
    // otherwise the per-entry assertions below would pass vacuously.
    expect(Object.keys(body.coreValidations).length).toBeGreaterThan(0);
    // Every entry keyed by ProcedureName carries id/description/definition
    const entries = Object.values(body.coreValidations) as Array<{ id: number; description: string; definition: string }>;
    for (const entry of entries) {
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('description');
      expect(entry).toHaveProperty('definition');
    }
  });
});
