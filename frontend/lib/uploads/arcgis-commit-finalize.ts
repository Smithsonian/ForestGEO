/**
 * Unit F of an ArcGIS commit (#561): one transaction that verifies every source row of the import is accounted for,
 * writes the `file_upload` changelog row and flips the import session to `committed`. The counts are plain reads:
 * after the cleanup-path fixes no path removes an active upload session's staged rows, and this unit's guard holds the
 * session row until it commits (spec §8, §9). A mismatch writes nothing and is retryable: the retry rebuilds.
 */
import ConnectionManager from '@/lib/db/connectionmanager';
import { FormType, SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import {
  ArcgisImportSessionInvariantError,
  markArcgisImportCommitCompleted,
  type ArcgisCommitAttempt,
  type ArcgisCommitUnitSnapshot
} from '@/lib/arcgis/import-session';
import { buildSubBatchPattern, LIKE_ESCAPE_CLAUSE } from '@/lib/uploads/batch-family';
import { buildFileUploadChangelogRecordID, mergeFileUploadChunkIntoMetadata } from '@/lib/uploads/file-names';
import { CensusReplacementIncompleteError, countStagedRows } from '@/lib/uploads/stage-measurements';

const CHANGELOG_TABLE_NAME = 'file_upload';
const CHANGELOG_INSERT_OPERATION = 'INSERT';

export interface ArcgisCommitVerificationDetail {
  importSessionId: string;
  expectedStagedRows: number;
  foundStagedRows: number;
  expectedFailureRows: number;
  foundFailureRows: number;
}

/** F found rows of this import removed or added since staging (#561, D8). Not an ArcgisImportSessionError: it is retryable. */
export class ArcgisCommitVerificationError extends Error {
  readonly detail: ArcgisCommitVerificationDetail;

  constructor(detail: ArcgisCommitVerificationDetail) {
    super(
      `ArcGIS import ${detail.importSessionId} could not be finalized: expected ${detail.expectedStagedRows} staged and ${detail.expectedFailureRows} failure rows, ` +
        `found ${detail.foundStagedRows} and ${detail.foundFailureRows}. Re-run the import; the retry rebuilds both.`
    );
    this.name = 'ArcgisCommitVerificationError';
    this.detail = detail;
  }
}

export interface ArcgisFinalizeResult {
  committedRowCount: number;
  droppedRowCount: number;
}

async function countFamilyFailureRows(
  connectionManager: ConnectionManager,
  attempt: ArcgisCommitAttempt,
  fileName: string,
  transactionID: string
): Promise<number> {
  const countSQL = safeFormatQuery(
    attempt.schema,
    `SELECT COUNT(*) AS failureRowCount FROM ??.coremeasurements
     WHERE UploadFileID = ? AND (UploadBatchID = ? OR UploadBatchID LIKE ? ${LIKE_ESCAPE_CLAUSE}) AND CensusID = ?`
  );
  const rows = await connectionManager.executeQuery(
    countSQL,
    [fileName, attempt.batchID, buildSubBatchPattern(attempt.batchID), attempt.censusID],
    transactionID
  );
  return Number(rows?.[0]?.failureRowCount ?? 0);
}

async function verifyImportAccounting(
  connectionManager: ConnectionManager,
  attempt: ArcgisCommitAttempt,
  snapshot: ArcgisCommitUnitSnapshot,
  transactionID: string
): Promise<void> {
  const foundStagedRows = await countStagedRows(
    connectionManager,
    attempt.schema,
    snapshot.fileName,
    attempt.batchID,
    attempt.plotID,
    attempt.censusID,
    transactionID
  );
  const foundFailureRows = await countFamilyFailureRows(connectionManager, attempt, snapshot.fileName, transactionID);
  const expectedFailureRows = snapshot.rowCount - snapshot.committedRowCount;
  if (foundStagedRows !== snapshot.committedRowCount || foundFailureRows !== expectedFailureRows) {
    throw new ArcgisCommitVerificationError({
      importSessionId: attempt.importSessionId,
      expectedStagedRows: snapshot.committedRowCount,
      foundStagedRows,
      expectedFailureRows,
      foundFailureRows
    });
  }
}

/**
 * The `file_upload` changelog row, moved verbatim from the one-transaction commit. RecordID is keyed by upload attempt
 * (uploadSessionID), not by file name alone (#507); FOR UPDATE serializes this read-merge-write with any concurrent
 * writer of the same RecordID. A retry under a new upload session writes its own row; one under the same session
 * merges its contribution under this batch rather than adding to it.
 */
async function recordFileUploadChangelog(
  connectionManager: ConnectionManager,
  attempt: ArcgisCommitAttempt,
  fileName: string,
  counts: { rowCount: number; droppedCount: number },
  transactionID: string
): Promise<void> {
  const fileUploadRecordID = buildFileUploadChangelogRecordID(fileName, attempt.uploadSessionID);
  const existingEntrySQL = safeFormatQuery(
    attempt.schema,
    `SELECT ChangeID, NewRowState FROM ??.unifiedchangelog
     WHERE TableName = '${CHANGELOG_TABLE_NAME}' AND RecordID = ? AND CensusID = ?
     ORDER BY ChangeID DESC LIMIT 1
     FOR UPDATE`
  );
  const existingEntry = await connectionManager.executeQuery(existingEntrySQL, [fileUploadRecordID, attempt.censusID], transactionID);

  if (existingEntry.length === 0) {
    const uploadMetadata: Record<string, unknown> = {
      fileName,
      uploadSessionID: attempt.uploadSessionID,
      formType: FormType.measurements,
      sourceFormat: SourceFormat.arcgis_xlsx,
      uploadMode: attempt.uploadMode
    };
    mergeFileUploadChunkIntoMetadata(uploadMetadata, attempt.batchID, counts);
    const insertChangelogSQL = safeFormatQuery(
      attempt.schema,
      `INSERT INTO ??.unifiedchangelog
      (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
      VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`
    );
    await connectionManager.executeQuery(
      insertChangelogSQL,
      [
        CHANGELOG_TABLE_NAME,
        fileUploadRecordID,
        CHANGELOG_INSERT_OPERATION,
        JSON.stringify(uploadMetadata),
        attempt.changedBy,
        attempt.plotID,
        attempt.censusID
      ],
      transactionID
    );
    return;
  }

  const metadata = typeof existingEntry[0].NewRowState === 'string' ? JSON.parse(existingEntry[0].NewRowState) : existingEntry[0].NewRowState;
  metadata.sourceFormat = SourceFormat.arcgis_xlsx;
  metadata.uploadMode = attempt.uploadMode;
  mergeFileUploadChunkIntoMetadata(metadata, attempt.batchID, counts);
  const updateChangelogSQL = safeFormatQuery(attempt.schema, `UPDATE ??.unifiedchangelog SET NewRowState = ?, ChangeTimestamp = NOW() WHERE ChangeID = ?`);
  await connectionManager.executeQuery(updateChangelogSQL, [JSON.stringify(metadata), existingEntry[0].ChangeID], transactionID);
}

export async function finalizeArcgisCommit(
  connectionManager: ConnectionManager,
  attempt: ArcgisCommitAttempt,
  snapshot: ArcgisCommitUnitSnapshot,
  transactionID: string
): Promise<ArcgisFinalizeResult> {
  if (snapshot.stagingNextRowIndex !== snapshot.rowCount) {
    throw new ArcgisImportSessionInvariantError(
      attempt.importSessionId,
      `finalize reached with the staging cursor at ${snapshot.stagingNextRowIndex} of ${snapshot.rowCount}`
    );
  }
  if (attempt.uploadMode === UploadMode.CLEAN_REUPLOAD && !snapshot.censusReplacementCompleted) {
    throw new CensusReplacementIncompleteError(snapshot.fileName, attempt.batchID, attempt.uploadSessionID);
  }
  await verifyImportAccounting(connectionManager, attempt, snapshot, transactionID);
  const counts = { rowCount: snapshot.committedRowCount, droppedCount: snapshot.rowCount - snapshot.committedRowCount };
  await recordFileUploadChangelog(connectionManager, attempt, snapshot.fileName, counts, transactionID);
  await markArcgisImportCommitCompleted(connectionManager, attempt, transactionID);
  return { committedRowCount: counts.rowCount, droppedRowCount: counts.droppedCount };
}
