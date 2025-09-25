drop procedure if exists bulkingestioncollapser;
drop procedure if exists clearcensusfull;
drop procedure if exists clearcensusmsmts;
drop procedure if exists RefreshMeasurementsSummary;
drop procedure if exists RefreshViewFullTable;
drop procedure if exists reingestfailedrows;
drop procedure if exists reviewfailed;
drop procedure if exists reinsertdefaultvalidations;
drop procedure if exists reinsertdefaultpostvalidations;

create
    definer = azureroot@`%` procedure RefreshMeasurementsSummary()
BEGIN
    SET foreign_key_checks = 0;
    TRUNCATE measurementssummary;
    INSERT IGNORE INTO measurementssummary (CoreMeasurementID,
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
                                            UserDefinedFields,
                                            Errors)
    SELECT cm.CoreMeasurementID                                 AS CoreMeasurementID,
           st.StemGUID                                          AS StemGUID,
           t.TreeID                                             AS TreeID,
           sp.SpeciesID                                         AS SpeciesID,
           q.QuadratID                                          AS QuadratID,
           COALESCE(q.PlotID, 0)                                AS PlotID,
           COALESCE(cm.CensusID, 0)                             AS CensusID,
           sp.SpeciesName                                       AS SpeciesName,
           sp.SubspeciesName                                    AS SubspeciesName,
           sp.SpeciesCode                                       AS SpeciesCode,
           t.TreeTag                                            AS TreeTag,
           st.StemTag                                           AS StemTag,
           st.LocalX                                            AS StemLocalX,
           st.LocalY                                            AS StemLocalY,
           q.QuadratName                                        AS QuadratName,
           cm.MeasurementDate                                   AS MeasurementDate,
           cm.MeasuredDBH                                       AS MeasuredDBH,
           cm.MeasuredHOM                                       AS MeasuredHOM,
           cm.IsValidated                                       AS IsValidated,
           cm.Description                                       AS Description,
           (SELECT GROUP_CONCAT(DISTINCT a.Code SEPARATOR '; ')
            FROM cmattributes ca
                     left join attributes a on a.Code = ca.Code
            WHERE ca.CoreMeasurementID = cm.CoreMeasurementID)  AS Attributes,
           cm.UserDefinedFields                                 AS UserDefinedFields,
           (SELECT GROUP_CONCAT(CONCAT(vp.ProcedureName, '->', vp.Description) SEPARATOR ';')
            FROM sitespecificvalidations vp
                     left JOIN cmverrors cmv ON cmv.ValidationErrorID = vp.ValidationID
            WHERE cmv.CoreMeasurementID = cm.CoreMeasurementID) AS Errors
    FROM coremeasurements cm
             join census c ON cm.CensusID = c.CensusID
             join stems st ON cm.StemGUID = st.StemGUID and st.CensusID = c.CensusID
             join trees t on t.CensusID = c.CensusID and t.TreeID = st.TreeID
             join species sp on t.SpeciesID = sp.SpeciesID
             join quadrats q on q.QuadratID = st.QuadratID;

    -- Re-enable foreign key checks
    SET foreign_key_checks = 1;
END;

create
    definer = azureroot@`%` procedure RefreshViewFullTable()
BEGIN
    -- Disable foreign key checks temporarily
    SET foreign_key_checks = 0;
    TRUNCATE viewfulltable;
    -- Insert data with ON DUPLICATE KEY UPDATE to resolve conflicts
    INSERT IGNORE INTO viewfulltable (CoreMeasurementID,
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
           q.QuadratName                                       AS QuadratName,
           q.DimensionX                                        AS QuadratDimensionX,
           q.DimensionY                                        AS QuadratDimensionY,
           q.Area                                              AS QuadratArea,
           q.StartX                                            AS QuadratStartX,
           q.StartY                                            AS QuadratStartY,
           q.QuadratShape                                      AS QuadratShape,
           t.TreeID                                            AS TreeID,
           t.TreeTag                                           AS TreeTag,
           s.StemGUID                                          AS StemGUID,
           s.StemTag                                           AS StemTag,
           s.LocalX                                            AS StemLocalX,
           s.LocalY                                            AS StemLocalY,
           sp.SpeciesID                                        AS SpeciesID,
           sp.SpeciesCode                                      AS SpeciesCode,
           sp.SpeciesName                                      AS SpeciesName,
           sp.SubspeciesName                                   AS SubspeciesName,
           sp.SubspeciesAuthority                              AS SubspeciesAuthority,
           sp.IDLevel                                          AS SpeciesIDLevel,
           g.GenusID                                           AS GenusID,
           g.Genus                                             AS Genus,
           g.GenusAuthority                                    AS GenusAuthority,
           f.FamilyID                                          AS FamilyID,
           f.Family                                            AS Family,
           (SELECT GROUP_CONCAT(ca.Code SEPARATOR '; ')
            FROM cmattributes ca
            WHERE ca.CoreMeasurementID = cm.CoreMeasurementID) AS Attributes,
           cm.UserDefinedFields                                AS UserDefinedFields
    FROM coremeasurements cm
             LEFT JOIN stems s ON cm.StemGUID = s.StemGUID
             LEFT JOIN trees t ON s.TreeID = t.TreeID
             LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
             LEFT JOIN genus g ON sp.GenusID = g.GenusID
             LEFT JOIN family f ON g.FamilyID = f.FamilyID
             LEFT JOIN quadrats q ON s.QuadratID = q.QuadratID
             LEFT JOIN plots p ON q.PlotID = p.PlotID
             LEFT JOIN census c ON cm.CensusID = c.CensusID
             LEFT JOIN cmattributes ca ON ca.CoreMeasurementID = cm.CoreMeasurementID
             LEFT JOIN attributes a ON a.Code = ca.Code;
    -- Re-enable foreign key checks
    SET foreign_key_checks = 1;
END;

create
    definer = azureroot@`%` procedure bulkingestioncollapser(IN vCensusID int)
begin

    -- orphaned trees rows should be versioned per specifications -- only versions will be referenced later on!
    create temporary table if not exists missing_trees engine = memory as
    select t.TreeID
    from trees t
    where t.CensusID is null;

    update trees set CensusID = vCensusID where TreeID in (select TreeID from missing_trees);
    drop temporary table if exists missing_trees;

    update coremeasurements set MeasuredDBH = null where MeasuredDBH = 0;
    update coremeasurements set MeasuredHOM = null where MeasuredHOM = 0;

    -- Remove duplicates based on StemGUID and MeasurementDate
    DELETE cm1
    FROM coremeasurements cm1
             INNER JOIN coremeasurements cm2
    WHERE cm1.CoreMeasurementID > cm2.CoreMeasurementID
      AND cm1.StemGUID = cm2.StemGUID
      AND cm1.MeasurementDate = cm2.MeasurementDate
      AND cm1.CensusID = vCensusID;

    -- Remove duplicates based on TreeTag/StemTag combinations within the same census
    DELETE cm1
    FROM coremeasurements cm1
             INNER JOIN stems s1 ON cm1.StemGUID = s1.StemGUID
             INNER JOIN trees t1 ON s1.TreeID = t1.TreeID AND s1.CensusID = t1.CensusID
             INNER JOIN coremeasurements cm2 ON cm2.CensusID = cm1.CensusID
             INNER JOIN stems s2 ON cm2.StemGUID = s2.StemGUID
             INNER JOIN trees t2 ON s2.TreeID = t2.TreeID AND s2.CensusID = t2.CensusID
    WHERE cm1.CoreMeasurementID > cm2.CoreMeasurementID
      AND t1.TreeTag = t2.TreeTag
      AND s1.StemTag = s2.StemTag
      AND cm1.CensusID = vCensusID
      AND t1.CensusID = vCensusID
      AND s1.CensusID = vCensusID;
end;

create
    definer = azureroot@`%` procedure clearcensusfull(IN targetCensusID int)
BEGIN
    declare vCountCensus int;
    set foreign_key_checks = 0;
    START TRANSACTION;
    DELETE
    FROM temporarymeasurements
    WHERE CensusID = targetCensusID;

    DELETE
    FROM failedmeasurements
    WHERE CensusID = targetCensusID;

    delete cma.*
    from cmattributes cma
             join coremeasurements cm on cma.CoreMeasurementID = cm.CoreMeasurementID
    where cm.CensusID = targetCensusID;

    delete cmv.*
    from cmverrors cmv
             join coremeasurements cm on cmv.CoreMeasurementID = cm.CoreMeasurementID
    where cm.CensusID = targetCensusID;

    DELETE
    FROM measurementssummary
    WHERE CensusID = targetCensusID;

    delete from stems where CensusID = targetCensusID;

    delete from trees where CensusID = targetCensusID;

    select count(*) into vCountCensus from census;

    if vCountCensus = 1 then
        -- there's only one census. if so, clear all fixed data tables as well to "fully" clean the census
        truncate attributes;
        truncate personnel;
        truncate roles;
        truncate quadrats;
        truncate species;
        truncate specieslimits;
        truncate genus;
        truncate family;
        truncate reference;
        truncate unifiedchangelog;
    end if;

    DELETE
    FROM census
    WHERE CensusID = targetCensusID;

    ALTER TABLE temporarymeasurements
        AUTO_INCREMENT = 1;
    ALTER TABLE failedmeasurements
        AUTO_INCREMENT = 1;
    ALTER TABLE measurementssummary
        AUTO_INCREMENT = 1;
    ALTER TABLE census
        AUTO_INCREMENT = 1;
    COMMIT;
    set foreign_key_checks = 1;
END;

create
    definer = azureroot@`%` procedure clearcensusmsmts(IN targetCensusID int)
BEGIN
    START TRANSACTION;

    DELETE
    FROM temporarymeasurements
    WHERE CensusID = targetCensusID;

    DELETE
    FROM failedmeasurements
    WHERE CensusID = targetCensusID;

    DELETE
    FROM measurementssummary
    WHERE CensusID = targetCensusID;

    DELETE
    FROM census
    WHERE CensusID = targetCensusID;

    ALTER TABLE temporarymeasurements
        AUTO_INCREMENT = 1;
    ALTER TABLE failedmeasurements
        AUTO_INCREMENT = 1;
    ALTER TABLE measurementssummary
        AUTO_INCREMENT = 1;
    ALTER TABLE census
        AUTO_INCREMENT = 1;
    COMMIT;
END;

create
    definer = azureroot@`%` procedure reingestfailedrows(IN vPlotID int, IN vCensusID int)
begin
    declare fileID varchar(36) default 'failedmsmts.csv';
    declare batchID varchar(36) default uuid();

    drop temporary table if exists approved;
    create temporary table approved as
    select FailedMeasurementID
    from failedmeasurements
    where PlotID = vPlotID
      and CensusID = vCensusID
      and Tag is not null
      and StemTag is not null
      and SpCode is not null
      and Quadrat is not null
      and Date is not null;

    insert into temporarymeasurements (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName,
                                       LocalX, LocalY, DBH, HOM, MeasurementDate, Codes)
    select fileID,
           batchID,
           PlotID,
           CensusID,
           Tag,
           StemTag,
           SpCode,
           Quadrat,
           X,
           Y,
           DBH,
           HOM,
           Date,
           Codes
    from failedmeasurements
    where PlotID = vPlotID
      and CensusID = vCensusID
      and Tag is not null
      and StemTag is not null
      and SpCode is not null
      and Quadrat is not null
      and Date is not null;

    call bulkingestionprocess(fileID, batchID);

    delete fm
    from failedmeasurements fm
             join approved a on a.FailedMeasurementID = fm.FailedMeasurementID;

    drop temporary table if exists approved;

end;

create
    definer = azureroot@`%` procedure reinsertdefaultpostvalidations()
begin
    truncate postvalidationqueries; -- clear the table if re-running this script on accident
    insert into postvalidationqueries
        (QueryName, QueryDefinition, Description, IsEnabled)
    values ('Number of Records by Quadrat',
            'select q.QuadratName, count(distinct cm.CoreMeasurementID) as MeasurementCount
                from ${schema}.coremeasurements cm
                join ${schema}.census c on c.CensusID = cm.CensusID and c.IsActive is true
                join ${schema}.stems s on s.StemGUID = cm.StemGUID and s.CensusID = c.CensusID and s.IsActive is true
                join ${schema}.quadrats q on q.QuadratID = s.QuadratID and q.IsActive is true
                where cm.CensusID = ${currentCensusID} and q.PlotID = ${currentPlotID}
                group by q.QuadratName;',
            'Calculating the number of total records, organized by quadrat',
            true),
           ('Number of ALL Stem Records',
            'SELECT COUNT(s.StemGUID) AS TotalStems
               FROM ${schema}.stems s
               JOIN ${schema}.coremeasurements cm ON cm.StemGUID = s.StemGUID and cm.IsActive is true
               JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
               JOIN ${schema}.attributes a ON cma.Code = a.Code and a.IsActive is true
               JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID and q.IsActive is true
               WHERE s.CensusID = ${currentCensusID} and s.IsActive is true AND q.PlotID = ${currentPlotID};',
            'Calculating the number of total stem records for the current site, plot, and census',
            true),
           ('Number of all LIVE stem records',
            'SELECT COUNT(s.StemGUID) AS LiveStems
    FROM ${schema}.stems s
             JOIN ${schema}.coremeasurements cm ON cm.StemGUID = s.StemGUID and cm.IsActive is true
             JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
             JOIN ${schema}.attributes a ON cma.Code = a.Code
             JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID and q.IsActive is true
    WHERE a.Status = ''alive''
      AND s.CensusID = ${currentCensusID}
      AND s.IsActive is true
      AND q.PlotID = ${currentPlotID};',
            'Calculating the number of all live stem records for the current site, plot, and census', true),
           ('Number of all trees',
            'select count(t.TreeID) as TotalTrees
    from ${schema}.coremeasurements cm
    join ${schema}.stems s on s.StemGUID = cm.StemGUID and s.IsActive is true
    join ${schema}.census c on c.CensusID = cm.CensusID and c.IsActive is true
    join ${schema}.trees t on t.CensusID = c.CensusID and t.IsActive is true
    join ${schema}.quadrats q on q.QuadratID = s.QuadratID and q.IsActive is true
    where c.CensusID = ${currentCensusID} and c.PlotID = ${currentPlotID}',
            'Calculating the total number of all trees for the current site, plot, and census', true),
           ('All dead or missing stems and count by census',
            'SELECT cm.CensusID,
               COUNT(s.StemGUID) AS DeadOrMissingStems,
               GROUP_CONCAT(s.StemTag ORDER BY s.StemTag) AS DeadOrMissingStemList
               FROM ${schema}.stems s
               JOIN ${schema}.coremeasurements cm ON cm.StemGUID = s.StemGUID and cm.IsActive is true
               JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
               JOIN ${schema}.attributes a ON a.Code = cma.Code and a.IsActive is true
               WHERE a.Status IN (''dead'', ''missing'') and s.IsActive is true
               GROUP BY cm.CensusID;',
            'Finds and returns a count of, then all dead or missing stems by census', true),
           ('All trees outside plot limits',
            'select t.TreeTag,
           (s.LocalX + q.StartX + p.GlobalX) as GlobalStemX,
           (s.LocalY + q.StartY + p.GlobalY) as GlobalStemY
    from ${schema}.coremeasurements cm
             join ${schema}.stems s on s.StemGUID = cm.StemGUID
             join ${schema}.census c on c.CensusID = cm.CensusID
             join ${schema}.plots p on p.PlotID = c.PlotID
             join ${schema}.trees t on t.CensusID = c.CensusID and t.TreeID = s.TreeID and t.IsActive is true
             join ${schema}.quadrats q on q.QuadratID = s.QuadratID and q.IsActive is true
    where (s.LocalX is null or q.StartX is null or p.GlobalX is null or p.DimensionX is null)
       or (s.LocalY is null or q.StartY is null or p.GlobalY is null or p.DimensionY is null)
       or (s.LocalX + q.StartX + p.GlobalX) > (p.GlobalX + p.DimensionX)
       or (s.LocalY + q.StartY + p.GlobalY) > (p.GlobalY + p.DimensionY)
        and (p.PlotID = ${currentPlotID} and c.CensusID = ${currentCensusID});',
            'Finds and returns any trees outside plot limits', true),
           ('Highest DBH measurement and HOM measurement by species',
            'select sp.SpeciesCode, sp.SpeciesName, max(cm.MeasuredDBH) as LargestDBH, max(cm.MeasuredHOM) as LargestHOM
    from ${schema}.coremeasurements cm
             join ${schema}.census c on c.CensusID = cm.CensusID
             join ${schema}.stems s on s.StemGUID = cm.StemGUID and s.CensusID = c.CensusID and s.IsActive is true
             join ${schema}.trees t on t.CensusID = c.CensusID and t.TreeID = s.TreeID and t.IsActive is true
             join ${schema}.quadrats q on q.QuadratID = s.QuadratID and q.IsActive is true
             join ${schema}.species sp on sp.SpeciesID = t.SpeciesID and sp.IsActive is true
    where c.CensusID = ${currentCensusID}
      and c.PlotID = ${currentPlotID}
    group by sp.SpeciesCode, sp.SpeciesName;',
            'Finds and returns the largest DBH/HOM measurement and their host species ID', true),
           ('Checks that all trees from the last census are present',
            'WITH current_census AS (SELECT *
                            FROM ${schema}.census
                            WHERE CensusID = ${currentCensusID}
                              AND IsActive = 1),
         previous_census AS (SELECT c2.*
                             FROM ${schema}.census c2
                                      JOIN current_census cc
                                           ON c2.PlotID = cc.PlotID
                                               AND c2.PlotCensusNumber = cc.PlotCensusNumber - 1
                                               AND c2.IsActive = 1)
    SELECT t.TreeTag,
           sp.SpeciesCode
    FROM previous_census pc
             JOIN ${schema}.trees t
                  ON t.CensusID = pc.CensusID
             JOIN ${schema}.species s
                  ON s.SpeciesID = t.SpeciesID
             LEFT JOIN ${schema}.trees t_cur
                       ON t_cur.TreeTag = t.TreeTag and t_cur.CensusID = (SELECT CensusID FROM current_census)
    WHERE t_cur.TreeID IS NULL;',
            'Determining whether all trees accounted for in the last census have new measurements in the "next" measurement',
            true),
           ('Number of new stems, grouped by quadrat, and then by census',
            'WITH current_census AS (SELECT PlotID, PlotCensusNumber
                            FROM ${schema}.census
                            WHERE CensusID = ${currentCensusID}
                              AND IsActive = 1),
         previous_census AS (SELECT c2.CensusID
                             FROM ${schema}.census AS c2
                                      JOIN current_census AS cc
                                           ON c2.PlotID = cc.PlotID
                                               AND c2.PlotCensusNumber = cc.PlotCensusNumber - 1
                                               AND c2.IsActive = 1)
    SELECT q.QuadratName,
           s_current.StemTag,
           t.TreeTag,
           s_current.LocalX,
           s_current.LocalY
    FROM ${schema}.census c_current
             JOIN current_census AS cc
                  ON cc.PlotID = c_current.PlotID
             JOIN ${schema}.stems AS s_current
                  ON s_current.CensusID = c_current.CensusID
                      AND s_current.IsActive = 1
             JOIN ${schema}.quadrats q
                  ON q.QuadratID = s_current.QuadratID
             JOIN ${schema}.trees t
                  ON t.TreeID = s_current.TreeID and t.CensusID = c_current.CensusID
             JOIN ${schema}.coremeasurements cm_current
                  ON cm_current.StemGUID = s_current.StemGUID
                      AND cm_current.CensusID = s_current.CensusID
                      AND cm_current.IsActive = 1
    WHERE c_current.IsActive = 1
      AND c_current.PlotID = ${currentPlotID}
      AND NOT EXISTS (SELECT 1
                      FROM ${schema}.coremeasurements AS cm_last
                      WHERE cm_last.StemGUID = s_current.StemGUID
                        AND cm_last.CensusID = (SELECT CensusID FROM previous_census)
                        AND cm_last.IsActive = 1)
    ORDER BY q.QuadratName, s_current.StemTag;',
            'Finds new stems by quadrat for the current census', true),
           ('Determining which quadrats have the most and least number of new stems for the current census',
            'WITH current_census AS (SELECT CensusID AS currentID,
                                   PlotID,
                                   PlotCensusNumber
                            FROM ${schema}.census
                            WHERE CensusID = ${currentCensusID}
                              AND PlotID = ${currentPlotID}
                              AND IsActive = 1),
         previous_census AS (SELECT c2.CensusID AS previousID
                             FROM ${schema}.census AS c2
                                      JOIN current_census AS cc
                                           ON c2.PlotID = cc.PlotID
                                               AND c2.PlotCensusNumber = cc.PlotCensusNumber - 1
                                               AND c2.IsActive = 1),
         NewStems AS (SELECT s_current.QuadratID,
                             s_current.StemGUID
                      FROM ${schema}.stems AS s_current
                               JOIN ${schema}.coremeasurements AS cm_current
                                    ON cm_current.StemGUID = s_current.StemGUID
                                        AND cm_current.CensusID = (SELECT currentID FROM current_census)
                                        AND cm_current.IsActive = 1
                      WHERE s_current.IsActive = 1
                        AND NOT EXISTS (SELECT 1
                                        FROM ${schema}.coremeasurements AS cm_last
                                        WHERE cm_last.StemGUID = s_current.StemGUID
                                          AND cm_last.CensusID = (SELECT previousID FROM previous_census)
                                          AND cm_last.IsActive = 1)),
         NewStemCounts AS (SELECT q.QuadratName,
                                  COUNT(ns.StemGUID) AS NewStemCount
                           FROM ${schema}.stems s
                                    JOIN NewStems AS ns
                                         ON ns.QuadratID = s.QuadratID
                                             AND s.CensusID = (SELECT currentID FROM current_census)
                                    JOIN ${schema}.quadrats q on q.QuadratID = s.QuadratID
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
            'Finds quadrats with most and least new stems. Useful for determining overall growth or changes from census to census',
            true),
           ('Number of dead stems per quadrat',
            'WITH current_census AS (SELECT CensusID, PlotID
                            FROM census
                            WHERE CensusID = ${currentCensusID}
                              AND IsActive = 1)
    SELECT q.QuadratName,
           s.StemTag,
           t.TreeTag,
           s.LocalX,
           s.LocalY,
           a.Code        AS AttributeCode,
           a.Description AS AttributeDescription,
           a.Status      AS AttributeStatus
    FROM current_census AS cc
             JOIN ${schema}.stems s on cc.CensusID = s.CensusID AND s.IsActive = 1
             JOIN ${schema}.quadrats q on q.QuadratID = s.QuadratID
             JOIN ${schema}.trees t on t.TreeID = s.TreeID and t.CensusID = cc.CensusID
             JOIN ${schema}.coremeasurements AS cm
                  ON cm.StemGUID = s.StemGUID
                      AND cm.CensusID = cc.CensusID
                      AND cm.IsActive = 1
             JOIN ${schema}.cmattributes AS cma
                  ON cma.CoreMeasurementID = cm.CoreMeasurementID
             JOIN ${schema}.attributes a on a.Code = cma.Code
    WHERE cc.PlotID = ${currentPlotID}
      AND a.Status = ''dead''
    ORDER BY q.QuadratName;',
            'dead stems by quadrat. also useful for tracking overall changes across plot', true),
           ('Number of dead stems by species',
            'WITH current_census AS (SELECT CensusID, PlotID
                            FROM ${schema}.census
                            WHERE CensusID = ${currentCensusID}
                              AND IsActive = 1)
    SELECT sp.SpeciesName,
           sp.SpeciesCode,
           s.StemTag,
           t.TreeTag,
           q.QuadratName,
           s.LocalX,
           s.LocalY,
           a.Code        AS AttributeCode,
           a.Description AS AttributeDescription,
           a.Status      AS AttributeStatus
    FROM current_census AS cc
             JOIN ${schema}.stems s on cc.CensusID = s.CensusID AND s.IsActive = 1
             JOIN ${schema}.quadrats q on q.QuadratID = s.QuadratID
             JOIN ${schema}.trees t on t.TreeID = s.TreeID and t.CensusID = cc.CensusID
             JOIN ${schema}.coremeasurements AS cm
                  ON cm.StemGUID = s.StemGUID
                      AND cm.CensusID = cc.CensusID
                      AND cm.IsActive = 1
             JOIN ${schema}.cmattributes AS cma
                  ON cma.CoreMeasurementID = cm.CoreMeasurementID
             JOIN ${schema}.attributes a on a.Code = cma.Code
             JOIN ${schema}.species sp on sp.SpeciesID = t.SpeciesID
    WHERE cc.PlotID = ${currentCensusID}
      AND a.Status = ''dead''
    ORDER BY sp.SpeciesName, s.StemGUID;',
            'dead stems by species, organized to determine which species (if any) are struggling', true);
end;

create
    definer = azureroot@`%` procedure reinsertdefaultvalidations()
begin
    set foreign_key_checks = 0;

    truncate sitespecificvalidations;

    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (1, 'ValidateDBHGrowthExceedsMax', 'DBH growth exceeds maximum rate of 65 mm', 'measuredDBH', '
insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm_present.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm_present
         join coremeasurements cm_past
              on cm_present.StemGUID = cm_past.StemGUID and cm_present.CensusID <> cm_past.CensusID and
                 cm_past.IsActive IS TRUE
         join census c_present on cm_present.CensusID = c_present.CensusID and c_present.IsActive is true
         join census c_past on cm_past.CensusID = c_past.CensusID and c_past.IsActive is true
         join plots p ON c_present.PlotID = p.PlotID and c_past.PlotID = p.PlotID
         join cmattributes cma_present on cma_present.CoreMeasurementID = cm_present.CoreMeasurementID
         join attributes a_present on a_present.Code = cma_present.Code
         join cmattributes cma_past on cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
         join attributes a_past on a_past.Code = cma_past.Code
         left join cmverrors e on e.CoreMeasurementID = cm_present.CoreMeasurementID and
                                  e.ValidationErrorID = @validationProcedureID
where c_past.PlotCensusNumber >= 1
  and c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1
  and cm_present.IsActive is true
  and a_present.Status not in (''dead'', ''stem dead'', ''broken below'', ''missing'', ''omitted'')
  and a_past.Status not in (''dead'', ''stem dead'', ''broken below'', ''missing'', ''omitted'')
  and (cm_present.IsValidated is null and cm_past.IsValidated is true)
  and (@p_CensusID IS NULL OR cm_present.CensusID = @p_CensusID)
  and (@p_PlotID IS NULL OR c_present.PlotID = @p_PlotID)
  and e.CoreMeasurementID is null
  and cm_past.MeasuredDBH > 0
  and (cm_present.MeasuredDBH - cm_past.MeasuredDBH) * (case p.DefaultDBHUnits
                                                            when \'km\' THEN 1000000
                                                            when \'hm\' THEN 100000
                                                            when \'dam\' THEN 10000
                                                            when \'m\' THEN 1000
                                                            when \'dm\' THEN 100
                                                            when \'cm\' THEN 10
                                                            when \'mm\' THEN 1
                                                            else 1 end) > 65;', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (2, 'ValidateDBHShrinkageExceedsMax', 'DBH shrinkage exceeds maximum rate of 5 percent', 'measuredDBH', '
insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm_present.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm_present
         join coremeasurements cm_past on cm_present.StemGUID = cm_past.StemGUID
              and cm_present.CensusID <> cm_past.CensusID
              and cm_past.IsActive = 1
         join census c_present on cm_present.CensusID = c_present.CensusID and c_present.IsActive = 1
         join census c_past on cm_past.CensusID = c_past.CensusID and c_past.IsActive = 1
         join plots p ON c_present.PlotID = p.PlotID and c_past.PlotID = p.PlotID
         join cmattributes cma_present on cma_present.CoreMeasurementID = cm_present.CoreMeasurementID
         join attributes a_present on a_present.Code = cma_present.Code
         join cmattributes cma_past on cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
         join attributes a_past on a_past.Code = cma_past.Code
         left join cmverrors e on e.CoreMeasurementID = cm_present.CoreMeasurementID
              and e.ValidationErrorID = @validationProcedureID
where c_past.PlotCensusNumber >= 1
  and c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1
  and cm_present.IsActive = 1
  and a_present.Status not in (''dead'', ''stem dead'', ''broken below'', ''missing'', ''omitted'')
  and a_past.Status not in (''dead'', ''stem dead'', ''broken below'', ''missing'', ''omitted'')
  and (cm_present.IsValidated is null and cm_past.IsValidated = 1)  -- FIXED: Use 1 instead of true
  and (@p_CensusID IS NULL OR cm_present.CensusID = @p_CensusID)
  and (@p_PlotID IS NULL OR c_present.PlotID = @p_PlotID)
  and e.CoreMeasurementID is null
  and cm_past.MeasuredDBH > 0
  and (cm_present.MeasuredDBH < (cm_past.MeasuredDBH * 0.95));', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (3, 'ValidateFindAllInvalidSpeciesCodes', 'Species Code is invalid (not defined in species table)',
            'speciesCode', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive = TRUE
         join stems s on cm.StemGUID = s.StemGUID and c.CensusID = s.CensusID and s.IsActive = TRUE
         join trees t on s.TreeID = t.TreeID and c.CensusID = t.CensusID and t.IsActive = TRUE
         left join species sp on t.SpeciesID = sp.SpeciesID and sp.IsActive = TRUE
         left join cmverrors e on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null and cm.IsActive is true
  and (@p_CensusID is null or c.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID)
  and e.CoreMeasurementID is null
  and sp.SpeciesID is null;', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (4, 'ValidateFindDuplicatedQuadratsByName',
            'Quadrat\'s name matches existing OTHER quadrat (QuadratIDs are different but QuadratNames are the same)',
            'quadratName',
            'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
    select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
    from coremeasurements cm
             join census c on cm.CensusID = c.CensusID and c.IsActive is true
             join stems s on cm.StemGUID = s.StemGUID and c.CensusID = s.CensusID and s.IsActive is true
             join quadrats q on s.QuadratID = q.QuadratID and q.IsActive is true
             join (select s2.CensusID, q2.QuadratName
                   from quadrats q2
                        join stems s2 on q2.QuadratID = s2.QuadratID
                   group by s2.CensusID, q2.QuadratName
                   having count(distinct q2.QuadratID) > 1) as ambiguous
                  ON q.QuadratName = ambiguous.QuadratName AND c.CensusID = ambiguous.CensusID
             left join cmverrors e
                       on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
    where cm.IsValidated is null
      and cm.IsActive is true
      and (@p_CensusID is null or c.CensusID = @p_CensusID)
      and (@p_PlotID is null or c.PlotID = @p_PlotID)
      and e.CoreMeasurementID is null;',
            '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (5, 'ValidateFindDuplicateStemTreeTagCombinationsPerCensus',
            'Duplicate tree (and stem) tag found in census;Duplicate stem (and tree) tag found in census',
            'stemTag;treeTag',
            'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
    select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
    from coremeasurements cm
             join census c on cm.CensusID = c.CensusID and c.IsActive is true
             join stems s on cm.StemGUID = s.StemGUID and c.CensusID = s.CensusID and s.IsActive is true
             join trees t on s.TreeID = t.TreeID and c.CensusID = t.CensusID and t.IsActive is true
             join (
                 -- Find duplicate TreeTag+StemTag combinations within same census
                 select t2.CensusID, t2.TreeTag, s2.StemTag
                 from trees t2
                 join stems s2 on t2.TreeID = s2.TreeID and t2.CensusID = s2.CensusID
                 where t2.IsActive = true and s2.IsActive = true
                 group by t2.CensusID, t2.TreeTag, s2.StemTag
                 having count(distinct s2.StemGUID) > 1
             ) as duplicates ON t.CensusID = duplicates.CensusID
                            AND t.TreeTag = duplicates.TreeTag
                            AND s.StemTag = duplicates.StemTag
             left join cmverrors e
                       on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
    where cm.IsValidated is null and cm.IsActive is true
      and e.CoreMeasurementID is null
      and (@p_CensusID is null or c.CensusID = @p_CensusID)
      and (@p_PlotID is null or c.PlotID = @p_PlotID);',
            '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (6, 'ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat', 'Outside census date bounds',
            'measurementDate', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         left join cmverrors e
                   on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null and cm.IsActive is true
  and e.CoreMeasurementID is null
  and (cm.MeasurementDate < c.StartDate or cm.MeasurementDate > c.EndDate)
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (7, 'ValidateFindStemsInTreeWithDifferentSpecies',
            'Flagged;Different species',
            'stemTag;speciesCode',
            'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
    select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
    from coremeasurements cm
             join census c on cm.CensusID = c.CensusID and c.IsActive is true
             join stems s on cm.StemGUID = s.StemGUID and c.CensusID = s.CensusID and s.IsActive is true
             join trees t on t.TreeID = s.TreeID and t.CensusID = c.CensusID and t.IsActive is true
             join species sp on t.SpeciesID = sp.SpeciesID and sp.IsActive is true
             join (
                 -- Find trees that have stems with different species
                 select t2.TreeTag, t2.CensusID
                 from trees t2
                 join stems s2 on t2.TreeID = s2.TreeID and t2.CensusID = s2.CensusID
                 join species sp2 on t2.SpeciesID = sp2.SpeciesID
                 where t2.IsActive = true and s2.IsActive = true and sp2.IsActive = true
                 group by t2.TreeTag, t2.CensusID
                 having count(distinct sp2.SpeciesCode) > 1
             ) as problematic_trees ON t.TreeTag = problematic_trees.TreeTag AND t.CensusID = problematic_trees.CensusID
             left join cmverrors e
                       on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
    where cm.IsValidated is null and cm.IsActive is true
        and e.CoreMeasurementID is null
        and (@p_CensusID is null or cm.CensusID = @p_CensusID)
        and (@p_PlotID is null or c.PlotID = @p_PlotID);',
            '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (8, 'ValidateFindStemsOutsidePlots', 'Flagged;X outside plot OR;Y outside plot',
            'stemTag;stemLocalX;stemLocalY', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
join census c on cm.CensusID = c.CensusID and c.IsActive is true
join stems s on cm.StemGUID = s.StemGUID and c.CensusID = s.CensusID and s.IsActive is true
join quadrats q on s.QuadratID = q.QuadratID and q.IsActive is true
join plots p on c.PlotID = p.PlotID
left join cmverrors e on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null and e.CoreMeasurementID is null and cm.IsActive is true
and s.LocalX is not null and s.LocalY is not null
and q.StartX is not null and q.StartY is not null
and p.GlobalX is not null and p.GlobalY is not null
and p.DimensionX is not null and p.DimensionY is not null
and ((s.LocalX + q.StartX + p.GlobalX) > (p.GlobalX + p.DimensionX)) or ((s.LocalY + q.StartY + p.GlobalY) > (p.GlobalY + p.DimensionY))
and (@p_CensusID is null or cm.CensusID = @p_CensusID)
and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (9, 'ValidateFindTreeStemsInDifferentQuadrats',
            'Flagged;Flagged;Different quadrats',
            'stemTag;treeTag;quadratName',
            'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
    select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
    from coremeasurements cm
             join census c on cm.CensusID = c.CensusID and c.IsActive is true
             join stems s1 on cm.StemGUID = s1.StemGUID and c.CensusID = s1.CensusID and s1.IsActive is true
             join trees t on s1.TreeID = t.TreeID and c.CensusID = t.CensusID and t.IsActive is true
             join (
                 -- Find trees that have stems in different quadrats
                 select t2.TreeID, t2.CensusID
                 from trees t2
                 join stems s2 on t2.TreeID = s2.TreeID and t2.CensusID = s2.CensusID
                 where t2.IsActive = true and s2.IsActive = true
                 group by t2.TreeID, t2.CensusID
                 having count(distinct s2.QuadratID) > 1
             ) as cross_quadrat_trees ON t.TreeID = cross_quadrat_trees.TreeID AND t.CensusID = cross_quadrat_trees.CensusID
             left join cmverrors e
                       on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
    where cm.IsValidated is null and cm.IsActive is true
      and e.CoreMeasurementID is null
      and (@p_CensusID is null or cm.CensusID = @p_CensusID)
      and (@p_PlotID is null or c.PlotID = @p_PlotID);',
            '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (11, 'ValidateScreenMeasuredDiameterMinMax', 'Measured DBH is outside of species-defined bounds',
            'measuredDBH', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join stems s on cm.StemGUID = s.StemGUID and c.CensusID = s.CensusID and s.IsActive is true
         left join cmverrors e
                   on cm.CoreMeasurementID = e.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null and cm.IsActive is true
  and e.CoreMeasurementID is null
  and ((@minDBH is not null and cm.MeasuredDBH < @minDBH)
    or (@maxDBH is not null and cm.MeasuredDBH > @maxDBH))
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (12, 'ValidateScreenStemsWithMeasurementsButDeadAttributes',
            'Invalid DBH;Invalid HOM;DEAD-state attribute(s)',
            'measuredDBH;measuredHOM;attributes', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join cmattributes cma on cm.CoreMeasurementID = cma.CoreMeasurementID
         join attributes a on cma.Code = a.Code and a.IsActive is true
              and cma.Code = a.Code and a.Status in (\'dead\', \'stem dead\', \'missing\', \'broken below\', \'omitted\')
         left join cmverrors e
                   on cm.CoreMeasurementID = e.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null and cm.IsActive is true
  and e.CoreMeasurementID is null
  and ((cm.MeasuredDBH is not null and cm.MeasuredDBH <> 0)
    or (cm.MeasuredHOM is not null and cm.MeasuredHOM <> 0))
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);
', '', false);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (13, 'ValidateScreenStemsWithMissingMeasurementsButLiveAttributes',
            'Missing DBH;Missing HOM;LIVE-state attribute(s)', 'measuredDBH;measuredHOM;attributes', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join cmattributes cma on cm.CoreMeasurementID = cma.CoreMeasurementID
         join attributes a on cma.Code = a.Code and a.IsActive is true
              and cma.Code = a.Code and a.Status not in (\'dead\', \'stem dead\', \'missing\', \'broken below\', \'omitted\') and a.IsActive is true
         left join cmverrors e
                   on cm.CoreMeasurementID = e.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null and cm.IsActive is true
  and e.CoreMeasurementID is null
  and ((cm.MeasuredDBH is null or cm.MeasuredDBH = 0)
    or (cm.MeasuredHOM is null or cm.MeasuredHOM = 0))
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', false);
    set foreign_key_checks = 1;
end;

create
    definer = azureroot@`%` procedure reviewfailed()
begin
    -- Simple, reliable failure detection
    UPDATE failedmeasurements fm
    SET FailureReasons = TRIM(BOTH '|' FROM CONCAT_WS('|',
        -- SpCode validation
                                                      CASE
                                                          WHEN fm.SpCode IS NULL OR fm.SpCode = '' THEN 'SpCode missing'
                                                          WHEN NOT EXISTS(SELECT 1 FROM species s WHERE s.SpeciesCode = fm.SpCode)
                                                              THEN 'SpCode invalid'
                                                          ELSE NULL
                                                          END,

        -- Quadrat validation
                                                      CASE
                                                          WHEN fm.Quadrat IS NULL OR fm.Quadrat = ''
                                                              THEN 'Quadrat missing'
                                                          WHEN NOT EXISTS(SELECT 1
                                                                          FROM quadrats q
                                                                          WHERE q.QuadratName = fm.Quadrat
                                                                            AND q.PlotID = fm.PlotID)
                                                              THEN 'Quadrat invalid'
                                                          ELSE NULL
                                                          END,

        -- Coordinate validation
                                                      IF(fm.X IS NULL OR fm.X IN (0, -1), 'Missing X', NULL),
                                                      IF(fm.Y IS NULL OR fm.Y IN (0, -1), 'Missing Y', NULL),

        -- DBH and Codes validation (need at least one)
                                                      IF((fm.Codes IS NULL OR TRIM(fm.Codes) = '') AND
                                                         (fm.DBH IS NULL OR fm.DBH IN (0, -1)), 'Missing Codes and DBH',
                                                         NULL),
                                                      IF((fm.Codes IS NULL OR TRIM(fm.Codes) = '') AND
                                                         (fm.HOM IS NULL OR fm.HOM IN (0, -1)), 'Missing Codes and HOM',
                                                         NULL),

        -- Date validation
                                                      IF(fm.Date IS NULL OR fm.Date = '1900-01-01', 'Missing Date', NULL),

        -- Tag validation (required fields)
                                                      IF(fm.Tag IS NULL OR fm.Tag = '', 'Missing Tag', NULL),
                                                      IF(fm.StemTag IS NULL OR fm.StemTag = '', 'Missing StemTag', NULL)
                                            ));

    -- Mark rows with empty failure reasons as ready for reingestion
    UPDATE failedmeasurements
    SET FailureReasons = 'Ready for reingestion'
    WHERE FailureReasons IS NULL
       OR FailureReasons = '';

end;

DROP PROCEDURE IF EXISTS bulkingestionprocess;

CREATE
    DEFINER = azureroot@`%` PROCEDURE bulkingestionprocess(IN vFileID varchar(36), IN vBatchID varchar(36))
main_proc:
BEGIN
    DECLARE vCurrentCensusID int;
    DECLARE vBatchFailed BOOLEAN DEFAULT FALSE;
    DECLARE vErrorMessage TEXT DEFAULT '';
    DECLARE vErrorCode VARCHAR(10) DEFAULT '';
    DECLARE vBatchRowCount INT DEFAULT 0;

    -- Enhanced error handler that moves failed batches to failedmeasurements
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
        BEGIN
            GET DIAGNOSTICS CONDITION 1
                vErrorMessage = MESSAGE_TEXT,
                vErrorCode = MYSQL_ERRNO;

            SET vBatchFailed = TRUE;

            -- Log the error for debugging (single INSERT with LIMIT 1 for efficiency)
            INSERT IGNORE INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes, Comments)
            SELECT PlotID,
                   CensusID,
                   CONCAT('BATCH_FAILED_', vFileID) as Tag,
                   vBatchID as StemTag,
                   CONCAT('ERROR_', vErrorCode) as SpCode,
                   'SYSTEM_ERROR' as Quadrat,
                   -1 as X,
                   -1 as Y,
                   -1 as DBH,
                   -1 as HOM,
                   NOW() as Date,
                   CONCAT('SQL_ERROR:', vErrorCode) as Codes,
                   CONCAT('Batch processing failed: ', LEFT(vErrorMessage, 200)) as Comments
            FROM temporarymeasurements
            WHERE FileID = vFileID AND BatchID = vBatchID
            LIMIT 1;

            -- Move all remaining temporarymeasurements for this batch to failedmeasurements
            INSERT IGNORE INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes, Comments)
            SELECT PlotID,
                   CensusID,
                   NULLIF(TreeTag, '') as Tag,
                   NULLIF(StemTag, '') as StemTag,
                   NULLIF(SpeciesCode, '') as SpCode,
                   NULLIF(QuadratName, '') as Quadrat,
                   NULLIF(LocalX, 0) as X,
                   NULLIF(LocalY, 0) as Y,
                   NULLIF(DBH, 0) as DBH,
                   NULLIF(HOM, 0) as HOM,
                   NULLIF(MeasurementDate, '1900-01-01') as MeasurementDate,
                   NULLIF(CONCAT(IFNULL(Codes, ''), ';PROC_FAILED:', vErrorCode), ';PROC_FAILED:') as Codes,
                   NULLIF(CONCAT(IFNULL(Comments, ''), ' [PROC_ERROR: ', LEFT(vErrorMessage, 100), ']'), ' [PROC_ERROR: ]') as Comments
            FROM temporarymeasurements
            WHERE FileID = vFileID AND BatchID = vBatchID;

            -- Clean up the temporary measurements after moving to failed
            DELETE FROM temporarymeasurements WHERE FileID = vFileID AND BatchID = vBatchID;

            -- Clean up temporary tables on error
            DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, filter_validity, filtered,
                old_trees, multi_stems, new_recruits, unique_trees_to_insert, unique_stems_to_insert, tempcodes;
            -- Table locks are automatically released on procedure exit
            SET @disable_triggers = 0;

            -- Return success instead of resignaling, since we handled the error by moving to failedmeasurements
            SELECT CONCAT('Batch ', vBatchID, ' moved to failedmeasurements due to error: ', vErrorCode) as message;
        END;

    SET @disable_triggers = 0;

    -- Note: Explicit table locking is not allowed in stored procedures
    -- MySQL handles locking automatically for transactional operations

    -- Optimized: Single query to get both CensusID and row count
    SELECT CensusID, COUNT(*)
    INTO vCurrentCensusID, vBatchRowCount
    FROM temporarymeasurements
    WHERE FileID = vFileID AND BatchID = vBatchID
    GROUP BY CensusID
    LIMIT 1;

    -- Early exit if no data found
    IF vBatchRowCount = 0 THEN
        SET @disable_triggers = 0;
        -- Table locks are automatically released on procedure exit
        SELECT 'No data found for specified FileID/BatchID' as message;
        LEAVE main_proc;
    END IF;

    -- Clean up any existing temporary tables
    DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, filter_validity, filtered,
        old_trees, multi_stems, new_recruits, unique_trees_to_insert, unique_stems_to_insert, tempcodes;

    -- Step 1: Optimized deduplication with strategic indexing
    CREATE TEMPORARY TABLE initial_dup_filter ENGINE = MEMORY AS
    SELECT min(id) as id,
           FileID,
           BatchID,
           PlotID,
           CensusID,
           TreeTag,
           StemTag,
           SpeciesCode,
           QuadratName,
           LocalX,
           LocalY,
           DBH,
           HOM,
           MeasurementDate,
           max(case when Codes is not null and trim(Codes) != '' then Codes end) as Codes,
           max(case when Comments is not null and trim(Comments) != '' then Comments end) as Comments
    FROM temporarymeasurements
    WHERE FileID = vFileID
      AND BatchID = vBatchID
      AND CensusID = vCurrentCensusID
    GROUP BY FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode,
             QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate;

    -- Add strategic indexes for better JOIN performance
    CREATE INDEX idx_dup_tree_species ON initial_dup_filter (TreeTag, SpeciesCode);
    CREATE INDEX idx_dup_quadrat ON initial_dup_filter (QuadratName);

    -- Step 2: Optimized validation with reduced subqueries
    CREATE TEMPORARY TABLE filter_validity ENGINE = MEMORY AS
    SELECT i.id,
           i.FileID,
           i.BatchID,
           i.PlotID,
           i.CensusID,
           i.TreeTag,
           IFNULL(i.StemTag, '') as StemTag,
           i.SpeciesCode,
           i.QuadratName,
           IFNULL(i.LocalX, 0) as LocalX,
           IFNULL(i.LocalY, 0) as LocalY,
           IFNULL(i.DBH, 0) as DBH,
           IFNULL(i.HOM, 0) as HOM,
           i.MeasurementDate,
           i.Codes,
           i.Comments,
           -- Simplified validation logic - defer complex attribute validation to later step
           CASE
               WHEN i.TreeTag IS NULL OR i.MeasurementDate IS NULL OR
                    tq.QuadratID IS NULL OR ts.SpeciesID IS NULL OR
                    (i.DBH = 0 AND i.HOM = 0 AND (i.Codes IS NULL OR TRIM(i.Codes) = ''))
                   THEN false
               ELSE true
           END as Valid,
           tq.QuadratID,
           ts.SpeciesID
    FROM initial_dup_filter i
    LEFT JOIN quadrats tq ON tq.QuadratName = i.QuadratName AND tq.IsActive = 1
    LEFT JOIN species ts ON ts.SpeciesCode = i.SpeciesCode AND ts.IsActive = 1;

    -- Add indexes for subsequent operations
    CREATE INDEX idx_validity_valid ON filter_validity (Valid);
    CREATE INDEX idx_validity_tree ON filter_validity (TreeTag, SpeciesID, CensusID);

    -- Step 3: Create filtered dataset (only valid rows)
    CREATE TEMPORARY TABLE filtered ENGINE = MEMORY AS
    SELECT *
    FROM filter_validity
    WHERE Valid = true;

    -- Strategic indexing for performance-critical JOINs
    CREATE INDEX idx_filtered_tree_census ON filtered (TreeTag, CensusID);
    CREATE INDEX idx_filtered_stem_tree ON filtered (StemTag, TreeTag);
    CREATE INDEX idx_filtered_species ON filtered (SpeciesID);

    -- Step 4: Handle validation failures efficiently
    INSERT IGNORE INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes, Comments)
    SELECT PlotID,
           CensusID,
           NULLIF(TreeTag, '') as Tag,
           NULLIF(StemTag, '') as StemTag,
           NULLIF(SpeciesCode, '') as SpCode,
           NULLIF(QuadratName, '') as Quadrat,
           NULLIF(LocalX, 0) as X,
           NULLIF(LocalY, 0) as Y,
           NULLIF(DBH, 0) as DBH,
           NULLIF(HOM, 0) as HOM,
           NULLIF(MeasurementDate, '1900-01-01') as MeasurementDate,
           NULLIF(Codes, '') as Codes,
           NULLIF(Comments, '') as Comments
    FROM filter_validity
    WHERE Valid = false;

    -- Step 5: Optimized stem categorization with better index usage
    -- Use EXISTS instead of JOINs where possible for better performance
    CREATE TEMPORARY TABLE old_trees ENGINE = MEMORY AS
    SELECT DISTINCT f.*
    FROM filtered f
    WHERE EXISTS (SELECT 1 FROM trees t WHERE t.TreeTag = f.TreeTag AND t.CensusID < f.CensusID AND t.IsActive = 1)
      AND EXISTS (SELECT 1 FROM trees t
                  JOIN stems s ON s.TreeID = t.TreeID
                  WHERE t.TreeTag = f.TreeTag AND s.StemTag = f.StemTag AND t.CensusID < f.CensusID AND t.IsActive = 1 AND s.IsActive = 1);

    CREATE TEMPORARY TABLE multi_stems ENGINE = MEMORY AS
    SELECT DISTINCT f.*
    FROM filtered f
    WHERE EXISTS (SELECT 1 FROM trees t WHERE t.TreeTag = f.TreeTag AND t.CensusID < f.CensusID AND t.IsActive = 1)
      AND NOT EXISTS (SELECT 1 FROM old_trees ot WHERE ot.id = f.id);

    CREATE TEMPORARY TABLE new_recruits ENGINE = MEMORY AS
    SELECT DISTINCT f.*
    FROM filtered f
    WHERE NOT EXISTS (SELECT 1 FROM old_trees ot WHERE ot.id = f.id)
      AND NOT EXISTS (SELECT 1 FROM multi_stems ms WHERE ms.id = f.id);

    -- Step 6: Optimized tree insertion with batch processing
    CREATE TEMPORARY TABLE unique_trees_to_insert ENGINE = MEMORY AS
    SELECT DISTINCT TreeTag, SpeciesID, CensusID
    FROM filtered
    WHERE CensusID = vCurrentCensusID;

    -- Add index for the INSERT operation
    CREATE INDEX idx_trees_insert ON unique_trees_to_insert (TreeTag, SpeciesID, CensusID);

    -- Optimized tree insertion using LEFT JOIN for better performance
    INSERT IGNORE INTO trees (TreeTag, SpeciesID, CensusID)
    SELECT uti.TreeTag, uti.SpeciesID, uti.CensusID
    FROM unique_trees_to_insert uti
    LEFT JOIN trees existing ON existing.TreeTag = uti.TreeTag
                            AND existing.CensusID = uti.CensusID
                            AND existing.SpeciesID = uti.SpeciesID
    WHERE existing.TreeID IS NULL;

    -- Step 7: Optimized stem insertion
    CREATE TEMPORARY TABLE unique_stems_to_insert ENGINE = MEMORY AS
    SELECT DISTINCT TreeTag, QuadratID, StemTag, LocalX, LocalY, CensusID, SpeciesID
    FROM filtered
    WHERE CensusID = vCurrentCensusID;

    -- Add composite index for optimal JOIN performance
    CREATE INDEX idx_stems_insert ON unique_stems_to_insert (TreeTag, SpeciesID, CensusID);

    INSERT IGNORE INTO stems (TreeID, QuadratID, CensusID, StemCrossID, StemTag, LocalX, LocalY, Moved, StemDescription, IsActive)
    SELECT t.TreeID,
           usi.QuadratID,
           vCurrentCensusID as CensusID,
           NULL as StemCrossID,
           CASE WHEN TRIM(COALESCE(usi.StemTag, '')) = '' THEN NULL ELSE TRIM(usi.StemTag) END as StemTag,
           CASE WHEN usi.LocalX = 0 THEN NULL ELSE usi.LocalX END as LocalX,
           CASE WHEN usi.LocalY = 0 THEN NULL ELSE usi.LocalY END as LocalY,
           0 as Moved,
           NULL as StemDescription,
           1 as IsActive
    FROM unique_stems_to_insert usi
    INNER JOIN trees t ON t.TreeTag = usi.TreeTag
                      AND t.SpeciesID = usi.SpeciesID
                      AND t.CensusID = vCurrentCensusID
                      AND t.IsActive = 1;

    -- Step 8: Optimized StemCrossID update (bulk update)
    UPDATE stems s
    SET s.StemCrossID = s.StemGUID
    WHERE s.CensusID = vCurrentCensusID
      AND s.StemCrossID IS NULL;

    -- Step 9: Optimized core measurements insertion
    -- Use a single UNION query instead of multiple temp tables for better performance
    INSERT IGNORE INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description, UserDefinedFields, IsActive)
    SELECT f.CensusID,
           s.StemGUID,
           null as IsValidated,
           COALESCE(f.MeasurementDate, '1900-01-01') as MeasurementDate,
           CASE WHEN f.DBH = 0 THEN NULL ELSE f.DBH END as MeasuredDBH,
           CASE WHEN f.HOM = 0 THEN NULL ELSE f.HOM END as MeasuredHOM,
           COALESCE(f.Comments, '') as Description,
           JSON_OBJECT('treestemstate',
               CASE
                   WHEN EXISTS(SELECT 1 FROM old_trees ot WHERE ot.id = f.id) THEN 'old tree'
                   WHEN EXISTS(SELECT 1 FROM multi_stems ms WHERE ms.id = f.id) THEN 'multi stem'
                   ELSE 'new recruit'
               END
           ) as UserDefinedFields,
           1 as IsActive
    FROM filtered f
    INNER JOIN trees t ON t.TreeTag = f.TreeTag
                      AND t.SpeciesID = f.SpeciesID
                      AND t.CensusID = f.CensusID
                      AND t.IsActive = 1
    INNER JOIN stems s ON s.TreeID = t.TreeID
                      AND s.StemTag = f.StemTag
                      AND s.QuadratID = f.QuadratID
                      AND s.CensusID = f.CensusID
                      AND s.IsActive = 1;

    -- Step 10: Clean up measurement nulls (batch operation)
    UPDATE coremeasurements
    SET MeasurementDate = NULLIF(MeasurementDate, '1900-01-01'),
        MeasuredDBH     = NULLIF(MeasuredDBH, 0),
        MeasuredHOM     = NULLIF(MeasuredHOM, 0),
        Description     = NULLIF(Description, '')
    WHERE CensusID = vCurrentCensusID;

    -- Step 11: Optimized attribute code handling
    -- Only process rows that actually have codes to avoid unnecessary JSON parsing
    IF EXISTS(SELECT 1 FROM filtered WHERE Codes IS NOT NULL AND TRIM(Codes) != '') THEN
        CREATE TEMPORARY TABLE tempcodes ENGINE = MEMORY AS
        SELECT cm.CoreMeasurementID,
               trim(jt.code) as Code
        FROM filtered f
        INNER JOIN trees t ON t.TreeTag = f.TreeTag
                          AND t.SpeciesID = f.SpeciesID
                          AND t.CensusID = f.CensusID
                          AND t.IsActive = 1
        INNER JOIN stems s ON s.TreeID = t.TreeID
                          AND s.StemTag = f.StemTag
                          AND s.QuadratID = f.QuadratID
                          AND s.CensusID = f.CensusID
                          AND s.IsActive = 1
        INNER JOIN coremeasurements cm ON cm.StemGUID = s.StemGUID
                                      AND cm.CensusID = f.CensusID
                                      AND cm.IsActive = 1,
        json_table(
            if(f.Codes = '' or trim(f.Codes) = '', '[]',
               concat('["', replace(trim(f.Codes), ';', '","'), '"]')),
            '$[*]' columns ( code varchar(10) path '$')
        ) jt
        WHERE f.Codes is not null
          AND trim(f.Codes) != '';

        -- Only insert valid attribute codes
        INSERT IGNORE INTO cmattributes (CoreMeasurementID, Code)
        SELECT tc.CoreMeasurementID, tc.Code
        FROM tempcodes tc
        INNER JOIN attributes a ON a.Code = tc.Code AND a.IsActive = 1;
    END IF;

    -- Clean up temporary tables
    DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, filter_validity, filtered,
        old_trees, multi_stems, new_recruits, unique_trees_to_insert, unique_stems_to_insert, tempcodes;

    -- Clean up temporarymeasurements for this successful batch
    DELETE FROM temporarymeasurements WHERE FileID = vFileID AND BatchID = vBatchID;


    SET @disable_triggers = 0;

    -- Return success message
    SELECT CONCAT('Batch ', vBatchID, ' processed successfully (', vBatchRowCount, ' rows)') as message, FALSE as batch_failed;
END;