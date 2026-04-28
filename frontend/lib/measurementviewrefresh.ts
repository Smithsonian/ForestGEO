import type ConnectionManager from '@/config/connectionmanager';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

export async function refreshMeasurementsSummaryForScope(
  connectionManager: ConnectionManager,
  schema: string,
  plotID: number,
  censusID: number,
  transactionID?: string
): Promise<void> {
  const deleteQuery = safeFormatQuery(schema, 'DELETE FROM ??.measurementssummary WHERE PlotID = ? AND CensusID = ?');
  await connectionManager.executeQuery(deleteQuery, [plotID, censusID], transactionID);

  const insertQuery = safeFormatQuery(
    schema,
    `INSERT IGNORE INTO ??.measurementssummary (CoreMeasurementID,
                                                StemGUID,
                                                TreeID,
                                                SpeciesID,
                                                QuadratID,
                                                PlotID,
                                                CensusID,
                                                SpeciesName,
                                                SubspeciesName,
                                                SpeciesCode,
                                                TreeTag,
                                                StemTag,
                                                StemLocalX,
                                                StemLocalY,
                                                QuadratName,
                                                MeasurementDate,
                                                MeasuredDBH,
                                                MeasuredHOM,
                                                IsValidated,
                                                Description,
                                                Attributes,
                                                RawCodes,
                                                UserDefinedFields,
                                                Errors)
     SELECT cm.CoreMeasurementID                                 AS CoreMeasurementID,
            COALESCE(st.StemGUID, cm.StemGUID)                   AS StemGUID,
            t.TreeID                                             AS TreeID,
            sp.SpeciesID                                         AS SpeciesID,
            q.QuadratID                                          AS QuadratID,
            COALESCE(q.PlotID, c.PlotID, 0)                      AS PlotID,
            COALESCE(cm.CensusID, 0)                             AS CensusID,
            sp.SpeciesName                                       AS SpeciesName,
            sp.SubspeciesName                                    AS SubspeciesName,
            COALESCE(sp.SpeciesCode, cm.RawSpCode)               AS SpeciesCode,
            COALESCE(t.TreeTag, cm.RawTreeTag)                   AS TreeTag,
            COALESCE(st.StemTag, cm.RawStemTag)                  AS StemTag,
            COALESCE(st.LocalX, cm.RawX)                         AS StemLocalX,
            COALESCE(st.LocalY, cm.RawY)                         AS StemLocalY,
            COALESCE(q.QuadratName, cm.RawQuadrat)               AS QuadratName,
            cm.MeasurementDate                                   AS MeasurementDate,
            cm.MeasuredDBH                                       AS MeasuredDBH,
            cm.MeasuredHOM                                       AS MeasuredHOM,
            cm.IsValidated                                       AS IsValidated,
            cm.Description                                       AS Description,
            attr_summary.Attributes                              AS Attributes,
            cm.RawCodes                                          AS RawCodes,
            cm.UserDefinedFields                                 AS UserDefinedFields,
            validation_errors.Errors                             AS Errors
     FROM ??.coremeasurements cm
              JOIN ??.census c ON cm.CensusID = c.CensusID
              LEFT JOIN ??.stems st ON cm.StemGUID = st.StemGUID AND st.CensusID = c.CensusID
              LEFT JOIN ??.trees t ON t.CensusID = c.CensusID AND t.TreeID = st.TreeID
              LEFT JOIN ??.species sp ON t.SpeciesID = sp.SpeciesID
              LEFT JOIN ??.quadrats q ON q.QuadratID = st.QuadratID
              LEFT JOIN (
                  SELECT ca.CoreMeasurementID,
                         GROUP_CONCAT(DISTINCT a.Code SEPARATOR '; ') AS Attributes
                  FROM ??.cmattributes ca
                           LEFT JOIN ??.attributes a ON a.Code = ca.Code
                  GROUP BY ca.CoreMeasurementID
              ) attr_summary ON attr_summary.CoreMeasurementID = cm.CoreMeasurementID
              LEFT JOIN (
                  SELECT mel.MeasurementID,
                         GROUP_CONCAT(
                                 COALESCE(
                                         NULLIF(CONCAT_WS(' -> ', NULLIF(vp.ProcedureName, ''), NULLIF(vp.Description, '')), ''),
                                         me.ErrorMessage
                                 )
                                 ORDER BY me.ErrorCode SEPARATOR ';'
                         ) AS Errors
                  FROM ??.measurement_error_log mel
                           JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
                           LEFT JOIN ??.sitespecificvalidations vp
                                  ON me.ErrorCode = CAST(vp.ValidationID AS CHAR) COLLATE utf8mb4_0900_ai_ci
                  WHERE mel.IsResolved = FALSE
                  GROUP BY mel.MeasurementID
              ) validation_errors ON validation_errors.MeasurementID = cm.CoreMeasurementID
     WHERE c.PlotID = ?
       AND cm.CensusID = ?`
  );

  await connectionManager.executeQuery(insertQuery, [plotID, censusID], transactionID);
}

export async function refreshViewFullTableForScope(
  connectionManager: ConnectionManager,
  schema: string,
  plotID: number,
  censusID: number,
  transactionID?: string
): Promise<void> {
  const deleteQuery = safeFormatQuery(schema, 'DELETE FROM ??.viewfulltable WHERE PlotID = ? AND CensusID = ?');
  await connectionManager.executeQuery(deleteQuery, [plotID, censusID], transactionID);

  const insertQuery = safeFormatQuery(
    schema,
    `INSERT IGNORE INTO ??.viewfulltable (CoreMeasurementID,
                                          MeasurementDate,
                                          MeasuredDBH,
                                          MeasuredHOM,
                                          Description,
                                          IsValidated,
                                          PlotID,
                                          PlotName,
                                          LocationName,
                                          CountryName,
                                          DimensionX,
                                          DimensionY,
                                          PlotArea,
                                          PlotGlobalX,
                                          PlotGlobalY,
                                          PlotGlobalZ,
                                          PlotShape,
                                          PlotDescription,
                                          PlotDefaultDimensionUnits,
                                          PlotDefaultCoordinateUnits,
                                          PlotDefaultAreaUnits,
                                          PlotDefaultDBHUnits,
                                          PlotDefaultHOMUnits,
                                          CensusID,
                                          CensusStartDate,
                                          CensusEndDate,
                                          CensusDescription,
                                          PlotCensusNumber,
                                          QuadratID,
                                          QuadratName,
                                          QuadratDimensionX,
                                          QuadratDimensionY,
                                          QuadratArea,
                                          QuadratStartX,
                                          QuadratStartY,
                                          QuadratShape,
                                          TreeID,
                                          TreeTag,
                                          StemGUID,
                                          StemTag,
                                          StemLocalX,
                                          StemLocalY,
                                          SpeciesID,
                                          SpeciesCode,
                                          SpeciesName,
                                          SubspeciesName,
                                          SubspeciesAuthority,
                                          SpeciesIDLevel,
                                          GenusID,
                                          Genus,
                                          GenusAuthority,
                                          FamilyID,
                                          Family,
                                          Attributes,
                                          RawCodes,
                                          UserDefinedFields)
     SELECT cm.CoreMeasurementID                                AS CoreMeasurementID,
            cm.MeasurementDate                                  AS MeasurementDate,
            cm.MeasuredDBH                                      AS MeasuredDBH,
            cm.MeasuredHOM                                      AS MeasuredHOM,
            cm.Description                                      AS Description,
            cm.IsValidated                                      AS IsValidated,
            p.PlotID                                            AS PlotID,
            p.PlotName                                          AS PlotName,
            p.LocationName                                      AS LocationName,
            p.CountryName                                       AS CountryName,
            p.DimensionX                                        AS DimensionX,
            p.DimensionY                                        AS DimensionY,
            p.Area                                              AS PlotArea,
            p.GlobalX                                           AS PlotGlobalX,
            p.GlobalY                                           AS PlotGlobalY,
            p.GlobalZ                                           AS PlotGlobalZ,
            p.PlotShape                                         AS PlotShape,
            p.PlotDescription                                   AS PlotDescription,
            p.DefaultDimensionUnits                             AS PlotDimensionUnits,
            p.DefaultCoordinateUnits                            AS PlotCoordinateUnits,
            p.DefaultAreaUnits                                  AS PlotAreaUnits,
            p.DefaultDBHUnits                                   AS PlotDefaultDBHUnits,
            p.DefaultHOMUnits                                   AS PlotDefaultHOMUnits,
            c.CensusID                                          AS CensusID,
            c.StartDate                                         AS CensusStartDate,
            c.EndDate                                           AS CensusEndDate,
            c.Description                                       AS CensusDescription,
            c.PlotCensusNumber                                  AS PlotCensusNumber,
            q.QuadratID                                         AS QuadratID,
            COALESCE(q.QuadratName, cm.RawQuadrat)              AS QuadratName,
            q.DimensionX                                        AS QuadratDimensionX,
            q.DimensionY                                        AS QuadratDimensionY,
            q.Area                                              AS QuadratArea,
            q.StartX                                            AS QuadratStartX,
            q.StartY                                            AS QuadratStartY,
            q.QuadratShape                                      AS QuadratShape,
            t.TreeID                                            AS TreeID,
            COALESCE(t.TreeTag, cm.RawTreeTag)                  AS TreeTag,
            COALESCE(s.StemGUID, cm.StemGUID)                   AS StemGUID,
            COALESCE(s.StemTag, cm.RawStemTag)                  AS StemTag,
            COALESCE(s.LocalX, cm.RawX)                         AS StemLocalX,
            COALESCE(s.LocalY, cm.RawY)                         AS StemLocalY,
            sp.SpeciesID                                        AS SpeciesID,
            COALESCE(sp.SpeciesCode, cm.RawSpCode)              AS SpeciesCode,
            sp.SpeciesName                                      AS SpeciesName,
            sp.SubspeciesName                                   AS SubspeciesName,
            sp.SubspeciesAuthority                              AS SubspeciesAuthority,
            sp.IDLevel                                          AS SpeciesIDLevel,
            g.GenusID                                           AS GenusID,
            g.Genus                                             AS Genus,
            g.GenusAuthority                                    AS GenusAuthority,
            f.FamilyID                                          AS FamilyID,
            f.Family                                            AS Family,
            view_attrs.Attributes                               AS Attributes,
            cm.RawCodes                                         AS RawCodes,
            cm.UserDefinedFields                                AS UserDefinedFields
     FROM ??.coremeasurements cm
              JOIN ??.census c ON cm.CensusID = c.CensusID
              LEFT JOIN ??.stems s ON cm.StemGUID = s.StemGUID AND s.CensusID = c.CensusID
              LEFT JOIN ??.trees t ON s.TreeID = t.TreeID AND t.CensusID = c.CensusID
              LEFT JOIN ??.species sp ON t.SpeciesID = sp.SpeciesID
              LEFT JOIN ??.genus g ON sp.GenusID = g.GenusID
              LEFT JOIN ??.family f ON g.FamilyID = f.FamilyID
              LEFT JOIN ??.quadrats q ON s.QuadratID = q.QuadratID
              LEFT JOIN ??.plots p ON COALESCE(q.PlotID, c.PlotID) = p.PlotID
              LEFT JOIN (
                  SELECT ca.CoreMeasurementID,
                         GROUP_CONCAT(ca.Code SEPARATOR '; ') AS Attributes
                  FROM ??.cmattributes ca
                  GROUP BY ca.CoreMeasurementID
              ) view_attrs ON view_attrs.CoreMeasurementID = cm.CoreMeasurementID
     WHERE c.PlotID = ?
       AND cm.CensusID = ?`
  );

  await connectionManager.executeQuery(insertQuery, [plotID, censusID], transactionID);
}

export async function refreshMeasurementViewsForScope(
  connectionManager: ConnectionManager,
  schema: string,
  plotID: number,
  censusID: number,
  transactionID?: string
): Promise<void> {
  await refreshMeasurementsSummaryForScope(connectionManager, schema, plotID, censusID, transactionID);
  await refreshViewFullTableForScope(connectionManager, schema, plotID, censusID, transactionID);
}
