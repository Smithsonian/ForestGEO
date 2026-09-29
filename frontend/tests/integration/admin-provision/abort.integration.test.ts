/**
 * Integration tests for POST /api/admin/provision/[runId]/abort.
 *
 * Abort is only valid on a failed run. It drops the schema and removes the
 * catalog.sites + catalog.usersiterelations rows, then flips the run row to
 * 'aborted'.
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
vi.mock('@/lib/db/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: () => ({ pool: testPool, getUsablePool: async () => testPool })
}));

import { POST } from '@/app/api/admin/provision/[runId]/abort/route';
import { abortRun, retryRun } from '@/lib/provisioning/orchestrator';
import { releaseSchemaOperationLock, tryAcquireSchemaOperationLock } from '@/lib/provisioning/schema-operation-lock';

const TEST_SCHEMA = TEST_SCHEMA_PREFIX + 'abort';
const URL_FOR = (runId: string) => `http://test/api/admin/provision/${runId}/abort`;

describe('POST /api/admin/provision/[runId]/abort (integration)', () => {
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

  it('returns 400 when runId is zero', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const res = await POST(makeRequest(URL_FOR('0'), { method: 'POST' }), makeParams('0'));
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

  it('drops the schema, removes catalog rows, and flips the run to aborted for a failed run', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const runId = await seedRun(testPool, TEST_SCHEMA, 'failed', { createSchema: true });
    await seedSteps(testPool, runId, [
      { stepIndex: 0, stepKey: 'validate_inputs', status: 'completed' },
      { stepIndex: 1, stepKey: 'create_schema', status: 'completed' },
      { stepIndex: 6, stepKey: 'insert_plot', status: 'failed', errorMessage: 'Data too long for column PlotDescription' }
    ]);
    const [siteRows]: any = await testPool.query(`SELECT SiteID FROM catalog.sites WHERE SchemaName = ?`, [TEST_SCHEMA]);
    await testPool.query(`INSERT INTO catalog.usersiterelations (UserID, SiteID) VALUES (1, ?)`, [siteRows[0].SiteID]);

    const res = await POST(makeRequest(URL_FOR(String(runId)), { method: 'POST' }), makeParams(runId));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    const [runs]: any = await testPool.query(`SELECT Status, FinishedAt FROM catalog.provisioning_runs WHERE RunID = ?`, [runId]);
    expect(runs[0].Status).toBe('aborted');
    expect(runs[0].FinishedAt).not.toBeNull();

    const [sites]: any = await testPool.query(`SELECT * FROM catalog.sites WHERE SchemaName = ?`, [TEST_SCHEMA]);
    expect(sites).toHaveLength(0);

    const [relations]: any = await testPool.query(`SELECT * FROM catalog.usersiterelations WHERE SiteID = ?`, [siteRows[0].SiteID]);
    expect(relations).toHaveLength(0);

    const [schemas]: any = await testPool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?`, [TEST_SCHEMA]);
    expect(schemas).toHaveLength(0);
  });

  it('closes the run but keeps the schema and catalog row when the run failed validate_inputs on a schema it never created', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const runId = await seedRun(testPool, TEST_SCHEMA, 'failed', { createSchema: true });
    await seedSteps(testPool, runId, [
      { stepIndex: 0, stepKey: 'validate_inputs', status: 'failed', errorMessage: `A catalog site already references schema "${TEST_SCHEMA}"` },
      { stepIndex: 1, stepKey: 'create_schema', status: 'pending' }
    ]);

    const res = await POST(makeRequest(URL_FOR(String(runId)), { method: 'POST' }), makeParams(runId));

    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    const [runs]: any = await testPool.query(`SELECT Status FROM catalog.provisioning_runs WHERE RunID = ?`, [runId]);
    expect(runs[0].Status).toBe('aborted');
    const [sites]: any = await testPool.query(`SELECT * FROM catalog.sites WHERE SchemaName = ?`, [TEST_SCHEMA]);
    expect(sites, `catalog.sites row for ${TEST_SCHEMA} belongs to another run and must survive`).toHaveLength(1);
    const [schemas]: any = await testPool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?`, [TEST_SCHEMA]);
    expect(schemas, `schema ${TEST_SCHEMA} belongs to another run and must survive`).toHaveLength(1);
  });

  it('preserves partial creation without a successful creation record', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const runId = await seedRun(testPool, TEST_SCHEMA, 'failed', { createSchema: true });
    await seedSteps(testPool, runId, [
      { stepIndex: 0, stepKey: 'validate_inputs', status: 'completed' },
      { stepIndex: 1, stepKey: 'create_schema', status: 'failed' }
    ]);
    await abortRun(runId, testPool, 'admin@test');
    const [schemas]: any = await testPool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?`, [TEST_SCHEMA]);
    expect(schemas).toHaveLength(1);
    expect(mocks.ailogger.info).toHaveBeenCalledWith(
      expect.stringContaining('ownership is not established'),
      expect.objectContaining({ recordedCreation: false })
    );
  });

  it.each(['running', 'completed', 'failed', 'aborted'] as const)('preserves a later %s run despite the older run recording creation', async status => {
    const runId = await seedRun(testPool, TEST_SCHEMA, 'failed', { insertSiteRow: false });
    await seedSteps(testPool, runId, [
      { stepIndex: 0, stepKey: 'validate_inputs', status: 'completed' },
      { stepIndex: 1, stepKey: 'create_schema', status: 'completed' }
    ]);
    const successorId = await seedRun(testPool, TEST_SCHEMA, status, { createSchema: true });
    await seedSteps(testPool, successorId, [{ stepIndex: 0, stepKey: 'validate_inputs', status: 'completed' }]);

    await abortRun(runId, testPool, 'admin@test');

    const [schemas]: any = await testPool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?`, [TEST_SCHEMA]);
    expect(schemas).toHaveLength(1);
    const [sites]: any = await testPool.query(`SELECT SiteID FROM catalog.sites WHERE SchemaName = ?`, [TEST_SCHEMA]);
    expect(sites).toHaveLength(1);
    const [runs]: any = await testPool.query(`SELECT Status FROM catalog.provisioning_runs WHERE RunID = ?`, [runId]);
    expect(runs[0].Status).toBe('aborted');
  });

  it('still cleans up its own artifacts after a later run fails validation on them', async () => {
    const runId = await seedRun(testPool, TEST_SCHEMA, 'failed', { createSchema: true });
    await seedSteps(testPool, runId, [
      { stepIndex: 0, stepKey: 'validate_inputs', status: 'completed' },
      { stepIndex: 1, stepKey: 'create_schema', status: 'completed' }
    ]);
    const laterId = await seedRun(testPool, TEST_SCHEMA, 'failed', { insertSiteRow: false });
    await seedSteps(testPool, laterId, [{ stepIndex: 0, stepKey: 'validate_inputs', status: 'failed' }]);

    await abortRun(runId, testPool, 'admin@test');

    const [schemas]: any = await testPool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?`, [TEST_SCHEMA]);
    expect(schemas).toHaveLength(0);
    const [sites]: any = await testPool.query(`SELECT SiteID FROM catalog.sites WHERE SchemaName = ?`, [TEST_SCHEMA]);
    expect(sites).toHaveLength(0);
  });

  it('preserves an older failed run with a competing creation record because retry order can differ from run order', async () => {
    const earlierId = await seedRun(testPool, TEST_SCHEMA, 'failed', { createSchema: true });
    const runId = await seedRun(testPool, TEST_SCHEMA, 'failed', { insertSiteRow: false });
    for (const id of [earlierId, runId]) {
      await seedSteps(testPool, id, [
        { stepIndex: 0, stepKey: 'validate_inputs', status: 'completed' },
        { stepIndex: 1, stepKey: 'create_schema', status: 'completed' }
      ]);
    }
    await abortRun(runId, testPool, 'admin@test');
    const [schemas]: any = await testPool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?`, [TEST_SCHEMA]);
    expect(schemas).toHaveLength(1);
    const [sites]: any = await testPool.query(`SELECT SiteID FROM catalog.sites WHERE SchemaName = ?`, [TEST_SCHEMA]);
    expect(sites).toHaveLength(1);
  });

  it.each([
    { action: 'abort', invoke: abortRun, nextStatus: 'running' },
    { action: 'retry', invoke: retryRun, nextStatus: 'aborted' }
  ] as const)('$action rechecks the run after waiting for the schema lock', async ({ invoke, nextStatus }) => {
    const runId = await seedRun(testPool, TEST_SCHEMA, 'failed', { createSchema: true });
    await seedSteps(testPool, runId, [
      { stepIndex: 0, stepKey: 'validate_inputs', status: 'completed' },
      { stepIndex: 1, stepKey: 'create_schema', status: 'completed' }
    ]);
    const blocker = await testPool.getConnection();
    const actionConnection = await testPool.getConnection();
    let signalLockAttempt!: () => void;
    const lockAttempted = new Promise<void>(resolve => {
      signalLockAttempt = resolve;
    });
    const query = actionConnection.query.bind(actionConnection);
    vi.spyOn(actionConnection, 'query').mockImplementation(((sql: string, ...args: unknown[]) => {
      if (sql.includes('GET_LOCK')) signalLockAttempt();
      return (query as (...params: unknown[]) => unknown)(sql, ...args);
    }) as typeof actionConnection.query);
    vi.spyOn(testPool, 'getConnection').mockResolvedValueOnce(actionConnection);
    let attempt: Promise<unknown> | undefined;
    try {
      expect(await tryAcquireSchemaOperationLock(blocker, TEST_SCHEMA)).toBe(true);
      attempt = invoke(runId, testPool, 'admin@test').then(
        () => null,
        error => error
      );
      await lockAttempted;
      await blocker.query(`UPDATE catalog.provisioning_runs SET Status = ? WHERE RunID = ?`, [nextStatus, runId]);
      await releaseSchemaOperationLock(blocker, TEST_SCHEMA);
      expect(await attempt).toMatchObject({ kind: 'conflict' });
      const [schemas]: any = await testPool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?`, [TEST_SCHEMA]);
      expect(schemas).toHaveLength(1);
      const [runs]: any = await testPool.query(`SELECT Status FROM catalog.provisioning_runs WHERE RunID = ?`, [runId]);
      expect(runs[0].Status).toBe(nextStatus);
    } finally {
      await releaseSchemaOperationLock(blocker, TEST_SCHEMA);
      blocker.release();
      await attempt;
    }
  });
});
