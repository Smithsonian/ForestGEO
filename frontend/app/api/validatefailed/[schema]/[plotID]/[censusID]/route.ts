import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { safeFormatQuery, validateSchemaOrThrow } from '@/config/utils/sqlsecurity';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  props: {
    params: Promise<{ schema: string; plotID: string; censusID: string }>;
  }
) {
  const { schema, plotID: plotIDParam, censusID: censusIDParam } = await props.params;

  try {
    validateSchemaOrThrow(schema);
  } catch (error: any) {
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const plotID = parseInt(plotIDParam);
  const censusID = parseInt(censusIDParam);

  if (isNaN(plotID) || isNaN(censusID)) {
    return new NextResponse(JSON.stringify({ error: 'Invalid plotID or censusID' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    const refreshSQL = safeFormatQuery(schema, 'CALL ??.refresh_failedmeasurements_current(?, ?)');
    await connectionManager.executeQuery(refreshSQL, [plotID, censusID]);

    const fetchSQL = safeFormatQuery(
      schema,
      `SELECT FailedMeasurementID, Tag, StemTag, FailureReasons, OriginalFailureReasons, CurrentFailureReasons
       FROM ??.failedmeasurements
       WHERE PlotID = ? AND CensusID = ?`
    );
    const rows = await connectionManager.executeQuery(fetchSQL, [plotID, censusID]);

    const details = rows.map((row: any) => {
      const currentReasons = row.CurrentFailureReasons;
      const isReady = currentReasons == null || currentReasons === '' || row.FailureReasons === 'Ready for reingestion';
      return {
        failedMeasurementID: row.FailedMeasurementID,
        tag: row.Tag,
        stemTag: row.StemTag,
        currentFailureReasons: row.CurrentFailureReasons,
        originalFailureReasons: row.OriginalFailureReasons,
        isReady
      };
    });

    const readyCount = details.filter((row: any) => row.isReady).length;
    const failingCount = details.length - readyCount;

    return NextResponse.json(
      {
        totalRows: details.length,
        readyCount,
        failingCount,
        validatedAt: new Date().toISOString(),
        details
      },
      { status: HTTPResponses.OK }
    );
  } catch (error: any) {
    ailogger.error('Failed to validate failed measurements:', error);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
