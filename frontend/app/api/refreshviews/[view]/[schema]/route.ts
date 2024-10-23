import { getConn, runQuery } from '@/components/processors/processormacros';
import { HTTPResponses } from '@/config/macros';
import { PoolConnection } from 'mysql2/promise';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(_request: NextRequest, { params }: { params: { view: string; schema: string } }) {
  if (!params.schema || params.schema === 'undefined' || !params.view || params.view === 'undefined' || !params) throw new Error('schema not provided');
  const { view, schema } = params;
  let connection: PoolConnection | null = null;
  try {
    connection = await getConn();
    // const query = `CALL ${schema}.Refresh${view === 'viewfulltable' ? 'ViewFullTable' : view === 'measurementssummary' ? 'MeasurementsSummary' : ''}();`;
    if (view === 'measurementssummary') {
      const trunc = `TRUNCATE TABLE ${schema}.measurementssummary;`;
      await runQuery(connection, trunc);
      const query = `
    INSERT INTO ${schema}.measurementssummary
    SELECT cm.CoreMeasurementID                                AS CoreMeasurementID,
           st.StemID                                           AS StemID,
           t.TreeID                                            AS TreeID,
           s.SpeciesID                                         AS SpeciesID,
           q.QuadratID                                         AS QuadratID,
           q.PlotID                                            AS PlotID,
           cm.CensusID                                         AS CensusID,
           s.SpeciesName                                       AS SpeciesName,
           s.SubspeciesName                                    AS SubspeciesName,
           s.SpeciesCode                                       AS SpeciesCode,
           t.TreeTag                                           AS TreeTag,
           st.StemTag                                          AS StemTag,
           st.LocalX                                           AS StemLocalX,
           st.LocalY                                           AS StemLocalY,
           st.CoordinateUnits                                  AS StemUnits,
           q.QuadratName                                       AS QuadratName,
           cm.MeasurementDate                                  AS MeasurementDate,
           cm.MeasuredDBH                                      AS MeasuredDBH,
           cm.DBHUnit                                          AS DBHUnits,
           cm.MeasuredHOM                                      AS MeasuredHOM,
           cm.HOMUnit                                          AS HOMUnits,
           cm.IsValidated                                      AS IsValidated,
           cm.Description                                      AS Description,
           (SELECT GROUP_CONCAT(ca.Code SEPARATOR '; ')
            FROM cmattributes ca
            WHERE ca.CoreMeasurementID = cm.CoreMeasurementID) AS Attributes
    FROM ${schema}.coremeasurements cm
             LEFT JOIN ${schema}.stems st ON cm.StemID = st.StemID
             LEFT JOIN ${schema}.trees t ON st.TreeID = t.TreeID
             LEFT JOIN ${schema}.species s ON t.SpeciesID = s.SpeciesID
             LEFT JOIN ${schema}.quadrats q ON st.QuadratID = q.QuadratID
             LEFT JOIN ${schema}.census c ON cm.CensusID = c.CensusID;`;
      await runQuery(connection, query);
    } else {
      const trunc = `TRUNCATE TABLE ${schema}.viewfulltable;`;
      await runQuery(connection, trunc);
      const query = `INSERT INTO ${schema}.viewfulltable (
        CoreMeasurementID, MeasurementDate, MeasuredDBH, DBHUnits, MeasuredHOM, HOMUnits, Description, IsValidated,
        PlotID, PlotName, LocationName, CountryName, DimensionX, DimensionY, PlotDimensionUnits, PlotArea, PlotAreaUnits,
        PlotGlobalX, PlotGlobalY, PlotGlobalZ, PlotCoordinateUnits, PlotShape, PlotDescription, CensusID,
        CensusStartDate, CensusEndDate, CensusDescription, PlotCensusNumber, QuadratID, QuadratName, QuadratDimensionX,
        QuadratDimensionY, QuadratDimensionUnits, QuadratArea, QuadratAreaUnits, QuadratStartX, QuadratStartY,
        QuadratCoordinateUnits, QuadratShape, SubquadratID, SubquadratName, SubquadratDimensionX, SubquadratDimensionY,
        SubquadratDimensionUnits, SubquadratX, SubquadratY, SubquadratCoordinateUnits, TreeID, TreeTag, StemID, StemTag,
        StemLocalX, StemLocalY, StemCoordinateUnits, PersonnelID, FirstName, LastName, PersonnelRoles, SpeciesID,
        SpeciesCode, SpeciesName, SubspeciesName, SubspeciesAuthority, SpeciesIDLevel, GenusID, Genus, GenusAuthority,
        FamilyID, Family, AttributeCode, AttributeDescription, AttributeStatus
    )
    SELECT
        cm.CoreMeasurementID AS CoreMeasurementID,
        cm.MeasurementDate AS MeasurementDate,
        cm.MeasuredDBH AS MeasuredDBH,
        cm.DBHUnit AS DBHUnits,
        cm.MeasuredHOM AS MeasuredHOM,
        cm.HOMUnit AS HOMUnits,
        cm.Description AS Description,
        cm.IsValidated AS IsValidated,
        p.PlotID AS PlotID,
        p.PlotName AS PlotName,
        p.LocationName AS LocationName,
        p.CountryName AS CountryName,
        p.DimensionX AS DimensionX,
        p.DimensionY AS DimensionY,
        p.DimensionUnits AS PlotDimensionUnits,
        p.Area AS PlotArea,
        p.AreaUnits AS PlotAreaUnits,
        p.GlobalX AS PlotGlobalX,
        p.GlobalY AS PlotGlobalY,
        p.GlobalZ AS PlotGlobalZ,
        p.CoordinateUnits AS PlotCoordinateUnits,
        p.PlotShape AS PlotShape,
        p.PlotDescription AS PlotDescription,
        c.CensusID AS CensusID,
        c.StartDate AS CensusStartDate,
        c.EndDate AS CensusEndDate,
        c.Description AS CensusDescription,
        c.PlotCensusNumber AS PlotCensusNumber,
        q.QuadratID AS QuadratID,
        q.QuadratName AS QuadratName,
        q.DimensionX AS QuadratDimensionX,
        q.DimensionY AS QuadratDimensionY,
        q.DimensionUnits AS QuadratDimensionUnits,
        q.Area AS QuadratArea,
        q.AreaUnits AS QuadratAreaUnits,
        q.StartX AS QuadratStartX,
        q.StartY AS QuadratStartY,
        q.CoordinateUnits AS QuadratCoordinateUnits,
        q.QuadratShape AS QuadratShape,
        sq.SubquadratID AS SubquadratID,
        sq.SubquadratName AS SubquadratName,
        sq.DimensionX AS SubquadratDimensionX,
        sq.DimensionY AS SubquadratDimensionY,
        sq.DimensionUnits AS SubquadratDimensionUnits,
        sq.QX AS SubquadratX,
        sq.QY AS SubquadratY,
        sq.CoordinateUnits AS SubquadratCoordinateUnits,
        t.TreeID AS TreeID,
        t.TreeTag AS TreeTag,
        s.StemID AS StemID,
        s.StemTag AS StemTag,
        s.LocalX AS StemLocalX,
        s.LocalY AS StemLocalY,
        s.CoordinateUnits AS StemCoordinateUnits,
        pr.PersonnelID AS PersonnelID,
        pr.FirstName AS FirstName,
        pr.LastName AS LastName,
        r.RoleName AS PersonnelRoles,
        sp.SpeciesID AS SpeciesID,
        sp.SpeciesCode AS SpeciesCode,
        sp.SpeciesName AS SpeciesName,
        sp.SubspeciesName AS SubspeciesName,
        sp.SubspeciesAuthority AS SubspeciesAuthority,
        sp.IDLevel AS SpeciesIDLevel,
        g.GenusID AS GenusID,
        g.Genus AS Genus,
        g.GenusAuthority AS GenusAuthority,
        f.FamilyID AS FamilyID,
        f.Family AS Family,
        ca.Code AS AttributeCode,
        a.Description AS AttributeDescription,
        a.Status AS AttributeStatus
    FROM ${schema}.coremeasurements cm
    LEFT JOIN ${schema}.stems s ON cm.StemID = s.StemID
    LEFT JOIN ${schema}.trees t ON s.TreeID = t.TreeID
    LEFT JOIN ${schema}.species sp ON t.SpeciesID = sp.SpeciesID
    LEFT JOIN ${schema}.genus g ON sp.GenusID = g.GenusID
    LEFT JOIN ${schema}.family f ON g.FamilyID = f.FamilyID 
    LEFT JOIN ${schema}.quadrats q ON s.QuadratID = q.QuadratID
    LEFT JOIN ${schema}.plots p ON q.PlotID = p.PlotID
    LEFT JOIN ${schema}.census c ON cm.CensusID = c.CensusID
    LEFT JOIN ${schema}.personnel pr ON pr.CensusID = cm.CensusID
    LEFT JOIN ${schema}.roles r ON pr.RoleID = r.RoleID
    LEFT JOIN ${schema}.cmattributes ca ON ca.CoreMeasurementID = cm.CoreMeasurementID
    LEFT JOIN ${schema}.attributes a ON a.Code = ca.Code;`;
      await runQuery(connection, query);
    }
    connection.release();
    return new NextResponse(null, { status: HTTPResponses.OK });
  } catch (e: any) {
    console.error('Error:', e);
    throw new Error('Call failed: ', e);
  } finally {
    if (connection) connection.release();
  }
}
