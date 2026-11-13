import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestDatabaseConfig } from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
const OUT_OF_SCOPE_SCHEMA = 'forestgeo_panama';
const INVALID_SCHEMA = 'not a schema!';
const MEASUREMENT_ID = 1;
const MAX_SQL_CALLS_FOR_SCHEMA_QUARANTINE_LOOKUP = 1;

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  executeQueryCalls: 0
}));

// Default session is a 'global' admin so the route's auth() gate and assertSchemaAccess pass; individual tests
// override it to exercise the denial paths. Mocking @/auth also keeps the real next-auth module (whose lib/env.js
// imports the extensionless `next/server` subpath) from being loaded by Node's native ESM resolver.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

// Counts executeQuery calls so the denial tests can prove no SQL ran.
vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[]) => {
      sharedState.executeQueryCalls += 1;
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

function buildRequest(schema: string, plotID: number, censusID: number, measurementID: number): NextRequest {
  return new NextRequest('http://localhost/api/validations/clearmeasurementerrors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema, plotID, censusID, measurementID })
  });
}

describe('POST /api/validations/clearmeasurementerrors per-site authz', () => {
  let connection: Connection;
  let config: TestDatabaseConfig;
  let schema: string;
  let plotID: number;
  let censusID: number;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    config = setup.config;
    schema = setup.config.database;
    plotID = setup.testData.plots[0].plotID;
    censusID = setup.testData.census[0].censusID;
    sharedState.connection = connection;
  });

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  it('denies a schema outside the user site scope with 403 and never runs any SQL', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: OUT_OF_SCOPE_SCHEMA }] }
    } as any);

    sharedState.executeQueryCalls = 0;
    const { POST } = await import('@/app/api/validations/clearmeasurementerrors/route');
    const res = await POST(buildRequest(schema, plotID, censusID, MEASUREMENT_ID), { params: Promise.resolve({}) });

    console.log('[view-errors clear authz]', res.status, sharedState.executeQueryCalls);
    expect(res.status).toBe(HTTP_FORBIDDEN);
    expect(sharedState.executeQueryCalls).toBe(0);
  });

  it('denies a pending user with site access with 403 and runs no SQL beyond the cached schema-quarantine lookup', async () => {
    const { auth } = await import('@/auth');
    // The pending check runs in the handler after the site gate; the quarantine lookup before it is the only SQL allowed.
    vi.mocked(auth).mockResolvedValue({
      user: { email: 'pending@forestgeo.test', userStatus: 'pending', sites: [{ schemaName: schema }] }
    } as any);

    try {
      sharedState.executeQueryCalls = 0;
      const { POST } = await import('@/app/api/validations/clearmeasurementerrors/route');
      const res = await POST(buildRequest(schema, plotID, censusID, MEASUREMENT_ID), { params: Promise.resolve({}) });

      console.log('[view-errors clear authz pending]', res.status, sharedState.executeQueryCalls);
      expect(res.status).toBe(HTTP_FORBIDDEN);
      expect(sharedState.executeQueryCalls, 'at most the schema-quarantine lookup').toBeLessThanOrEqual(MAX_SQL_CALLS_FOR_SCHEMA_QUARANTINE_LOOKUP);
    } finally {
      vi.mocked(auth).mockReset();
      vi.mocked(auth).mockResolvedValue({ user: { email: AUTH_USER_EMAIL, userStatus: 'global', sites: [] } } as any);
    }
  });

  it('rejects a malformed schema with 400 before running any SQL', async () => {
    sharedState.executeQueryCalls = 0;
    const { POST } = await import('@/app/api/validations/clearmeasurementerrors/route');
    const res = await POST(buildRequest(INVALID_SCHEMA, plotID, censusID, MEASUREMENT_ID), { params: Promise.resolve({}) });

    console.log('[view-errors clear authz malformed]', res.status, sharedState.executeQueryCalls);
    expect(res.status).toBe(HTTP_BAD_REQUEST);
    expect(sharedState.executeQueryCalls).toBe(0);
  });
});
