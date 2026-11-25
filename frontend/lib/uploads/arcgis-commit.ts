/**
 * ArcGIS commit orchestration (#561) — the single mechanism for committing a pre-flighted ArcGIS import session.
 * Both POST /api/arcgis/commit and the background upload worker call commitArcgisImport; the caller owns
 * authentication, scope and upload-session ownership.
 *
 * Contract (replaces the old all-or-nothing transaction): an ArcGIS commit is a sequence of short, separately
 * committed transactions tracked on its import session — claim (C), clear this file's staged rows (S0), clear this
 * import's own rows in the census (F0), stage the import rows in windows (S), replace the census for a CLEAN_REUPLOAD
 * (R, #555's windows), finalize (F). Each transaction is atomic on its own. The session reaches `committed` only in F,
 * after verifying that every source row is accounted for; until then nothing is complete and nothing ingests it.
 * Every retry restarts from the durable import rows. Rows are staged before the census is replaced, so a failure in
 * S leaves the old census whole, and a failure in R or F leaves it partly or fully emptied until a retry finishes the
 * commit — the consequence the user accepted.
 */
import crypto from 'crypto';
import ailogger from '@/ailogger';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { UploadMode } from '@/config/uploadmodes';
import {
  ARCGIS_COMMIT_CLAIM_KIND,
  ArcgisImportSessionError,
  claimArcgisImportCommitAttempt,
  ensureArcgisImportTables,
  lockArcgisImportSessionForCommitUnit,
  markArcgisImportCensusReplacementCompleted,
  type ArcgisCommitAttempt,
  type ArcgisCommitClaim,
  type ArcgisCommitClaimKind,
  type ArcgisCommitUnitSnapshot
} from '@/lib/arcgis/import-session';
import {
  CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE,
  deleteBatchFamilyRowsWindow,
  deleteStagedRowsForFileWindow,
  ensureTemporaryMeasurementsSourceFormatColumn
} from '@/lib/ingestion/temporary-measurements';
import {
  BatchIDContainsSubBatchSeparatorError,
  MAX_ORIGINAL_BATCH_ID_LENGTH,
  OriginalBatchIDTooLongError,
  SUB_BATCH_SEPARATOR
} from '@/lib/uploads/batch-family';
import {
  CENSUS_REPLACEMENT_COMPLETED_EVENT,
  CENSUS_REPLACEMENT_STARTED_EVENT,
  CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS,
  runCensusReplacementUnits,
  type CensusReplacementOwner
} from '@/lib/uploads/stage-measurements';
import { CENSUS_REPLACEMENT_MARKER_COLUMN, ensureUploadSessionReplacementMarkerColumn } from '@/lib/uploads/upload-session-replacement-marker';
import { stageArcgisImportWindow } from '@/lib/uploads/arcgis-commit-staging';
import { finalizeArcgisCommit } from '@/lib/uploads/arcgis-commit-finalize';

export { ArcgisCensusReplacementIncompleteError, ArcgisCommitVerificationError } from '@/lib/uploads/arcgis-commit-finalize';

/** Source rows per staging window: the worker's chunk size, measured at p95 ≤ 0.6 s at 150k rows. */
export const ARCGIS_STAGING_WINDOW_ROWS = 5_000;
export const ARCGIS_COMMIT_COMPLETED_EVENT = 'upload.arcgis_commit.completed';
export const ARCGIS_COMMIT_FAILED_EVENT = 'upload.arcgis_commit.failed';
export const ARCGIS_COMMIT_UNIT = {
  CLAIM: 'claim',
  CLEAR_STAGED: 'clear_staged',
  CLEAR_FAMILY: 'clear_family',
  STAGING_WINDOW: 'staging_window',
  REPLACEMENT: 'replacement',
  FINALIZE: 'finalize'
} as const;
type ArcgisCommitUnit = (typeof ARCGIS_COMMIT_UNIT)[keyof typeof ARCGIS_COMMIT_UNIT];

export interface CommitArcgisImportParams {
  schema: string;
  plotID: number;
  censusID: number;
  importSessionId: string;
  fileName: string;
  /** Ignored except to replay a session committed before #561; shape-checked when present. */
  batchID?: string;
  uploadMode: UploadMode;
  userId: string;
  uploadSessionID: string;
}

export interface CommitArcgisImportResult {
  rowCount: number;
  fileName: string;
  alreadyCommitted: boolean;
  /** The batch the rows were staged under: derived from the import session, or the stored batch of a legacy replay. */
  batchID: string;
}

interface ArcgisCommitProgress {
  unit: ArcgisCommitUnit;
  phase: string | null;
  claim: ArcgisCommitClaimKind | null;
  previousUploadSessionID: string | null;
  batchID: string | null;
  lastDurableCursor: number;
  stagedRows: number;
  droppedRows: number;
  leftoverStagedRowsCleared: number;
  leftoverFamilyRowsCleared: number;
  stagingWindowCount: number;
  slowestTransactionMs: number;
}

type GuardedUnitOutcome<T> = { commitCompleted: true; snapshot: ArcgisCommitUnitSnapshot } | { commitCompleted: false; value: T };

function assertRequestBatchShape(batchID: string): void {
  if (batchID.length > MAX_ORIGINAL_BATCH_ID_LENGTH) {
    throw new ArcgisImportSessionError(new OriginalBatchIDTooLongError(batchID).message, HTTPResponses.INVALID_REQUEST);
  }
  if (batchID.includes(SUB_BATCH_SEPARATOR)) {
    throw new ArcgisImportSessionError(new BatchIDContainsSubBatchSeparatorError(batchID).message, HTTPResponses.INVALID_REQUEST);
  }
}

async function timed<T>(progress: ArcgisCommitProgress, run: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await run();
  } finally {
    progress.slowestTransactionMs = Math.max(progress.slowestTransactionMs, Date.now() - startedAt);
  }
}

/** Every transaction after the claim: the guard first, then the unit's work only if this attempt still owns the import. */
function runGuardedUnit<T>(
  connectionManager: ConnectionManager,
  attempt: ArcgisCommitAttempt,
  progress: ArcgisCommitProgress,
  work: (snapshot: ArcgisCommitUnitSnapshot, transactionID: string) => Promise<T>
): Promise<GuardedUnitOutcome<T>> {
  return timed(progress, () =>
    connectionManager.withTransaction<GuardedUnitOutcome<T>>(
      async tx => {
        const snapshot = await lockArcgisImportSessionForCommitUnit(connectionManager, attempt, tx.id);
        progress.lastDurableCursor = snapshot.stagingNextRowIndex;
        if (snapshot.commitCompleted) return { commitCompleted: true, snapshot };
        return { commitCompleted: false, value: await work(snapshot, tx.id) };
      },
      { timeoutMs: CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS }
    )
  );
}

async function clearLeftoverStagedRows(
  connectionManager: ConnectionManager,
  attempt: ArcgisCommitAttempt,
  fileName: string,
  progress: ArcgisCommitProgress
): Promise<ArcgisCommitUnitSnapshot | null> {
  progress.unit = ARCGIS_COMMIT_UNIT.CLEAR_STAGED;
  for (let windowOrdinal = 1; ; windowOrdinal += 1) {
    progress.phase = `window ${windowOrdinal}`;
    const unit = await runGuardedUnit(connectionManager, attempt, progress, (_snapshot, transactionID) =>
      deleteStagedRowsForFileWindow(connectionManager, attempt.schema, fileName, attempt.plotID, attempt.censusID, ARCGIS_STAGING_WINDOW_ROWS, transactionID)
    );
    if (unit.commitCompleted) return unit.snapshot;
    progress.leftoverStagedRowsCleared += unit.value;
    if (unit.value < ARCGIS_STAGING_WINDOW_ROWS) return null;
  }
}

async function clearLeftoverFamilyRows(
  connectionManager: ConnectionManager,
  attempt: ArcgisCommitAttempt,
  fileName: string,
  progress: ArcgisCommitProgress
): Promise<ArcgisCommitUnitSnapshot | null> {
  progress.unit = ARCGIS_COMMIT_UNIT.CLEAR_FAMILY;
  for (let windowOrdinal = 1; ; windowOrdinal += 1) {
    progress.phase = `window ${windowOrdinal}`;
    const unit = await runGuardedUnit(connectionManager, attempt, progress, (_snapshot, transactionID) =>
      deleteBatchFamilyRowsWindow(
        connectionManager,
        attempt.schema,
        fileName,
        attempt.batchID,
        attempt.plotID,
        attempt.censusID,
        attempt.changedBy,
        transactionID
      )
    );
    if (unit.commitCompleted) return unit.snapshot;
    progress.leftoverFamilyRowsCleared += unit.value;
    if (unit.value < CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE) return null;
  }
}

async function stageImportRows(
  connectionManager: ConnectionManager,
  attempt: ArcgisCommitAttempt,
  rowCount: number,
  progress: ArcgisCommitProgress
): Promise<ArcgisCommitUnitSnapshot | null> {
  progress.unit = ARCGIS_COMMIT_UNIT.STAGING_WINDOW;
  let nextRowIndex = 0;
  while (nextRowIndex < rowCount) {
    progress.phase = `window ${progress.stagingWindowCount + 1}`;
    const unit = await runGuardedUnit(connectionManager, attempt, progress, (snapshot, transactionID) =>
      stageArcgisImportWindow(connectionManager, attempt, snapshot, ARCGIS_STAGING_WINDOW_ROWS, transactionID)
    );
    if (unit.commitCompleted) return unit.snapshot;
    nextRowIndex = unit.value.nextRowIndex;
    progress.lastDurableCursor = nextRowIndex;
    progress.stagingWindowCount += 1;
    progress.stagedRows += unit.value.insertedRows;
    progress.droppedRows += unit.value.failureRows;
  }
  return null;
}

/** The census replacement's owner for an ArcGIS commit: the unit guard as the lock, the per-import marker as the completion. */
function arcgisCensusReplacementOwner(
  connectionManager: ConnectionManager,
  attempt: ArcgisCommitAttempt,
  progress: ArcgisCommitProgress
): CensusReplacementOwner {
  let replacementTransactionOrdinal = 0;
  return {
    lockForUnit: async transactionID => {
      replacementTransactionOrdinal += 1;
      progress.phase = `replacement transaction ${replacementTransactionOrdinal}`;
      const snapshot = await lockArcgisImportSessionForCommitUnit(connectionManager, attempt, transactionID);
      return snapshot.commitCompleted || snapshot.censusReplacementCompleted ? 'marker_already_set' : 'proceed';
    },
    recordCompletion: transactionID => markArcgisImportCensusReplacementCompleted(connectionManager, attempt, transactionID)
  };
}

async function replaceCensus(connectionManager: ConnectionManager, attempt: ArcgisCommitAttempt, progress: ArcgisCommitProgress): Promise<void> {
  progress.unit = ARCGIS_COMMIT_UNIT.REPLACEMENT;
  progress.phase = null;
  const logKeys = {
    schema: attempt.schema,
    plotID: attempt.plotID,
    censusID: attempt.censusID,
    uploadSessionID: attempt.uploadSessionID,
    batchID: attempt.batchID,
    importSessionId: attempt.importSessionId
  };
  ailogger.info(CENSUS_REPLACEMENT_STARTED_EVENT, logKeys);
  const startedAt = Date.now();
  const run = await runCensusReplacementUnits(
    connectionManager,
    { schema: attempt.schema, plotID: attempt.plotID, censusID: attempt.censusID, incomingBatchID: attempt.batchID, changedBy: attempt.changedBy },
    arcgisCensusReplacementOwner(connectionManager, attempt, progress)
  );
  progress.slowestTransactionMs = Math.max(progress.slowestTransactionMs, run.slowestWindowMs);
  ailogger.info(CENSUS_REPLACEMENT_COMPLETED_EVENT, { ...logKeys, ...run, elapsedMs: Date.now() - startedAt });
}

function claimTransaction(
  connectionManager: ConnectionManager,
  params: CommitArcgisImportParams,
  attemptID: string,
  progress: ArcgisCommitProgress
): Promise<ArcgisCommitClaim> {
  return timed(progress, () =>
    connectionManager.withTransaction(
      tx =>
        claimArcgisImportCommitAttempt(
          connectionManager,
          {
            schema: params.schema,
            importSessionId: params.importSessionId,
            plotID: params.plotID,
            censusID: params.censusID,
            userId: params.userId,
            fileName: params.fileName,
            requestBatchID: params.batchID ?? null,
            uploadMode: params.uploadMode,
            uploadSessionID: params.uploadSessionID,
            attemptID
          },
          tx.id
        ),
      { timeoutMs: CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS }
    )
  );
}

export async function commitArcgisImport(connectionManager: ConnectionManager, params: CommitArcgisImportParams): Promise<CommitArcgisImportResult> {
  if (params.batchID !== undefined) assertRequestBatchShape(params.batchID);

  await ensureArcgisImportTables(params.schema);
  await ensureTemporaryMeasurementsSourceFormatColumn(connectionManager, params.schema);
  await ensureUploadSessionReplacementMarkerColumn(connectionManager, params.schema, CENSUS_REPLACEMENT_MARKER_COLUMN);

  const attemptID = crypto.randomUUID();
  const startedAt = Date.now();
  const progress: ArcgisCommitProgress = {
    unit: ARCGIS_COMMIT_UNIT.CLAIM,
    phase: null,
    claim: null,
    previousUploadSessionID: null,
    batchID: null,
    lastDurableCursor: 0,
    stagedRows: 0,
    droppedRows: 0,
    leftoverStagedRowsCleared: 0,
    leftoverFamilyRowsCleared: 0,
    stagingWindowCount: 0,
    slowestTransactionMs: 0
  };
  const identity = () => ({
    schema: params.schema,
    plotID: params.plotID,
    censusID: params.censusID,
    importSessionId: params.importSessionId,
    batchID: progress.batchID,
    uploadSessionID: params.uploadSessionID,
    attemptID,
    claim: progress.claim,
    previousUploadSessionID: progress.previousUploadSessionID
  });

  try {
    const claim = await claimTransaction(connectionManager, params, attemptID, progress);
    progress.claim = claim.kind;
    progress.previousUploadSessionID = claim.previousUploadSessionID;
    progress.batchID = claim.batchID;
    const complete = (rowCount: number, alreadyCommitted: boolean): CommitArcgisImportResult => {
      ailogger.info(ARCGIS_COMMIT_COMPLETED_EVENT, {
        ...identity(),
        alreadyCommitted,
        stagedRows: progress.stagedRows,
        droppedRows: progress.droppedRows,
        leftoverStagedRowsCleared: progress.leftoverStagedRowsCleared,
        leftoverFamilyRowsCleared: progress.leftoverFamilyRowsCleared,
        stagingWindowCount: progress.stagingWindowCount,
        slowestTransactionMs: progress.slowestTransactionMs,
        elapsedMs: Date.now() - startedAt
      });
      return { rowCount, fileName: claim.fileName, alreadyCommitted, batchID: claim.batchID };
    };
    if (claim.kind === ARCGIS_COMMIT_CLAIM_KIND.ALREADY_COMMITTED) return complete(claim.rowCount, true);

    const attempt: ArcgisCommitAttempt = {
      schema: params.schema,
      importSessionId: params.importSessionId,
      plotID: params.plotID,
      censusID: params.censusID,
      batchID: claim.batchID,
      uploadMode: params.uploadMode,
      uploadSessionID: params.uploadSessionID,
      attemptID,
      changedBy: params.userId
    };
    const finishedByPeer =
      (await clearLeftoverStagedRows(connectionManager, attempt, claim.fileName, progress)) ??
      (await clearLeftoverFamilyRows(connectionManager, attempt, claim.fileName, progress)) ??
      (await stageImportRows(connectionManager, attempt, claim.rowCount, progress));
    if (finishedByPeer) return complete(finishedByPeer.committedRowCount, true);

    if (params.uploadMode === UploadMode.CLEAN_REUPLOAD) await replaceCensus(connectionManager, attempt, progress);

    progress.unit = ARCGIS_COMMIT_UNIT.FINALIZE;
    progress.phase = null;
    const finalUnit = await runGuardedUnit(connectionManager, attempt, progress, (snapshot, transactionID) =>
      finalizeArcgisCommit(connectionManager, attempt, snapshot, transactionID)
    );
    if (finalUnit.commitCompleted) return complete(finalUnit.snapshot.committedRowCount, true);
    return complete(finalUnit.value.committedRowCount, false);
  } catch (error: unknown) {
    // A logging boundary, not a handler: the original error object is rethrown unchanged.
    ailogger.error(ARCGIS_COMMIT_FAILED_EVENT, error instanceof Error ? error : undefined, {
      ...identity(),
      unit: progress.unit,
      phase: progress.phase,
      lastDurableCursor: progress.lastDurableCursor,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt
    });
    throw error;
  }
}
