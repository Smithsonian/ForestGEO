import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';
import { isValidSchema, safeFormatQuery } from '@/lib/db/sqlsecurity';
import { format } from 'mysql2/promise';
import { fromPathSegment, type RouteContext, withRouteAuthz } from '@/lib/route-authz';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Whitelist of allowed data types for this route
const ALLOWED_DATA_TYPES = ['attributes', 'species', 'personnel', 'quadrats', 'postvalidation', 'failedmeasurements'] as const;
type AllowedDataType = (typeof ALLOWED_DATA_TYPES)[number];

function isValidDataType(dataType: string): dataType is AllowedDataType {
  return ALLOWED_DATA_TYPES.includes(dataType as AllowedDataType);
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value || value === 'undefined') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed;
}

// datatype: table name
// expecting 1) schema 2) plotID 3) plotCensusNumber
async function getHandler(_request: NextRequest, context: RouteContext) {
  const params = (await context.params) as { dataType: string; slugs?: string[] };

  // Validate required parameters exist
  if (!params.slugs || !params.dataType) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  const [schema, plotIDStr, plotCensusNumberStr] = params.slugs;

  // Census-independent data types only need schema + plotID
  const censusIndependentTypes = ['attributes', 'species', 'quadrats'];
  const needsCensus = !censusIndependentTypes.includes(params.dataType);

  // Validate slug count and values
  if (!schema || schema === 'undefined' || !plotIDStr || plotIDStr === 'undefined') {
    return new NextResponse(JSON.stringify({ error: 'Invalid or missing slug parameters' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  if (needsCensus && (!plotCensusNumberStr || plotCensusNumberStr === 'undefined')) {
    return new NextResponse(JSON.stringify({ error: 'Census number required for this data type' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  // defense-in-depth: withRouteAuthz already validated schema membership before
  // this handler ran; this whitelist check stays as a redundant guard on the
  // schema identifier routed through safeFormatQuery below.
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
  const plotID = parsePositiveInt(plotIDStr);
  const plotCensusNumber = parsePositiveInt(plotCensusNumberStr);

  if (!plotID || (needsCensus && !plotCensusNumber)) {
    return new NextResponse(JSON.stringify({ error: 'Invalid numeric parameters' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  const connection = ConnectionManager.getInstance();
  try {
    switch (params.dataType) {
      case 'attributes':
      case 'species': {
        // Schema routed through safeFormatQuery (?? -> escaped identifier); dataType is
        // whitelisted by isValidDataType above so it is safe to interpolate directly.
        const baseQuery = safeFormatQuery(schema, `SELECT 1 FROM ??.\`${params.dataType}\` dt LIMIT 1`);
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
        // Schema routed through safeFormatQuery; user-provided PlotID stays parameterized.
        const query = format(safeFormatQuery(schema, `SELECT 1 FROM ??.quadrats q WHERE q.PlotID = ? LIMIT 1`), [plotID]);
        const results = await connection.executeQuery(query);
        if (results.length === 0) {
          return new NextResponse(null, {
            status: HTTPResponses.PRECONDITION_VALIDATION_FAILURE
          });
        }
        break;
      }
      case 'postvalidation': {
        // Schema routed through safeFormatQuery (?? -> escaped identifier); all
        // user-provided values stay parameterized.
        const pvQuery = format(
          safeFormatQuery(
            schema,
            `SELECT 1 FROM ??.coremeasurements cm
           JOIN ??.census c ON c.CensusID = cm.CensusID
           JOIN ??.plots p ON p.PlotID = c.PlotID
           WHERE p.PlotID = ?
           AND c.CensusID IN (
             SELECT CensusID FROM ??.census
             WHERE PlotID = ? AND PlotCensusNumber = ?
           ) LIMIT 1`
          ),
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
        // Schema routed through safeFormatQuery (?? -> escaped identifier); all
        // user-provided values stay parameterized.
        const fmQuery = format(
          safeFormatQuery(
            schema,
            `SELECT 1
           FROM ??.coremeasurements cm
           JOIN ??.census c ON c.CensusID = cm.CensusID
           JOIN ??.measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
           JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
           WHERE c.PlotID = ?
             AND c.PlotCensusNumber = ?
             AND c.IsActive IS TRUE
             AND cm.StemGUID IS NULL
             AND mel.IsResolved = FALSE
             AND me.ErrorSource = 'ingestion'
           LIMIT 1`
          ),
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
    // If all conditions are satisfied
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

export const GET = withRouteAuthz('cmprevalidation/[dataType]/[[...slugs]]', getHandler, { schema: fromPathSegment('slugs', 0) });
