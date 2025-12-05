import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { format } from 'mysql2/promise';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Whitelist of allowed data types for this route
const ALLOWED_DATA_TYPES = ['attributes', 'species', 'personnel', 'quadrats', 'postvalidation', 'failedmeasurements'] as const;
type AllowedDataType = (typeof ALLOWED_DATA_TYPES)[number];

function isValidDataType(dataType: string): dataType is AllowedDataType {
  return ALLOWED_DATA_TYPES.includes(dataType as AllowedDataType);
}

// datatype: table name
// expecting 1) schema 2) plotID 3) plotCensusNumber
export async function GET(_request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const params = await props.params;

  // Validate required parameters exist
  if (!params.slugs || !params.dataType) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  const [schema, plotIDStr, plotCensusNumberStr] = params.slugs;

  // Validate slug count and values
  if (
    !schema ||
    schema === 'undefined' ||
    !plotIDStr ||
    plotIDStr === 'undefined' ||
    !plotCensusNumberStr ||
    plotCensusNumberStr === 'undefined' ||
    params.slugs.length !== 3
  ) {
    return new NextResponse(JSON.stringify({ error: 'Invalid or missing slug parameters' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  // SECURITY: Validate schema against whitelist to prevent SQL injection
  if (!isValidSchema(schema)) {
    ailogger.error(`[cmprevalidation API] Invalid schema provided: ${schema}`);
    return new NextResponse(JSON.stringify({ error: 'Invalid schema' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  // SECURITY: Validate dataType against whitelist
  if (!isValidDataType(params.dataType)) {
    ailogger.error(`[cmprevalidation API] Invalid dataType provided: ${params.dataType}`);
    return new NextResponse(JSON.stringify({ error: 'Invalid data type' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  // Parse and validate numeric parameters
  const plotID = parseInt(plotIDStr, 10);
  const plotCensusNumber = parseInt(plotCensusNumberStr, 10);

  if (isNaN(plotID) || plotID <= 0 || isNaN(plotCensusNumber) || plotCensusNumber <= 0) {
    return new NextResponse(JSON.stringify({ error: 'Invalid numeric parameters' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  const connection = ConnectionManager.getInstance();
  try {
    let query: string;
    let queryParams: any[];

    switch (params.dataType) {
      case 'attributes':
      case 'species': {
        // Use backtick-escaped identifiers for schema/table (already validated)
        const baseQuery = `SELECT 1 FROM \`${schema}\`.\`${params.dataType}\` dt LIMIT 1`;
        const baseResults = await connection.executeQuery(baseQuery);
        if (baseResults.length === 0) {
          return new NextResponse(null, {
            status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE
          });
        }
        break;
      }
      case 'personnel':
        // Personnel check passes without query
        break;
      case 'quadrats': {
        // Use parameterized query for user-provided values
        const query = format(`SELECT 1 FROM \`${schema}\`.quadrats q WHERE q.PlotID = ? LIMIT 1`, [plotID]);
        const results = await connection.executeQuery(query);
        if (results.length === 0) {
          return new NextResponse(null, {
            status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE
          });
        }
        break;
      }
      case 'postvalidation': {
        // Use parameterized query for all user-provided values
        const pvQuery = format(
          `SELECT 1 FROM \`${schema}\`.coremeasurements cm
           JOIN \`${schema}\`.census c ON c.CensusID = cm.CensusID
           JOIN \`${schema}\`.plots p ON p.PlotID = c.PlotID
           WHERE p.PlotID = ?
           AND c.CensusID IN (
             SELECT CensusID FROM \`${schema}\`.census
             WHERE PlotID = ? AND PlotCensusNumber = ?
           ) LIMIT 1`,
          [plotID, plotID, plotCensusNumber]
        );
        const pvResults = await connection.executeQuery(pvQuery);
        if (pvResults.length === 0) {
          return new NextResponse(null, {
            status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE
          });
        }
        break;
      }
      case 'failedmeasurements': {
        // Use parameterized query for all user-provided values
        const fmQuery = format(
          `SELECT 1 FROM \`${schema}\`.failedmeasurements fm
           JOIN \`${schema}\`.census c ON c.CensusID = fm.CensusID
           WHERE fm.PlotID = ? AND c.PlotCensusNumber = ? AND c.IsActive IS TRUE LIMIT 1`,
          [plotID, plotCensusNumber]
        );
        const fmResults = await connection.executeQuery(fmQuery);
        if (fmResults.length === 0) {
          return new NextResponse(null, {
            status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE
          });
        }
        break;
      }
      default:
        // This should never be reached due to isValidDataType check above
        return new NextResponse(null, {
          status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE
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
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e));
    ailogger.error('[cmprevalidation API] Error:', error);
    return new NextResponse(null, {
      status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE
    });
  } finally {
    await connection.closeConnection();
  }
}
