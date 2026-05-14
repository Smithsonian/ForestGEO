/**
 * Integration tests for the heartbeat-based provisioning worker.
 *
 * Verifies:
 *   - `findStaleRunIds` selects only `running` rows whose heartbeat is null or
 *     older than HEARTBEAT_STALE_MS.
 *   - `pickupStaleRuns` returns the same set of IDs (we suppress the actual
 *     dispatch via a `setImmediate` no-op so the test doesn't trigger
 *     `runProvisioning` for real).
 *
 * The worker test deliberately avoids `vi.mock('@/lib/provisioning/orchestrator')`
 * because integration tests share a single fork (singleFork: true, isolate: false)
 * and a module-level mock here would leak into other suites that rely on the
 * real orchestrator.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { createTestPool, seedCatalogTables, clearProvisioningState, seedRun, TEST_SCHEMA_PREFIX } from './_shared';

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { findStaleRunIds, pickupStaleRuns, _resetForTests, HEARTBEAT_STALE_MS } from '@/lib/provisioning/worker';

const TEST_SCHEMA = TEST_SCHEMA_PREFIX + 'worker';
const FRESH_HEARTBEAT_AGE_SECONDS = 5;
const STALE_HEARTBEAT_AGE_SECONDS = 600;

describe('provisioning worker (integration)', () => {
  let testPool: Pool;
  let setImmediateSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    testPool = createTestPool();
    await seedCatalogTables(testPool);
    // Suppress the actual provisioning kickoff that `dispatchRun` triggers
    // through setImmediate. We only need to verify selection logic.
    setImmediateSpy = vi.spyOn(globalThis, 'setImmediate').mockImplementation(((_cb: any) => 0) as any);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    _resetForTests();
    await clearProvisioningState(testPool, TEST_SCHEMA);
  });

  afterAll(async () => {
    setImmediateSpy.mockRestore();
    _resetForTests();
    await clearProvisioningState(testPool, TEST_SCHEMA);
    await testPool.end();
  });

  it('findStaleRunIds returns a running run that has no heartbeat', async () => {
    const runId = await seedRun(testPool, TEST_SCHEMA, 'running');
    const ids = await findStaleRunIds(testPool);
    expect(ids).toContain(runId);
  });

  it('findStaleRunIds skips a running run with a fresh heartbeat', async () => {
    const runId = await seedRun(testPool, TEST_SCHEMA, 'running');
    await testPool.query(`UPDATE catalog.provisioning_runs SET WorkerHeartbeatAt = DATE_SUB(NOW(), INTERVAL ? SECOND) WHERE RunID = ?`, [
      FRESH_HEARTBEAT_AGE_SECONDS,
      runId
    ]);
    const ids = await findStaleRunIds(testPool);
    expect(ids).not.toContain(runId);
  });

  it(`findStaleRunIds picks up a running run whose heartbeat is older than ${HEARTBEAT_STALE_MS}ms`, async () => {
    const runId = await seedRun(testPool, TEST_SCHEMA, 'running');
    await testPool.query(`UPDATE catalog.provisioning_runs SET WorkerHeartbeatAt = DATE_SUB(NOW(), INTERVAL ? SECOND) WHERE RunID = ?`, [
      STALE_HEARTBEAT_AGE_SECONDS,
      runId
    ]);
    const ids = await findStaleRunIds(testPool);
    expect(ids).toContain(runId);
  });

  it('findStaleRunIds excludes completed, failed, and aborted runs', async () => {
    const completedId = await seedRun(testPool, TEST_SCHEMA + '_c', 'completed');
    const failedId = await seedRun(testPool, TEST_SCHEMA + '_f', 'failed');
    const abortedId = await seedRun(testPool, TEST_SCHEMA + '_a', 'aborted');

    const ids = await findStaleRunIds(testPool);
    expect(ids).not.toContain(completedId);
    expect(ids).not.toContain(failedId);
    expect(ids).not.toContain(abortedId);

    await testPool.query(`DELETE FROM catalog.sites WHERE SchemaName LIKE ?`, [TEST_SCHEMA + '_%']);
  });

  it('pickupStaleRuns returns the same IDs as findStaleRunIds (stale runs picked, fresh skipped)', async () => {
    const staleRunId = await seedRun(testPool, TEST_SCHEMA, 'running');
    const freshRunId = await seedRun(testPool, TEST_SCHEMA + '_fresh', 'running');
    await testPool.query(`UPDATE catalog.provisioning_runs SET WorkerHeartbeatAt = NOW() WHERE RunID = ?`, [freshRunId]);

    const picked = await pickupStaleRuns(testPool);

    expect(picked).toContain(staleRunId);
    expect(picked).not.toContain(freshRunId);

    await testPool.query(`DELETE FROM catalog.sites WHERE SchemaName LIKE ?`, [TEST_SCHEMA + '_%']);
  });
});
