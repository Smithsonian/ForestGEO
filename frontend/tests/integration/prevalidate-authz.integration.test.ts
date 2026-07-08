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

interface PrevalidateBody {
  schema: string;
  plotId: number;
  sampleRows: Array<Record<string, unknown>>;
}

function buildRequest(body: PrevalidateBody): NextRequest {
  return new NextRequest('http://localhost/api/prevalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('POST /api/prevalidate per-site authz', () => {
  let connection: Connection;
  let testData: TestData;
  let schema: string;
  let plotId: number;
  let cleanSampleRows: Array<Record<string, unknown>>;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    schema = setup.config.database;
    plotId = testData.plots[0].plotID;
    // A row referencing a real seeded species + quadrat validates cleanly (0 errors → 200).
    cleanSampleRows = [
      {
        tag: 'TAG-1',
        spcode: testData.species[0].SpeciesCode,
        quadrat: testData.quadrats[0].QuadratName,
        dbh: 12.3,
        hom: 1.3,
        lx: 5,
        ly: 5,
        date: '2026-01-01'
      }
    ];
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
    const { POST } = await import('@/app/api/prevalidate/route');
    const res = await POST(buildRequest({ schema, plotId, sampleRows: cleanSampleRows }), { params: Promise.resolve({}) });

    expect(res.status).toBe(HTTP_FORBIDDEN);
    // The 403 must short-circuit before the handler builds the species/quadrat lookup caches.
    expect(sharedState.executeQueryCalls).toBe(0);
  });

  it('rejects a malformed schema in the body with 400 before running any SQL', async () => {
    sharedState.executeQueryCalls = 0;
    const { POST } = await import('@/app/api/prevalidate/route');
    const res = await POST(buildRequest({ schema: INVALID_SCHEMA, plotId, sampleRows: cleanSampleRows }), { params: Promise.resolve({}) });

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    expect(sharedState.executeQueryCalls).toBe(0);
  });

  it('prevalidates clean sample rows for an authorized member and proves the handler still reads the body after the guard clone', async () => {
    sharedState.executeQueryCalls = 0;
    const { POST } = await import('@/app/api/prevalidate/route');
    const res = await POST(buildRequest({ schema, plotId, sampleRows: cleanSampleRows }), { params: Promise.resolve({}) });

    expect(res.status).toBe(HTTP_OK);
    // The handler read schema/plotId/sampleRows from the (post-clone) body and issued FK-lookup queries.
    expect(sharedState.executeQueryCalls).toBeGreaterThan(0);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.sampleSize).toBe(cleanSampleRows.length);
    expect(body.summary.errors).toBe(0);
  });
});
