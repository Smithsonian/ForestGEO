import {NextResponse} from "next/server";
import {getConn, runQuery} from "@/components/processors/processormacros";
import {PoolConnection} from "mysql2/promise";

export async function GET() {
  let conn: PoolConnection | null = null;

  try {
    conn = await getConn();
    const query = `
      SELECT cm.CoreMeasurementID, ve.ValidationErrorID, ve.Description
      FROM cmverrors AS cve
      JOIN coremeasurements AS cm ON cve.CoreMeasurementID = cm.CoreMeasurementID
      JOIN validationerrors AS ve ON cve.ValidationErrorID = ve.ValidationErrorID;
    `;

    // Utilize the runQuery helper function
    const rows = await runQuery(conn, query);

    return new NextResponse(JSON.stringify(rows), {status: 200});
  } catch (error: any) {
    return new NextResponse(JSON.stringify({error: error.message}), {status: 500});
  } finally {
    if (conn) conn.release();
  }
}