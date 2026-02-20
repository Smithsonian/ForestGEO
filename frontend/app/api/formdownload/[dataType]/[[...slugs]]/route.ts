import { NextRequest, NextResponse } from 'next/server';
import MapperFactory from '@/config/datamapper';
import { AttributesRDS } from '@/config/sqlrdsdefinitions/core';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import { buildFilterModelStub, buildSearchStub } from '@/components/processors/processormacros';
import ailogger from '@/ailogger';
import { buildFailedMeasurementsSelectQuery } from '@/config/measurementerrors';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

type RouteProps = { params: Promise<{ dataType: string; slugs?: string[] }> };

async function parseFilterModel(request: NextRequest, slugs?: string[], body?: any) {
  if (body?.filterModel) {
    return body.filterModel;
  }

  const urlFilter = request.nextUrl.searchParams.get('filterModel');
  if (urlFilter) {
    try {
      return JSON.parse(urlFilter);
    } catch (error: any) {
      return { error: `Invalid filterModel query param: ${error.message}` };
    }
  }

  const filterModelParam = slugs?.[3];
  if (filterModelParam && filterModelParam !== 'undefined') {
    try {
      return JSON.parse(filterModelParam);
    } catch (error: any) {
      return { error: `Invalid filterModel path param: ${error.message}` };
    }
  }

  return undefined;
}

async function handleRequest(request: NextRequest, props: RouteProps, body?: any) {
  const params = await props.params;
  const { dataType, slugs } = params;
  if (!dataType || !slugs) {
    return new NextResponse(JSON.stringify({ error: 'data type or slugs not provided' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }
  const [schema, plotIDParam, censusIDParam] = slugs;
  if (!schema) {
    return new NextResponse(JSON.stringify({ error: 'no schema provided' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }
  const plotID = plotIDParam ? parseInt(plotIDParam) : undefined;
  const censusID = censusIDParam ? parseInt(censusIDParam) : undefined;
  const filterModel = await parseFilterModel(request, slugs, body);
  if (filterModel?.error) {
    return new NextResponse(JSON.stringify({ error: filterModel.error }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }
  const connectionManager = ConnectionManager.getInstance();
  let query = '';
  let results: any[] = [];
  let mappedResults: any[] = [];
  let formMappedResults: any[] = [];
  let searchStub = '';
  let filterStub = '';
  let columns: any[] = [];
  try {
    const query = `SELECT COLUMN_NAME
                   FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = ?
                     AND TABLE_NAME = ?
                     AND COLUMN_NAME NOT LIKE '%id%'
                     AND COLUMN_NAME NOT LIKE '%uuid%'
                     AND COLUMN_NAME NOT LIKE 'id%'
                     AND COLUMN_NAME NOT LIKE '%_id' `;
    const tableForColumns =
      params.dataType === 'measurements' || params.dataType === 'failedmeasurements' ? 'coremeasurements' : params.dataType;
    const results = await connectionManager.executeQuery(query, [schema, tableForColumns]);
    columns = results.map((row: any) => row.COLUMN_NAME);
    if (params.dataType === 'failedmeasurements') {
      columns = [
        'FailedMeasurementID',
        'FileID',
        'BatchID',
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
        'FailureReasons',
        'OriginalFailureReasons',
        'CurrentFailureReasons',
        'LastValidatedAt'
      ];
    }
  } catch (e: any) {
    ailogger.error('Error fetching columns in formdownload:', e);
    return new NextResponse(JSON.stringify({ error: e.message }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  }
  if (filterModel !== undefined && filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues);
  if (filterModel !== undefined && filterModel.items) filterStub = buildFilterModelStub(filterModel);
  try {
    switch (dataType) {
      case 'attributes':
        query = `SELECT 
          a.Code         AS code,
          a.Description  AS description,
          a.Status       AS status
        FROM ${schema}.attributes a
        ${searchStub || filterStub ? ` WHERE (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
        results = await connectionManager.executeQuery(query);
        mappedResults = MapperFactory.getMapper<any, any>('attributes').mapData(results);
        formMappedResults = mappedResults.map((row: AttributesRDS) => ({
          code: row.code,
          description: row.description,
          status: row.status
        }));
        return new NextResponse(JSON.stringify(formMappedResults), { status: HTTPResponses.OK });
      case 'personnel':
        query = `SELECT 
          p.FirstName        AS firstname,
          p.LastName         AS lastname,
          r.RoleName         AS role,
          r.RoleDescription  AS roledescription
        FROM ${schema}.personnel p
        JOIN ${schema}.roles r ON p.RoleID = r.RoleID
        ${searchStub || filterStub ? ` WHERE (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
        results = await connectionManager.executeQuery(query);
        formMappedResults = results.map((row: any) => ({
          firstname: row.firstname,
          lastname: row.lastname,
          role: row.role,
          roledescription: row.roledescription
        }));
        return new NextResponse(JSON.stringify(formMappedResults), { status: HTTPResponses.OK });
      case 'species':
        query = `SELECT DISTINCT
          sp.SpeciesCode         AS spcode,
          f.Family               AS family,
          g.Genus                AS genus,
          sp.SpeciesName         AS species,
          sp.SubspeciesName      AS subspecies,
          sp.IDLevel             AS idlevel,
          sp.SpeciesAuthority    AS authority,
          sp.SubspeciesAuthority AS subspeciesauthority
        FROM ${schema}.species sp
        LEFT JOIN ${schema}.genus AS g
          ON sp.GenusID = g.GenusID
        LEFT JOIN ${schema}.family AS f
          ON g.FamilyID = f.FamilyID
        ${searchStub || filterStub ? ` WHERE (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
        results = await connectionManager.executeQuery(query);
        formMappedResults = results.map((row: any) => ({
          spcode: row.spcode,
          family: row.family,
          genus: row.genus,
          species: row.species,
          subspecies: row.subspecies,
          idlevel: row.idlevel,
          authority: row.authority,
          subspeciesauthority: row.subspeciesauthority
        }));
        return new NextResponse(JSON.stringify(formMappedResults), { status: HTTPResponses.OK });
      case 'quadrats':
        query = `SELECT
          q.QuadratName  AS quadrat,
          q.StartX       AS startx,
          q.StartY       AS starty,
          q.DimensionX   AS dimx,
          q.DimensionY   AS dimy,
          q.Area         AS area,
          q.QuadratShape AS quadratshape
        FROM ${schema}.quadrats q
        WHERE q.PlotID = ? AND q.IsActive IS TRUE
        ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
        results = await connectionManager.executeQuery(query, [plotID]);
        formMappedResults = results.map((row: any) => ({
          quadrat: row.quadrat,
          startx: row.startx,
          starty: row.starty,
          dimx: row.dimx,
          dimy: row.dimy,
          area: row.area,
          quadratshape: row.quadratshape
        }));
        return new NextResponse(JSON.stringify(formMappedResults), { status: HTTPResponses.OK });
      case 'measurements':
        query = `SELECT
                  st.StemGUID                                         AS StemGUID,
                  t.TreeID                                            AS TreeID,
                  st.StemTag                                          AS StemTag,
                  t.TreeTag                                           AS TreeTag,
                  sp.SpeciesCode                                      AS SpeciesCode,
                  q.QuadratName                                       AS QuadratName,
                  st.LocalX                                           AS StartX,
                  st.LocalY                                           AS StartY,
                  cm.MeasuredDBH                                      AS MeasuredDBH,
                  cm.MeasuredHOM                                      AS MeasuredHOM,
                  cm.MeasurementDate                                  AS MeasurementDate,
                  (
                    SELECT GROUP_CONCAT(ca.Code SEPARATOR '; ')
                    FROM ${schema}.cmattributes ca
                    WHERE ca.CoreMeasurementID = cm.CoreMeasurementID
                  ) as Codes,
                  (SELECT GROUP_CONCAT(CONCAT(vp.ProcedureName, ':', vp.Description) SEPARATOR '; ')
                   FROM ${schema}.measurement_error_log mel
                   JOIN ${schema}.measurement_errors me ON me.ErrorID = mel.ErrorID
                   JOIN ${schema}.sitespecificvalidations vp ON me.ErrorCode = CAST(vp.ValidationID AS CHAR)
                   WHERE mel.MeasurementID = cm.CoreMeasurementID
                     AND me.ErrorSource = 'validation'
                     AND mel.IsResolved = FALSE) AS Errors
              FROM ${schema}.coremeasurements cm
              JOIN ${schema}.census c ON cm.CensusID = c.CensusID and c.IsActive IS TRUE
              JOIN ${schema}.stems st ON st.StemGUID = cm.StemGUID and st.CensusID = c.CensusID and st.IsActive IS TRUE
              JOIN ${schema}.trees t ON t.TreeID = st.TreeID and t.CensusID = c.CensusID and t.IsActive IS TRUE
              JOIN ${schema}.quadrats q on q.QuadratID = st.QuadratID and q.IsActive is true
              JOIN ${schema}.plots p ON p.PlotID = q.PlotID
              JOIN ${schema}.species sp ON sp.SpeciesID = t.SpeciesID
              WHERE p.PlotID = ? AND cm.CensusID = ? ${(() => {
                const visibleConditions = filterModel.visible
                  .map((v: string) => {
                    switch (v) {
                      case 'valid':
                        return `cm.IsValidated = TRUE`;
                      case 'errors':
                        return `cm.IsValidated = FALSE`;
                      case 'pending':
                        return `cm.IsValidated IS NULL`;
                      default:
                        return null;
                    }
                  })
                  .filter(Boolean);
                return visibleConditions.length > 0 ? ` AND (${visibleConditions.join(' OR ')})` : '';
              })()} 
              ${(() => {
                // Bug #4 fix: Validate TSS values against allowed set to prevent SQL injection
                const validTss = filterModel.tss.filter((tss: any) => ['multi stem', 'old tree', 'new recruit'].includes(tss));
                return validTss.length > 0
                  ? ` AND (${validTss.map((tss: any) => `JSON_CONTAINS(UserDefinedFields, JSON_QUOTE('${tss}'), '$.treestemstate') = 1`).join(' OR ')})`
                  : ``;
              })()} 
              ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
        results = await connectionManager.executeQuery(query, [plotID, censusID]);
        formMappedResults = results.map((row: any) => ({
          stemID: row.StemGUID,
          treeID: row.TreeID,
          tag: row.TreeTag,
          stemtag: row.StemTag,
          spcode: row.SpeciesCode,
          quadrat: row.QuadratName,
          lx: row.StartX,
          ly: row.StartY,
          dbh: row.MeasuredDBH,
          hom: row.MeasuredHOM,
          date: row.MeasurementDate,
          codes: row.Codes,
          errors: row.Errors
        }));
        return new NextResponse(JSON.stringify(formMappedResults), { status: HTTPResponses.OK });
      case 'failedmeasurements':
        query = `SELECT
                  fm.FailedMeasurementID AS failedmeasurementid,
                  fm.FileID              AS fileid,
                  fm.BatchID             AS batchid,
                  fm.Tag                 AS tag,
                  fm.StemTag             AS stemtag,
                  fm.SpCode              AS spcode,
                  fm.Quadrat             AS quadrat,
                  fm.X                   AS lx,
                  fm.Y                   AS ly,
                  fm.DBH                 AS dbh,
                  fm.HOM                 AS hom,
                  fm.Date                AS date,
                  fm.Codes               AS codes,
                  fm.FailureReasons      AS failureReasons
              FROM (${buildFailedMeasurementsSelectQuery(schema)}) fm
              WHERE fm.PlotID = ? AND fm.CensusID = ?
              ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}
              ORDER BY fm.FailedMeasurementID ASC`;
        results = await connectionManager.executeQuery(query, [plotID, censusID]);
        formMappedResults = results.map((row: any) => ({
          failedmeasurementid: row.failedmeasurementid,
          fileid: row.fileid,
          batchid: row.batchid,
          tag: row.tag,
          stemtag: row.stemtag,
          spcode: row.spcode,
          quadrat: row.quadrat,
          lx: row.lx,
          ly: row.ly,
          dbh: row.dbh,
          hom: row.hom,
          date: row.date,
          codes: row.codes,
          failureReasons: row.failureReasons,
          originalFailureReasons: row.OriginalFailureReasons,
          currentFailureReasons: row.CurrentFailureReasons,
          lastValidatedAt: row.LastValidatedAt
        }));
        return new NextResponse(JSON.stringify(formMappedResults), { status: HTTPResponses.OK });
      default:
        return new NextResponse(JSON.stringify({ error: 'incorrect data type passed in' }), {
          status: HTTPResponses.INVALID_REQUEST
        });
    }
  } catch (e: any) {
    ailogger.error('Error in formdownload GET:', e);
    return new NextResponse(JSON.stringify({ error: e.message }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  } finally {
    await connectionManager.closeConnection();
  }
}

export async function GET(request: NextRequest, props: RouteProps) {
  return handleRequest(request, props);
}

export async function POST(request: NextRequest, props: RouteProps) {
  let body: any = undefined;
  try {
    body = await request.json();
  } catch (error: any) {
    body = undefined;
  }
  return handleRequest(request, props, body);
}
