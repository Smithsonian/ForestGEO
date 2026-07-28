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
import { applyCatalogMigrationsForTests } from '../setup/catalog-migrations';
import { createUploadBackgroundJob, getBackgroundJob, getBackgroundJobWithDetails } from '@/lib/background-jobs/repository';
import { runSweepTick, startUploadJobSweeper, stopUploadJobSweeper, sweepOnce, SWEEP_DISPATCH_LIMIT, type SweepDeps } from '@/lib/background-jobs/sweeper';
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
  await applyCatalogMigrationsForTests();
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

interface SweeperSentinelValue {
  interval: NodeJS.Timeout;
  inFlight: boolean;
  shutdownInstalled: boolean;
}
type SweeperGlobal = typeof globalThis & { [SWEEPER_SENTINEL]?: SweeperSentinelValue };

describe('startUploadJobSweeper / stopUploadJobSweeper — sentinel lifecycle', () => {
  it('double start keeps a single interval; stop clears the sentinel', () => {
    const sweeperGlobal = globalThis as SweeperGlobal;

    expect(sweeperGlobal[SWEEPER_SENTINEL]).toBeUndefined();

    startUploadJobSweeper(pool);
    const firstSentinel = sweeperGlobal[SWEEPER_SENTINEL];
    console.log(`[sentinel] after first start: sentinel present=${firstSentinel !== undefined}, inFlight=${firstSentinel?.inFlight}`);
    expect(firstSentinel).toBeDefined();
    expect(firstSentinel?.inFlight).toBe(false);

    startUploadJobSweeper(pool);
    const secondSentinel = sweeperGlobal[SWEEPER_SENTINEL];
    console.log(`[sentinel] after double start: same object=${secondSentinel === firstSentinel}`);
    expect(secondSentinel).toBe(firstSentinel);

    stopUploadJobSweeper();
    console.log(`[sentinel] after stop: sentinel present=${sweeperGlobal[SWEEPER_SENTINEL] !== undefined}`);
    expect(sweeperGlobal[SWEEPER_SENTINEL]).toBeUndefined();

    // Stop is idempotent.
    expect(() => stopUploadJobSweeper()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Dispatch limit
// ---------------------------------------------------------------------------

describe('sweepOnce — dispatch limit', () => {
  it(`dispatches exactly SWEEP_DISPATCH_LIMIT jobs per pass; a second pass picks up the remainder`, async () => {
    const totalJobs = SWEEP_DISPATCH_LIMIT + 1;
    const jobIDs: number[] = [];
    for (let i = 0; i < totalJobs; i++) {
      jobIDs.push(await seedQueuedJob(`limit-job-${i}.csv`));
    }
    const remainderID = jobIDs[SWEEP_DISPATCH_LIMIT];
    console.log(`[dispatch-limit] seeded jobIDs=[${jobIDs.join(', ')}] (SWEEP_DISPATCH_LIMIT=${SWEEP_DISPATCH_LIMIT}, remainderID=${remainderID})`);

    const { deps: deps1, calls: calls1 } = makeDispatchStub();
    const result1 = await sweepOnce(pool, deps1);
    console.log(`[dispatch-limit] pass 1: dispatched=[${result1.dispatched.join(', ')}] stub calls=[${calls1.join(', ')}]`);

    expect(result1.dispatched).toHaveLength(SWEEP_DISPATCH_LIMIT);
    // Lowest JobIDs dispatched first (ORDER BY JobID).
    expect(result1.dispatched).toEqual(jobIDs.slice(0, SWEEP_DISPATCH_LIMIT));
    // The job beyond the limit was not touched.
    expect(result1.dispatched).not.toContain(remainderID);

    // Advance the first SWEEP_DISPATCH_LIMIT jobs out of 'queued' so the
    // second pass sees only the remainder. The stub never mutates DB status, so
    // we do it directly. Mark them 'running' (any non-runnable status works).
    await pool.query(
      `UPDATE catalog.background_jobs SET Status = 'running', WorkerID = 'test-advance', WorkerHeartbeatAt = NOW() WHERE JobID IN (${jobIDs.slice(0, SWEEP_DISPATCH_LIMIT).join(', ')})`
    );

    const { deps: deps2, calls: calls2 } = makeDispatchStub();
    const result2 = await sweepOnce(pool, deps2);
    console.log(`[dispatch-limit] pass 2: dispatched=[${result2.dispatched.join(', ')}] stub calls=[${calls2.join(', ')}]`);

    // Only the remainder is queued now.
    expect(result2.dispatched).toEqual([remainderID]);
    expect(calls2).toEqual([remainderID]);
  });
});

// ---------------------------------------------------------------------------
// In-flight tick guard
// ---------------------------------------------------------------------------

describe('runSweepTick — in-flight guard', () => {
  it('skips a concurrent tick while the first pass is still awaiting', async () => {
    // Use a deferred dispatch so the first tick stays in-flight while the
    // second tick is invoked.
    let resolveFirstDispatch!: () => void;
    const firstDispatchBlocked = new Promise<void>(resolve => {
      resolveFirstDispatch = resolve;
    });

    const dispatchCalls: number[] = [];
    const blockingDeps: SweepDeps = {
      dispatch: vi.fn(async (jobID: number) => {
        dispatchCalls.push(jobID);
        await firstDispatchBlocked;
      })
    };

    const jobID = await seedQueuedJob('in-flight-guard.csv');
    console.log(`[in-flight] seeded jobID=${jobID}`);

    // Start the sweeper so the sentinel exists and runSweepTick can read inFlight.
    startUploadJobSweeper(pool);
    const sweeperGlobal = globalThis as SweeperGlobal;

    // Kick off tick 1 — does NOT await yet; it sets inFlight=true and then
    // waits inside blockingDeps.dispatch.
    const tick1Promise = runSweepTick(pool, blockingDeps);

    // Yield to let tick 1 reach its first await (the sweepOnce DB queries).
    // A short real delay is unavoidable here — the alternative is to instrument
    // sweepOnce, which adds production complexity for a test concern.
    await new Promise<void>(resolve => setTimeout(resolve, 50));

    // At this point inFlight should be true because tick 1 hasn't resolved yet.
    const inFlightDuringFirstTick = sweeperGlobal[SWEEPER_SENTINEL]?.inFlight ?? false;
    console.log(`[in-flight] inFlight during tick 1: ${inFlightDuringFirstTick}`);

    // Tick 2 should be skipped because inFlight=true.
    const skippingDeps: SweepDeps = {
      dispatch: vi.fn(async (jobID: number) => {
        dispatchCalls.push(jobID);
      })
    };
    await runSweepTick(pool, skippingDeps);
    console.log(`[in-flight] after tick 2: dispatchCalls=[${dispatchCalls.join(', ')}]`);

    // tick 2 must NOT have dispatched anything — the skip guard fired.
    expect(skippingDeps.dispatch).not.toHaveBeenCalled();

    // Unblock tick 1 and let it finish.
    resolveFirstDispatch();
    await tick1Promise;
    console.log(`[in-flight] after tick 1 resolves: inFlight=${sweeperGlobal[SWEEPER_SENTINEL]?.inFlight}`);

    // inFlight resets to false after the pass completes.
    expect(sweeperGlobal[SWEEPER_SENTINEL]?.inFlight).toBe(false);

    // A third tick now runs freely.
    const { deps: deps3, calls: calls3 } = makeDispatchStub();
    await runSweepTick(pool, deps3);
    console.log(`[in-flight] tick 3 (free): calls=[${calls3.join(', ')}]`);
    expect(deps3.dispatch).toHaveBeenCalled();
  });
});
