import { NextRequest, NextResponse } from 'next/server';
import { format } from 'mysql2/promise';
import moment from 'moment';
import { auth } from '@/auth';
import ailogger from '@/ailogger';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { FormType, SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { assertCanEditMeasurementScope, ScopeAccessError } from '@/config/editplan/scopeguard';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { getSessionUserId, requireSession } from '@/lib/auth-helpers';
import { requireUploadSessionOwnership, UploadSessionOwnershipError, UploadSessionState as TrackedUploadSessionState } from '@/config/uploadsessiontracker';
import {
  ArcgisImportSessionError,
  claimArcgisImportSessionForCommit,
  ensureArcgisImportTables,
  markArcgisImportSessionCommitted
} from '@/lib/arcgis/import-session';
import {
  buildDroppedMeasurementFailureReason,
  cleanupPreviousFileUploads,
  cleanupStaleMeasurementBatchesForFile,
  ensureTemporaryMeasurementsSourceFormatColumn,
  findDroppedMeasurementCandidates,
  insertTemporaryMeasurementsInBatches,
  type DroppedMeasurementRow
} from '@/lib/ingestion/temporary-measurements';
import { insertIngestionFailureRows } from '@/config/measurementerrors';

export const runtime = 'nodejs';

const ARCGIS_COMMIT_INSERT_FAILURE_FALLBACK = 'Unknown error during insert';

function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const userId = getSessionUserId(session!);
  if (!userId) {
    return NextResponse.json({ error: 'Authenticated session has no user identifier' }, { status: HTTPResponses.UNAUTHORIZED });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid ArcGIS commit request body' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const schema = typeof body.schema === 'string' ? body.schema.trim() : '';
  const plotID = Number(body.plotID);
  const censusID = Number(body.censusID);
  const importSessionId = typeof body.importSessionId === 'string' ? body.importSessionId.trim() : '';
  const batchID = typeof body.batchID === 'string' ? body.batchID.trim() : '';
  const requestedFileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const uploadMode: UploadMode = body.uploadMode === UploadMode.CLEAN_REUPLOAD ? UploadMode.CLEAN_REUPLOAD : UploadMode.REVISIONS;
  const sessionId = request.headers.get('x-upload-session-id') ?? '';

  if (
    !schema ||
    !isValidSchema(schema) ||
    !Number.isSafeInteger(plotID) ||
    plotID <= 0 ||
    !Number.isSafeInteger(censusID) ||
    censusID <= 0 ||
    !importSessionId ||
    !batchID ||
    !requestedFileName
  ) {
    return NextResponse.json(
      { error: 'Missing or invalid parameters: schema, plotID, censusID, importSessionId, batchID, fileName' },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    await assertCanEditMeasurementScope(connectionManager, session!, { schema, plotID, censusID });
    const uploadSession = await requireUploadSessionOwnership({
      schema,
      sessionId,
      plotId: plotID,
      censusId: censusID,
      allowedStates: [TrackedUploadSessionState.INITIALIZED, TrackedUploadSessionState.UPLOADING],
      contextLabel: `arcgis commit for session ${importSessionId}`
    });

    await ensureArcgisImportTables(schema);
    await ensureTemporaryMeasurementsSourceFormatColumn(connectionManager, schema);

    let insertedCount = 0;
    let fileName = requestedFileName;
    let alreadyCommitted = false;
    await connectionManager.withTransaction(async transactionID => {
      const staged = await claimArcgisImportSessionForCommit(
        {
          schema,
          importSessionId,
          plotID,
          censusID,
          userId,
          fileName: requestedFileName,
          batchID,
          uploadSessionID: uploadSession.sessionId ?? sessionId
        },
        transactionID
      );
      fileName = staged.fileName;
      if (staged.alreadyCommitted) {
        insertedCount = staged.rowCount;
        alreadyCommitted = true;
        return;
      }

      if (staged.rows.length === 0) {
        throw new ArcgisImportSessionError('ArcGIS import session contains no rows', HTTPResponses.UNPROCESSABLE_ENTITY);
      }

      const countSQL = format(`SELECT COUNT(*) as count FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?`, [schema]);
      const preInsertResult = await connectionManager.executeQuery(countSQL, [fileName, batchID], transactionID);
      const preInsertCount = preInsertResult[0]?.count || 0;

      if (uploadMode === UploadMode.CLEAN_REUPLOAD) {
        await cleanupPreviousFileUploads(connectionManager, schema, fileName, batchID, plotID, censusID, transactionID);
      }
      await cleanupStaleMeasurementBatchesForFile(connectionManager, schema, fileName, batchID, plotID, censusID, transactionID);

      await insertTemporaryMeasurementsInBatches(
        connectionManager,
        schema,
        staged.rows,
        fileName,
        batchID,
        sessionId,
        SourceFormat.arcgis_xlsx,
        plotID,
        censusID,
        transactionID
      );

      const postInsertResult = await connectionManager.executeQuery(countSQL, [fileName, batchID], transactionID);
      const postInsertCount = postInsertResult[0]?.count || 0;
      insertedCount = postInsertCount - preInsertCount;

      const droppedRowCount = staged.rows.length - insertedCount;
      if (droppedRowCount > 0) {
        ailogger.error(
          `DATA INTEGRITY WARNING: Expected ${staged.rows.length} ArcGIS rows but only ${insertedCount} were inserted for ${fileName}-${batchID}. ` +
            `${droppedRowCount} row(s) were silently dropped by INSERT IGNORE (likely duplicates). This indicates potential data loss!`
        );

        const droppedCandidates = await findDroppedMeasurementCandidates(
          connectionManager,
          schema,
          fileName,
          batchID,
          plotID,
          censusID,
          staged.rows,
          transactionID
        );
        const droppedRows: DroppedMeasurementRow[] = droppedCandidates.map(candidate => {
          const row = staged.rows[candidate.rowOrdinal - 1];
          return Object.assign({}, row, {
            failureReason: buildDroppedMeasurementFailureReason(row, candidate.existingBatch),
            sourceRowIndex: candidate.rowOrdinal
          }) as DroppedMeasurementRow;
        });

        if (droppedRows.length !== droppedRowCount) {
          ailogger.warn(
            `Dropped-row batch detection identified ${droppedRows.length} of ${droppedRowCount} dropped ArcGIS row(s) for ${fileName}-${batchID}. ` +
              `Persisted unresolved ingestion errors may be incomplete for this commit.`
          );
        }

        if (droppedRows.length > 0) {
          // Unlike the CSV sqlpacketload path, which wraps failure-row persistence in a retry-once-then-uploadintegrityalerts
          // best-effort fallback, this endpoint deliberately persists dropped rows inside the same transaction as the staging
          // insert so the commit is all-or-nothing: if failure-row persistence throws, the entire commit rolls back rather than
          // leaving a half-committed batch. Do not "restore parity" with a best-effort fallback here — that would weaken atomicity.
          await insertIngestionFailureRows(
            connectionManager,
            schema,
            droppedRows.map(row => ({
              plotID,
              censusID,
              tag: row.tag,
              stemTag: row.stemtag || null,
              spCode: row.spcode,
              quadrat: row.quadrat,
              x: toNullableNumber(row.lx),
              y: toNullableNumber(row.ly),
              dbh: toNullableNumber(row.dbh),
              hom: toNullableNumber(row.hom),
              date: row.date ? moment(row.date).format('YYYY-MM-DD') : null,
              codes: row.codes || null,
              comments: null,
              fileID: fileName,
              batchID,
              sourceRowIndex: row.sourceRowIndex,
              failureReason: row.failureReason || ARCGIS_COMMIT_INSERT_FAILURE_FALLBACK
            })),
            transactionID
          );
          ailogger.info(`Persisted ${droppedRows.length} dropped ArcGIS rows as unresolved ingestion errors for ${fileName}-${batchID}`);
        }
      }

      // Mirror the CSV measurements path (POST /api/sqlpacketload): record a single
      // file_upload row in unifiedchangelog so the ArcGIS commit surfaces in the
      // upload-history UI with the same provenance shape (sourceFormat tags it as
      // arcgis_xlsx). Unlike the CSV path, this write stays inside the commit
      // transaction with no best-effort try/catch fallback: the commit is
      // all-or-nothing, so if changelog tracking fails the staging insert rolls
      // back too rather than leaving an upload invisible in history.
      const existingEntrySQL = format(
        `SELECT ChangeID, NewRowState FROM ??.unifiedchangelog
         WHERE TableName = 'file_upload' AND RecordID = ? AND CensusID = ?
         ORDER BY ChangeID DESC LIMIT 1`,
        [schema]
      );
      const existingEntry = await connectionManager.executeQuery(existingEntrySQL, [fileName, censusID], transactionID);

      if (existingEntry.length === 0) {
        const uploadMetadata = JSON.stringify({
          fileName,
          formType: FormType.measurements,
          sourceFormat: SourceFormat.arcgis_xlsx,
          uploadMode,
          rowCount: insertedCount,
          droppedCount: droppedRowCount,
          batchCount: 1
        });
        const insertChangelogSQL = format(
          `INSERT INTO ??.unifiedchangelog
          (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID, CensusID)
          VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)`,
          [schema]
        );
        await connectionManager.executeQuery(insertChangelogSQL, ['file_upload', fileName, 'INSERT', uploadMetadata, userId, plotID, censusID], transactionID);
      } else {
        const metadata = typeof existingEntry[0].NewRowState === 'string' ? JSON.parse(existingEntry[0].NewRowState) : existingEntry[0].NewRowState;
        metadata.sourceFormat = SourceFormat.arcgis_xlsx;
        metadata.uploadMode = uploadMode;
        metadata.rowCount = (metadata.rowCount || 0) + insertedCount;
        metadata.droppedCount = (metadata.droppedCount || 0) + droppedRowCount;
        metadata.batchCount = (metadata.batchCount || 1) + 1;
        const updateChangelogSQL = format(`UPDATE ??.unifiedchangelog SET NewRowState = ?, ChangeTimestamp = NOW() WHERE ChangeID = ?`, [schema]);
        await connectionManager.executeQuery(updateChangelogSQL, [JSON.stringify(metadata), existingEntry[0].ChangeID], transactionID);
      }

      await markArcgisImportSessionCommitted({ schema, importSessionId, insertedRowCount: insertedCount }, transactionID);
    });

    return NextResponse.json({ rowCount: insertedCount, fileName, alreadyCommitted }, { status: HTTPResponses.OK });
  } catch (error: unknown) {
    if (error instanceof ArcgisImportSessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ScopeAccessError) {
      return NextResponse.json({ error: error.message }, { status: HTTPResponses.FORBIDDEN });
    }
    if (error instanceof UploadSessionOwnershipError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const errorObj = error instanceof Error ? error : new Error(String(error));
    ailogger.error('ArcGIS commit failed:', errorObj);
    return NextResponse.json({ error: errorObj.message || 'ArcGIS commit failed' }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
