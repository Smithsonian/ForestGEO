import { NextRequest, NextResponse } from 'next/server';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { PoolConnection } from 'mysql2/promise';
import { CMError } from '@/config/macros/uploadsystemmacros';
import { HTTPResponses } from '@/config/macros';

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
      coreMeasurementID: row.CoreMeasurementID,
      validationErrorIDs: row.ValidationErrorIDs.split(',').map(Number),
      descriptions: row.Descriptions.split(',')
    }));
    conn.release();
    return new NextResponse(
      JSON.stringify({
        failed: parsedValidationErrors
      }),
      {
        status: HTTPResponses.OK,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error: any) {
    conn?.release();
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: 500
    });
  } finally {
    if (conn) conn.release();
  }
}
