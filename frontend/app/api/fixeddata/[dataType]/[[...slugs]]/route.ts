import MapperFactory from '@/config/datamapper';
import { format } from 'mysql2/promise';
import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/lib/db/connectionmanager';
import { getGridID } from '@/config/servergridhelpers';
import { isValidSchema, safeFormatQuery } from '@/lib/db/sqlsecurity';
import ailogger from '@/ailogger';
import { buildFailedMeasurementsSelectQuery } from '@/config/measurementerrors';
import { DELETE as coreApiDelete, PATCH as coreApiPatch, POST as coreApiPost } from '@/config/macros/coreapifunctions';
import { fromPathSegment, type RouteContext, withRouteAuthz } from '@/lib/route-authz';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Shape of the resolved catch-all params for this slug route; the re-exported
// coreapifunctions CRUD handlers expect exactly this props shape.
type SlugRouteProps = { params: Promise<{ dataType: string; slugs?: string[] }> };
const ROUTE_KEY = 'fixeddata/[dataType]/[[...slugs]]';

// Valid data types that can be queried via this endpoint
const VALID_DATA_TYPES = [
  'sitesspecificvalidations',
  'specieslimits',
  'unifiedchangelog',
  'failedmeasurements',
  'viewfulltable',
  'attributes',
  'species',
  'quadrats',
  'personnel',
  'alltaxonomiesview',
  'stemtaxonomiesview',
  'stems',
  'roles',
  'census'
] as const;

type ValidDataType = (typeof VALID_DATA_TYPES)[number];

function isValidDataType(dataType: string): dataType is ValidDataType {
  return VALID_DATA_TYPES.includes(dataType as ValidDataType);
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  if (!value || value === 'undefined') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed;
}

// slugs SHOULD CONTAIN AT MINIMUM: schema, page, pageSize, plotID, plotCensusNumber, (optional) quadratID, (optional) speciesID
async function getHandler(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{ output: any[]; deprecated?: any[]; totalCount: number; finishedQuery: string } | { error: string }>> {
  const params = (await context.params) as { dataType: string; slugs?: string[] };

  // Validate slugs parameter — minimum 3 (schema, page, pageSize); plotID and plotCensusNumber are optional
  if (!params.slugs || params.slugs.length < 3) {
    return new NextResponse(JSON.stringify({ error: 'Invalid parameters: expected at least 3 slug values (schema, page, pageSize)' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  const [schema, pageParam, pageSizeParam, plotIDParam, plotCensusNumberParam, speciesIDParam] = params.slugs;

  if (!schema || schema === 'undefined' || !pageParam || pageParam === 'undefined' || !pageSizeParam || pageSizeParam === 'undefined') {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters: schema, page, and pageSize' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  // defense-in-depth: withRouteAuthz already validated schema membership before
  // this handler ran; this whitelist check stays as a redundant guard on the
  // schema identifiers routed through safeFormatQuery below.
  if (!isValidSchema(schema)) {
    ailogger.warn(`Invalid schema attempted in fixeddata: ${schema}`);
    return new NextResponse(JSON.stringify({ error: 'Invalid schema' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // Validate dataType against whitelist
  if (!params.dataType || !isValidDataType(params.dataType)) {
    ailogger.warn(`Invalid data type attempted in fixeddata: ${params.dataType}`);
    return new NextResponse(JSON.stringify({ error: 'Invalid data type' }), { status: HTTPResponses.INVALID_REQUEST });
  }
  const page = parseInt(pageParam);
  const pageSize = parseInt(pageSizeParam);
  const plotID = parseOptionalPositiveInt(plotIDParam);
  const plotCensusNumber = parseOptionalPositiveInt(plotCensusNumberParam);
  const speciesID = parseOptionalPositiveInt(speciesIDParam);

  const pkRaw = getGridID(params.dataType);
  const demappedGridID = pkRaw.charAt(0).toUpperCase() + pkRaw.substring(1);

  const connectionManager = ConnectionManager.getInstance();
  try {
    let paginatedQuery = ``;
    const queryParams: any[] = [];

    switch (params.dataType) {
      case 'sitesspecificvalidations':
        paginatedQuery = `
          SELECT SQL_CALC_FOUND_ROWS * 
          FROM ??.sitespecificvalidations LIMIT ?, ?;`; // validation procedures is special
        queryParams.push(page * pageSize, pageSize);
        break;
      case 'specieslimits':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS pdt.* FROM ??.${params.dataType} pdt WHERE pdt.SpeciesID = ? AND pdt.IsActive IS TRUE LIMIT ?, ?`;
        queryParams.push(speciesID, page * pageSize, pageSize);
        break;
      case 'unifiedchangelog':
        paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS uc.* FROM ??.${params.dataType} uc
            LEFT JOIN ??.plots p ON uc.PlotID = p.PlotID
            LEFT JOIN ??.census c ON uc.CensusID = c.CensusID AND c.IsActive IS TRUE
            WHERE (uc.PlotID = ? OR uc.PlotID IS NULL)
              AND (c.PlotID = ? AND c.PlotCensusNumber = ? OR uc.CensusID IS NULL)
            ORDER BY uc.ChangeTimestamp DESC
            LIMIT ?, ?;`;
        queryParams.push(plotID, plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'failedmeasurements':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS fm.*
          FROM (${buildFailedMeasurementsSelectQuery(schema)}) fm
          JOIN ??.census c ON fm.CensusID = c.CensusID AND c.IsActive IS TRUE
          WHERE fm.PlotID = ?
            AND c.PlotID = ?
            AND c.PlotCensusNumber = ? LIMIT ?, ?;`;
        queryParams.push(plotID, plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'viewfulltable':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS * FROM ??.${params.dataType} WHERE PlotID = ? AND PlotCensusNumber = ? ORDER BY CoreMeasurementID ASC LIMIT ?, ?`;
        queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'attributes':
      case 'species':
      case 'quadrats':
        paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS dt.*
              FROM ??.${params.dataType} dt
            ORDER BY dt.${demappedGridID} ASC LIMIT ?, ?;`;
        queryParams.push(page * pageSize, pageSize);
        break;
      case 'personnel':
        if (plotCensusNumber !== undefined && plotID !== undefined) {
          paginatedQuery = `
              SELECT SQL_CALC_FOUND_ROWS p.*, EXISTS(
                SELECT 1 FROM ??.censusactivepersonnel cap
                  JOIN ??.census c ON cap.CensusID = c.CensusID
                  WHERE cap.PersonnelID = p.PersonnelID
                    AND c.PlotCensusNumber = ? and c.PlotID = ?
                ) AS CensusActive
              FROM ??.${params.dataType} p
              ORDER BY p.${demappedGridID} ASC LIMIT ?, ?;`;
          queryParams.push(plotCensusNumber, plotID, page * pageSize, pageSize);
        } else {
          paginatedQuery = `
              SELECT SQL_CALC_FOUND_ROWS p.*
              FROM ??.${params.dataType} p
              ORDER BY p.${demappedGridID} ASC LIMIT ?, ?;`;
          queryParams.push(page * pageSize, pageSize);
        }
        break;
      case 'alltaxonomiesview':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS atv.* FROM ??.${params.dataType} atv
            ORDER BY atv.SpeciesCode ASC LIMIT ?, ?;`;
        queryParams.push(page * pageSize, pageSize);
        break;
      case 'stemtaxonomiesview':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS stv.* FROM ??.${params.dataType} stv
            ORDER BY stv.StemTag ASC LIMIT ?, ?;`;
        queryParams.push(page * pageSize, pageSize);
        break;
      case 'stems':
      case 'roles':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS * FROM ??.${params.dataType} WHERE IsActive IS TRUE LIMIT ?, ?`;
        queryParams.push(page * pageSize, pageSize);
        break;
      case 'census':
        paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS *
            FROM ??.census
            WHERE PlotID = ? AND IsActive IS TRUE LIMIT ?, ?`;
        queryParams.push(plotID, page * pageSize, pageSize);
        break;
      // No default needed - dataType is validated against VALID_DATA_TYPES whitelist above
    }

    // Route the schema identifier (?? placeholders) through safeFormatQuery before
    // the value-placeholder accounting below, so the remaining `?` count matches
    // queryParams exactly.
    paginatedQuery = safeFormatQuery(schema, paginatedQuery);

    // Ensure query parameters match the placeholders in the query
    if (paginatedQuery.match(/\?/g)?.length !== queryParams.length) {
      ailogger.error(`Query parameter mismatch for ${params.dataType}: expected ${paginatedQuery.match(/\?/g)?.length}, got ${queryParams.length}`);
      return new NextResponse(JSON.stringify({ error: 'Internal query configuration error' }), {
        status: HTTPResponses.INTERNAL_SERVER_ERROR
      });
    }

    const paginatedResults = await connectionManager.executeQuery(format(paginatedQuery, queryParams));
    paginatedResults.forEach((result: any) => {
      if (result.UserDefinedFields !== undefined && result.UserDefinedFields !== null) {
        if (typeof result.UserDefinedFields === 'string') {
          result.UserDefinedFields = JSON.parse(result.UserDefinedFields).treestemstate;
        } else result.UserDefinedFields = result.UserDefinedFields.treestemstate;
      }
    });

    const totalRowsQuery = 'SELECT FOUND_ROWS() as totalRows';
    const totalRowsResult = await connectionManager.executeQuery(totalRowsQuery);
    const totalRows = totalRowsResult[0]?.totalRows ?? 0;

    return new NextResponse(
      JSON.stringify({
        output: MapperFactory.getMapper<any, any>(params.dataType).mapData(paginatedResults),
        deprecated: undefined,
        totalCount: totalRows,
        finishedQuery: format(paginatedQuery, queryParams)
      }),
      { status: HTTPResponses.OK }
    );
  } catch (error: unknown) {
    const errObj = error instanceof Error ? error : new Error(String(error));
    ailogger.error('Fixed data query error:', errObj);
    return new NextResponse(JSON.stringify({ error: 'Failed to retrieve data' }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  } finally {
    await connectionManager.closeConnection();
  }
}

// The re-exported coreapifunctions POST/PATCH/DELETE handlers use their own
// narrower props type; wrap them so the guard's RouteContext callback signature
// matches. Each write path is guarded with the same per-site authz as GET, so an
// out-of-scope schema is a 403 before any SQL/transaction runs.
async function postHandler(request: NextRequest, context: RouteContext) {
  return coreApiPost(request, context as unknown as SlugRouteProps);
}

async function patchHandler(request: NextRequest, context: RouteContext) {
  return coreApiPatch(request, context as unknown as SlugRouteProps);
}

async function deleteHandler(request: NextRequest, context: RouteContext) {
  return coreApiDelete(request, context as unknown as SlugRouteProps);
}

export const GET = withRouteAuthz(ROUTE_KEY, getHandler, { schema: fromPathSegment('slugs', 0) });
export const POST = withRouteAuthz(ROUTE_KEY, postHandler, { schema: fromPathSegment('slugs', 0) });
export const PATCH = withRouteAuthz(ROUTE_KEY, patchHandler, { schema: fromPathSegment('slugs', 0) });
export const DELETE = withRouteAuthz(ROUTE_KEY, deleteHandler, { schema: fromPathSegment('slugs', 0) });
