import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Per-site authorization regression suite for /api/validations/updatepassedvalidations.
 *
 * The route exports two methods, each wrapped by `withRouteAuthz` with its own
 * schema resolver:
 *   - POST → fromBody('schema')  (current path)
 *   - GET  → fromQuery('schema') (deprecated backward-compat path)
 *
 * Both delegate to `updateValidatedRows`, which opens a transaction and runs an
 * UPDATE against the site schema. These tests prove each resolver denies an
 * out-of-scope schema with 403 BEFORE any DB work, and that an authorized
 * member reaches the DB path (200).
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
  beginTransaction: vi.fn(async () => 'tx-upv'),
  executeQuery: vi.fn(async () => []),
  commitTransaction: vi.fn(async () => undefined),
  rollbackTransaction: vi.fn(async () => undefined),
  closeConnection: vi.fn(async () => undefined)
}));

vi.mock('@/lib/db/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      beginTransaction: dbSpies.beginTransaction,
      executeQuery: dbSpies.executeQuery,
      commitTransaction: dbSpies.commitTransaction,
      rollbackTransaction: dbSpies.rollbackTransaction,
      closeConnection: dbSpies.closeConnection
    })
  }
}));

function postRequest(schema: string): NextRequest {
  return new NextRequest('http://localhost/api/validations/updatepassedvalidations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schema, plotID: 1, censusID: 1 })
  });
}

function getRequest(schema: string): NextRequest {
  return new NextRequest(`http://localhost/api/validations/updatepassedvalidations?schema=${schema}&plotID=1&censusID=1`);
}

async function mockNonAdminSessionOnce(email: string, memberSchema: string) {
  const { auth } = await import('@/auth');
  vi.mocked(auth).mockResolvedValueOnce({
    user: { email, userStatus: 'field crew', sites: [{ schemaName: memberSchema }] }
  } as any);
}

describe('/api/validations/updatepassedvalidations authz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST (fromBody schema resolver)', () => {
    it('denies an out-of-scope schema with 403 and starts no transaction or SQL', async () => {
      await mockNonAdminSessionOnce(ATTACKER_EMAIL, MEMBER_SCHEMA);

      const { POST } = await import('@/app/api/validations/updatepassedvalidations/route');
      const res = await POST(postRequest(FOREIGN_SCHEMA) as any, EMPTY_ROUTE_CONTEXT);

      expect(res.status).toBe(HTTP_FORBIDDEN);
      expect(dbSpies.beginTransaction).not.toHaveBeenCalled();
      expect(dbSpies.executeQuery).not.toHaveBeenCalled();
    });

    it('rejects a structurally invalid schema with 400 and starts no transaction or SQL', async () => {
      const { POST } = await import('@/app/api/validations/updatepassedvalidations/route');
      const res = await POST(postRequest(STRUCTURALLY_INVALID_SCHEMA) as any, EMPTY_ROUTE_CONTEXT);

      expect(res.status).toBe(HTTP_INVALID_REQUEST);
      expect(dbSpies.beginTransaction).not.toHaveBeenCalled();
      expect(dbSpies.executeQuery).not.toHaveBeenCalled();
    });

    it('allows an authorized member to reach the DB update path (200)', async () => {
      await mockNonAdminSessionOnce(MEMBER_EMAIL, MEMBER_SCHEMA);

      const { POST } = await import('@/app/api/validations/updatepassedvalidations/route');
      const res = await POST(postRequest(MEMBER_SCHEMA) as any, EMPTY_ROUTE_CONTEXT);

      expect(res.status).toBe(HTTP_OK);
      expect(dbSpies.beginTransaction).toHaveBeenCalledTimes(1);
      expect(dbSpies.executeQuery).toHaveBeenCalledTimes(1);
      expect(dbSpies.commitTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET (fromQuery schema resolver, deprecated path)', () => {
    it('denies an out-of-scope schema with 403 and starts no transaction or SQL', async () => {
      await mockNonAdminSessionOnce(ATTACKER_EMAIL, MEMBER_SCHEMA);

      const { GET } = await import('@/app/api/validations/updatepassedvalidations/route');
      const res = await GET(getRequest(FOREIGN_SCHEMA) as any, EMPTY_ROUTE_CONTEXT);

      expect(res.status).toBe(HTTP_FORBIDDEN);
      expect(dbSpies.beginTransaction).not.toHaveBeenCalled();
      expect(dbSpies.executeQuery).not.toHaveBeenCalled();
    });
  });
});
