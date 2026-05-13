/**
 * Integration tests for POST /api/admin/provision/[runId]/retry.
 *
 * Retry resets failed/pending steps back to 'pending' and flips the run row
 * back to 'running'. The route also schedules `runProvisioning` via
 * setImmediate — we no-op that here so we observe only the synchronous SQL
 * mutations the route performs inline.
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

import { POST } from '@/app/api/admin/provision/[runId]/retry/route';

const TEST_SCHEMA = TEST_SCHEMA_PREFIX + 'retry';
const URL_FOR = (runId: string) => `http://test/api/admin/provision/${runId}/retry`;

describe('POST /api/admin/provision/[runId]/retry (integration)', () => {
  let setImmediateSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    testPool = createTestPool();
    await seedCatalogTables(testPool);
    setImmediateSpy = vi.spyOn(globalThis, 'setImmediate').mockImplementation(((_cb: any) => 0) as any);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await clearProvisioningState(testPool, TEST_SCHEMA);
  });

  afterAll(async () => {
    setImmediateSpy.mockRestore();
    await clearProvisioningState(testPool, TEST_SCHEMA);
    await testPool.end();
  });

  it('returns 401 when there is no session', async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await POST(makeRequest(URL_FOR('7'), { method: 'POST' }), makeParams('7'));
    expect(res.status).toBe(401);
  });

  it('returns 403 for a db-admin session', async () => {
    mocks.auth.mockResolvedValue(DB_ADMIN_SESSION);
    const res = await POST(makeRequest(URL_FOR('7'), { method: 'POST' }), makeParams('7'));
    expect(res.status).toBe(403);
  });

  it('returns 400 when runId is non-numeric', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const res = await POST(makeRequest(URL_FOR('abc'), { method: 'POST' }), makeParams('abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when runId has trailing characters', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const res = await POST(makeRequest(URL_FOR('7abc'), { method: 'POST' }), makeParams('7abc'));
    expect(res.status).toBe(400);
  });

  it('returns 404 with kind=not_found for a missing run', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const res = await POST(makeRequest(URL_FOR('999999'), { method: 'POST' }), makeParams('999999'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.kind).toBe('not_found');
  });

  it('returns 409 with kind=conflict when the run status is not failed', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const runId = await seedRun(testPool, TEST_SCHEMA, 'running');

    const res = await POST(makeRequest(URL_FOR(String(runId)), { method: 'POST' }), makeParams(runId));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.kind).toBe('conflict');
  });

  it('resets failed steps to pending and flips run back to running for a failed run', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const runId = await seedRun(testPool, TEST_SCHEMA, 'failed');
    await seedSteps(testPool, runId, [
      { stepIndex: 0, stepKey: 'validate_inputs', status: 'completed', startedAt: new Date(), finishedAt: new Date() },
      { stepIndex: 1, stepKey: 'create_schema', status: 'failed', startedAt: new Date(), finishedAt: new Date(), errorMessage: 'boom' }
    ]);

    const res = await POST(makeRequest(URL_FOR(String(runId)), { method: 'POST' }), makeParams(runId));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    const [runs]: any = await testPool.query(`SELECT Status, FinishedAt FROM catalog.provisioning_runs WHERE RunID = ?`, [runId]);
    expect(runs[0].Status).toBe('running');
    expect(runs[0].FinishedAt).toBeNull();

    const [steps]: any = await testPool.query(`SELECT StepIndex, Status, ErrorMessage FROM catalog.provisioning_steps WHERE RunID = ? ORDER BY StepIndex`, [
      runId
    ]);
    expect(steps[0].Status).toBe('completed');
    expect(steps[1].Status).toBe('pending');
    expect(steps[1].ErrorMessage).toBeNull();
  });
});
