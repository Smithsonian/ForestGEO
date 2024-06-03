import { NextRequest, NextResponse } from "next/server";
import { getConn, runQuery } from "@/components/processors/processormacros";
import { PoolConnection } from "mysql2/promise";
import { CMError } from "@/config/macros/uploadsystemmacros";
import MapperFactory from "@/config/datamapper";

export async function GET(request: NextRequest) {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('No schema variable provided!');

  try {
    conn = await getConn();

    // Query to fetch existing validation errors
    const validationErrorsQuery = `
      SELECT 
          cm.CoreMeasurementID AS CoreMeasurementID, 
          GROUP_CONCAT(ve.ValidationID) AS ValidationErrorIDs,
          GROUP_CONCAT(ve.Description) AS Descriptions
      FROM 
          ${schema}.cmverrors AS cve
      JOIN 
          ${schema}.coremeasurements AS cm ON cve.CoreMeasurementID = cm.CoreMeasurementID
      JOIN 
          catalog.validationprocedures AS ve ON cve.ValidationErrorID = ve.ValidationID
      GROUP BY 
          cm.CoreMeasurementID;
    `;
    const validationErrorsRows = await runQuery(conn, validationErrorsQuery);

    const parsedValidationErrors: CMError[] = validationErrorsRows.map((row: any) => ({
      CoreMeasurementID: row.CoreMeasurementID,
      ValidationErrorIDs: row.ValidationErrorIDs.split(',').map(Number),
      Descriptions: row.Descriptions.split(',')
    }));

    // Query to fetch coremeasurements pending validation (no errors)
    const pendingValidationQuery = `
      SELECT cm.*
      FROM 
        ${schema}.coremeasurements AS cm
      LEFT JOIN 
        ${schema}.cmverrors AS cme ON cm.CoreMeasurementID = cme.CoreMeasurementID
      WHERE 
        cm.IsValidated = b'0' AND cme.CMVErrorID IS NULL;
    `;
    const pendingValidationRows = await runQuery(conn, pendingValidationQuery);
    const mapper = MapperFactory.getMapper<any, any>('coremeasurements');
    const mappedPending = mapper.mapData(pendingValidationRows);
    return new NextResponse(JSON.stringify({failed: parsedValidationErrors, pending: mappedPending}), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error: any) {
    return new NextResponse(JSON.stringify({ error: error.message }), { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}
