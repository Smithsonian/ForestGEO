// FIXED DATA PERSONNEL ROUTE HANDLERS
import { getConn, runQuery } from "@/components/processors/processormacros";
import mysql, { PoolConnection } from "mysql2/promise";
import MapperFactory from "@/config/datamapper";
import { detectFieldChanges, generateUpdateQueries, stemDimensionsViewFields } from "@/components/processors/processorhelperfunctions";
import { StemDimensionsViewRDS, StemDimensionsViewResult } from "@/config/sqlrdsdefinitions/views/stemdimensionsviewrds";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest): Promise<NextResponse<{
  stemDimensionsView: StemDimensionsViewRDS[],
  totalCount: number
}>> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  const page = parseInt(request.nextUrl.searchParams.get('page')!, 10);
  if (isNaN(page)) {
    throw new Error('page parseInt conversion failed');
  }
  const pageSize = parseInt(request.nextUrl.searchParams.get('pageSize')!, 10);
  if (isNaN(pageSize)) {
    throw new Error('pageSize parseInt conversion failed');
  }
  const plotID = parseInt(request.nextUrl.searchParams.get('plotID')!, 10);
  try {
    conn = await getConn();

    /// Calculate the starting row for the query based on the page number and page size
    const startRow = page * pageSize;

    // Query to get the paginated data
    const paginatedQuery = `
      SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.stemdimensionsview
      LIMIT ?, ?
    `;
    const paginatedResults = await runQuery(conn, paginatedQuery, [startRow.toString(), pageSize.toString()]);

    // Query to get the total count of rows
    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;

    const mapper = MapperFactory.getMapper<StemDimensionsViewResult, StemDimensionsViewRDS>('StemDimensionsView');
    const stemDimensionsViewRows = mapper.mapData(paginatedResults);

    return new NextResponse(JSON.stringify({
      stemDimensionsView: stemDimensionsViewRows,
      totalCount: totalRows
    }), { status: 200 });
  } catch (error) {
    console.error('Error in GET:', error);
    throw new Error('Failed to fetch stemdimensionsview data');
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

    const { oldRow, newRow } = await request.json();

    // Detect changes across all fields
    const changedFields = detectFieldChanges(newRow, oldRow, stemDimensionsViewFields);

    // Define slices corresponding to different sections of the array with explicit typing
    const slices = {
      trees: [0, 1],
      stems: [1, 5],
      subquadrats: [5, 12],
      quadrats: [12, 16],
      plots: [16, stemDimensionsViewFields.length],
    };

    // Function to generate queries based on the slice
    const generateQueriesFromSlice = (type: keyof typeof slices, primaryKeyField: string) => {
      const fieldsInSlice = stemDimensionsViewFields.slice(slices[type][0], slices[type][1]);
      const changedInSlice = changedFields.filter(field => fieldsInSlice.includes(field));
      return generateUpdateQueries(schema, type, changedInSlice, newRow, primaryKeyField);
    };

    // Generate queries for each type of data
    const updatesNeeded = [
      ...generateQueriesFromSlice("trees", "TreeID"),
      ...generateQueriesFromSlice("stems", "StemID"),
      ...generateQueriesFromSlice("subquadrats", "SubquadratID"),
      ...generateQueriesFromSlice("quadrats", "QuadratID"),
      ...generateQueriesFromSlice("plots", "PlotID"),
    ].filter(query => query.length > 0);  // Filter out any empty query arrays

    // Execute each update query
    for (const query of updatesNeeded) {
      await runQuery(conn, query!);
    }

    await conn.commit();
    return NextResponse.json({ message: "Updates successful" }, { status: 200 });
  } catch (error: any) {
    if (conn) {
      await conn.rollback();
      console.error('Error in PATCH:', error);
      return NextResponse.json({ message: "Update failed", details: error.message }, { status: 400 });
    }
    throw error; // Re-throw the error if conn is null
  } finally {
    if (conn) conn.release();
  }
}