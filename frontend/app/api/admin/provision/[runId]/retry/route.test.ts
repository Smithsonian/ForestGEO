/**
 * Tests for the retry, abort, and mark-failed POST endpoints.
 * All three share the same auth pattern and pool acquisition; differences are
 * in which orchestrator function they call and what body parsing they perform.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  retryRun: vi.fn(),
  abortRun: vi.fn(),
  markStepFailed: vi.fn(),
  poolInstance: { pool: {} }
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/provisioning/orchestrator', () => ({
  retryRun: mocks.retryRun,
  abortRun: mocks.abortRun,
  markStepFailed: mocks.markStepFailed
}));
vi.mock('@/config/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: () => mocks.poolInstance
}));

import { POST as retryPOST } from './route';
import { POST as abortPOST } from '../abort/route';
import { POST as markFailedPOST } from '../mark-failed/route';

const GLOBAL_SESSION = { user: { email: 'admin@example.com', userStatus: 'global' } };
const DB_ADMIN_SESSION = { user: { email: 'dbadmin@example.com', userStatus: 'db admin' } };

function makeParams(runId: string): { params: Promise<{ runId: string }> } {
  return { params: Promise.resolve({ runId }) };
}

function makeRequest(url: string, body?: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
}

function makeRawBodyRequest(url: string, rawBody: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody
  });
}

// ─── retry ───────────────────────────────────────────────────────────────────

describe('POST /api/admin/provision/[runId]/retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when there is no session', async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await retryPOST(makeRequest('http://localhost/api/admin/provision/7/retry'), makeParams('7'));

    expect(res.status).toBe(401);
    expect(mocks.retryRun).not.toHaveBeenCalled();
  });

  it('returns 403 when the authenticated user is a db admin (non-global)', async () => {
    mocks.auth.mockResolvedValue(DB_ADMIN_SESSION);

    const res = await retryPOST(makeRequest('http://localhost/api/admin/provision/7/retry'), makeParams('7'));

    expect(res.status).toBe(403);
    expect(mocks.retryRun).not.toHaveBeenCalled();
  });

  it('returns 400 when runId is not a valid positive integer', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await retryPOST(makeRequest('http://localhost/api/admin/provision/abc/retry'), makeParams('abc'));

    expect(res.status).toBe(400);
    expect(mocks.retryRun).not.toHaveBeenCalled();
  });

  it('returns 400 when runId has trailing non-numeric characters', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await retryPOST(makeRequest('http://localhost/api/admin/provision/7abc/retry'), makeParams('7abc'));

    expect(res.status).toBe(400);
    expect(mocks.retryRun).not.toHaveBeenCalled();
  });

  it('returns { ok: true } when a global admin retries a failed run', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    mocks.retryRun.mockResolvedValue(undefined);

    const res = await retryPOST(makeRequest('http://localhost/api/admin/provision/7/retry'), makeParams('7'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mocks.retryRun).toHaveBeenCalledOnce();
    expect(mocks.retryRun).toHaveBeenCalledWith(7, mocks.poolInstance.pool);
  });

  it('returns 409 when retryRun throws because the run is already running', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    mocks.retryRun.mockRejectedValue(new Error('Run 7 is already running'));

    const res = await retryPOST(makeRequest('http://localhost/api/admin/provision/7/retry'), makeParams('7'));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('already running');
  });

  it('returns 409 when retryRun throws because the run does not exist', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    mocks.retryRun.mockRejectedValue(new Error('Run 999 not found'));

    const res = await retryPOST(makeRequest('http://localhost/api/admin/provision/999/retry'), makeParams('999'));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('not found');
  });
});

// ─── abort ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/provision/[runId]/abort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when there is no session', async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await abortPOST(makeRequest('http://localhost/api/admin/provision/7/abort'), makeParams('7'));

    expect(res.status).toBe(401);
    expect(mocks.abortRun).not.toHaveBeenCalled();
  });

  it('returns 403 when the authenticated user is a db admin (non-global)', async () => {
    mocks.auth.mockResolvedValue(DB_ADMIN_SESSION);

    const res = await abortPOST(makeRequest('http://localhost/api/admin/provision/7/abort'), makeParams('7'));

    expect(res.status).toBe(403);
    expect(mocks.abortRun).not.toHaveBeenCalled();
  });

  it('returns 400 when runId is not a valid positive integer', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await abortPOST(makeRequest('http://localhost/api/admin/provision/0/abort'), makeParams('0'));

    expect(res.status).toBe(400);
    expect(mocks.abortRun).not.toHaveBeenCalled();
  });

  it('returns 400 when runId has trailing non-numeric characters', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await abortPOST(makeRequest('http://localhost/api/admin/provision/7abc/abort'), makeParams('7abc'));

    expect(res.status).toBe(400);
    expect(mocks.abortRun).not.toHaveBeenCalled();
  });

  it('returns { ok: true } when a global admin aborts a run', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    mocks.abortRun.mockResolvedValue(undefined);

    const res = await abortPOST(makeRequest('http://localhost/api/admin/provision/7/abort'), makeParams('7'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mocks.abortRun).toHaveBeenCalledOnce();
    expect(mocks.abortRun).toHaveBeenCalledWith(7, mocks.poolInstance.pool);
  });

  it('returns 409 when abortRun throws because the run has an unsafe schema name', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    mocks.abortRun.mockRejectedValue(new Error('Refusing to abort run with unsafe schema name'));

    const res = await abortPOST(makeRequest('http://localhost/api/admin/provision/7/abort'), makeParams('7'));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('unsafe schema name');
  });

  it('returns 409 when abortRun throws because the run does not exist', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    mocks.abortRun.mockRejectedValue(new Error('Run 999 not found'));

    const res = await abortPOST(makeRequest('http://localhost/api/admin/provision/999/abort'), makeParams('999'));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('not found');
  });
});

// ─── mark-failed ──────────────────────────────────────────────────────────────

describe('POST /api/admin/provision/[runId]/mark-failed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when there is no session', async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await markFailedPOST(makeRequest('http://localhost/api/admin/provision/7/mark-failed', { stepIndex: 2 }), makeParams('7'));

    expect(res.status).toBe(401);
    expect(mocks.markStepFailed).not.toHaveBeenCalled();
  });

  it('returns 403 when the authenticated user is a db admin (non-global)', async () => {
    mocks.auth.mockResolvedValue(DB_ADMIN_SESSION);

    const res = await markFailedPOST(makeRequest('http://localhost/api/admin/provision/7/mark-failed', { stepIndex: 2 }), makeParams('7'));

    expect(res.status).toBe(403);
    expect(mocks.markStepFailed).not.toHaveBeenCalled();
  });

  it('returns 400 when runId is not a valid positive integer', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await markFailedPOST(makeRequest('http://localhost/api/admin/provision/-1/mark-failed', { stepIndex: 2 }), makeParams('-1'));

    expect(res.status).toBe(400);
    expect(mocks.markStepFailed).not.toHaveBeenCalled();
  });

  it('returns 400 when runId has trailing non-numeric characters', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await markFailedPOST(makeRequest('http://localhost/api/admin/provision/7abc/mark-failed', { stepIndex: 2 }), makeParams('7abc'));

    expect(res.status).toBe(400);
    expect(mocks.markStepFailed).not.toHaveBeenCalled();
  });

  it('returns 400 when the request body is not valid JSON', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await markFailedPOST(makeRawBodyRequest('http://localhost/api/admin/provision/7/mark-failed', '{{{'), makeParams('7'));

    expect(res.status).toBe(400);
    expect(mocks.markStepFailed).not.toHaveBeenCalled();
  });

  it('returns 400 when stepIndex is missing from the body', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await markFailedPOST(makeRequest('http://localhost/api/admin/provision/7/mark-failed', {}), makeParams('7'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toHaveProperty('error');
    expect(mocks.markStepFailed).not.toHaveBeenCalled();
  });

  it('returns 400 when stepIndex is a string instead of a number', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await markFailedPOST(makeRequest('http://localhost/api/admin/provision/7/mark-failed', { stepIndex: 'two' }), makeParams('7'));

    expect(res.status).toBe(400);
    expect(mocks.markStepFailed).not.toHaveBeenCalled();
  });

  it('returns 400 when stepIndex is negative', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await markFailedPOST(makeRequest('http://localhost/api/admin/provision/7/mark-failed', { stepIndex: -1 }), makeParams('7'));

    expect(res.status).toBe(400);
    expect(mocks.markStepFailed).not.toHaveBeenCalled();
  });

  it('returns { ok: true } when a global admin marks step 2 failed on run 7', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    mocks.markStepFailed.mockResolvedValue(undefined);

    const res = await markFailedPOST(makeRequest('http://localhost/api/admin/provision/7/mark-failed', { stepIndex: 2 }), makeParams('7'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mocks.markStepFailed).toHaveBeenCalledOnce();
    expect(mocks.markStepFailed).toHaveBeenCalledWith(7, 2, mocks.poolInstance.pool);
  });

  it('accepts stepIndex: 0 (first step) as a valid value', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    mocks.markStepFailed.mockResolvedValue(undefined);

    const res = await markFailedPOST(makeRequest('http://localhost/api/admin/provision/7/mark-failed', { stepIndex: 0 }), makeParams('7'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mocks.markStepFailed).toHaveBeenCalledWith(7, 0, mocks.poolInstance.pool);
  });

  it('returns 409 when markStepFailed throws an orchestrator error', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    mocks.markStepFailed.mockRejectedValue(new Error('No running step at index 2 for run 7'));

    const res = await markFailedPOST(makeRequest('http://localhost/api/admin/provision/7/mark-failed', { stepIndex: 2 }), makeParams('7'));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('No running step');
  });
});
