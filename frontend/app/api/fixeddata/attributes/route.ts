// FIXED DATA ATTRIBUTES ROUTE HANDLERS
import {NextRequest, NextResponse} from "next/server";
import {ErrorMessages, HTTPResponses} from "@/config/macros";
import {AttributesRDS} from "@/config/sqlmacros";
import mysql, {PoolConnection} from "mysql2/promise";
import {
  getSchema,
  getSqlConnection,
  parseAttributeRequestBody,
  runQuery
} from "@/components/processors/processormacros";

export async function GET(request: NextRequest): Promise<NextResponse<{
  attributes: AttributesRDS[],
  totalCount: number
}>> {
  let conn: PoolConnection | null = null;
  try {
    const schema = getSchema();
    const page = parseInt(request.nextUrl.searchParams.get('page')!, 10);
    if (isNaN(page)) {
      console.error('page parseInt conversion failed');
    }
    const pageSize = parseInt(request.nextUrl.searchParams.get('pageSize')!, 10);
    if (isNaN(pageSize)) {
      console.error('pageSize parseInt conversion failed');
      // handle error or set default
    }
    // Initialize the connection attempt counter
    let attempt = 0;
    conn = await getSqlConnection(attempt);

    /// Calculate the starting row for the query based on the page number and page size
    const startRow = page * pageSize;
    // Query to get the paginated data
    const paginatedQuery = `
      SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.Attributes
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
  try {
    const schema = getSchema();
    const newRowData = await parseAttributeRequestBody(request, 'POST');
    conn = await getSqlConnection(0);

    const insertQuery = mysql.format('INSERT INTO ?? SET ?', [`${schema}.Attributes`, newRowData]);
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
  try {
    const schema = getSchema();
    conn = await getSqlConnection(0);

    const deleteCode = request.nextUrl.searchParams.get('code')!;
    if (!deleteCode) {
      return new NextResponse(JSON.stringify({message: "Code parameter is required"}), {status: 400});
    }

    const deleteQuery = `DELETE FROM ${schema}.Attributes WHERE Code = ?`;
    await runQuery(conn, deleteQuery, [deleteCode]);

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
  try {
    const schema = getSchema();
    const code = request.nextUrl.searchParams.get('code')!;
    const updateData = await parseAttributeRequestBody(request, 'PATCH');
    conn = await getSqlConnection(0);

    const updateQuery = mysql.format('UPDATE ?? SET ? WHERE Code = ?', [`${schema}.Attributes`, updateData, code]);
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