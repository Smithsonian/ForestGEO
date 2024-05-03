import { NextRequest, NextResponse } from "next/server";
import { PoolConnection } from "mysql2/promise";
import { getConn, runQuery } from "@/components/processors/processormacros";
import {
  MeasurementsSummaryResult,
  MeasurementsSummaryRDS
} from '@/config/sqlrdsdefinitions/views/measurementssummaryviewrds';
import MapperFactory from "@/config/datamapper";

interface MSOutput {
  measurementsSummary: MeasurementsSummaryRDS[],
  totalCount: number
}

export async function GET(request: NextRequest): Promise<NextResponse<MSOutput>> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  const page = parseInt(request.nextUrl.searchParams.get('page')!, 10);
  const pageSize = parseInt(request.nextUrl.searchParams.get('pageSize')!, 10);
  const plotID = parseInt(request.nextUrl.searchParams.get('plotID')!);
  const censusID = parseInt(request.nextUrl.searchParams.get('censusID')!);
  if (isNaN(page) || isNaN(pageSize) || isNaN(plotID) || isNaN(censusID)) {
    throw new Error('Invalid page or pageSize parameter');
  }
  try {
    conn = await getConn();
    const startRow = page * pageSize;

    // Query to get the paginated data
    let paginatedQuery: string;
    let queryParams: any[];
    paginatedQuery = `
      SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.measurementssummaryview
      WHERE PlotID = ? AND CensusID = ?
      LIMIT ?, ?;
      `;
    queryParams = [plotID, censusID, startRow, pageSize];
    // Run the paginated query
    const paginatedResults = await runQuery(conn, paginatedQuery, queryParams.map(param => param.toString()));

    // Query to get the total count of rows
    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    console.log(totalRowsResult);
    const totalRows = totalRowsResult[0].totalRows;

    const mapper = MapperFactory.getMapper<MeasurementsSummaryResult, MeasurementsSummaryRDS>('MeasurementsSummaryView');
    const measurementsSummaryRows = mapper.mapData(paginatedResults);

    return new NextResponse(JSON.stringify({
      measurementsSummary: measurementsSummaryRows,
      totalCount: totalRows
    }), { status: 200 });
  } catch (error: any) {
    console.error('Error in GET operation:', error.message);
    return new NextResponse(JSON.stringify({ message: 'SQL query failed: ' + error.message }), { status: 400 });
  } finally {
    if (conn) conn.release();
  }
}