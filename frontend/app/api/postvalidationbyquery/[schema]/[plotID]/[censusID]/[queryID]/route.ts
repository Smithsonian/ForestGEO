import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { getConn, runQuery } from '@/components/processors/processormacros';

export async function GET(_request: NextRequest, { params }: { params: { schema: string; plotID: string; censusID: string; queryID: string } }) {
  const { schema } = params;
  const plotID = parseInt(params.plotID);
  const censusID = parseInt(params.censusID);
  const queryID = parseInt(params.queryID);
  if (!schema || !plotID || !censusID || !queryID) {
    return new NextResponse('Missing parameters', { status: HTTPResponses.INVALID_REQUEST });
  }
  const conn = await getConn();
  const query = `SELECT QueryDefinition FROM ${schema}.postvalidationqueries WHERE QueryID = ${queryID}`;
  const results = await runQuery(conn, query);
  if (results.length === 0) {
    return new NextResponse('Query not found', { status: HTTPResponses.NOT_FOUND });
  }
  const replacements = {
    schema: schema,
    currentPlotID: plotID,
    currentCensusID: censusID
  };
  const formattedQuery = results[0].QueryDefinition.replace(/\${(.*?)}/g, (_match: any, p1: string) => replacements[p1 as keyof typeof replacements]);
  const queryResults = await runQuery(conn, formattedQuery);
  if (queryResults.length === 0) {
    return new NextResponse('Query returned no results', { status: HTTPResponses.NOT_FOUND });
  }
  return new NextResponse(
    JSON.stringify({
      count: queryResults.length,
      data: queryResults
    }),
    { status: HTTPResponses.OK }
  );
}
