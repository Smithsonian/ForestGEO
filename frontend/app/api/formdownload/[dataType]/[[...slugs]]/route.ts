import { NextRequest, NextResponse } from 'next/server';
import MapperFactory from '@/config/datamapper';
import { AttributesRDS } from '@/config/sqlrdsdefinitions/core';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import { buildFilterModelStub, buildSearchStub } from '@/components/processors/processormacros';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function GET(_request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const params = await props.params;
  const { dataType, slugs } = params;
  if (!dataType || !slugs) throw new Error('data type or slugs not provided');
  const [schema, plotIDParam, censusIDParam, filterModelParam] = slugs;
  if (!schema) throw new Error('no schema provided');
  const plotID = plotIDParam ? parseInt(plotIDParam) : undefined;
  const censusID = censusIDParam ? parseInt(censusIDParam) : undefined;
  const filterModel = filterModelParam ? JSON.parse(filterModelParam) : undefined;
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
    const results = await connectionManager.executeQuery(query, [schema, params.dataType === 'measurements' ? 'coremeasurements' : params.dataType]);
    columns = results.map((row: any) => row.COLUMN_NAME);
  } catch (e: any) {
    ailogger.error('error: ', e);
    throw new Error(e);
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
          firstname: row.FirstName,
          lastname: row.LastName,
          role: row.RoleName,
          roledescription: row.RoleDescription
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
          spcode: row.SpeciesCode,
          family: row.Family,
          genus: row.Genus,
          species: row.SpeciesName,
          subspecies: row.SubspeciesName,
          idlevel: row.IDLevel,
          authority: row.SpeciesAuthority,
          subspeciesauthority: row.SubspeciesAuthority
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
        JOIN ${schema}.census c ON cq.CensusID = c.CensusID and c.IsActive IS TRUE
        ${searchStub || filterStub ? ` WHERE (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
        results = await connectionManager.executeQuery(query);
        formMappedResults = results.map((row: any) => ({
          quadrat: row.QuadratName,
          startx: row.StartX,
          starty: row.StartY,
          dimx: row.DimensionX,
          dimy: row.DimensionY,
          area: row.Area,
          quadratshape: row.QuadratShape
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
                    SELECT GROUP_CONCAT(a.Code SEPARATOR '; ')
                    FROM ${schema}.cmattributes ca
                    JOIN ${schema}.attributes a ON ca.Code = a.Code
                    WHERE ca.CoreMeasurementID = cm.CoreMeasurementID
                  ) as Codes,
                  (SELECT GROUP_CONCAT(CONCAT(vp.ProcedureName, ':', vp.Description) SEPARATOR '; ')
                   FROM ${schema}.sitespecificvalidations vp
                   JOIN ${schema}.cmverrors cmv ON cmv.ValidationErrorID = vp.ValidationID
                   WHERE cmv.CoreMeasurementID = cm.CoreMeasurementID) AS Errors
              FROM ${schema}.coremeasurements cm
              JOIN ${schema}.census c ON cm.CensusID = c.CensusID and c.IsActive IS TRUE
              JOIN ${schema}.stems st ON st.StemGUID = cm.StemGUID and st.CensusID = c.CensusID and st.IsActive IS TRUE
              JOIN ${schema}.trees t ON t.TreeID = st.TreeID and t.CensusID = c.CensusID and t.IsActive IS TRUE
              JOIN ${schema}.quadrats q on q.QuadratID = st.QuadratID and q.IsActive is true
              JOIN ${schema}.plots p ON p.PlotID = q.PlotID
              JOIN ${schema}.species sp ON sp.SpeciesID = t.SpeciesID
              WHERE p.PlotID = ? AND cm.CensusID = ? ${
                filterModel.visible.length > 0
                  ? ` AND (${filterModel.visible
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
                      .filter(Boolean)
                      .join(' OR ')})`
                  : ''
              } 
              ${
                filterModel.tss.length > 0
                  ? ` AND (${filterModel.tss
                      .map((tss: any) => `JSON_CONTAINS(UserDefinedFields, JSON_QUOTE('${tss}'), '$.treestemstate') = 1`)
                      .filter(Boolean)
                      .join(' OR ')})`
                  : ``
              } 
              ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
        results = await connectionManager.executeQuery(query, [censusID, plotID]);
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
      default:
        throw new Error('incorrect data type passed in');
    }
  } catch (e: any) {
    throw new Error(e);
  } finally {
    await connectionManager.closeConnection();
  }
}
