// api/reingestsinglefailure/[schema]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { generateShortBatchID } from '@/config/utils';

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
  let shiftQuery: string, clearQuery: string, bulkProcessSQL: string, reviewFailedSQL: string;
  try {
    shiftQuery = safeFormatQuery(
      schema,
      `INSERT INTO ??.temporarymeasurements (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
      SELECT 'single_row_file.csv' AS FileID, ? AS BatchID, PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes, Comments
      FROM ??.failedmeasurements WHERE FailedMeasurementID = ?`
    );
    clearQuery = safeFormatQuery(schema, 'DELETE FROM ??.failedmeasurements WHERE FailedMeasurementID = ?');
    bulkProcessSQL = safeFormatQuery(schema, 'CALL ??.bulkingestionprocess(?, ?)');
    reviewFailedSQL = safeFormatQuery(schema, 'CALL ??.reviewfailed()');
  } catch (error: any) {
    ailogger.error(`Invalid schema in reingestsinglefailure: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const staticBatchID = generateShortBatchID();
  const connectionManager = ConnectionManager.getInstance();
  let transactionID = '';
  try {
    transactionID = await connectionManager.beginTransaction();
    await connectionManager.executeQuery(shiftQuery, [staticBatchID, targetRowID], transactionID);
    await connectionManager.executeQuery(clearQuery, [targetRowID], transactionID);
    await connectionManager.executeQuery(bulkProcessSQL, ['single_row_file.csv', staticBatchID], transactionID);
    await connectionManager.commitTransaction(transactionID);
    return NextResponse.json({ message: 'Success' }, { status: HTTPResponses.OK });
  } catch (e: any) {
    ailogger.error('Failed to reingest single failure:', e);
    if (transactionID) {
      await connectionManager.rollbackTransaction(transactionID);
    }
    // reinsert into table in case removed
    try {
      await connectionManager.executeQuery(reviewFailedSQL);
    } catch (reviewError: any) {
      ailogger.error('Failed to run reviewfailed after error:', reviewError);
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
