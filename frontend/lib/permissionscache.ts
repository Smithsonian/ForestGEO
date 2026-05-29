// In-process cache for the per-user permissions returned by AUTH_FUNCTIONS_POLL_URL.
//
// The NextAuth session callback ran an HTTP fetch to the auth Azure Function on
// every authenticated request because sites/allsites are not persisted on the
// JWT. Caching by email here keeps the auth fetch to once per TTL window per
// process, while still letting permission revocation propagate within the TTL.
//
// Notes:
// - Per-process state. Multi-instance deployments will have a separate cache per
//   instance; this is acceptable because each instance pays at most one fetch
//   per TTL window per user, and a stale entry self-heals at expiry.
// - Mappers run on the cached entry so consumers always see the SitesRDS shape
//   they expect, regardless of whether they hit the fetch or the cache.
// - The cache is intentionally narrow (no LRU eviction). If the working set of
//   distinct emails exceeds tens of thousands, a real LRU should be added; for
//   ForestGEO's user base that is far away.

import MapperFactory from '@/config/datamapper';
import { SitesRDS, SitesResult } from '@/config/sqlrdsdefinitions/zones';
import type { UserAuthRoles } from '@/config/macros';

export interface CachedPermissions {
  userStatus: UserAuthRoles;
  sites: SitesRDS[];
  allsites: SitesRDS[];
  expiresAt: number;
}

interface AuthFunctionResponse {
  userStatus: UserAuthRoles;
  allowedSites: SitesResult[];
  allSites: SitesResult[];
}

// 5 minutes default TTL — short enough that revocation propagates within a
// reasonable window, long enough that the auth fetch is amortized across many
// requests. Override with PERMISSIONS_CACHE_TTL_MS for tuning.
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function readTtlMs(): number {
  const raw = process.env.PERMISSIONS_CACHE_TTL_MS;
  if (!raw) return DEFAULT_TTL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTL_MS;
  return parsed;
}

const cache = new Map<string, CachedPermissions>();
const inflight = new Map<string, Promise<CachedPermissions>>();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getCachedPermissions(email: string): CachedPermissions | null {
  const key = normalizeEmail(email);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry;
}

export function invalidatePermissions(email?: string): void {
  if (email === undefined) {
    cache.clear();
    inflight.clear();
    return;
  }
  const key = normalizeEmail(email);
  cache.delete(key);
  inflight.delete(key);
}

// Internal: do the network fetch and shape the response into a cache entry.
// Exposed for tests via _fetchPermissionsForTest, never called directly outside
// this module by production code.
async function fetchAndShape(email: string, fetchImpl: typeof fetch): Promise<CachedPermissions> {
  const baseUrl = process.env.AUTH_FUNCTIONS_POLL_URL;
  if (!baseUrl) {
    throw new Error('AUTH_FUNCTIONS_POLL_URL is not configured');
  }
  const url = `${baseUrl}?email=${encodeURIComponent(email)}`;
  const response = await fetchImpl(url, { method: 'GET' });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`auth function poll returned ${response.status}`, {
      url,
      status: response.status,
      statusText: response.statusText,
      body: body.slice(0, 500)
    });
    throw new Error(`auth function poll failed (${response.status})`);
  }
  const data = (await response.json()) as AuthFunctionResponse;
  const sitesMapper = MapperFactory.getMapper<SitesRDS, SitesResult>('sites');
  return {
    userStatus: data.userStatus,
    sites: sitesMapper.mapData(data.allowedSites ?? []),
    allsites: sitesMapper.mapData(data.allSites ?? []),
    expiresAt: Date.now() + readTtlMs()
  };
}

export async function getOrFetchPermissions(email: string, fetchImpl: typeof fetch = fetch): Promise<CachedPermissions> {
  const key = normalizeEmail(email);
  const cached = getCachedPermissions(key);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  // Important: clear the in-flight entry whether the fetch resolved or
  // rejected. Without the .finally, a rejected promise would stay parked
  // and every subsequent caller for this email would see the same stuck
  // rejection until the cache eventually got invalidated some other way.
  const pending = fetchAndShape(key, fetchImpl)
    .then(fresh => {
      cache.set(key, fresh);
      return fresh;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, pending);
  return pending;
}

// Test seam: lets tests inject entries deterministically without going through
// the network. Not part of the production API.
export function _seedCacheForTest(email: string, entry: CachedPermissions): void {
  cache.set(normalizeEmail(email), entry);
}

export function _clearCacheForTest(): void {
  cache.clear();
  inflight.clear();
}
