import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { INGESTION_ERROR_SOURCE } from '@/config/measurementerrors';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

/**
 * Session-Based Upload Verification Endpoint
 *
 * Verifies data for a specific upload session (FileID and optional BatchID)
 * Returns precise per-upload counts to verify: input_rows = coremeasurements + unresolved ingestion errors
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
 *   failedCount: number,          // Rows with unresolved ingestion errors
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
      // Query specific batch using indexed UploadFileID/UploadBatchID (fallback to JSON for legacy rows)
      processedSQL = safeFormatQuery(
        schema,
        `SELECT COUNT(*) as count FROM ??.coremeasurements cm
         JOIN ??.census c ON cm.CensusID = c.CensusID
         WHERE c.PlotID = ?
         AND cm.CensusID = ?
         AND cm.StemGUID IS NOT NULL
         AND (cm.UploadFileID = ? OR (cm.UploadFileID IS NULL AND JSON_EXTRACT(cm.UserDefinedFields, '$.uploadSession.fileID') = ?))
         AND (cm.UploadBatchID = ? OR (cm.UploadBatchID IS NULL AND JSON_EXTRACT(cm.UserDefinedFields, '$.uploadSession.batchID') = ?))`
      );
      processedParams = [plotID, censusID, fileID, fileID, batchID, batchID];

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
           AND cm.UploadBatchID = ?
           AND cm.StemGUID IS NULL
           AND mel.IsResolved = FALSE
           AND me.ErrorSource = ?`
      );
      failedParams = [plotID, censusID, fileID, batchID, INGESTION_ERROR_SOURCE];
    } else if (scope === 'file') {
      // Query all batches for a specific file (prefer UploadFileID, fallback to JSON)
      processedSQL = safeFormatQuery(
        schema,
        `SELECT COUNT(*) as count FROM ??.coremeasurements cm
         JOIN ??.census c ON cm.CensusID = c.CensusID
         WHERE c.PlotID = ?
         AND cm.CensusID = ?
         AND cm.StemGUID IS NOT NULL
         AND (cm.UploadFileID = ? OR (cm.UploadFileID IS NULL AND JSON_EXTRACT(cm.UserDefinedFields, '$.uploadSession.fileID') = ?))`
      );
      processedParams = [plotID, censusID, fileID, fileID];

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
      failedParams = [plotID, censusID, fileID, INGESTION_ERROR_SOURCE];
    } else {
      // Query all files for this plot/census (cumulative total)
      processedSQL = safeFormatQuery(
        schema,
        'SELECT COUNT(*) as count FROM ??.coremeasurements cm JOIN ??.census c ON cm.CensusID = c.CensusID WHERE c.PlotID = ? AND cm.CensusID = ? AND cm.StemGUID IS NOT NULL'
      );
      processedParams = [plotID, censusID];

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
      failedParams = [plotID, censusID, INGESTION_ERROR_SOURCE];
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
      `Session verification [${scope}] for Plot ${plotID}, Census ${censusID}${fileID ? `, FileID ${fileID}` : ''}${batchID ? `, BatchID ${batchID}` : ''}: ${processedCount} in coremeasurements, ${failedCount} unresolved ingestion-error rows. Total: ${totalAccounted}`
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
  } finally {
    await connectionManager.closeConnection();
  }
}
