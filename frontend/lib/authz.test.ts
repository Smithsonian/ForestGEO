import { describe, expect, it } from 'vitest';
import type { Session } from 'next-auth';
import type { SitesRDS } from '@/config/sqlrdsdefinitions/zones';
import { assertSchemaAccess, hasSchemaAccess, isAdminSession } from '@/lib/authz';

const AUTHORIZED_SCHEMA = 'forestgeo_testing';
const OTHER_SCHEMA = 'forestgeo_panama';
const STATUS_FORBIDDEN = 403;
const STATUS_SERVICE_UNAVAILABLE = 503;

function sessionWithSites(schemaNames: string[], userStatus?: string): Session {
  const sites = schemaNames.map(name => ({ schemaName: name }) as SitesRDS);
  return { user: { sites, allsites: [], userStatus } } as unknown as Session;
}

function sessionWithPermissionsUnavailable(): Session {
  return { user: { sites: [], allsites: [], permissionsUnavailable: true } } as unknown as Session;
}

describe('assertSchemaAccess', () => {
  it('returns null (allow) when the user is a member of the schema', () => {
    const result = assertSchemaAccess(sessionWithSites([AUTHORIZED_SCHEMA], 'field crew'), AUTHORIZED_SCHEMA);
    expect(result).toBeNull();
  });

  it('returns null (allow) for admin sessions regardless of site membership', () => {
    const result = assertSchemaAccess(sessionWithSites([], 'global'), OTHER_SCHEMA);
    expect(result).toBeNull();
  });

  it('returns 403 when the user is not a member of the schema and not an admin', async () => {
    const result = assertSchemaAccess(sessionWithSites([AUTHORIZED_SCHEMA], 'field crew'), OTHER_SCHEMA);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(STATUS_FORBIDDEN);
  });

  it('returns 503 PERMISSIONS_UNAVAILABLE (NOT 403) when permissionsUnavailable is set', async () => {
    // Infra outage path: the auth provider returned a session but the
    // permissions lookup failed. The 503 lets callers retry; falling through
    // to the membership check would mask this as a 403 user denial.
    const result = assertSchemaAccess(sessionWithPermissionsUnavailable(), AUTHORIZED_SCHEMA);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(STATUS_SERVICE_UNAVAILABLE);
    const body = await result!.json();
    expect(body.code).toBe('PERMISSIONS_UNAVAILABLE');
  });
});

describe('hasSchemaAccess / isAdminSession (sanity)', () => {
  it('hasSchemaAccess is case-insensitive', () => {
    expect(hasSchemaAccess(sessionWithSites([AUTHORIZED_SCHEMA]), AUTHORIZED_SCHEMA.toUpperCase())).toBe(true);
  });

  it('isAdminSession recognises global and db admin roles', () => {
    expect(isAdminSession(sessionWithSites([], 'global'))).toBe(true);
    expect(isAdminSession(sessionWithSites([], 'db admin'))).toBe(true);
    expect(isAdminSession(sessionWithSites([], 'field crew'))).toBe(false);
  });
});
