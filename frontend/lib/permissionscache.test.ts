import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getOrFetchPermissions,
  getCachedPermissions,
  invalidatePermissions,
  _clearCacheForTest,
  _seedCacheForTest,
  type CachedPermissions
} from './permissionscache';

const EMAIL = 'user@example.com';
const POLL_URL = 'https://example.invalid/auth-poll';

const SAMPLE_RESPONSE = {
  userStatus: 'global',
  allowedSites: [
    { SiteID: '1', SiteName: 'Site One', SchemaName: 'site_one', SQDimX: '20', SQDimY: '20', DoubleDataEntry: 0 }
  ],
  allSites: [
    { SiteID: '1', SiteName: 'Site One', SchemaName: 'site_one', SQDimX: '20', SQDimY: '20', DoubleDataEntry: 0 },
    { SiteID: '2', SiteName: 'Site Two', SchemaName: 'site_two', SQDimX: '25', SQDimY: '25', DoubleDataEntry: 1 }
  ]
};

function makeFetchOk(payload: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  ) as unknown as typeof fetch;
}

function makeFetchErr(status: number, body = 'oops') {
  return vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
}

describe('permissionscache', () => {
  const originalUrl = process.env.AUTH_FUNCTIONS_POLL_URL;
  const originalTtl = process.env.PERMISSIONS_CACHE_TTL_MS;

  beforeEach(() => {
    _clearCacheForTest();
    process.env.AUTH_FUNCTIONS_POLL_URL = POLL_URL;
    delete process.env.PERMISSIONS_CACHE_TTL_MS;
  });

  afterEach(() => {
    process.env.AUTH_FUNCTIONS_POLL_URL = originalUrl;
    if (originalTtl === undefined) {
      delete process.env.PERMISSIONS_CACHE_TTL_MS;
    } else {
      process.env.PERMISSIONS_CACHE_TTL_MS = originalTtl;
    }
    vi.useRealTimers();
  });

  it('first call hits AUTH_FUNCTIONS_POLL_URL with the URL-encoded email and caches the mapped result', async () => {
    const fetchMock = makeFetchOk(SAMPLE_RESPONSE);
    const result = await getOrFetchPermissions(EMAIL, fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledWith = (fetchMock as any).mock.calls[0][0] as string;
    expect(calledWith).toBe(`${POLL_URL}?email=${encodeURIComponent(EMAIL)}`);

    expect(result.userStatus).toBe('global');
    // Note: vitest setup (testing/auth-mocks.ts) mocks MapperFactory to a
    // passthrough that adds {id: index+1}. We assert on row count and the
    // identity-preserving fields rather than the production GenericMapper's
    // decapitalization (which is not exercised in this unit test).
    expect(result.sites).toHaveLength(1);
    expect(result.allsites).toHaveLength(2);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it('second call within TTL returns the cached entry without re-fetching', async () => {
    const fetchMock = makeFetchOk(SAMPLE_RESPONSE);
    const first = await getOrFetchPermissions(EMAIL, fetchMock);
    const second = await getOrFetchPermissions(EMAIL, fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first); // exact object reference — cached entry returned as-is
  });

  it('expired entry triggers a re-fetch and replaces the cached value', async () => {
    process.env.PERMISSIONS_CACHE_TTL_MS = '1000'; // 1 s
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-29T00:00:00Z'));

    const fetchMock = makeFetchOk(SAMPLE_RESPONSE);
    const first = await getOrFetchPermissions(EMAIL, fetchMock);

    // advance past TTL
    vi.setSystemTime(new Date('2026-04-29T00:00:02Z'));

    const fetchMock2 = makeFetchOk({ ...SAMPLE_RESPONSE, userStatus: 'db admin' });
    const second = await getOrFetchPermissions(EMAIL, fetchMock2);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock2).toHaveBeenCalledTimes(1);
    expect(first.userStatus).toBe('global');
    expect(second.userStatus).toBe('db admin');
  });

  it('per-email isolation: cache miss for one email does not affect another', async () => {
    const fetchMock = makeFetchOk(SAMPLE_RESPONSE);
    await getOrFetchPermissions('a@example.com', fetchMock);
    await getOrFetchPermissions('b@example.com', fetchMock);
    await getOrFetchPermissions('a@example.com', fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(2); // a (miss) → b (miss) → a (hit)
  });

  it('upstream non-2xx response throws and does not cache', async () => {
    const fetchMock = makeFetchErr(503, 'service unavailable');
    await expect(getOrFetchPermissions(EMAIL, fetchMock)).rejects.toThrow(/503/);
    expect(getCachedPermissions(EMAIL)).toBeNull();
  });

  it('missing AUTH_FUNCTIONS_POLL_URL is a configuration error, not a 500-from-upstream', async () => {
    delete process.env.AUTH_FUNCTIONS_POLL_URL;
    const fetchMock = vi.fn();
    await expect(getOrFetchPermissions(EMAIL, fetchMock as unknown as typeof fetch)).rejects.toThrow(/AUTH_FUNCTIONS_POLL_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('invalidatePermissions(email) drops one entry; invalidatePermissions() drops all', async () => {
    const futureExpiry = Date.now() + 60_000;
    const seed: CachedPermissions = { userStatus: 'global', sites: [], allsites: [], expiresAt: futureExpiry };
    _seedCacheForTest('a@example.com', seed);
    _seedCacheForTest('b@example.com', seed);

    invalidatePermissions('a@example.com');
    expect(getCachedPermissions('a@example.com')).toBeNull();
    expect(getCachedPermissions('b@example.com')).not.toBeNull();

    invalidatePermissions();
    expect(getCachedPermissions('b@example.com')).toBeNull();
  });

  it('email is URL-encoded when constructing the auth-poll URL', async () => {
    const trickyEmail = 'first.last+tag@example.com';
    const fetchMock = makeFetchOk(SAMPLE_RESPONSE);
    await getOrFetchPermissions(trickyEmail, fetchMock);
    const calledWith = (fetchMock as any).mock.calls[0][0] as string;
    expect(calledWith).toBe(`${POLL_URL}?email=first.last%2Btag%40example.com`);
  });
});
