import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
const OUT_OF_SCOPE_SCHEMA = 'forestgeo_panama';
const MEASUREMENT_ID = '1';

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

function makeContext(measurementID: string) {
  return { params: Promise.resolve({ measurementID }) };
}

describe('GET /api/errors/explorer/details/[measurementID] authz', () => {
  let connection: Connection;
  let testData: TestData;
  let schema: string;
  let plotID: number;
  let censusID: number;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    schema = setup.config.database;
    plotID = testData.plots[0].plotID;
    censusID = testData.census[0].censusID;
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

    const { GET } = await import('@/app/api/errors/explorer/details/[measurementID]/route');
    const req = new NextRequest(`http://localhost/api/errors/explorer/details/${MEASUREMENT_ID}?schema=${schema}&plotID=${plotID}&censusID=${censusID}`);
    const res = await GET(req as any, makeContext(MEASUREMENT_ID));

    expect(res.status).toBe(HTTP_FORBIDDEN);
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects a structurally invalid schema with 400 and runs no SQL', async () => {
    const { GET } = await import('@/app/api/errors/explorer/details/[measurementID]/route');
    const req = new NextRequest(`http://localhost/api/errors/explorer/details/${MEASUREMENT_ID}?schema=foo%3BDROP&plotID=${plotID}&censusID=${censusID}`);
    const res = await GET(req as any, makeContext(MEASUREMENT_ID));

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).not.toHaveBeenCalled();
  });

  it('returns 200 with a details payload for an authorized member request', async () => {
    const { GET } = await import('@/app/api/errors/explorer/details/[measurementID]/route');
    const req = new NextRequest(`http://localhost/api/errors/explorer/details/${MEASUREMENT_ID}?schema=${schema}&plotID=${plotID}&censusID=${censusID}`);
    const res = await GET(req as any, makeContext(MEASUREMENT_ID));

    expect(res.status).toBe(HTTP_OK);
    const body = await res.json();
    expect(body).toHaveProperty('row');
    expect(body).toHaveProperty('allErrors');
    expect(body).toHaveProperty('relatedRows');
    // The route ran its detail queries against the real schema.
    const cm = (await import('@/lib/db/connectionmanager')).default.getInstance();
    expect(cm.executeQuery).toHaveBeenCalled();
  });
});
