import { NextRequest, NextResponse } from "next/server";
import { ErrorMessages, HTTPResponses } from "@/config/macros";
import { CensusRDS } from "@/config/sqlmacros";
import { getSqlConnection, runQuery } from "@/components/processors/processorhelpers";
import mysql, { PoolConnection } from "mysql2/promise";

export async function GET(): Promise<NextResponse<CensusRDS[]>> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn: PoolConnection | null = null;
  try {
    conn = await getSqlConnection(0); // Utilize the retry mechanism effectively

    const results = await runQuery(conn, `SELECT * FROM ${schema}.Census`);
    if (!results) throw new Error("Call failed");

    // Map the results to CensusRDS structure
    const censusRows: CensusRDS[] = results.map((row, index) => ({
      id: index + 1,
      censusID: row.CensusID,
      plotID: row.PlotID,
      plotCensusNumber: row.PlotCensusNumber,
      startDate: row.StartDate,
      endDate: row.EndDate,
      description: row.Description,
      // ... other fields as needed
    }));

    return new NextResponse(JSON.stringify(censusRows), { status: HTTPResponses.OK });
  } catch (error) {
    console.error('Error in GET:', error);
    throw new Error('Failed to fetch census data'); // Providing a more user-friendly error message
  } finally {
    if (conn) conn.release(); // Release the connection
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn: PoolConnection | null = null;

  try {
    conn = await getSqlConnection(0);
    const requestBody = await request.json();

    const row = {
      PlotID: requestBody.plotID ?? null,
      PlotCensusNumber: requestBody.plotCensusNumber ?? null,
      StartDate: new Date(requestBody.startDate) ?? null,
      EndDate: new Date(requestBody.endDate) ?? null,
      Description: requestBody.description ?? null,
    };

    const insertQuery = mysql.format('INSERT INTO ?? SET ?', [`${schema}.Census`, row]);
    await runQuery(conn, insertQuery);
    return NextResponse.json({ message: "Insert successful" }, { status: 200 });
  } catch (error) {
    console.error('Error in POST:', error);
    return NextResponse.json({ message: ErrorMessages.ICF }, { status: 400 });
  } finally {
    if (conn) conn.release(); // Release the connection
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("Environmental variable extraction for schema failed");

  let conn: PoolConnection | null = null;

  try {
    conn = await getSqlConnection(0);

    const deleteID = parseInt(request.nextUrl.searchParams.get('censusID')!);
    if (isNaN(deleteID)) {
      return NextResponse.json({ message: "Invalid censusID parameter" }, { status: 400 });
    }

    const deleteQuery = `DELETE FROM ${schema}.Census WHERE CensusID = ?`;
    await runQuery(conn, deleteQuery, [deleteID]);

    return NextResponse.json({ message: "Delete successful" }, { status: HTTPResponses.OK });
  } catch (error) {
    console.error('Error in DELETE:', error);
    return NextResponse.json({ message: ErrorMessages.DCF }, { status: 400 });
  } finally {
    if (conn) conn.release(); // Release the connection
  }
}

export async function PATCH(request: NextRequest) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("environmental variable extraction for schema failed");
  let conn: PoolConnection | null = null;

  try {
    const requestBody = await request.json();
    const censusID = requestBody.censusID;
    const updateData = {
      PlotID: requestBody.plotID ?? null,
      PlotCensusNumber: requestBody.plotCensusNumber ?? null,
      StartDate: new Date(requestBody.startDate),
      EndDate: new Date(requestBody.endDate),
      Description: requestBody.description ?? null,
    }
    conn = await getSqlConnection(0);

    const updateQuery = mysql.format('UPDATE ?? SET ? WHERE CensusID = ?', [`${schema}.Census`, updateData, censusID]);
    await runQuery(conn, updateQuery);

    return NextResponse.json({ message: "Update successful" }, { status: HTTPResponses.OK });
  } catch (error) {
    console.error('Error in PATCH:', error);
    return NextResponse.json({ message: ErrorMessages.UCF }, { status: 400 });
  } finally {
    if (conn) conn.release(); // Release the connection
  }
}
