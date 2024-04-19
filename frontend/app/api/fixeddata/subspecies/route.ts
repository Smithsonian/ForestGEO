// FIXED DATA SUBSPECIES  ROUTE HANDLERS
import {NextRequest, NextResponse} from "next/server";
import {bitToBoolean, ErrorMessages, HTTPResponses} from "@/config/macros";
import {SubSpeciesRDS, SubSpeciesResult} from '@/config/sqlrdsdefinitions/subspeciesrds';
import {getConn, parseSubSpeciesRequestBody, runQuery} from "@/components/processors/processormacros";
import mysql, {PoolConnection} from "mysql2/promise";

export async function GET(request: NextRequest): Promise<NextResponse<{
  subSpecies: SubSpeciesRDS[],
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
      SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.subspecies
      LIMIT ?, ?
    `;
    const paginatedResults = await runQuery(conn, paginatedQuery, [startRow.toString(), pageSize.toString()]);

    // Query to get the total count of rows
    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;

    const subSpeciesRows: SubSpeciesRDS[] = paginatedResults.map((row: SubSpeciesResult, index: number) => ({
      id: index + 1,
      subSpeciesID: row.SubSpeciesID,
      speciesID: row.SpeciesID,
      currentTaxonFlag: bitToBoolean(row.CurrentTaxonFlag),
      obsoleteTaxonFlag: bitToBoolean(row.ObsoleteTaxonFlag),
      subSpeciesName: row.SubSpeciesName,
      subSpeciesCode: row.SubSpeciesCode,
      authority: row.Authority,
      infraSpecificLevel: row.InfraSpecificLevel
    }));

    return new NextResponse(
      JSON.stringify({subSpecies: subSpeciesRows, totalCount: totalRows}),
      {status: HTTPResponses.OK}
    );
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}

export async function POST(request: NextRequest) {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    const {SubSpeciesID, ...newRowData} = await parseSubSpeciesRequestBody(request);
    conn = await getConn();

    const insertQuery = mysql.format('INSERT INTO ?? SET ?', [`${schema}.subspecies`, newRowData]);
    await runQuery(conn, insertQuery);

    return NextResponse.json({message: "Insert successful"}, {status: HTTPResponses.CREATED});
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}

export async function PATCH(request: NextRequest) {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    const {SubSpeciesID, ...updateData} = await parseSubSpeciesRequestBody(request);
    conn = await getConn();
    const updateQuery = mysql.format('UPDATE ?? SET ? WHERE SubSpeciesID = ?', [`${schema}.subspecies`, updateData, SubSpeciesID]);
    await runQuery(conn, updateQuery);

    return NextResponse.json({message: "Update successful"}, {status: 200});
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}

export async function DELETE(request: NextRequest) {
  let conn: PoolConnection | null = null;
  const deleteSubSpeciesID = parseInt(request.nextUrl.searchParams.get('subSpeciesID')!);
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    conn = await getConn();
    if (!conn) throw new Error('SQL connection failed');
    await runQuery(conn, `SET foreign_key_checks = 0;`, []);
    const deleteRow = await runQuery(conn, `DELETE FROM ${schema}.subspecies WHERE [SubSpeciesID] = ?`, [deleteSubSpeciesID]);
    await runQuery(conn, `SET foreign_key_checks = 1;`, []);
    if (!deleteRow) return NextResponse.json({message: ErrorMessages.DCF}, {status: HTTPResponses.INVALID_REQUEST});

    return NextResponse.json({message: "Delete successful"}, {status: HTTPResponses.OK});
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}