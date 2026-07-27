/**
 * In-process background upload worker (async-upload remediation Task 10).
 *
 * runJobIfClaimable is the single entry point: it claims a queued/waiting_retry
 * job with a per-claim-unique worker ID, registers an upload session for the
 * plot/census scope, runs the form-type-specific pipeline through the shared
 * lib/uploads mechanisms (stageMeasurementChunk, ingestBatch, collapseCensus,
 * runCensusValidations, commitArcgisImport), and finalizes the job through the
 * fenced repository writes. No HTTP anywhere — every step is a direct call.
 *
 * Crash recovery is keyed on uploadmetrics: each file's BatchID is assigned
 * durably (first write wins) and a batch whose uploadmetrics row reached
 * status='completed' is skipped ENTIRELY on retry — no cleanup, no re-staging,
 * no re-ingestion. The order is load-bearing: under the same
 * (UploadFileID, UploadBatchID), coremeasurements holds both the worker's parse
 * rejects and the stored procedure's recorded failure rows (all StemGUID NULL);
 * cleaning a completed batch would permanently destroy the procedure's recorded
 * failures because the idempotent re-run never regenerates them.
 */
import { randomUUID } from 'node:crypto';
import Papa from 'papaparse';
import type { Pool } from 'mysql2/promise';
import ailogger from '@/ailogger';
import ConnectionManager from '@/config/connectionmanager';
import { getPoolMonitorInstance } from '@/config/poolmonitorsingleton';
import { getContainerClient } from '@/config/macros/azurestorage';
import { FileRow, SourceFormat } from '@/config/macros/formdetails';
import { generateShortBatchID } from '@/config/utils';
import { normalizeUploadMode } from '@/config/uploadmodes';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import {
  createUploadSession,
  ensureUploadSessionsTable,
  findActiveSessionsForPlotCensus,
  isUploadSessionStale,
  sendHeartbeat,
  updateSessionState,
  UploadSessionOwnershipError,
  UploadSessionState
} from '@/config/uploadsessiontracker';
import { ArcgisImportSessionError } from '@/lib/arcgis/import-session';
import type { ColumnMapping } from '@/lib/column-mapping/types';
import { commitArcgisImport } from '@/lib/uploads/arcgis-commit';
import { collapseCensus } from '@/lib/uploads/collapse-census';
import { detectDelimiter } from '@/lib/uploads/detect-delimiter';
import { ingestBatch, IngestBatchAbortedError } from '@/lib/uploads/ingest-batch';
import { deleteUnresolvedRowsForBatch, recordInvalidRows } from '@/lib/uploads/record-invalid-rows';
import { countStagedRows, MeasurementChunkResolutionError, stageMeasurementChunk } from '@/lib/uploads/stage-measurements';
import { runCensusValidations } from '@/lib/uploads/validation-orchestrator';
import { NonRetryableJobError, WorkerLeaseLostError } from './errors';
import {
  assignFileBatchID,
  claimBackgroundJobForWorker,
  getBackgroundJob,
  heartbeatBackgroundJob,
  markBackgroundJobCompleted,
  markBackgroundJobFailed,
  markBackgroundJobWaitingRetryAsWorker,
  setBackgroundJobStatus,
  updateBackgroundJobFileStatus
} from './repository';
import type { BackgroundJobFileRecord, BackgroundJobWithDetails, UploadJobPhase } from './types';
import { isAllowedAsyncPipeline, UPLOAD_JOB_PHASE_PROGRESS } from './types';

export { UPLOAD_JOB_PHASE_PROGRESS } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Interval between lease heartbeats while a worker owns a job. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * A lease whose WorkerHeartbeatAt is older than
 * HEARTBEAT_INTERVAL_MS * STALE_LEASE_MULTIPLIER is considered abandoned and
 * may be reclaimed by the sweeper via finalizeJobAsSystem.
 */
export const STALE_LEASE_MULTIPLIER = 3;
export const STALE_LEASE_THRESHOLD_MS = HEARTBEAT_INTERVAL_MS * STALE_LEASE_MULTIPLIER;

/** Rows staged per worker-owned transaction (env override BACKGROUND_UPLOAD_CHUNK_ROWS). */
const DEFAULT_CHUNK_ROWS = 5_000;

/** Base for the exponential retry delay: base * 2^RetryCount seconds. */
export const RETRY_BASE_DELAY_SECONDS = 60;
const RETRY_BACKOFF_BASE = 2;

/**
 * Short park delay used when an external party owns the plot/census scope (an
 * interactive upload session or a fresh validation run). These transitions do
 * NOT consume retry budget — the job did nothing wrong.
 */
export const SESSION_CONFLICT_RETRY_DELAY_SECONDS = 120;

/**
 * Job EVENT rows are only written for every Nth staged chunk; percent and
 * processedRows still update on every chunk. Without sampling, a million-row
 * file at 5K rows/chunk would write 200 near-identical event rows.
 */
export const CHUNK_EVENT_SAMPLE_RATE = 10;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface WorkerDeps {
  fetchFileText: (file: BackgroundJobFileRecord) => Promise<string>;
}

/**
 * Claims and runs a background upload job. A non-claimable job (wrong status,
 * NextAttemptAt in the future, missing) is a silent no-op so the kick route and
 * the sweeper can race safely. Never throws: every failure mode is recorded on
 * the job row through the fenced repository writes.
 */
export async function runJobIfClaimable(jobID: number, deps?: WorkerDeps): Promise<void> {
  const catalogPool = getPoolMonitorInstance().pool;
  // REQUIRED claim invariant (see claimBackgroundJobForWorker): worker IDs must
  // be unique per claim attempt or the confirm-then-throw fencing is racy.
  const workerID = `${process.pid}:${randomUUID()}`;

  const job = await claimBackgroundJobForWorker(catalogPool, jobID, workerID);
  if (!job) {
    ailogger.info(`[UploadWorker] Job ${jobID} is not claimable; skipping`);
    return;
  }

  const ctx: WorkerRunContext = {
    catalogPool,
    connectionManager: ConnectionManager.getInstance(),
    job,
    workerID,
    deps: deps ?? { fetchFileText: downloadBlobText },
    sessionID: null,
    leaseLost: false,
    cancelRequested: false,
    processedRows: 0,
    failedRows: 0,
    lastPercent: 0,
    assignedBatches: new Map(),
    deferredInvalidRows: [],
    heartbeatTimer: null
  };

  startHeartbeat(ctx);
  let completed = false;
  try {
    await setProgress(ctx, 'staging', UPLOAD_JOB_PHASE_PROGRESS.claimed, `Worker ${workerID} started processing`);
    ctx.sessionID = await registerUploadSession(ctx);

    const pipeline = resolveJobPipeline(job);
    if (pipeline === 'arcgis_xlsx') {
      await runArcgisPipeline(ctx);
    } else {
      await runMeasurementsPipeline(ctx);
    }
    await runPostIngestionPhases(ctx);

    await assertStillOwned(ctx);
    await markBackgroundJobCompleted(catalogPool, jobID, workerID);
    completed = true;
  } catch (error) {
    await handleRunFailure(ctx, error);
  } finally {
    stopHeartbeat(ctx);
    await releaseUploadSession(ctx, completed);
  }
}

// ---------------------------------------------------------------------------
// Internal signals
// ---------------------------------------------------------------------------

/** Raised after the job has already been finalized as 'cancelled'. */
class JobCancelledSignal extends Error {
  constructor(jobID: number) {
    super(`Upload job ${jobID} was cancelled`);
    this.name = 'JobCancelledSignal';
  }
}

/**
 * Raised when the plot/census scope is owned by another party (interactive
 * upload session or active validation run). Mapped to waiting_retry with
 * SESSION_CONFLICT_RETRY_DELAY_SECONDS and NO RetryCount increment.
 */
class UploadScopeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadScopeConflictError';
  }
}

// ---------------------------------------------------------------------------
// Run context and lifecycle helpers
// ---------------------------------------------------------------------------

interface WorkerRunContext {
  catalogPool: Pool;
  connectionManager: ConnectionManager;
  job: BackgroundJobWithDetails;
  workerID: string;
  deps: WorkerDeps;
  sessionID: string | null;
  leaseLost: boolean;
  cancelRequested: boolean;
  processedRows: number;
  failedRows: number;
  lastPercent: number;
  assignedBatches: Map<number, { file: BackgroundJobFileRecord; batchID: string }>;
  /** Parse rejects from zero-valid-row files, recorded after the last ingest (see runMeasurementsPipeline). */
  deferredInvalidRows: Array<{ fileName: string; batchID: string; rows: FileRow[] }>;
  heartbeatTimer: NodeJS.Timeout | null;
}

/**
 * Maps reject indices 1..N (recordInvalidRows assigns idx + 1 + offset) into
 * the strictly negative range -N..-1 so worker-recorded parse rejects own a
 * collision-free SourceRowIndex namespace under the
 * UNIQUE (UploadBatchID, SourceRowIndex) key that bulkingestionprocess
 * populates with positive temporarymeasurements.id values.
 */
function parseRejectIndexOffset(rejectCount: number): number {
  return -(rejectCount + 1);
}

function getChunkRows(): number {
  const raw = process.env.BACKGROUND_UPLOAD_CHUNK_ROWS;
  if (raw === undefined || raw === '') return DEFAULT_CHUNK_ROWS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    ailogger.warn(`[UploadWorker] BACKGROUND_UPLOAD_CHUNK_ROWS="${raw}" is not a positive integer; using default ${DEFAULT_CHUNK_ROWS}`);
    return DEFAULT_CHUNK_ROWS;
  }
  return parsed;
}

async function downloadBlobText(file: BackgroundJobFileRecord): Promise<string> {
  const containerClient = await getContainerClient(file.blobContainer, { createIfMissing: false });
  const buffer = await containerClient.getBlobClient(file.blobName).downloadToBuffer();
  return buffer.toString('utf8');
}

function startHeartbeat(ctx: WorkerRunContext): void {
  let tickInFlight = false;
  const tick = async () => {
    if (tickInFlight) return; // a slow catalog round-trip must not stack ticks
    tickInFlight = true;
    try {
      const leaseAlive = await heartbeatBackgroundJob(ctx.catalogPool, ctx.job.jobID, ctx.workerID);
      if (!leaseAlive) {
        ctx.leaseLost = true;
        return;
      }
      const current = await getBackgroundJob(ctx.catalogPool, ctx.job.jobID);
      if (current?.status === 'cancel_requested') ctx.cancelRequested = true;

      // Keep the upload session alive too: the worker only transitions session
      // state at phase boundaries, but uploadsessiontracker considers a session
      // stale after HEARTBEAT_TIMEOUT (90s) — a long ingest would otherwise
      // expose the scope to reclaim/sweep mid-run. A false return (session
      // already terminal or deleted) is benign; the run-level lease is the
      // authoritative ownership signal.
      if (ctx.sessionID) {
        const sessionAlive = await sendHeartbeat(ctx.job.schemaName, ctx.sessionID);
        if (!sessionAlive) {
          ailogger.warn(`[UploadWorker] Upload session ${ctx.sessionID} did not accept a heartbeat for job ${ctx.job.jobID} (already terminal?)`);
        }
      }
    } catch (error) {
      // Transient catalog hiccups must not kill the run; the next tick retries.
      ailogger.warn(`[UploadWorker] Heartbeat tick failed for job ${ctx.job.jobID}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      tickInFlight = false;
    }
  };
  ctx.heartbeatTimer = setInterval(tick, HEARTBEAT_INTERVAL_MS);
  ctx.heartbeatTimer.unref?.();
}

function stopHeartbeat(ctx: WorkerRunContext): void {
  if (ctx.heartbeatTimer) {
    clearInterval(ctx.heartbeatTimer);
    ctx.heartbeatTimer = null;
  }
}

/** Synchronous abort probe shared with ingestBatch — reads the cached flags. */
function abortProbe(ctx: WorkerRunContext): () => boolean {
  return () => ctx.cancelRequested || ctx.leaseLost;
}

/**
 * Stage-boundary probe: refreshes the cancellation flag from the catalog and
 * aborts the run when the lease was lost or a cancellation was requested.
 * On cancellation it cleans non-completed batches (completed batches are
 * untouchable — see module docs) and finalizes the job as 'cancelled' before
 * raising JobCancelledSignal.
 */
async function assertStillOwned(ctx: WorkerRunContext): Promise<void> {
  if (ctx.leaseLost) throw new WorkerLeaseLostError(ctx.job.jobID, ctx.workerID);

  if (!ctx.cancelRequested) {
    const current = await getBackgroundJob(ctx.catalogPool, ctx.job.jobID);
    if (current?.status === 'cancel_requested') ctx.cancelRequested = true;
  }
  if (!ctx.cancelRequested) return;

  await finalizeCancelledJob(ctx);
  throw new JobCancelledSignal(ctx.job.jobID);
}

/**
 * Cancellation is terminal, so it must clean batches from EVERY attempt — not
 * just this run's. A retrying job may be cancelled before its loop reaches a
 * file whose previous attempt left staged temporarymeasurements and recorded
 * rejects behind; those batches exist only in the durably persisted
 * background_job_files.BatchID (first-write-wins), never in this run's
 * in-memory assignedBatches. Union both sources, keyed by jobFileID.
 */
function collectCancellationCleanupTargets(ctx: WorkerRunContext): Array<{ fileName: string; batchID: string }> {
  const targets = new Map<number, { fileName: string; batchID: string }>();
  for (const file of ctx.job.files) {
    if (file.batchID) targets.set(file.jobFileID, { fileName: file.fileName, batchID: file.batchID });
  }
  for (const [jobFileID, { file, batchID }] of ctx.assignedBatches) {
    targets.set(jobFileID, { fileName: file.fileName, batchID });
  }
  return [...targets.values()];
}

/**
 * Cleans every non-completed batch across all attempts and writes the fenced
 * terminal 'cancelled' state. Shared by the stage-boundary probe and by
 * handleRunFailure's cancel-wins-over-park path.
 */
async function finalizeCancelledJob(ctx: WorkerRunContext): Promise<void> {
  for (const { fileName, batchID } of collectCancellationCleanupTargets(ctx)) {
    if (await isBatchCompleted(ctx, batchID)) continue; // completed-batch guard: never clean
    await cleanupBatchArtifacts(ctx, fileName, batchID);
  }
  await setBackgroundJobStatus(ctx.catalogPool, ctx.job.jobID, ctx.workerID, {
    status: 'cancelled',
    phase: 'cancelled',
    eventType: 'cancelled',
    eventMessage: 'Upload job cancelled while running; non-completed batches cleaned'
  });
}

async function handleRunFailure(ctx: WorkerRunContext, error: unknown): Promise<void> {
  const { catalogPool, job, workerID } = ctx;

  if (error instanceof JobCancelledSignal) {
    ailogger.info(`[UploadWorker] ${error.message}`);
    return;
  }
  if (error instanceof WorkerLeaseLostError) {
    // Another owner exists (sweeper reclaim or re-claim). Abandon silently —
    // any write we attempt now would stomp the new owner's state.
    ailogger.info(`[UploadWorker] Lease lost for job ${job.jobID} (worker ${workerID}); abandoning silently`);
    return;
  }

  const err = error instanceof Error ? error : new Error(String(error));
  try {
    // Cancel wins over retry parking: a cancel_requested set while this
    // failure was unwinding must finalize as 'cancelled', not be erased by a
    // waiting_retry/failed transition. (markBackgroundJobWaitingRetryAsWorker
    // carries an in-SQL backstop for the race where the cancel lands after
    // this read.)
    const current = await getBackgroundJob(catalogPool, job.jobID);
    if (current?.status === 'cancel_requested') {
      ctx.cancelRequested = true;
      ailogger.info(`[UploadWorker] Job ${job.jobID} failed (${err.message}) but cancellation was requested; finalizing as cancelled`);
      await finalizeCancelledJob(ctx);
      return;
    }
    if (err instanceof UploadScopeConflictError) {
      ailogger.info(`[UploadWorker] Job ${job.jobID} parked on scope conflict: ${err.message}`);
      await markBackgroundJobWaitingRetryAsWorker(catalogPool, job.jobID, workerID, err, SESSION_CONFLICT_RETRY_DELAY_SECONDS, { incrementRetry: false });
      return;
    }
    if (err instanceof NonRetryableJobError) {
      ailogger.error(`[UploadWorker] Job ${job.jobID} failed permanently: ${err.message}`);
      await markBackgroundJobFailed(catalogPool, job.jobID, workerID, err);
      return;
    }
    const retryDelaySeconds = RETRY_BASE_DELAY_SECONDS * Math.pow(RETRY_BACKOFF_BASE, job.retryCount);
    ailogger.error(`[UploadWorker] Job ${job.jobID} failed (retry budget ${job.retryCount}/${job.maxRetries}): ${err.message}`, err);
    await markBackgroundJobWaitingRetryAsWorker(catalogPool, job.jobID, workerID, err, retryDelaySeconds);
  } catch (finalizeError) {
    if (finalizeError instanceof WorkerLeaseLostError) {
      ailogger.info(`[UploadWorker] Lease lost while finalizing job ${job.jobID}; abandoning silently`);
      return;
    }
    ailogger.error(
      `[UploadWorker] Failed to record failure for job ${job.jobID}: ${finalizeError instanceof Error ? finalizeError.message : String(finalizeError)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Upload-session serialization
// ---------------------------------------------------------------------------

function uploadSessionFileID(jobID: number): string {
  return `async-job-${jobID}`;
}

async function registerUploadSession(ctx: WorkerRunContext): Promise<string> {
  const { job } = ctx;
  const schema = job.schemaName;

  await ensureUploadSessionsTable(schema);

  const ownFileID = uploadSessionFileID(job.jobID);
  const activeSessions = await findActiveSessionsForPlotCensus(schema, job.plotID, job.censusID);

  // A still-active session from this job's previous (crashed) attempt is
  // reused rather than treated as a conflict; foreign stale sessions are left
  // for createUploadSession's stale-scope reclaim.
  const ownSession = activeSessions.find(session => session.fileId === ownFileID);
  if (ownSession) {
    ailogger.info(`[UploadWorker] Reusing upload session ${ownSession.sessionId} from a previous attempt of job ${job.jobID}`);
    await updateSessionState(schema, ownSession.sessionId, UploadSessionState.UPLOADING);
    return ownSession.sessionId;
  }

  const conflicting = activeSessions.find(session => session.fileId !== ownFileID && !isUploadSessionStale(session));
  if (conflicting) {
    throw new UploadScopeConflictError(
      `Upload session ${conflicting.sessionId} (user ${conflicting.userId}) is active for plot ${job.plotID}, census ${job.censusID}`
    );
  }

  const totalChunksEstimate = Math.max(1, Math.ceil(job.totalRows / getChunkRows()));
  try {
    const session = await createUploadSession(schema, job.plotID, job.censusID, job.createdBy, ownFileID, totalChunksEstimate);
    await updateSessionState(schema, session.sessionId, UploadSessionState.UPLOADING);
    return session.sessionId;
  } catch (error) {
    if (error instanceof UploadSessionOwnershipError) {
      throw new UploadScopeConflictError(error.message);
    }
    throw error;
  }
}

async function transitionSessionState(ctx: WorkerRunContext, state: UploadSessionState, errorMessage?: string): Promise<void> {
  if (!ctx.sessionID) return;
  await updateSessionState(ctx.job.schemaName, ctx.sessionID, state, errorMessage);
}

/**
 * Terminal session release — COMPLETED on success, FAILED otherwise. FAILED is
 * deliberately used instead of ABANDONED: abandoned sessions are swept by
 * cleanupOrphanedData, which moves staged temporarymeasurements to unresolved
 * failures — exactly what a retrying job must NOT have happen to its rows.
 */
async function releaseUploadSession(ctx: WorkerRunContext, completed: boolean): Promise<void> {
  if (!ctx.sessionID) return;
  if (ctx.leaseLost) {
    // The reclaiming worker owns this session row now (registerUploadSession
    // reuses a still-active session from a previous attempt of the same job).
    // A stale FAILED write here would de-activate the new attempt's session.
    ailogger.info(`[UploadWorker] Lease lost for job ${ctx.job.jobID}; leaving upload session ${ctx.sessionID} to the new owner`);
    return;
  }
  try {
    await transitionSessionState(
      ctx,
      completed ? UploadSessionState.COMPLETED : UploadSessionState.FAILED,
      completed ? undefined : `Released by worker ${ctx.workerID} without completing`
    );
  } catch (error) {
    ailogger.error(
      `[UploadWorker] Failed to release upload session ${ctx.sessionID} for job ${ctx.job.jobID}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

type JobPipeline = 'measurements_csv' | 'arcgis_xlsx';

function resolveJobPipeline(job: BackgroundJobWithDetails): JobPipeline {
  if (isAllowedAsyncPipeline(job.formType, job.sourceFormat)) {
    return job.sourceFormat === SourceFormat.arcgis_xlsx ? 'arcgis_xlsx' : 'measurements_csv';
  }
  // Fixed-data forms are out of scope for async v1. The creation route's
  // ASYNC_UPLOAD_V1_PIPELINES guard should prevent such jobs from being
  // created; the worker still refuses them.
  throw new NonRetryableJobError(
    `Unsupported upload job routing: formType="${job.formType ?? 'missing'}" sourceFormat="${job.sourceFormat ?? 'missing'}". ` +
      `The async worker only processes measurements uploads in csv or arcgis_xlsx format.`
  );
}

function getRecordPayload<T>(payload: Record<string, unknown> | null, key: string): Record<string, T> {
  const value = payload?.[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, T>) : {};
}

// ---------------------------------------------------------------------------
// Recovery probe and batch cleanup
// ---------------------------------------------------------------------------

/**
 * uploadmetrics recovery probe: true when this batch already completed
 * ingestion. Completed batches are skipped ENTIRELY (no cleanup, no staging,
 * no ingest) — see module docs for why this order is load-bearing.
 */
async function isBatchCompleted(ctx: WorkerRunContext, batchID: string): Promise<boolean> {
  const probeSQL = safeFormatQuery(ctx.job.schemaName, `SELECT 1 FROM ??.uploadmetrics WHERE batchID = ? AND censusID = ? AND status = 'completed' LIMIT 1`);
  const rows = await ctx.connectionManager.executeQuery(probeSQL, [batchID, ctx.job.censusID]);
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * Retry hygiene for a NON-completed batch: drops any temporarymeasurements
 * left by an interrupted attempt and the parse rejects it recorded, so the
 * re-run starts from a clean slate without accumulating duplicates.
 */
async function cleanupBatchArtifacts(ctx: WorkerRunContext, fileName: string, batchID: string): Promise<void> {
  const { schemaName, plotID, censusID } = ctx.job;
  const deleteTempSQL = safeFormatQuery(schemaName, `DELETE FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ? AND PlotID = ? AND CensusID = ?`);
  await ctx.connectionManager.executeQuery(deleteTempSQL, [fileName, batchID, plotID, censusID]);
  await deleteUnresolvedRowsForBatch(ctx.connectionManager, schemaName, fileName, batchID, censusID);
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

async function setProgress(ctx: WorkerRunContext, phase: UploadJobPhase, percent: number, message: string, opts: { emitEvent?: boolean } = {}): Promise<void> {
  // Clamp monotonic WITHIN AN ATTEMPT: the per-file pipeline revisits earlier
  // phases for later files and reported progress should never move backwards
  // while a single attempt runs. A fresh attempt resets the clamp.
  ctx.lastPercent = Math.max(ctx.lastPercent, percent);
  const emitEvent = opts.emitEvent !== false;
  await setBackgroundJobStatus(ctx.catalogPool, ctx.job.jobID, ctx.workerID, {
    status: 'running',
    phase,
    percentComplete: ctx.lastPercent,
    processedRows: ctx.processedRows,
    failedRows: ctx.failedRows,
    lastError: null,
    ...(emitEvent ? { eventType: phase, eventMessage: message } : {})
  });
}

// ---------------------------------------------------------------------------
// Measurements CSV pipeline
// ---------------------------------------------------------------------------

async function runMeasurementsPipeline(ctx: WorkerRunContext): Promise<void> {
  const { job, connectionManager } = ctx;
  const schema = job.schemaName;
  const selectedDelimiters = getRecordPayload<string>(job.payload, 'selectedDelimiters');
  const columnMappings = getRecordPayload<ColumnMapping>(job.payload, 'columnMappings');
  const uploadMode = normalizeUploadMode(job.uploadMode);
  const chunkRows = getChunkRows();

  for (let fileIndex = 0; fileIndex < job.files.length; fileIndex++) {
    const file = job.files[fileIndex];
    await assertStillOwned(ctx);

    const batchID = await assignFileBatchID(ctx.catalogPool, file.jobFileID, generateShortBatchID());
    ctx.assignedBatches.set(file.jobFileID, { file, batchID });

    if (await isBatchCompleted(ctx, batchID)) {
      // Recovery skip — the batch already completed on a previous attempt.
      // No cleanup, no staging, no ingest: see module docs.
      ailogger.info(`[UploadWorker] Skipping ${file.fileName} (batch ${batchID}): uploadmetrics already 'completed'`);
      ctx.processedRows += file.processedRows;
      ctx.failedRows += file.failedRows;
      await updateBackgroundJobFileStatus(ctx.catalogPool, job.jobID, ctx.workerID, file.jobFileID, { status: 'processed', errorMessage: null });
      continue;
    }

    await transitionSessionState(ctx, UploadSessionState.UPLOADING);
    await setProgress(ctx, 'staging', UPLOAD_JOB_PHASE_PROGRESS.staging, `Staging ${file.fileName}`);
    await cleanupBatchArtifacts(ctx, file.fileName, batchID);

    const text = await ctx.deps.fetchFileText(file);
    const delimiter = detectDelimiter(text, file.fileName, selectedDelimiters[file.fileName]);
    // Raw parse only — no header transforms, no value transforms. Canonical
    // header resolution and row validation are owned by stageMeasurementChunk
    // (server-resolution stage of the column-mapping pipeline).
    const parsed = Papa.parse<Record<string, string>>(text, { delimiter, header: true, skipEmptyLines: true });
    const fatalParseError = parsed.errors.find(parseError => parseError.type === 'Delimiter' || parseError.type === 'Quotes');
    if (fatalParseError) {
      throw new NonRetryableJobError(`CSV parse failed for ${file.fileName}: ${fatalParseError.message}`);
    }
    const csvHeaders = (parsed.meta.fields ?? []).map(String);
    const rawRows = parsed.data;

    let fileInsertedRows = 0;
    let fileExpectedRows = 0;
    let fileDroppedRows = 0;
    const fileInvalidRows: FileRow[] = [];

    // At least one staging call even for an empty file so the CLEAN_REUPLOAD
    // census replacement and the changelog tracking row still happen.
    const chunkCount = Math.max(1, Math.ceil(rawRows.length / chunkRows));
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
      const chunk = rawRows.slice(chunkIndex * chunkRows, (chunkIndex + 1) * chunkRows);

      // The worker owns one transaction per chunk: begin/commit per chunk,
      // rollback + rethrow on error (the whole attempt then retries the file).
      const transactionID = await connectionManager.beginTransaction();
      try {
        const result = await stageMeasurementChunk(connectionManager, {
          schema,
          fileName: file.fileName,
          batchID,
          plotID: job.plotID,
          censusID: job.censusID,
          uploadMode,
          sourceFormat: SourceFormat.csv,
          rawRows: chunk,
          csvHeaders,
          delimiter,
          storedMapping: columnMappings[file.fileName],
          uploadSessionID: ctx.sessionID,
          transactionID,
          changedBy: job.createdBy,
          // Census replacement may only run while staging the job's FIRST
          // file — later files would wipe earlier files' completed batches.
          suppressCensusReplacementCleanup: fileIndex > 0
        });
        await connectionManager.commitTransaction(transactionID);

        fileInsertedRows += result.insertedCount;
        fileExpectedRows += result.expectedCount;
        fileDroppedRows += result.droppedCount;
        fileInvalidRows.push(...result.invalidRows);
        ctx.processedRows += result.insertedCount;
      } catch (error) {
        try {
          await connectionManager.rollbackTransaction(transactionID);
        } catch (rollbackError) {
          ailogger.error(
            `[UploadWorker] Rollback failed for chunk ${chunkIndex + 1}/${chunkCount} of ${file.fileName}: ` +
              `${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
          );
        }
        if (error instanceof MeasurementChunkResolutionError) {
          // A header-plan misalignment is deterministic — every retry would
          // re-parse the same file and fail identically. Fail fast instead of
          // burning the retry budget.
          throw new NonRetryableJobError(`Header resolution failed for ${file.fileName}: ${error.message}`, { cause: error });
        }
        throw error;
      }
      // Percent/processedRows update every chunk; the EVENT row is sampled.
      const emitChunkEvent = (chunkIndex + 1) % CHUNK_EVENT_SAMPLE_RATE === 0;
      await setProgress(ctx, 'staging', UPLOAD_JOB_PHASE_PROGRESS.staging, `Staged chunk ${chunkIndex + 1}/${chunkCount} of ${file.fileName}`, {
        emitEvent: emitChunkEvent
      });
    }

    // Strict staging verification: every row the resolution accepted must be
    // accounted for as either staged or recorded-as-dropped. Anything else is
    // silent data loss and the attempt must fail (retryable).
    const stagedCount = await countStagedRows(connectionManager, schema, file.fileName, batchID, job.plotID, job.censusID);
    if (stagedCount !== fileInsertedRows || fileInsertedRows + fileDroppedRows !== fileExpectedRows) {
      throw new Error(
        `Staging verification failed for ${file.fileName} (batch ${batchID}): ` +
          `${fileExpectedRows} resolved row(s), ${fileInsertedRows} insert(s), ${fileDroppedRows} recorded drop(s), ${stagedCount} staged row(s) found`
      );
    }

    ctx.failedRows += fileInvalidRows.length + fileDroppedRows;
    await updateBackgroundJobFileStatus(ctx.catalogPool, job.jobID, ctx.workerID, file.jobFileID, {
      status: 'staged',
      processedRows: fileInsertedRows,
      failedRows: fileInvalidRows.length + fileDroppedRows,
      errorMessage: null
    });

    await assertStillOwned(ctx);
    await transitionSessionState(ctx, UploadSessionState.UPLOADED);

    if (fileInsertedRows > 0) {
      await setProgress(ctx, 'ingestion', UPLOAD_JOB_PHASE_PROGRESS.ingestion, `Ingesting ${file.fileName}`);
      await transitionSessionState(ctx, UploadSessionState.PROCESSING);
      await runIngestForBatch(ctx, file.fileName, batchID);
    }

    if (fileInvalidRows.length > 0 && fileInsertedRows > 0) {
      // ORDER IS LOAD-BEARING: parse rejects are recorded AFTER the file's
      // ingest, not before. On the first-ever upload of a census, ingestBatch's
      // failed-initial-census recovery preflight treats any pre-existing
      // coremeasurements rows (with zero completed uploads) as residue from a
      // crashed load and wipes the census — recording rejects first would
      // destroy them. The cost is a narrow window: if recordInvalidRows fails
      // after the batch reached uploadmetrics 'completed', the retry skips the
      // completed batch and these rejects are not re-recorded.
      //
      // Single per-file recording call with a NEGATIVE index namespace:
      // coremeasurements enforces UNIQUE (UploadBatchID, SourceRowIndex), and
      // bulkingestionprocess keys its rows by temporarymeasurements.id under
      // the same batch. A reject recorded with index 1..N can collide with an
      // ingested row's id and silently overwrite it via ON DUPLICATE KEY
      // UPDATE. Negative indices (-N..-1) can never collide with the
      // procedure's positive auto-increment ids.
      await recordInvalidRows(
        connectionManager,
        {
          schema,
          plotID: job.plotID,
          censusID: job.censusID,
          fileName: file.fileName,
          batchID,
          sourceRowIndexOffset: parseRejectIndexOffset(fileInvalidRows.length)
        },
        fileInvalidRows
      );
    } else if (fileInvalidRows.length > 0) {
      // DEFERRED RECORDING for zero-valid-row files: this file never runs
      // ingestBatch, so its batch never reaches uploadmetrics 'completed'.
      // Recording its rejects now would plant coremeasurements rows that the
      // NEXT file's ingest preflight — on a census with zero completed
      // uploads — reads as residue from a crashed first load and wipes
      // (shouldRecoverFailedInitialCensus). Defer recording to after the last
      // file's ingest, when completed uploads exist and the preflight can no
      // longer fire.
      ctx.deferredInvalidRows.push({ fileName: file.fileName, batchID, rows: fileInvalidRows });
    }

    await updateBackgroundJobFileStatus(ctx.catalogPool, job.jobID, ctx.workerID, file.jobFileID, {
      status: fileInsertedRows > 0 ? 'processed' : fileInvalidRows.length + fileDroppedRows > 0 ? 'failed' : 'skipped',
      processedRows: fileInsertedRows,
      failedRows: fileInvalidRows.length + fileDroppedRows,
      errorMessage:
        fileInsertedRows === 0 && fileInvalidRows.length + fileDroppedRows > 0
          ? `No rows could be staged: ${fileInvalidRows.length} row(s) rejected during parsing, ${fileDroppedRows} row(s) dropped during column resolution`
          : null
    });
  }

  for (const deferred of ctx.deferredInvalidRows) {
    await recordInvalidRows(
      connectionManager,
      {
        schema,
        plotID: job.plotID,
        censusID: job.censusID,
        fileName: deferred.fileName,
        batchID: deferred.batchID,
        sourceRowIndexOffset: parseRejectIndexOffset(deferred.rows.length)
      },
      deferred.rows
    );
  }
}

/**
 * Runs ingestBatch with the worker's abort probe. A between-batches abort
 * surfaces as IngestBatchAbortedError; route it through assertStillOwned so it
 * is finalized as a cancellation or lease loss rather than a generic failure.
 */
async function runIngestForBatch(ctx: WorkerRunContext, fileName: string, batchID: string): Promise<void> {
  try {
    await ingestBatch(ctx.connectionManager, {
      schema: ctx.job.schemaName,
      fileID: fileName,
      batchID,
      isAborted: abortProbe(ctx)
    });
  } catch (error) {
    if (error instanceof IngestBatchAbortedError) {
      await assertStillOwned(ctx); // throws JobCancelledSignal or WorkerLeaseLostError
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// ArcGIS XLSX pipeline
// ---------------------------------------------------------------------------

interface ArcgisImportSessionPayload {
  importSessionId?: string;
  fileName?: string;
  rowCount?: number;
}

async function runArcgisPipeline(ctx: WorkerRunContext): Promise<void> {
  const { job } = ctx;
  const sessionID = ctx.sessionID;
  if (!sessionID) {
    // registerUploadSession runs before any pipeline; a null here is a worker
    // lifecycle bug, never a recoverable job state.
    throw new Error(`Upload session was not registered before the ArcGIS pipeline for job ${job.jobID}`);
  }
  const rawArcgisSession = job.payload?.arcgisImportSession;
  const arcgisSession =
    rawArcgisSession && typeof rawArcgisSession === 'object' && !Array.isArray(rawArcgisSession) ? (rawArcgisSession as ArcgisImportSessionPayload) : null;
  if (!arcgisSession?.importSessionId || !arcgisSession.fileName) {
    throw new NonRetryableJobError('ArcGIS async upload job is missing its pre-flight import session reference');
  }
  const uploadMode = normalizeUploadMode(job.uploadMode);

  for (const file of job.files) {
    await assertStillOwned(ctx);
    if (file.fileName !== arcgisSession.fileName) {
      throw new NonRetryableJobError(`ArcGIS async upload file ${file.fileName} does not match pre-flight file ${arcgisSession.fileName}`);
    }

    const batchID = await assignFileBatchID(ctx.catalogPool, file.jobFileID, generateShortBatchID());
    ctx.assignedBatches.set(file.jobFileID, { file, batchID });

    await setProgress(ctx, 'staging', UPLOAD_JOB_PHASE_PROGRESS.staging, `Committing ArcGIS import ${file.fileName}`);
    await transitionSessionState(ctx, UploadSessionState.UPLOADING);

    // No blob download and no parsing here: the pre-flight already staged the
    // parsed rows in the import session. commitArcgisImport is idempotent for
    // same-batch retries via its alreadyCommitted claim path.
    let rowCount: number;
    try {
      const commitResult = await commitArcgisImport(ctx.connectionManager, {
        schema: job.schemaName,
        plotID: job.plotID,
        censusID: job.censusID,
        importSessionId: arcgisSession.importSessionId,
        fileName: file.fileName,
        batchID,
        uploadMode,
        // MUST equal the pre-flight user or the session claim throws FORBIDDEN.
        userId: job.createdBy,
        uploadSessionID: sessionID
      });
      rowCount = commitResult.rowCount;
    } catch (error) {
      if (error instanceof ArcgisImportSessionError) {
        // Ownership/expiry/empty-session failures cannot heal on retry.
        throw new NonRetryableJobError(`ArcGIS import session commit failed: ${error.message}`, { cause: error });
      }
      throw error;
    }

    ctx.processedRows += rowCount;
    await updateBackgroundJobFileStatus(ctx.catalogPool, job.jobID, ctx.workerID, file.jobFileID, {
      status: 'staged',
      processedRows: rowCount,
      failedRows: 0,
      errorMessage: null
    });

    await assertStillOwned(ctx);
    await setProgress(ctx, 'ingestion', UPLOAD_JOB_PHASE_PROGRESS.ingestion, `Ingesting ${file.fileName}`);
    await transitionSessionState(ctx, UploadSessionState.PROCESSING);
    await runIngestForBatch(ctx, file.fileName, batchID);

    await updateBackgroundJobFileStatus(ctx.catalogPool, job.jobID, ctx.workerID, file.jobFileID, {
      status: 'processed',
      processedRows: rowCount,
      failedRows: 0,
      errorMessage: null
    });
  }
}

// ---------------------------------------------------------------------------
// Shared post-ingestion phases: collapse → validations → view refresh
// ---------------------------------------------------------------------------

async function runPostIngestionPhases(ctx: WorkerRunContext): Promise<void> {
  const { job, connectionManager } = ctx;

  await assertStillOwned(ctx);
  await setProgress(ctx, 'collapsing', UPLOAD_JOB_PHASE_PROGRESS.collapsing, 'Consolidating ingested measurements');
  await transitionSessionState(ctx, UploadSessionState.COLLAPSING);
  await collapseCensus(connectionManager, { schema: job.schemaName, censusID: job.censusID });

  await assertStillOwned(ctx);
  await setProgress(ctx, 'validation', UPLOAD_JOB_PHASE_PROGRESS.validation, 'Running post-ingestion validations');
  const summary = await runCensusValidations(connectionManager, {
    schema: job.schemaName,
    plotID: job.plotID,
    censusID: job.censusID
  });

  if (summary.conflict) {
    // Another validation run owns the scope right now — park without burning
    // retry budget, exactly like an upload-session conflict.
    throw new UploadScopeConflictError(`A validation run is already in progress for plot ${job.plotID}, census ${job.censusID}`);
  }
  if (summary.failedSteps > 0) {
    throw new NonRetryableJobError(`Validation completed with ${summary.failedSteps} failed step(s): ${summary.errors.join('; ')}`);
  }
  if (summary.errors.length > 0) {
    // failedSteps === 0 but post-pass work (IsValidated flip, view refreshes)
    // failed — infrastructure trouble worth a retry, not a permanent failure.
    throw new Error(`Post-validation finalization failed: ${summary.errors.join('; ')}`);
  }

  await setProgress(ctx, 'refreshing_views', UPLOAD_JOB_PHASE_PROGRESS.refreshingViews, 'Measurement views refreshed');
}
