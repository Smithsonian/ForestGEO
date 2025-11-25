import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

/**
 * Session-Based Upload Verification Endpoint
 *
 * Verifies data for a specific upload session (FileID and optional BatchID)
 * Returns precise per-upload counts to verify: input_rows = coremeasurements + failedmeasurements
 *
 * Query Parameters:
 * - schema (required): Database schema
 * - plotID (required): Plot identifier
 * - censusID (required): Census identifier
 * - fileID (optional): Specific file to verify (if omitted, verifies all files for plot/census)
 * - batchID (optional): Specific batch to verify (requires fileID)
 *
 * Returns:
 * {
 *   processedCount: number,      // Rows in coremeasurements
 *   failedCount: number,          // Rows in failedmeasurements
 *   totalAccounted: number,       // processedCount + failedCount
 *   fileID: string | null,
 *   batchID: string | null,
 *   scope: 'file' | 'batch' | 'all'
 * }
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const schema = searchParams.get('schema');
  const plotID = searchParams.get('plotID');
  const censusID = searchParams.get('censusID');
  const fileID = searchParams.get('fileID'); // Optional: specific file
  const batchID = searchParams.get('batchID'); // Optional: specific batch (requires fileID)

  if (!schema || !plotID || !censusID) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters: schema, plotID, censusID' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  if (batchID && !fileID) {
    return new NextResponse(JSON.stringify({ error: 'batchID requires fileID parameter' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // Determine query scope
  const scope = batchID ? 'batch' : fileID ? 'file' : 'all';

  // Build queries based on scope
  let processedSQL: string, failedSQL: string;
  let processedParams: any[], failedParams: any[];

  try {
    if (scope === 'batch') {
      // Query specific batch using JSON_EXTRACT on coremeasurements.UserDefinedFields
      processedSQL = safeFormatQuery(
        schema,
        `SELECT COUNT(*) as count FROM ??.coremeasurements cm
         JOIN ??.census c ON cm.CensusID = c.CensusID
         WHERE c.PlotID = ?
         AND cm.CensusID = ?
         AND JSON_EXTRACT(cm.UserDefinedFields, '$.uploadSession.fileID') = ?
         AND JSON_EXTRACT(cm.UserDefinedFields, '$.uploadSession.batchID') = ?`
      );
      processedParams = [plotID, censusID, fileID, batchID];

      failedSQL = safeFormatQuery(
        schema,
        'SELECT COUNT(*) as count FROM ??.failedmeasurements WHERE PlotID = ? AND CensusID = ? AND FileID = ? AND BatchID = ?'
      );
      failedParams = [plotID, censusID, fileID, batchID];
    } else if (scope === 'file') {
      // Query all batches for a specific file
      processedSQL = safeFormatQuery(
        schema,
        `SELECT COUNT(*) as count FROM ??.coremeasurements cm
         JOIN ??.census c ON cm.CensusID = c.CensusID
         WHERE c.PlotID = ?
         AND cm.CensusID = ?
         AND JSON_EXTRACT(cm.UserDefinedFields, '$.uploadSession.fileID') = ?`
      );
      processedParams = [plotID, censusID, fileID];

      failedSQL = safeFormatQuery(schema, 'SELECT COUNT(*) as count FROM ??.failedmeasurements WHERE PlotID = ? AND CensusID = ? AND FileID = ?');
      failedParams = [plotID, censusID, fileID];
    } else {
      // Query all files for this plot/census (cumulative total)
      processedSQL = safeFormatQuery(
        schema,
        'SELECT COUNT(*) as count FROM ??.coremeasurements cm JOIN ??.census c ON cm.CensusID = c.CensusID WHERE c.PlotID = ? AND cm.CensusID = ?'
      );
      processedParams = [plotID, censusID];

      failedSQL = safeFormatQuery(schema, 'SELECT COUNT(*) as count FROM ??.failedmeasurements WHERE PlotID = ? AND CensusID = ?');
      failedParams = [plotID, censusID];
    }
  } catch (error: any) {
    ailogger.error(`Invalid schema in verifysession: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    // Execute queries
    const processedResult = await connectionManager.executeQuery(processedSQL, processedParams);
    const failedResult = await connectionManager.executeQuery(failedSQL, failedParams);

    const processedCount = processedResult[0]?.count || 0;
    const failedCount = failedResult[0]?.count || 0;
    const totalAccounted = processedCount + failedCount;

    ailogger.info(
      `Session verification [${scope}] for Plot ${plotID}, Census ${censusID}${fileID ? `, FileID ${fileID}` : ''}${batchID ? `, BatchID ${batchID}` : ''}: ${processedCount} in coremeasurements, ${failedCount} in failedmeasurements. Total: ${totalAccounted}`
    );

    return new NextResponse(
      JSON.stringify({
        processedCount,
        failedCount,
        totalAccounted,
        plotID,
        censusID,
        fileID: fileID || null,
        batchID: batchID || null,
        scope
      }),
      { status: HTTPResponses.OK }
    );
  } catch (error: any) {
    ailogger.error('Error verifying upload session:', error);
    return new NextResponse(
      JSON.stringify({
        error: 'Failed to verify upload session',
        details: error.message,
        processedCount: 0,
        failedCount: 0,
        totalAccounted: 0
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  }
}
