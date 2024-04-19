// FIXED DATA SPECIES ROUTE HANDLERS
import {NextRequest, NextResponse} from "next/server";
import {getConn, parseSpeciesRequestBody, runQuery} from "@/components/processors/processormacros";
import {SpeciesRDS, SpeciesResult} from '@/config/sqlrdsdefinitions/speciesrds';
import {bitToBoolean, ErrorMessages} from "@/config/macros";
import mysql, {PoolConnection} from "mysql2/promise";

export async function GET(request: NextRequest): Promise<NextResponse<{ species: SpeciesRDS[], totalCount: number }>> {
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
      SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.species
      LIMIT ?, ?
    `;
    const paginatedResults = await runQuery(conn, paginatedQuery, [startRow.toString(), pageSize.toString()]);

    // Query to get the total count of rows
    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;

    const speciesRows: SpeciesRDS[] = paginatedResults.map((row: SpeciesResult, index: number) => ({
      id: index + 1,
      speciesID: row.SpeciesID,
      genusID: row.GenusID,
      currentTaxonFlag: bitToBoolean(row.CurrentTaxonFlag),
      obsoleteTaxonFlag: bitToBoolean(row.ObsoleteTaxonFlag),
      speciesName: row.SpeciesName,
      speciesCode: row.SpeciesCode,
      idLevel: row.IDLevel,
      authority: row.Authority,
      fieldFamily: row.FieldFamily,
      description: row.Description,
      referenceID: row.ReferenceID,
      defaultDBHMin: row.DefaultDBHMin,
      defaultDBHMax: row.DefaultDBHMax,
      defaultHOMMin: row.DefaultHOMMin,
      defaultHOMMax: row.DefaultHOMMax
    }));
    return new NextResponse(JSON.stringify({species: speciesRows, totalCount: totalRows}), {status: 200});
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
    const {SpeciesID, ...newRowData} = await parseSpeciesRequestBody(request);
    conn = await getConn();
    const insertQuery = mysql.format('INSERT INTO ?? SET ?', [`${schema}.species`, newRowData]);
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
  const deleteSpeciesID = parseInt(request.nextUrl.searchParams.get('speciesID')!);
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    conn = await getConn();
    await runQuery(conn, `SET foreign_key_checks = 0;`, []);
    const deleteRow = await runQuery(conn, `DELETE FROM ${schema}.species WHERE [SpeciesID] = ${deleteSpeciesID}`);
    await runQuery(conn, `SET foreign_key_checks = 1;`, []);
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
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    const {SpeciesID, ...updateData} = await parseSpeciesRequestBody(request);
    conn = await getConn();
    // Build the update query
    const updateQuery = mysql.format('UPDATE ?? SET ? WHERE SpeciesID = ?', [`${schema}.species`, updateData, SpeciesID]);
    await runQuery(conn, updateQuery);

    return NextResponse.json({message: "Update successful"}, {status: 200});
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}
