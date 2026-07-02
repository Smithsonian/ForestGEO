import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';
import { HTTPResponses } from '@/config/macros';
import { INVALID_DATATYPE_CODE } from '@/app/api/fetchall/[[...slugs]]/route';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';

// A clearly non-allowlisted, injection-flavored dataType. If the route drops the
// whitelist check, this reaches `SELECT * FROM <schema>.information_schema.tables`,
// which the driver either executes or errors on with a code OTHER than
// INVALID_DATATYPE — so this test fails unless the whitelist gate is present.
const UNKNOWN_INJECTION_DATATYPE = 'information_schema.tables';

// An allowlisted generic-branch type that the test schema seeds with rows.
const ALLOWLISTED_SEEDED_DATATYPE = 'attributes';

// An allowlisted generic-branch type that regressed once: `roles` is a per-site
// table fetched by the personnel datagrids. The schema creates the table but does
// not seed it, so we only assert it is not rejected as an invalid dataType.
const ALLOWLISTED_UNSEEDED_DATATYPE = 'roles';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null
}));

// Default session is a 'global' admin so validateContextualValues authorizes any
// requested schema. Mocking @/auth also keeps the real next-auth module (whose
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
// so authorized requests execute against the real isolated test schema.
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

// getCookie is a server action; stub it so census-list lookup is a no-op.
vi.mock('@/app/actions/cookiemanager', () => ({
  getCookie: vi.fn(async () => undefined)
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

describe('GET /api/fetchall dataType whitelist', () => {
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

  it('rejects a non-allowlisted dataType with 400 INVALID_DATATYPE before any SQL runs', async () => {
    const { GET } = await import('@/app/api/fetchall/[[...slugs]]/route');
    const req = new NextRequest(`http://localhost/api/fetchall/${UNKNOWN_INJECTION_DATATYPE}?schema=${schema}`);
    const res = await GET(req as any, { params: Promise.resolve({ slugs: [UNKNOWN_INJECTION_DATATYPE] }) });
    expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
    const body = await res.json();
    expect(body.code).toBe(INVALID_DATATYPE_CODE);
  });

  it('serves an allowlisted generic-branch dataType (attributes) with 200 and a mapped array', async () => {
    // The test schema seeds `attributes` rows, so a non-empty array is expected.
    expect(testData.attributes.length).toBeGreaterThan(0);

    const { GET } = await import('@/app/api/fetchall/[[...slugs]]/route');
    const req = new NextRequest(`http://localhost/api/fetchall/${ALLOWLISTED_SEEDED_DATATYPE}?schema=${schema}`);
    const res = await GET(req as any, { params: Promise.resolve({ slugs: [ALLOWLISTED_SEEDED_DATATYPE] }) });
    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(testData.attributes.length);
  });

  it('serves the allowlisted `roles` dataType without a 400 INVALID_DATATYPE (regression guard)', async () => {
    // `roles` is fetched by the personnel datagrids via the generic branch. The
    // table exists in the schema but is not seeded, so it must return 200 with an
    // array (possibly empty) — and must NOT be rejected as an invalid dataType.
    const { GET } = await import('@/app/api/fetchall/[[...slugs]]/route');
    const req = new NextRequest(`http://localhost/api/fetchall/${ALLOWLISTED_UNSEEDED_DATATYPE}?schema=${schema}`);
    const res = await GET(req as any, { params: Promise.resolve({ slugs: [ALLOWLISTED_UNSEEDED_DATATYPE] }) });
    expect(res.status).toBe(HTTPResponses.OK);
    const body = await res.json();
    expect(body.code).not.toBe(INVALID_DATATYPE_CODE);
    expect(Array.isArray(body)).toBe(true);
  });
});
