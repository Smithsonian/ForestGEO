import { getConn, parseSubquadratsRequestBody, runQuery } from "@/components/processors/processormacros";
import { ErrorMessages } from "@/config/macros";
import { SubQuadratRDS, SubQuadratResult } from "@/config/sqlrdsdefinitions/subquadratrds";
import { PoolConnection, format } from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";

// accepts 4 search parameters --> page (req), pageSize (req), plotID (req), quadratID (opt)
export async function GET(request: NextRequest): Promise<NextResponse<{
  subquadrats: SubQuadratRDS[],
  totalCount: number
}>> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  const page = parseInt(request.nextUrl.searchParams.get('page')!, 10);
  const pageSize = parseInt(request.nextUrl.searchParams.get('pageSize')!, 10);
  const plotID = parseInt(request.nextUrl.searchParams.get('plotID')!, 10);
  let quadratIDParam = request.nextUrl.searchParams.get('quadratID');
  if (isNaN(page) || isNaN(pageSize)) {
    throw new Error('Invalid page or pageSize');
  }

  try {
    conn = await getConn();
    const startRow = page * pageSize;
    let paginatedQuery = '';
    if (quadratIDParam !== 'undefined' && quadratIDParam !== null) {
      let quadratID = parseInt(quadratIDParam, 10);
      paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.subquadrats WHERE QuadratID = ${quadratID} LIMIT ?, ?`;
    } else {
      paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.subquadrats WHERE QuadratID IN (SELECT QuadratID FROM ${schema}.quadrats WHERE PlotID = ${plotID}) LIMIT ?, ?`;
    }
    let queryParams = [startRow, pageSize];
    const paginatedResults = await runQuery(conn, paginatedQuery, queryParams.map(param => param.toString()));

    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;

    const subquadratRows: SubQuadratRDS[] = paginatedResults.map((row: SubQuadratResult, index: number) => {
      return {
        id: index + 1,
        subquadratID: row.SQID,
        subquadratName: row.SQName,
        quadratID: row.QuadratID,
        xIndex: row.Xindex,
        yIndex: row.Yindex,
        sqIndex: row.SQindex
      };
    });

    return new NextResponse(JSON.stringify({ subquadrats: subquadratRows, totalCount: totalRows }), { status: 200 });
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    const { SQID, ...newRowData } = await parseSubquadratsRequestBody(request);

    conn = await getConn();

    const insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.subquadrats`, newRowData]);
    const results = await runQuery(conn, insertQuery);
    return NextResponse.json({ message: "Insert successful", newSubQuadratID: results.insertId }, { status: 200 });
  } catch (error) {
    console.error('Error in POST:', error);
    return NextResponse.json({ message: ErrorMessages.ICF }, { status: 400 });
  } finally {
    if (conn) conn.release();
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    const { SQID, ...updateData } = await parseSubquadratsRequestBody(request);
    conn = await getConn();

    const updateQuery = format('UPDATE ?? SET ? WHERE SQID = ?', [`${schema}.subquadrats`, updateData, SQID]);
    await runQuery(conn, updateQuery);

    return NextResponse.json({ message: "Update successful" }, { status: 200 });
  } catch (error) {
    console.error('Error in PATCH:', error);
    return NextResponse.json({ message: ErrorMessages.UCF }, { status: 400 });
  } finally {
    if (conn) conn.release();
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  let conn: PoolConnection | null = null;
  const deleteSQID = parseInt(request.nextUrl.searchParams.get('sqid')!);
  if (isNaN(deleteSQID)) {
    return NextResponse.json({ message: "Invalid SQID" }, { status: 400 });
  }
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    conn = await getConn();

    await runQuery(conn, `SET foreign_key_checks = 0;`, []);
    const deleteQuery = `DELETE FROM ${schema}.subquadrats WHERE SQID = ?`;
    await runQuery(conn, deleteQuery, [deleteSQID]);
    await runQuery(conn, `SET foreign_key_checks = 1;`, []);

    return NextResponse.json({ message: "Delete successful" }, { status: 200 });
  } catch (error) {
    console.error('Error in DELETE:', error);
    return NextResponse.json({ message: ErrorMessages.DCF }, { status: 400 });
  } finally {
    if (conn) conn.release();
  }
}