import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Per-site authorization regression suite for /api/validations/run.
 *
 * This route exports THREE methods, each wrapped by `withRouteAuthz` with its
 * OWN schema resolver:
 *   - POST   → fromBody('schema')   (create a run)
 *   - GET    → fromQuery('schema')  (read latest run)
 *   - PATCH  → fromBody('schema')   (update run progress)
 *
 * These tests prove each resolver reads the schema from the correct place and
 * denies an out-of-scope schema with 403 BEFORE any DB work runs, and that an
 * authorized member reaches the DB path (200).
 *
 * ConnectionManager is fully stubbed so we can assert precisely which DB calls
 * happen on each authz outcome.
 */

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_INVALID_REQUEST = 400;

const MEMBER_SCHEMA = 'forestgeo_panama';
const FOREIGN_SCHEMA = 'forestgeo_serc';
const STRUCTURALLY_INVALID_SCHEMA = 'foo;DROP';

const ADMIN_EMAIL = 'admin@forestgeo.test';
const ATTACKER_EMAIL = 'attacker@forestgeo.test';
const MEMBER_EMAIL = 'member@forestgeo.test';

const INSERTED_RUN_ID = 123;

const EMPTY_ROUTE_CONTEXT = { params: Promise.resolve({}) };

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: ADMIN_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

const dbSpies = vi.hoisted(() => ({
  beginTransaction: vi.fn(async () => 'tx-run'),
  acquireApplicationLock: vi.fn(async () => true),
  executeQuery: vi.fn(async () => []),
  commitTransaction: vi.fn(async () => undefined),
  rollbackTransaction: vi.fn(async () => undefined),
  closeConnection: vi.fn(async () => undefined)
}));

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      beginTransaction: dbSpies.beginTransaction,
      acquireApplicationLock: dbSpies.acquireApplicationLock,
      executeQuery: dbSpies.executeQuery,
      commitTransaction: dbSpies.commitTransaction,
      rollbackTransaction: dbSpies.rollbackTransaction,
      closeConnection: dbSpies.closeConnection
    })
  }
}));

function postRequest(schema: string): NextRequest {
  return new NextRequest('http://localhost/api/validations/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schema, plotID: 1, censusID: 1, totalSteps: 3 })
  });
}

function getRequest(schema: string): NextRequest {
  return new NextRequest(`http://localhost/api/validations/run?schema=${schema}&plotID=1&censusID=1`);
}

function patchRequest(schema: string): NextRequest {
  return new NextRequest('http://localhost/api/validations/run', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schema, runID: 5, completedSteps: 1 })
  });
}

function mockNonAdminSession(email: string, memberSchema: string) {
  return async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email, userStatus: 'field crew', sites: [{ schemaName: memberSchema }] }
    } as any);
  };
}

describe('/api/validations/run authz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST (fromBody schema resolver)', () => {
    it('denies an out-of-scope schema with 403 and starts no transaction or SQL', async () => {
      await mockNonAdminSession(ATTACKER_EMAIL, MEMBER_SCHEMA)();

      const { POST } = await import('@/app/api/validations/run/route');
      const res = await POST(postRequest(FOREIGN_SCHEMA) as any, EMPTY_ROUTE_CONTEXT);

      expect(res.status).toBe(HTTP_FORBIDDEN);
      expect(dbSpies.beginTransaction).not.toHaveBeenCalled();
      expect(dbSpies.executeQuery).not.toHaveBeenCalled();
    });

    it('rejects a structurally invalid schema with 400 and starts no transaction or SQL', async () => {
      const { POST } = await import('@/app/api/validations/run/route');
      const res = await POST(postRequest(STRUCTURALLY_INVALID_SCHEMA) as any, EMPTY_ROUTE_CONTEXT);

      expect(res.status).toBe(HTTP_INVALID_REQUEST);
      expect(dbSpies.beginTransaction).not.toHaveBeenCalled();
      expect(dbSpies.executeQuery).not.toHaveBeenCalled();
    });

    it('allows an authorized member to create a run (200) and reaches the DB path', async () => {
      await mockNonAdminSession(MEMBER_EMAIL, MEMBER_SCHEMA)();
      // Lock SELECT → no existing running row; INSERT → new run; prune DELETE → ok.
      dbSpies.executeQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ insertId: INSERTED_RUN_ID } as any)
        .mockResolvedValueOnce([]);

      const { POST } = await import('@/app/api/validations/run/route');
      const res = await POST(postRequest(MEMBER_SCHEMA) as any, EMPTY_ROUTE_CONTEXT);

      expect(res.status).toBe(HTTP_OK);
      const body = await res.json();
      expect(body.runID).toBe(INSERTED_RUN_ID);
      expect(body.conflict).toBe(false);
      expect(dbSpies.beginTransaction).toHaveBeenCalledTimes(1);
      expect(dbSpies.commitTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET (fromQuery schema resolver)', () => {
    it('denies an out-of-scope schema with 403 and runs no SQL', async () => {
      await mockNonAdminSession(ATTACKER_EMAIL, MEMBER_SCHEMA)();

      const { GET } = await import('@/app/api/validations/run/route');
      const res = await GET(getRequest(FOREIGN_SCHEMA) as any, EMPTY_ROUTE_CONTEXT);

      expect(res.status).toBe(HTTP_FORBIDDEN);
      expect(dbSpies.executeQuery).not.toHaveBeenCalled();
    });

    it('allows an authorized member to read the latest run (200)', async () => {
      await mockNonAdminSession(MEMBER_EMAIL, MEMBER_SCHEMA)();
      dbSpies.executeQuery.mockResolvedValueOnce([{ RunID: INSERTED_RUN_ID, Status: 'completed' }] as any);

      const { GET } = await import('@/app/api/validations/run/route');
      const res = await GET(getRequest(MEMBER_SCHEMA) as any, EMPTY_ROUTE_CONTEXT);

      expect(res.status).toBe(HTTP_OK);
      const body = await res.json();
      expect(body.run.RunID).toBe(INSERTED_RUN_ID);
      expect(dbSpies.executeQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('PATCH (fromBody schema resolver)', () => {
    it('denies an out-of-scope schema with 403 and runs no SQL', async () => {
      await mockNonAdminSession(ATTACKER_EMAIL, MEMBER_SCHEMA)();

      const { PATCH } = await import('@/app/api/validations/run/route');
      const res = await PATCH(patchRequest(FOREIGN_SCHEMA) as any, EMPTY_ROUTE_CONTEXT);

      expect(res.status).toBe(HTTP_FORBIDDEN);
      expect(dbSpies.executeQuery).not.toHaveBeenCalled();
    });
  });
});
