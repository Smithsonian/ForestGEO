import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';
import { HTTPResponses } from '@/config/macros';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const STRUCTURALLY_INVALID_SCHEMA = 'foo;DROP';
const EMPTY_ROUTE_CONTEXT = { params: Promise.resolve({}) };

// A single spy shared with the ConnectionManager mock so each test can assert
// whether the route reached SQL. The raw-schema sweep converted these routes to
// validate the schema BEFORE building any SQL, so an invalid schema must never
// reach executeQuery.
const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  executeQuerySpy: vi.fn(async (query: string, params?: unknown[]) => {
    if (!sharedState.connection) throw new Error('Test DB connection not initialized');
    const [rows] = await sharedState.connection.query(query, params as any[]);
    return rows;
  })
}));

// Default session is a 'global' admin so any route auth() gate passes; the tests
// under scrutiny reject on schema validation before authz matters. Mocking @/auth
// also avoids the real next-auth ESM subpath resolution failure under Node.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

vi.mock('@/config/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      executeQuery: (query: string, params?: unknown[]) => sharedState.executeQuerySpy(query, params),
      closeConnection: async () => undefined
    })
  }
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

describe('raw-${schema} sweep: converted routes reject a structurally invalid schema before SQL', () => {
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

  beforeEach(() => {
    sharedState.executeQuerySpy.mockClear();
  });

  it('details/cmid: safeFormatQuery throws on an invalid schema and no SQL is executed', async () => {
    const { GET } = await import('@/app/api/details/cmid/route');
    const req = new NextRequest(`http://localhost/api/details/cmid?cmid=1&schema=${encodeURIComponent(STRUCTURALLY_INVALID_SCHEMA)}`);
    const res = await GET(req as any, EMPTY_ROUTE_CONTEXT);
    expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
    expect((await res.json()).code).toBe('INVALID_SCHEMA');
    expect(sharedState.executeQuerySpy).not.toHaveBeenCalled();
  });

  it('validations/validationerrordisplay: invalid schema yields 400 from the route guard and no SQL', async () => {
    const { GET } = await import('@/app/api/validations/validationerrordisplay/route');
    const req = new NextRequest(
      `http://localhost/api/validations/validationerrordisplay?schema=${encodeURIComponent(STRUCTURALLY_INVALID_SCHEMA)}&plotIDParam=1&censusPCNParam=1`
    );
    const res = await GET(req as any, EMPTY_ROUTE_CONTEXT);
    expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
    expect((await res.json()).code).toBe('INVALID_SCHEMA');
    expect(sharedState.executeQuerySpy).not.toHaveBeenCalled();
  });

  it('changelog/overview: the unvalidated URL-param fallback is now gated and returns 400 with no SQL', async () => {
    const { GET } = await import('@/app/api/changelog/overview/[changelogType]/[[...options]]/route');
    // This test guards the URL-param FALLBACK hole specifically, not the primary path.
    // An invalid schema forces the fallback: validateContextualValues itself rejects
    // `foo;DROP` (isValidSchema fails), so validation.success is false and the handler
    // falls through to the `schemaParam` branch, which assigned the RAW query-param
    // schema without re-validating. The added validateSchemaOrThrow gate must now block
    // that branch — proven by the 400 and by executeQuery never being reached.
    const req = new NextRequest(`http://localhost/api/changelog/overview/unifiedchangelog/1/1?schema=${encodeURIComponent(STRUCTURALLY_INVALID_SCHEMA)}`);
    const props = { params: Promise.resolve({ changelogType: 'unifiedchangelog', options: ['1', '1'] }) };
    const res = await GET(req as any, props as any);
    expect(res.status).toBe(HTTPResponses.BAD_REQUEST);
    expect(sharedState.executeQuerySpy).not.toHaveBeenCalled();
  });

  it('positive control: a valid schema reaches SQL for details/cmid', async () => {
    const { GET } = await import('@/app/api/details/cmid/route');
    const req = new NextRequest(`http://localhost/api/details/cmid?cmid=999999&schema=${schema}`);
    const res = await GET(req as any, EMPTY_ROUTE_CONTEXT);
    expect(res.status).toBe(HTTPResponses.OK);
    expect(sharedState.executeQuerySpy).toHaveBeenCalledTimes(1);
    // testData is seeded by setup; referenced to keep the fixture wired and lint happy.
    expect(testData).toBeDefined();
  });
});
