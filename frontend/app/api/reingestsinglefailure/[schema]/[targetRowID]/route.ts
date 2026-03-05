// api/reingestsinglefailure/[schema]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { generateShortBatchID } from '@/config/utils';
import { INGESTION_ERROR_SOURCE } from '@/config/measurementerrors';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

const SINGLE_ROW_FILE_ID = 'single_row_file.csv';
const MAX_SIGNED_INT = 2147483647;

export async function GET(
  _request: NextRequest,
  props: {
    params: Promise<{ schema: string; targetRowID: string }>;
  }
) {
  const { schema, targetRowID } = await props.params;
  if (!schema || !targetRowID) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters: schema, targetRowID' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const targetMeasurementID = Number(targetRowID);
  if (!Number.isInteger(targetMeasurementID) || targetMeasurementID <= 0) {
    return new NextResponse(JSON.stringify({ error: 'targetRowID must be a positive integer' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // Validate schema to prevent SQL injection
  let maxTempIDSQL: string, shiftQuery: string, bulkProcessSQL: string;
  let resolveIngestionSQL: string, transferErrorSQL: string, syncOriginalRowSQL: string, deleteTransientSQL: string;
  try {
    maxTempIDSQL = safeFormatQuery(schema, 'SELECT COALESCE(MAX(id), 0) as maxId FROM ??.temporarymeasurements');
    shiftQuery = safeFormatQuery(
      schema,
      `INSERT INTO ??.temporarymeasurements
        (id, FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
       SELECT
         ? AS id,
         ? AS FileID,
         ? AS BatchID,
         c.PlotID,
         cm.CensusID,
         cm.RawTreeTag,
         cm.RawStemTag,
         cm.RawSpCode,
         cm.RawQuadrat,
         cm.RawX,
         cm.RawY,
         cm.MeasuredDBH,
         cm.MeasuredHOM,
         cm.MeasurementDate,
         cm.RawCodes,
         cm.RawComments
       FROM ??.coremeasurements cm
       JOIN ??.census c ON c.CensusID = cm.CensusID
       WHERE cm.CoreMeasurementID = ?
         AND cm.StemGUID IS NULL
         AND EXISTS (
           SELECT 1
           FROM ??.measurement_error_log mel
           JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
           WHERE mel.MeasurementID = cm.CoreMeasurementID
             AND me.ErrorSource = ?
         )`
    );
    bulkProcessSQL = safeFormatQuery(schema, 'CALL ??.bulkingestionprocess(?, ?)');
    resolveIngestionSQL = safeFormatQuery(
      schema,
      `UPDATE ??.measurement_error_log mel
       JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
       SET mel.IsResolved = TRUE, mel.ResolvedAt = NOW()
       WHERE mel.MeasurementID = ?
         AND mel.IsResolved = FALSE
         AND me.ErrorSource = ?`
    );
    transferErrorSQL = safeFormatQuery(
      schema,
      `INSERT INTO ??.measurement_error_log (MeasurementID, ErrorID, IsResolved, CreatedAt, ResolvedAt)
       SELECT ?, mel_new.ErrorID, mel_new.IsResolved, mel_new.CreatedAt, mel_new.ResolvedAt
       FROM ??.coremeasurements cm_new
       JOIN ??.measurement_error_log mel_new ON mel_new.MeasurementID = cm_new.CoreMeasurementID
       WHERE cm_new.UploadFileID = ?
         AND cm_new.UploadBatchID = ?
         AND cm_new.SourceRowIndex = ?
       ON DUPLICATE KEY UPDATE
         IsResolved = VALUES(IsResolved),
         ResolvedAt = VALUES(ResolvedAt)`
    );
    // Preserve original upload metadata to avoid uniqueness conflicts with transient rows
    // on ux_cm_uploadbatch_rowindex.
    syncOriginalRowSQL = safeFormatQuery(
      schema,
      `UPDATE ??.coremeasurements orig
       JOIN ??.coremeasurements cm_new
         ON cm_new.UploadFileID = ?
         AND cm_new.UploadBatchID = ?
         AND cm_new.SourceRowIndex = ?
       SET orig.CensusID = cm_new.CensusID,
           orig.StemGUID = cm_new.StemGUID,
           orig.IsValidated = cm_new.IsValidated,
           orig.MeasurementDate = cm_new.MeasurementDate,
           orig.MeasuredDBH = cm_new.MeasuredDBH,
           orig.MeasuredHOM = cm_new.MeasuredHOM,
           orig.Description = cm_new.Description,
           orig.UserDefinedFields = cm_new.UserDefinedFields,
           orig.RawTreeTag = cm_new.RawTreeTag,
           orig.RawStemTag = cm_new.RawStemTag,
           orig.RawSpCode = cm_new.RawSpCode,
           orig.RawQuadrat = cm_new.RawQuadrat,
           orig.RawX = cm_new.RawX,
           orig.RawY = cm_new.RawY,
           orig.RawCodes = cm_new.RawCodes,
           orig.RawComments = cm_new.RawComments,
           orig.IsActive = cm_new.IsActive
       WHERE orig.CoreMeasurementID = ?`
    );
    deleteTransientSQL = safeFormatQuery(
      schema,
      `DELETE FROM ??.coremeasurements
       WHERE UploadFileID = ?
         AND UploadBatchID = ?
         AND SourceRowIndex = ?`
    );
  } catch (error: any) {
    ailogger.error(`Invalid schema in reingestsinglefailure: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const batchID = generateShortBatchID();
  const connectionManager = ConnectionManager.getInstance();
  let transactionID = '';
  try {
    transactionID = await connectionManager.beginTransaction();

    const maxIDResult = await connectionManager.executeQuery(maxTempIDSQL, [], transactionID);
    const temporaryRowID = Number(maxIDResult[0]?.maxId || 0) + 1;
    if (temporaryRowID > MAX_SIGNED_INT) {
      throw new Error(`Temporary row id overflow for single-row reingestion: ${temporaryRowID}`);
    }

    const shiftResult: any = await connectionManager.executeQuery(
      shiftQuery,
      [temporaryRowID, SINGLE_ROW_FILE_ID, batchID, targetMeasurementID, INGESTION_ERROR_SOURCE],
      transactionID
    );

    if (!shiftResult?.affectedRows) {
      await connectionManager.rollbackTransaction(transactionID);
      return new NextResponse(
        JSON.stringify({ error: `No failed measurement row found for CoreMeasurementID ${targetMeasurementID}` }),
        { status: HTTPResponses.NOT_FOUND }
      );
    }

    await connectionManager.executeQuery(bulkProcessSQL, [SINGLE_ROW_FILE_ID, batchID], transactionID);

    await connectionManager.executeQuery(resolveIngestionSQL, [targetMeasurementID, INGESTION_ERROR_SOURCE], transactionID);
    await connectionManager.executeQuery(transferErrorSQL, [targetMeasurementID, SINGLE_ROW_FILE_ID, batchID, temporaryRowID], transactionID);
    await connectionManager.executeQuery(syncOriginalRowSQL, [SINGLE_ROW_FILE_ID, batchID, temporaryRowID, targetMeasurementID], transactionID);
    await connectionManager.executeQuery(deleteTransientSQL, [SINGLE_ROW_FILE_ID, batchID, temporaryRowID], transactionID);

    await connectionManager.commitTransaction(transactionID);
    return NextResponse.json({ message: 'Success' }, { status: HTTPResponses.OK });
  } catch (e: any) {
    ailogger.error('Failed to reingest single failure:', e);
    if (transactionID) {
      await connectionManager.rollbackTransaction(transactionID);
    }
    return new NextResponse(JSON.stringify({ error: e.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    // Always close connection to prevent connection leaks
    try {
      await connectionManager.closeConnection();
    } catch (closeError: any) {
      ailogger.error('Failed to close connection in reingestsinglefailure:', closeError);
    }
  }
}
