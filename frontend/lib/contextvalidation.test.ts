import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'next-auth';
import type { SitesRDS } from '@/config/sqlrdsdefinitions/zones';

const { authMock, getCookieMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getCookieMock: vi.fn()
}));

vi.mock('@/auth', () => ({
  auth: authMock
}));

vi.mock('@/app/actions/cookiemanager', () => ({
  getCookie: getCookieMock
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

import { validateContextualValues } from '@/lib/contextvalidation';

const AUTHORIZED_SCHEMA = 'forestgeo_testing';
const STATUS_UNAUTHENTICATED = 401;
const STATUS_FORBIDDEN = 403;
const STATUS_OK = 200;

function makeRequest(schema?: string) {
  const url = new URL('http://localhost/api/example');
  if (schema) url.searchParams.set('schema', schema);
  const req: any = new Request(url.toString(), { method: 'GET' });
  req.nextUrl = url; // matches how validateContextualValues reads request.nextUrl
  return req as any;
}

function sessionWithSites(schemaNames: string[], userStatus?: string): Session {
  const sites = schemaNames.map(name => ({ schemaName: name }) as SitesRDS);
  return { user: { sites, allsites: [], userStatus } } as unknown as Session;
}

describe('validateContextualValues — per-site schema authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no cookies present so only the query-param schema matters.
    getCookieMock.mockResolvedValue(undefined);
  });

  it('allows a request when the resolved schema is in session.user.sites', async () => {
    authMock.mockResolvedValue(sessionWithSites([AUTHORIZED_SCHEMA], 'field crew'));

    const result = await validateContextualValues(makeRequest(AUTHORIZED_SCHEMA), { requireSchema: true });

    expect(result.success).toBe(true);
    expect(result.values?.schema).toBe(AUTHORIZED_SCHEMA);
    expect(result.response).toBeUndefined();
  });

  it('rejects a pattern-valid schema the user is not a member of with 403 SCHEMA_ACCESS_DENIED', async () => {
    // forestgeo_panama is a valid schema name, but the session only has forestgeo_testing.
    authMock.mockResolvedValue(sessionWithSites([AUTHORIZED_SCHEMA], 'field crew'));

    const result = await validateContextualValues(makeRequest('forestgeo_panama'), { requireSchema: true });

    expect(result.success).toBe(false);
    expect(result.response).toBeDefined();
    expect(result.response!.status).toBe(STATUS_FORBIDDEN);
    const body = await result.response!.json();
    expect(body.code).toBe('SCHEMA_ACCESS_DENIED');
  });

  it('returns 401 UNAUTHENTICATED when there is no session', async () => {
    authMock.mockResolvedValue(null);

    const result = await validateContextualValues(makeRequest(AUTHORIZED_SCHEMA), { requireSchema: true });

    expect(result.success).toBe(false);
    expect(result.response).toBeDefined();
    expect(result.response!.status).toBe(STATUS_UNAUTHENTICATED);
    const body = await result.response!.json();
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('allows an admin session regardless of site membership', async () => {
    // Admin has no sites at all yet still resolves a schema outside any membership.
    authMock.mockResolvedValue(sessionWithSites([], 'global'));

    const result = await validateContextualValues(makeRequest('forestgeo_panama'), { requireSchema: true });

    expect(result.success).toBe(true);
    expect(result.values?.schema).toBe('forestgeo_panama');
  });

  it('skips the access check entirely when requireSchemaAccess is false', async () => {
    // Unauthorized schema + no session would normally fail, but the escape hatch bypasses auth.
    authMock.mockResolvedValue(null);

    const result = await validateContextualValues(makeRequest('forestgeo_panama'), { requireSchemaAccess: false });

    expect(result.success).toBe(true);
    expect(result.values?.schema).toBe('forestgeo_panama');
    expect(authMock).not.toHaveBeenCalled();
  });

  it('skips the access check when no schema is resolved (nothing to authorize)', async () => {
    // No schema param, no cookie; requireSchema not set so absence is allowed.
    authMock.mockResolvedValue(null);

    const result = await validateContextualValues(makeRequest(), {});

    expect(result.success).toBe(true);
    expect(result.values?.schema).toBeUndefined();
    expect(authMock).not.toHaveBeenCalled();
  });
});

describe('validateContextualValues — default requireSchemaAccess is true', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCookieMock.mockResolvedValue(undefined);
  });

  it('enforces membership without an explicit requireSchemaAccess flag', async () => {
    authMock.mockResolvedValue(sessionWithSites([AUTHORIZED_SCHEMA], 'field crew'));

    const denied = await validateContextualValues(makeRequest('forestgeo_panama'), {});
    expect(denied.success).toBe(false);
    expect(denied.response!.status).toBe(STATUS_FORBIDDEN);

    const allowed = await validateContextualValues(makeRequest(AUTHORIZED_SCHEMA), {});
    expect(allowed.success).toBe(true);
    expect(allowed.response).toBeUndefined();
  });
});
