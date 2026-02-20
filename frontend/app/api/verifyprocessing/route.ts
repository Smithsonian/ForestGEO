import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { INGESTION_ERROR_SOURCE } from '@/config/measurementerrors';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const schema = searchParams.get('schema');
  const plotID = searchParams.get('plotID');
  const censusID = searchParams.get('censusID');
  // Optional fileId parameter to filter by current upload session
  const fileId = searchParams.get('fileId');

  if (!schema || !plotID || !censusID) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters: schema, plotID, censusID' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // Validate schema to prevent SQL injection
  let tempSQL: string, processedSQL: string, failedSQL: string;
  let tempParams: (string | number)[];
  let failedParams: (string | number)[];

  try {
    // If fileId is provided, filter temporarymeasurements and unresolved ingestion errors by it.
    // This allows tracking current upload progress vs cumulative totals
    if (fileId) {
      tempSQL = safeFormatQuery(schema, 'SELECT COUNT(*) as count FROM ??.temporarymeasurements WHERE PlotID = ? AND CensusID = ? AND FileID = ?');
      tempParams = [plotID, censusID, fileId];
      failedSQL = safeFormatQuery(
        schema,
        `SELECT COUNT(DISTINCT cm.CoreMeasurementID) as count
         FROM ??.coremeasurements cm
         JOIN ??.census c ON cm.CensusID = c.CensusID
         JOIN ??.measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
         JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
         WHERE c.PlotID = ?
           AND cm.CensusID = ?
           AND cm.UploadFileID = ?
           AND cm.StemGUID IS NULL
           AND mel.IsResolved = FALSE
           AND me.ErrorSource = ?`
      );
      failedParams = [plotID, censusID, fileId];
    } else {
      tempSQL = safeFormatQuery(schema, 'SELECT COUNT(*) as count FROM ??.temporarymeasurements WHERE PlotID = ? AND CensusID = ?');
      tempParams = [plotID, censusID];
      failedSQL = safeFormatQuery(
        schema,
        `SELECT COUNT(DISTINCT cm.CoreMeasurementID) as count
         FROM ??.coremeasurements cm
         JOIN ??.census c ON cm.CensusID = c.CensusID
         JOIN ??.measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
         JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
         WHERE c.PlotID = ?
           AND cm.CensusID = ?
           AND cm.StemGUID IS NULL
           AND mel.IsResolved = FALSE
           AND me.ErrorSource = ?`
      );
      failedParams = [plotID, censusID];
    }

    // coremeasurements doesn't have FileID, so we always get cumulative count
    // This is acceptable since processed rows are the "successful" count
    processedSQL = safeFormatQuery(
      schema,
      'SELECT COUNT(*) as count FROM ??.coremeasurements cm JOIN ??.census c ON cm.CensusID = c.CensusID WHERE c.PlotID = ? AND cm.CensusID = ? AND cm.StemGUID IS NOT NULL'
    );
  } catch (error: any) {
    ailogger.error(`Invalid schema in verifyprocessing: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    // Check how many rows remain in temporary measurements (should be 0 or very few after processing)
    const tempResult = await connectionManager.executeQuery(tempSQL, tempParams);

    // Check how many rows were processed into the main measurements table
    const processedResult = await connectionManager.executeQuery(processedSQL, [plotID, censusID]);

    // Check how many rows currently have unresolved ingestion errors.
    const failedResult = await connectionManager.executeQuery(failedSQL, [...failedParams, INGESTION_ERROR_SOURCE]);

    const remainingCount = tempResult[0]?.count || 0;
    const processedCount = processedResult[0]?.count || 0;
    const failedCount = failedResult[0]?.count || 0;

    // Total accounted for = processed + failed (remaining in temp should be 0)
    const totalAccounted = processedCount + failedCount;
    const filteringByFile = !!fileId;

    ailogger.info(
      `Processing verification for Plot ${plotID}, Census ${censusID}${fileId ? ` (FileID: ${fileId})` : ''}: ` +
        `${processedCount} total rows in coremeasurements, ${failedCount} unresolved ingestion-error rows${filteringByFile ? ' (filtered)' : ''}, ` +
        `${remainingCount} remaining in temporarymeasurements${filteringByFile ? ' (filtered)' : ''}. ` +
        `Total: ${totalAccounted}`
    );

    return new NextResponse(
      JSON.stringify({
        processedCount,
        failedCount,
        remainingCount,
        totalAccounted,
        plotID,
        censusID,
        schema,
        fileId: fileId || null,
        filteredByUpload: filteringByFile,
        processingComplete: remainingCount === 0
      }),
      { status: HTTPResponses.OK }
    );
  } catch (error: any) {
    ailogger.error('Error verifying processing:', error);
    return new NextResponse(
      JSON.stringify({
        error: 'Failed to verify processing',
        details: error.message,
        processedCount: 0,
        failedCount: 0,
        remainingCount: -1,
        totalAccounted: 0,
        processingComplete: false
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  } finally {
    await connectionManager.closeConnection();
  }
}
