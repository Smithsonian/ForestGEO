/**
 * Integration tests for POST /api/admin/provision.
 *
 * Verifies the route's auth, validation, and transactional DB-write behavior
 * against a real catalog. The orchestrator dispatches the run via
 * `worker.dispatchRun`, which schedules the actual work through `setImmediate`.
 * The test mocks `setImmediate` to a no-op so we observe only the synchronous
 * insert-runs-and-steps work that `startRun` does inline.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import {
  createTestPool,
  seedCatalogTables,
  clearProvisioningState,
  makeRequest,
  GLOBAL_SESSION,
  DB_ADMIN_SESSION,
  FIELD_CREW_SESSION,
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

import { POST } from '@/app/api/admin/provision/route';

const TEST_SCHEMA = TEST_SCHEMA_PREFIX + 'start';
const POST_URL = 'http://test/api/admin/provision';

function buildValidInput(schemaName: string) {
  return {
    site: {
      siteName: 'Test Site',
      schemaName,
      sqDimX: 20,
      sqDimY: 20,
      defaultUOMDBH: 'cm',
      defaultUOMHOM: 'm',
      doubleDataEntry: false,
      location: 'Panama',
      country: 'PA'
    },
    plot: {
      plotName: 'P1',
      dimensionX: 100,
      dimensionY: 100,
      area: 10000,
      globalX: 0,
      globalY: 0,
      globalZ: 0,
      plotShape: 'square' as const,
      description: 'test',
      defaultDimensionUnits: 'm',
      defaultCoordinateUnits: 'm',
      defaultAreaUnits: 'm2',
      defaultDBHUnits: 'cm',
      defaultHOMUnits: 'm'
    },
    quadrats: { mode: 'grid' as const, quadratSizeX: 20, quadratSizeY: 20, namingPattern: 'sequential' as const }
  };
}

describe('POST /api/admin/provision (integration)', () => {
  let setImmediateSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    testPool = createTestPool();
    await seedCatalogTables(testPool);
    // Prevent the orchestrator's background runProvisioning kickoff from
    // actually executing — we only need to verify the synchronous catalog
    // insertions that startRun performs inline before `dispatchRun` schedules
    // the real work through setImmediate.
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

    const res = await POST(makeRequest(POST_URL, { method: 'POST', body: buildValidInput(TEST_SCHEMA) }));

    expect(res.status).toBe(401);
    const [runs]: any = await testPool.query(`SELECT * FROM catalog.provisioning_runs WHERE SchemaName = ?`, [TEST_SCHEMA]);
    expect(runs).toHaveLength(0);
  });

  it('returns 403 for a db-admin session', async () => {
    mocks.auth.mockResolvedValue(DB_ADMIN_SESSION);

    const res = await POST(makeRequest(POST_URL, { method: 'POST', body: buildValidInput(TEST_SCHEMA) }));

    expect(res.status).toBe(403);
    const [runs]: any = await testPool.query(`SELECT * FROM catalog.provisioning_runs WHERE SchemaName = ?`, [TEST_SCHEMA]);
    expect(runs).toHaveLength(0);
  });

  it('returns 403 for a field-crew session', async () => {
    mocks.auth.mockResolvedValue(FIELD_CREW_SESSION);

    const res = await POST(makeRequest(POST_URL, { method: 'POST', body: buildValidInput(TEST_SCHEMA) }));

    expect(res.status).toBe(403);
  });

  it('returns 400 when the request body is not valid JSON', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await POST(makeRequest(POST_URL, { method: 'POST', rawBody: 'not valid json {{{' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 with a structured errors array on zod validation failure', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await POST(makeRequest(POST_URL, { method: 'POST', body: { site: {} } }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0]).toHaveProperty('field');
    expect(body.errors[0]).toHaveProperty('message');
  });

  it('inserts the run row, all step rows, and returns 202 with runId for a global admin', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const res = await POST(makeRequest(POST_URL, { method: 'POST', body: buildValidInput(TEST_SCHEMA) }));

    expect(res.status).toBe(202);
    const { runId } = await res.json();
    expect(typeof runId).toBe('number');

    const [runs]: any = await testPool.query(`SELECT * FROM catalog.provisioning_runs WHERE RunID = ?`, [runId]);
    expect(runs).toHaveLength(1);
    expect(runs[0].Status).toBe('running');
    expect(runs[0].StartedBy).toBe('admin@test');
    expect(runs[0].SchemaName).toBe(TEST_SCHEMA);

    const [steps]: any = await testPool.query(`SELECT * FROM catalog.provisioning_steps WHERE RunID = ? ORDER BY StepIndex`, [runId]);
    expect(steps.length).toBeGreaterThanOrEqual(8);
    expect(steps.every((s: any) => s.Status === 'pending')).toBe(true);
    expect(steps[0].StepKey).toBe('validate_inputs');
  });

  it('returns 409 with kind=conflict on a second concurrent start for the same schema', async () => {
    mocks.auth.mockResolvedValue(GLOBAL_SESSION);

    const first = await POST(makeRequest(POST_URL, { method: 'POST', body: buildValidInput(TEST_SCHEMA) }));
    expect(first.status).toBe(202);

    const second = await POST(makeRequest(POST_URL, { method: 'POST', body: buildValidInput(TEST_SCHEMA) }));
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.kind).toBe('conflict');
    expect(body.error).toMatch(/already in progress/);
  });
});
