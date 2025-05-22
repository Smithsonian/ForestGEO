import { NextRequest, NextResponse } from 'next/server';
import MapperFactory from '@/config/datamapper';
import { AttributesRDS } from '@/config/sqlrdsdefinitions/core';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import { buildFilterModelStub, buildSearchStub } from '@/components/processors/processormacros';

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
    console.log('error: ', e);
    throw new Error(e);
  }
  if (filterModel !== undefined && filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues);
  if (filterModel !== undefined && filterModel.items) filterStub = buildFilterModelStub(filterModel);
  try {
    switch (dataType) {
      case 'attributes':
        query = `SELECT 
          av.Code         AS code,
          av.Description  AS description,
          av.Status       AS status
        FROM ${schema}.attributesversioning AS av
        JOIN ${schema}.censusattributes AS ca
          ON av.AttributesVersioningID = ca.AttributesVersioningID
        JOIN ${schema}.census c ON ca.CensusID = c.CensusID and c.IsActive IS TRUE 
        WHERE c.PlotID = ? AND c.CensusID = ? ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
        results = await connectionManager.executeQuery(query, [plotID, censusID]);
        mappedResults = MapperFactory.getMapper<any, any>('attributes').mapData(results);
        formMappedResults = mappedResults.map((row: AttributesRDS) => ({
          code: row.code,
          description: row.description,
          status: row.status
        }));
        return new NextResponse(JSON.stringify(formMappedResults), { status: HTTPResponses.OK });
      case 'personnel':
        query = `SELECT 
          pv.FirstName       AS firstname,
          pv.LastName        AS lastname,
          r.RoleName         AS role,
          r.RoleDescription  AS roledescription
        FROM ${schema}.personnelversioning AS pv
        JOIN ${schema}.censuspersonnel AS cp
          ON pv.PersonnelVersioningID = cp.PersonnelVersioningID
        JOIN ${schema}.census c ON cp.CensusID = c.CensusID and c.IsActive IS TRUE
        JOIN ${schema}.roles AS r
          ON pv.RoleID = r.RoleID
        WHERE c.PlotID = ? AND c.CensusID = ? ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
        results = await connectionManager.executeQuery(query, [plotID, censusID]);
        formMappedResults = results.map((row: any) => ({
          firstname: row.FirstName,
          lastname: row.LastName,
          role: row.RoleName,
          roledescription: row.RoleDescription
        }));
        return new NextResponse(JSON.stringify(formMappedResults), { status: HTTPResponses.OK });
      case 'species':
        query = `SELECT DISTINCT
          sv.SpeciesCode         AS spcode,
          f.Family               AS family,
          g.Genus                AS genus,
          sv.SpeciesName         AS species,
          sv.SubspeciesName      AS subspecies,
          sv.IDLevel             AS idlevel,
          sv.SpeciesAuthority    AS authority,
          sv.SubspeciesAuthority AS subspeciesauthority
        FROM ${schema}.speciesversioning AS sv
        JOIN ${schema}.censusspecies AS cs
          ON sv.SpeciesVersioningID = cs.SpeciesVersioningID
        JOIN ${schema}.census c ON cs.CensusID = c.CensusID and c.IsActive IS TRUE
        LEFT JOIN ${schema}.genus AS g
          ON sv.GenusID = g.GenusID
        LEFT JOIN ${schema}.family AS f
          ON g.FamilyID = f.FamilyID
        WHERE c.PlotID = ? AND c.CensusID = ? ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
        results = await connectionManager.executeQuery(query, [plotID, censusID]);
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
          qv.QuadratName  AS quadrat,
          qv.StartX       AS startx,
          qv.StartY       AS starty,
          qv.DimensionX   AS dimx,
          qv.DimensionY   AS dimy,
          qv.Area         AS area,
          qv.QuadratShape AS quadratshape
        FROM ${schema}.quadratsversioning AS qv
        JOIN ${schema}.censusquadrats AS cq
          ON qv.QuadratsVersioningID = cq.QuadratsVersioningID
        JOIN ${schema}.census c ON cq.CensusID = c.CensusID and c.IsActive IS TRUE
        WHERE c.PlotID = ? AND c.CensusID = ? ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
        results = await connectionManager.executeQuery(query, [plotID, censusID]);
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
        query = `SELECT  st.StemTag                                   AS StemTag,
                  t.TreeTag                                           AS TreeTag,
                  sv.SpeciesCode                                       AS SpeciesCode,
                  qv.QuadratName                                       AS QuadratName,
                  st.LocalX                                           AS StartX,
                  st.LocalY                                           AS StartY,
                  cm.MeasuredDBH                                      AS MeasuredDBH,
                  cm.MeasuredHOM                                      AS MeasuredHOM,
                  cm.MeasurementDate                                  AS MeasurementDate,
                  (
                    SELECT GROUP_CONCAT(av.Code SEPARATOR '; ')
                    FROM ${schema}.cmattributes ca
                    JOIN ${schema}.censusattributes cav ON cav.Code = ca.Code AND cav.CensusID = ?
                    JOIN ${schema}.attributesversioning av ON av.AttributesVersioningID = cav.AttributesVersioningID
                    WHERE ca.CoreMeasurementID = cm.CoreMeasurementID
                  ) as Codes,
                  (SELECT GROUP_CONCAT(CONCAT(vp.ProcedureName, ':', vp.Description) SEPARATOR '; ')
                   FROM ${schema}.sitespecificvalidations vp
                   JOIN ${schema}.cmverrors cmv ON cmv.ValidationErrorID = vp.ValidationID
                   WHERE cmv.CoreMeasurementID = cm.CoreMeasurementID) AS Errors
              FROM ${schema}.coremeasurements cm
              JOIN ${schema}.stems st ON st.StemID = cm.StemID
              JOIN ${schema}.treesversioning tv ON tv.TreeID = st.TreeID
              JOIN ${schema}.censusquadrats cq ON cq.QuadratID = st.QuadratID AND cq.CensusID = ?
              JOIN ${schema}.quadratsversioning qv ON qv.QuadratsVersioningID = cq.QuadratsVersioningID
              JOIN ${schema}.plots p ON p.PlotID = qv.PlotID
              JOIN ${schema}.censusspecies AS cs ON cs.SpeciesID = t.SpeciesID AND cs.CensusID   = ?
              JOIN ${schema}.speciesversioning sv ON sv.SpeciesVersioningID = cs.SpeciesVersioningID
              JOIN ${schema}.census c ON cq.CensusID = c.CensusID AND cs.CensusID = c.CensusID AND c.IsActive IS TRUE
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
        results = await connectionManager.executeQuery(query, [censusID, censusID, censusID, plotID, censusID]);
        formMappedResults = results.map((row: any) => ({
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
