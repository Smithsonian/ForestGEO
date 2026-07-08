import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
const OUT_OF_SCOPE_SCHEMA = 'forestgeo_panama';
const INVALID_SCHEMA = 'not a schema!';
const PAGE = 0;
const PAGE_SIZE = 25;

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  executeQueryCalls: 0
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

function buildRequest(schema: string, plotID: number): NextRequest {
  return new NextRequest('http://localhost/api/changes/explorer/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema, plotID, page: PAGE, pageSize: PAGE_SIZE })
  });
}

describe('POST /api/changes/explorer/query per-site authz', () => {
  let connection: Connection;
  let testData: TestData;
  let schema: string;
  let plotID: number;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    schema = setup.config.database;
    plotID = testData.plots[0].plotID;
    sharedState.connection = connection;
  });

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection);
  });

  it('denies a schema outside the user site scope with 403 and never runs any SQL', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: OUT_OF_SCOPE_SCHEMA }] }
    } as any);

    sharedState.executeQueryCalls = 0;
    const { POST } = await import('@/app/api/changes/explorer/query/route');
    const res = await POST(buildRequest(schema, plotID), { params: Promise.resolve({}) });

    expect(res.status).toBe(HTTP_FORBIDDEN);
    expect(sharedState.executeQueryCalls).toBe(0);
  });

  it('rejects a malformed schema in the body with 400 before running any SQL', async () => {
    sharedState.executeQueryCalls = 0;
    const { POST } = await import('@/app/api/changes/explorer/query/route');
    const res = await POST(buildRequest(INVALID_SCHEMA, plotID), { params: Promise.resolve({}) });

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    expect(sharedState.executeQueryCalls).toBe(0);
  });

  it('serves changes for an authorized member and proves the handler still reads the body after the guard clone', async () => {
    sharedState.executeQueryCalls = 0;
    const { POST } = await import('@/app/api/changes/explorer/query/route');
    const res = await POST(buildRequest(schema, plotID), { params: Promise.resolve({}) });

    expect(res.status).toBe(HTTP_OK);
    expect(sharedState.executeQueryCalls).toBeGreaterThan(0);
    const body = await res.json();
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('totalItems');
    expect(body).toHaveProperty('summary');
  });
});
