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
      SELECT 
          cm.CoreMeasurementID AS CoreMeasurementID, 
          GROUP_CONCAT(ve.ValidationErrorID) AS ValidationErrorIDs,
          GROUP_CONCAT(ve.ValidationErrorDescription) AS Descriptions
      FROM 
          ${schema}.cmverrors AS cve
      JOIN 
          ${schema}.coremeasurements AS cm ON cve.CoreMeasurementID = cm.CoreMeasurementID
      JOIN 
          ${schema}.validationerrors AS ve ON cve.ValidationErrorID = ve.ValidationErrorID
      GROUP BY 
          cm.CoreMeasurementID;`;
    // Utilize the runQuery helper function
    const rows = await runQuery(conn, query);

    const parsedRows: CMError[] = rows.map((row: any) => ({
      CoreMeasurementID: row.CoreMeasurementID,
      ValidationErrorIDs: row.ValidationErrorIDs,
      Descriptions: row.Descriptions,
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