import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';

// Valid table types that can be cleared
const VALID_TABLE_TYPES = {
  failedmeasurements: 'failedmeasurements',
  temporarymeasurements: 'temporarymeasurements'
} as const;

type TableType = keyof typeof VALID_TABLE_TYPES;

export async function DELETE(
  _request: NextRequest,
  props: {
    params: Promise<{ tableType: string; schema: string; plotID: string; censusID: string }>;
  }
) {
  const { tableType, schema, plotID, censusID } = await props.params;

  if (!tableType || !schema || !plotID || !censusID) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters: tableType, schema, plotID, censusID' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  // Validate table type
  if (!VALID_TABLE_TYPES[tableType as TableType]) {
    return new NextResponse(
      JSON.stringify({
        error: 'Invalid table type',
        validTypes: Object.keys(VALID_TABLE_TYPES)
      }),
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  const tableName = VALID_TABLE_TYPES[tableType as TableType];
  const connectionManager = ConnectionManager.getInstance();
  let transactionID = '';

  try {
    transactionID = await connectionManager.beginTransaction();

    // First, get count of records that will be deleted for confirmation
    const countResult = await connectionManager.executeQuery(
      `SELECT COUNT(*) as total FROM ${schema}.${tableName} WHERE PlotID = ? AND CensusID = ?`,
      [plotID, censusID],
      transactionID
    );
    const totalRecords = countResult[0]?.total || 0;

    if (totalRecords === 0) {
      await connectionManager.commitTransaction(transactionID);
      return new NextResponse(
        JSON.stringify({
          message: `No ${tableType} found to clear`,
          recordsCleared: 0
        }),
        { status: HTTPResponses.OK }
      );
    }

    // Delete all records for this plot/census from the specified table
    await connectionManager.executeQuery(`DELETE FROM ${schema}.${tableName} WHERE PlotID = ? AND CensusID = ?`, [plotID, censusID], transactionID);

    await connectionManager.commitTransaction(transactionID);

    ailogger.info(`Cleared ${totalRecords} ${tableType} for schema: ${schema}, plotID: ${plotID}, censusID: ${censusID}`);

    return new NextResponse(
      JSON.stringify({
        message: `Successfully cleared ${totalRecords} ${tableType} records`,
        recordsCleared: totalRecords
      }),
      { status: HTTPResponses.OK }
    );
  } catch (error: any) {
    if (transactionID) {
      await connectionManager.rollbackTransaction(transactionID);
    }

    ailogger.error(`Error clearing ${tableType} for ${schema}/${plotID}/${censusID}:`, error);
    return new NextResponse(
      JSON.stringify({
        error: `Failed to clear ${tableType}`,
        details: error.message
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  }
}

export async function GET(
  _request: NextRequest,
  props: {
    params: Promise<{ tableType: string; schema: string; plotID: string; censusID: string }>;
  }
) {
  const { tableType, schema, plotID, censusID } = await props.params;

  if (!tableType || !schema || !plotID || !censusID) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // Validate table type
  if (!VALID_TABLE_TYPES[tableType as TableType]) {
    return new NextResponse(
      JSON.stringify({
        error: 'Invalid table type',
        validTypes: Object.keys(VALID_TABLE_TYPES)
      }),
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  const tableName = VALID_TABLE_TYPES[tableType as TableType];
  const connectionManager = ConnectionManager.getInstance();

  try {
    // Get count of records for this plot/census from the specified table
    const countResult = await connectionManager.executeQuery(`SELECT COUNT(*) as total FROM ${schema}.${tableName} WHERE PlotID = ? AND CensusID = ?`, [
      plotID,
      censusID
    ]);

    return new NextResponse(
      JSON.stringify({
        recordCount: countResult[0]?.total || 0
      }),
      { status: HTTPResponses.OK }
    );
  } catch (error: any) {
    ailogger.error(`Error getting ${tableType} count for ${schema}/${plotID}/${censusID}:`, error);
    return new NextResponse(
      JSON.stringify({
        error: 'Failed to get record count',
        details: error.message
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  }
}
