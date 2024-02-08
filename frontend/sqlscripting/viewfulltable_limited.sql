CREATE VIEW ViewFullTable AS
SELECT sub_cm.CoreMeasurementID,
       p.PlotName,
       sub_cm.PlotID,
       f.Family,
       g.Genus,
       s.SpeciesName,
       s.SpeciesCode,
       ss.SubSpeciesName,
       ss.SubSpeciesID,
       q.QuadratName,
       sub_cm.QuadratID,
       p.PlotX,
       p.PlotY,
       q.QuadratX,
       q.QuadratY,
       t.TreeID,
       t.TreeTag,
       st.StemID,
       st.StemTag,
       sub_cm.CensusID,
       c.PlotCensusNumber,
       sub_cm.MeasuredDBH,
       sub_cm.MeasuredHOM,
       sub_cm.MeasurementDate,
       GROUP_CONCAT(ca.Code SEPARATOR ';') AS AttributeList,
       a.Status
FROM (SELECT * FROM forestgeo_bci.coremeasurements LIMIT 500) AS sub_cm
         LEFT JOIN forestgeo_bci.plots p ON sub_cm.PlotID = p.PlotID
         LEFT JOIN forestgeo_bci.quadrats q ON sub_cm.QuadratID = q.QuadratID
         LEFT JOIN forestgeo_bci.trees t ON sub_cm.TreeID = t.TreeID
         LEFT JOIN forestgeo_bci.stems st ON sub_cm.StemID = st.StemID
         LEFT JOIN forestgeo_bci.census c ON sub_cm.CensusID = c.CensusID
         LEFT JOIN forestgeo_bci.species s ON t.SpeciesID = s.SpeciesID
         LEFT JOIN forestgeo_bci.genus g ON s.GenusID = g.GenusID
         LEFT JOIN forestgeo_bci.family f ON g.FamilyID = f.FamilyID
         LEFT JOIN forestgeo_bci.subspecies ss ON t.SubSpeciesID = ss.SubSpeciesID
         LEFT JOIN forestgeo_bci.cmattributes ca ON sub_cm.CoreMeasurementID = ca.CoreMeasurementID
         LEFT JOIN forestgeo_bci.attributes a ON ca.Code = a.Code
GROUP BY sub_cm.CoreMeasurementID, p.PlotName, sub_cm.PlotID, f.Family, g.Genus, s.SpeciesName, s.SpeciesCode,
         ss.SubSpeciesName, ss.SubSpeciesID, q.QuadratName, sub_cm.QuadratID, p.PlotX, p.PlotY, q.QuadratX, q.QuadratY,
         t.TreeID, t.TreeTag, st.StemID, st.StemTag, sub_cm.CensusID, c.PlotCensusNumber, sub_cm.MeasuredDBH,
         sub_cm.MeasuredHOM, sub_cm.MeasurementDate, a.Status
