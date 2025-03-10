import { NextRequest, NextResponse } from 'next/server';
import { CMError } from '@/config/macros/uploadsystemmacros';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';

export async function GET(request: NextRequest) {
  const conn = ConnectionManager.getInstance();
  const schema = request.nextUrl.searchParams.get('schema');
  const plotIDParam = request.nextUrl.searchParams.get('plotIDParam');
  const censusPCNParam = request.nextUrl.searchParams.get('censusPCNParam');
  if (!schema) throw new Error('No schema variable provided!');

  let transactionID: string | undefined = undefined;

  try {
    transactionID = await conn.beginTransaction();
    // Query to fetch existing validation errors
    const validationErrorsQuery = `
      SELECT 
          cm.CoreMeasurementID AS CoreMeasurementID, 
          GROUP_CONCAT(ve.ValidationID) AS ValidationErrorIDs,
          GROUP_CONCAT(ve.Description) AS Descriptions,
          GROUP_CONCAT(ve.Criteria) AS Criteria
      FROM 
          ${schema}.cmverrors AS cve
      JOIN 
          ${schema}.coremeasurements AS cm ON cve.CoreMeasurementID = cm.CoreMeasurementID
      JOIN 
          ${schema}.sitespecificvalidations AS ve ON cve.ValidationErrorID = ve.ValidationID
      GROUP BY 
          cm.CoreMeasurementID;
    `;
    const validationErrorsRows = await conn.executeQuery(validationErrorsQuery);

    const parsedValidationErrors: CMError[] = validationErrorsRows.map((row: any) => ({
      coreMeasurementID: row.CoreMeasurementID,
      validationErrorIDs: row.ValidationErrorIDs.split(',').map(Number),
      descriptions: row.Descriptions.split(','),
      criteria: row.Criteria.split(',')
    }));
    await conn.commitTransaction(transactionID ?? '');
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
    await conn.rollbackTransaction(transactionID ?? '');
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: 500
    });
  } finally {
    await conn.closeConnection();
  }
}
