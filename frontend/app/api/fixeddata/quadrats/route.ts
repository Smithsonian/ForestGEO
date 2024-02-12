// FIXED DATA QUADRATS ROUTE HANDLERS
import {NextRequest, NextResponse} from "next/server";
import {
  getSchema,
  getSqlConnection,
  parseQuadratsRequestBody,
  QuadratsResult,
  runQuery
} from "@/components/processors/processormacros";
import {ErrorMessages} from "@/config/macros";
import {QuadratsRDS} from "@/config/sqlmacros";
import mysql, {PoolConnection} from "mysql2/promise";

export async function GET(request: NextRequest): Promise<NextResponse<{
  quadrats: QuadratsRDS[],
  totalCount: number
}>> {
  let conn: PoolConnection | null = null;
  try {
    const schema = getSchema();
    const page = parseInt(request.nextUrl.searchParams.get('page')!, 10);
    const pageSize = parseInt(request.nextUrl.searchParams.get('pageSize')!, 10);
    const plotID = parseInt(request.nextUrl.searchParams.get('plotID')!, 10);

    if (isNaN(page) || isNaN(pageSize)) {
      throw new Error('Invalid page, pageSize, or plotID parameter');
    }
    // Initialize the connection attempt counter
    conn = await getSqlConnection(0);

    /// Calculate the starting row for the query based on the page number and page size
    const startRow = page * pageSize;

    // Query to get the paginated data
    let paginatedQuery: string;
    let queryParams: any[];
    if (plotID) {
      paginatedQuery = `
      SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.Quadrats
      WHERE PlotID = ?
      LIMIT ?, ?
      `;
      queryParams = [plotID, startRow, pageSize];
    } else {
      paginatedQuery = `
      SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.Quadrats
      LIMIT ?, ?
    `;
      queryParams = [startRow, pageSize];
    }
    const paginatedResults = await runQuery(conn, paginatedQuery, queryParams.map(param => param.toString()));

    // Query to get the total count of rows
    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;

    const quadratRows: QuadratsRDS[] = paginatedResults.map((row: QuadratsResult, index: number) => ({
      id: index + 1,
      quadratID: row.QuadratID,
      plotID: row.PlotID,
      quadratName: row.QuadratName,
      dimensionX: row.DimensionX,
      dimensionY: row.DimensionY,
      area: row.Area,
      quadratShape: row.QuadratShape
    }));
    return new NextResponse(JSON.stringify({quadrats: quadratRows, totalCount: totalRows}), {status: 200});
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}

export async function POST(request: NextRequest) {
  let conn: PoolConnection | null = null;
  try {
    const schema = getSchema();
    const {QuadratID, ...newRowData} = await parseQuadratsRequestBody(request);
    conn = await getSqlConnection(0);
    // Insert the new row
    const insertQuery = mysql.format('INSERT INTO ?? SET ?', [`${schema}.Quadrats`, newRowData]);
    await runQuery(conn, insertQuery);

    return NextResponse.json({message: "Insert successful"}, {status: 200});
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}

export async function DELETE(request: NextRequest) {
  let conn: PoolConnection | null = null;
  try {
    const schema = getSchema();
    conn = await getSqlConnection(0);
    const deleteQuadratID = parseInt(request.nextUrl.searchParams.get('quadratID')!);
    const deleteRow = await runQuery(conn, `DELETE FROM ${schema}.Quadrats WHERE [QuadratID] = ${deleteQuadratID}`);
    if (!deleteRow) return NextResponse.json({message: ErrorMessages.DCF}, {status: 400});
    return NextResponse.json({message: "Delete successful"}, {status: 200});
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}

export async function PATCH(request: NextRequest) {
  let conn: PoolConnection | null = null;
  try {
    const schema = getSchema();
    const {QuadratID, ...updateData} = await parseQuadratsRequestBody(request);
    conn = await getSqlConnection(0);

    // Build the update query
    const updateQuery = mysql.format('UPDATE ?? SET ? WHERE QuadratID = ?', [`${schema}.Quadrats`, updateData, QuadratID]);
    await runQuery(conn, updateQuery);

    return NextResponse.json({message: "Update successful"}, {status: 200});
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}
