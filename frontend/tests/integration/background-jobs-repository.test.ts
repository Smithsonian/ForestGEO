/**
 * Background Jobs Repository — Integration Tests
 *
 * Exercises the repository layer against a real MySQL instance.
 * No mocks — every assertion reflects actual DB state.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run tests/integration/background-jobs-repository.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mysql, { type Pool } from 'mysql2/promise';
import { ensureBackgroundJobCatalogTables } from '@/lib/background-jobs/catalog';
import {
  assignFileBatchID,
  cancelBackgroundJob,
  createUploadBackgroundJob,
  getBackgroundJob,
  getBackgroundJobWithDetails,
  listBackgroundJobs
} from '@/lib/background-jobs/repository';
import type { CreateUploadJobInput } from '@/lib/background-jobs/types';
import { UPLOAD_JOB_MAX_RETRIES } from '@/lib/background-jobs/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
const TEST_DB_PORT = Number(process.env.TEST_DB_PORT || 3306);
const TEST_DB_USER = process.env.TEST_DB_USER || 'root';
const TEST_DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'testpassword';

const TEST_USER_A = 'user-a@forestgeo.test';
const TEST_USER_B = 'user-b@forestgeo.test';

const TEST_SCHEMA = 'forestgeo_testing_bgjobs';
const TEST_PLOT_ID = 1;
const TEST_CENSUS_ID = 2;

const BLOB_CONTAINER = 'forestgeo-testing-storage';

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
