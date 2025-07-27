import MapperFactory from '@/config/datamapper';
import { format } from 'mysql2/promise';
import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';
import { getCookie } from '@/app/actions/cookiemanager';

export { POST, PATCH, DELETE } from '@/config/macros/coreapifunctions';

function getGridID(gridType: string): string {
  switch (gridType.trim()) {
    case 'coremeasurements':
    case 'measurementssummaryview':
    case 'viewfulltableview':
    case 'measurementssummary': // materialized view --> should not be modified
    case 'viewfulltable': // materialized view --> should not be modified
      return 'coreMeasurementID';
    case 'attributes':
      return 'code';
    case 'census':
      return 'censusID';
    case 'personnel':
      return 'personnelID';
    case 'quadrats':
      return 'quadratID';
    case 'quadratpersonnel':
      return 'quadratPersonnelID';
    case 'roles':
      return 'roleID';
    case 'subquadrats':
      return 'subquadratID';
    case 'alltaxonomiesview':
    case 'species':
      return 'speciesID';
    case 'specieslimits':
      return 'speciesLimitID';
    case 'sitespecificvalidations':
      return 'validationID';
    case 'failedmeasurements':
      return 'failedMeasurementID';
    default:
      return 'breakage';
  }
}

// slugs SHOULD CONTAIN AT MINIMUM: schema, page, pageSize, plotID, plotCensusNumber, (optional) quadratID, (optional) speciesID
export async function GET(
  _request: NextRequest,
  props: {
    params: Promise<{ dataType: string; slugs?: string[] }>;
  }
): Promise<NextResponse<{ output: any[]; deprecated?: any[]; totalCount: number; finishedQuery: string }>> {
  const params = await props.params;
  if (!params.slugs || params.slugs.length < 5) throw new Error('slugs not received.');
  const [schema, pageParam, pageSizeParam, plotIDParam, plotCensusNumberParam, speciesIDParam] = params.slugs;
  if (!schema || schema === 'undefined' || !pageParam || pageParam === 'undefined' || !pageSizeParam || pageSizeParam === 'undefined')
    throw new Error('core slugs schema/page/pageSize not correctly received');
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
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS fm.* FROM ${schema}.${params.dataType} fm
          JOIN ${schema}.census c ON fm.CensusID = c.CensusID AND c.IsActive IS TRUE
          WHERE fm.PlotID = ? 
          AND c.PlotCensusNumber = ? LIMIT ?, ?;`;
        queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
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
      default:
        throw new Error(`Unknown dataType: ${params.dataType}`);
    }

    // Ensure query parameters match the placeholders in the query
    if (paginatedQuery.match(/\?/g)?.length !== queryParams.length) {
      throw new Error('Mismatch between query placeholders and parameters');
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
    const totalRows = totalRowsResult[0].totalRows;

    return new NextResponse(
      JSON.stringify({
        output: MapperFactory.getMapper<any, any>(params.dataType).mapData(paginatedResults),
        deprecated: undefined,
        totalCount: totalRows,
        finishedQuery: format(paginatedQuery, queryParams)
      }),
      { status: HTTPResponses.OK }
    );
  } catch (error: any) {
    throw new Error(error);
  } finally {
    await connectionManager.closeConnection();
  }
}
