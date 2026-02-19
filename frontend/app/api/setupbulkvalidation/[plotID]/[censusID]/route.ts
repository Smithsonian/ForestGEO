import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { getSchemaCapabilities } from '@/config/utils/schemacapabilities';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{ plotID: string; censusID: string }>;
  }
) {
  const schema = request.nextUrl.searchParams.get('schema');
  const { plotID, censusID } = await props.params;

  if (!schema || !plotID || !censusID) {
    return new NextResponse(JSON.stringify({ error: 'Missing parameters' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  let validationSQL: string;
  try {
    const { hasValidateMeasurements } = await getSchemaCapabilities(schema);

    if (hasValidateMeasurements) {
      validationSQL = safeFormatQuery(schema, 'CALL ??.validate_measurements(?, ?)');
    } else {
      // Inline fallback: stamps IsValidated based on existing cmverrors rows
      validationSQL = safeFormatQuery(
        schema,
        `UPDATE ??.coremeasurements cm
           JOIN ??.census c ON cm.CensusID = c.CensusID
           LEFT JOIN (
             SELECT DISTINCT CoreMeasurementID FROM ??.cmverrors
           ) errs ON errs.CoreMeasurementID = cm.CoreMeasurementID
         SET cm.IsValidated = IF(errs.CoreMeasurementID IS NULL, 1, 0)
         WHERE cm.CensusID = ?
           AND c.PlotID = ?
           AND cm.IsActive = 1`
      );
    }
  } catch (error: any) {
    ailogger.error(`Invalid schema in setupbulkvalidation: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    await connectionManager.executeQuery(validationSQL, [censusID, plotID]);
    return new NextResponse(JSON.stringify({ responseMessage: 'Validation status updated' }), { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Error running validation:', error);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
