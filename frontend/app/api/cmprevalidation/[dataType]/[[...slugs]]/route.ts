import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Valid data types that can be validated
const VALID_DATA_TYPES = ['attributes', 'species', 'personnel', 'quadrats', 'postvalidation', 'failedmeasurements'] as const;
type ValidDataType = (typeof VALID_DATA_TYPES)[number];

function isValidDataType(dataType: string): dataType is ValidDataType {
  return VALID_DATA_TYPES.includes(dataType as ValidDataType);
}

// datatype: table name
// expecting 1) schema 2) plotID 3) plotCensusNumber
export async function GET(_request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const params = await props.params;

  // Input validation - return 400 for invalid requests
  if (!params.slugs || !params.dataType) {
    ailogger.warn('CMPRevalidation: Missing slugs or dataType');
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  const [schema, plotID, plotCensusNumber] = params.slugs;
  if (
    !schema ||
    schema === 'undefined' ||
    !plotID ||
    plotID === 'undefined' ||
    !plotCensusNumber ||
    plotCensusNumber === 'undefined' ||
    params.slugs.length !== 3
  ) {
    ailogger.warn('CMPRevalidation: Invalid slugs provided', { slugs: params.slugs });
    return new NextResponse(JSON.stringify({ error: 'Invalid parameters: expected schema, plotID, plotCensusNumber' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  // Validate dataType
  if (!isValidDataType(params.dataType)) {
    ailogger.warn(`CMPRevalidation: Invalid dataType '${params.dataType}'`);
    return new NextResponse(JSON.stringify({ error: `Invalid dataType: ${params.dataType}` }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  // Validate plotID and plotCensusNumber are numbers
  const plotIDNum = parseInt(plotID, 10);
  const plotCensusNumberNum = parseInt(plotCensusNumber, 10);
  if (isNaN(plotIDNum) || isNaN(plotCensusNumberNum)) {
    ailogger.warn('CMPRevalidation: plotID or plotCensusNumber is not a valid number', { plotID, plotCensusNumber });
    return new NextResponse(JSON.stringify({ error: 'plotID and plotCensusNumber must be numbers' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  const connection = ConnectionManager.getInstance();
  try {
    let query: string;
    let queryParams: any[];

    switch (params.dataType) {
      case 'attributes':
      case 'species':
        // Check if the table has any data
        query = safeFormatQuery(schema, `SELECT 1 FROM ??.${params.dataType} LIMIT 1`);
        queryParams = [];
        break;
      case 'personnel':
        // Personnel doesn't require validation, always passes
        return new NextResponse(null, { status: HTTPResponses.OK });
      case 'quadrats':
        query = safeFormatQuery(schema, 'SELECT 1 FROM ??.quadrats WHERE PlotID = ? LIMIT 1');
        queryParams = [plotIDNum];
        break;
      case 'postvalidation':
        query = safeFormatQuery(
          schema,
          `SELECT 1 FROM ??.coremeasurements cm
           JOIN ??.census c ON c.CensusID = cm.CensusID
           WHERE c.PlotID = ?
           AND c.PlotCensusNumber = ?
           LIMIT 1`
        );
        queryParams = [plotIDNum, plotCensusNumberNum];
        break;
      case 'failedmeasurements':
        query = safeFormatQuery(
          schema,
          `SELECT 1 FROM ??.failedmeasurements fm
           JOIN ??.census c ON c.CensusID = fm.CensusID
           WHERE fm.PlotID = ?
           AND c.PlotCensusNumber = ?
           AND c.IsActive IS TRUE
           LIMIT 1`
        );
        queryParams = [plotIDNum, plotCensusNumberNum];
        break;
      default:
        // This shouldn't be reachable due to isValidDataType check above
        return new NextResponse(JSON.stringify({ error: 'Unhandled dataType' }), {
          status: HTTPResponses.INVALID_REQUEST
        });
    }

    const results = await connection.executeQuery(query, queryParams);

    if (results.length === 0) {
      // Precondition not met - this is expected behavior, not an error
      ailogger.info(`CMPRevalidation: Precondition not met for ${params.dataType}`, {
        schema,
        plotID: plotIDNum,
        plotCensusNumber: plotCensusNumberNum
      });
      return new NextResponse(null, {
        status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE
      });
    }

    // All conditions satisfied
    return new NextResponse(null, { status: HTTPResponses.OK });
  } catch (e: any) {
    // Database errors should return 500, not 412
    ailogger.error(`CMPRevalidation database error for ${params.dataType} (${schema}/${plotID}/${plotCensusNumber}): ${e.message}`);
    return new NextResponse(JSON.stringify({ error: 'Database error during validation' }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  } finally {
    await connection.closeConnection();
  }
}
