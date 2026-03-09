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

function serializeJsonParam(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

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
  let shiftQuery: string, bulkProcessSQL: string;
  let resolveIngestionSQL: string,
    transferErrorSQL: string,
    snapshotResultSQL: string,
    snapshotAttributesSQL: string,
    syncOriginalRowSQL: string,
    clearOriginalAttributesSQL: string,
    restoreOriginalAttributesSQL: string,
    deleteTransientSQL: string;
  try {
    shiftQuery = safeFormatQuery(
      schema,
      `INSERT INTO ??.temporarymeasurements
        (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
       SELECT
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
    snapshotResultSQL = safeFormatQuery(
      schema,
      `SELECT
         CensusID,
         StemGUID,
         IsValidated,
         MeasurementDate,
         MeasuredDBH,
         MeasuredHOM,
         Description,
         UserDefinedFields,
         RawTreeTag,
         RawStemTag,
         RawSpCode,
         RawQuadrat,
         RawX,
         RawY,
         RawCodes,
         RawComments,
         IsActive
       FROM ??.coremeasurements
       WHERE UploadFileID = ?
         AND UploadBatchID = ?
         AND SourceRowIndex = ?
       LIMIT 1`
    );
    snapshotAttributesSQL = safeFormatQuery(
      schema,
      `SELECT ca.Code
       FROM ??.cmattributes ca
       JOIN ??.coremeasurements cm_new ON cm_new.CoreMeasurementID = ca.CoreMeasurementID
       WHERE cm_new.UploadFileID = ?
         AND cm_new.UploadBatchID = ?
         AND cm_new.SourceRowIndex = ?`
    );
    // Preserve original upload metadata while applying the reprocessed values.
    syncOriginalRowSQL = safeFormatQuery(
      schema,
      `UPDATE ??.coremeasurements orig
       SET orig.CensusID = ?,
           orig.StemGUID = ?,
           orig.IsValidated = ?,
           orig.MeasurementDate = ?,
           orig.MeasuredDBH = ?,
           orig.MeasuredHOM = ?,
           orig.Description = ?,
           orig.UserDefinedFields = ?,
           orig.RawTreeTag = ?,
           orig.RawStemTag = ?,
           orig.RawSpCode = ?,
           orig.RawQuadrat = ?,
           orig.RawX = ?,
           orig.RawY = ?,
           orig.RawCodes = ?,
           orig.RawComments = ?,
           orig.IsActive = ?
       WHERE orig.CoreMeasurementID = ?`
    );
    clearOriginalAttributesSQL = safeFormatQuery(schema, 'DELETE FROM ??.cmattributes WHERE CoreMeasurementID = ?');
    restoreOriginalAttributesSQL = safeFormatQuery(schema, 'INSERT IGNORE INTO ??.cmattributes (CoreMeasurementID, Code) VALUES ?');
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

    const shiftResult: any = await connectionManager.executeQuery(
      shiftQuery,
      [SINGLE_ROW_FILE_ID, batchID, targetMeasurementID, INGESTION_ERROR_SOURCE],
      transactionID
    );

    const temporaryRowID = Number(shiftResult?.insertId ?? 0);
    if (temporaryRowID > MAX_SIGNED_INT) {
      throw new Error(`Temporary row id overflow for single-row reingestion: ${temporaryRowID}`);
    }

    if (!shiftResult?.affectedRows) {
      await connectionManager.rollbackTransaction(transactionID);
      return new NextResponse(
        JSON.stringify({ error: `No failed measurement row found for CoreMeasurementID ${targetMeasurementID}` }),
        { status: HTTPResponses.NOT_FOUND }
      );
    }
    if (!Number.isInteger(temporaryRowID) || temporaryRowID <= 0) {
      throw new Error('Single-row reingestion staging insert did not return a usable insertId');
    }

    await connectionManager.executeQuery(bulkProcessSQL, [SINGLE_ROW_FILE_ID, batchID], transactionID);

    const snapshotRows: any[] = await connectionManager.executeQuery(
      snapshotResultSQL,
      [SINGLE_ROW_FILE_ID, batchID, temporaryRowID],
      transactionID
    );
    const snapshot = snapshotRows[0];
    if (!snapshot) {
      throw new Error(`Single-row reingestion produced no reconciliable result for SourceRowIndex ${temporaryRowID}`);
    }

    const attributeRows: Array<{ Code: string }> = await connectionManager.executeQuery(
      snapshotAttributesSQL,
      [SINGLE_ROW_FILE_ID, batchID, temporaryRowID],
      transactionID
    );

    await connectionManager.executeQuery(resolveIngestionSQL, [targetMeasurementID, INGESTION_ERROR_SOURCE], transactionID);
    await connectionManager.executeQuery(transferErrorSQL, [targetMeasurementID, SINGLE_ROW_FILE_ID, batchID, temporaryRowID], transactionID);
    await connectionManager.executeQuery(deleteTransientSQL, [SINGLE_ROW_FILE_ID, batchID, temporaryRowID], transactionID);
    await connectionManager.executeQuery(
      syncOriginalRowSQL,
      [
        snapshot.CensusID,
        snapshot.StemGUID,
        snapshot.IsValidated,
        snapshot.MeasurementDate,
        snapshot.MeasuredDBH,
        snapshot.MeasuredHOM,
        snapshot.Description,
        serializeJsonParam(snapshot.UserDefinedFields),
        snapshot.RawTreeTag,
        snapshot.RawStemTag,
        snapshot.RawSpCode,
        snapshot.RawQuadrat,
        snapshot.RawX,
        snapshot.RawY,
        snapshot.RawCodes,
        snapshot.RawComments,
        snapshot.IsActive,
        targetMeasurementID
      ],
      transactionID
    );
    await connectionManager.executeQuery(clearOriginalAttributesSQL, [targetMeasurementID], transactionID);
    if (attributeRows.length > 0) {
      const attributeValues = attributeRows.map(row => [targetMeasurementID, row.Code]);
      await connectionManager.executeQuery(restoreOriginalAttributesSQL, [attributeValues], transactionID);
    }

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
