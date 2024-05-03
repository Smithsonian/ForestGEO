import {getConn, runQuery} from "@/components/processors/processormacros";
import MapperFactory from "@/config/datamapper";
import {ValidationChangelogRDS, ValidationChangelogResult} from '@/config/sqlrdsdefinitions/tables/valchangelogrds';
import {PoolConnection} from "mysql2/promise";
import {NextRequest, NextResponse} from "next/server";

export async function GET(request: NextRequest): Promise<NextResponse<{
  validationchangelog: ValidationChangelogRDS[],
  totalCount: number
}>> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  const page = parseInt(request.nextUrl.searchParams.get('page')!, 10);
  const pageSize = parseInt(request.nextUrl.searchParams.get('pageSize')!, 10);

  try {
    conn = await getConn();
    const startRow = page * pageSize;

    const paginatedQuery = `
      SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.validationchangelog
      LIMIT ?, ?
    `;
    const paginatedResults = await runQuery(conn, paginatedQuery, [startRow.toString(), pageSize.toString()]);

    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;

    const mapper = MapperFactory.getMapper<ValidationChangelogResult, ValidationChangelogRDS>('ValidationHistory');
    const validationChangelogRows = mapper.mapData(paginatedResults);

    return new NextResponse(JSON.stringify({
      validationchangelog: validationChangelogRows,
      totalCount: totalRows
    }), {status: 200});
  } catch (error) {
    console.error('Error in GET:', error);
    throw new Error('Failed to fetch validation changelog data');
  } finally {
    if (conn) conn.release();
  }
}