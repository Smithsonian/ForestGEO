import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import moment from 'moment';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import { isValidSchema, safeFormatQuery } from '@/config/utils/sqlsecurity';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, props: { params: Promise<{ schema: string; plotID: string; censusID: string; queryID: string }> }) {
  const params = await props.params;
  const { schema } = params;
  const plotID = parseInt(params.plotID, 10);
  const censusID = parseInt(params.censusID, 10);
  const queryID = parseInt(params.queryID, 10);
  let transactionID: string | undefined = undefined;

  // Validate all parameters
  if (!schema || isNaN(plotID) || isNaN(censusID) || isNaN(queryID)) {
    return new NextResponse(JSON.stringify({ error: 'Missing or invalid parameters' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // SQL Injection Prevention: Validate schema against whitelist
  if (!isValidSchema(schema)) {
    ailogger.warn(`Invalid schema attempted: ${schema}`);
    return new NextResponse(JSON.stringify({ error: 'Invalid schema' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();
  try {
    // Use parameterized query with safe schema formatting
    const query = safeFormatQuery(schema, 'SELECT QueryDefinition FROM ??.postvalidationqueries WHERE QueryID = ?');
    const results = await connectionManager.executeQuery(query, [queryID]);

    if (results.length === 0) {
      return new NextResponse(JSON.stringify({ error: 'Query not found' }), { status: HTTPResponses.NOT_FOUND });
    }

    const replacements: Record<string, string | number> = {
      schema: schema,
      currentPlotID: plotID,
      currentCensusID: censusID
    };

    // Safe template replacement with undefined check
    const formattedQuery = results[0].QueryDefinition.replace(/\${(.*?)}/g, (_match: string, p1: string) => {
      const value = replacements[p1];
      if (value === undefined) {
        throw new Error(`Unknown template variable: ${p1}`);
      }
      return String(value);
    });

    transactionID = await connectionManager.beginTransaction();
    const queryResults = await connectionManager.executeQuery(formattedQuery);

    if (queryResults.length === 0) throw new Error('failure');

    const currentTime = moment().format('YYYY-MM-DD HH:mm:ss');
    const successResults = JSON.stringify(queryResults);
    // Use parameterized query for UPDATE
    const successUpdate = safeFormatQuery(schema, 'UPDATE ??.postvalidationqueries SET LastRunAt = ?, LastRunResult = ?, LastRunStatus = ? WHERE QueryID = ?');
    await connectionManager.executeQuery(successUpdate, [currentTime, successResults, 'success', queryID]);
    await connectionManager.commitTransaction(transactionID ?? '');
    return new NextResponse(null, { status: HTTPResponses.OK });
  } catch (e: any) {
    await connectionManager.rollbackTransaction(transactionID ?? '');
    if (e.message === 'failure') {
      const currentTime = moment().format('YYYY-MM-DD HH:mm:ss');
      // Use parameterized query for UPDATE
      const failureUpdate = safeFormatQuery(schema, 'UPDATE ??.postvalidationqueries SET LastRunAt = ?, LastRunStatus = ? WHERE QueryID = ?');
      await connectionManager.executeQuery(failureUpdate, [currentTime, 'failure', queryID]);
      return new NextResponse(null, { status: HTTPResponses.OK }); // if the query itself fails, that isn't a good enough reason to return a crash. It should just be logged.
    }
    ailogger.error('Error in postvalidation query:', e.message, {
      endpoint: _request.nextUrl?.pathname || 'postvalidationbyquery',
      schema,
      plotID,
      censusID,
      queryID
    });
    return new NextResponse(JSON.stringify({ error: 'Failed to execute validation query' }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  } finally {
    await connectionManager.closeConnection();
  }
}
