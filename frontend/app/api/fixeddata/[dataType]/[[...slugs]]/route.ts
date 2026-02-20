import MapperFactory from '@/config/datamapper';
import { format } from 'mysql2/promise';
import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import { getGridID } from '@/config/servergridhelpers';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import ailogger from '@/ailogger';
import { buildFailedMeasurementsSelectQuery } from '@/config/measurementerrors';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export { POST, PATCH, DELETE } from '@/config/macros/coreapifunctions';

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
  'stems',
  'roles',
  'census'
] as const;

type ValidDataType = (typeof VALID_DATA_TYPES)[number];

function isValidDataType(dataType: string): dataType is ValidDataType {
  return VALID_DATA_TYPES.includes(dataType as ValidDataType);
}

// slugs SHOULD CONTAIN AT MINIMUM: schema, page, pageSize, plotID, plotCensusNumber, (optional) quadratID, (optional) speciesID
export async function GET(
  _request: NextRequest,
  props: {
    params: Promise<{ dataType: string; slugs?: string[] }>;
  }
): Promise<NextResponse<{ output: any[]; deprecated?: any[]; totalCount: number; finishedQuery: string } | { error: string }>> {
  const params = await props.params;

  // Validate slugs parameter
  if (!params.slugs || params.slugs.length < 5) {
    return new NextResponse(JSON.stringify({ error: 'Invalid parameters: expected at least 5 slug values' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  const [schema, pageParam, pageSizeParam, plotIDParam, plotCensusNumberParam, speciesIDParam] = params.slugs;

  if (!schema || schema === 'undefined' || !pageParam || pageParam === 'undefined' || !pageSizeParam || pageSizeParam === 'undefined') {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters: schema, page, and pageSize' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  // SQL Injection Prevention: Validate schema against whitelist
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
  const plotID = plotIDParam ? parseInt(plotIDParam) : undefined;
  const plotCensusNumber = plotCensusNumberParam ? parseInt(plotCensusNumberParam) : undefined;
  const speciesID = speciesIDParam ? parseInt(speciesIDParam) : undefined;

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
          FROM ${schema}.sitespecificvalidations LIMIT ?, ?;`; // validation procedures is special
        queryParams.push(page * pageSize, pageSize);
        break;
      case 'specieslimits':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS pdt.* FROM ${schema}.${params.dataType} pdt WHERE pdt.SpeciesID = ? AND pdt.IsActive IS TRUE LIMIT ?, ?`;
        queryParams.push(speciesID, page * pageSize, pageSize);
        break;
      case 'unifiedchangelog':
        paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS uc.* FROM ${schema}.${params.dataType} uc
            JOIN ${schema}.plots p ON uc.PlotID = p.PlotID
            JOIN ${schema}.census c ON uc.CensusID = c.CensusID AND c.IsActive IS TRUE
            WHERE p.PlotID = ?
            AND c.PlotCensusNumber = ? LIMIT ?, ?;`;
        queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'failedmeasurements':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS fm.*
          FROM (${buildFailedMeasurementsSelectQuery(schema)}) fm
          JOIN ${schema}.census c ON fm.CensusID = c.CensusID AND c.IsActive IS TRUE
          WHERE fm.PlotID = ?
            AND c.PlotID = ?
            AND c.PlotCensusNumber = ? LIMIT ?, ?;`;
        queryParams.push(plotID, plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'viewfulltable':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType} WHERE PlotID = ? AND PlotCensusNumber = ? LIMIT ?, ?`;
        queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'attributes':
      case 'species':
      case 'quadrats':
        paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS dt.*
              FROM ${schema}.${params.dataType} dt
            ORDER BY dt.${demappedGridID} ASC LIMIT ?, ?;`;
        queryParams.push(page * pageSize, pageSize);
        break;
      case 'personnel':
        paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS p.*, EXISTS( 
              SELECT 1 FROM ${schema}.censusactivepersonnel cap 
                JOIN ${schema}.census c ON cap.CensusID = c.CensusID 
                WHERE cap.PersonnelID = p.PersonnelID 
                  AND c.PlotCensusNumber = ? and c.PlotID = ? 
              ) AS CensusActive 
            FROM ${schema}.${params.dataType} p
            ORDER BY p.${demappedGridID} ASC LIMIT ?, ?;`;
        queryParams.push(plotCensusNumber, plotID, page * pageSize, pageSize);
        break;
      case 'alltaxonomiesview':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS atv.* FROM ${schema}.${params.dataType} atv
            ORDER BY atv.SpeciesCode ASC LIMIT ?, ?;`;
        queryParams.push(page * pageSize, pageSize);
        break;
      case 'stems':
      case 'roles':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType} WHERE IsActive IS TRUE LIMIT ?, ?`;
        queryParams.push(page * pageSize, pageSize);
        break;
      case 'census':
        paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS *
            FROM ${schema}.census
            WHERE PlotID = ? AND IsActive IS TRUE LIMIT ?, ?`;
        queryParams.push(plotID, page * pageSize, pageSize);
        break;
      // No default needed - dataType is validated against VALID_DATA_TYPES whitelist above
    }

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
