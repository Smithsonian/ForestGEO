import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { ensureBackgroundJobCatalogTables } from './catalog';
import { JobFileNotFoundError, WorkerLeaseLostError } from './errors';
import type {
  BackgroundJobEventRecord,
  BackgroundJobFileRecord,
  BackgroundJobRecord,
  BackgroundJobStatus,
  BackgroundJobWithDetails,
  CreateUploadJobInput,
  UploadJobPhase
} from './types';
import { UPLOAD_JOB_MAX_RETRIES, UPLOAD_JOB_PHASE_PROGRESS } from './types';

// Statuses in which a worker lease is considered active. cancel_requested is
// included so the owning worker can still write cleanup progress and the
// terminal 'cancelled' state before releasing the lease.
const FENCED_WRITE_STATUSES = ['running', 'cancel_requested'] as const;

const ACTIVE_JOB_STATUSES: BackgroundJobStatus[] = ['queued', 'running', 'cancel_requested', 'waiting_retry'];

// MySQL error number for duplicate key violations (ER_DUP_ENTRY).
const MYSQL_ERRNO_DUPLICATE_ENTRY = 1062;

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(String(value));
}

function mapJob(row: any): BackgroundJobRecord {
  return {
    jobID: Number(row.JobID),
    jobType: row.JobType,
    status: row.Status,
    phase: row.Phase,
    schemaName: row.SchemaName,
    plotID: Number(row.PlotID),
    censusID: Number(row.CensusID),
    uploadMode: row.UploadMode ?? null,
    sourceFormat: row.SourceFormat ?? null,
    formType: row.FormType ?? null,
    createdBy: row.CreatedBy,
    idempotencyKey: row.IdempotencyKey ?? null,
    percentComplete: Number(row.PercentComplete ?? 0),
    totalFiles: Number(row.TotalFiles ?? 0),
    totalRows: Number(row.TotalRows ?? 0),
    processedRows: Number(row.ProcessedRows ?? 0),
    failedRows: Number(row.FailedRows ?? 0),
    retryCount: Number(row.RetryCount ?? 0),
    maxRetries: Number(row.MaxRetries ?? UPLOAD_JOB_MAX_RETRIES),
    nextAttemptAt: toDate(row.NextAttemptAt),
    lastError: row.LastError ?? null,
    workerID: row.WorkerID ?? null,
    workerHeartbeatAt: toDate(row.WorkerHeartbeatAt),
    payload: parseJsonObject(row.Payload),
    createdAt: toDate(row.CreatedAt) ?? new Date(0),
    updatedAt: toDate(row.UpdatedAt) ?? new Date(0),
    startedAt: toDate(row.StartedAt),
    finishedAt: toDate(row.FinishedAt)
  };
}

function mapFile(row: any): BackgroundJobFileRecord {
  return {
    jobFileID: Number(row.JobFileID),
    jobID: Number(row.JobID),
    fileName: row.FileName,
    blobContainer: row.BlobContainer,
    blobName: row.BlobName,
    contentType: row.ContentType ?? null,
    byteSize: row.ByteSize === null || row.ByteSize === undefined ? null : Number(row.ByteSize),
    checksumSha256: row.ChecksumSHA256 ?? null,
    sourceFormat: row.SourceFormat ?? null,
    formType: row.FormType ?? null,
    batchID: row.BatchID ?? null,
    expectedRows: row.ExpectedRows === null || row.ExpectedRows === undefined ? null : Number(row.ExpectedRows),
    processedRows: Number(row.ProcessedRows ?? 0),
    failedRows: Number(row.FailedRows ?? 0),
    status: row.Status,
    errorMessage: row.ErrorMessage ?? null,
    createdAt: toDate(row.CreatedAt) ?? new Date(0),
    updatedAt: toDate(row.UpdatedAt) ?? new Date(0)
  };
}

function mapEvent(row: any): BackgroundJobEventRecord {
  return {
    eventID: Number(row.EventID),
    jobID: Number(row.JobID),
    eventType: row.EventType,
    message: row.Message ?? null,
    details: parseJsonObject(row.Details),
    createdAt: toDate(row.CreatedAt) ?? new Date(0)
  };
}

async function addJobEvent(conn: Pool | PoolConnection, jobID: number, eventType: string, message?: string, details?: Record<string, unknown>): Promise<void> {
  await conn.query(`INSERT INTO catalog.background_job_events (JobID, EventType, Message, Details) VALUES (?, ?, ?, ?)`, [
    jobID,
    eventType,
    message ?? null,
    details ? JSON.stringify(details) : null
  ]);
}

/**
 * Confirms that a worker still holds the lease on a job. Returns true when the
 * lease is intact, false when it is not.
 *
 * This pool runs with mysql2's default CLIENT_FOUND_ROWS flag, so UPDATE
 * affectedRows counts matched rows, not changed rows. affectedRows=0 on a
 * fenced UPDATE therefore means the WHERE predicate (JobID + WorkerID + Status
 * IN fenced list) did not match — i.e., the lease was lost. This confirm
 * SELECT exists for two reasons:
 *   (a) Defense-in-depth in case pool flags change and affectedRows reverts to
 *       "changed rows" semantics (a no-op write would then return 0 even with
 *       the lease intact).
 *   (b) Disambiguation for caller bugs in updateBackgroundJobFileStatus, where
 *       a lease-intact + affectedRows=0 result can also indicate a missing or
 *       mis-routed file record.
 */
async function isLeaseIntact(conn: Pool | PoolConnection, jobID: number, workerID: string): Promise<boolean> {
  const [rows]: any = await conn.query(
    `SELECT 1 FROM catalog.background_jobs WHERE JobID = ? AND WorkerID = ? AND Status IN (${FENCED_WRITE_STATUSES.map(() => '?').join(', ')}) LIMIT 1`,
    [jobID, workerID, ...FENCED_WRITE_STATUSES]
  );
  return (rows as unknown[]).length > 0;
}

export async function createUploadBackgroundJob(catalogPool: Pool, input: CreateUploadJobInput, createdBy: string): Promise<BackgroundJobRecord> {
  await ensureBackgroundJobCatalogTables(catalogPool);

  const conn = await catalogPool.getConnection();
  try {
    await conn.beginTransaction();

    const totalRows = input.files.reduce((sum, file) => sum + Number(file.expectedRows ?? 0), 0);
    let jobID: number;
    try {
      const [insertResult] = await conn.query<ResultSetHeader>(
        `INSERT INTO catalog.background_jobs
         (JobType, Status, Phase, SchemaName, PlotID, CensusID, UploadMode, SourceFormat, FormType,
          CreatedBy, IdempotencyKey, TotalFiles, TotalRows, Payload)
         VALUES ('upload_validation', 'queued', 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.schema,
          input.plotID,
          input.censusID,
          input.uploadMode ?? null,
          input.sourceFormat ?? null,
          input.formType ?? null,
          createdBy,
          input.idempotencyKey ?? null,
          input.files.length,
          totalRows,
          input.payload ? JSON.stringify(input.payload) : null
        ]
      );
      jobID = Number(insertResult.insertId);
    } catch (err: any) {
      if (err?.errno === MYSQL_ERRNO_DUPLICATE_ENTRY && input.idempotencyKey) {
        await conn.rollback();
        const [existingRows]: any = await conn.query(`SELECT * FROM catalog.background_jobs WHERE CreatedBy = ? AND IdempotencyKey = ? LIMIT 1`, [
          createdBy,
          input.idempotencyKey
        ]);
        if (existingRows.length > 0) return mapJob(existingRows[0]);
      }
      throw err;
    }

    for (const file of input.files) {
      await conn.query(
        `INSERT INTO catalog.background_job_files
         (JobID, FileName, BlobContainer, BlobName, ContentType, ByteSize, ChecksumSHA256,
          SourceFormat, FormType, ExpectedRows)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          jobID,
          file.fileName,
          file.blobContainer,
          file.blobName,
          file.contentType ?? null,
          file.byteSize ?? null,
          file.checksumSha256 ?? null,
          file.sourceFormat ?? input.sourceFormat ?? null,
          file.formType ?? input.formType ?? null,
          file.expectedRows ?? null
        ]
      );
    }

    await addJobEvent(conn, jobID, 'queued', 'Upload job created and queued', {
      fileCount: input.files.length,
      totalRows
    });
    await conn.commit();

    const job = await getBackgroundJob(catalogPool, jobID);
    if (!job) throw new Error(`Background job ${jobID} was created but could not be loaded`);
    return job;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function getBackgroundJob(catalogPool: Pool, jobID: number): Promise<BackgroundJobRecord | null> {
  await ensureBackgroundJobCatalogTables(catalogPool);
  const [rows]: any = await catalogPool.query(`SELECT * FROM catalog.background_jobs WHERE JobID = ?`, [jobID]);
  return rows.length > 0 ? mapJob(rows[0]) : null;
}

export async function getBackgroundJobWithDetails(catalogPool: Pool, jobID: number): Promise<BackgroundJobWithDetails | null> {
  const job = await getBackgroundJob(catalogPool, jobID);
  if (!job) return null;

  const [fileRows]: any = await catalogPool.query(`SELECT * FROM catalog.background_job_files WHERE JobID = ? ORDER BY JobFileID`, [jobID]);
  const [eventRows]: any = await catalogPool.query(`SELECT * FROM catalog.background_job_events WHERE JobID = ? ORDER BY EventID DESC LIMIT 100`, [jobID]);

  return {
    ...job,
    files: fileRows.map(mapFile),
    events: eventRows.map(mapEvent)
  };
}

export interface ListBackgroundJobsOptions {
  userID: string;
  includeAllUsers?: boolean;
  activeOnly?: boolean;
  schema?: string;
  plotID?: number;
  censusID?: number;
  limit?: number;
}

export async function listBackgroundJobs(catalogPool: Pool, options: ListBackgroundJobsOptions): Promise<BackgroundJobRecord[]> {
  await ensureBackgroundJobCatalogTables(catalogPool);

  const where: string[] = [];
  const params: unknown[] = [];

  if (!options.includeAllUsers) {
    where.push('CreatedBy = ?');
    params.push(options.userID);
  }
  if (options.activeOnly !== false) {
    where.push(`Status IN (${ACTIVE_JOB_STATUSES.map(() => '?').join(', ')})`);
    params.push(...ACTIVE_JOB_STATUSES);
  }
  if (options.schema) {
    where.push('SchemaName = ?');
    params.push(options.schema);
  }
  if (options.plotID !== undefined) {
    where.push('PlotID = ?');
    params.push(options.plotID);
  }
  if (options.censusID !== undefined) {
    where.push('CensusID = ?');
    params.push(options.censusID);
  }

  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  params.push(limit);

  const [rows]: any = await catalogPool.query(
    `SELECT * FROM catalog.background_jobs
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY UpdatedAt DESC, JobID DESC
     LIMIT ?`,
    params
  );

  return rows.map(mapJob);
}

export async function cancelBackgroundJob(catalogPool: Pool, jobID: number, cancelledBy: string): Promise<boolean> {
  await ensureBackgroundJobCatalogTables(catalogPool);
  const [result] = await catalogPool.query<ResultSetHeader>(
    `UPDATE catalog.background_jobs
     SET Status = 'cancelled', Phase = 'cancelled', FinishedAt = NOW(), LastError = NULL
     WHERE JobID = ? AND Status IN ('queued', 'waiting_retry')`,
    [jobID]
  );
  if (result.affectedRows === 0) return false;
  await addJobEvent(catalogPool, jobID, 'cancelled', 'Upload job cancelled', { cancelledBy });
  return true;
}

export async function setBackgroundJobStatus(
  catalogPool: Pool,
  jobID: number,
  workerID: string,
  update: {
    status: BackgroundJobStatus;
    phase: UploadJobPhase;
    percentComplete?: number;
    processedRows?: number;
    failedRows?: number;
    lastError?: string | null;
    eventType?: string;
    eventMessage?: string;
    eventDetails?: Record<string, unknown>;
  }
): Promise<void> {
  await ensureBackgroundJobCatalogTables(catalogPool);
  const terminalStatuses: BackgroundJobStatus[] = ['completed', 'failed', 'cancelled'];
  const terminal = terminalStatuses.includes(update.status);
  // Status is "sticky" for cancel_requested: a progress write (status='running')
  // from the owning worker must NOT flip a cancel_requested job back to running,
  // or a user's cancellation racing a progress update would be silently lost.
  // The worker only observes cancellation at stage boundaries, so progress
  // writes can land while the cancel flag is set. Terminal/explicit statuses
  // (cancelled/failed/completed/waiting_retry) still overwrite normally.
  const [result] = await catalogPool.query<ResultSetHeader>(
    `UPDATE catalog.background_jobs
     SET Status = IF(Status = 'cancel_requested' AND ? = 'running', 'cancel_requested', ?),
         Phase = ?, PercentComplete = COALESCE(?, PercentComplete),
         ProcessedRows = COALESCE(?, ProcessedRows), FailedRows = COALESCE(?, FailedRows),
         LastError = ?, StartedAt = IF(StartedAt IS NULL AND ? = 'running', NOW(), StartedAt),
         FinishedAt = IF(?, NOW(), FinishedAt)
     WHERE JobID = ? AND WorkerID = ? AND Status IN (${FENCED_WRITE_STATUSES.map(() => '?').join(', ')})`,
    [
      update.status,
      update.status,
      update.phase,
      update.percentComplete ?? null,
      update.processedRows ?? null,
      update.failedRows ?? null,
      update.lastError ?? null,
      update.status,
      terminal,
      jobID,
      workerID,
      ...FENCED_WRITE_STATUSES
    ]
  );
  if (result.affectedRows === 0) {
    // Under this pool's CLIENT_FOUND_ROWS flag affectedRows counts matched rows,
    // so 0 strictly means the lease predicate (JobID + WorkerID + Status IN
    // fenced list) did not match. The isLeaseIntact confirm below exists as
    // defense-in-depth if pool flags ever change (fix a) and to aid caller-bug
    // disambiguation in updateBackgroundJobFileStatus (fix b).
    const leaseIntact = await isLeaseIntact(catalogPool, jobID, workerID);
    if (!leaseIntact) throw new WorkerLeaseLostError(jobID, workerID);
    // Lease is intact — under current pool flags this path is only reachable if
    // flags change and affectedRows reverts to "changed rows" semantics.
    // Accept silently; skip event to avoid duplicate progress entries on retry.
    return;
  }
  if (update.eventType) {
    await addJobEvent(catalogPool, jobID, update.eventType, update.eventMessage, update.eventDetails);
  }
}

/**
 * Atomically claims a queued or waiting_retry job for the given worker. Returns
 * the job with its files on success, or null if the job is not claimable (wrong
 * status, NextAttemptAt in the future, or does not exist).
 *
 * INVARIANT: workerID MUST be unique per claim attempt, e.g.
 *   `${process.pid}:${randomUUID()}`
 * The confirm-then-throw fencing pattern in setBackgroundJobStatus and
 * updateBackgroundJobFileStatus is race-free only when this invariant holds. If
 * the same workerID is reused across claim attempts, a re-claim that races
 * between the fenced UPDATE and its subsequent isLeaseIntact confirm SELECT
 * would appear as a lease-intact no-op, silently swallowing a lost write.
 */
export async function claimBackgroundJobForWorker(catalogPool: Pool, jobID: number, workerID: string): Promise<BackgroundJobWithDetails | null> {
  await ensureBackgroundJobCatalogTables(catalogPool);
  const [result] = await catalogPool.query<ResultSetHeader>(
    `UPDATE catalog.background_jobs
     SET Status = 'running',
         Phase = 'staging',
         WorkerID = ?,
         WorkerHeartbeatAt = NOW(),
         StartedAt = COALESCE(StartedAt, NOW()),
         LastError = NULL
     WHERE JobID = ?
       AND Status IN ('queued', 'waiting_retry')
       AND (NextAttemptAt IS NULL OR NextAttemptAt <= NOW())`,
    [workerID, jobID]
  );

  if (result.affectedRows === 0) return null;
  await addJobEvent(catalogPool, jobID, 'claimed', 'Upload job claimed by worker', { workerID });
  return getBackgroundJobWithDetails(catalogPool, jobID);
}

export async function heartbeatBackgroundJob(catalogPool: Pool, jobID: number, workerID: string): Promise<boolean> {
  await ensureBackgroundJobCatalogTables(catalogPool);
  const [result] = await catalogPool.query<ResultSetHeader>(
    `UPDATE catalog.background_jobs
     SET WorkerHeartbeatAt = NOW()
     WHERE JobID = ? AND WorkerID = ? AND Status IN (${FENCED_WRITE_STATUSES.map(() => '?').join(', ')})`,
    [jobID, workerID, ...FENCED_WRITE_STATUSES]
  );
  return result.affectedRows > 0;
}

export interface WaitingRetryOptions {
  /**
   * When false the transition does not consume retry budget. Used for external
   * contention (an interactive upload session or validation run owns the
   * plot/census scope) where the job itself did nothing wrong. Defaults to true.
   */
  incrementRetry?: boolean;
}

/**
 * Fenced worker transition to waiting_retry — or directly to failed when the
 * retry budget is exhausted. The RetryCount arithmetic and the
 * failed-vs-waiting_retry decision both live IN the UPDATE statement so the
 * read-decide-write race of the old unfenced markBackgroundJobWaitingRetry
 * cannot occur.
 *
 * CANCEL BACKSTOP: if the user requested cancellation while the failing
 * attempt was unwinding (Status='cancel_requested'), parking the job to
 * waiting_retry would silently erase the cancel. The worker re-checks status
 * before calling this, but the check races a concurrent cancel — so the SQL
 * itself finalizes the job as terminal 'cancelled' in that case.
 *
 * MySQL evaluates SET assignments left-to-right and later assignments observe
 * earlier ones. Two columns are therefore assigned at the END, after every
 * expression that needs their PRE-update values:
 *   - Status is second-to-last (Phase/NextAttemptAt/FinishedAt all branch on
 *     the pre-update Status for the cancel backstop), and
 *   - RetryCount is last (every earlier expression recomputes the prospective
 *     value RetryCount + IF(increment,1,0) against the pre-update column).
 *
 * Throws WorkerLeaseLostError when the caller no longer owns the lease
 * (confirm-then-throw, same pattern as setBackgroundJobStatus).
 */
export async function markBackgroundJobWaitingRetryAsWorker(
  catalogPool: Pool,
  jobID: number,
  workerID: string,
  error: Error,
  retryDelaySeconds: number,
  opts: WaitingRetryOptions = {}
): Promise<BackgroundJobRecord | null> {
  await ensureBackgroundJobCatalogTables(catalogPool);
  const incrementRetry = opts.incrementRetry !== false;
  const nextAttemptAt = new Date(Date.now() + Math.max(retryDelaySeconds, 1) * 1000);

  const [result] = await catalogPool.query<ResultSetHeader>(
    `UPDATE catalog.background_jobs
     SET Phase = IF(Status = 'cancel_requested', 'cancelled', IF(RetryCount + IF(?, 1, 0) >= MaxRetries, 'failed', 'staging')),
         LastError = ?,
         NextAttemptAt = IF(Status = 'cancel_requested' OR RetryCount + IF(?, 1, 0) >= MaxRetries, NULL, ?),
         FinishedAt = IF(Status = 'cancel_requested' OR RetryCount + IF(?, 1, 0) >= MaxRetries, NOW(), FinishedAt),
         WorkerID = NULL,
         WorkerHeartbeatAt = NULL,
         Status = IF(Status = 'cancel_requested', 'cancelled', IF(RetryCount + IF(?, 1, 0) >= MaxRetries, 'failed', 'waiting_retry')),
         RetryCount = RetryCount + IF(?, 1, 0)
     WHERE JobID = ? AND WorkerID = ? AND Status IN (${FENCED_WRITE_STATUSES.map(() => '?').join(', ')})`,
    [incrementRetry, error.message, incrementRetry, nextAttemptAt, incrementRetry, incrementRetry, incrementRetry, jobID, workerID, ...FENCED_WRITE_STATUSES]
  );

  if (result.affectedRows === 0) {
    // See setBackgroundJobStatus for the CLIENT_FOUND_ROWS rationale: 0 matched
    // rows means the lease predicate did not match. Confirm before throwing.
    const leaseIntact = await isLeaseIntact(catalogPool, jobID, workerID);
    if (!leaseIntact) throw new WorkerLeaseLostError(jobID, workerID);
    return getBackgroundJob(catalogPool, jobID);
  }

  const job = await getBackgroundJob(catalogPool, jobID);
  const eventType = job?.status === 'failed' ? 'failed' : job?.status === 'cancelled' ? 'cancelled' : 'waiting_retry';
  await addJobEvent(catalogPool, jobID, eventType, error.message, {
    retryCount: job?.retryCount ?? null,
    incrementRetry,
    nextAttemptAt: job?.status === 'waiting_retry' ? nextAttemptAt.toISOString() : null
  });
  return job;
}

export async function markBackgroundJobCompleted(catalogPool: Pool, jobID: number, workerID: string): Promise<void> {
  await setBackgroundJobStatus(catalogPool, jobID, workerID, {
    status: 'completed',
    phase: 'completed',
    percentComplete: UPLOAD_JOB_PHASE_PROGRESS.completed,
    lastError: null,
    eventType: 'completed',
    eventMessage: 'Upload job completed'
  });
}

export async function markBackgroundJobFailed(catalogPool: Pool, jobID: number, workerID: string, error: Error): Promise<void> {
  await setBackgroundJobStatus(catalogPool, jobID, workerID, {
    status: 'failed',
    phase: 'failed',
    lastError: error.message,
    eventType: 'failed',
    eventMessage: error.message
  });
}

/**
 * Unfenced transition used by the sweeper to recover jobs whose worker died.
 * Unlike the fenced writes, this does NOT require the caller to own the lease.
 * It guards its WHERE with Status = 'running' to prevent stomping terminal
 * states (completed/failed/cancelled/waiting_retry are all left untouched).
 *
 * Returns true when the job was moved, false when the guard prevented the
 * update (job is not in 'running' state or does not exist).
 */
export async function finalizeJobAsSystem(
  catalogPool: Pool,
  jobID: number,
  status: 'failed' | 'waiting_retry',
  reason: string,
  nextAttemptAt?: Date
): Promise<boolean> {
  await ensureBackgroundJobCatalogTables(catalogPool);
  const phase = status === 'failed' ? 'failed' : 'staging';
  const isTerminal = status === 'failed';
  const [result] = await catalogPool.query<ResultSetHeader>(
    `UPDATE catalog.background_jobs
     SET Status = ?,
         Phase = ?,
         LastError = ?,
         WorkerID = NULL,
         WorkerHeartbeatAt = NULL,
         NextAttemptAt = ?,
         RetryCount = RetryCount + 1,
         FinishedAt = IF(?, NOW(), FinishedAt),
         UpdatedAt = NOW()
     WHERE JobID = ? AND Status = 'running'`,
    [status, phase, reason, nextAttemptAt ?? null, isTerminal, jobID]
  );
  if (result.affectedRows === 0) return false;
  await addJobEvent(catalogPool, jobID, 'reclaimed', reason, { finalStatus: status, nextAttemptAt: nextAttemptAt?.toISOString() ?? null });
  return true;
}

export interface StaleRunningJob {
  jobID: number;
  retryCount: number;
  maxRetries: number;
}

/**
 * Sweeper reclaim query: 'running' jobs whose worker heartbeat is missing or
 * older than staleSeconds. Pure read — the caller decides waiting_retry vs
 * failed from retryCount/maxRetries and applies it via finalizeJobAsSystem.
 */
export async function findStaleRunningJobs(catalogPool: Pool, staleSeconds: number): Promise<StaleRunningJob[]> {
  await ensureBackgroundJobCatalogTables(catalogPool);
  const [rows]: any = await catalogPool.query(
    `SELECT JobID, RetryCount, MaxRetries FROM catalog.background_jobs
     WHERE Status = 'running'
       AND (WorkerHeartbeatAt IS NULL OR WorkerHeartbeatAt < NOW() - INTERVAL ? SECOND)
     ORDER BY JobID`,
    [staleSeconds]
  );
  return rows.map((row: any) => ({
    jobID: Number(row.JobID),
    retryCount: Number(row.RetryCount ?? 0),
    maxRetries: Number(row.MaxRetries ?? UPLOAD_JOB_MAX_RETRIES)
  }));
}

/**
 * Sweeper dispatch query: jobs a worker could claim right now — queued, or
 * waiting_retry whose NextAttemptAt has passed (or was never set). Ordered by
 * JobID so older jobs are dispatched first.
 */
export async function findRunnableJobIDs(catalogPool: Pool, limit: number): Promise<number[]> {
  await ensureBackgroundJobCatalogTables(catalogPool);
  const [rows]: any = await catalogPool.query(
    `SELECT JobID FROM catalog.background_jobs
     WHERE Status = 'queued'
        OR (Status = 'waiting_retry' AND (NextAttemptAt IS NULL OR NextAttemptAt <= NOW()))
     ORDER BY JobID
     LIMIT ?`,
    [limit]
  );
  return rows.map((row: any) => Number(row.JobID));
}

export async function updateBackgroundJobFileStatus(
  catalogPool: Pool,
  jobID: number,
  workerID: string,
  jobFileID: number,
  update: {
    status: BackgroundJobFileRecord['status'];
    processedRows?: number;
    failedRows?: number;
    errorMessage?: string | null;
  }
): Promise<void> {
  await ensureBackgroundJobCatalogTables(catalogPool);
  const [result] = await catalogPool.query<ResultSetHeader>(
    `UPDATE catalog.background_job_files f
     JOIN catalog.background_jobs j ON j.JobID = f.JobID
     SET f.Status = ?,
         f.ProcessedRows = COALESCE(?, f.ProcessedRows),
         f.FailedRows = COALESCE(?, f.FailedRows),
         f.ErrorMessage = ?
     WHERE f.JobFileID = ? AND j.JobID = ? AND j.WorkerID = ? AND j.Status IN (${FENCED_WRITE_STATUSES.map(() => '?').join(', ')})`,
    [update.status, update.processedRows ?? null, update.failedRows ?? null, update.errorMessage ?? null, jobFileID, jobID, workerID, ...FENCED_WRITE_STATUSES]
  );
  if (result.affectedRows === 0) {
    // Under this pool's CLIENT_FOUND_ROWS flag, affectedRows=0 means the WHERE
    // predicate didn't match at all. The lease confirm below distinguishes two
    // failure modes:
    //   - Lease lost: WorkerID or Status predicate failed → throw WorkerLeaseLostError
    //   - Lease intact + file missing: caller bug (wrong jobFileID or jobID) → throw JobFileNotFoundError
    //   - Lease intact + file present: only reachable if pool flags change and
    //     affectedRows reverts to "changed rows" semantics (no-op write) → accept silently
    const leaseIntact = await isLeaseIntact(catalogPool, jobID, workerID);
    if (!leaseIntact) throw new WorkerLeaseLostError(jobID, workerID);
    const [fileRows]: any = await catalogPool.query(`SELECT 1 FROM catalog.background_job_files WHERE JobFileID = ? AND JobID = ?`, [jobFileID, jobID]);
    if ((fileRows as unknown[]).length === 0) throw new JobFileNotFoundError(jobID, jobFileID);
    // File exists and lease is intact — genuine no-op (only reachable if pool flags change).
  }
}

/**
 * Assigns a BatchID to a file record. The first caller wins — subsequent calls
 * with a different value are ignored and the original BatchID is returned.
 * This durability guarantee means retrying workers always use the same batch.
 */
export async function assignFileBatchID(catalogPool: Pool, jobFileID: number, batchID: string): Promise<string> {
  await ensureBackgroundJobCatalogTables(catalogPool);
  // Only update when no BatchID has been assigned yet (first assignment wins).
  await catalogPool.query(`UPDATE catalog.background_job_files SET BatchID = ? WHERE JobFileID = ? AND BatchID IS NULL`, [batchID, jobFileID]);
  const [rows]: any = await catalogPool.query(`SELECT BatchID FROM catalog.background_job_files WHERE JobFileID = ?`, [jobFileID]);
  if (rows.length === 0) throw new Error(`background_job_files row ${jobFileID} not found`);
  return rows[0].BatchID as string;
}
