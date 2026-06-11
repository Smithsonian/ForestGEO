import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { ensureBackgroundJobCatalogTables } from './catalog';
import type {
  BackgroundJobEventRecord,
  BackgroundJobFileRecord,
  BackgroundJobRecord,
  BackgroundJobStatus,
  BackgroundJobWithDetails,
  CreateUploadJobInput,
  UploadJobPhase
} from './types';

const ACTIVE_JOB_STATUSES: BackgroundJobStatus[] = ['created', 'queued', 'running', 'waiting_retry'];

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
    maxRetries: Number(row.MaxRetries ?? 0),
    nextAttemptAt: toDate(row.NextAttemptAt),
    lastError: row.LastError ?? null,
    lastMessageID: row.LastMessageID ?? null,
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

export async function createUploadBackgroundJob(catalogPool: Pool, input: CreateUploadJobInput, createdBy: string): Promise<BackgroundJobRecord> {
  await ensureBackgroundJobCatalogTables(catalogPool);

  const conn = await catalogPool.getConnection();
  try {
    await conn.beginTransaction();

    if (input.idempotencyKey) {
      const [existingRows]: any = await conn.query(`SELECT * FROM catalog.background_jobs WHERE CreatedBy = ? AND IdempotencyKey = ? LIMIT 1 FOR UPDATE`, [
        createdBy,
        input.idempotencyKey
      ]);
      if (existingRows.length > 0) {
        await conn.commit();
        return mapJob(existingRows[0]);
      }
    }

    const totalRows = input.files.reduce((sum, file) => sum + Number(file.expectedRows ?? 0), 0);
    const [insertResult] = await conn.query<ResultSetHeader>(
      `INSERT INTO catalog.background_jobs
       (JobType, Status, Phase, SchemaName, PlotID, CensusID, UploadMode, SourceFormat, FormType,
        CreatedBy, IdempotencyKey, TotalFiles, TotalRows, Payload)
       VALUES ('upload_validation', 'created', 'blob_received', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    const jobID = Number(insertResult.insertId);

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

    await addJobEvent(conn, jobID, 'created', 'Upload job created after blob upload completed', {
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

export async function markBackgroundJobQueued(catalogPool: Pool, jobID: number, messageID: string): Promise<void> {
  await ensureBackgroundJobCatalogTables(catalogPool);
  await catalogPool.query(
    `UPDATE catalog.background_jobs
     SET Status = 'queued', Phase = 'queued', LastMessageID = ?, LastError = NULL
     WHERE JobID = ? AND Status IN ('created', 'waiting_retry')`,
    [messageID, jobID]
  );
  await addJobEvent(catalogPool, jobID, 'queued', 'Upload job message sent to queue', { messageID });
}

export async function recordBackgroundJobQueueFailure(catalogPool: Pool, jobID: number, error: Error): Promise<void> {
  await ensureBackgroundJobCatalogTables(catalogPool);
  await catalogPool.query(`UPDATE catalog.background_jobs SET LastError = ? WHERE JobID = ?`, [error.message, jobID]);
  await addJobEvent(catalogPool, jobID, 'queue_failed', error.message);
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
     WHERE JobID = ? AND Status IN ('created', 'queued', 'waiting_retry')`,
    [jobID]
  );
  if (result.affectedRows === 0) return false;
  await addJobEvent(catalogPool, jobID, 'cancelled', 'Upload job cancelled', { cancelledBy });
  return true;
}

export async function setBackgroundJobStatus(
  catalogPool: Pool,
  jobID: number,
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
  const terminal = ['completed', 'failed', 'cancelled', 'dead_lettered'].includes(update.status);
  await catalogPool.query(
    `UPDATE catalog.background_jobs
     SET Status = ?, Phase = ?, PercentComplete = COALESCE(?, PercentComplete),
         ProcessedRows = COALESCE(?, ProcessedRows), FailedRows = COALESCE(?, FailedRows),
         LastError = ?, StartedAt = IF(StartedAt IS NULL AND ? = 'running', NOW(), StartedAt),
         FinishedAt = IF(?, NOW(), FinishedAt)
     WHERE JobID = ?`,
    [
      update.status,
      update.phase,
      update.percentComplete ?? null,
      update.processedRows ?? null,
      update.failedRows ?? null,
      update.lastError ?? null,
      update.status,
      terminal,
      jobID
    ]
  );
  if (update.eventType) {
    await addJobEvent(catalogPool, jobID, update.eventType, update.eventMessage, update.eventDetails);
  }
}

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
     WHERE JobID = ? AND WorkerID = ? AND Status = 'running'`,
    [jobID, workerID]
  );
  return result.affectedRows > 0;
}

export async function markBackgroundJobWaitingRetry(
  catalogPool: Pool,
  jobID: number,
  error: Error,
  retryDelaySeconds: number
): Promise<BackgroundJobRecord | null> {
  await ensureBackgroundJobCatalogTables(catalogPool);
  const job = await getBackgroundJob(catalogPool, jobID);
  if (!job) return null;

  const nextRetryCount = job.retryCount + 1;
  if (nextRetryCount >= job.maxRetries) {
    await catalogPool.query(
      `UPDATE catalog.background_jobs
       SET Status = 'dead_lettered',
           Phase = 'failed',
           RetryCount = ?,
           LastError = ?,
           NextAttemptAt = NULL,
           FinishedAt = NOW()
       WHERE JobID = ?`,
      [nextRetryCount, error.message, jobID]
    );
    await addJobEvent(catalogPool, jobID, 'dead_lettered', error.message, { retryCount: nextRetryCount });
    return getBackgroundJob(catalogPool, jobID);
  }

  const nextAttemptAt = new Date(Date.now() + Math.max(retryDelaySeconds, 1) * 1000);
  await catalogPool.query(
    `UPDATE catalog.background_jobs
     SET Status = 'waiting_retry',
         Phase = 'staging',
         RetryCount = ?,
         LastError = ?,
         NextAttemptAt = ?,
         WorkerID = NULL,
         WorkerHeartbeatAt = NULL
     WHERE JobID = ?`,
    [nextRetryCount, error.message, nextAttemptAt, jobID]
  );
  await addJobEvent(catalogPool, jobID, 'waiting_retry', error.message, { retryCount: nextRetryCount, nextAttemptAt: nextAttemptAt.toISOString() });
  return getBackgroundJob(catalogPool, jobID);
}

export async function markBackgroundJobCompleted(catalogPool: Pool, jobID: number): Promise<void> {
  await setBackgroundJobStatus(catalogPool, jobID, {
    status: 'completed',
    phase: 'completed',
    percentComplete: 100,
    lastError: null,
    eventType: 'completed',
    eventMessage: 'Upload job completed'
  });
}

export async function markBackgroundJobFailed(catalogPool: Pool, jobID: number, error: Error): Promise<void> {
  await setBackgroundJobStatus(catalogPool, jobID, {
    status: 'failed',
    phase: 'failed',
    lastError: error.message,
    eventType: 'failed',
    eventMessage: error.message
  });
}

export async function updateBackgroundJobFileStatus(
  catalogPool: Pool,
  jobFileID: number,
  update: {
    status: BackgroundJobFileRecord['status'];
    processedRows?: number;
    failedRows?: number;
    errorMessage?: string | null;
  }
): Promise<void> {
  await ensureBackgroundJobCatalogTables(catalogPool);
  await catalogPool.query(
    `UPDATE catalog.background_job_files
     SET Status = ?,
         ProcessedRows = COALESCE(?, ProcessedRows),
         FailedRows = COALESCE(?, FailedRows),
         ErrorMessage = ?
     WHERE JobFileID = ?`,
    [update.status, update.processedRows ?? null, update.failedRows ?? null, update.errorMessage ?? null, jobFileID]
  );
}
