import { NextRequest, NextResponse } from "next/server";
import { getConn, runQuery } from "@/components/processors/processormacros";
import { PoolConnection } from "mysql2/promise";
import { CMError } from "@/config/macros/uploadsystemmacros";

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
          GROUP_CONCAT(ve.ValidationErrorID) AS ValidationErrorIDs,
          GROUP_CONCAT(ve.ValidationErrorDescription) AS Descriptions
      FROM 
          ${schema}.cmverrors AS cve
      JOIN 
          ${schema}.coremeasurements AS cm ON cve.CoreMeasurementID = cm.CoreMeasurementID
      JOIN 
          ${schema}.validationerrors AS ve ON cve.ValidationErrorID = ve.ValidationErrorID
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
      SELECT 
        cm.CoreMeasurementID,
        cm.CensusID,
        cm.PlotID,
        cm.QuadratID,
        cm.SubQuadratID,
        cm.TreeID,
        cm.StemID,
        cm.PersonnelID,
        cm.MeasurementDate,
        cm.MeasuredDBH,
        cm.DBHUnit,
        cm.MeasuredHOM,
        cm.HOMUnit,
        cm.Description
      FROM 
        ${schema}.coremeasurements AS cm
      LEFT JOIN 
        ${schema}.cmverrors AS cme ON cm.CoreMeasurementID = cme.CoreMeasurementID
      WHERE 
        cm.IsValidated = b'0' AND cme.CMErrorID IS NULL;
    `;
    const pendingValidationRows = await runQuery(conn, pendingValidationQuery);

    return new NextResponse(JSON.stringify({failed: parsedValidationErrors, pending: pendingValidationRows}), {
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
