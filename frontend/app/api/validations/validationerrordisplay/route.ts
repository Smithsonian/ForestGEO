import { NextRequest, NextResponse } from 'next/server';
import { CMError } from '@/config/macros/uploadsystemmacros';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { fromQuery, withRouteAuthz } from '@/lib/route-authz';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

async function handler(request: NextRequest) {
  const conn = ConnectionManager.getInstance();
  const schema = request.nextUrl.searchParams.get('schema');
  const plotIDParam = request.nextUrl.searchParams.get('plotIDParam');
  const censusPCNParam = request.nextUrl.searchParams.get('censusPCNParam');
  if (!schema) throw new Error('No schema variable provided!');

  try {
    const validationErrorsQuery = safeFormatQuery(
      schema,
      `
      SELECT
          cm.CoreMeasurementID AS CoreMeasurementID,
          GROUP_CONCAT(COALESCE(ve.ValidationID, me.ErrorID) ORDER BY COALESCE(ve.ValidationID, me.ErrorID)) AS ValidationErrorIDs,
          GROUP_CONCAT(
            COALESCE(NULLIF(ve.Description, ''), me.ErrorMessage)
            ORDER BY COALESCE(ve.ValidationID, me.ErrorID)
            SEPARATOR '||'
          ) AS Descriptions,
          GROUP_CONCAT(
            COALESCE(NULLIF(ve.Criteria, ''), CONCAT('Validation ', me.ErrorCode))
            ORDER BY COALESCE(ve.ValidationID, me.ErrorID)
            SEPARATOR '||'
          ) AS Criteria
      FROM
          ??.measurement_error_log AS cve
      JOIN
          ??.measurement_errors me ON me.ErrorID = cve.ErrorID AND me.ErrorSource = 'validation' AND cve.IsResolved = FALSE
      JOIN
          ??.coremeasurements cm ON cve.MeasurementID = cm.CoreMeasurementID
      LEFT JOIN
          ??.sitespecificvalidations AS ve ON me.ErrorCode = CAST(ve.ValidationID AS CHAR)
      JOIN ??.census c ON cm.CensusID = c.CensusID AND c.IsActive IS TRUE
      JOIN ??.plots p ON c.PlotID = p.PlotID
      WHERE p.PlotID = ? AND c.PlotCensusNumber = ?
      GROUP BY
          cm.CoreMeasurementID;
    `
    );
    const validationErrorsRows = await conn.executeQuery(validationErrorsQuery, [plotIDParam, censusPCNParam]);

    const parsedValidationErrors: CMError[] = validationErrorsRows.map((row: any) => ({
      coreMeasurementID: row.CoreMeasurementID,
      validationErrorIDs: row.ValidationErrorIDs.split(',').map(Number),
      descriptions: row.Descriptions.split('||'),
      criteria: row.Criteria.split('||')
    }));
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
    ailogger.error('Error in validation error display:', error.message, { endpoint: request.nextUrl.pathname });
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  } finally {
    await conn.closeConnection();
  }
}

export const GET = withRouteAuthz('validations/validationerrordisplay', handler, { schema: fromQuery('schema') });
