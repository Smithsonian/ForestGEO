/**
 * Background Jobs Repository — Integration Tests
 *
 * Exercises the repository layer against a real MySQL instance.
 * No mocks — every assertion reflects actual DB state.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/background-jobs-repository.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mysql, { type Pool } from 'mysql2/promise';
import { ensureBackgroundJobCatalogTables } from '@/lib/background-jobs/catalog';
import { JobFileNotFoundError, WorkerLeaseLostError } from '@/lib/background-jobs/errors';
import {
  assignFileBatchID,
  cancelBackgroundJob,
  claimBackgroundJobForWorker,
  createUploadBackgroundJob,
  finalizeJobAsSystem,
  getBackgroundJob,
  getBackgroundJobWithDetails,
  heartbeatBackgroundJob,
  listBackgroundJobs,
  markBackgroundJobWaitingRetryAsWorker,
  setBackgroundJobStatus,
  updateBackgroundJobFileStatus
} from '@/lib/background-jobs/repository';
import type { CreateUploadJobInput } from '@/lib/background-jobs/types';
import { UPLOAD_JOB_MAX_RETRIES } from '@/lib/background-jobs/types';

// ---------------------------------------------------------------------------
// Safety guard — this suite DELETEs from the shared `catalog` schema and must
// never run against a remote database.
// ---------------------------------------------------------------------------

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';

if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(
    `[background-jobs-repository] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite deletes all rows from catalog.background_jobs and must only run against a local test database.`
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_DB_PORT = Number(process.env.TEST_DB_PORT || 3306);
const TEST_DB_USER = process.env.TEST_DB_USER || 'root';
const TEST_DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'testpassword';

const TEST_USER_A = 'user-a@forestgeo.test';
const TEST_USER_B = 'user-b@forestgeo.test';

const TEST_SCHEMA = 'forestgeo_testing_bgjobs';
const TEST_PLOT_ID = 1;
const TEST_CENSUS_ID = 2;

const BLOB_CONTAINER = 'forestgeo-testing-storage';

const WORKER_A = 'worker-alpha-001';
const WORKER_B = 'worker-beta-002';

// ---------------------------------------------------------------------------
// Pool lifecycle
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

  // Bootstrap tables (idempotent — safe to call on a clean or existing DB).
  await ensureBackgroundJobCatalogTables(pool);

  console.log('[background-jobs-repository] catalog tables ensured');
});

afterAll(async () => {
  if (pool) await pool.end();
});

// ---------------------------------------------------------------------------
// Row cleanup between tests
// ---------------------------------------------------------------------------

beforeEach(async () => {
  // Delete in FK-safe order: events → files → jobs.
  await pool.query(`DELETE FROM catalog.background_job_events`);
  await pool.query(`DELETE FROM catalog.background_job_files`);
  await pool.query(`DELETE FROM catalog.background_jobs`);
  console.log('[background-jobs-repository] catalog rows cleared');
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJobInput(overrides: Partial<CreateUploadJobInput> = {}): CreateUploadJobInput {
  return {
    schema: TEST_SCHEMA,
    plotID: TEST_PLOT_ID,
    censusID: TEST_CENSUS_ID,
    uploadMode: 'clean_reupload',
    sourceFormat: 'csv',
    formType: 'measurements',
    files: [
      {
        fileName: 'measurements.csv',
        blobContainer: BLOB_CONTAINER,
        blobName: 'uploads/test-run/measurements.csv',
        contentType: 'text/csv',
        byteSize: 512,
        expectedRows: 10
      },
      {
        fileName: 'attributes.csv',
        blobContainer: BLOB_CONTAINER,
        blobName: 'uploads/test-run/attributes.csv',
        contentType: 'text/csv',
        byteSize: 128,
        expectedRows: 5
      }
    ],
    ...overrides
  };
}

/** Creates a job and claims it for the given worker. Returns both job and its file IDs. */
async function createAndClaimJob(workerID: string): Promise<{ jobID: number; fileIDs: number[] }> {
  const job = await createUploadBackgroundJob(pool, makeJobInput(), TEST_USER_A);
  const claimed = await claimBackgroundJobForWorker(pool, job.jobID, workerID);
  if (!claimed) throw new Error(`[test helper] Failed to claim jobID=${job.jobID} for worker=${workerID}`);
  const fileIDs = claimed.files.map(f => f.jobFileID);
  console.log(`[helper] created jobID=${job.jobID}, claimed by ${workerID}, fileIDs=[${fileIDs.join(', ')}]`);
  return { jobID: job.jobID, fileIDs };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('createUploadBackgroundJob — create and fetch roundtrip', () => {
  it('inserts a job with two files and maps every field correctly', async () => {
    const input = makeJobInput({ idempotencyKey: 'roundtrip-test-key' });
    const job = await createUploadBackgroundJob(pool, input, TEST_USER_A);

    console.log(`[roundtrip] created jobID=${job.jobID} status=${job.status} phase=${job.phase}`);

    // Core scalar fields
    expect(job.jobID).toBeGreaterThan(0);
    expect(job.jobType).toBe('upload_validation');
    expect(job.status).toBe('queued');
    expect(job.phase).toBe('queued');
    expect(job.schemaName).toBe(TEST_SCHEMA);
    expect(job.plotID).toBe(TEST_PLOT_ID);
    expect(job.censusID).toBe(TEST_CENSUS_ID);
    expect(job.uploadMode).toBe('clean_reupload');
    expect(job.sourceFormat).toBe('csv');
    expect(job.formType).toBe('measurements');
    expect(job.createdBy).toBe(TEST_USER_A);
    expect(job.idempotencyKey).toBe('roundtrip-test-key');
    expect(job.totalFiles).toBe(2);
    expect(job.totalRows).toBe(15); // 10 + 5
    expect(job.processedRows).toBe(0);
    expect(job.failedRows).toBe(0);
    expect(job.retryCount).toBe(0);
    expect(job.maxRetries).toBe(UPLOAD_JOB_MAX_RETRIES);
    expect(job.percentComplete).toBe(0);
    expect(job.lastError).toBeNull();
    expect(job.workerID).toBeNull();
    expect(job.workerHeartbeatAt).toBeNull();
    expect(job.startedAt).toBeNull();
    expect(job.finishedAt).toBeNull();
    expect(job.createdAt).toBeInstanceOf(Date);
    expect(job.updatedAt).toBeInstanceOf(Date);

    // Fetch with details and verify files
    const details = await getBackgroundJobWithDetails(pool, job.jobID);
    expect(details).not.toBeNull();
    expect(details!.files).toHaveLength(2);

    const fileA = details!.files.find(f => f.fileName === 'measurements.csv');
    const fileB = details!.files.find(f => f.fileName === 'attributes.csv');
    expect(fileA).toBeDefined();
    expect(fileB).toBeDefined();

    console.log(`[roundtrip] file IDs: ${details!.files.map(f => `${f.fileName}→${f.jobFileID}`).join(', ')}`);

    expect(fileA!.blobContainer).toBe(BLOB_CONTAINER);
    expect(fileA!.blobName).toBe('uploads/test-run/measurements.csv');
    expect(fileA!.expectedRows).toBe(10);
    expect(fileA!.processedRows).toBe(0);
    expect(fileA!.failedRows).toBe(0);
    expect(fileA!.status).toBe('pending');
    expect(fileA!.batchID).toBeNull();
    expect(fileA!.formType).toBe('measurements');

    expect(fileB!.expectedRows).toBe(5);

    // Verify the creation event was logged
    expect(details!.events).toHaveLength(1);
    expect(details!.events[0].eventType).toBe('queued');
    console.log(`[roundtrip] event: type=${details!.events[0].eventType} message="${details!.events[0].message}"`);
  });
});

describe('createUploadBackgroundJob — duplicate idempotency key', () => {
  it('concurrent creates with the same (user, key) both resolve to the same jobID with exactly one DB row', async () => {
    const idempotencyKey = 'concurrent-dedup-test-key';
    const input = makeJobInput({ idempotencyKey });

    // Fire two creates at exactly the same time.
    const [jobA, jobB] = await Promise.all([createUploadBackgroundJob(pool, input, TEST_USER_A), createUploadBackgroundJob(pool, input, TEST_USER_A)]);

    console.log(`[idempotency] jobA.jobID=${jobA.jobID} jobB.jobID=${jobB.jobID}`);

    expect(jobA.jobID).toBe(jobB.jobID);
    expect(jobA.idempotencyKey).toBe(idempotencyKey);
    expect(jobB.idempotencyKey).toBe(idempotencyKey);

    // Exactly one row in the DB for this user+key.
    const [rows]: any = await pool.query(`SELECT COUNT(*) AS cnt FROM catalog.background_jobs WHERE CreatedBy = ? AND IdempotencyKey = ?`, [
      TEST_USER_A,
      idempotencyKey
    ]);
    const rowCount = Number(rows[0].cnt);
    console.log(`[idempotency] DB row count for key="${idempotencyKey}": ${rowCount}`);
    expect(rowCount).toBe(1);
  });

  it('creates separate jobs for different users sharing the same idempotency key', async () => {
    const idempotencyKey = 'shared-key-different-users';
    const input = makeJobInput({ idempotencyKey });

    const jobA = await createUploadBackgroundJob(pool, input, TEST_USER_A);
    const jobB = await createUploadBackgroundJob(pool, input, TEST_USER_B);

    console.log(`[idempotency-users] userA jobID=${jobA.jobID} userB jobID=${jobB.jobID}`);

    expect(jobA.jobID).not.toBe(jobB.jobID);

    const [rows]: any = await pool.query(`SELECT COUNT(*) AS cnt FROM catalog.background_jobs WHERE IdempotencyKey = ?`, [idempotencyKey]);
    expect(Number(rows[0].cnt)).toBe(2);
  });
});

describe('assignFileBatchID — first assignment wins', () => {
  it('returns the first BatchID on both calls when called twice with different values', async () => {
    const input = makeJobInput();
    const job = await createUploadBackgroundJob(pool, input, TEST_USER_A);
    const details = await getBackgroundJobWithDetails(pool, job.jobID);
    const fileID = details!.files[0].jobFileID;

    const FIRST_BATCH_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
    const SECOND_BATCH_ID = 'bbbbbbbb-5555-6666-7777-888888888888';

    const resultFirst = await assignFileBatchID(pool, fileID, FIRST_BATCH_ID);
    const resultSecond = await assignFileBatchID(pool, fileID, SECOND_BATCH_ID);

    console.log(`[batchID] fileID=${fileID} first="${resultFirst}" second="${resultSecond}"`);

    expect(resultFirst).toBe(FIRST_BATCH_ID);
    // Second call must return the original value, not the new one.
    expect(resultSecond).toBe(FIRST_BATCH_ID);

    // Verify the DB column was never overwritten.
    const [rows]: any = await pool.query(`SELECT BatchID FROM catalog.background_job_files WHERE JobFileID = ?`, [fileID]);
    expect(rows[0].BatchID).toBe(FIRST_BATCH_ID);
  });
});

describe('listBackgroundJobs — filtering', () => {
  it('excludes completed/failed/cancelled jobs when activeOnly=true', async () => {
    const activeJob = await createUploadBackgroundJob(pool, makeJobInput(), TEST_USER_A);
    const completedJob = await createUploadBackgroundJob(
      pool,
      makeJobInput({ files: [{ fileName: 'x.csv', blobContainer: BLOB_CONTAINER, blobName: 'uploads/x.csv' }] }),
      TEST_USER_A
    );
    const failedJob = await createUploadBackgroundJob(
      pool,
      makeJobInput({ files: [{ fileName: 'y.csv', blobContainer: BLOB_CONTAINER, blobName: 'uploads/y.csv' }] }),
      TEST_USER_A
    );

    // Manually push one to completed and one to failed.
    await pool.query(`UPDATE catalog.background_jobs SET Status = 'completed', Phase = 'completed', FinishedAt = NOW() WHERE JobID = ?`, [completedJob.jobID]);
    await pool.query(`UPDATE catalog.background_jobs SET Status = 'failed', Phase = 'failed', FinishedAt = NOW() WHERE JobID = ?`, [failedJob.jobID]);

    console.log(`[list-activeOnly] active=${activeJob.jobID} completed=${completedJob.jobID} failed=${failedJob.jobID}`);

    const activeResults = await listBackgroundJobs(pool, { userID: TEST_USER_A, activeOnly: true });
    const activeIDs = activeResults.map(j => j.jobID);
    console.log(`[list-activeOnly] returned IDs: ${activeIDs.join(', ')}`);

    expect(activeIDs).toContain(activeJob.jobID);
    expect(activeIDs).not.toContain(completedJob.jobID);
    expect(activeIDs).not.toContain(failedJob.jobID);
  });

  it('includes all statuses when activeOnly=false', async () => {
    const activeJob = await createUploadBackgroundJob(pool, makeJobInput(), TEST_USER_A);
    const cancelledJob = await createUploadBackgroundJob(
      pool,
      makeJobInput({ files: [{ fileName: 'z.csv', blobContainer: BLOB_CONTAINER, blobName: 'uploads/z.csv' }] }),
      TEST_USER_A
    );
    await pool.query(`UPDATE catalog.background_jobs SET Status = 'cancelled', Phase = 'cancelled', FinishedAt = NOW() WHERE JobID = ?`, [cancelledJob.jobID]);

    const all = await listBackgroundJobs(pool, { userID: TEST_USER_A, activeOnly: false });
    const allIDs = all.map(j => j.jobID);
    console.log(`[list-all] returned IDs: ${allIDs.join(', ')}`);

    expect(allIDs).toContain(activeJob.jobID);
    expect(allIDs).toContain(cancelledJob.jobID);
  });

  it('filters by schema, plotID, and censusID', async () => {
    const targetJob = await createUploadBackgroundJob(pool, makeJobInput({ schema: 'forestgeo_site_alpha', plotID: 99, censusID: 77 }), TEST_USER_A);
    // Noise: same user, different scope
    await createUploadBackgroundJob(pool, makeJobInput({ schema: 'forestgeo_site_beta', plotID: 1, censusID: 1 }), TEST_USER_A);

    const results = await listBackgroundJobs(pool, {
      userID: TEST_USER_A,
      activeOnly: false,
      schema: 'forestgeo_site_alpha',
      plotID: 99,
      censusID: 77
    });

    console.log(`[list-filter] schema/plot/census filter returned IDs: ${results.map(j => j.jobID).join(', ')}`);
    expect(results).toHaveLength(1);
    expect(results[0].jobID).toBe(targetJob.jobID);
  });
});

describe('cancelBackgroundJob', () => {
  it('cancels a queued job and returns true', async () => {
    const job = await createUploadBackgroundJob(pool, makeJobInput(), TEST_USER_A);
    console.log(`[cancel] attempting cancel of queued jobID=${job.jobID}`);

    const cancelled = await cancelBackgroundJob(pool, job.jobID, TEST_USER_A);
    expect(cancelled).toBe(true);

    const updated = await getBackgroundJob(pool, job.jobID);
    console.log(`[cancel] post-cancel status=${updated?.status} phase=${updated?.phase}`);
    expect(updated!.status).toBe('cancelled');
    expect(updated!.phase).toBe('cancelled');
    expect(updated!.finishedAt).toBeInstanceOf(Date);
  });

  it('refuses to cancel a running job and returns false', async () => {
    const job = await createUploadBackgroundJob(pool, makeJobInput(), TEST_USER_A);
    // Simulate the worker claiming the job.
    await pool.query(`UPDATE catalog.background_jobs SET Status = 'running', Phase = 'staging', StartedAt = NOW(), WorkerID = 'worker-1' WHERE JobID = ?`, [
      job.jobID
    ]);
    console.log(`[cancel] attempting cancel of running jobID=${job.jobID}`);

    const cancelled = await cancelBackgroundJob(pool, job.jobID, TEST_USER_A);
    expect(cancelled).toBe(false);

    const unchanged = await getBackgroundJob(pool, job.jobID);
    console.log(`[cancel] status after refused cancel: ${unchanged?.status}`);
    expect(unchanged!.status).toBe('running');
  });
});

describe('markBackgroundJobWaitingRetryAsWorker — fenced retry transitions', () => {
  it('transitions directly to failed when retry budget is exhausted (budget arithmetic in SQL)', async () => {
    const job = await createUploadBackgroundJob(pool, makeJobInput(), TEST_USER_A);

    // Exhaust all retries by setting RetryCount to maxRetries - 1, so the next
    // call pushes it to maxRetries and triggers permanent failure.
    await pool.query(`UPDATE catalog.background_jobs SET Status = 'running', Phase = 'staging', RetryCount = ?, WorkerID = ? WHERE JobID = ?`, [
      UPLOAD_JOB_MAX_RETRIES - 1,
      WORKER_A,
      job.jobID
    ]);

    console.log(`[retry-budget] jobID=${job.jobID} RetryCount before call: ${UPLOAD_JOB_MAX_RETRIES - 1} maxRetries=${UPLOAD_JOB_MAX_RETRIES}`);

    const budgetError = new Error('Persistent validation failure — budget exhausted');
    const result = await markBackgroundJobWaitingRetryAsWorker(pool, job.jobID, WORKER_A, budgetError, 30);

    console.log(`[retry-budget] result status=${result?.status} phase=${result?.phase} retryCount=${result?.retryCount}`);

    expect(result).not.toBeNull();
    expect(result!.status).toBe('failed');
    expect(result!.phase).toBe('failed');
    expect(result!.retryCount).toBe(UPLOAD_JOB_MAX_RETRIES);
    expect(result!.lastError).toBe(budgetError.message);
    expect(result!.finishedAt).toBeInstanceOf(Date);
    expect(result!.nextAttemptAt).toBeNull();
    expect(result!.workerID).toBeNull();

    // Verify event was logged
    const details = await getBackgroundJobWithDetails(pool, job.jobID);
    const failedEvent = details!.events.find(e => e.eventType === 'failed');
    console.log(`[retry-budget] events: ${details!.events.map(e => e.eventType).join(', ')}`);
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.message).toBe(budgetError.message);
  });

  it('transitions to waiting_retry when budget remains, releasing the lease', async () => {
    const job = await createUploadBackgroundJob(pool, makeJobInput(), TEST_USER_A);
    await pool.query(`UPDATE catalog.background_jobs SET Status = 'running', Phase = 'staging', WorkerID = ? WHERE JobID = ?`, [WORKER_A, job.jobID]);

    const retryError = new Error('Transient staging failure');
    const retryDelay = 60;
    const result = await markBackgroundJobWaitingRetryAsWorker(pool, job.jobID, WORKER_A, retryError, retryDelay);

    console.log(`[retry-budget] result status=${result?.status} retryCount=${result?.retryCount}`);

    expect(result).not.toBeNull();
    expect(result!.status).toBe('waiting_retry');
    expect(result!.phase).toBe('staging');
    expect(result!.retryCount).toBe(1);
    expect(result!.nextAttemptAt).toBeInstanceOf(Date);
    expect(result!.workerID).toBeNull();
    expect(result!.finishedAt).toBeNull();

    const details = await getBackgroundJobWithDetails(pool, job.jobID);
    const retryEvent = details!.events.find(e => e.eventType === 'waiting_retry');
    expect(retryEvent).toBeDefined();
  });

  it('does not consume retry budget when incrementRetry is false (scope-conflict parking)', async () => {
    const job = await createUploadBackgroundJob(pool, makeJobInput(), TEST_USER_A);
    await pool.query(`UPDATE catalog.background_jobs SET Status = 'running', Phase = 'staging', WorkerID = ? WHERE JobID = ?`, [WORKER_A, job.jobID]);

    const conflictError = new Error('Another upload session owns this plot/census');
    const result = await markBackgroundJobWaitingRetryAsWorker(pool, job.jobID, WORKER_A, conflictError, 120, { incrementRetry: false });

    console.log(`[retry-no-burn] result status=${result?.status} retryCount=${result?.retryCount} nextAttemptAt=${result?.nextAttemptAt?.toISOString()}`);

    expect(result).not.toBeNull();
    expect(result!.status).toBe('waiting_retry');
    expect(result!.retryCount).toBe(0); // budget untouched
    expect(result!.nextAttemptAt).toBeInstanceOf(Date);
    expect(result!.workerID).toBeNull();
  });

  it('incrementRetry=false at RetryCount = MaxRetries - 1 still parks as waiting_retry (no spurious fail)', async () => {
    const job = await createUploadBackgroundJob(pool, makeJobInput(), TEST_USER_A);
    await pool.query(`UPDATE catalog.background_jobs SET Status = 'running', Phase = 'staging', RetryCount = ?, WorkerID = ? WHERE JobID = ?`, [
      UPLOAD_JOB_MAX_RETRIES - 1,
      WORKER_A,
      job.jobID
    ]);

    const conflictError = new Error('Scope conflict on last-budget job');
    const result = await markBackgroundJobWaitingRetryAsWorker(pool, job.jobID, WORKER_A, conflictError, 120, { incrementRetry: false });

    console.log(`[retry-no-burn-edge] result status=${result?.status} retryCount=${result?.retryCount}`);
    expect(result!.status).toBe('waiting_retry');
    expect(result!.retryCount).toBe(UPLOAD_JOB_MAX_RETRIES - 1);
  });

  it('SQL backstop: a park attempt on a cancel_requested job finalizes as cancelled, not waiting_retry', async () => {
    const { jobID } = await createAndClaimJob(WORKER_A);

    // The user cancels while the worker's failing attempt is unwinding — the
    // park write itself must observe the cancel and finalize terminally.
    await pool.query(`UPDATE catalog.background_jobs SET Status = 'cancel_requested' WHERE JobID = ?`, [jobID]);

    const raceError = new Error('transient failure racing a user cancel');
    const result = await markBackgroundJobWaitingRetryAsWorker(pool, jobID, WORKER_A, raceError, 60);

    console.log(
      `[cancel-backstop] result status=${result?.status} phase=${result?.phase} nextAttemptAt=${result?.nextAttemptAt} finishedAt=${result?.finishedAt}`
    );

    expect(result).not.toBeNull();
    expect(result!.status).toBe('cancelled');
    expect(result!.phase).toBe('cancelled');
    expect(result!.finishedAt).toBeInstanceOf(Date);
    expect(result!.nextAttemptAt).toBeNull();
    expect(result!.workerID).toBeNull();

    const details = await getBackgroundJobWithDetails(pool, jobID);
    const cancelledEvent = details!.events.find(e => e.eventType === 'cancelled');
    console.log(`[cancel-backstop] events: ${details!.events.map(e => e.eventType).join(', ')}`);
    expect(cancelledEvent).toBeDefined();

    // The job must NOT be claimable again — cancelled is terminal.
    const reclaim = await claimBackgroundJobForWorker(pool, jobID, WORKER_B);
    expect(reclaim).toBeNull();
  });

  it('throws WorkerLeaseLostError when called by a worker that does not own the lease; row unchanged', async () => {
    const { jobID } = await createAndClaimJob(WORKER_A);

    console.log(`[retry-fence] WORKER_B=${WORKER_B} attempts waiting_retry on jobID=${jobID} owned by WORKER_A=${WORKER_A}`);

    await expect(markBackgroundJobWaitingRetryAsWorker(pool, jobID, WORKER_B, new Error('stale worker write'), 60)).rejects.toThrow(WorkerLeaseLostError);

    const row = await getBackgroundJob(pool, jobID);
    console.log(`[retry-fence] post-reject: status=${row?.status} retryCount=${row?.retryCount} workerID=${row?.workerID}`);
    expect(row!.status).toBe('running');
    expect(row!.retryCount).toBe(0);
    expect(row!.workerID).toBe(WORKER_A);
    expect(row!.lastError).toBeNull();
  });
});

describe('lease fencing — setBackgroundJobStatus', () => {
  it('worker B cannot write to a job owned by worker A — throws WorkerLeaseLostError; row is unchanged', async () => {
    const { jobID } = await createAndClaimJob(WORKER_A);

    console.log(`[fence-status] writing as WORKER_B=${WORKER_B} on jobID=${jobID} owned by WORKER_A=${WORKER_A}`);

    await expect(
      setBackgroundJobStatus(pool, jobID, WORKER_B, {
        status: 'running',
        phase: 'ingestion',
        percentComplete: 50,
        eventType: 'progress'
      })
    ).rejects.toThrow(WorkerLeaseLostError);

    // Row must be unchanged — still in staging phase, 0% complete.
    const row = await getBackgroundJob(pool, jobID);
    console.log(`[fence-status] post-reject: status=${row?.status} phase=${row?.phase} pct=${row?.percentComplete}`);
    expect(row!.phase).toBe('staging');
    expect(row!.percentComplete).toBe(0);
    expect(row!.workerID).toBe(WORKER_A);
  });

  it('worker A can write to its own job', async () => {
    const { jobID } = await createAndClaimJob(WORKER_A);

    await setBackgroundJobStatus(pool, jobID, WORKER_A, {
      status: 'running',
      phase: 'ingestion',
      percentComplete: 42,
      processedRows: 7,
      eventType: 'progress',
      eventMessage: 'Processing batch'
    });

    const row = await getBackgroundJob(pool, jobID);
    console.log(`[fence-status] post-write: status=${row?.status} phase=${row?.phase} pct=${row?.percentComplete}`);
    expect(row!.phase).toBe('ingestion');
    expect(row!.percentComplete).toBe(42);
    expect(row!.processedRows).toBe(7);
  });

  it('no-op write (identical values) by the owning worker does NOT throw', async () => {
    const { jobID } = await createAndClaimJob(WORKER_A);

    // Write specific values once.
    await setBackgroundJobStatus(pool, jobID, WORKER_A, {
      status: 'running',
      phase: 'ingestion',
      percentComplete: 25
    });

    // Write the exact same values again — must not throw.
    await expect(
      setBackgroundJobStatus(pool, jobID, WORKER_A, {
        status: 'running',
        phase: 'ingestion',
        percentComplete: 25
      })
    ).resolves.toBeUndefined();

    const row = await getBackgroundJob(pool, jobID);
    console.log(`[fence-status] no-op: status=${row?.status} phase=${row?.phase} pct=${row?.percentComplete}`);
    expect(row!.percentComplete).toBe(25);
  });
});

describe('lease fencing — updateBackgroundJobFileStatus', () => {
  it('worker B cannot update a file on a job owned by worker A — throws WorkerLeaseLostError', async () => {
    const { jobID, fileIDs } = await createAndClaimJob(WORKER_A);
    const fileID = fileIDs[0];

    console.log(`[fence-file] writing file ${fileID} as WORKER_B on jobID=${jobID} owned by WORKER_A`);

    await expect(
      updateBackgroundJobFileStatus(pool, jobID, WORKER_B, fileID, {
        status: 'staged',
        processedRows: 5
      })
    ).rejects.toThrow(WorkerLeaseLostError);

    // File row must be unchanged.
    const details = await getBackgroundJobWithDetails(pool, jobID);
    const file = details!.files.find(f => f.jobFileID === fileID);
    console.log(`[fence-file] post-reject: file.status=${file?.status} processedRows=${file?.processedRows}`);
    expect(file!.status).toBe('pending');
    expect(file!.processedRows).toBe(0);
  });

  it('worker A can update a file on its own job', async () => {
    const { jobID, fileIDs } = await createAndClaimJob(WORKER_A);
    const fileID = fileIDs[0];

    await updateBackgroundJobFileStatus(pool, jobID, WORKER_A, fileID, {
      status: 'processed',
      processedRows: 10,
      failedRows: 1,
      errorMessage: null
    });

    const details = await getBackgroundJobWithDetails(pool, jobID);
    const file = details!.files.find(f => f.jobFileID === fileID);
    console.log(`[fence-file] post-write: file.status=${file?.status} processedRows=${file?.processedRows}`);
    expect(file!.status).toBe('processed');
    expect(file!.processedRows).toBe(10);
    expect(file!.failedRows).toBe(1);
  });

  it('throws JobFileNotFoundError when jobFileID does not belong to the given job', async () => {
    const { jobID } = await createAndClaimJob(WORKER_A);

    // Use an ID that cannot belong to this job (0 is never a valid auto-increment ID).
    const nonExistentFileID = 0;

    console.log(`[fence-file] writing non-existent fileID=${nonExistentFileID} as WORKER_A on jobID=${jobID}`);

    await expect(
      updateBackgroundJobFileStatus(pool, jobID, WORKER_A, nonExistentFileID, {
        status: 'staged',
        processedRows: 1
      })
    ).rejects.toThrow(JobFileNotFoundError);
  });

  it('no-op file write (identical values) by the owning worker does NOT throw', async () => {
    const { jobID, fileIDs } = await createAndClaimJob(WORKER_A);
    const fileID = fileIDs[0];

    // Write once.
    await updateBackgroundJobFileStatus(pool, jobID, WORKER_A, fileID, {
      status: 'staged',
      processedRows: 3
    });

    // Write the exact same values again — must not throw.
    await expect(
      updateBackgroundJobFileStatus(pool, jobID, WORKER_A, fileID, {
        status: 'staged',
        processedRows: 3
      })
    ).resolves.toBeUndefined();

    const details = await getBackgroundJobWithDetails(pool, jobID);
    const file = details!.files.find(f => f.jobFileID === fileID);
    expect(file!.status).toBe('staged');
    expect(file!.processedRows).toBe(3);
  });
});

describe('lease fencing — heartbeatBackgroundJob', () => {
  it('heartbeat from worker B returns false for a job owned by worker A', async () => {
    const { jobID } = await createAndClaimJob(WORKER_A);

    const result = await heartbeatBackgroundJob(pool, jobID, WORKER_B);
    console.log(`[fence-heartbeat] WORKER_B heartbeat result=${result}`);
    expect(result).toBe(false);
  });

  it('heartbeat from worker A returns true and updates WorkerHeartbeatAt', async () => {
    const { jobID } = await createAndClaimJob(WORKER_A);

    // Small delay to ensure heartbeat timestamp changes.
    await new Promise(resolve => setTimeout(resolve, 1100));

    const beforeRow = await getBackgroundJob(pool, jobID);
    const heartbeatBefore = beforeRow!.workerHeartbeatAt!.getTime();

    const result = await heartbeatBackgroundJob(pool, jobID, WORKER_A);
    console.log(`[fence-heartbeat] WORKER_A heartbeat result=${result}`);
    expect(result).toBe(true);

    const afterRow = await getBackgroundJob(pool, jobID);
    const heartbeatAfter = afterRow!.workerHeartbeatAt!.getTime();
    console.log(`[fence-heartbeat] heartbeatBefore=${heartbeatBefore} heartbeatAfter=${heartbeatAfter}`);
    expect(heartbeatAfter).toBeGreaterThan(heartbeatBefore);
  });

  it('heartbeat succeeds when job is in cancel_requested state (owning worker can still write)', async () => {
    const { jobID } = await createAndClaimJob(WORKER_A);

    // Transition to cancel_requested (the user cancelled while the worker is running).
    await pool.query(`UPDATE catalog.background_jobs SET Status = 'cancel_requested' WHERE JobID = ?`, [jobID]);

    const result = await heartbeatBackgroundJob(pool, jobID, WORKER_A);
    console.log(`[fence-heartbeat] cancel_requested heartbeat result=${result}`);
    expect(result).toBe(true);
  });
});

describe('finalizeJobAsSystem — sweeper recovery', () => {
  it('moves a running job to waiting_retry, clears WorkerID, increments RetryCount', async () => {
    const { jobID } = await createAndClaimJob(WORKER_A);
    const nextAttempt = new Date(Date.now() + 120_000);

    console.log(`[finalize-system] finalizing jobID=${jobID} as waiting_retry`);

    const moved = await finalizeJobAsSystem(pool, jobID, 'waiting_retry', 'Worker heartbeat expired', nextAttempt);
    expect(moved).toBe(true);

    const row = await getBackgroundJob(pool, jobID);
    console.log(`[finalize-system] post-finalize: status=${row?.status} workerID=${row?.workerID} retryCount=${row?.retryCount}`);
    expect(row!.status).toBe('waiting_retry');
    expect(row!.phase).toBe('staging');
    expect(row!.workerID).toBeNull();
    expect(row!.workerHeartbeatAt).toBeNull();
    expect(row!.retryCount).toBe(1);
    expect(row!.lastError).toBe('Worker heartbeat expired');
    expect(row!.nextAttemptAt).toBeInstanceOf(Date);
    expect(row!.finishedAt).toBeNull(); // waiting_retry does NOT set finishedAt

    // Reclaimed event must be logged.
    const details = await getBackgroundJobWithDetails(pool, jobID);
    const reclaimedEvent = details!.events.find(e => e.eventType === 'reclaimed');
    console.log(`[finalize-system] events: ${details!.events.map(e => e.eventType).join(', ')}`);
    expect(reclaimedEvent).toBeDefined();
  });

  it('moves a running job to failed, sets FinishedAt, and increments RetryCount', async () => {
    const { jobID } = await createAndClaimJob(WORKER_A);

    const moved = await finalizeJobAsSystem(pool, jobID, 'failed', 'Worker process crashed');
    expect(moved).toBe(true);

    const row = await getBackgroundJob(pool, jobID);
    console.log(`[finalize-system] post-finalize-failed: status=${row?.status} finishedAt=${row?.finishedAt} retryCount=${row?.retryCount}`);
    expect(row!.status).toBe('failed');
    expect(row!.phase).toBe('failed');
    expect(row!.finishedAt).toBeInstanceOf(Date);
    expect(row!.workerID).toBeNull();
    expect(row!.retryCount).toBe(1);
  });

  it('lease-loss composition: system finalizes running job, original worker then throws WorkerLeaseLostError; job is claimable by new worker', async () => {
    // Worker A claims the job.
    const { jobID } = await createAndClaimJob(WORKER_A);

    console.log(`[lease-composition] jobID=${jobID} claimed by WORKER_A=${WORKER_A}`);

    // System sweeper forcibly recovers the job (simulates heartbeat timeout).
    const finalized = await finalizeJobAsSystem(pool, jobID, 'waiting_retry', 'heartbeat lost');
    expect(finalized).toBe(true);

    const midRow = await getBackgroundJob(pool, jobID);
    console.log(`[lease-composition] after sweeper: status=${midRow?.status} workerID=${midRow?.workerID}`);
    expect(midRow!.status).toBe('waiting_retry');
    expect(midRow!.workerID).toBeNull();

    // Worker A (stale) attempts to write progress — must be rejected with WorkerLeaseLostError.
    // The fenced WHERE requires Status IN ('running', 'cancel_requested') AND WorkerID = WORKER_A.
    // After finalizeJobAsSystem: Status='waiting_retry' and WorkerID=NULL, so neither predicate matches.
    await expect(
      setBackgroundJobStatus(pool, jobID, WORKER_A, {
        status: 'running',
        phase: 'ingestion',
        percentComplete: 80,
        eventType: 'progress',
        eventMessage: 'Stale write from dead worker'
      })
    ).rejects.toThrow(WorkerLeaseLostError);

    const afterStaleWrite = await getBackgroundJob(pool, jobID);
    console.log(`[lease-composition] after stale write attempt: status=${afterStaleWrite?.status} pct=${afterStaleWrite?.percentComplete}`);
    // Row must be unmodified by the stale write.
    expect(afterStaleWrite!.status).toBe('waiting_retry');
    expect(afterStaleWrite!.percentComplete).toBe(0);

    // A new worker B can now claim the job (waiting_retry is claimable when NextAttemptAt is null or past).
    const WORKER_B_CLAIM = 'worker-beta-new-claim-001';
    const reclaimed = await claimBackgroundJobForWorker(pool, jobID, WORKER_B_CLAIM);
    console.log(`[lease-composition] WORKER_B claim result: jobID=${reclaimed?.jobID} workerID=${reclaimed?.workerID}`);
    expect(reclaimed).not.toBeNull();
    expect(reclaimed!.workerID).toBe(WORKER_B_CLAIM);
    expect(reclaimed!.status).toBe('running');
  });

  it('returns false and leaves row untouched when job is already in a terminal state', async () => {
    const job = await createUploadBackgroundJob(pool, makeJobInput(), TEST_USER_A);
    await pool.query(`UPDATE catalog.background_jobs SET Status = 'completed', Phase = 'completed', FinishedAt = NOW() WHERE JobID = ?`, [job.jobID]);

    console.log(`[finalize-system] attempting finalize on completed jobID=${job.jobID}`);

    const moved = await finalizeJobAsSystem(pool, job.jobID, 'failed', 'Should not overwrite');
    expect(moved).toBe(false);

    const row = await getBackgroundJob(pool, job.jobID);
    console.log(`[finalize-system] post-no-op: status=${row?.status}`);
    expect(row!.status).toBe('completed');
    expect(row!.lastError).toBeNull();
  });
});
