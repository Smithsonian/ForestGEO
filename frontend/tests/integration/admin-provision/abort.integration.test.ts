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

import { POST } from '@/app/api/admin/provision/[runId]/abort/route';

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

    const [relations]: any = await testPool.query(`SELECT * FROM catalog.usersiterelations`);
    expect(relations).toHaveLength(0);

    const [schemas]: any = await testPool.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?`, [TEST_SCHEMA]);
    expect(schemas).toHaveLength(0);
  });
});
