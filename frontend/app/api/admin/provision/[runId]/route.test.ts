import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getRunWithSteps: vi.fn(),
  reconcileStaleRun: vi.fn(),
  poolInstance: { pool: {} }
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/provisioning/orchestrator', () => ({
  getRunWithSteps: mocks.getRunWithSteps,
  reconcileStaleRun: mocks.reconcileStaleRun
}));
vi.mock('@/config/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: () => mocks.poolInstance
}));

import { GET } from './route';

const GLOBAL_SESSION = { user: { email: 'admin@example.com', userStatus: 'global' } };
const DB_ADMIN_SESSION = { user: { email: 'dbadmin@example.com', userStatus: 'db admin' } };

function makeGetRequest(runId: string): Request {
  return new Request(`http://localhost/api/admin/provision/${runId}`, { method: 'GET' });
}

function makeParams(runId: string): { params: Promise<{ runId: string }> } {
  return { params: Promise.resolve({ runId }) };
}

function makeStepRecord(
  overrides: Partial<{
    stepId: number;
    runId: number;
    stepIndex: number;
    stepKey: string;
    status: string;
    startedAt: Date | null;
    finishedAt: Date | null;
    errorMessage: string | null;
    errorStack: string | null;
  }> = {}
) {
  return {
    stepId: 1,
    runId: 7,
    stepIndex: 0,
    stepKey: 'validate-inputs',
    status: 'completed',
    startedAt: new Date('2025-01-01T10:00:00Z'),
    finishedAt: new Date('2025-01-01T10:00:05Z'),
    errorMessage: null,
    errorStack: null,
    ...overrides
  };
}

function makeRunRecord(
  overrides: Partial<{
    runId: number;
    status: string;
    startedBy: string;
    startedAt: Date;
    finishedAt: Date | null;
    siteName: string;
    schemaName: string;
    input: unknown;
  }> = {}
) {
  return {
    runId: 7,
    status: 'completed',
    startedBy: 'admin@example.com',
    startedAt: new Date('2025-01-01T10:00:00Z'),
    finishedAt: new Date('2025-01-01T10:05:00Z'),
    siteName: 'Test Forest',
    schemaName: 'forestgeo_test_forest',
    input: {},
    ...overrides
  };
}

describe('GET /api/admin/provision/[runId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reconcileStaleRun.mockResolvedValue(false);
  });

  it('returns 401 when there is no session', async () => {
    mocks.auth.mockResolvedValue(null);

    const res = await GET(makeGetRequest('7'), makeParams('7'));

    expect(res.status).toBe(401);
    expect(mocks.getRunWithSteps).not.toHaveBeenCalled();
  });

  it('returns 403 when the authenticated user is a db admin (non-global)', async () => {
    mocks.auth.mockResolvedValue(DB_ADMIN_SESSION);

    const res = await GET(makeGetRequest('7'), makeParams('7'));

    expect(res.status).toBe(403);
    expect(mocks.getRunWithSteps).not.toHaveBeenCalled();
  });

  it('returns 400 when runId is not a number', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await GET(makeGetRequest('abc'), makeParams('abc'));

    expect(res.status).toBe(400);
    expect(mocks.getRunWithSteps).not.toHaveBeenCalled();
  });

  it('returns 400 when runId contains trailing characters', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await GET(makeGetRequest('7abc'), makeParams('7abc'));

    expect(res.status).toBe(400);
    expect(mocks.getRunWithSteps).not.toHaveBeenCalled();
  });

  it('returns 400 when runId is zero', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await GET(makeGetRequest('0'), makeParams('0'));

    expect(res.status).toBe(400);
    expect(mocks.getRunWithSteps).not.toHaveBeenCalled();
  });

  it('returns 400 when runId is negative', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await GET(makeGetRequest('-5'), makeParams('-5'));

    expect(res.status).toBe(400);
    expect(mocks.getRunWithSteps).not.toHaveBeenCalled();
  });

  it('returns 500 when getRunWithSteps throws a database error', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    mocks.getRunWithSteps.mockRejectedValue(new Error('Connection lost'));

    const res = await GET(makeGetRequest('7'), makeParams('7'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('Connection lost');
  });

  it('returns 404 when the runId does not match any run', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    mocks.getRunWithSteps.mockResolvedValue(null);

    const res = await GET(makeGetRequest('999'), makeParams('999'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toHaveProperty('error');
    expect(mocks.getRunWithSteps).toHaveBeenCalledWith(999, mocks.poolInstance.pool);
  });

  it('returns 200 with run, steps, and stuckStepIndex: null when all steps are completed', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const run = makeRunRecord();
    const steps = [makeStepRecord({ stepIndex: 0, status: 'completed' }), makeStepRecord({ stepIndex: 1, status: 'completed', stepKey: 'create-schema' })];
    mocks.getRunWithSteps.mockResolvedValue({ run, steps });

    const res = await GET(makeGetRequest('7'), makeParams('7'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty('run');
    expect(body).toHaveProperty('steps');
    expect(body.stuckStepIndex).toBeNull();
    expect(mocks.getRunWithSteps).toHaveBeenCalledWith(7, mocks.poolInstance.pool);
  });

  it('returns 200 with stuckStepIndex: null when a step is running but started recently', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const run = makeRunRecord({ status: 'running', finishedAt: null });
    const recentlyStarted = new Date(Date.now() - 30 * 1000); // 30 seconds ago — well under threshold
    const steps = [
      makeStepRecord({ stepIndex: 0, status: 'completed' }),
      makeStepRecord({ stepIndex: 1, status: 'running', startedAt: recentlyStarted, stepKey: 'create-schema' })
    ];
    mocks.getRunWithSteps.mockResolvedValue({ run, steps });

    const res = await GET(makeGetRequest('7'), makeParams('7'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.stuckStepIndex).toBeNull();
    expect(mocks.reconcileStaleRun).toHaveBeenCalledWith(7, mocks.poolInstance.pool);
  });

  it('rechecks the run after stale-run reconciliation mutates state', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const runningRun = makeRunRecord({ status: 'running', finishedAt: null, startedAt: new Date(Date.now() - 10 * 60 * 1000) });
    const failedRun = makeRunRecord({ status: 'failed', finishedAt: new Date() });
    const beforeSteps = [makeStepRecord({ stepIndex: 0, status: 'pending', startedAt: null, finishedAt: null })];
    const afterSteps = [makeStepRecord({ stepIndex: 0, status: 'failed', errorMessage: 'Run stalled without an active provisioning worker' })];
    mocks.getRunWithSteps.mockResolvedValueOnce({ run: runningRun, steps: beforeSteps }).mockResolvedValueOnce({ run: failedRun, steps: afterSteps });
    mocks.reconcileStaleRun.mockResolvedValue(true);

    const res = await GET(makeGetRequest('7'), makeParams('7'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.run.status).toBe('failed');
    expect(body.steps[0].status).toBe('failed');
    expect(mocks.getRunWithSteps).toHaveBeenCalledTimes(2);
  });

  it('returns 200 with stuckStepIndex: 2 when step at index 2 has been running for 10 minutes', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const run = makeRunRecord({ status: 'running', finishedAt: null });
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const steps = [
      makeStepRecord({ stepIndex: 0, status: 'completed' }),
      makeStepRecord({ stepIndex: 1, status: 'completed', stepKey: 'create-schema' }),
      makeStepRecord({ stepIndex: 2, status: 'running', startedAt: tenMinutesAgo, stepKey: 'insert-quadrats' })
    ];
    mocks.getRunWithSteps.mockResolvedValue({ run, steps });

    const res = await GET(makeGetRequest('7'), makeParams('7'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.stuckStepIndex).toBe(2);
  });

  it('returns stuckStepIndex for the first stuck step found when multiple could qualify', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const run = makeRunRecord({ status: 'running', finishedAt: null });
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const steps = [
      makeStepRecord({ stepIndex: 0, status: 'running', startedAt: tenMinutesAgo, stepKey: 'validate-inputs' }),
      makeStepRecord({ stepIndex: 1, status: 'running', startedAt: tenMinutesAgo, stepKey: 'create-schema' })
    ];
    mocks.getRunWithSteps.mockResolvedValue({ run, steps });

    const res = await GET(makeGetRequest('7'), makeParams('7'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.stuckStepIndex).toBe(0);
  });
});
