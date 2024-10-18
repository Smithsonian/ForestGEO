import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { getConn, runQuery } from '@/components/processors/processormacros';
import moment from 'moment';

export async function GET(_request: NextRequest, { params }: { params: { schema: string; plotID: string; censusID: string; queryID: string } }) {
  const { schema } = params;
  const plotID = parseInt(params.plotID);
  const censusID = parseInt(params.censusID);
  const queryID = parseInt(params.queryID);

  if (!schema || !plotID || !censusID || !queryID) {
    return new NextResponse('Missing parameters', { status: HTTPResponses.INVALID_REQUEST });
  }

  const conn = await getConn();
  try {
    const query = `SELECT QueryDefinition FROM ${schema}.postvalidationqueries WHERE QueryID = ${queryID}`;
    const results = await runQuery(conn, query);

    if (results.length === 0) return new NextResponse('Query not found', { status: HTTPResponses.NOT_FOUND });

    const replacements = {
      schema: schema,
      currentPlotID: plotID,
      currentCensusID: censusID
    };
    const formattedQuery = results[0].QueryDefinition.replace(/\${(.*?)}/g, (_match: any, p1: string) => replacements[p1 as keyof typeof replacements]);

    const queryResults = await runQuery(conn, formattedQuery);

    if (queryResults.length === 0) throw new Error('failure');

    const currentTime = moment().format('YYYY-MM-DD HH:mm:ss');
    const successResults = JSON.stringify(queryResults);
    const successUpdate = `UPDATE ${schema}.postvalidationqueries 
                            SET LastRunAt = ?, LastRunResult = ?, LastRunStatus = 'success' 
                            WHERE QueryID = ${queryID}`;
    await runQuery(conn, successUpdate, [currentTime, successResults]);

    return new NextResponse(null, { status: HTTPResponses.OK });
  } catch (e: any) {
    if (e.message === 'failure') {
      const currentTime = moment().format('YYYY-MM-DD HH:mm:ss');
      const failureUpdate = `UPDATE ${schema}.postvalidationqueries 
                             SET LastRunAt = ?, LastRunStatus = 'failure' 
                             WHERE QueryID = ${queryID}`;
      await runQuery(conn, failureUpdate, [currentTime]);
      return new NextResponse(null, { status: HTTPResponses.OK }); // if the query itself fails, that isn't a good enough reason to return a crash. It should just be logged.
    }
    return new NextResponse('Internal Server Error', { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    if (conn) conn.release();
  }
}
