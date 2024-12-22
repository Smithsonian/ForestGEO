import { NextRequest, NextResponse } from 'next/server';
import MapperFactory from '@/config/datamapper';
import { AttributesRDS } from '@/config/sqlrdsdefinitions/core';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import { GridFilterItem, GridFilterModel } from '@mui/x-data-grid';
import { escape } from 'mysql2';

const buildFilterModelStub = (filterModel: GridFilterModel, alias?: string) => {
  if (!filterModel.items || filterModel.items.length === 0) {
    return '';
  }

  return filterModel.items
    .map((item: GridFilterItem) => {
      const { field, operator, value } = item;
      const aliasedField = `${alias ? `${alias}.` : ''}${field}`;
      const escapedValue = escape(`%${value}%`); // Handle escaping
      return `${aliasedField} ${operator} ${escapedValue}`;
    })
    .join(` ${filterModel?.logicOperator?.toUpperCase() || 'AND'} `);
};

const buildSearchStub = (columns: string[], quickFilter: string[], alias?: string) => {
  if (!quickFilter || quickFilter.length === 0) {
    return ''; // Return empty if no quick filters
  }

  return columns
    .map(column => {
      const aliasedColumn = `${alias ? `${alias}.` : ''}${column}`;
      return quickFilter.map(word => `${aliasedColumn} LIKE ${escape(`%${word}%`)}`).join(' OR ');
    })
    .join(' OR ');
};

export async function GET(_request: NextRequest, { params }: { params: { dataType: string; slugs?: string[] } }) {
  const { dataType, slugs } = params;
  if (!dataType || !slugs) throw new Error('data type or slugs not provided');
  const [schema, plotIDParam, censusIDParam, filterModelParam] = slugs; // filtration system is optional
  if (!schema) throw new Error('no schema provided');

  const plotID = plotIDParam ? parseInt(plotIDParam) : undefined;
  const censusID = censusIDParam ? parseInt(censusIDParam) : undefined;
  const filterModel = filterModelParam ? JSON.parse(filterModelParam) : undefined;
  console.log('filter model: ', filterModel);

  const connectionManager = ConnectionManager.getInstance();
  let query: string = '';
  let results: any[] = [];
  let mappedResults: any[] = [];
  let formMappedResults: any[] = [];
  let searchStub = '';
  let filterStub = '';
  let columns: any[] = [];
  try {
    const query = `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? 
      AND COLUMN_NAME NOT LIKE '%id%' AND COLUMN_NAME NOT LIKE '%uuid%' AND COLUMN_NAME NOT LIKE 'id%'  AND COLUMN_NAME NOT LIKE '%_id' `;
    const results = await connectionManager.executeQuery(query, [schema, params.dataType === 'measurements' ? 'coremeasurements' : params.dataType]);
    columns = results.map((row: any) => row.COLUMN_NAME);
  } catch (e: any) {
    console.log('error: ', e);
    throw new Error(e);
  }
  if (filterModel.quickFilterValues) searchStub = buildSearchStub(columns, filterModel.quickFilterValues);
  if (filterModel.items) filterStub = buildFilterModelStub(filterModel);
  try {
    switch (dataType) {
      case 'attributes':
        query = `SELECT * FROM ${schema}.attributes ${searchStub || filterStub ? ` WHERE (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
        results = await connectionManager.executeQuery(query);
        mappedResults = MapperFactory.getMapper<any, any>('attributes').mapData(results);
        formMappedResults = mappedResults.map((row: AttributesRDS) => ({
          code: row.code,
          description: row.description,
          status: row.status
        }));
        return new NextResponse(JSON.stringify(formMappedResults), { status: HTTPResponses.OK });
      case 'personnel':
        query = `SELECT p.FirstName AS FirstName, p.LastName AS LastName, r.RoleName AS RoleName, r.RoleDescription AS RoleDescription  
          FROM ${schema}.personnel p 
          LEFT JOIN ${schema}.roles r ON p.RoleID = r.RoleID 
          LEFT JOIN ${schema}.census c ON c.CensusID = p.CensusID 
          WHERE c.PlotID = ? AND p.CensusID = ? ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
        results = await connectionManager.executeQuery(query, [plotID, censusID]);
        formMappedResults = results.map((row: any) => ({
          firstname: row.FirstName,
          lastname: row.LastName,
          role: row.RoleName,
          roledescription: row.RoleDescription
        }));
        return new NextResponse(JSON.stringify(formMappedResults), { status: HTTPResponses.OK });
      case 'species':
        query = `SELECT DISTINCT s.SpeciesCode AS SpeciesCode, f.Family AS Family, 
          g.Genus AS Genus, s.SpeciesName AS SpeciesName, s.SubspeciesName AS SubspeciesName, 
          s.IDLevel AS IDLevel, s.SpeciesAuthority AS SpeciesAuthority, s.SubspeciesAuthority AS SubspeciesAuthority  
          FROM ${schema}.species s 
          JOIN ${schema}.genus g ON g.GenusID = s.GenusID 
          JOIN ${schema}.family f ON f.FamilyID = g.FamilyID 
          JOIN ${schema}.trees t ON t.SpeciesID = s.SpeciesID 
          JOIN ${schema}.stems st ON st.TreeID = t.TreeID 
          JOIN ${schema}.quadrats q ON q.QuadratID = st.QuadratID 
          JOIN ${schema}.censusquadrat cq ON cq.QuadratID = q.QuadratID 
          WHERE q.PlotID = ? AND cq.CensusID = ? ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
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
        query = `SELECT * FROM ${schema}.quadrats q 
          JOIN ${schema}.censusquadrat cq ON cq.QuadratID = q.QuadratID 
          WHERE q.PlotID = ? AND cq.CensusID = ? ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
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
        query = `SELECT st.StemTag AS StemTag, t.TreeTag AS TreeTag, s.SpeciesCode AS SpeciesCode, q.QuadratName AS QuadratName, 
          st.LocalX AS StartX, st.LocalY AS StartY,  cm.MeasuredDBH AS MeasuredDBH, cm.MeasuredHOM AS MeasuredHOM, 
          cm.MeasurementDate AS MeasurementDate, 
          (SELECT GROUP_CONCAT(ca.Code SEPARATOR '; ')
            FROM ${schema}.cmattributes ca
            WHERE ca.CoreMeasurementID = cm.CoreMeasurementID) AS Codes
          FROM ${schema}.coremeasurements cm 
          JOIN ${schema}.stems st ON st.StemID = cm.StemID 
          JOIN ${schema}.trees t ON t.TreeID = st.TreeID 
          JOIN ${schema}.quadrats q ON q.QuadratID = st.QuadratID 
          JOIN ${schema}.plots p ON p.PlotID = q.PlotID
          JOIN ${schema}.species s ON s.SpeciesID = t.SpeciesID 
          WHERE p.PlotID = ? AND cm.CensusID = ?
          ${
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
          } ${searchStub || filterStub ? ` AND (${[searchStub, filterStub].filter(Boolean).join(' OR ')})` : ''}`;
        results = await connectionManager.executeQuery(query, [plotID, censusID]);
        // console.log('results: ', results);
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
          codes: row.Codes
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
