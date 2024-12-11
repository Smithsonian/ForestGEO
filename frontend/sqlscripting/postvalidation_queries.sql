truncate postvalidationqueries; -- clear the table if re-running this script on accident
insert into postvalidationqueries
    (QueryName, QueryDefinition, Description, IsEnabled)
values
    ('Number of Records by Quadrat',
     'SELECT q.QuadratName, COUNT(DISTINCT cm.CoreMeasurementID) AS MeasurementCount
      FROM ${schema}.quadrats q
      JOIN ${schema}.censusquadrat cq ON q.QuadratID = cq.QuadratID
      JOIN ${schema}.stems st ON st.QuadratID = q.QuadratID
      JOIN ${schema}.coremeasurements cm ON cm.StemID = st.StemID
      WHERE cm.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID}
      GROUP BY q.QuadratName;',
     'Calculating the number of total records, organized by quadrat',
     true),
    ('Number of ALL Stem Records',
     'SELECT COUNT(s.StemID) AS TotalStems
        FROM ${schema}.stems s
        JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID
        JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
        JOIN ${schema}.attributes a ON cma.Code = a.Code
        JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID
        JOIN ${schema}.censusquadrat cq ON cq.QuadratID = q.QuadratID
        WHERE cq.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID};',
     'Calculating the number of total stem records for the current site, plot, and census',
     true),
    ('Number of all LIVE stem records',
     'SELECT COUNT(s.StemID) AS LiveStems
        FROM ${schema}.stems s
        JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID
        JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
        JOIN ${schema}.attributes a ON cma.Code = a.Code
        JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID
        JOIN ${schema}.censusquadrat cq ON cq.QuadratID = q.QuadratID
        WHERE a.Status = ''alive''
        AND cq.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID};',
     'Calculating the number of all live stem records for the current site, plot, and census', true),
    ('Number of all trees',
     'SELECT COUNT(t.TreeID) AS TotalTrees
        FROM ${schema}.trees t
        JOIN ${schema}.stems s ON s.TreeID = t.TreeID
        JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID
        JOIN ${schema}.censusquadrat cq ON cq.QuadratID = q.QuadratID
        WHERE cq.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID};',
     'Calculating the total number of all trees for the current site, plot, and census', true),
    ('All dead or missing stems and count by census',
     'SELECT cm.CensusID,
        COUNT(s.StemID) AS DeadOrMissingStems,
        GROUP_CONCAT(s.StemID ORDER BY s.StemID) AS DeadOrMissingStemList
        FROM ${schema}.stems s
        JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID
        JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
        JOIN ${schema}.attributes a ON cma.Code = a.Code
        WHERE a.Status IN (''dead'', ''missing'')
        GROUP BY cm.CensusID;',
     'Finds and returns a count of, then all dead or missing stems by census', true),
    ('All trees outside plot limits',
     'SELECT t.TreeID, (s.LocalX + q.StartX + p.GlobalX) AS LocalX, (s.LocalY + q.StartY + p.GlobalY) AS LocalY
        FROM ${schema}.trees t
        JOIN ${schema}.stems s ON t.TreeID = s.TreeID
        JOIN ${schema}.quadrats q ON s.QuadratID = q.QuadratID
        JOIN ${schema}.censusquadrat cq ON cq.QuadratID = q.QuadratID
        JOIN ${schema}.plots p ON q.PlotID = p.PlotID
            WHERE s.LocalX IS NULL
                OR s.LocalY IS NULL
                OR LocalX > (p.GlobalX + p.DimensionX)
                OR LocalY > (p.GlobalY + p.DimensionY)
                AND p.PlotID = ${currentPlotID} AND cq.CensusID = ${currentCensusID};',
     'Finds and returns any trees outside plot limits', true),
    ('Highest DBH measurement and HOM measurement by species',
     'SELECT sp.SpeciesID, sp.SpeciesName, MAX(cm.MeasuredDBH) AS LargestDBH, MAX(cm.MeasuredHOM) AS LargestHOM
        FROM ${schema}.species sp
            JOIN ${schema}.trees t ON sp.SpeciesID = t.SpeciesID
            JOIN ${schema}.stems s ON s.TreeID = t.TreeID
            JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID
            JOIN ${schema}.quadrats q ON s.QuadratID = q.QuadratID
            JOIN ${schema}.censusquadrat cq ON cq.QuadratID = q.QuadratID
            WHERE cq.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID}
        GROUP BY sp.SpeciesID, sp.SpeciesName;',
     'Finds and returns the largest DBH/HOM measurement and their host species ID', true),
    ('Checks that all trees from the last census are present',
     'SELECT t.TreeID, t.TreeTag, t.SpeciesID
         FROM ${schema}.trees t
                  JOIN
              ${schema}.stems s_last ON t.TreeID = s_last.TreeID
                  JOIN
              ${schema}.coremeasurements cm_last ON s_last.StemID = cm_last.StemID
              ${schema}.quadrats q_last ON q.QuadratID = s_last.QuadratID
              ${schema}.censusquadrat cq_last ON cq.QuadratID = q.QuadratID
         WHERE cm_last.CensusID = ${currentCensusID} - 1
        AND cq.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID}
           AND NOT EXISTS (SELECT 1
                           FROM ${schema}.stems s_current
                                    JOIN
                                ${schema}.coremeasurements cm_current ON s_current.StemID = cm_current.StemID
                           WHERE t.TreeID = s_current.TreeID
                             AND cm_current.CensusID = ${currentCensusID})
         GROUP BY t.TreeID, t.TreeTag, t.SpeciesID;',
     'Determining whether all trees accounted for in the last census have new measurements in the "next" measurement',
     true),
    ('Number of new stems, grouped by quadrat, and then by census',
     'SELECT
        q.QuadratName,
        s_current.StemID,
        s_current.StemTag,
        s_current.TreeID,
        s_current.QuadratID,
        s_current.LocalX,
        s_current.LocalY,
            FROM ${schema}.quadrats q
                JOIN ${schema}.stems s_current ON q.QuadratID = s_current.QuadratID
                JOIN ${schema}.coremeasurements cm_current ON s_current.StemID = cm_current.StemID
            WHERE cm_current.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID}
                AND NOT EXISTS (SELECT 1
                    FROM ${schema}.stems s_last
                        JOIN ${schema}.coremeasurements cm_last ON s_last.StemID = cm_last.StemID
                            WHERE s_current.StemID = s_last.StemID
                            AND cm_last.CensusID = ${currentCensusID} - 1)
        ORDER BY q.QuadratName, s_current.StemID;',
     'Finds new stems by quadrat for the current census', true),
    ('Determining which quadrats have the most and least number of new stems for the current census',
     'WITH NewStems AS (SELECT s_current.QuadratName,
                            s_current.StemID
                     FROM ${schema}.stems s_current
                              JOIN
                          ${schema}.coremeasurements cm_current ON s_current.StemID = cm_current.StemID
                     WHERE cm_current.CensusID = ${currentCensusID}
                       AND NOT EXISTS (SELECT 1
                                       FROM ${schema}.stems s_last
                                                JOIN
                                            ${schema}.coremeasurements cm_last ON s_last.StemID = cm_last.StemID
                                       WHERE s_current.StemID = s_last.StemID
                                         AND cm_last.CensusID = ${currentCensusID} - 1)),
        NewStemCounts AS (SELECT q.QuadratID,
                                 q.QuadratName,
                                 COUNT(ns.StemID) AS NewStemCount
                          FROM ${schema}.quadrats q
                                   LEFT JOIN
                               NewStems ns ON q.QuadratID = ns.QuadratID
                          GROUP BY q.QuadratID, q.QuadratName),
        LeastNewStems AS (SELECT ''Least New Stems'' AS StemType,
                                 QuadratName,
                                 NewStemCount
                          FROM NewStemCounts
                          ORDER BY NewStemCount, QuadratName
                          LIMIT 1),
        MostNewStems AS (SELECT ''Most New Stems'' AS StemType,
                                QuadratName,
                                NewStemCount
                         FROM NewStemCounts
                         ORDER BY NewStemCount DESC, QuadratName DESC
                         LIMIT 1)
        SELECT *
        FROM LeastNewStems
        UNION ALL
        SELECT *
        FROM MostNewStems;',
     'Finds quadrats with most and least new stems. Useful for determining overall growth or changes from census to census', true),
    ('Number of dead stems per quadrat',
     'SELECT q.QuadratName,
              s.StemID,
              s.StemTag,
              s.TreeID,
              s.QuadratID,
              s.LocalX,
              s.LocalY,
              a.Code        AS AttributeCode,
              a.Description AS AttributeDescription,
              a.Status      AS AttributeStatus
       FROM ${schema}.quadrats q
                JOIN
            ${schema}.stems s ON q.QuadratID = s.QuadratID
                JOIN
            ${schema}.coremeasurements cm ON s.StemID = cm.StemID
                JOIN
            ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
                JOIN
            ${schema}.attributes a ON cma.Code = a.Code
       WHERE cm.CensusID = ${currentCensusID}
         AND q.PlotID = ${currentPlotID}
         AND a.Status = ''dead''
       ORDER BY q.QuadratName, s.StemID;',
     'dead stems by quadrat. also useful for tracking overall changes across plot', true),
    ('Number of dead stems by species',
     'SELECT sp.SpeciesName,
              sp.SpeciesCode,
              s.StemID,
              s.StemTag,
              s.TreeID,
              q.QuadratName,
              s.LocalX,
              s.LocalY,
              a.Code        AS AttributeCode,
              a.Description AS AttributeDescription,
              a.Status      AS AttributeStatus
       FROM ${schema}.stems s
                JOIN
            ${schema}.coremeasurements cm ON s.StemID = cm.StemID
                JOIN
            ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
                JOIN
            ${schema}.attributes a ON cma.Code = a.Code
                JOIN
            ${schema}.trees t ON s.TreeID = t.TreeID
                JOIN
            ${schema}.species sp ON t.SpeciesID = sp.SpeciesID
            JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID
       WHERE cm.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID}
         AND a.Status = ''dead''
       ORDER BY sp.SpeciesName, s.StemID;',
     'dead stems by species, organized to determine which species (if any) are struggling', true);