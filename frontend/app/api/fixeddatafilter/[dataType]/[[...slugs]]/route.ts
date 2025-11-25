import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { format } from 'mysql2/promise';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';
import { buildFilterModelStub, buildSearchStub } from '@/components/processors/processormacros';
import { POST as SINGLEPOST } from '@/config/macros/coreapifunctions';
import type { ExtendedGridFilterModel } from '@/config/datagridhelpers';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export { PATCH, DELETE } from '@/config/macros/coreapifunctions';

export async function POST(
  request: NextRequest,
  props: {
    params: Promise<{ dataType: string; slugs?: string[] }>;
  }
) {
  const params = await props.params;
  // trying to ensure that system correctly retains edit/add functionality -- not necessarily needed currently but better safe than sorry
  const body = await request.json();
  if (body.newRow) {
    return SINGLEPOST(request, props);
  } else {
    const filterModel: ExtendedGridFilterModel = body.filterModel;
    if (!params.slugs || params.slugs.length < 5) {
      return new NextResponse(JSON.stringify({ error: 'slugs not received' }), {
        status: HTTPResponses.INVALID_REQUEST
      });
    }
    const [schema, pageParam, pageSizeParam, plotIDParam, plotCensusNumberParam] = params.slugs;
    if (!schema || schema === 'undefined' || !pageParam || pageParam === 'undefined' || !pageSizeParam || pageSizeParam === 'undefined') {
      return new NextResponse(JSON.stringify({ error: 'core slugs schema/page/pageSize not correctly received' }), {
        status: HTTPResponses.INVALID_REQUEST
      });
    }
    if (!filterModel || (!filterModel.items && !filterModel.quickFilterValues)) {
      return new NextResponse(JSON.stringify({ error: 'filterModel is empty - filter API should not have triggered' }), {
        status: HTTPResponses.INVALID_REQUEST
      });
    }
    const page = parseInt(pageParam);
    const pageSize = parseInt(pageSizeParam);
    const plotID = plotIDParam ? parseInt(plotIDParam) : undefined;
    const plotCensusNumber = plotCensusNumberParam ? parseInt(plotCensusNumberParam) : undefined;
    const connectionManager = ConnectionManager.getInstance();
    let updatedMeasurementsExist = false;
    let censusIDs;
    let pastCensusIDs: string | any[];
    let transactionID: string | undefined = undefined;

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
        ailogger.error('Error fetching columns in fixeddatafilter:', e);
        return new NextResponse(JSON.stringify({ error: e.message }), {
          status: HTTPResponses.INTERNAL_SERVER_ERROR
        });
      }
      let searchStub = '';
      let filterStub = '';
      switch (params.dataType) {
        case 'sitespecificvalidations':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues);
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel);

          paginatedQuery = `
          SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.sitespecificvalidations  
          ${searchStub || filterStub ? ` WHERE (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`; // validation procedures is special
          queryParams.push(page * pageSize, pageSize);
          break;
        case 'failedmeasurements':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues);
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel);
          paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType} fm
          JOIN census c ON fm.CensusID = c.CensusID
          WHERE fm.PlotID = ? 
          AND c.PlotCensusNumber = ? 
          ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
          queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
          break;
        case 'attributes':
        case 'species':
        case 'stems':
        case 'alltaxonomiesview':
        case 'roles':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues);
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel);

          paginatedQuery = `SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType} 
          ${searchStub || filterStub ? ` WHERE (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
          queryParams.push(page * pageSize, pageSize);
          break;
        case 'personnel':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues, 'p');
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel, 'p');

          paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS p.*, EXISTS( 
              SELECT 1 FROM ${schema}.censusactivepersonnel cap 
                JOIN ${schema}.census c ON cap.CensusID = c.CensusID 
                WHERE cap.PersonnelID = p.PersonnelID 
                  AND c.PlotCensusNumber = ? and c.PlotID = ? 
              ) AS CensusActive 
            FROM ${schema}.${params.dataType} p
            ${searchStub || filterStub ? ` WHERE (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
          queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
          break;
        case 'unifiedchangelog':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues);
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel);

          paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS * FROM ${schema}.${params.dataType} uc
            JOIN ${schema}.plots p ON uc.PlotID = p.PlotID
            JOIN ${schema}.census c ON uc.CensusID = c.CensusID
            WHERE p.PlotID = ?
            AND c.PlotCensusNumber = ?
            ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
          queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
          break;
        case 'quadrats':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues, 'q');
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel, 'q');

          paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS q.*
            FROM ${schema}.quadrats q
            WHERE q.PlotID = ? AND q.IsActive IS TRUE  
              ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
          queryParams.push(plotID, page * pageSize, pageSize);
          break;
        case 'census':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues);
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel);

          paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS *
            FROM ${schema}.census
            WHERE PlotID = ? 
            ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
          queryParams.push(plotID, page * pageSize, pageSize);
          break;
        case 'measurementssummary':
        case 'measurementssummary_staging':
        case 'measurementssummaryview':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues, 'vft');
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel, 'vft');
          paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS vft.*
            FROM ${schema}.${params.dataType} vft
                     JOIN ${schema}.census c ON vft.PlotID = c.PlotID AND vft.CensusID = c.CensusID
            WHERE vft.PlotID = ?
              AND c.PlotID = ?
              AND c.PlotCensusNumber = ?
              ${(() => {
                const visibleConditions = filterModel.visible
                  .map(v => {
                    switch (v) {
                      case 'valid':
                        return `vft.IsValidated = TRUE`;
                      case 'errors':
                        return `vft.IsValidated = FALSE`;
                      case 'pending':
                        return `vft.IsValidated IS NULL`;
                      default:
                        return null;
                    }
                  })
                  .filter(Boolean);
                return visibleConditions.length > 0 ? ` AND (${visibleConditions.join(' OR ')})` : '';
              })()}
              ${(() => {
                // Bug #4 fix: Validate TSS values against allowed set to prevent SQL injection
                const validTss = filterModel.tss.filter(tss => ['multi stem', 'old tree', 'new recruit'].includes(tss));
                return validTss.length > 0
                  ? ` AND (${validTss.map(tss => `JSON_CONTAINS(UserDefinedFields, JSON_QUOTE('${tss}'), '$.treestemstate') = 1`).join(' OR ')})`
                  : ``;
              })()}
              ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}
            ORDER BY vft.MeasurementDate ASC`;
          queryParams.push(plotID, plotID, plotCensusNumber, page * pageSize, pageSize);
          break;
        case 'viewfulltable':
        case 'viewfulltableview':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues, 'vft');
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel, 'vft');

          paginatedQuery = `
            SELECT SQL_CALC_FOUND_ROWS *
            FROM ${schema}.${params.dataType} WHERE PlotID = ? AND PlotCensusNumber = ?
              ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''} `;
          queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
          break;
        case 'coremeasurements':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues, 'pdt');
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel, 'pdt');

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
                AND c.PlotCensusNumber = ? AND (${searchStub} ${filterStub !== '' ? `OR ${filterStub}` : ``})
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
                AND c.CensusID IN (${censusIDs.map(() => '?').join(', ')}) 
                ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}
              ORDER BY pdt.MeasurementDate ASC`;
            queryParams.push(plotID, ...censusIDs, page * pageSize, pageSize);
            break;
          }
        default:
          return new NextResponse(JSON.stringify({ error: `Unknown dataType: ${params.dataType}` }), {
            status: HTTPResponses.INVALID_REQUEST
          });
      }
      paginatedQuery += ` LIMIT ?, ?;`;

      if (paginatedQuery.match(/\?/g)?.length !== queryParams.length) {
        ailogger.error(
          `Mismatch between query placeholders and parameters: paginated query length: ${paginatedQuery.match(/\?/g)?.length}, parameters length: ${queryParams.length}`
        );
        return new NextResponse(JSON.stringify({ error: 'Query parameter mismatch - please contact support' }), {
          status: HTTPResponses.INTERNAL_SERVER_ERROR
        });
      }
      transactionID = await connectionManager.beginTransaction();
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
      await connectionManager.commitTransaction(transactionID ?? '');
      if (updatedMeasurementsExist) {
        const deprecated = paginatedResults.filter((row: any) => pastCensusIDs.includes(row.CensusID));

        const uniqueKeys = ['PlotID', 'QuadratID', 'TreeID', 'StemGUID'];
        const outputKeys = paginatedResults.map((row: any) => uniqueKeys.map(key => row[key]).join('|'));
        const filteredDeprecated = deprecated.filter((row: any) => outputKeys.includes(uniqueKeys.map(key => row[key]).join('|')));
        return new NextResponse(
          JSON.stringify({
            output: MapperFactory.getMapper<any, any>(params.dataType).mapData(paginatedResults),
            deprecated: MapperFactory.getMapper<any, any>(params.dataType).mapData(filteredDeprecated),
            totalCount: totalRows,
            finishedQuery: format(paginatedQuery, queryParams)
          }),
          { status: HTTPResponses.OK }
        );
      } else {
        return new NextResponse(
          JSON.stringify({
            output: MapperFactory.getMapper<any, any>(params.dataType).mapData(paginatedResults),
            deprecated: undefined,
            totalCount: totalRows,
            finishedQuery: format(paginatedQuery, queryParams)
          }),
          { status: HTTPResponses.OK }
        );
      }
    } catch (error: any) {
      if (transactionID) {
        await connectionManager.rollbackTransaction(transactionID);
      }
      ailogger.error('Error in fixeddatafilter POST:', error);
      return new NextResponse(JSON.stringify({ error: error.message }), {
        status: HTTPResponses.INTERNAL_SERVER_ERROR
      });
    } finally {
      await connectionManager.closeConnection();
    }
  }
}
