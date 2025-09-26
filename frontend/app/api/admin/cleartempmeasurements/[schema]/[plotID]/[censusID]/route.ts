import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';

export async function DELETE(
  _request: NextRequest,
  props: {
    params: Promise<{ schema: string; plotID: string; censusID: string }>;
  }
) {
  const { schema, plotID, censusID } = await props.params;

  if (!schema || !plotID || !censusID) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters: schema, plotID, censusID' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();
  let transactionID = '';

  try {
    transactionID = await connectionManager.beginTransaction();

    // First, get count of records that will be deleted for confirmation
    const countResult = await connectionManager.executeQuery(
      `SELECT COUNT(*) as total FROM ${schema}.temporarymeasurements WHERE PlotID = ? AND CensusID = ?`,
      [plotID, censusID],
      transactionID
    );
    const totalRecords = countResult[0]?.total || 0;

    if (totalRecords === 0) {
      await connectionManager.commitTransaction(transactionID);
      return new NextResponse(
        JSON.stringify({
          message: 'No temporary measurements found to clear',
          recordsCleared: 0
        }),
        { status: HTTPResponses.OK }
      );
    }

    // Delete all temporary measurements for this plot/census
    await connectionManager.executeQuery(`DELETE FROM ${schema}.temporarymeasurements WHERE PlotID = ? AND CensusID = ?`, [plotID, censusID], transactionID);

    await connectionManager.commitTransaction(transactionID);

    ailogger.info(`Cleared ${totalRecords} temporary measurements for schema: ${schema}, plotID: ${plotID}, censusID: ${censusID}`);

    return new NextResponse(
      JSON.stringify({
        message: `Successfully cleared ${totalRecords} temporary measurement records`,
        recordsCleared: totalRecords
      }),
      { status: HTTPResponses.OK }
    );
  } catch (error: any) {
    if (transactionID) {
      await connectionManager.rollbackTransaction(transactionID);
    }

    ailogger.error(`Error clearing temporary measurements for ${schema}/${plotID}/${censusID}:`, error);
    return new NextResponse(
      JSON.stringify({
        error: 'Failed to clear temporary measurements',
        details: error.message
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  }
}

export async function GET(
  _request: NextRequest,
  props: {
    params: Promise<{ schema: string; plotID: string; censusID: string }>;
  }
) {
  const { schema, plotID, censusID } = await props.params;

  if (!schema || !plotID || !censusID) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    // Get count of temporary measurements for this plot/census
    const countResult = await connectionManager.executeQuery(
      `SELECT COUNT(*) as total FROM ${schema}.temporarymeasurements WHERE PlotID = ? AND CensusID = ?`,
      [plotID, censusID]
    );

    return new NextResponse(
      JSON.stringify({
        recordCount: countResult[0]?.total || 0
      }),
      { status: HTTPResponses.OK }
    );
  } catch (error: any) {
    ailogger.error(`Error getting temporary measurements count for ${schema}/${plotID}/${censusID}:`, error);
    return new NextResponse(
      JSON.stringify({
        error: 'Failed to get record count',
        details: error.message
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  }
}
