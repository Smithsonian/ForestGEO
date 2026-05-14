/**
 * Integration tests for POST /api/admin/provision/[runId]/reconcile.
 *
 * Reconciliation transitions a 'running' run to 'failed' when:
 *   - the run is idle past STUCK_THRESHOLD_MS (5 minutes), and
 *   - there is no actively-running step.
 *
 * The complementary regression that GET /api/admin/provision/[runId] does NOT
 * mutate catalog rows (Task 6 moved reconciliation out of GET) is asserted in
 * get.integration.test.ts to avoid cross-file vi.mock registry collisions
 * inherent to the single-fork, isolate:false vitest config.
 *
 * We seed stale rows by backdating StartedAt via DATE_SUB(NOW(), INTERVAL N
 * SECOND) so the host/MySQL timezone offset cannot skew the apparent age.
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

import { POST } from '@/app/api/admin/provision/[runId]/reconcile/route';

const TEST_SCHEMA = TEST_SCHEMA_PREFIX + 'reconcile';
const URL_FOR = (runId: string) => `http://test/api/admin/provision/${runId}/reconcile`;
const STALE_SECONDS = 600;

describe('POST /api/admin/provision/[runId]/reconcile (integration)', () => {
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

  it('returns reconciled:false for a missing run (orchestrator returns false rather than throwing)', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const res = await POST(makeRequest(URL_FOR('999999'), { method: 'POST' }), makeParams('999999'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reconciled).toBe(false);
  });

  it('marks an idle stale running run as failed and returns reconciled:true', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const runId = await seedRun(testPool, TEST_SCHEMA, 'running');
    // Pending step that has been idle past the 5-minute threshold.
    await seedSteps(testPool, runId, [{ stepIndex: 0, stepKey: 'validate_inputs', status: 'pending', startedAtSecondsAgo: STALE_SECONDS }]);
    // Backdate the run's StartedAt so the idle-age query sees the row as stale.
    await testPool.query(`UPDATE catalog.provisioning_runs SET StartedAt = DATE_SUB(NOW(), INTERVAL ? SECOND) WHERE RunID = ?`, [STALE_SECONDS, runId]);

    const res = await POST(makeRequest(URL_FOR(String(runId)), { method: 'POST' }), makeParams(runId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reconciled).toBe(true);

    const [runs]: any = await testPool.query(`SELECT Status, FinishedAt FROM catalog.provisioning_runs WHERE RunID = ?`, [runId]);
    expect(runs[0].Status).toBe('failed');
    expect(runs[0].FinishedAt).not.toBeNull();

    const [steps]: any = await testPool.query(`SELECT Status, ErrorMessage FROM catalog.provisioning_steps WHERE RunID = ?`, [runId]);
    expect(steps[0].Status).toBe('failed');
    expect(steps[0].ErrorMessage).not.toBeNull();
  });

  it('returns reconciled:false for a recently-active running run', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const runId = await seedRun(testPool, TEST_SCHEMA, 'running');
    await testPool.query(`UPDATE catalog.provisioning_runs SET WorkerHeartbeatAt = NOW() WHERE RunID = ?`, [runId]);
    await seedSteps(testPool, runId, [{ stepIndex: 0, stepKey: 'validate_inputs', status: 'running', startedAtSecondsAgo: 1 }]);

    const res = await POST(makeRequest(URL_FOR(String(runId)), { method: 'POST' }), makeParams(runId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reconciled).toBe(false);

    const [runs]: any = await testPool.query(`SELECT Status FROM catalog.provisioning_runs WHERE RunID = ?`, [runId]);
    expect(runs[0].Status).toBe('running');
  });

  it('returns reconciled:false for a non-running run (e.g. already completed)', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const runId = await seedRun(testPool, TEST_SCHEMA, 'completed');

    const res = await POST(makeRequest(URL_FOR(String(runId)), { method: 'POST' }), makeParams(runId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reconciled).toBe(false);
  });
});
