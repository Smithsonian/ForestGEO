import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import moment from 'moment';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';

export async function GET(_request: NextRequest, props: { params: Promise<{ schema: string; plotID: string; censusID: string; queryID: string }> }) {
  const params = await props.params;
  const { schema } = params;
  const plotID = parseInt(params.plotID);
  const censusID = parseInt(params.censusID);
  const queryID = parseInt(params.queryID);
  let transactionID: string | undefined = undefined;

  if (!schema || !plotID || !censusID || !queryID) {
    return new NextResponse('Missing parameters', { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();
  try {
    const query = `SELECT QueryDefinition FROM ${schema}.postvalidationqueries WHERE QueryID = ${queryID}`;
    const results = await connectionManager.executeQuery(query);

    if (results.length === 0) {
      return new NextResponse('Query not found', { status: HTTPResponses.NOT_FOUND });
    }

    const replacements = {
      schema: schema,
      currentPlotID: plotID,
      currentCensusID: censusID
    };
    const formattedQuery = results[0].QueryDefinition.replace(/\${(.*?)}/g, (_match: any, p1: string) => replacements[p1 as keyof typeof replacements]);
    transactionID = await connectionManager.beginTransaction();
    const queryResults = await connectionManager.executeQuery(formattedQuery);

    if (queryResults.length === 0) throw new Error('failure');

    const currentTime = moment().format('YYYY-MM-DD HH:mm:ss');
    const successResults = JSON.stringify(queryResults);
    const successUpdate = `UPDATE ${schema}.postvalidationqueries 
                            SET LastRunAt = ?, LastRunResult = ?, LastRunStatus = 'success' 
                            WHERE QueryID = ${queryID}`;
    await connectionManager.executeQuery(successUpdate, [currentTime, successResults]);
    await connectionManager.commitTransaction(transactionID ?? '');
    return new NextResponse(null, { status: HTTPResponses.OK });
  } catch (e: any) {
    await connectionManager.rollbackTransaction(transactionID ?? '');
    if (e.message === 'failure') {
      const currentTime = moment().format('YYYY-MM-DD HH:mm:ss');
      const failureUpdate = `UPDATE ${schema}.postvalidationqueries 
                             SET LastRunAt = ?, LastRunStatus = 'failure' 
                             WHERE QueryID = ${queryID}`;
      await connectionManager.executeQuery(failureUpdate, [currentTime]);
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
