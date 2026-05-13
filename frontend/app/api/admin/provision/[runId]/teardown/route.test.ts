import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  teardownProvisionedSite: vi.fn(),
  poolInstance: { pool: {} }
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/provisioning/orchestrator', () => ({
  teardownProvisionedSite: mocks.teardownProvisionedSite
}));
vi.mock('@/config/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: () => mocks.poolInstance
}));

import { DELETE } from './route';

const GLOBAL_SESSION = { user: { email: 'admin@example.com', userStatus: 'global' } };
const DB_ADMIN_SESSION = { user: { email: 'dbadmin@example.com', userStatus: 'db admin' } };

function makeParams(runId: string): { params: Promise<{ runId: string }> } {
  return { params: Promise.resolve({ runId }) };
}

function makeRequest(url: string, body?: unknown): Request {
  return new Request(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
}

function makeRawBodyRequest(url: string, rawBody: string): Request {
  return new Request(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody
  });
}

describe('DELETE /api/admin/provision/[runId]/teardown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when there is no session', async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await DELETE(makeRequest('http://localhost/api/admin/provision/7/teardown', { confirmSchemaName: 'forestgeo_test' }), makeParams('7'));

    expect(res.status).toBe(401);
    expect(mocks.teardownProvisionedSite).not.toHaveBeenCalled();
  });

  it('returns 403 when the authenticated user is a db admin (non-global)', async () => {
    mocks.auth.mockResolvedValue(DB_ADMIN_SESSION);

    const res = await DELETE(makeRequest('http://localhost/api/admin/provision/7/teardown', { confirmSchemaName: 'forestgeo_test' }), makeParams('7'));

    expect(res.status).toBe(403);
    expect(mocks.teardownProvisionedSite).not.toHaveBeenCalled();
  });

  it('returns 400 when runId is not a valid positive integer', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await DELETE(makeRequest('http://localhost/api/admin/provision/7abc/teardown', { confirmSchemaName: 'forestgeo_test' }), makeParams('7abc'));

    expect(res.status).toBe(400);
    expect(mocks.teardownProvisionedSite).not.toHaveBeenCalled();
  });

  it('returns 400 when the request body is not valid JSON', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await DELETE(makeRawBodyRequest('http://localhost/api/admin/provision/7/teardown', '{{{'), makeParams('7'));

    expect(res.status).toBe(400);
    expect(mocks.teardownProvisionedSite).not.toHaveBeenCalled();
  });

  it('returns 400 when confirmSchemaName is missing', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await DELETE(makeRequest('http://localhost/api/admin/provision/7/teardown', {}), makeParams('7'));

    expect(res.status).toBe(400);
    expect(mocks.teardownProvisionedSite).not.toHaveBeenCalled();
  });

  it('returns { ok: true } when a global admin tears down a completed run', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    mocks.teardownProvisionedSite.mockResolvedValue(undefined);

    const res = await DELETE(makeRequest('http://localhost/api/admin/provision/7/teardown', { confirmSchemaName: 'forestgeo_test' }), makeParams('7'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mocks.teardownProvisionedSite).toHaveBeenCalledOnce();
    expect(mocks.teardownProvisionedSite).toHaveBeenCalledWith(7, 'forestgeo_test', mocks.poolInstance.pool);
  });

  it('returns 404 when the run does not exist', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    mocks.teardownProvisionedSite.mockRejectedValue(new Error('Run 999 not found'));

    const res = await DELETE(makeRequest('http://localhost/api/admin/provision/999/teardown', { confirmSchemaName: 'forestgeo_test' }), makeParams('999'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain('not found');
  });

  it('returns 409 when schema confirmation does not match', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    mocks.teardownProvisionedSite.mockRejectedValue(new Error('Schema confirmation does not match run schema forestgeo_test'));

    const res = await DELETE(makeRequest('http://localhost/api/admin/provision/7/teardown', { confirmSchemaName: 'forestgeo_wrong' }), makeParams('7'));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('confirmation');
  });

  it('returns 409 when the run is not completed', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    mocks.teardownProvisionedSite.mockRejectedValue(new Error('Run 7 must be completed before teardown'));

    const res = await DELETE(makeRequest('http://localhost/api/admin/provision/7/teardown', { confirmSchemaName: 'forestgeo_test' }), makeParams('7'));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('completed');
  });
});
