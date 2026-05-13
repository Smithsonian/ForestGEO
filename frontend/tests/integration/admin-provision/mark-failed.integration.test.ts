/**
 * Integration tests for POST /api/admin/provision/[runId]/mark-failed.
 *
 * The route requires a running run with a step that has been in 'running'
 * status longer than the stuck threshold (5 minutes by default). On success it
 * flips the step to 'failed' and propagates the failure to the run row.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import {
  createTestPool,
  seedCatalogTables,
  clearProvisioningState,
  seedRun,
  seedSteps,
  makeRequest,
  makeParams,
  GLOBAL_SESSION,
  DB_ADMIN_SESSION,
  TEST_SCHEMA_PREFIX
} from './_shared';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  ailogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('@/ailogger', () => ({ default: mocks.ailogger }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));

let testPool: Pool;
vi.mock('@/config/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: () => ({ pool: testPool })
}));

import { POST } from '@/app/api/admin/provision/[runId]/mark-failed/route';

const TEST_SCHEMA = TEST_SCHEMA_PREFIX + 'markfailed';
const URL_FOR = (runId: string) => `http://test/api/admin/provision/${runId}/mark-failed`;
const STUCK_THRESHOLD_MS = 5 * 60 * 1000;

describe('POST /api/admin/provision/[runId]/mark-failed (integration)', () => {
  beforeAll(async () => {
    testPool = createTestPool();
    await seedCatalogTables(testPool);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await clearProvisioningState(testPool, TEST_SCHEMA);
  });

  afterAll(async () => {
    await clearProvisioningState(testPool, TEST_SCHEMA);
    await testPool.end();
  });

  it('returns 401 when there is no session', async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await POST(makeRequest(URL_FOR('7'), { method: 'POST', body: { stepIndex: 2 } }), makeParams('7'));
    expect(res.status).toBe(401);
  });

  it('returns 403 for a db-admin session', async () => {
    mocks.auth.mockResolvedValue(DB_ADMIN_SESSION);
    const res = await POST(makeRequest(URL_FOR('7'), { method: 'POST', body: { stepIndex: 2 } }), makeParams('7'));
    expect(res.status).toBe(403);
  });

  it('returns 400 when runId is non-numeric', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const res = await POST(makeRequest(URL_FOR('abc'), { method: 'POST', body: { stepIndex: 2 } }), makeParams('abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the JSON body is invalid', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const res = await POST(makeRequest(URL_FOR('7'), { method: 'POST', rawBody: '{{{' }), makeParams('7'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when stepIndex is missing', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const res = await POST(makeRequest(URL_FOR('7'), { method: 'POST', body: {} }), makeParams('7'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when stepIndex is negative', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const res = await POST(makeRequest(URL_FOR('7'), { method: 'POST', body: { stepIndex: -1 } }), makeParams('7'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when stepIndex is not a number', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const res = await POST(makeRequest(URL_FOR('7'), { method: 'POST', body: { stepIndex: 'two' } }), makeParams('7'));
    expect(res.status).toBe(400);
  });

  it('returns 404 with kind=not_found for a missing run', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const res = await POST(makeRequest(URL_FOR('999999'), { method: 'POST', body: { stepIndex: 0 } }), makeParams('999999'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.kind).toBe('not_found');
  });

  it('returns 409 with kind=conflict when the run is not running', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const runId = await seedRun(testPool, TEST_SCHEMA, 'completed');

    const res = await POST(makeRequest(URL_FOR(String(runId)), { method: 'POST', body: { stepIndex: 0 } }), makeParams(runId));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.kind).toBe('conflict');
  });

  it('returns 409 with kind=conflict when the targeted step has not yet exceeded the stuck threshold', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const runId = await seedRun(testPool, TEST_SCHEMA, 'running');
    // Seed StartedAt via NOW() server-side to avoid host/MySQL tz skew. 10s
    // ago is well under the 5-minute stuck threshold.
    await seedSteps(testPool, runId, [{ stepIndex: 0, stepKey: 'validate_inputs', status: 'running', startedAtSecondsAgo: 10 }]);

    const res = await POST(makeRequest(URL_FOR(String(runId)), { method: 'POST', body: { stepIndex: 0 } }), makeParams(runId));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.kind).toBe('conflict');
  });

  it('marks a stuck running step failed and flips the run status to failed', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const runId = await seedRun(testPool, TEST_SCHEMA, 'running');
    // Server-side NOW() - (threshold + 60s) makes the step "stuck" regardless
    // of host/MySQL timezone alignment.
    const stuckSecondsAgo = STUCK_THRESHOLD_MS / 1000 + 60;
    await seedSteps(testPool, runId, [{ stepIndex: 0, stepKey: 'validate_inputs', status: 'running', startedAtSecondsAgo: stuckSecondsAgo }]);

    const res = await POST(makeRequest(URL_FOR(String(runId)), { method: 'POST', body: { stepIndex: 0 } }), makeParams(runId));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    const [runs]: any = await testPool.query(`SELECT Status FROM catalog.provisioning_runs WHERE RunID = ?`, [runId]);
    expect(runs[0].Status).toBe('failed');

    const [steps]: any = await testPool.query(`SELECT Status, ErrorMessage FROM catalog.provisioning_steps WHERE RunID = ? AND StepIndex = ?`, [runId, 0]);
    expect(steps[0].Status).toBe('failed');
    expect(steps[0].ErrorMessage).toMatch(/Marked failed manually/);
  });
});
