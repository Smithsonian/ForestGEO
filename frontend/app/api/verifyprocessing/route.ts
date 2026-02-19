import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { getSchemaCapabilities } from '@/config/utils/schemacapabilities';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const schema = searchParams.get('schema');
  const plotID = searchParams.get('plotID');
  const censusID = searchParams.get('censusID');
  const fileId = searchParams.get('fileId');

  if (!schema || !plotID || !censusID) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters: schema, plotID, censusID' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  let tempSQL: string, processedSQL: string, failedMeasurementsSQL: string;
  let tempParams: (string | number)[];
  let failedParams: (string | number)[];

  try {
    if (fileId) {
      tempSQL = safeFormatQuery(schema, 'SELECT COUNT(*) as count FROM ??.temporarymeasurements WHERE PlotID = ? AND CensusID = ? AND FileID = ?');
      tempParams = [plotID, censusID, fileId];
      failedMeasurementsSQL = safeFormatQuery(schema, 'SELECT COUNT(*) as count FROM ??.failedmeasurements WHERE PlotID = ? AND CensusID = ? AND FileID = ?');
      failedParams = [plotID, censusID, fileId];
    } else {
      tempSQL = safeFormatQuery(schema, 'SELECT COUNT(*) as count FROM ??.temporarymeasurements WHERE PlotID = ? AND CensusID = ?');
      tempParams = [plotID, censusID];
      failedMeasurementsSQL = safeFormatQuery(schema, 'SELECT COUNT(*) as count FROM ??.failedmeasurements WHERE PlotID = ? AND CensusID = ?');
      failedParams = [plotID, censusID];
    }

    processedSQL = safeFormatQuery(
      schema,
      'SELECT COUNT(*) as count FROM ??.coremeasurements cm JOIN ??.census c ON cm.CensusID = c.CensusID WHERE c.PlotID = ? AND cm.CensusID = ?'
    );
  } catch (error: any) {
    ailogger.error(`Invalid schema in verifyprocessing: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();
  const { hasUploadErrors } = await getSchemaCapabilities(schema);

  try {
    const tempResult = await connectionManager.executeQuery(tempSQL, tempParams);
    const processedResult = await connectionManager.executeQuery(processedSQL, [plotID, censusID]);
    const failedMeasurementsResult = await connectionManager.executeQuery(failedMeasurementsSQL, failedParams);

    let uploadErrorsCount = 0;
    if (hasUploadErrors) {
      const uploadErrorsSQL = fileId
        ? safeFormatQuery(schema, 'SELECT COUNT(*) as count FROM ??.upload_errors WHERE PlotID = ? AND CensusID = ? AND FileID = ?')
        : safeFormatQuery(schema, 'SELECT COUNT(*) as count FROM ??.upload_errors WHERE PlotID = ? AND CensusID = ?');
      const uploadErrorParams = fileId ? [plotID, censusID, fileId] : [plotID, censusID];
      const uploadErrorsResult = await connectionManager.executeQuery(uploadErrorsSQL, uploadErrorParams);
      uploadErrorsCount = uploadErrorsResult[0]?.count || 0;
    }

    const remainingCount = tempResult[0]?.count || 0;
    const processedCount = processedResult[0]?.count || 0;
    const failedMeasurementsCount = failedMeasurementsResult[0]?.count || 0;
    const failedCount = failedMeasurementsCount + uploadErrorsCount;
    const totalAccounted = processedCount + failedCount;
    const filteringByFile = !!fileId;

    ailogger.info(
      `Processing verification for Plot ${plotID}, Census ${censusID}${fileId ? ` (FileID: ${fileId})` : ''}: ` +
        `${processedCount} total rows in coremeasurements, ${failedCount} rows in failure tables (${failedMeasurementsCount} failedmeasurements + ${uploadErrorsCount} upload_errors)${filteringByFile ? ' (filtered)' : ''}, ` +
        `${remainingCount} remaining in temporarymeasurements${filteringByFile ? ' (filtered)' : ''}. ` +
        `Total: ${totalAccounted}`
    );

    return new NextResponse(
      JSON.stringify({
        processedCount,
        failedCount,
        failedMeasurementsCount,
        uploadErrorsCount,
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
  }
}
