import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { escape } from 'mysql2';
import { format } from 'mysql2/promise';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';

export async function POST(
  request: NextRequest,
  {
    params
  }: {
    params: { dataType: string; slugs?: string[] };
  }
): Promise<NextResponse<{ output: any[]; deprecated?: any[]; totalCount: number }>> {
  if (!params.slugs || params.slugs.length < 5) throw new Error('slugs not received.');
  const [schema, pageParam, pageSizeParam, plotIDParam, plotCensusNumberParam, quadratIDParam, speciesIDParam] = params.slugs;
  if (!schema || schema === 'undefined' || !pageParam || pageParam === 'undefined' || !pageSizeParam || pageSizeParam === 'undefined')
    throw new Error('core slugs schema/page/pageSize not correctly received');
  console.log('params: ', params);
  const { quickFilter } = await request.json();
  console.log('quickFilter', quickFilter);
  const page = parseInt(pageParam);
  const pageSize = parseInt(pageSizeParam);
  const plotID = plotIDParam ? parseInt(plotIDParam) : undefined;
  const plotCensusNumber = plotCensusNumberParam ? parseInt(plotCensusNumberParam) : undefined;
  const quadratID = quadratIDParam ? parseInt(quadratIDParam) : undefined;
  const speciesID = speciesIDParam ? parseInt(speciesIDParam) : undefined;
  const connectionManager = new ConnectionManager();
  let updatedMeasurementsExist = false;
  let censusIDs;
  let pastCensusIDs: string | any[];

  const buildSearchStub = (columns: any[], alias?: string) =>
    columns.map((column: any) => `\`${alias ? `${alias}.` : ''}${column}\` LIKE ${escape(`%${quickFilter}%`)}`).join(' OR ');

  try {
    let paginatedQuery = ``;
    const queryParams: any[] = [];
    let columns: any[] = [];
    try {
      const query = `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? 
      AND COLUMN_NAME NOT LIKE '%id%' AND COLUMN_NAME NOT LIKE '%uuid%' AND COLUMN_NAME NOT LIKE 'id%'  AND COLUMN_NAME NOT LIKE '%_id' `;
      const results = await connectionManager.executeQuery(query, [schema, params.dataType]);
      columns = results.map((row: any) => row.COLUMN_NAME);
    } catch (e: any) {
      console.log('error: ', e);
      throw new Error(e);
    }
    const searchStub = buildSearchStub(columns);
    switch (params.dataType) {
      case 'validationprocedures':
        paginatedQuery = `
          SELECT SQL_CALC_FOUND_ROWS * 
          FROM catalog.${params.dataType} WHERE ${searchStub}`;
        queryParams.push(page * pageSize, pageSize);
        break;
      case 'specieslimits':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType} pdt WHERE pdt.SpeciesID = ?`;
        queryParams.push(speciesID, page * pageSize, pageSize);
        break;
      case 'attributes':
      case 'species':
      case 'stems':
      case 'alltaxonomiesview':
      case 'quadratpersonnel':
      case 'sitespecificvalidations':
      case 'roles':
        paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType} WHERE ${searchStub}`;
        queryParams.push(page * pageSize, pageSize);
        break;
      case 'personnel':
        paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS p.*
            FROM ${schema}.${params.dataType} p
                     JOIN ${schema}.census c ON p.CensusID = c.CensusID
            WHERE c.PlotID = ?
              AND c.PlotCensusNumber = ? AND ${searchStub}`;
        console.log('paginated query: ', paginatedQuery);
        queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'quadrats':
        paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS q.*
            FROM ${schema}.quadrats q
                     JOIN ${schema}.censusquadrat cq ON q.QuadratID = cq.QuadratID
                     JOIN ${schema}.census c ON cq.CensusID = c.CensusID
            WHERE q.PlotID = ?
              AND c.PlotID = ?
              AND c.PlotCensusNumber = ? AND ${searchStub}`;
        queryParams.push(plotID, plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'personnelrole':
        paginatedQuery = `
        SELECT SQL_CALC_FOUND_ROWS 
            p.PersonnelID,
            p.CensusID,
            p.FirstName,
            p.LastName,
            r.RoleName,
            r.RoleDescription
        FROM 
            personnel p
        LEFT JOIN 
            roles r ON p.RoleID = r.RoleID
            census c ON p.CensusID = c.CensusID
        WHERE c.PlotID = ? AND c.PlotCensusNumber = ? AND ${searchStub}`;
        queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'measurementssummary':
      case 'measurementssummary_staging':
      case 'measurementssummaryview':
      case 'viewfulltable':
      case 'viewfulltableview':
        paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS vft.*
            FROM ${schema}.${params.dataType} vft
                     JOIN ${schema}.census c ON vft.PlotID = c.PlotID AND vft.CensusID = c.CensusID
            WHERE vft.PlotID = ?
              AND c.PlotID = ?
              AND c.PlotCensusNumber = ? AND ${searchStub}
            ORDER BY vft.MeasurementDate ASC`;
        queryParams.push(plotID, plotID, plotCensusNumber, page * pageSize, pageSize);
        break;
      case 'census':
        paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS *
            FROM ${schema}.census
            WHERE PlotID = ? AND ${searchStub}`;
        queryParams.push(plotID, page * pageSize, pageSize);
        break;
      case 'coremeasurements':
        const censusQuery = `
            SELECT CensusID
            FROM ${schema}.census
            WHERE PlotID = ?
              AND PlotCensusNumber = ?
            ORDER BY StartDate DESC LIMIT 30
        `;
        const censusResults = await connectionManager.executeQuery(format(censusQuery, [plotID, plotCensusNumber]));
        if (censusResults.length < 2) {
          paginatedQuery = `
              SELECT SQL_CALC_FOUND_ROWS pdt.*
              FROM ${schema}.${params.dataType} pdt
                       JOIN ${schema}.census c ON pdt.CensusID = c.CensusID
              WHERE c.PlotID = ?
                AND c.PlotCensusNumber = ? AND ${searchStub}
              ORDER BY pdt.MeasurementDate`;
          queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
          break;
        } else {
          updatedMeasurementsExist = true;
          censusIDs = censusResults.map((c: any) => c.CensusID);
          pastCensusIDs = censusIDs.slice(1);
          paginatedQuery = `
              SELECT SQL_CALC_FOUND_ROWS pdt.*
              FROM ${schema}.${params.dataType} pdt
                       JOIN ${schema}.census c ON sp.CensusID = c.CensusID
              WHERE c.PlotID = ?
                AND c.CensusID IN (${censusIDs.map(() => '?').join(', ')}) AND ${searchStub}
              ORDER BY pdt.MeasurementDate ASC`;
          queryParams.push(plotID, ...censusIDs, page * pageSize, pageSize);
          break;
        }
      default:
        throw new Error(`Unknown dataType: ${params.dataType}`);
    }
    paginatedQuery += ` LIMIT ?, ?;`;

    if (paginatedQuery.match(/\?/g)?.length !== queryParams.length) {
      throw new Error('Mismatch between query placeholders and parameters');
    }
    const paginatedResults = await connectionManager.executeQuery(format(paginatedQuery, queryParams));

    const totalRowsQuery = 'SELECT FOUND_ROWS() as totalRows';
    const totalRowsResult = await connectionManager.executeQuery(totalRowsQuery);
    const totalRows = totalRowsResult[0].totalRows;

    if (updatedMeasurementsExist) {
      const deprecated = paginatedResults.filter((row: any) => pastCensusIDs.includes(row.CensusID));

      const uniqueKeys = ['PlotID', 'QuadratID', 'TreeID', 'StemID'];
      const outputKeys = paginatedResults.map((row: any) => uniqueKeys.map(key => row[key]).join('|'));
      const filteredDeprecated = deprecated.filter((row: any) => outputKeys.includes(uniqueKeys.map(key => row[key]).join('|')));
      return new NextResponse(
        JSON.stringify({
          output: MapperFactory.getMapper<any, any>(params.dataType).mapData(paginatedResults),
          deprecated: MapperFactory.getMapper<any, any>(params.dataType).mapData(filteredDeprecated),
          totalCount: totalRows
        }),
        { status: HTTPResponses.OK }
      );
    } else {
      return new NextResponse(
        JSON.stringify({
          output: MapperFactory.getMapper<any, any>(params.dataType).mapData(paginatedResults),
          deprecated: undefined,
          totalCount: totalRows
        }),
        { status: HTTPResponses.OK }
      );
    }
  } catch (error: any) {
    throw new Error(error);
  } finally {
    await connectionManager.closeConnection();
  }
}
