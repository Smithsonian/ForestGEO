create
definer = azureroot@`%` procedure RefreshMeasurementsSummary()
BEGIN
TRUNCATE TABLE measurementssummary;
INSERT INTO measurementssummary
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
FROM coremeasurements cm
         LEFT JOIN stems st ON cm.StemID = st.StemID
         LEFT JOIN trees t ON st.TreeID = t.TreeID
         LEFT JOIN species s ON t.SpeciesID = s.SpeciesID
         LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
         LEFT JOIN census c ON cm.CensusID = c.CensusID;
END;

