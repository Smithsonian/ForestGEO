import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { validateContextualValues } from '@/lib/contextvalidation';
import ailogger from '@/ailogger';
import { format } from 'mysql2/promise';
import { validateSchemaOrThrow } from '@/config/utils/sqlsecurity';
import { auth } from '@/auth';
import { INGESTION_ERROR_SOURCE } from '@/config/measurementerrors';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Valid table types that can be cleared.
// Note: 'failedmeasurements' is a logical routing key — the handler uses custom SQL
// against coremeasurements + measurement_error_log, NOT a physical table.
const VALID_TABLE_TYPES = {
  failedmeasurements: 'failedmeasurements',
  temporarymeasurements: 'temporarymeasurements'
} as const;

type TableType = keyof typeof VALID_TABLE_TYPES;

export async function DELETE(
  request: NextRequest,
  props: {
    params: Promise<{ tableType: string; schema: string; plotID: string; censusID: string }>;
  }
) {
  // Authentication check - admin operations require authenticated user
  const session = await auth();
  if (!session?.user) {
    ailogger.warn('Unauthorized admin clear DELETE attempt - no session');
    return new NextResponse(JSON.stringify({ error: 'Unauthorized - authentication required' }), { status: HTTPResponses.UNAUTHORIZED });
  }

  const { tableType, schema: schemaParam, plotID: plotIDParam, censusID: censusIDParam } = await props.params;

  if (!tableType) {
    return new NextResponse(JSON.stringify({ error: 'Table type parameter is required' }), {
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

  // Validate contextual values with fallback to URL params
  const validation = await validateContextualValues(request, {
    requireSchema: true,
    requirePlot: true,
    requireCensus: true,
    allowFallback: true,
    fallbackMessage: 'Admin clear operations require active site, plot, and census selections.'
  });

  let plotID: number, censusID: number, schema: string;

  if (!validation.success) {
    // Try to use URL parameters as fallback
    if (schemaParam && plotIDParam && censusIDParam) {
      plotID = parseInt(plotIDParam);
      censusID = parseInt(censusIDParam);
      schema = schemaParam;

      if (isNaN(plotID) || isNaN(censusID)) {
        return new NextResponse(JSON.stringify({ error: 'Invalid plotID or censusID parameters' }), {
          status: HTTPResponses.INVALID_REQUEST
        });
      }
    } else {
      return validation.response!;
    }
  } else {
    const values = validation.values!;
    schema = values.schema!;
    plotID = values.plotID!;
    censusID = values.censusID!;
  }

  // Validate schema to prevent SQL injection
  try {
    validateSchemaOrThrow(schema);
  } catch (error: any) {
    ailogger.error(`Invalid schema in admin/clear: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();
  let transactionID = '';

  try {
    transactionID = await connectionManager.beginTransaction();

    let countSQL = '';
    let countParams: any[] = [];
    let deleteSQL = '';
    let deleteParams: any[] = [];

    if (tableType === 'failedmeasurements') {
      // Schema is validated above via validateSchemaOrThrow — safe to interpolate as identifier
      countSQL = `SELECT COUNT(DISTINCT cm.CoreMeasurementID) as total
         FROM ${schema}.coremeasurements cm
         JOIN ${schema}.census c ON c.CensusID = cm.CensusID
         WHERE c.PlotID = ?
           AND cm.CensusID = ?
           AND cm.StemGUID IS NULL
           AND EXISTS (
             SELECT 1
             FROM ${schema}.measurement_error_log mel
             JOIN ${schema}.measurement_errors me ON me.ErrorID = mel.ErrorID
             WHERE mel.MeasurementID = cm.CoreMeasurementID
               AND me.ErrorSource = ?
           )`;
      countParams = [plotID, censusID, INGESTION_ERROR_SOURCE];

      deleteSQL = `DELETE cm
         FROM ${schema}.coremeasurements cm
         JOIN ${schema}.census c ON c.CensusID = cm.CensusID
         WHERE c.PlotID = ?
           AND cm.CensusID = ?
           AND cm.StemGUID IS NULL
           AND EXISTS (
             SELECT 1
             FROM ${schema}.measurement_error_log mel
             JOIN ${schema}.measurement_errors me ON me.ErrorID = mel.ErrorID
             WHERE mel.MeasurementID = cm.CoreMeasurementID
               AND me.ErrorSource = ?
           )`;
      deleteParams = [plotID, censusID, INGESTION_ERROR_SOURCE];
    } else {
      const tableName = VALID_TABLE_TYPES[tableType as TableType];
      countSQL = format('SELECT COUNT(*) as total FROM ??.?? WHERE PlotID = ? AND CensusID = ?', [schema, tableName]);
      deleteSQL = format('DELETE FROM ??.?? WHERE PlotID = ? AND CensusID = ?', [schema, tableName]);
      countParams = [plotID, censusID];
      deleteParams = [plotID, censusID];
    }

    // First, get count of records that will be deleted for confirmation
    const countResult = await connectionManager.executeQuery(countSQL, countParams, transactionID);
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
    await connectionManager.executeQuery(deleteSQL, deleteParams, transactionID);

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
  } finally {
    // Always close connection to prevent connection leaks
    try {
      await connectionManager.closeConnection();
    } catch (closeError: unknown) {
      const closeErr = closeError instanceof Error ? closeError : new Error(String(closeError));
      ailogger.error(`Error closing connection in admin/clear DELETE for ${tableType}:`, closeErr);
    }
  }
}

export async function GET(
  _request: NextRequest,
  props: {
    params: Promise<{ tableType: string; schema: string; plotID: string; censusID: string }>;
  }
) {
  // Authentication check - admin operations require authenticated user
  const session = await auth();
  if (!session?.user) {
    ailogger.warn('Unauthorized admin clear GET attempt - no session');
    return new NextResponse(JSON.stringify({ error: 'Unauthorized - authentication required' }), { status: HTTPResponses.UNAUTHORIZED });
  }

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

  // Validate schema to prevent SQL injection
  try {
    validateSchemaOrThrow(schema);
  } catch (error: any) {
    ailogger.error(`Invalid schema in admin/clear GET: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    let countSQL = '';
    let countParams: any[] = [];

    if (tableType === 'failedmeasurements') {
      // Schema is validated above via validateSchemaOrThrow — safe to interpolate as identifier
      countSQL = `SELECT COUNT(DISTINCT cm.CoreMeasurementID) as total
         FROM ${schema}.coremeasurements cm
         JOIN ${schema}.census c ON c.CensusID = cm.CensusID
         WHERE c.PlotID = ?
           AND cm.CensusID = ?
           AND cm.StemGUID IS NULL
           AND EXISTS (
             SELECT 1
             FROM ${schema}.measurement_error_log mel
             JOIN ${schema}.measurement_errors me ON me.ErrorID = mel.ErrorID
             WHERE mel.MeasurementID = cm.CoreMeasurementID
               AND me.ErrorSource = ?
           )`;
      countParams = [plotID, censusID, INGESTION_ERROR_SOURCE];
    } else {
      const tableName = VALID_TABLE_TYPES[tableType as TableType];
      countSQL = format('SELECT COUNT(*) as total FROM ??.?? WHERE PlotID = ? AND CensusID = ?', [schema, tableName]);
      countParams = [plotID, censusID];
    }

    // Get count of records for this plot/census from the specified table
    const countResult = await connectionManager.executeQuery(countSQL, countParams);

    return new NextResponse(
      JSON.stringify({
        recordCount: countResult[0]?.total || 0
      }),
      { status: HTTPResponses.OK }
    );
  } catch (error: unknown) {
    const errObj = error instanceof Error ? error : new Error(String(error));
    ailogger.error(`Error getting ${tableType} count for ${schema}/${plotID}/${censusID}:`, errObj);
    return new NextResponse(
      JSON.stringify({
        error: 'Failed to get record count',
        details: errObj.message
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  } finally {
    // Always close connection to prevent connection leaks
    try {
      await connectionManager.closeConnection();
    } catch (closeError: unknown) {
      const closeErr = closeError instanceof Error ? closeError : new Error(String(closeError));
      ailogger.error(`Error closing connection in admin/clear GET for ${tableType}:`, closeErr);
    }
  }
}
