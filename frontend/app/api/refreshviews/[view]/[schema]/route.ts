import { HTTPResponses } from '@/config/macros';
import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import moment from 'moment';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

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

  try {
    // Fetch all enabled post-validation queries
    const queriesResult = await connectionManager.executeQuery(`SELECT QueryID, QueryDefinition FROM ${schema}.postvalidationqueries WHERE IsEnabled IS TRUE`);

    if (!queriesResult || queriesResult.length === 0) {
      return stats;
    }

    const replacements = {
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
        // Replace placeholders in query definition
        const formattedQuery = queryRow.QueryDefinition.replace(
          /\${(.*?)}/g,
          (_match: string, p1: string) => replacements[p1 as keyof typeof replacements]?.toString() || ''
        );

        // Execute the validation query
        const queryResults = await connectionManager.executeQuery(formattedQuery);

        if (queryResults && queryResults.length > 0) {
          // Query succeeded with results
          const successResults = JSON.stringify(queryResults);
          await connectionManager.executeQuery(
            `UPDATE ${schema}.postvalidationqueries
             SET LastRunAt = ?, LastRunResult = ?, LastRunStatus = 'success'
             WHERE QueryID = ?`,
            [currentTime, successResults, queryID]
          );
          stats.success++;
        } else {
          // Query succeeded but returned no results (treated as failure/no issues found)
          await connectionManager.executeQuery(
            `UPDATE ${schema}.postvalidationqueries
             SET LastRunAt = ?, LastRunResult = NULL, LastRunStatus = 'failure'
             WHERE QueryID = ?`,
            [currentTime, queryID]
          );
          stats.failed++;
        }
      } catch (queryError) {
        // Query execution failed
        ailogger.error(`Post-validation query ${queryID} failed:`, queryError instanceof Error ? queryError : undefined);
        await connectionManager.executeQuery(
          `UPDATE ${schema}.postvalidationqueries
           SET LastRunAt = ?, LastRunStatus = 'failure'
           WHERE QueryID = ?`,
          [currentTime, queryID]
        );
        stats.failed++;
      }
    }
  } catch (error) {
    ailogger.error('Error executing post-validation queries:', error instanceof Error ? error : undefined);
  }

  return stats;
}

export async function POST(request: NextRequest, props: { params: Promise<{ view: string; schema: string }> }) {
  const params = await props.params;
  if (!params.schema || params.schema === 'undefined' || !params.view || params.view === 'undefined' || !params) {
    throw new Error('schema not provided');
  }

  const { view, schema } = params;

  // Parse optional plotID and censusID from request body for post-validation execution
  let _plotID: number | undefined;
  let _censusID: number | undefined;
  let _runPostValidation = false;

  try {
    const body = await request.json().catch(() => ({}));
    _plotID = body.plotID;
    _censusID = body.censusID;
    _runPostValidation = body.runPostValidation === true;
  } catch {
    // No body provided, that's fine
  }

  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;

  try {
    transactionID = await connectionManager.beginTransaction();

    // Execute the view refresh procedure
    const query = `CALL ${schema}.Refresh${view === 'viewfulltable' ? 'ViewFullTable' : view === 'measurementssummary' ? 'MeasurementsSummary' : ''}();`;
    await connectionManager.executeQuery(query);

    await connectionManager.commitTransaction(transactionID ?? '');

    // TODO: Post-validation query execution temporarily disabled for refactoring
    // For measurementssummary refresh, automatically run post-validation queries if context is provided
    const postValidationStats = null;
    // if (view === 'measurementssummary' && runPostValidation && plotID && censusID) {
    //   postValidationStats = await executePostValidationQueries(connectionManager, schema, plotID, censusID);
    //   ailogger.info(
    //     `Post-validation queries executed: ${postValidationStats.executed} total, ${postValidationStats.success} success, ${postValidationStats.failed} failed`
    //   );
    // }

    return new NextResponse(
      JSON.stringify({
        success: true,
        postValidation: postValidationStats
      }),
      { status: HTTPResponses.OK }
    );
  } catch (e) {
    await connectionManager.rollbackTransaction(transactionID ?? '');
    ailogger.error('Error:', e instanceof Error ? e : undefined);
    throw new Error('Call failed: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    await connectionManager.closeConnection();
  }
}
