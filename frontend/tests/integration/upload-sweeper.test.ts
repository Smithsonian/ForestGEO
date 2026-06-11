/**
 * Upload-Job Sweeper — Integration Tests
 *
 * Exercises sweepOnce's stale-lease reclaim and runnable-job dispatch against
 * a real MySQL catalog. Dispatch is stubbed via SweepDeps — the worker
 * pipeline never runs here; only the catalog transitions are under test.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/upload-sweeper.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql, { type Pool } from 'mysql2/promise';
import { ensureBackgroundJobCatalogTables } from '@/lib/background-jobs/catalog';
import { createUploadBackgroundJob, getBackgroundJob, getBackgroundJobWithDetails } from '@/lib/background-jobs/repository';
import { startUploadJobSweeper, stopUploadJobSweeper, sweepOnce, type SweepDeps } from '@/lib/background-jobs/sweeper';
import type { CreateUploadJobInput } from '@/lib/background-jobs/types';
import { UPLOAD_JOB_MAX_RETRIES } from '@/lib/background-jobs/types';

// ---------------------------------------------------------------------------
// Safety guard — this suite DELETEs from the shared `catalog` schema and must
// never run against a remote database.
// ---------------------------------------------------------------------------

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';

if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(
    `[upload-sweeper] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite deletes all rows from catalog.background_jobs and must only run against a local test database.`
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_DB_PORT = Number(process.env.TEST_DB_PORT || 3306);
const TEST_DB_USER = process.env.TEST_DB_USER || 'root';
const TEST_DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'testpassword';

const TEST_USER = 'sweeper-tester@forestgeo.test';
const TEST_SCHEMA = 'forestgeo_testing_sweeper';
const TEST_PLOT_ID = 1;
const TEST_CENSUS_ID = 2;
const BLOB_CONTAINER = 'forestgeo-testing-storage';

const DEAD_WORKER_ID = 'sweeper-test-dead-worker';

/** 5 minutes — comfortably beyond the 90s stale-lease threshold (3 × 30s heartbeat). */
const STALE_HEARTBEAT_AGE_SECONDS = 300;
/** 10 seconds — comfortably within the stale-lease threshold. */
const FRESH_HEARTBEAT_AGE_SECONDS = 10;
/** Past-due waiting_retry: NextAttemptAt one minute ago. */
const PAST_DUE_OFFSET_SECONDS = 60;
/** Not-yet-due waiting_retry: NextAttemptAt one hour from now. */
const FUTURE_DUE_OFFSET_SECONDS = 3600;

/** Must match the sentinel key in lib/background-jobs/sweeper.ts. */
const SWEEPER_SENTINEL = Symbol.for('forestgeo.uploadJobSweeper');

// ---------------------------------------------------------------------------
// Pool lifecycle and row cleanup
// ---------------------------------------------------------------------------

let pool: Pool;

beforeAll(async () => {
  pool = mysql.createPool({
    host: TEST_DB_HOST,
    port: TEST_DB_PORT,
    user: TEST_DB_USER,
    password: TEST_DB_PASSWORD,
    connectionLimit: 5
  });
  await ensureBackgroundJobCatalogTables(pool);
  console.log('[upload-sweeper] catalog tables ensured');
});

afterAll(async () => {
  if (pool) await pool.end();
});

beforeEach(async () => {
  // Delete in FK-safe order: events → files → jobs.
  await pool.query(`DELETE FROM catalog.background_job_events`);
  await pool.query(`DELETE FROM catalog.background_job_files`);
  await pool.query(`DELETE FROM catalog.background_jobs`);
  console.log('[upload-sweeper] catalog rows cleared');
});

afterEach(() => {
  // Never leak a live interval between tests.
  stopUploadJobSweeper();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJobInput(fileName: string, overrides: Partial<CreateUploadJobInput> = {}): CreateUploadJobInput {
  return {
    schema: TEST_SCHEMA,
    plotID: TEST_PLOT_ID,
    censusID: TEST_CENSUS_ID,
    uploadMode: 'clean_reupload',
    sourceFormat: 'csv',
    formType: 'measurements',
    files: [
      {
        fileName,
        blobContainer: BLOB_CONTAINER,
        blobName: `uploads/sweeper-test/${fileName}`,
        contentType: 'text/csv',
        expectedRows: 10
      }
    ],
    ...overrides
  };
}

async function seedQueuedJob(fileName: string): Promise<number> {
  const job = await createUploadBackgroundJob(pool, makeJobInput(fileName), TEST_USER);
  console.log(`[seed] queued jobID=${job.jobID} (${fileName})`);
  return job.jobID;
}

async function seedRunningJob(fileName: string, heartbeatAgeSeconds: number, retryCount: number): Promise<number> {
  const jobID = await seedQueuedJob(fileName);
  await pool.query(
    `UPDATE catalog.background_jobs
     SET Status = 'running', Phase = 'staging', WorkerID = ?, StartedAt = NOW(),
         WorkerHeartbeatAt = NOW() - INTERVAL ? SECOND, RetryCount = ?
     WHERE JobID = ?`,
    [DEAD_WORKER_ID, heartbeatAgeSeconds, retryCount, jobID]
  );
  console.log(`[seed] jobID=${jobID} → running, heartbeat ${heartbeatAgeSeconds}s old, retryCount=${retryCount}`);
  return jobID;
}

async function seedWaitingRetryJob(fileName: string, nextAttemptOffsetSeconds: number): Promise<number> {
  const jobID = await seedQueuedJob(fileName);
  await pool.query(`UPDATE catalog.background_jobs SET Status = 'waiting_retry', NextAttemptAt = NOW() + INTERVAL ? SECOND WHERE JobID = ?`, [
    nextAttemptOffsetSeconds,
    jobID
  ]);
  console.log(`[seed] jobID=${jobID} → waiting_retry, NextAttemptAt offset ${nextAttemptOffsetSeconds}s`);
  return jobID;
}

function makeDispatchStub(failFor: number[] = []): { deps: SweepDeps; calls: number[] } {
  const calls: number[] = [];
  const deps: SweepDeps = {
    dispatch: vi.fn(async (jobID: number) => {
      calls.push(jobID);
      if (failFor.includes(jobID)) {
        throw new Error(`[dispatch stub] simulated dispatch failure for jobID=${jobID}`);
      }
    })
  };
  return { deps, calls };
}

// ---------------------------------------------------------------------------
// Stale-lease reclaim
// ---------------------------------------------------------------------------

describe('sweepOnce — stale-lease reclaim', () => {
  it('moves a stale running job with budget remaining to waiting_retry, clears the lease, and reports it in reclaimed[]', async () => {
    const jobID = await seedRunningJob('stale-retry.csv', STALE_HEARTBEAT_AGE_SECONDS, 0);
    const { deps } = makeDispatchStub();

    const result = await sweepOnce(pool, deps);
    console.log(`[reclaim-retry] reclaimed=[${result.reclaimed.join(', ')}] dispatched=[${result.dispatched.join(', ')}]`);

    expect(result.reclaimed).toContain(jobID);

    const row = await getBackgroundJob(pool, jobID);
    console.log(
      `[reclaim-retry] post-sweep: status=${row?.status} retryCount=${row?.retryCount} workerID=${row?.workerID} nextAttemptAt=${row?.nextAttemptAt?.toISOString()}`
    );
    expect(row!.status).toBe('waiting_retry');
    expect(row!.nextAttemptAt).toBeInstanceOf(Date);
    expect(row!.workerID).toBeNull();
    expect(row!.workerHeartbeatAt).toBeNull();
    expect(row!.retryCount).toBe(1);
    expect(row!.lastError).toMatch(/heartbeat/i);
  });

  it('moves a stale running job with exhausted budget to failed with a heartbeat-mentioning reason', async () => {
    const jobID = await seedRunningJob('stale-failed.csv', STALE_HEARTBEAT_AGE_SECONDS, UPLOAD_JOB_MAX_RETRIES - 1);
    const { deps } = makeDispatchStub();

    const result = await sweepOnce(pool, deps);
    console.log(`[reclaim-failed] reclaimed=[${result.reclaimed.join(', ')}]`);

    expect(result.reclaimed).toContain(jobID);

    const row = await getBackgroundJob(pool, jobID);
    console.log(`[reclaim-failed] post-sweep: status=${row?.status} retryCount=${row?.retryCount} lastError="${row?.lastError}"`);
    expect(row!.status).toBe('failed');
    expect(row!.phase).toBe('failed');
    expect(row!.lastError).toMatch(/heartbeat/i);
    expect(row!.retryCount).toBe(UPLOAD_JOB_MAX_RETRIES);
    expect(row!.finishedAt).toBeInstanceOf(Date);
    expect(row!.workerID).toBeNull();

    const details = await getBackgroundJobWithDetails(pool, jobID);
    const reclaimedEvent = details!.events.find(e => e.eventType === 'reclaimed');
    console.log(`[reclaim-failed] events: ${details!.events.map(e => e.eventType).join(', ')}`);
    expect(reclaimedEvent).toBeDefined();
  });

  it('leaves a running job with a fresh heartbeat untouched', async () => {
    const jobID = await seedRunningJob('fresh.csv', FRESH_HEARTBEAT_AGE_SECONDS, 0);
    const { deps, calls } = makeDispatchStub();

    const result = await sweepOnce(pool, deps);
    console.log(`[fresh] reclaimed=[${result.reclaimed.join(', ')}] dispatched=[${result.dispatched.join(', ')}]`);

    expect(result.reclaimed).not.toContain(jobID);
    expect(calls).not.toContain(jobID);

    const row = await getBackgroundJob(pool, jobID);
    console.log(`[fresh] post-sweep: status=${row?.status} workerID=${row?.workerID} retryCount=${row?.retryCount}`);
    expect(row!.status).toBe('running');
    expect(row!.workerID).toBe(DEAD_WORKER_ID);
    expect(row!.retryCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

describe('sweepOnce — runnable-job dispatch', () => {
  it('dispatches queued and past-due waiting_retry jobs in JobID order; future waiting_retry is skipped', async () => {
    const queuedID = await seedQueuedJob('queued.csv');
    const pastDueID = await seedWaitingRetryJob('past-due.csv', -PAST_DUE_OFFSET_SECONDS);
    const futureID = await seedWaitingRetryJob('future.csv', FUTURE_DUE_OFFSET_SECONDS);
    const { deps, calls } = makeDispatchStub();

    const result = await sweepOnce(pool, deps);
    console.log(`[dispatch] dispatched=[${result.dispatched.join(', ')}] stub calls=[${calls.join(', ')}]`);

    expect(result.dispatched).toEqual([queuedID, pastDueID]);
    expect(calls).toEqual([queuedID, pastDueID]);
    expect(result.dispatched).not.toContain(futureID);
    expect(deps.dispatch).toHaveBeenCalledTimes(2);
  });

  it('dispatches a job it reclaimed within the SAME pass (reclaim runs before findRunnable)', async () => {
    const jobID = await seedRunningJob('reclaim-then-dispatch.csv', STALE_HEARTBEAT_AGE_SECONDS, 0);
    const { deps, calls } = makeDispatchStub();

    const result = await sweepOnce(pool, deps);
    console.log(`[same-pass] reclaimed=[${result.reclaimed.join(', ')}] dispatched=[${result.dispatched.join(', ')}] stub calls=[${calls.join(', ')}]`);

    expect(result.reclaimed).toContain(jobID);
    expect(result.dispatched).toContain(jobID);
    expect(calls).toContain(jobID);
  });

  it('continues dispatching after a per-job dispatch failure and still resolves', async () => {
    const failingID = await seedQueuedJob('dispatch-fails.csv');
    const healthyID = await seedQueuedJob('dispatch-succeeds.csv');
    const { deps, calls } = makeDispatchStub([failingID]);

    const result = await sweepOnce(pool, deps);
    console.log(`[resilience] dispatched=[${result.dispatched.join(', ')}] stub calls=[${calls.join(', ')}]`);

    // The failing job was attempted but is NOT reported as dispatched.
    expect(calls).toEqual([failingID, healthyID]);
    expect(result.dispatched).toEqual([healthyID]);
  });
});

// ---------------------------------------------------------------------------
// Interval lifecycle
// ---------------------------------------------------------------------------

describe('startUploadJobSweeper / stopUploadJobSweeper — sentinel lifecycle', () => {
  it('double start keeps a single interval; stop clears the sentinel', () => {
    const sweeperGlobal = globalThis as typeof globalThis & { [SWEEPER_SENTINEL]?: NodeJS.Timeout };

    expect(sweeperGlobal[SWEEPER_SENTINEL]).toBeUndefined();

    startUploadJobSweeper(pool);
    const firstHandle = sweeperGlobal[SWEEPER_SENTINEL];
    console.log(`[sentinel] after first start: handle present=${firstHandle !== undefined}`);
    expect(firstHandle).toBeDefined();

    startUploadJobSweeper(pool);
    const secondHandle = sweeperGlobal[SWEEPER_SENTINEL];
    console.log(`[sentinel] after double start: same handle=${secondHandle === firstHandle}`);
    expect(secondHandle).toBe(firstHandle);

    stopUploadJobSweeper();
    console.log(`[sentinel] after stop: handle present=${sweeperGlobal[SWEEPER_SENTINEL] !== undefined}`);
    expect(sweeperGlobal[SWEEPER_SENTINEL]).toBeUndefined();

    // Stop is idempotent.
    expect(() => stopUploadJobSweeper()).not.toThrow();
  });
});
