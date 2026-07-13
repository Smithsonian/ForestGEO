import { HTTPResponses } from '@/config/macros';
import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';
import moment from 'moment';
import { isValidSchema, safeFormatQuery } from '@/lib/db/sqlsecurity';
import { refreshMeasurementsSummaryForScope, refreshViewFullTableForScope } from '@/lib/measurementviewrefresh';
import { updatePostValidationLastRun } from '@/lib/postvalidationlastrun';
import { fromPath, withRouteAuthz, type RouteContext } from '@/lib/route-authz';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Valid view names for refresh operations
const VALID_VIEWS = ['viewfulltable', 'measurementssummary'] as const;
type ValidView = (typeof VALID_VIEWS)[number];

function isValidView(view: string): view is ValidView {
  return VALID_VIEWS.includes(view as ValidView);
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Execute all enabled post-validation queries for a given plot and census
 * Updates each query's lastRunAt, lastRunResult, and lastRunStatus
 */
async function _executePostValidationQueries(
  connectionManager: typeof ConnectionManager.prototype,
  schema: string,
  plotID: number,
  censusID: number
): Promise<{ executed: number; success: number; failed: number }> {
  const stats = { executed: 0, success: 0, failed: 0 };

  // Validate schema before any SQL operations
  if (!isValidSchema(schema)) {
    ailogger.error(`Invalid schema in _executePostValidationQueries: ${schema}`);
    return stats;
  }

  try {
    // Fetch all enabled post-validation queries using safe formatting
    const query = safeFormatQuery(schema, 'SELECT QueryID, QueryDefinition FROM ??.postvalidationqueries WHERE IsEnabled IS TRUE');
    const queriesResult = await connectionManager.executeQuery(query);

    if (!queriesResult || queriesResult.length === 0) {
      return stats;
    }

    const replacements: Record<string, string | number> = {
      schema: schema,
      currentPlotID: plotID,
      currentCensusID: censusID
    };

    // Execute each query and update its status
    for (const queryRow of queriesResult) {
      stats.executed++;
      const queryID = queryRow.QueryID;
      const currentTime = moment().format('YYYY-MM-DD HH:mm:ss');

      try {
        // Replace placeholders in query definition with undefined check
        const formattedQuery = queryRow.QueryDefinition.replace(/\${(.*?)}/g, (_match: string, p1: string) => {
          const value = replacements[p1];
          if (value === undefined) {
            throw new Error(`Unknown template variable: ${p1}`);
          }
          return String(value);
        });

        // Execute the validation query
        const queryResults = await connectionManager.executeQuery(formattedQuery);

        if (queryResults && queryResults.length > 0) {
          // Query succeeded with results
          const successResults = JSON.stringify(queryResults);
          await updatePostValidationLastRun(connectionManager, schema, {
            queryID,
            plotID,
            censusID,
            ranAt: currentTime,
            status: 'success',
            result: successResults
          });
          stats.success++;
        } else {
          // Query succeeded but returned no results (treated as failure/no issues found)
          await updatePostValidationLastRun(connectionManager, schema, {
            queryID,
            plotID,
            censusID,
            ranAt: currentTime,
            status: 'failure',
            result: null
          });
          stats.failed++;
        }
      } catch (queryError) {
        // Query execution failed
        ailogger.error(`Post-validation query ${queryID} failed:`, queryError instanceof Error ? queryError : undefined);
        await updatePostValidationLastRun(connectionManager, schema, {
          queryID,
          plotID,
          censusID,
          ranAt: currentTime,
          status: 'failure'
        });
        stats.failed++;
      }
    }
  } catch (error) {
    ailogger.error('Error executing post-validation queries:', error instanceof Error ? error : undefined);
  }

  return stats;
}

async function handler(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  if (!params.schema || params.schema === 'undefined' || !params.view || params.view === 'undefined') {
    return new NextResponse(JSON.stringify({ error: 'Missing schema or view parameter' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const view = params.view as string;
  const schema = params.schema as string;

  // defense-in-depth: withRouteAuthz validates schema before this handler runs
  if (!isValidSchema(schema)) {
    ailogger.warn(`Invalid schema attempted in refreshviews: ${schema}`);
    return new NextResponse(JSON.stringify({ error: 'Invalid schema' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // Validate view name against whitelist
  if (!isValidView(view)) {
    ailogger.warn(`Invalid view attempted: ${view}`);
    return new NextResponse(JSON.stringify({ error: 'Invalid view name' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // Parse optional plotID and censusID from request body for post-validation execution
  let _plotID: number | undefined;
  let _censusID: number | undefined;
  let _runPostValidation = false;

  try {
    const body = await request.json().catch(() => ({}));
    const hasPlotID = body.plotID !== undefined;
    const hasCensusID = body.censusID !== undefined;
    _plotID = parsePositiveInteger(body.plotID);
    _censusID = parsePositiveInteger(body.censusID);
    _runPostValidation = body.runPostValidation === true;

    if (hasPlotID !== hasCensusID || ((hasPlotID || hasCensusID || _runPostValidation) && (_plotID === undefined || _censusID === undefined))) {
      return new NextResponse(JSON.stringify({ error: 'plotID and censusID must be strict positive integers' }), { status: HTTPResponses.INVALID_REQUEST });
    }
  } catch {
    // No body provided, that's fine
  }

  const MAX_LOCK_RETRIES = 3;
  const LOCK_RETRY_DELAY_MS = 2000;

  for (let attempt = 1; attempt <= MAX_LOCK_RETRIES; attempt++) {
    const connectionManager = ConnectionManager.getInstance();
    let transactionID: string | undefined = undefined;

    try {
      transactionID = await connectionManager.beginTransaction();

      // Execute the view refresh procedure - view is validated above against whitelist
      if (_plotID != null && _censusID != null) {
        if (view === 'measurementssummary') {
          await refreshMeasurementsSummaryForScope(connectionManager, schema, _plotID, _censusID, transactionID);
        } else {
          await refreshViewFullTableForScope(connectionManager, schema, _plotID, _censusID, transactionID);
        }
      } else {
        const procedureName = view === 'viewfulltable' ? 'RefreshViewFullTable' : 'RefreshMeasurementsSummary';
        const query = safeFormatQuery(schema, `CALL ??.${procedureName}()`);
        await connectionManager.executeQuery(query, undefined, transactionID);
      }

      await connectionManager.commitTransaction(transactionID ?? '');
      transactionID = undefined;

      const postValidationStats =
        _runPostValidation && _plotID != null && _censusID != null ? await _executePostValidationQueries(connectionManager, schema, _plotID, _censusID) : null;

      return new NextResponse(
        JSON.stringify({
          success: true,
          postValidation: postValidationStats
        }),
        { status: HTTPResponses.OK }
      );
    } catch (e) {
      if (transactionID) {
        await connectionManager.rollbackTransaction(transactionID);
      }

      const isLockTimeout = e instanceof Error && e.message.includes('Lock wait timeout exceeded');
      if (isLockTimeout && attempt < MAX_LOCK_RETRIES) {
        ailogger.warn(`Lock timeout on ${view} refresh (attempt ${attempt}/${MAX_LOCK_RETRIES}), retrying in ${LOCK_RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
        continue;
      }

      ailogger.error('Error:', e instanceof Error ? e : undefined);
      throw new Error('Call failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      try {
        await connectionManager.closeConnection();
      } catch (closeErr) {
        ailogger.warn('Failed to close connection during retry cleanup:', closeErr instanceof Error ? closeErr : undefined);
      }
    }
  }

  // Should not be reached, but TypeScript needs a return
  throw new Error('Unexpected: retry loop exhausted without returning or throwing');
}

export const POST = withRouteAuthz('refreshviews/[view]/[schema]', handler, { schema: fromPath('schema') });
