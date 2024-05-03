// FIXED DATA CENSUS ROUTE HANDLERS
import { NextRequest, NextResponse } from "next/server";
import { ErrorMessages, HTTPResponses } from "@/config/macros";
import { CensusRDS, CensusResult } from '@/config/sqlrdsdefinitions/tables/censusrds';
import { getConn, parseCensusRequestBody, runQuery } from "@/components/processors/processormacros";
import mysql, { PoolConnection } from "mysql2/promise";
import { computeMutation } from "@/config/datagridhelpers";
import { censusFields } from '@/config/sqlrdsdefinitions/tables/censusrds';
import MapperFactory from "@/config/datamapper";

export async function GET(request: NextRequest): Promise<NextResponse<{ census: CensusRDS[], totalRows: number }>> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  const page = parseInt(request.nextUrl.searchParams.get('page')!, 10);
  const pageSize = parseInt(request.nextUrl.searchParams.get('pageSize')!, 10);
  const plotID = parseInt(request.nextUrl.searchParams.get('plotID')!, 10);
  if (isNaN(page) || isNaN(pageSize)) {
    throw new Error('Invalid page, pageSize, or plotID parameter');
  }
  try {
    // Initialize the connection attempt counter
    conn = await getConn();

    /// Calculate the starting row for the query based on the page number and page size
    const startRow = page * pageSize;

    // Query to get the paginated data
    let paginatedQuery: string;
    let queryParams: any[];
    if (plotID) {
      paginatedQuery = `
      SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.census
      WHERE PlotID = ?
      LIMIT ?, ?
      `;
      queryParams = [plotID, startRow, pageSize];
    } else {
      paginatedQuery = `
      SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.census
      LIMIT ?, ?
    `;
      queryParams = [startRow, pageSize];
    }
    const paginatedResults = await runQuery(conn, paginatedQuery, queryParams.map(param => param.toString()));

    // Query to get the total count of rows
    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;

    // Map the results to CensusRDS structure
    const mapper = MapperFactory.getMapper<CensusResult, CensusRDS>('Census');
    const censusRows = mapper.mapData(paginatedResults);

    return new NextResponse(JSON.stringify({
      census: censusRows,
      totalCount: totalRows
    }), { status: HTTPResponses.OK });
  } catch (error) {
    console.error('Error in GET:', error);
    throw new Error('Failed to fetch census data'); // Providing a more user-friendly error message
  } finally {
    if (conn) conn.release(); // Release the connection
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    conn = await getConn();
    const { CensusID, ...newRowData } = await parseCensusRequestBody(request);
    const insertQuery = mysql.format('INSERT INTO ?? SET ?', [`${schema}.census`, newRowData]);
    await runQuery(conn, insertQuery);
    return NextResponse.json({ message: "Insert successful" }, { status: 200 });
  } catch (error) {
    console.error('Error in POST:', error);
    return NextResponse.json({ message: ErrorMessages.ICF }, { status: 400 });
  } finally {
    if (conn) conn.release(); // Release the connection
  }
}

export async function PATCH(request: NextRequest) {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    conn = await getConn();
    await conn.beginTransaction();

    const { oldRow, newRow } = await request.json();

    const changedFields = censusFields.filter(field => computeMutation('census', newRow, oldRow));
    const updatesNeeded = changedFields.flatMap(field => {
      switch (field) {
        case 'plotID':
        case 'plotCensusNumber':
        case 'startDate':
        case 'endDate':
        case 'description':
          return mysql.format('UPDATE ?? SET ?? = ? WHERE CensusID = ?', [`${schema}.census`, field, newRow[field], newRow.censusID]);
        default:
          return null;
      }
    }).filter(query => query !== null);

    for (const query of updatesNeeded) {
      await runQuery(conn, query!);
    }

    await conn.commit();
    return NextResponse.json({ message: "Updates successful" }, { status: 200 });
  } catch (error) {
    console.error('Error in PATCH:', error);
    return NextResponse.json({ message: ErrorMessages.UCF }, { status: 400 });
  } finally {
    if (conn) conn.release(); // Release the connection
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  let conn: PoolConnection | null = null;
  const deleteID = parseInt(request.nextUrl.searchParams.get('censusID')!);
  if (isNaN(deleteID)) {
    return NextResponse.json({ message: "Invalid censusID parameter" }, { status: 400 });
  }
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    conn = await getConn();

    await runQuery(conn, `SET foreign_key_checks = 0;`, []);
    const deleteQuery = `DELETE FROM ${schema}.census WHERE CensusID = ?`;
    await runQuery(conn, deleteQuery, [deleteID]);
    await runQuery(conn, `SET foreign_key_checks = 1;`, []);

    return NextResponse.json({ message: "Delete successful" }, { status: HTTPResponses.OK });
  } catch (error) {
    console.error('Error in DELETE:', error);
    return NextResponse.json({ message: ErrorMessages.DCF }, { status: 400 });
  } finally {
    if (conn) conn.release(); // Release the connection
  }
}
