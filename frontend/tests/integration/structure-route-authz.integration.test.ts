import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null
}));

// Default session is a 'global' admin so the guard's requireAdmin gate passes;
// the non-admin test overrides with mockResolvedValueOnce to exercise the 403
// denial path. Mocking @/auth also keeps the real next-auth module (whose
// lib/env.js imports the extensionless `next/server` subpath) from being loaded
// by Node's native ESM resolver, which cannot resolve it.
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
// so authorized requests execute against a real, populated schema.
vi.mock('@/config/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[]) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      const [rows] = await sharedState.connection.query(query, params as any[]);
      return rows;
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

describe('GET /api/structure/[schema] authz', () => {
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

  it('denies a non-admin session with 403 (admin-only metadata route)', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_serc' }] }
    } as any);
    const { GET } = await import('@/app/api/structure/[schema]/route');
    const req = new Request('http://localhost/api/structure/forestgeo_serc');
    const res = await GET(req as any, { params: Promise.resolve({ schema: 'forestgeo_serc' }) } as any);
    expect(res.status).toBe(HTTP_FORBIDDEN);
  });

  it('returns column metadata as a non-empty array for an admin session', async () => {
    const { GET } = await import('@/app/api/structure/[schema]/route');
    const req = new Request(`http://localhost/api/structure/${schema}`);
    const res = await GET(req as any, { params: Promise.resolve({ schema }) } as any);
    expect(res.status).toBe(HTTP_OK);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // A populated schema always has information_schema.columns rows; otherwise the
    // shape assertions below would pass vacuously.
    expect(body.length).toBeGreaterThan(0);
    // mysql2 returns information_schema column labels upper-cased, regardless of
    // the lower-case aliases in the SELECT — assert the real wire shape.
    for (const row of body as Array<Record<string, unknown>>) {
      expect(row).toHaveProperty('TABLE_NAME');
      expect(row).toHaveProperty('COLUMN_NAME');
    }
  });
});
