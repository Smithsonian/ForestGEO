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
import {
  activeJobExecutionCount,
  MAX_CONCURRENT_JOB_EXECUTIONS,
  runSweepTick,
  startUploadJobSweeper,
  stopUploadJobSweeper,
  sweepOnce,
  SWEEP_DISPATCH_LIMIT,
  type SweepDeps
} from '@/lib/background-jobs/sweeper';
import type { CreateUploadJobInput } from '@/lib/background-jobs/types';
import { UPLOAD_JOB_MAX_RETRIES } from '@/lib/background-jobs/types';
import ailogger from '@/ailogger';

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

const DISPATCH_DRAIN_TIMEOUT_MS = 5000;
/** Must match the sweeper pool created in beforeAll. */
const SWEEPER_POOL_CONNECTION_LIMIT = 5;
/** Long enough for a tick to reach its first catalog query and park there. */
const IN_FLIGHT_SETTLE_MS = 50;
const DISPATCH_DRAIN_POLL_MS = 5;

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

afterEach(async () => {
  // Never leak a live interval between tests.
  stopUploadJobSweeper();
  // The active-dispatch set is process-global: a job still "running" here would
  // consume capacity in the next test and make it fail for the wrong reason.
  await waitForIdleDispatches();
});

/** Polls until no job execution is outstanding, or fails loudly. */
async function waitForIdleDispatches(): Promise<void> {
  const deadline = Date.now() + DISPATCH_DRAIN_TIMEOUT_MS;
  while (activeJobExecutionCount() > 0) {
    if (Date.now() > deadline) {
      throw new Error(`${activeJobExecutionCount()} job execution(s) still active after ${DISPATCH_DRAIN_TIMEOUT_MS}ms — a test left a dispatch unresolved.`);
    }
    await new Promise(resolve => setTimeout(resolve, DISPATCH_DRAIN_POLL_MS));
  }
}

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

  it('keeps starting jobs after one of them fails, and frees that job’s slot', async () => {
    const failingID = await seedQueuedJob('dispatch-fails.csv');
    const healthyID = await seedQueuedJob('dispatch-succeeds.csv');
    const { deps, calls } = makeDispatchStub([failingID]);

    const result = await sweepOnce(pool, deps);
    console.log(`[resilience] dispatched=[${result.dispatched.join(', ')}] stub calls=[${calls.join(', ')}]`);

    // The pass no longer waits for jobs, so `dispatched` means STARTED. Both
    // started; the failure surfaces asynchronously and must not abort the pass.
    expect(calls).toEqual([failingID, healthyID]);
    expect(result.dispatched).toEqual([failingID, healthyID]);

    // A failed job must not hold its execution slot forever.
    await waitForIdleDispatches();
    expect(activeJobExecutionCount()).toBe(0);
  });
});

/**
 * The head-of-line blocking fix. `await deps.dispatch(jobID)` ran a job to
 * completion INSIDE the pass, so one census-scale ingestion held the pass open
 * for hours: the in-flight guard skipped every tick behind it, and stale-lease
 * reclaim for every OTHER orphaned job was deferred for exactly that long.
 * Reclaim is the recovery mechanism, and it was the thing being starved.
 */
describe('sweepOnce — dispatch is decoupled from job completion', () => {
  /** A dispatch stub whose jobs only finish when the test says so. */
  function makeHeldDispatchStub(): { deps: SweepDeps; started: number[]; release: () => void } {
    const started: number[] = [];
    const releasers: Array<() => void> = [];
    const deps: SweepDeps = {
      dispatch: vi.fn(
        (jobID: number) =>
          new Promise<void>(resolve => {
            started.push(jobID);
            releasers.push(resolve);
          })
      )
    };
    return { deps, started, release: () => releasers.splice(0).forEach(resolve => resolve()) };
  }

  it('returns while the job it started is still running', async () => {
    await seedQueuedJob('long-running.csv');
    const { deps, started, release } = makeHeldDispatchStub();

    // Pre-fix this await never resolves until the job does.
    const result = await sweepOnce(pool, deps);
    console.log(`[decoupled] pass returned with ${started.length} job(s) still executing`);

    expect(result.dispatched).toHaveLength(1);
    expect(activeJobExecutionCount()).toBe(1);

    release();
    await waitForIdleDispatches();
  });

  it('keeps reclaiming stale leases across later passes while a job is still executing', async () => {
    await seedQueuedJob('holds-a-slot.csv');
    const { deps, release } = makeHeldDispatchStub();
    await sweepOnce(pool, deps);
    expect(activeJobExecutionCount()).toBe(1);

    // A DIFFERENT job is orphaned while the first is mid-flight. Pre-fix, no
    // pass could even start until the long job finished, so this sat unreclaimed.
    const orphanedID = await seedRunningJob('orphaned-meanwhile.csv', STALE_HEARTBEAT_AGE_SECONDS, 0);

    const secondPass = await sweepOnce(pool, deps);
    console.log(`[decoupled] second pass reclaimed=[${secondPass.reclaimed.join(', ')}] while ${activeJobExecutionCount()} job(s) executing`);

    expect(secondPass.reclaimed).toContain(orphanedID);
    expect(await getBackgroundJob(pool, orphanedID).then(job => job?.status)).toBe('waiting_retry');

    release();
    await waitForIdleDispatches();
  });

  it('never exceeds the concurrency cap, and defers the rest with a reason', async () => {
    const seededIDs: number[] = [];
    for (let i = 0; i < MAX_CONCURRENT_JOB_EXECUTIONS + 2; i++) {
      seededIDs.push(await seedQueuedJob(`capacity-${i}.csv`));
    }
    const { deps, started, release } = makeHeldDispatchStub();

    const firstPass = await sweepOnce(pool, deps);
    console.log(
      `[capacity] cap=${MAX_CONCURRENT_JOB_EXECUTIONS} started=[${firstPass.dispatched.join(', ')}] deferred=[${firstPass.deferredForCapacity.join(', ')}]`
    );

    expect(firstPass.dispatched).toHaveLength(MAX_CONCURRENT_JOB_EXECUTIONS);
    expect(activeJobExecutionCount()).toBe(MAX_CONCURRENT_JOB_EXECUTIONS);
    expect(firstPass.deferredForCapacity.length).toBeGreaterThan(0);
    expect(firstPass.dispatched.concat(firstPass.deferredForCapacity)).toEqual(seededIDs.slice(0, SWEEP_DISPATCH_LIMIT));

    // A second pass with every slot still full starts NOTHING new — the whole
    // point of the cap — but still completes.
    const secondPass = await sweepOnce(pool, deps);
    expect(secondPass.dispatched).toHaveLength(0);
    expect(started).toHaveLength(MAX_CONCURRENT_JOB_EXECUTIONS);
    expect(activeJobExecutionCount()).toBe(MAX_CONCURRENT_JOB_EXECUTIONS);

    // Slots free up as jobs finish, and the next pass uses exactly that capacity.
    release();
    await waitForIdleDispatches();
    const thirdPass = await sweepOnce(pool, deps);
    console.log(`[capacity] after drain, third pass started=[${thirdPass.dispatched.join(', ')}]`);
    expect(thirdPass.dispatched.length).toBeGreaterThan(0);
    expect(thirdPass.dispatched.length).toBeLessThanOrEqual(MAX_CONCURRENT_JOB_EXECUTIONS);

    release();
    await waitForIdleDispatches();
  });

  it('still reclaims stale leases when every execution slot is full', async () => {
    for (let i = 0; i < MAX_CONCURRENT_JOB_EXECUTIONS; i++) {
      await seedQueuedJob(`filler-${i}.csv`);
    }
    const { deps, release } = makeHeldDispatchStub();
    await sweepOnce(pool, deps);
    expect(activeJobExecutionCount()).toBe(MAX_CONCURRENT_JOB_EXECUTIONS);

    const orphanedID = await seedRunningJob('orphan-at-capacity.csv', STALE_HEARTBEAT_AGE_SECONDS, 0);

    const result = await sweepOnce(pool, deps);
    console.log(`[capacity] at full capacity: reclaimed=[${result.reclaimed.join(', ')}] started=[${result.dispatched.join(', ')}]`);

    expect(result.reclaimed, 'reclaim must not be gated on execution capacity').toContain(orphanedID);
    expect(result.dispatched).toHaveLength(0);

    release();
    await waitForIdleDispatches();
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
  // Two limits, two jobs: SWEEP_DISPATCH_LIMIT bounds how many runnable jobs a
  // pass LOOKS AT; MAX_CONCURRENT_JOB_EXECUTIONS bounds how many it STARTS.
  // Before dispatch was decoupled these were the same number by accident,
  // because a pass ran its jobs to completion one after another.
  it(`considers at most SWEEP_DISPATCH_LIMIT jobs and starts at most MAX_CONCURRENT_JOB_EXECUTIONS of them`, async () => {
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

    // The pass looked at SWEEP_DISPATCH_LIMIT jobs — started what capacity
    // allowed, deferred the rest — and never reached past the query limit.
    expect(result1.dispatched.concat(result1.deferredForCapacity)).toEqual(jobIDs.slice(0, SWEEP_DISPATCH_LIMIT));
    expect(result1.dispatched).toHaveLength(MAX_CONCURRENT_JOB_EXECUTIONS);
    // The job beyond the query limit was not even considered.
    expect(result1.dispatched).not.toContain(remainderID);
    expect(result1.deferredForCapacity).not.toContain(remainderID);

    // The started jobs finish, freeing their slots for the next pass.
    await waitForIdleDispatches();

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
    await waitForIdleDispatches();
  });
});

// ---------------------------------------------------------------------------
// In-flight tick guard
// ---------------------------------------------------------------------------

describe('runSweepTick — in-flight guard', () => {
  it('skips a concurrent tick while the first pass is still awaiting', async () => {
    // The guard now protects against a slow PASS, not a slow job: sweepOnce no
    // longer waits for the jobs it starts, so a blocked dispatch would not keep
    // a tick in flight. What can still hold a pass open is its own catalog
    // queries, so this saturates the sweeper's pool and lets the first tick
    // block acquiring a connection — the real shape of a slow pass.
    const jobID = await seedQueuedJob('in-flight-guard.csv');
    console.log(`[in-flight] seeded jobID=${jobID}`);

    const heldConnections = [];
    for (let i = 0; i < SWEEPER_POOL_CONNECTION_LIMIT; i++) {
      heldConnections.push(await pool.getConnection());
    }
    console.log(`[in-flight] holding all ${heldConnections.length} pooled connections`);

    // Start the sweeper so the sentinel exists and runSweepTick can read inFlight.
    startUploadJobSweeper(pool);
    const sweeperGlobal = globalThis as SweeperGlobal;

    const { deps: blockedDeps, calls: blockedCalls } = makeDispatchStub();
    // Tick 1 sets inFlight=true, then stalls on its first catalog query.
    const tick1Promise = runSweepTick(pool, blockedDeps);
    await new Promise<void>(resolve => setTimeout(resolve, IN_FLIGHT_SETTLE_MS));

    const inFlightDuringFirstTick = sweeperGlobal[SWEEPER_SENTINEL]?.inFlight ?? false;
    console.log(`[in-flight] inFlight during tick 1: ${inFlightDuringFirstTick}`);
    expect(inFlightDuringFirstTick).toBe(true);

    const { deps: skippingDeps } = makeDispatchStub();
    const skippedOutcome = await runSweepTick(pool, skippingDeps);
    console.log(`[in-flight] tick 2 outcome=${skippedOutcome.status}`);

    expect(skippingDeps.dispatch).not.toHaveBeenCalled();
    // A skip and a failure are different events: the startup caller escalates
    // one and not the other, so they must be distinguishable.
    expect(skippedOutcome).toEqual({ status: 'skipped_in_flight' });

    // Release the pool and let tick 1 finish.
    heldConnections.forEach(connection => connection.release());
    await tick1Promise;
    console.log(`[in-flight] tick 1 done: calls=[${blockedCalls.join(', ')}] inFlight=${sweeperGlobal[SWEEPER_SENTINEL]?.inFlight}`);

    expect(sweeperGlobal[SWEEPER_SENTINEL]?.inFlight).toBe(false);
    expect(blockedCalls).toContain(jobID);
    await waitForIdleDispatches();
  });
});

describe('runSweepTick — failure reporting', () => {
  // The startup sweep IS the deploy-recovery moment for jobs orphaned by the
  // previous process. runSweepTick must not throw (that would kill the
  // interval), but a caller has to be able to tell a failed pass from a skipped
  // one, or a boot that never recovered anything looks like a routine tick.
  it('reports a failed pass as a distinct outcome carrying the error, without throwing', async () => {
    const failure = new Error('catalog unreachable');
    const throwingDeps: SweepDeps = {
      dispatch: vi.fn(async () => {
        throw failure;
      })
    };
    // sweepOnce catches per-job dispatch errors, so fail the pass at the query
    // layer instead — a dead pool is the real-world shape of this failure.
    const deadPool = {
      query: async () => {
        throw failure;
      },
      execute: async () => {
        throw failure;
      }
    } as unknown as Pool;

    const outcome = await runSweepTick(deadPool, throwingDeps);
    console.log(`[failure] outcome=${outcome.status}`);

    expect(outcome.status).toBe('failed');
    expect(outcome.status === 'failed' && outcome.error.message).toBe(failure.message);
  });

  it('logs nothing itself, so one failed pass produces exactly one event', async () => {
    // A failed startup sweep used to emit BOTH upload.sweeper.pass_failed (warn,
    // from here) and upload.sweeper.startup_failed (error, from
    // instrumentation-node) — two events, one failure, two different severities
    // for the same thing. runSweepTick now reports and lets each caller emit its
    // own single canonical event: the interval warns, the startup path errors.
    const failure = new Error('catalog unreachable');
    const deadPool = {
      query: async () => {
        throw failure;
      },
      execute: async () => {
        throw failure;
      }
    } as unknown as Pool;
    const warnSpy = vi.spyOn(ailogger, 'warn');
    const errorSpy = vi.spyOn(ailogger, 'error');

    try {
      const outcome = await runSweepTick(deadPool, makeDispatchStub().deps);
      expect(outcome.status).toBe('failed');

      const failureEvents = [...warnSpy.mock.calls, ...errorSpy.mock.calls].filter(([event]) => typeof event === 'string' && event.includes('sweeper'));
      console.log(`[single-event] sweeper events emitted by runSweepTick: ${JSON.stringify(failureEvents.map(([event]) => event))}`);
      expect(failureEvents).toEqual([]);
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
