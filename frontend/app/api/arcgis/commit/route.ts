import { NextRequest, NextResponse } from 'next/server';
import { format } from 'mysql2/promise';
import moment from 'moment';
import { auth } from '@/auth';
import ailogger from '@/ailogger';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { assertCanEditMeasurementScope, ScopeAccessError } from '@/config/editplan/scopeguard';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { getSessionUserId, requireSession } from '@/lib/auth-helpers';
import { requireUploadSessionOwnership, UploadSessionOwnershipError, UploadSessionState as TrackedUploadSessionState } from '@/config/uploadsessiontracker';
import { ArcgisImportSessionError, loadStagedArcgisSession } from '@/lib/arcgis/import-session';
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
    !batchID
  ) {
    return NextResponse.json(
      { error: 'Missing or invalid parameters: schema, plotID, censusID, importSessionId, batchID' },
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    await assertCanEditMeasurementScope(connectionManager, session!, { schema, plotID, censusID });
    await requireUploadSessionOwnership({
      schema,
      sessionId,
      plotId: plotID,
      censusId: censusID,
      allowedStates: [TrackedUploadSessionState.INITIALIZED, TrackedUploadSessionState.UPLOADING],
      contextLabel: `arcgis commit for session ${importSessionId}`
    });

    const staged = await loadStagedArcgisSession({ schema, importSessionId, plotID, censusID, userId, fileName: requestedFileName });
    const fileName = staged.fileName;
    if (staged.rows.length === 0) {
      return NextResponse.json({ error: 'ArcGIS import session contains no rows' }, { status: HTTPResponses.UNPROCESSABLE_ENTITY });
    }

    await ensureTemporaryMeasurementsSourceFormatColumn(connectionManager, schema);

    let insertedCount = 0;
    await connectionManager.withTransaction(async transactionID => {
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
    });

    return NextResponse.json({ rowCount: insertedCount, fileName }, { status: HTTPResponses.OK });
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
