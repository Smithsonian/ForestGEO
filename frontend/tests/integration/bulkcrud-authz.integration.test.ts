import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Per-site authorization regression suite for POST /api/bulkcrud.
 *
 * bulkcrud accepts a bulk `fileRowSet` payload and writes it into the site
 * schema's `temporarymeasurements` table (then runs `bulkingestionprocess`).
 * Because the payload can be large, the route authorizes INLINE via
 * `auth()` + `assertSchemaAccess(session, body.schema)` (rather than
 * `withRouteAuthz` + `fromBody`, which would re-parse the whole body).
 *
 * The security contract these tests pin:
 *   - a non-admin session that is NOT a member of the requested schema gets 403
 *     and NO transaction/SQL is started (the gate short-circuits before any DB
 *     work), and
 *   - a structurally invalid schema is rejected (400) before any DB work, and
 *   - an authorized member reaches the DB write path (200).
 *
 * ConnectionManager is fully stubbed so we can assert precisely which DB calls
 * happen on each authz outcome without seeding the ingestion pipeline.
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

// Default session is a 'global' admin so auth() + assertSchemaAccess pass;
// individual tests override with mockResolvedValueOnce to exercise the
// non-admin denial path. Mocking @/auth also keeps the real next-auth module
// (whose lib/env.js imports the extensionless `next/server` subpath) from being
// loaded by Node's native ESM resolver, which cannot resolve it.
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
  beginTransaction: vi.fn(async () => 'tx-bulkcrud'),
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

function buildRequest(schema: string): NextRequest {
  return new NextRequest('http://localhost/api/bulkcrud', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gridType: 'measurementssummary',
      schema,
      plot: { plotID: 1 },
      census: { dateRanges: [{ censusID: 1 }] },
      fileRowSet: {
        'row-0': {
          tag: '001',
          stemtag: '1',
          spcode: 'abcd',
          quadrat: '0001',
          lx: 10,
          ly: 20,
          dbh: 15.5,
          hom: 1.3,
          date: '2024-01-01',
          codes: '',
          description: ''
        }
      }
    })
  });
}

describe('POST /api/bulkcrud authz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies a schema outside the non-admin user scope with 403 and starts no transaction or SQL', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: ATTACKER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { POST } = await import('@/app/api/bulkcrud/route');
    const res = await POST(buildRequest(FOREIGN_SCHEMA));

    expect(res.status).toBe(HTTP_FORBIDDEN);
    // The gate must short-circuit BEFORE any DB work is scheduled.
    expect(dbSpies.beginTransaction).not.toHaveBeenCalled();
    expect(dbSpies.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects a structurally invalid schema with 400 before any transaction is started', async () => {
    // Admin session so the request clears assertSchemaAccess; the 400 must come
    // from the safeFormatQuery injection guard, not from the authz gate.
    const { POST } = await import('@/app/api/bulkcrud/route');
    const res = await POST(buildRequest(STRUCTURALLY_INVALID_SCHEMA));

    expect(res.status).toBe(HTTP_INVALID_REQUEST);
    expect(dbSpies.beginTransaction).not.toHaveBeenCalled();
    expect(dbSpies.executeQuery).not.toHaveBeenCalled();
  });

  it('allows a non-admin member of the requested schema to reach the DB write path (200)', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: MEMBER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: MEMBER_SCHEMA }] }
    } as any);

    const { POST } = await import('@/app/api/bulkcrud/route');
    const res = await POST(buildRequest(MEMBER_SCHEMA));

    expect(res.status).toBe(HTTP_OK);
    // The bulk path runs the temporarymeasurements INSERT and the
    // bulkingestionprocess CALL — two executeQuery invocations.
    expect(dbSpies.beginTransaction).toHaveBeenCalledTimes(1);
    expect(dbSpies.executeQuery).toHaveBeenCalledTimes(2);
    expect(dbSpies.commitTransaction).toHaveBeenCalledTimes(1);
  });
});
