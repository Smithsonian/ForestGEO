import { describe, expect, it, vi } from 'vitest';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
const VALID_SCHEMA = 'forestgeo_testschema';
const OUT_OF_SCOPE_SCHEMA = 'forestgeo_panama';
const INVALID_SCHEMA = 'foo;DROP';
const STUB_MESSAGE = 'rollover is not needed for this table!';

// rollover is a no-op stub that runs NO SQL — the guard is the only thing that
// enforces per-site membership before the stub body runs. Default session is a
// 'global' admin; the out-of-scope test overrides with a field-crew session
// scoped elsewhere. Mocking @/auth also keeps the real next-auth module from
// being loaded by Node's native ESM resolver.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
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

describe('GET /api/rollover/[primaryKey]/[schema]/[plotIDParam]/[censusIDParam]/[newCensusIDParam] authz', () => {
  function makeRequest() {
    return new Request('http://localhost/api/rollover') as any;
  }

  function makeContext(overrideSchema: string) {
    return {
      params: Promise.resolve({
        primaryKey: 'trees',
        schema: overrideSchema,
        plotIDParam: '1',
        censusIDParam: '2',
        newCensusIDParam: '3'
      })
    } as any;
  }

  it('denies an out-of-scope schema with 403 before the stub body runs', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: OUT_OF_SCOPE_SCHEMA }] }
    } as any);

    const { GET } = await import('@/app/api/rollover/[primaryKey]/[schema]/[plotIDParam]/[censusIDParam]/[newCensusIDParam]/route');
    const res = await GET(makeRequest(), makeContext(VALID_SCHEMA));

    expect(res.status).toBe(HTTP_FORBIDDEN);
    const body = await res.json();
    // The stub's success message must NOT leak on a denied request.
    expect(body.message).not.toBe(STUB_MESSAGE);
  });

  it('rejects a structurally invalid schema with 400', async () => {
    const { GET } = await import('@/app/api/rollover/[primaryKey]/[schema]/[plotIDParam]/[censusIDParam]/[newCensusIDParam]/route');
    const res = await GET(makeRequest(), makeContext(INVALID_SCHEMA));

    expect(res.status).toBe(HTTP_BAD_REQUEST);
  });

  it('returns the stub success message with 200 for an authorized member request', async () => {
    const { GET } = await import('@/app/api/rollover/[primaryKey]/[schema]/[plotIDParam]/[censusIDParam]/[newCensusIDParam]/route');
    const res = await GET(makeRequest(), makeContext(VALID_SCHEMA));

    expect(res.status).toBe(HTTP_OK);
    const body = await res.json();
    expect(body.message).toBe(STUB_MESSAGE);
  });
});
