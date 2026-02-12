import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { safeFormatQuery, validateSchemaOrThrow } from '@/config/utils/sqlsecurity';
import { generateShortBatchID } from '@/config/utils';
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

    // Auto-reingest rows that passed validation (no actionable errors)
    const readyCountSQL = safeFormatQuery(
      schema,
      `SELECT COUNT(*) as cnt FROM ??.failedmeasurements
       WHERE PlotID = ? AND CensusID = ? AND FailureReasons = 'Ready for reingestion'`
    );
    const readyResult = await connectionManager.executeQuery(readyCountSQL, [plotID, censusID]);
    const readyCount = readyResult[0]?.cnt || 0;
    let autoReingestedCount = 0;

    if (readyCount > 0) {
      const autoFileID = 'auto-reingest.csv';
      const autoBatchID = generateShortBatchID();

      try {
        const moveReadySQL = safeFormatQuery(
          schema,
          `INSERT IGNORE INTO ??.temporarymeasurements
            (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName,
             LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
          SELECT ?, ?, PlotID, CensusID, Tag, StemTag, SpCode, Quadrat,
                 X, Y, DBH, HOM, Date, Codes, Comments
          FROM ??.failedmeasurements
          WHERE PlotID = ? AND CensusID = ? AND FailureReasons = 'Ready for reingestion'`
        );
        await connectionManager.executeQuery(moveReadySQL, [autoFileID, autoBatchID, plotID, censusID]);

        const processSQL = safeFormatQuery(schema, 'CALL ??.bulkingestionprocess(?, ?)');
        await connectionManager.executeQuery(processSQL, [autoFileID, autoBatchID]);

        const deleteReadySQL = safeFormatQuery(
          schema,
          `DELETE FROM ??.failedmeasurements
           WHERE PlotID = ? AND CensusID = ? AND FailureReasons = 'Ready for reingestion'`
        );
        await connectionManager.executeQuery(deleteReadySQL, [plotID, censusID]);

        autoReingestedCount = readyCount;
      } catch (txError: any) {
        ailogger.error('Auto-reingest failed, rows remain in failedmeasurements:', txError);
        autoReingestedCount = 0;
        try {
          const cleanupSQL = safeFormatQuery(schema, 'DELETE FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?');
          await connectionManager.executeQuery(cleanupSQL, [autoFileID, autoBatchID]);
        } catch (cleanupError: any) {
          ailogger.error('Failed to clean up temporary auto-reingest rows:', cleanupError);
        }
      }
    }

    // Fetch remaining rows - only those with real validation errors
    const fetchSQL = safeFormatQuery(
      schema,
      `SELECT FailedMeasurementID, Tag, StemTag, FailureReasons, OriginalFailureReasons, CurrentFailureReasons
       FROM ??.failedmeasurements
       WHERE PlotID = ? AND CensusID = ?`
    );
    const rows = await connectionManager.executeQuery(fetchSQL, [plotID, censusID]);

    const details = rows.map((row: any) => ({
      failedMeasurementID: row.FailedMeasurementID,
      tag: row.Tag,
      stemTag: row.StemTag,
      currentFailureReasons: row.CurrentFailureReasons,
      originalFailureReasons: row.OriginalFailureReasons,
      isReady: false // all remaining rows have real errors
    }));

    return NextResponse.json(
      {
        totalRows: details.length,
        readyCount: 0,
        failingCount: details.length,
        autoReingestedCount,
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
