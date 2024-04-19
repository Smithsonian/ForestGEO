// FIXED DATA ATTRIBUTES ROUTE HANDLERS
import {NextRequest, NextResponse} from "next/server";
import {ErrorMessages, HTTPResponses} from "@/config/macros";
import {AttributesRDS} from '@/config/sqlrdsdefinitions/attributerds';
import mysql, {PoolConnection} from "mysql2/promise";
import {getConn, parseAttributeRequestBody, runQuery} from "@/components/processors/processormacros";

export async function GET(request: NextRequest): Promise<NextResponse<{
  attributes: AttributesRDS[],
  totalCount: number
}>> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  const page = parseInt(request.nextUrl.searchParams.get('page')!, 10);
  if (isNaN(page)) {
    console.error('page parseInt conversion failed');
  }
  const pageSize = parseInt(request.nextUrl.searchParams.get('pageSize')!, 10);
  if (isNaN(pageSize)) {
    console.error('pageSize parseInt conversion failed');
    // handle error or set default
  }
  try {
    conn = await getConn();

    /// Calculate the starting row for the query based on the page number and page size
    const startRow = page * pageSize;
    // Query to get the paginated data
    const paginatedQuery = `
      SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.attributes
      LIMIT ?, ?
    `;
    const paginatedResults = await runQuery(conn, paginatedQuery, [startRow.toString(), pageSize.toString()]);

    // Query to get the total count of rows
    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;

    const attributeRows: AttributesRDS[] = paginatedResults.map((row: any, index: number) => ({
      id: index + 1,
      code: row.Code,
      description: row.Description,
      status: row.Status,
    }));

    return new NextResponse(
      JSON.stringify({attributes: attributeRows, totalCount: totalRows}),
      {status: 200}
    );
  } catch (error) {
    console.error('Error in GET:', error);
    throw error;
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    const newRowData = await parseAttributeRequestBody(request, 'POST');
    conn = await getConn();

    const insertQuery = mysql.format('INSERT INTO ?? SET ?', [`${schema}.attributes`, newRowData]);
    await runQuery(conn, insertQuery);

    return new NextResponse(JSON.stringify({message: "Insert successful"}), {status: 200});
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') {
      // Handle the specific error if the code already exists
      return new NextResponse(JSON.stringify({message: ErrorMessages.UKAE}), {status: HTTPResponses.CONFLICT});
    }
    console.error('Error in POST:', error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  let conn: PoolConnection | null = null;
  const deleteCode = request.nextUrl.searchParams.get('code')!;
  if (!deleteCode) {
    return new NextResponse(JSON.stringify({message: "Code parameter is required"}), {status: 400});
  }
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    conn = await getConn();

    await runQuery(conn, `SET foreign_key_checks = 0;`, []);
    const deleteQuery = `DELETE FROM ${schema}.attributes WHERE Code = ?`;
    await runQuery(conn, deleteQuery, [deleteCode]);
    await runQuery(conn, `SET foreign_key_checks = 1;`, []);

    return new NextResponse(JSON.stringify({message: "Delete successful"}), {status: 200});
  } catch (error) {
    console.error('Error in DELETE operation:', error);
    return new NextResponse(JSON.stringify({message: ErrorMessages.DCF}), {status: 400});
  } finally {
    if (conn) conn.release();
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  let conn: PoolConnection | null = null;
  const code = request.nextUrl.searchParams.get('code')!;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    const updateData = await parseAttributeRequestBody(request, 'PATCH');
    conn = await getConn();

    const updateQuery = mysql.format('UPDATE ?? SET ? WHERE Code = ?', [`${schema}.attributes`, updateData, code]);
    await runQuery(conn, updateQuery);

    return new NextResponse(JSON.stringify({message: "Update successful"}), {status: 200});
  } catch (error: any) {
    if (error.code === 'ER_DUP_ENTRY') {
      // Handle the specific error if the new code conflicts
      return new NextResponse(JSON.stringify({message: ErrorMessages.UKAE}), {status: 409});
    }
    console.error('Error in PATCH:', error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
}