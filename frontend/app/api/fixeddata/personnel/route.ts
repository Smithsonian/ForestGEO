// FIXED DATA PERSONNEL ROUTE HANDLERS
import {NextRequest, NextResponse} from "next/server";
import {ErrorMessages} from "@/config/macros";
import {PersonnelRDS} from "@/config/sqlmacros";
import {getConn, parsePersonnelRequestBody, PersonnelResult, runQuery} from "@/components/processors/processormacros";
import mysql, {PoolConnection} from "mysql2/promise";

export async function GET(request: NextRequest): Promise<NextResponse<{
  personnel: PersonnelRDS[],
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
      SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.Personnel
      LIMIT ?, ?
    `;
    const paginatedResults = await runQuery(conn, paginatedQuery, [startRow.toString(), pageSize.toString()]);

    // Query to get the total count of rows
    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;

    const personnelRows: PersonnelRDS[] = paginatedResults.map((row: PersonnelResult, index: number) => ({
      id: index + 1,
      personnelID: row.PersonnelID,
      firstName: row.FirstName,
      lastName: row.LastName,
      role: row.Role
      // ... other fields as needed
    }));

    return new NextResponse(JSON.stringify({personnel: personnelRows, totalCount: totalRows}), {status: 200});
  } catch (error) {
    console.error('Error in GET:', error);
    throw new Error('Failed to fetch personnel data');
  } finally {
    if (conn) conn.release();
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    const {PersonnelID, ...newRowData} = await parsePersonnelRequestBody(request);

    conn = await getConn();

    const insertQuery = mysql.format('INSERT INTO ?? SET ?', [`${schema}.Personnel`, newRowData]);
    const results = await runQuery(conn, insertQuery);
    return NextResponse.json({message: "Insert successful", newPersonnelID: results.insertId}, {status: 200});
  } catch (error) {
    console.error('Error in POST:', error);
    return NextResponse.json({message: ErrorMessages.ICF}, {status: 400});
  } finally {
    if (conn) conn.release();
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    const {PersonnelID, ...updateData} = await parsePersonnelRequestBody(request);
    conn = await getConn();

    const updateQuery = mysql.format('UPDATE ?? SET ? WHERE PersonnelID = ?', [`${schema}.Personnel`, updateData, PersonnelID]);
    await runQuery(conn, updateQuery);

    return NextResponse.json({message: "Update successful"}, {status: 200});
  } catch (error) {
    console.error('Error in PATCH:', error);
    return NextResponse.json({message: ErrorMessages.UCF}, {status: 400});
  } finally {
    if (conn) conn.release();
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  let conn: PoolConnection | null = null;
  const deletePersonnelID = parseInt(request.nextUrl.searchParams.get('personnelID')!);
  if (isNaN(deletePersonnelID)) {
    return NextResponse.json({message: "Invalid PersonnelID"}, {status: 400});
  }
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    conn = await getConn();

    await runQuery(conn, `SET foreign_key_checks = 0;`, []);
    const deleteQuery = `DELETE FROM ${schema}.Personnel WHERE PersonnelID = ?`;
    await runQuery(conn, deleteQuery, [deletePersonnelID]);
    await runQuery(conn, `SET foreign_key_checks = 1;`, []);

    return NextResponse.json({message: "Delete successful"}, {status: 200});
  } catch (error) {
    console.error('Error in DELETE:', error);
    return NextResponse.json({message: ErrorMessages.DCF}, {status: 400});
  } finally {
    if (conn) conn.release();
  }
}
