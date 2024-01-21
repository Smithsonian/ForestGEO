import {NextRequest, NextResponse} from "next/server";
import {ErrorMessages} from "@/config/macros";
import {CoreMeasurementsRDS} from "@/config/sqlmacros";
import {getSqlConnection, runQuery} from "@/components/processors/processorhelpers";
import mysql, {PoolConnection} from "mysql2/promise";

export async function GET(): Promise<NextResponse<CoreMeasurementsRDS[]>> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) {
    throw new Error("Environmental variable extraction for schema failed");
  }
  let conn: PoolConnection | null = null;
  try {
    // Initialize the connection attempt counter
    let attempt = 0;
    conn = await getSqlConnection(attempt);

    // Run the query and get the results
    const results = await runQuery(conn, `SELECT * FROM ${schema}.CoreMeasurements`);
    // Map the results to CoreMeasurementsRDS structure
    let coreMeasurementRows: CoreMeasurementsRDS[] = results.map((row, index) => ({
      id: index + 1,
      coreMeasurementID: row.CoreMeasurementID,
      censusID: row.CensusID,
      plotID: row.PlotID,
      quadratID: row.QuadratID,
      treeID: row.TreeID,
      stemID: row.StemID,
      personnelID: row.PersonnelID,
      measurementTypeID: row.MeasurementTypeID,
      measurementDate: row.MeasurementDate,
      measurement: row.Measurement,
      isRemeasurement: row.IsRemeasurement,
      isCurrent: row.IsCurrent,
      userDefinedFields: row.UserDefinedFields,
      masterMeasurementID: row.MasterMeasurementID,
      // ... other fields as needed
    }));

    return new NextResponse(JSON.stringify(coreMeasurementRows), { status: 200 });
  } catch (error: any) {
    throw new Error('SQL query failed: ' + error.message);
  } finally {
    // Release the connection back to the pool if it was established
    if (conn) conn.release();
  }
}

export async function POST(request: NextRequest) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("environmental variable extraction for schema failed");

  let conn;
  try {
    // Parse the request body
    const requestBody = await request.json();

    // Validate and map the request body to match the CoreMeasurements table structure
    const newRowData = {
      CensusID: requestBody.censusID ?? null,
      PlotID: requestBody.plotID ?? null,
      QuadratID: requestBody.quadratID ?? null,
      TreeID: requestBody.treeID ?? null,
      StemID: requestBody.stemID ?? null,
      PersonnelID: requestBody.personnelID ?? null,
      MeasurementTypeID: requestBody.measurementTypeID ?? null,
      MeasurementDate: requestBody.measurementDate ?? null,
      Measurement: requestBody.measurement ?? null,
      IsRemeasurement: requestBody.isRemeasurement ?? null,
      IsCurrent: requestBody.isCurrent ?? null,
      UserDefinedFields: requestBody.userDefinedFields ?? null,
      Description: requestBody.description ?? null,
      MasterMeasurementID: requestBody.masterMeasurementID ?? null,
    };
    conn = await getSqlConnection(0);
    // Insert the new row
    const insertQuery = mysql.format('INSERT INTO ?? SET ?', [`${schema}.CoreMeasurements`, newRowData]);
    await runQuery(conn, insertQuery);

    return NextResponse.json({ message: "Insert successful" }, { status: 200 });
  } catch (error: any) {
    console.error('Error in POST operation:', error.message);
    return NextResponse.json({ message: ErrorMessages.ICF }, { status: 400 });
  } finally {
    if (conn) conn.release();
  }
}


export async function PATCH(request: NextRequest) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("environmental variable extraction for schema failed");
  let conn;
  try {
    const requestBody = await request.json();
    // Extract the CoreMeasurementID from the request body
    const coreMeasurementID = requestBody.coreMeasurementID;
    // Create an object containing the fields to update
    const updateData = {
      CensusID: requestBody.censusID ?? null,
      PlotID: requestBody.plotID ?? null,
      QuadratID: requestBody.quadratID ?? null,
      TreeID: requestBody.treeID ?? null,
      StemID: requestBody.stemID ?? null,
      PersonnelID: requestBody.personnelID ?? null,
      MeasurementTypeID: requestBody.measurementTypeID ?? null,
      MeasurementDate: requestBody.measurementDate ? new Date(requestBody.measurementDate) : null,
      Measurement: requestBody.measurement ?? null,
      IsRemeasurement: requestBody.isRemeasurement ?? null,
      IsCurrent: requestBody.isCurrent ?? null,
      UserDefinedFields: requestBody.userDefinedFields || null,
      MasterMeasurementID: requestBody.masterMeasurementID ?? null,
    };
    conn = await getSqlConnection(0);
    // Build the update query
    const updateQuery = mysql.format('UPDATE ?? SET ? WHERE CoreMeasurementID = ?', [`${schema}.CoreMeasurements`, updateData, coreMeasurementID]);
    await runQuery(conn, updateQuery);

    return NextResponse.json({ message: "Update successful" }, { status: 200 });
  } catch (error: any) {
    console.error('Error in PATCH operation:', error.message);
    return NextResponse.json({ message: ErrorMessages.UCF }, { status: 400 });
  } finally {
    if (conn) conn.release();
  }
}