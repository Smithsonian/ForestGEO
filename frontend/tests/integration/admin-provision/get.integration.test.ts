/**
 * Integration tests for GET /api/admin/provision/[runId].
 *
 * Verifies auth gating, runId parsing, and that the route assembles
 * { run, steps, stuckStepIndex } from real catalog rows. Also checks the
 * Cache-Control: no-store header and that errorStack is stripped from response
 * step payloads (it lives in the row but must not leak to clients).
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

import { GET } from '@/app/api/admin/provision/[runId]/route';

const TEST_SCHEMA = TEST_SCHEMA_PREFIX + 'get';
const GET_URL = (runId: string) => `http://test/api/admin/provision/${runId}`;

describe('GET /api/admin/provision/[runId] (integration)', () => {
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
    const res = await GET(makeRequest(GET_URL('7')), makeParams('7'));
    expect(res.status).toBe(401);
  });

  it('returns 403 for a db-admin session', async () => {
    mocks.auth.mockResolvedValue(DB_ADMIN_SESSION);
    const res = await GET(makeRequest(GET_URL('7')), makeParams('7'));
    expect(res.status).toBe(403);
  });

  it('returns 400 when runId is non-numeric', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const res = await GET(makeRequest(GET_URL('abc')), makeParams('abc'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when runId is zero', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const res = await GET(makeRequest(GET_URL('0')), makeParams('0'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when runId has trailing characters', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const res = await GET(makeRequest(GET_URL('7abc')), makeParams('7abc'));
    expect(res.status).toBe(400);
  });

  it('returns 404 with kind=not_found for a missing run', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const res = await GET(makeRequest(GET_URL('999999')), makeParams('999999'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.kind).toBe('not_found');
  });

  it('returns 200 with run, steps, stuckStepIndex=null when all steps are completed and sets Cache-Control: no-store', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const runId = await seedRun(testPool, TEST_SCHEMA, 'completed');
    await seedSteps(testPool, runId, [
      { stepIndex: 0, stepKey: 'validate_inputs', status: 'completed', startedAt: new Date(Date.now() - 60_000), finishedAt: new Date(Date.now() - 50_000) },
      { stepIndex: 1, stepKey: 'create_schema', status: 'completed', startedAt: new Date(Date.now() - 50_000), finishedAt: new Date(Date.now() - 40_000) }
    ]);

    const res = await GET(makeRequest(GET_URL(String(runId))), makeParams(runId));

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.run.runId).toBe(runId);
    expect(body.run.status).toBe('completed');
    expect(body.steps).toHaveLength(2);
    expect(body.stuckStepIndex).toBeNull();
  });

  it('strips errorStack from each step in the response body even when present in DB', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const runId = await seedRun(testPool, TEST_SCHEMA, 'failed');
    await seedSteps(testPool, runId, [
      {
        stepIndex: 0,
        stepKey: 'validate_inputs',
        status: 'failed',
        startedAt: new Date(),
        finishedAt: new Date(),
        errorMessage: 'boom'
      }
    ]);
    // Inject an errorStack value into the catalog row so we can prove the route strips it.
    await testPool.query(`UPDATE catalog.provisioning_steps SET ErrorStack = ? WHERE RunID = ?`, ['Error: boom\n  at line 1', runId]);

    const res = await GET(makeRequest(GET_URL(String(runId))), makeParams(runId));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0]).not.toHaveProperty('errorStack');
    expect(body.steps[0].errorMessage).toBe('boom');
  });

  it('returns stuckStepIndex equal to the index of a step running longer than the stuck threshold', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const runId = await seedRun(testPool, TEST_SCHEMA, 'running');
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    await seedSteps(testPool, runId, [
      { stepIndex: 0, stepKey: 'validate_inputs', status: 'completed', startedAt: tenMinutesAgo, finishedAt: new Date(Date.now() - 8 * 60 * 1000) },
      { stepIndex: 1, stepKey: 'create_schema', status: 'running', startedAt: tenMinutesAgo }
    ]);

    const res = await GET(makeRequest(GET_URL(String(runId))), makeParams(runId));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.stuckStepIndex).toBe(1);
  });

  // Task 6: reconciliation moved to a separate POST endpoint. GET must be
  // read-only — even when the run is stale enough that the old inline call
  // would have flipped it to 'failed'. We seed a stale, idle running run,
  // snapshot the catalog rows, call GET, then assert the rows are byte-equal.
  it('does not mutate provisioning_runs or provisioning_steps when called against a stale running run', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const staleSeconds = 600;
    const runId = await seedRun(testPool, TEST_SCHEMA, 'running');
    await seedSteps(testPool, runId, [{ stepIndex: 0, stepKey: 'validate_inputs', status: 'pending', startedAtSecondsAgo: staleSeconds }]);
    await testPool.query(`UPDATE catalog.provisioning_runs SET StartedAt = DATE_SUB(NOW(), INTERVAL ? SECOND) WHERE RunID = ?`, [staleSeconds, runId]);

    const [runBefore]: any = await testPool.query(`SELECT * FROM catalog.provisioning_runs WHERE RunID = ?`, [runId]);
    const [stepsBefore]: any = await testPool.query(`SELECT * FROM catalog.provisioning_steps WHERE RunID = ? ORDER BY StepIndex`, [runId]);

    const res = await GET(makeRequest(GET_URL(String(runId))), makeParams(runId));
    expect(res.status).toBe(200);

    const [runAfter]: any = await testPool.query(`SELECT * FROM catalog.provisioning_runs WHERE RunID = ?`, [runId]);
    const [stepsAfter]: any = await testPool.query(`SELECT * FROM catalog.provisioning_steps WHERE RunID = ? ORDER BY StepIndex`, [runId]);

    expect(runAfter[0].Status).toBe(runBefore[0].Status);
    expect(runAfter[0].Status).toBe('running');
    expect(runAfter[0].FinishedAt).toEqual(runBefore[0].FinishedAt);
    expect(stepsAfter).toEqual(stepsBefore);
  });
});
