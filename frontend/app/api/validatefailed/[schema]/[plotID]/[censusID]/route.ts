import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { validateSchemaOrThrow } from '@/config/utils/sqlsecurity';
import ailogger from '@/ailogger';
import { buildFailedMeasurementsSelectQuery, refreshIngestionErrorsForMeasurement } from '@/config/measurementerrors';

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
  let transactionID = '';

  try {
    const fetchSQL = `
      SELECT *
      FROM (${buildFailedMeasurementsSelectQuery(schema)}) fm
      WHERE fm.PlotID = ? AND fm.CensusID = ?
      ORDER BY fm.FailedMeasurementID ASC
    `;
    const rows = await connectionManager.executeQuery(fetchSQL, [plotID, censusID]);

    if (rows.length === 0) {
      return NextResponse.json(
        {
          totalRows: 0,
          readyCount: 0,
          failingCount: 0,
          autoReingestedCount: 0,
          validatedAt: new Date().toISOString(),
          details: []
        },
        { status: HTTPResponses.OK }
      );
    }

    transactionID = await connectionManager.beginTransaction();

    const details = [];
    for (const row of rows) {
      const validationErrors = await refreshIngestionErrorsForMeasurement(
        connectionManager,
        schema,
        row.FailedMeasurementID,
        censusID,
        {
          Tag: row.Tag,
          StemTag: row.StemTag,
          SpCode: row.SpCode,
          Quadrat: row.Quadrat,
          X: row.X,
          Y: row.Y,
          DBH: row.DBH,
          HOM: row.HOM,
          Date: row.Date,
          Codes: row.Codes,
          Comments: row.Comments
        },
        transactionID
      );

      details.push({
        failedMeasurementID: row.FailedMeasurementID,
        tag: row.Tag,
        stemTag: row.StemTag,
        currentFailureReasons: validationErrors.map((error: any) => error.errorMessage).join('; ') || null,
        originalFailureReasons: row.OriginalFailureReasons,
        isReady: validationErrors.length === 0
      });
    }

    await connectionManager.commitTransaction(transactionID);
    transactionID = '';

    const readyCount = details.filter(row => row.isReady).length;
    const failingCount = details.length - readyCount;

    return NextResponse.json(
      {
        totalRows: details.length,
        readyCount,
        failingCount,
        autoReingestedCount: 0,
        validatedAt: new Date().toISOString(),
        details
      },
      { status: HTTPResponses.OK }
    );
  } catch (error: any) {
    if (transactionID) {
      await connectionManager.rollbackTransaction(transactionID);
    }
    ailogger.error('Failed to validate failed measurements:', error);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
