import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import { insertIngestionFailureRows } from '@/config/measurementerrors';
import { validateSchemaOrThrow, safeFormatQuery } from '@/config/utils/sqlsecurity';
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

  try {
    validateSchemaOrThrow(schema);
  } catch (error: any) {
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | null = null;
  try {
    transactionID = await connectionManager.beginTransaction();
    const selectTempSQL = safeFormatQuery(
      schema,
      `SELECT id, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments
       FROM ??.temporarymeasurements
       WHERE FileID = ? AND BatchID = ?`
    );
    const sourceRows: any[] = await connectionManager.executeQuery(
      selectTempSQL,
      [fileID, batchID],
      transactionID
    );

    if (sourceRows.length > 0) {
      await insertIngestionFailureRows(
        connectionManager,
        schema,
        sourceRows.map((row, idx) => ({
          plotID: row.PlotID,
          censusID: row.CensusID,
          tag: row.TreeTag,
          stemTag: row.StemTag,
          spCode: row.SpeciesCode,
          quadrat: row.QuadratName,
          x: row.LocalX,
          y: row.LocalY,
          dbh: row.DBH,
          hom: row.HOM,
          date: row.MeasurementDate,
          codes: row.Codes,
          comments: row.Comments,
          fileID,
          batchID,
          sourceRowIndex: row.id ?? idx + 1,
          failureReason: 'Batch moved after max attempts'
        })),
        transactionID
      );
    }

    const deleteTempSQL = safeFormatQuery(schema, 'DELETE FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?');
    await connectionManager.executeQuery(deleteTempSQL, [fileID, batchID], transactionID);

    await connectionManager.commitTransaction(transactionID);
    ailogger.warn(`Moved ${sourceRows.length} temporary rows to unresolved coremeasurements for ${fileID}-${batchID}`);
  } catch (error: any) {
    await connectionManager.rollbackTransaction(transactionID ?? '');
    ailogger.error(`failure transfer for ${fileID}-${batchID}:`, error);
    return new NextResponse(
      JSON.stringify({
        error: 'Failure transfer to unresolved coremeasurements detected.',
        details: error.message
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  } finally {
    await connectionManager.closeConnection();
  }
  return new NextResponse(JSON.stringify({ temp: true }), { status: HTTPResponses.OK });
}
