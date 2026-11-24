import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/lib/db/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { validateContextualValues } from '@/lib/contextvalidation';
import ailogger from '@/ailogger';
import { format } from 'mysql2/promise';
import { validateSchemaOrThrow } from '@/lib/db/sqlsecurity';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import { INGESTION_ERROR_SOURCE } from '@/config/measurementerrors';
import { authenticatedSessionIdentity } from '@/lib/changelog/identity';
import { COREMEASUREMENTS_JOIN_ALIAS, deleteCoreMeasurementsInBoundedChunksWithAudit } from '@/lib/ingestion/temporary-measurements';
import { retryWholeTransactionOnDeadlock } from '@/lib/db/deadlock-retry';

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

const ADMIN_CLEAR_TRANSACTION = 'admin_clear';

/** Staging rows are not data of record and are not audited. */
async function deleteStagingRows(
  connectionManager: ConnectionManager,
  schema: string,
  tableName: string,
  plotID: number,
  censusID: number,
  transactionID: string
): Promise<number> {
  const deleteSQL = format('DELETE FROM ??.?? WHERE PlotID = ? AND CensusID = ?', [schema, tableName]);
  const deleteResult = await connectionManager.executeQuery(deleteSQL, [plotID, censusID], transactionID);
  return Number(deleteResult?.affectedRows ?? 0);
}

const FAILED_MEASUREMENTS_SCOPE_FROM_SQL = '??.coremeasurements cm JOIN ??.census c ON c.CensusID = cm.CensusID';

function buildFailedMeasurementsScopeWhereClause(schema: string) {
  return `c.PlotID = ?
           AND c.PlotCensusNumber = (
             SELECT selected_census.PlotCensusNumber
             FROM ${schema}.census selected_census
             WHERE selected_census.CensusID = ?
               AND selected_census.PlotID = ?
             LIMIT 1
           )
           AND cm.StemGUID IS NULL
           AND EXISTS (
             SELECT 1
             FROM ${schema}.measurement_error_log mel
             JOIN ${schema}.measurement_errors me ON me.ErrorID = mel.ErrorID
             WHERE mel.MeasurementID = cm.CoreMeasurementID
               AND me.ErrorSource = ?
           )`;
}

function buildFailedMeasurementsScopeParams(plotID: number | string, censusID: number | string) {
  return [plotID, censusID, plotID, INGESTION_ERROR_SOURCE];
}

export async function DELETE(
  request: NextRequest,
  props: {
    params: Promise<{ tableType: string; schema: string; plotID: string; censusID: string }>;
  }
) {
  const session = await auth();
  const authError = requireAdmin(session);
  if (authError) return authError;

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
  const changedBy = authenticatedSessionIdentity(session?.user);

  // One complete transaction per attempt. The failed-row walk can lock ids out of order
  // against an overlapping cleanup, so a deadlock re-runs the whole attempt (issue #507).
  const clearOnce = async (): Promise<number> => {
    const transactionID = await connectionManager.beginTransaction();
    try {
      const clearedRecords =
        tableType === 'failedmeasurements'
          ? // Failed rows are measurements of record, so each one gets a Recent Changes DELETE row.
            await deleteCoreMeasurementsInBoundedChunksWithAudit(
              connectionManager,
              schema,
              buildFailedMeasurementsScopeWhereClause(schema),
              buildFailedMeasurementsScopeParams(plotID, censusID),
              changedBy,
              plotID,
              censusID,
              transactionID,
              FAILED_MEASUREMENTS_SCOPE_FROM_SQL,
              [COREMEASUREMENTS_JOIN_ALIAS]
            )
          : await deleteStagingRows(connectionManager, schema, VALID_TABLE_TYPES[tableType as TableType], plotID, censusID, transactionID);
      await connectionManager.commitTransaction(transactionID);
      return clearedRecords;
    } catch (attemptError: unknown) {
      await connectionManager.rollbackTransaction(transactionID);
      throw attemptError;
    }
  };

  try {
    const totalRecords = await retryWholeTransactionOnDeadlock(ADMIN_CLEAR_TRANSACTION, clearOnce);

    if (totalRecords === 0) {
      return new NextResponse(
        JSON.stringify({
          message: `No ${tableType} found to clear`,
          recordsCleared: 0
        }),
        { status: HTTPResponses.OK }
      );
    }

    ailogger.info(`Cleared ${totalRecords} ${tableType} for schema: ${schema}, plotID: ${plotID}, censusID: ${censusID}`);

    return new NextResponse(
      JSON.stringify({
        message: `Successfully cleared ${totalRecords} ${tableType} records`,
        recordsCleared: totalRecords
      }),
      { status: HTTPResponses.OK }
    );
  } catch (error: any) {
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
  const authError = requireAdmin(await auth());
  if (authError) return authError;

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
         WHERE ${buildFailedMeasurementsScopeWhereClause(schema)}`;
      countParams = buildFailedMeasurementsScopeParams(plotID, censusID);
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
