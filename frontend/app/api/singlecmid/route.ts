import {NextRequest, NextResponse} from "next/server";
import {CoreMeasurementsResult, getConn, getSchema, runQuery} from "@/components/processors/processormacros";
import {PoolConnection} from "mysql2/promise";
import {CoreMeasurementsRDS} from "@/config/sqlmacros";
import {bitToBoolean} from "@/config/macros";

export async function GET(request: NextRequest) {
  const schema = getSchema();
  const cmID = parseInt(request.nextUrl.searchParams.get('cmid')!);
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    let query = `SELECT * FROM ${schema}.CoreMeasurements WHERE CoreMeasurementID = ? LIMIT 1`;
    const results = await runQuery(conn, query, [cmID]);
    if (results.length > 1) throw new Error('Attempting to select a single ')
    let coreMeasurementRows: CoreMeasurementsRDS[] = results.map((row: CoreMeasurementsResult, index: number) => ({
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

    return new NextResponse(JSON.stringify(coreMeasurementRows), {status: 200});
  } catch(error: any) {
    throw new Error('SQL query failed: ' + error.message);
  } finally {
    if (conn) conn.release();
  }
}