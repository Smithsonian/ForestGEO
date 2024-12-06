import { NextRequest, NextResponse } from 'next/server';
import MapperFactory from '@/config/datamapper';
import { AttributesRDS } from '@/config/sqlrdsdefinitions/core';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';

export async function GET(_request: NextRequest, { params }: { params: { dataType: string; slugs?: string[] } }) {
  const { dataType, slugs } = params;
  if (!dataType || !slugs) throw new Error('data type or slugs not provided');
  const [schema, plotIDParam, censusIDParam] = slugs;
  if (!schema) throw new Error('no schema provided');

  const plotID = plotIDParam ? parseInt(plotIDParam) : undefined;
  const censusID = censusIDParam ? parseInt(censusIDParam) : undefined;

  const connectionManager = ConnectionManager.getInstance();
  let query: string = '';
  let results: any[] = [];
  let mappedResults: any[] = [];
  let formMappedResults: any[] = [];
  try {
    switch (dataType) {
      case 'attributes':
        query = `SELECT * FROM ${schema}.attributes`;
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
          WHERE c.PlotID = ? AND p.CensusID = ?`;
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
          WHERE q.PlotID = ? AND cq.CensusID = ?`;
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
          WHERE q.PlotID = ? AND cq.CensusID = ?`;
        results = await connectionManager.executeQuery(query, [plotID, censusID]);
        formMappedResults = results.map((row: any) => ({
          quadrat: row.QuadratName,
          startx: row.StartX,
          starty: row.StartY,
          coordinateunit: row.CoordinateUnits,
          dimx: row.DimensionX,
          dimy: row.DimensionY,
          dimensionunit: row.DimensionUnits,
          area: row.Area,
          areaunit: row.AreaUnits,
          quadratshape: row.QuadratShape
        }));
        return new NextResponse(JSON.stringify(formMappedResults), { status: HTTPResponses.OK });
      case 'measurements':
        query = `SELECT st.StemTag AS StemTag, t.TreeTag AS TreeTag, s.SpeciesCode AS SpeciesCode, q.QuadratName AS QuadratName, 
          st.LocalX AS StartX, st.LocalY AS StartY, q.CoordinateUnits AS CoordinateUnits, cm.MeasuredDBH AS MeasuredDBH, cm.DBHUnit AS DBHUnit, 
          cm.MeasuredHOM AS MeasuredHOM, cm.HOMUnit AS HOMUnit, cm.MeasurementDate AS MeasurementDate, 
          (SELECT GROUP_CONCAT(ca.Code SEPARATOR '; ')
            FROM ${schema}.cmattributes ca
            WHERE ca.CoreMeasurementID = cm.CoreMeasurementID) AS Codes 
          FROM ${schema}.coremeasurements cm 
          JOIN ${schema}.stems st ON st.StemID = cm.StemID 
          JOIN ${schema}.trees t ON t.TreeID = st.TreeID 
          JOIN ${schema}.quadrats q ON q.QuadratID = st.QuadratID 
          JOIN ${schema}.censusquadrat cq ON cq.QuadratID = q.QuadratID 
          JOIN ${schema}.species s ON s.SpeciesID = t.SpeciesID 
          WHERE q.PlotID = ? AND cq.CensusID = ?`;
        results = await connectionManager.executeQuery(query, [plotID, censusID]);
        formMappedResults = results.map((row: any) => ({
          tag: row.TreeTag,
          stemtag: row.StemTag,
          spcode: row.SpeciesCode,
          quadrat: row.QuadratName,
          lx: row.StartX,
          ly: row.StartY,
          coordinateunit: row.CoordinateUnits,
          dbh: row.MeasuredDBH,
          dbhunit: row.DBHUnit,
          hom: row.MeasuredHOM,
          homunit: row.HOMUnit,
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
