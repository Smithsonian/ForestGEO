import {NextRequest, NextResponse} from "next/server";
import {getConn, runQuery} from "@/components/processors/processormacros";
import {PoolConnection} from "mysql2/promise";
import {CMError} from "@/config/macros/uploadsystemmacros";

export async function GET(request: NextRequest) {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  try {
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
      ValidationErrorIDs: row.ValidationErrorIDs.split(',').map(Number),
      Descriptions: row.Descriptions.split(',')
    }));
    return new NextResponse(JSON.stringify(parsedRows), {
      status: 200, headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error: any) {
    return new NextResponse(JSON.stringify({error: error.message}), {status: 500});
  } finally {
    if (conn) conn.release();
  }
}