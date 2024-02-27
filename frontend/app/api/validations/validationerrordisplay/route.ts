import {NextResponse} from "next/server";
import {getConn, getSchema, runQuery} from "@/components/processors/processormacros";
import {PoolConnection} from "mysql2/promise";
import {CMError} from "@/config/macros";
export async function GET() {
  let conn: PoolConnection | null = null;

  try {
    const schema = getSchema();
    conn = await getConn();
    const query = `
      SELECT cm.CoreMeasurementID As CoreMeasurementID, ve.ValidationErrorID as ValidationErrorID, ve.ValidationErrorDescription as Description
      FROM ${schema}.cmverrors AS cve
      JOIN ${schema}.coremeasurements AS cm ON cve.CoreMeasurementID = cm.CoreMeasurementID
      JOIN ${schema}.validationerrors AS ve ON cve.ValidationErrorID = ve.ValidationErrorID;
    `;

    // Utilize the runQuery helper function
    const rows = await runQuery(conn, query);

    const parsedRows: CMError[] = rows.map((row: any) => ({
      CoreMeasurementID: row.CoreMeasurementID,
      ValidationErrorID: row.ValidationErrorID,
      Description: row.Description,
    }));
    return new NextResponse(JSON.stringify(parsedRows), {status: 200, headers: {
        'Content-Type': 'application/json'
      }});
  } catch (error: any) {
    return new NextResponse(JSON.stringify({error: error.message}), {status: 500});
  } finally {
    if (conn) conn.release();
  }
}