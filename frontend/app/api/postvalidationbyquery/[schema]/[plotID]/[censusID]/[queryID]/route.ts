import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import moment from 'moment';
import ConnectionManager from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';
import { isValidSchema, safeFormatQuery } from '@/lib/db/sqlsecurity';
import { updatePostValidationLastRun } from '@/lib/postvalidationlastrun';
import { fromPath, withRouteAuthz, type RouteContext } from '@/lib/route-authz';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

function parsePositiveIntegerParam(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function handler(_request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const schema = params.schema as string;
  const plotID = parsePositiveIntegerParam(params.plotID as string | undefined);
  const censusID = parsePositiveIntegerParam(params.censusID as string | undefined);
  const queryID = parsePositiveIntegerParam(params.queryID as string | undefined);
  let transactionID: string | undefined = undefined;

  // Validate all parameters
  if (!schema || !plotID || !censusID || !queryID) {
    return new NextResponse(JSON.stringify({ error: 'Missing or invalid parameters' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // defense-in-depth: withRouteAuthz validates the schema before this handler
  // runs, but the stored QueryDefinition below is interpolated raw (not through
  // safeFormatQuery), so keep this local guard as a hard guarantee.
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
    await updatePostValidationLastRun(connectionManager, schema, {
      queryID,
      plotID,
      censusID,
      ranAt: currentTime,
      status: 'success',
      result: successResults
    });
    await connectionManager.commitTransaction(transactionID ?? '');
    return new NextResponse(null, { status: HTTPResponses.OK });
  } catch (e: any) {
    await connectionManager.rollbackTransaction(transactionID ?? '');
    if (e.message === 'failure') {
      const currentTime = moment().format('YYYY-MM-DD HH:mm:ss');
      await updatePostValidationLastRun(connectionManager, schema, {
        queryID,
        plotID,
        censusID,
        ranAt: currentTime,
        status: 'failure'
      });
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

export const GET = withRouteAuthz('postvalidationbyquery/[schema]/[plotID]/[censusID]/[queryID]', handler, { schema: fromPath('schema') });
