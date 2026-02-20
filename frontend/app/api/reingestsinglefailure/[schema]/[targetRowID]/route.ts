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

  // Validate schema to prevent SQL injection
  let shiftQuery: string, clearQuery: string, clearErrorsQuery: string, bulkProcessSQL: string;
  try {
    shiftQuery = safeFormatQuery(
      schema,
      `INSERT INTO ??.temporarymeasurements
        (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
       SELECT
         'single_row_file.csv' AS FileID,
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
       JOIN ??.measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
       JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE cm.CoreMeasurementID = ?
         AND cm.StemGUID IS NULL
         AND mel.IsResolved = FALSE
         AND me.ErrorSource = ?
       GROUP BY
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
         cm.RawComments`
    );
    clearErrorsQuery = safeFormatQuery(
      schema,
      `UPDATE ??.measurement_error_log mel
       JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
       SET mel.IsResolved = TRUE, mel.ResolvedAt = NOW()
       WHERE mel.MeasurementID = ?
         AND mel.IsResolved = FALSE
         AND me.ErrorSource = ?`
    );
    clearQuery = safeFormatQuery(schema, 'DELETE FROM ??.coremeasurements WHERE CoreMeasurementID = ? AND StemGUID IS NULL');
    bulkProcessSQL = safeFormatQuery(schema, 'CALL ??.bulkingestionprocess(?, ?)');
  } catch (error: any) {
    ailogger.error(`Invalid schema in reingestsinglefailure: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const staticBatchID = generateShortBatchID();
  const connectionManager = ConnectionManager.getInstance();
  let transactionID = '';
  try {
    transactionID = await connectionManager.beginTransaction();
    await connectionManager.executeQuery(shiftQuery, [staticBatchID, targetRowID, INGESTION_ERROR_SOURCE], transactionID);
    await connectionManager.executeQuery(clearErrorsQuery, [targetRowID, INGESTION_ERROR_SOURCE], transactionID);
    await connectionManager.executeQuery(clearQuery, [targetRowID], transactionID);
    await connectionManager.executeQuery(bulkProcessSQL, ['single_row_file.csv', staticBatchID], transactionID);
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
