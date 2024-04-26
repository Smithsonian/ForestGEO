// FIXED DATA PERSONNEL ROUTE HANDLERS
import {NextRequest, NextResponse} from "next/server";
import {StemTreeDetailsRDS, StemTreeDetailsResult} from '@/config/sqlrdsdefinitions/stemtreerds';
import {getConn, runQuery} from "@/components/processors/processormacros";
import mysql, {PoolConnection} from "mysql2/promise";
import {computeMutation, stemTreeDetailsFields} from "@/config/datagridhelpers";

export async function GET(request: NextRequest): Promise<NextResponse<{
  stemTreeDetails: StemTreeDetailsRDS[],
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
      SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.stemtreedetails
      LIMIT ?, ?
    `;
    const paginatedResults = await runQuery(conn, paginatedQuery, [startRow.toString(), pageSize.toString()]);

    // Query to get the total count of rows
    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;

    const stemTreeDetailRows: StemTreeDetailsRDS[] = paginatedResults.map((row: StemTreeDetailsResult, index: number) => ({
      id: index + 1,
      stemID: row.StemID,
      stemTag: row.StemTag,
      treeID: row.TreeID,
      treeTag: row.TreeTag,
      speciesName: row.SpeciesName,
      subSpeciesName: row.SubSpeciesName,
      quadratName: row.QuadratName,
      plotName: row.PlotName,
      locationName: row.LocationName,
      countryName: row.CountryName,
      quadratDimensionX: row.QuadratDimensionX,
      quadratDimensionY: row.QuadratDimensionY,
      stemQuadX: parseFloat(row.StemQuadX),
      stemQuadY: parseFloat(row.StemQuadY),
      stemDescription: row.StemDescription
    }));

    return new NextResponse(JSON.stringify({
      stemTreeDetails: stemTreeDetailRows,
      totalCount: totalRows
    }), {status: 200});
  } catch (error) {
    console.error('Error in GET:', error);
    throw new Error('Failed to fetch stemtreedetails data');
  } finally {
    if (conn) conn.release();
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('No schema variable provided!');

  try {
    conn = await getConn();
    await conn.beginTransaction();

    const {oldRow, newRow} = await request.json();

    // Detect which fields have changed
    const changedFields = stemTreeDetailsFields.filter(field => computeMutation('stemTreeDetails', newRow, oldRow));

    const updatesNeeded = changedFields.flatMap(field => {
      switch (field) {
        case 'stemTag':
        case 'stemQuadX':
        case 'stemQuadY':
        case 'stemDescription':
          return mysql.format('UPDATE ?? SET ?? = ? WHERE StemID = ?', [`${schema}.stems`, field, newRow[field], newRow.StemID]);
        case 'treeTag':
          return mysql.format('UPDATE ?? SET ?? = ? WHERE TreeID = ?', [`${schema}.trees`, field, newRow[field], newRow.TreeID]);
        case 'speciesName':
          return mysql.format('UPDATE ?? SET ?? = ? WHERE SpeciesID = ?', [`${schema}.species`, field, newRow[field], newRow.SpeciesID]);
        case 'subSpeciesName':
          return mysql.format('UPDATE ?? SET ?? = ? WHERE SubSpeciesID = ?', [`${schema}.subspecies`, field, newRow[field], newRow.SubSpeciesID]);
        default:
          return null;  // Handle any unexpected fields gracefully
      }
    }).filter(query => query !== null);  // Remove null entries

    // Execute each update query
    for (const query of updatesNeeded) {
      await runQuery(conn, query!);
    }

    await conn.commit();
    return NextResponse.json({message: "Updates successful"}, {status: 200});
  } catch (error: any) {
    if (conn) {
      await conn.rollback();
      console.error('Error in PATCH:', error);
      return NextResponse.json({message: "Update failed", details: error.message}, {status: 400});
    }
    throw error; // Re-throw the error if conn is null
  } finally {
    if (conn) conn.release();
  }
}