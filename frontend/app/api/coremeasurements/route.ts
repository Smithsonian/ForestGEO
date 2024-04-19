// CORE MEASUREMENTS ROUTE HANDLERS
import {NextRequest, NextResponse} from "next/server";
import {bitToBoolean, ErrorMessages} from "@/config/macros";
import {CoreMeasurementsRDS, CoreMeasurementsResult} from '@/config/sqlrdsdefinitions/coremeasurementsrds';
import {getConn, parseCoreMeasurementsRequestBody, runQuery} from "@/components/processors/processormacros";
import mysql, {PoolConnection} from "mysql2/promise";


export async function GET(request: NextRequest): Promise<NextResponse<{
  coreMeasurements: CoreMeasurementsRDS[],
  totalCount: number
}>> {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('Schema to connect to was not provided!');
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
      SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.coremeasurements
      WHERE PlotID = ?
      LIMIT ?, ?
      `;
      queryParams = [plotID, startRow, pageSize];
    } else {
      paginatedQuery = `
      SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.coremeasurements
      LIMIT ?, ?
    `;
      queryParams = [startRow, pageSize];
    }
    const paginatedResults = await runQuery(conn, paginatedQuery, queryParams.map(param => param.toString()));

    // Query to get the total count of rows
    const totalRowsQuery = "SELECT FOUND_ROWS() as totalRows";
    const totalRowsResult = await runQuery(conn, totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;
    // Map the results to CoreMeasurementsRDS structure
    let coreMeasurementRows: CoreMeasurementsRDS[] = paginatedResults.map((row: CoreMeasurementsResult, index: number) => ({
      // ... mapping fields ...
      id: index + 1,
      coreMeasurementID: row.CoreMeasurementID,
      censusID: row.CensusID,
      plotID: row.PlotID,
      quadratID: row.QuadratID,
      treeID: row.TreeID,
      stemID: row.StemID,
      personnelID: row.PersonnelID,
      isValidated: bitToBoolean(row.IsValidated),
      measurementDate: row.MeasurementDate,
      measuredDBH: row.MeasuredDBH,
      measuredHOM: row.MeasuredHOM,
      description: row.Description,
      userDefinedFields: row.UserDefinedFields,
      // ... other fields as needed
    }));

    return new NextResponse(JSON.stringify({
      coreMeasurements: coreMeasurementRows,
      totalCount: totalRows
    }), {status: 200});
  } catch (error: any) {
    throw new Error('SQL query failed: ' + error.message);
  } finally {
    // Release the connection back to the pool if it was established
    if (conn) conn.release();
  }
}

export async function POST(request: NextRequest) {
  let conn;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    // Parse the request body
    const {CoreMeasurementID, ...newRowData} = await parseCoreMeasurementsRequestBody(request);
    conn = await getConn();
    // Insert the new row
    const insertQuery = mysql.format('INSERT INTO ?? SET ?', [`${schema}.coremeasurements`, newRowData]);
    await runQuery(conn, insertQuery);

    return NextResponse.json({message: "Insert successful"}, {status: 200});
  } catch (error: any) {
    console.error('Error in POST operation:', error.message);
    return NextResponse.json({message: ErrorMessages.ICF}, {status: 400});
  } finally {
    if (conn) conn.release();
  }
}


export async function PATCH(request: NextRequest) {
  let conn;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    const {CoreMeasurementID, ...updateData} = await parseCoreMeasurementsRequestBody(request);
    conn = await getConn();
    // Build the update query
    const updateQuery = mysql.format('UPDATE ?? SET ? WHERE CoreMeasurementID = ?', [`${schema}.coremeasurements`, updateData, CoreMeasurementID]);
    await runQuery(conn, updateQuery);

    return NextResponse.json({message: "Update successful"}, {status: 200});
  } catch (error: any) {
    console.error('Error in PATCH operation:', error.message);
    return NextResponse.json({message: ErrorMessages.UCF}, {status: 400});
  } finally {
    if (conn) conn.release();
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  let conn: PoolConnection | null = null;
  const deleteCode = request.nextUrl.searchParams.get('coreMeasurementID');
  if (!deleteCode) {
    return new NextResponse(JSON.stringify({message: "coremeasurementID is required"}), {status: 400});
  }
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
    conn = await getConn();
    await runQuery(conn, `SET foreign_key_checks = 0;`, []);
    const deleteQuery = `DELETE FROM ${schema}.coremeasurements WHERE CoreMeasurementID = ?`;
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