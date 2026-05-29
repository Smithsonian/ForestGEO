/**
 * Integration tests for GET /api/admin/provision/list.
 *
 * The route returns all provisioning runs ordered by StartedAt DESC, sets
 * Cache-Control: no-store, and is gated on global-admin auth.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { createTestPool, seedCatalogTables, clearProvisioningState, makeRequest, GLOBAL_SESSION, DB_ADMIN_SESSION, TEST_SCHEMA_PREFIX } from './_shared';

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

import { GET } from '@/app/api/admin/provision/list/route';

const SCHEMA_OLDEST = TEST_SCHEMA_PREFIX + 'list_oldest';
const SCHEMA_MIDDLE = TEST_SCHEMA_PREFIX + 'list_middle';
const SCHEMA_NEWEST = TEST_SCHEMA_PREFIX + 'list_newest';
const URL_FOR = 'http://test/api/admin/provision/list';

describe('GET /api/admin/provision/list (integration)', () => {
  beforeAll(async () => {
    testPool = createTestPool();
    await seedCatalogTables(testPool);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await testPool.query(`DELETE FROM catalog.provisioning_steps`);
    await testPool.query(`DELETE FROM catalog.provisioning_runs`);
    await testPool.query(`DELETE FROM catalog.sites WHERE SchemaName LIKE ?`, [TEST_SCHEMA_PREFIX + 'list_%']);
  });

  afterAll(async () => {
    await clearProvisioningState(testPool);
    await testPool.end();
  });

  it('returns 401 when there is no session', async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await GET(makeRequest(URL_FOR));
    expect(res.status).toBe(401);
  });

  it('returns 403 for a db-admin session', async () => {
    mocks.auth.mockResolvedValue(DB_ADMIN_SESSION);
    const res = await GET(makeRequest(URL_FOR));
    expect(res.status).toBe(403);
  });

  it('returns 200 with an empty array when there are no runs and sets Cache-Control: no-store', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const res = await GET(makeRequest(URL_FOR));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('returns all runs ordered by StartedAt DESC for a global admin', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);
    const oldestStartedAt = new Date(Date.now() - 60 * 60 * 1000);
    const middleStartedAt = new Date(Date.now() - 30 * 60 * 1000);
    const newestStartedAt = new Date();
    await testPool.query(
      `INSERT INTO catalog.provisioning_runs (Status, StartedBy, StartedAt, SiteName, SchemaName, InputPayload) VALUES (?, ?, ?, ?, ?, JSON_OBJECT())`,
      ['completed', 'admin@test', oldestStartedAt, 'Site Old', SCHEMA_OLDEST]
    );
    await testPool.query(
      `INSERT INTO catalog.provisioning_runs (Status, StartedBy, StartedAt, SiteName, SchemaName, InputPayload) VALUES (?, ?, ?, ?, ?, JSON_OBJECT())`,
      ['failed', 'admin@test', middleStartedAt, 'Site Middle', SCHEMA_MIDDLE]
    );
    await testPool.query(
      `INSERT INTO catalog.provisioning_runs (Status, StartedBy, StartedAt, SiteName, SchemaName, InputPayload) VALUES (?, ?, ?, ?, ?, JSON_OBJECT())`,
      ['running', 'admin@test', newestStartedAt, 'Site New', SCHEMA_NEWEST]
    );

    const res = await GET(makeRequest(URL_FOR));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(3);
    expect(body[0].SchemaName).toBe(SCHEMA_NEWEST);
    expect(body[1].SchemaName).toBe(SCHEMA_MIDDLE);
    expect(body[2].SchemaName).toBe(SCHEMA_OLDEST);
  });
});
