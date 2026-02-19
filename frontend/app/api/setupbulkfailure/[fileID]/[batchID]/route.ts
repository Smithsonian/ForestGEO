import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { getSchemaCapabilities } from '@/config/utils/schemacapabilities';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// FAILURE PROCESS -- IF A BATCH EXCEEDS ALLOWED ATTEMPTS, MOVE IT TO FAILED & MOVE ON
export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{ fileID: string; batchID: string }>;
  }
) {
  const schema = request.nextUrl.searchParams.get('schema');
  const { fileID, batchID } = await props.params;
  if (!schema || !fileID || !batchID) {
    return new NextResponse(JSON.stringify({ error: 'Missing parameters' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  let insertSQL: string;
  let deleteTempSQL: string;
  let insertParams: any[];
  try {
    deleteTempSQL = safeFormatQuery(schema, 'DELETE FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?');
  } catch (error: any) {
    ailogger.error(`Invalid schema in setupbulkfailure: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();
  const { hasUploadErrors } = await getSchemaCapabilities(schema);

  if (hasUploadErrors) {
    insertSQL = safeFormatQuery(
      schema,
      `INSERT INTO ??.upload_errors
         (FileID, BatchID, PlotID, CensusID, RowIndex, RawData, ErrorType, ErrorMessage)
       SELECT tm.FileID,
              tm.BatchID,
              tm.PlotID,
              tm.CensusID,
              tm.id,
              JSON_OBJECT(
                  'tag', tm.TreeTag,
                  'stemTag', tm.StemTag,
                  'spCode', tm.SpeciesCode,
                  'quadrat', tm.QuadratName,
                  'x', tm.LocalX,
                  'y', tm.LocalY,
                  'dbh', tm.DBH,
                  'hom', tm.HOM,
                  'date', tm.MeasurementDate,
                  'codes', tm.Codes,
                  'comments', tm.Comments
              ),
              ?,
              ?
       FROM ??.temporarymeasurements tm
       WHERE tm.FileID = ? AND tm.BatchID = ?`
    );
    insertParams = ['BATCH_PROCESSING_ERROR', 'Batch moved after max attempts', fileID, batchID];
  } else {
    insertSQL = safeFormatQuery(
      schema,
      `INSERT INTO ??.failedmeasurements
         (FileID, BatchID, PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes, Comments, OriginalFailureReasons, CurrentFailureReasons, FailureReasons)
       SELECT DISTINCT FileID,
                       BatchID,
                       PlotID,
                       CensusID,
                       NULLIF(TreeTag, '')                   AS Tag,
                       NULLIF(StemTag, '')                   AS StemTag,
                       NULLIF(SpeciesCode, '')               AS SpCode,
                       NULLIF(QuadratName, '')               AS Quadrat,
                       LocalX                                AS X,
                       LocalY                                AS Y,
                       NULLIF(DBH, 0)                        AS DBH,
                       NULLIF(HOM, 0)                        AS HOM,
                       NULLIF(MeasurementDate, '1900-01-01') AS MeasurementDate,
                       NULLIF(Codes, '')                     AS Codes,
                       NULLIF(Comments, '')                  AS Comments,
                       'Batch moved after max attempts'      AS OriginalFailureReasons,
                       NULL                                  AS CurrentFailureReasons,
                       NULL                                  AS FailureReasons
       FROM ??.temporarymeasurements
       WHERE FileID = ? AND BatchID = ?`
    );
    insertParams = [fileID, batchID];
  }

  let transactionID: string | null = null;
  try {
    transactionID = await connectionManager.beginTransaction();
    await connectionManager.executeQuery(insertSQL, insertParams, transactionID);

    if (!hasUploadErrors) {
      const reviewFailedSQL = safeFormatQuery(schema, 'CALL ??.reviewfailed()');
      await connectionManager.executeQuery(reviewFailedSQL, [], transactionID);
    }

    await connectionManager.executeQuery(deleteTempSQL, [fileID, batchID], transactionID);
    await connectionManager.commitTransaction(transactionID);
  } catch (error: any) {
    await connectionManager.rollbackTransaction(transactionID ?? '');
    const targetTable = hasUploadErrors ? 'upload_errors' : 'failedmeasurements';
    throw new Error(`failure transfer to ${targetTable} --> error detected: ${error.message}`);
  }
  return new NextResponse(JSON.stringify({ temp: true }), { status: HTTPResponses.OK });
}
