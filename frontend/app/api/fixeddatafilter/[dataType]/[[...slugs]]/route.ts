import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { format } from 'mysql2/promise';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';
import { buildFilterModelStub, buildSearchStub } from '@/components/processors/processormacros';
import { POST as SINGLEPOST } from '@/config/macros/coreapifunctions';
import type { ExtendedGridFilterModel } from '@/config/datagridhelpers';
import ailogger from '@/ailogger';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { buildFailedMeasurementsSelectQuery } from '@/config/measurementerrors';
import { buildMeasurementVisibleClauseSql } from '@/config/measurementstatefilters';

const COLUMN_CACHE_TTL_MS = 5 * 60 * 1000;
const columnCache = new Map<string, { columns: string[]; cachedAt: number }>();

function getColumnCacheKey(schema: string, tableName: string): string {
  return `${schema}.${tableName}`;
}

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Whitelist of allowed data types for this route
const ALLOWED_DATA_TYPES = [
  'sitespecificvalidations',
  'failedmeasurements',
  'attributes',
  'species',
  'stems',
  'alltaxonomiesview',
  'roles',
  'personnel',
  'unifiedchangelog',
  'quadrats',
  'census',
  'measurementssummary',
  'measurementssummary_staging',
  'measurementssummaryview',
  'viewfulltable',
  'viewfulltableview',
  'coremeasurements'
] as const;
type AllowedDataType = (typeof ALLOWED_DATA_TYPES)[number];

function isValidDataType(dataType: string): dataType is AllowedDataType {
  return ALLOWED_DATA_TYPES.includes(dataType as AllowedDataType);
}

// Whitelist of allowed TSS values for measurements filter (for future validation)
const _ALLOWED_TSS_VALUES = ['multi stem', 'old tree', 'new recruit'] as const;

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  if (!value || value === 'undefined') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed;
}

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
    if (!params.slugs || params.slugs.length < 3) {
      return new NextResponse(JSON.stringify({ error: 'slugs not received: expected at least 3 (schema, page, pageSize)' }), {
        status: HTTPResponses.INVALID_REQUEST
      });
    }
    const [schema, pageParam, pageSizeParam, plotIDParam, plotCensusNumberParam] = params.slugs;
    if (!schema || schema === 'undefined' || !pageParam || pageParam === 'undefined' || !pageSizeParam || pageSizeParam === 'undefined') {
      return new NextResponse(JSON.stringify({ error: 'core slugs schema/page/pageSize not correctly received' }), {
        status: HTTPResponses.INVALID_REQUEST
      });
    }

    // SECURITY: Validate schema against whitelist to prevent SQL injection
    if (!isValidSchema(schema)) {
      ailogger.error(`[fixeddatafilter API] Invalid schema provided: ${schema}`);
      return new NextResponse(JSON.stringify({ error: 'Invalid schema' }), {
        status: HTTPResponses.INVALID_REQUEST
      });
    }

    // SECURITY: Validate dataType against whitelist
    if (!isValidDataType(params.dataType)) {
      ailogger.error(`[fixeddatafilter API] Invalid dataType provided: ${params.dataType}`);
      return new NextResponse(JSON.stringify({ error: 'Invalid data type' }), {
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
    const plotID = parseOptionalPositiveInt(plotIDParam);
    const plotCensusNumber = parseOptionalPositiveInt(plotCensusNumberParam);

    // Validate numeric parameters
    if (isNaN(page) || page < 0 || isNaN(pageSize) || pageSize <= 0) {
      return new NextResponse(JSON.stringify({ error: 'Invalid pagination parameters' }), {
        status: HTTPResponses.INVALID_REQUEST
      });
    }

    const connectionManager = ConnectionManager.getInstance();
    let updatedMeasurementsExist = false;
    let censusIDs: number[] = [];
    let pastCensusIDs: number[] = [];

    try {
      let paginatedQuery = ``;
      const queryParams: (string | number | undefined)[] = [];
      let columns: string[] = [];
      try {
        if (params.dataType === 'failedmeasurements') {
          columns = [
            'FailedMeasurementID',
            'PlotID',
            'CensusID',
            'Tag',
            'StemTag',
            'SpCode',
            'Quadrat',
            'X',
            'Y',
            'DBH',
            'HOM',
            'Date',
            'Codes',
            'Comments',
            'Description',
            'FailureReasons',
            'OriginalFailureReasons',
            'CurrentFailureReasons',
            'LastValidatedAt',
            'FileID',
            'BatchID'
          ];
        } else {
          const tableNameForColumns = params.dataType;
          const cacheKey = getColumnCacheKey(schema, tableNameForColumns);
          const cached = columnCache.get(cacheKey);
          const now = Date.now();

          if (cached && now - cached.cachedAt < COLUMN_CACHE_TTL_MS) {
            columns = cached.columns;
          } else {
            const query = `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          AND COLUMN_NAME NOT LIKE '%id%' AND COLUMN_NAME NOT LIKE '%uuid%' AND COLUMN_NAME NOT LIKE 'id%'  AND COLUMN_NAME NOT LIKE '%_id' `;
            const results = await connectionManager.executeQuery(query, [schema, tableNameForColumns]);
            columns = results.map((row: { COLUMN_NAME: string }) => row.COLUMN_NAME);
            columnCache.set(cacheKey, { columns, cachedAt: now });
          }
        }
      } catch (e: unknown) {
        const errorObj = e instanceof Error ? e : new Error(String(e));
        ailogger.error('Error fetching columns in fixeddatafilter:', errorObj);
        const message = errorObj.message;
        return new NextResponse(JSON.stringify({ error: message }), {
          status: HTTPResponses.INTERNAL_SERVER_ERROR
        });
      }
      let searchStub = '';
      let filterStub = '';
      let countQuery = '';
      const countParams: (string | number | undefined)[] = [];

      switch (params.dataType) {
        case 'sitespecificvalidations':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues);
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel);
          {
            const whereClause = searchStub || filterStub ? ` WHERE (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : '';
            paginatedQuery = `SELECT * FROM ${schema}.sitespecificvalidations ${whereClause}`;
            countQuery = `SELECT COUNT(*) as totalRows FROM ${schema}.sitespecificvalidations ${whereClause}`;
          }
          queryParams.push(page * pageSize, pageSize);
          break;
        case 'failedmeasurements':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues);
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel);
          {
            const filterClause = searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : '';
            paginatedQuery = `SELECT fm.*
            FROM (${buildFailedMeasurementsSelectQuery(schema)}) fm
            JOIN ${schema}.census c ON fm.CensusID = c.CensusID
            WHERE fm.PlotID = ?
            AND c.PlotID = ?
            AND c.PlotCensusNumber = ?
            ${filterClause}`;
            countQuery = `SELECT COUNT(*) as totalRows
            FROM (${buildFailedMeasurementsSelectQuery(schema)}) fm
            JOIN ${schema}.census c ON fm.CensusID = c.CensusID
            WHERE fm.PlotID = ?
            AND c.PlotID = ?
            AND c.PlotCensusNumber = ?
            ${filterClause}`;
            countParams.push(plotID, plotID, plotCensusNumber);
          }
          queryParams.push(plotID, plotID, plotCensusNumber, page * pageSize, pageSize);
          break;
        case 'attributes':
        case 'species':
        case 'stems':
        case 'alltaxonomiesview':
        case 'roles':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues);
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel);
          {
            const whereClause = searchStub || filterStub ? ` WHERE (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : '';
            paginatedQuery = `SELECT * FROM ${schema}.${params.dataType} ${whereClause}`;
            countQuery = `SELECT COUNT(*) as totalRows FROM ${schema}.${params.dataType} ${whereClause}`;
          }
          queryParams.push(page * pageSize, pageSize);
          break;
        case 'personnel':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues, 'p');
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel, 'p');
          {
            const whereClause = searchStub || filterStub ? ` WHERE (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : '';
            if (plotCensusNumber !== undefined && plotID !== undefined) {
              paginatedQuery = `
              SELECT p.*, EXISTS(
                SELECT 1 FROM ${schema}.censusactivepersonnel cap
                  JOIN ${schema}.census c ON cap.CensusID = c.CensusID
                  WHERE cap.PersonnelID = p.PersonnelID
                    AND c.PlotCensusNumber = ? and c.PlotID = ?
                ) AS CensusActive
              FROM ${schema}.${params.dataType} p
              ${whereClause}`;
              queryParams.push(plotCensusNumber, plotID, page * pageSize, pageSize);
            } else {
              paginatedQuery = `
              SELECT p.*
              FROM ${schema}.${params.dataType} p
              ${whereClause}`;
              queryParams.push(page * pageSize, pageSize);
            }
            countQuery = `SELECT COUNT(*) as totalRows FROM ${schema}.${params.dataType} p ${whereClause}`;
          }
          break;
        case 'unifiedchangelog':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues);
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel);
          {
            const filterClause = searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : '';
            paginatedQuery = `
            SELECT * FROM ${schema}.${params.dataType} uc
            JOIN ${schema}.plots p ON uc.PlotID = p.PlotID
            JOIN ${schema}.census c ON uc.CensusID = c.CensusID
            WHERE p.PlotID = ?
            AND c.PlotCensusNumber = ?
            ${filterClause}`;
            countQuery = `
            SELECT COUNT(*) as totalRows FROM ${schema}.${params.dataType} uc
            JOIN ${schema}.plots p ON uc.PlotID = p.PlotID
            JOIN ${schema}.census c ON uc.CensusID = c.CensusID
            WHERE p.PlotID = ?
            AND c.PlotCensusNumber = ?
            ${filterClause}`;
            countParams.push(plotID, plotCensusNumber);
          }
          queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
          break;
        case 'quadrats':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues, 'q');
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel, 'q');
          {
            const filterClause = searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : '';
            paginatedQuery = `
            SELECT q.*
            FROM ${schema}.quadrats q
            WHERE q.PlotID = ? AND q.IsActive IS TRUE
              ${filterClause}`;
            countQuery = `
            SELECT COUNT(*) as totalRows
            FROM ${schema}.quadrats q
            WHERE q.PlotID = ? AND q.IsActive IS TRUE
              ${filterClause}`;
            countParams.push(plotID);
          }
          queryParams.push(plotID, page * pageSize, pageSize);
          break;
        case 'census':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues);
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel);
          {
            const filterClause = searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : '';
            paginatedQuery = `
            SELECT *
            FROM ${schema}.census
            WHERE PlotID = ?
            ${filterClause}`;
            countQuery = `
            SELECT COUNT(*) as totalRows
            FROM ${schema}.census
            WHERE PlotID = ?
            ${filterClause}`;
            countParams.push(plotID);
          }
          queryParams.push(plotID, page * pageSize, pageSize);
          break;
        case 'measurementssummary':
        case 'measurementssummary_staging':
        case 'measurementssummaryview':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues, 'vft');
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel, 'vft');
          {
            const visibleClause = buildMeasurementVisibleClauseSql(schema, 'vft', filterModel.visible);
            const validTss = filterModel.tss.filter(tss => ['multi stem', 'old tree', 'new recruit'].includes(tss));
            const tssClause = validTss.length > 0
              ? ` AND (${validTss.map(tss => `JSON_CONTAINS(UserDefinedFields, JSON_QUOTE('${tss}'), '$.treestemstate') = 1`).join(' OR ')})`
              : ``;
            const filterClause = searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : '';
            const sharedWhere = `
            WHERE vft.PlotID = ?
              AND c.PlotID = ?
              AND c.PlotCensusNumber = ?
              ${visibleClause}
              ${tssClause}
              ${filterClause}`;
            const sharedFrom = `
            FROM ${schema}.${params.dataType} vft
              JOIN ${schema}.census c ON vft.PlotID = c.PlotID AND vft.CensusID = c.CensusID`;
            paginatedQuery = `SELECT vft.* ${sharedFrom} ${sharedWhere} ORDER BY vft.MeasurementDate ASC`;
            countQuery = `SELECT COUNT(*) as totalRows ${sharedFrom} ${sharedWhere}`;
            countParams.push(plotID, plotID, plotCensusNumber);
          }
          queryParams.push(plotID, plotID, plotCensusNumber, page * pageSize, pageSize);
          break;
        case 'viewfulltable':
        case 'viewfulltableview':
          if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues, 'vft');
          if (filterModel.items) filterStub = buildFilterModelStub(filterModel, 'vft');
          {
            const filterClause = searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : '';
            paginatedQuery = `
            SELECT *
            FROM ${schema}.${params.dataType} WHERE PlotID = ? AND PlotCensusNumber = ?
              ${filterClause} `;
            countQuery = `
            SELECT COUNT(*) as totalRows
            FROM ${schema}.${params.dataType} WHERE PlotID = ? AND PlotCensusNumber = ?
              ${filterClause} `;
            countParams.push(plotID, plotCensusNumber);
          }
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
            {
              const filterClause = searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : '';
              const sharedFrom = `FROM ${schema}.${params.dataType} pdt JOIN ${schema}.census c ON pdt.CensusID = c.CensusID`;
              const sharedWhere = `WHERE c.PlotID = ? AND c.PlotCensusNumber = ? ${filterClause}`;
              paginatedQuery = `SELECT pdt.* ${sharedFrom} ${sharedWhere} ORDER BY pdt.MeasurementDate`;
              countQuery = `SELECT COUNT(*) as totalRows ${sharedFrom} ${sharedWhere}`;
              countParams.push(plotID, plotCensusNumber);
            }
            queryParams.push(plotID, plotCensusNumber, page * pageSize, pageSize);
            break;
          } else {
            updatedMeasurementsExist = true;
            censusIDs = censusResults.map((c: { CensusID: number }) => c.CensusID);
            pastCensusIDs = censusIDs.slice(1);
            {
              const filterClause = searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : '';
              const sharedFrom = `FROM ${schema}.${params.dataType} pdt JOIN ${schema}.census c ON pdt.CensusID = c.CensusID`;
              const sharedWhere = `WHERE c.PlotID = ? AND c.CensusID IN (${censusIDs.map(() => '?').join(', ')}) ${filterClause}`;
              paginatedQuery = `SELECT pdt.* ${sharedFrom} ${sharedWhere} ORDER BY pdt.MeasurementDate ASC`;
              countQuery = `SELECT COUNT(*) as totalRows ${sharedFrom} ${sharedWhere}`;
              countParams.push(plotID, ...censusIDs);
            }
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
      const [paginatedResults, totalRowsResult] = await Promise.all([
        connectionManager.executeQuery(format(paginatedQuery, queryParams)),
        connectionManager.executeQuery(format(countQuery, countParams))
      ]);
      paginatedResults.forEach((result: Record<string, unknown>) => {
        if (result.UserDefinedFields !== undefined && result.UserDefinedFields !== null) {
          if (typeof result.UserDefinedFields === 'string') {
            result.UserDefinedFields = JSON.parse(result.UserDefinedFields).treestemstate;
          } else result.UserDefinedFields = (result.UserDefinedFields as { treestemstate?: unknown }).treestemstate;
        }
      });
      const totalRows = totalRowsResult[0].totalRows;
      if (updatedMeasurementsExist) {
        const deprecated = paginatedResults.filter((row: Record<string, unknown>) => pastCensusIDs.includes(row.CensusID as number));

        const uniqueKeys = ['PlotID', 'QuadratID', 'TreeID', 'StemGUID'] as const;
        const outputKeys = paginatedResults.map((row: Record<string, unknown>) => uniqueKeys.map(key => row[key]).join('|'));
        const filteredDeprecated = deprecated.filter((row: Record<string, unknown>) => outputKeys.includes(uniqueKeys.map(key => row[key]).join('|')));
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
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      ailogger.error('Error in fixeddatafilter POST:', errorObj);
      return new NextResponse(JSON.stringify({ error: errorObj.message }), {
        status: HTTPResponses.INTERNAL_SERVER_ERROR
      });
    } finally {
      await connectionManager.closeConnection();
    }
  }
}
