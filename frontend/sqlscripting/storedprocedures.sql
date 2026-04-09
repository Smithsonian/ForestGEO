drop procedure if exists bulkingestioncollapser;
drop procedure if exists clearcensusfull;
drop procedure if exists clearcensusmsmts;
drop procedure if exists RefreshMeasurementsSummary;
drop procedure if exists RefreshViewFullTable;
drop procedure if exists reingestfailedrows;
drop procedure if exists reviewfailed;
drop procedure if exists refresh_failedmeasurements_current;
-- NOTE: reingestfailedrows, reviewfailed, refresh_failedmeasurements_current are legacy
-- procedures that operated on the now-removed failedmeasurements table.
-- They are dropped above but NOT recreated below.
drop procedure if exists RunSharedDBHChangeValidations;
drop procedure if exists RunSharedCrossCensusLocationValidations;
drop procedure if exists reinsertdefaultvalidations;
drop procedure if exists reinsertdefaultpostvalidations;

DELIMITER $$

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
           cm.UserDefinedFields                                 AS UserDefinedFields,
           validation_errors.Errors                             AS Errors
    FROM coremeasurements cm
             join census c ON cm.CensusID = c.CensusID
             LEFT JOIN stems st ON cm.StemGUID = st.StemGUID and st.CensusID = c.CensusID
             LEFT JOIN trees t on t.CensusID = c.CensusID and t.TreeID = st.TreeID
             LEFT JOIN species sp on t.SpeciesID = sp.SpeciesID
             LEFT JOIN quadrats q on q.QuadratID = st.QuadratID
             LEFT JOIN (
                 SELECT ca.CoreMeasurementID,
                        GROUP_CONCAT(DISTINCT a.Code SEPARATOR '; ') AS Attributes
                 FROM cmattributes ca
                          LEFT JOIN attributes a ON a.Code = ca.Code
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
                 FROM measurement_error_log mel
                          JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
                          LEFT JOIN sitespecificvalidations vp ON me.ErrorCode = CAST(vp.ValidationID AS CHAR)
                 WHERE mel.IsResolved = FALSE
                 GROUP BY mel.MeasurementID
             ) validation_errors ON validation_errors.MeasurementID = cm.CoreMeasurementID;

    -- Re-enable foreign key checks
    SET foreign_key_checks = 1;
END $$

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
           view_attrs.Attributes                               AS Attributes,
           cm.UserDefinedFields                                AS UserDefinedFields
    FROM coremeasurements cm
             JOIN census c ON cm.CensusID = c.CensusID
             JOIN stems s ON cm.StemGUID = s.StemGUID AND s.CensusID = c.CensusID
             JOIN trees t ON s.TreeID = t.TreeID AND t.CensusID = c.CensusID
             LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
             LEFT JOIN genus g ON sp.GenusID = g.GenusID
             LEFT JOIN family f ON g.FamilyID = f.FamilyID
             LEFT JOIN quadrats q ON s.QuadratID = q.QuadratID
             LEFT JOIN plots p ON q.PlotID = p.PlotID
             LEFT JOIN (
                 SELECT ca.CoreMeasurementID,
                        GROUP_CONCAT(ca.Code SEPARATOR '; ') AS Attributes
                 FROM cmattributes ca
                 GROUP BY ca.CoreMeasurementID
             ) view_attrs ON view_attrs.CoreMeasurementID = cm.CoreMeasurementID
    WHERE cm.StemGUID IS NOT NULL;
    -- Re-enable foreign key checks
    SET foreign_key_checks = 1;
END $$

create
    definer = azureroot@`%` procedure bulkingestioncollapser(IN vCensusID int)
begin
    DECLARE vErrorMessage TEXT DEFAULT '';
    DECLARE vErrorCode VARCHAR(10) DEFAULT '';
    DECLARE vPlotID INT DEFAULT 0;
    DECLARE vStemDateDupCount INT DEFAULT 0;
    DECLARE vTreeStemTagDupCount INT DEFAULT 0;
    DECLARE vUploadId VARCHAR(50);
    DECLARE vAlertFileID VARCHAR(50) DEFAULT '__collapser__';
    DECLARE vAlertBatchID VARCHAR(50);

    -- Error handler with proper rollback for transaction atomicity
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            vErrorMessage = MESSAGE_TEXT,
            vErrorCode = MYSQL_ERRNO;

        -- Rollback any partial changes
        ROLLBACK;

        -- Clean up temporary tables
        DROP TEMPORARY TABLE IF EXISTS missing_trees;
        DROP TEMPORARY TABLE IF EXISTS stem_date_duplicate_ids;
        DROP TEMPORARY TABLE IF EXISTS tree_stem_tag_duplicate_ids;

        -- Re-signal the error for the application layer to handle
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = vErrorMessage;
    END;

    -- Get PlotID for alert logging
    SELECT PlotID INTO vPlotID FROM census WHERE CensusID = vCensusID LIMIT 1;
    SET vAlertBatchID = CONCAT('census-', vCensusID);
    -- Collapser alerts are census-scoped, so use a fixed-width synthetic upload id
    -- instead of relying on file/batch names from the ingest path.
    SET vUploadId = LEFT(SHA2(CONCAT_WS('#', DATABASE(), 'collapser', COALESCE(vPlotID, 0), vCensusID), 256), 40);

    -- Start atomic transaction - all changes succeed or all fail together
    START TRANSACTION;

    -- orphaned trees rows should be versioned per specifications -- only versions will be referenced later on!
    create temporary table if not exists missing_trees engine = memory as
    select t.TreeID
    from trees t
    where t.CensusID is null;

    update trees set CensusID = vCensusID where TreeID in (select TreeID from missing_trees);
    drop temporary table if exists missing_trees;

    -- Scope NULL updates to the specific census for efficiency and atomicity
    update coremeasurements set MeasuredDBH = null where MeasuredDBH = 0 AND CensusID = vCensusID;
    update coremeasurements set MeasuredHOM = null where MeasuredHOM = 0 AND CensusID = vCensusID;

    -- Materialize duplicate IDs once, then delete by ID to avoid repeated self-joins.
    DROP TEMPORARY TABLE IF EXISTS stem_date_duplicate_ids;
    CREATE TEMPORARY TABLE stem_date_duplicate_ids AS
    SELECT ranked.CoreMeasurementID
    FROM (
        SELECT cm.CoreMeasurementID,
               ROW_NUMBER() OVER (
                   PARTITION BY cm.StemGUID, cm.MeasurementDate
                   ORDER BY cm.CoreMeasurementID
               ) AS row_num
        FROM coremeasurements cm
        WHERE cm.CensusID = vCensusID
          AND cm.StemGUID IS NOT NULL
          AND cm.MeasurementDate IS NOT NULL
    ) AS ranked
    WHERE ranked.row_num > 1;

    DELETE cm
    FROM coremeasurements cm
             INNER JOIN stem_date_duplicate_ids dup
                        ON dup.CoreMeasurementID = cm.CoreMeasurementID;
    SET vStemDateDupCount = ROW_COUNT();
    DROP TEMPORARY TABLE IF EXISTS stem_date_duplicate_ids;

    -- Log StemGUID+Date deduplication if any rows were removed
    IF vStemDateDupCount > 0 THEN
        INSERT INTO uploadintegrityalerts
            (uploadId, fileID, batchID, plotID, censusID,
             type, message, severity,
             sourceRecords, processedRecords, failedRecords, missingRecords)
        VALUES
            (vUploadId, vAlertFileID, vAlertBatchID, vPlotID, vCensusID,
             'COLLAPSER_DEDUPLICATION',
             CONCAT('Removed ', vStemDateDupCount, ' duplicate rows (same StemGUID+MeasurementDate)'),
             'info',
             0, 0, vStemDateDupCount, 0);
    END IF;

    DROP TEMPORARY TABLE IF EXISTS tree_stem_tag_duplicate_ids;
    CREATE TEMPORARY TABLE tree_stem_tag_duplicate_ids AS
    SELECT ranked.CoreMeasurementID
    FROM (
        SELECT cm.CoreMeasurementID,
               ROW_NUMBER() OVER (
                   PARTITION BY t.TreeTag, s.StemTag
                   ORDER BY cm.CoreMeasurementID
               ) AS row_num
        FROM coremeasurements cm
                 INNER JOIN stems s ON cm.StemGUID = s.StemGUID
                 INNER JOIN trees t ON s.TreeID = t.TreeID AND s.CensusID = t.CensusID
        WHERE cm.CensusID = vCensusID
          AND t.CensusID = vCensusID
          AND s.CensusID = vCensusID
          AND t.TreeTag IS NOT NULL
          AND s.StemTag IS NOT NULL
    ) AS ranked
    WHERE ranked.row_num > 1;

    DELETE cm
    FROM coremeasurements cm
             INNER JOIN tree_stem_tag_duplicate_ids dup
                        ON dup.CoreMeasurementID = cm.CoreMeasurementID;
    SET vTreeStemTagDupCount = ROW_COUNT();
    DROP TEMPORARY TABLE IF EXISTS tree_stem_tag_duplicate_ids;

    -- Log TreeTag+StemTag deduplication if any rows were removed
    IF vTreeStemTagDupCount > 0 THEN
        INSERT INTO uploadintegrityalerts
            (uploadId, fileID, batchID, plotID, censusID,
             type, message, severity,
             sourceRecords, processedRecords, failedRecords, missingRecords)
        VALUES
            (vUploadId, vAlertFileID, vAlertBatchID, vPlotID, vCensusID,
             'COLLAPSER_DEDUPLICATION',
             CONCAT('Removed ', vTreeStemTagDupCount, ' duplicate rows (same TreeTag+StemTag in census)'),
             'info',
             0, 0, vTreeStemTagDupCount, 0);
    END IF;

    -- Commit all changes atomically
    COMMIT;

    -- Return success message with deduplication counts
    SELECT CONCAT('Census ', vCensusID, ' collapsed successfully. Deduplication: ',
                  vStemDateDupCount, ' StemGUID+Date duplicates, ',
                  vTreeStemTagDupCount, ' TreeTag+StemTag duplicates removed.') as message;
end $$

create
    definer = azureroot@`%` procedure clearcensusfull(IN targetCensusID int)
BEGIN
    declare vCountCensus int;
    -- Disable triggers to prevent changelog tracking during bulk census deletion
    set @disable_triggers = 1;
    set foreign_key_checks = 0;
    START TRANSACTION;
    DELETE
    FROM temporarymeasurements
    WHERE CensusID = targetCensusID;

    delete cma.*
    from cmattributes cma
             join coremeasurements cm on cma.CoreMeasurementID = cm.CoreMeasurementID
    where cm.CensusID = targetCensusID;

    delete mel.*
    from measurement_error_log mel
             join coremeasurements cm on mel.MeasurementID = cm.CoreMeasurementID
    where cm.CensusID = targetCensusID;

    DELETE
    FROM measurementssummary
    WHERE CensusID = targetCensusID;

    delete from coremeasurements where CensusID = targetCensusID;
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

    COMMIT;
    set foreign_key_checks = 1;
    -- Re-enable triggers after census deletion
    set @disable_triggers = 0;
END $$

create
    definer = azureroot@`%` procedure clearcensusmsmts(IN targetCensusID int)
BEGIN
    -- Disable triggers to prevent changelog tracking during bulk census deletion
    set @disable_triggers = 1;
    set foreign_key_checks = 0;
    START TRANSACTION;

    DELETE
    FROM temporarymeasurements
    WHERE CensusID = targetCensusID;

    -- Delete measurement attributes and validation errors
    delete cma.*
    from cmattributes cma
             join coremeasurements cm on cma.CoreMeasurementID = cm.CoreMeasurementID
    where cm.CensusID = targetCensusID;

    delete mel.*
    from measurement_error_log mel
             join coremeasurements cm on mel.MeasurementID = cm.CoreMeasurementID
    where cm.CensusID = targetCensusID;

    DELETE
    FROM measurementssummary
    WHERE CensusID = targetCensusID;

    -- Delete core measurements, stems, and trees for this census
    delete from coremeasurements where CensusID = targetCensusID;
    delete from stems where CensusID = targetCensusID;
    delete from trees where CensusID = targetCensusID;

    DELETE
    FROM census
    WHERE CensusID = targetCensusID;

    COMMIT;
    set foreign_key_checks = 1;
    -- Re-enable triggers after census deletion
    set @disable_triggers = 0;
END $$

-- reingestfailedrows removed: operated on legacy failedmeasurements table.
-- Reingestion now handled via API routes using coremeasurements (StemGUID=NULL) rows.

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
end $$

-- Single source of truth for the shared DBH change candidate logic used by ValidationIDs 1 and 2.
-- Keep both validation definitions as CALLs to this helper. Do not duplicate or inline this SQL
-- in future enhancements, or the growth/shrinkage semantics and dead-status handling will drift.
create
    definer = azureroot@`%` procedure RunSharedDBHChangeValidations(
    IN p_CensusID int,
    IN p_PlotID int,
    IN p_RunGrowth tinyint,
    IN p_RunShrinkage tinyint
)
shared_dbh:
BEGIN
    DECLARE vRunGrowth tinyint DEFAULT 0;
    DECLARE vRunShrinkage tinyint DEFAULT 0;
    DECLARE vGrowthErrorID int DEFAULT NULL;
    DECLARE vShrinkageErrorID int DEFAULT NULL;

    SELECT CASE
               WHEN p_RunGrowth = 1
                   AND EXISTS (SELECT 1 FROM sitespecificvalidations WHERE ValidationID = 1 AND IsEnabled = TRUE)
                   THEN 1
               ELSE 0
               END,
           CASE
               WHEN p_RunShrinkage = 1
                   AND EXISTS (SELECT 1 FROM sitespecificvalidations WHERE ValidationID = 2 AND IsEnabled = TRUE)
                   THEN 1
               ELSE 0
               END
    INTO vRunGrowth, vRunShrinkage;

    IF vRunGrowth = 0 AND vRunShrinkage = 0 THEN
        LEAVE shared_dbh;
    END IF;

    IF vRunGrowth = 1 THEN
        SELECT me.ErrorID
        INTO vGrowthErrorID
        FROM measurement_errors me
        WHERE me.ErrorSource = 'validation'
          AND me.ErrorCode = '1'
        LIMIT 1;

        IF vGrowthErrorID IS NULL THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Missing measurement_errors row for ValidationID 1';
        END IF;
    END IF;

    IF vRunShrinkage = 1 THEN
        SELECT me.ErrorID
        INTO vShrinkageErrorID
        FROM measurement_errors me
        WHERE me.ErrorSource = 'validation'
          AND me.ErrorCode = '2'
        LIMIT 1;

        IF vShrinkageErrorID IS NULL THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Missing measurement_errors row for ValidationID 2';
        END IF;
    END IF;

    DROP TEMPORARY TABLE IF EXISTS dbh_change_candidates;
    CREATE TEMPORARY TABLE dbh_change_candidates
    (
        CoreMeasurementID    int        NOT NULL PRIMARY KEY,
        HasGrowthViolation   tinyint(1) NOT NULL,
        HasShrinkageViolation tinyint(1) NOT NULL,
        KEY idx_growth_violation (HasGrowthViolation, CoreMeasurementID),
        KEY idx_shrink_violation (HasShrinkageViolation, CoreMeasurementID)
    );

    INSERT INTO dbh_change_candidates (CoreMeasurementID, HasGrowthViolation, HasShrinkageViolation)
    SELECT cm_present.CoreMeasurementID,
           MAX(CASE
                   WHEN (cm_present.MeasuredDBH - cm_past.MeasuredDBH) * (CASE p.DefaultDBHUnits
                                                                              WHEN 'km' THEN 1000000
                                                                              WHEN 'hm' THEN 100000
                                                                              WHEN 'dam' THEN 10000
                                                                              WHEN 'm' THEN 1000
                                                                              WHEN 'dm' THEN 100
                                                                              WHEN 'cm' THEN 10
                                                                              WHEN 'mm' THEN 1
                                                                              ELSE 1 END) > 65 THEN 1
                   ELSE 0
               END) AS HasGrowthViolation,
           MAX(CASE
                   WHEN cm_present.MeasuredDBH < (cm_past.MeasuredDBH * 0.95) THEN 1
                   ELSE 0
               END) AS HasShrinkageViolation
    FROM coremeasurements cm_present
             JOIN census c_present
                  ON cm_present.CensusID = c_present.CensusID
                      AND c_present.IsActive = 1
             JOIN stems s_present
                  ON s_present.StemGUID = cm_present.StemGUID
                      AND s_present.CensusID = cm_present.CensusID
                      AND s_present.IsActive = 1
             JOIN trees t_present
                  ON t_present.TreeID = s_present.TreeID
                      AND t_present.CensusID = s_present.CensusID
                      AND t_present.IsActive = 1
             JOIN plots p
                  ON c_present.PlotID = p.PlotID
             JOIN census c_past
                  ON c_past.PlotID = c_present.PlotID
                      AND c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1
                      AND c_past.IsActive = 1
             JOIN trees t_past
                  ON t_past.CensusID = c_past.CensusID
                      AND t_past.TreeTag = t_present.TreeTag
                      AND t_past.IsActive = 1
             JOIN stems s_past
                  ON s_past.TreeID = t_past.TreeID
                      AND s_past.CensusID = c_past.CensusID
                      AND s_past.StemTag = s_present.StemTag
                      AND s_past.IsActive = 1
             JOIN coremeasurements cm_past
                  ON cm_past.StemGUID = s_past.StemGUID
                      AND cm_past.CensusID = c_past.CensusID
                      AND cm_past.IsActive = 1
                      AND cm_past.IsValidated = 1
    WHERE cm_present.IsActive = 1
      AND cm_present.IsValidated IS NULL
      AND (p_CensusID IS NULL OR cm_present.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR c_present.PlotID = p_PlotID)
      AND cm_past.MeasuredDBH > 0
      AND NOT EXISTS (
        SELECT 1
        FROM cmattributes cma_present
                 JOIN attributes a_present
                      ON a_present.Code = cma_present.Code
                          AND a_present.IsActive = 1
        WHERE cma_present.CoreMeasurementID = cm_present.CoreMeasurementID
          AND a_present.Status IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted')
    )
      AND NOT EXISTS (
        SELECT 1
        FROM cmattributes cma_past
                 JOIN attributes a_past
                      ON a_past.Code = cma_past.Code
                          AND a_past.IsActive = 1
        WHERE cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
          AND a_past.Status IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted')
    )
    GROUP BY cm_present.CoreMeasurementID;

    IF vRunGrowth = 1 THEN
        INSERT INTO measurement_error_log (MeasurementID, ErrorID)
        SELECT candidate.CoreMeasurementID, vGrowthErrorID
        FROM dbh_change_candidates candidate
                 LEFT JOIN measurement_error_log e
                           ON e.MeasurementID = candidate.CoreMeasurementID
                               AND e.ErrorID = vGrowthErrorID
        WHERE candidate.HasGrowthViolation = 1
          AND e.MeasurementID IS NULL
        ON DUPLICATE KEY UPDATE IsResolved = FALSE, ResolvedAt = NULL;
    END IF;

    IF vRunShrinkage = 1 THEN
        INSERT INTO measurement_error_log (MeasurementID, ErrorID)
        SELECT candidate.CoreMeasurementID, vShrinkageErrorID
        FROM dbh_change_candidates candidate
                 LEFT JOIN measurement_error_log e
                           ON e.MeasurementID = candidate.CoreMeasurementID
                               AND e.ErrorID = vShrinkageErrorID
        WHERE candidate.HasShrinkageViolation = 1
          AND e.MeasurementID IS NULL
        ON DUPLICATE KEY UPDATE IsResolved = FALSE, ResolvedAt = NULL;
    END IF;

    DROP TEMPORARY TABLE IF EXISTS dbh_change_candidates;
END $$

-- Single source of truth for the shared cross-census location candidate logic used by ValidationIDs 17 and 18.
-- Keep both validation definitions as CALLs to this helper. Do not duplicate or inline this SQL
-- in future enhancements, or quadrat-mismatch / coordinate-drift semantics can drift between paths.
create
    definer = azureroot@`%` procedure RunSharedCrossCensusLocationValidations(
    IN p_CensusID int,
    IN p_PlotID int,
    IN p_RunQuadratMismatch tinyint,
    IN p_RunCoordinateDrift tinyint
)
shared_cross_census_location:
BEGIN
    DECLARE vRunQuadratMismatch tinyint DEFAULT 0;
    DECLARE vRunCoordinateDrift tinyint DEFAULT 0;
    DECLARE vQuadratMismatchErrorID int DEFAULT NULL;
    DECLARE vCoordinateDriftErrorID int DEFAULT NULL;

    SELECT CASE
               WHEN p_RunQuadratMismatch = 1
                   AND EXISTS (SELECT 1 FROM sitespecificvalidations WHERE ValidationID = 17 AND IsEnabled = TRUE)
                   THEN 1
               ELSE 0
               END,
           CASE
               WHEN p_RunCoordinateDrift = 1
                   AND EXISTS (SELECT 1 FROM sitespecificvalidations WHERE ValidationID = 18 AND IsEnabled = TRUE)
                   THEN 1
               ELSE 0
               END
    INTO vRunQuadratMismatch, vRunCoordinateDrift;

    IF vRunQuadratMismatch = 0 AND vRunCoordinateDrift = 0 THEN
        LEAVE shared_cross_census_location;
    END IF;

    IF vRunQuadratMismatch = 1 THEN
        SELECT me.ErrorID
        INTO vQuadratMismatchErrorID
        FROM measurement_errors me
        WHERE me.ErrorSource = 'validation'
          AND me.ErrorCode = '17'
        LIMIT 1;

        IF vQuadratMismatchErrorID IS NULL THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Missing measurement_errors row for ValidationID 17';
        END IF;
    END IF;

    IF vRunCoordinateDrift = 1 THEN
        SELECT me.ErrorID
        INTO vCoordinateDriftErrorID
        FROM measurement_errors me
        WHERE me.ErrorSource = 'validation'
          AND me.ErrorCode = '18'
        LIMIT 1;

        IF vCoordinateDriftErrorID IS NULL THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Missing measurement_errors row for ValidationID 18';
        END IF;
    END IF;

    DROP TEMPORARY TABLE IF EXISTS current_cross_census_previous_map;
    CREATE TEMPORARY TABLE current_cross_census_previous_map
    (
        CurrentCensusID  int NOT NULL PRIMARY KEY,
        PreviousCensusID int NOT NULL,
        KEY idx_previous_census_id (PreviousCensusID)
    );

    -- A plot census number can span multiple active census rows (date-range periods).
    -- Pick one deterministic predecessor row per current census up front so each
    -- CoreMeasurementID enters the scope table at most once.
    INSERT INTO current_cross_census_previous_map (CurrentCensusID, PreviousCensusID)
    SELECT c.CensusID,
           MAX(c_prev.CensusID) AS PreviousCensusID
    FROM census c
             JOIN census c_prev
                  ON c_prev.PlotID = c.PlotID
                      AND c_prev.PlotCensusNumber = c.PlotCensusNumber - 1
                      AND c_prev.IsActive = 1
    WHERE c.IsActive = 1
      AND (p_CensusID IS NULL OR c.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR c.PlotID = p_PlotID)
    GROUP BY c.CensusID;

    DROP TEMPORARY TABLE IF EXISTS current_cross_census_scope;
    CREATE TEMPORARY TABLE current_cross_census_scope
    (
        CoreMeasurementID  int            NOT NULL PRIMARY KEY,
        PreviousCensusID   int            NOT NULL,
        TreeTag            varchar(20)    NOT NULL,
        StemTag            varchar(10)    NOT NULL,
        CurrentQuadratName varchar(255)   NULL,
        CurrentLocalX      decimal(12, 6) NULL,
        CurrentLocalY      decimal(12, 6) NULL,
        KEY idx_scope_prev_tags (PreviousCensusID, TreeTag, StemTag)
    );

    INSERT INTO current_cross_census_scope (CoreMeasurementID, PreviousCensusID, TreeTag, StemTag, CurrentQuadratName, CurrentLocalX, CurrentLocalY)
    SELECT cm.CoreMeasurementID,
           prev_map.PreviousCensusID,
           t.TreeTag,
           s.StemTag,
           q_cur.QuadratName,
           s.LocalX,
           s.LocalY
    FROM coremeasurements cm
             JOIN census c
                  ON c.CensusID = cm.CensusID
                      AND c.IsActive = 1
             JOIN current_cross_census_previous_map prev_map
                  ON prev_map.CurrentCensusID = c.CensusID
             JOIN stems s
                  ON s.StemGUID = cm.StemGUID
                      AND s.CensusID = cm.CensusID
                      AND s.IsActive = 1
             JOIN trees t
                  ON t.TreeID = s.TreeID
                      AND t.CensusID = s.CensusID
                      AND t.IsActive = 1
             JOIN quadrats q_cur
                  ON q_cur.QuadratID = s.QuadratID
                      AND q_cur.IsActive = 1
    WHERE cm.IsActive = 1
      AND cm.IsValidated IS NULL
      AND cm.StemGUID IS NOT NULL
      AND (p_CensusID IS NULL OR cm.CensusID = p_CensusID)
      AND (p_PlotID IS NULL OR c.PlotID = p_PlotID);

    DROP TEMPORARY TABLE IF EXISTS current_cross_census_keys;
    CREATE TEMPORARY TABLE current_cross_census_keys
    (
        PreviousCensusID int         NOT NULL,
        TreeTag          varchar(20) NOT NULL,
        StemTag          varchar(10) NOT NULL,
        PRIMARY KEY (PreviousCensusID, TreeTag, StemTag)
    );

    INSERT IGNORE INTO current_cross_census_keys (PreviousCensusID, TreeTag, StemTag)
    SELECT scope.PreviousCensusID,
           scope.TreeTag,
           scope.StemTag
    FROM current_cross_census_scope scope;

    DROP TEMPORARY TABLE IF EXISTS previous_cross_census_lookup;
    CREATE TEMPORARY TABLE previous_cross_census_lookup
    (
        PreviousCensusID   int            NOT NULL,
        TreeTag            varchar(20)    NOT NULL,
        StemTag            varchar(10)    NOT NULL,
        PreviousQuadratName varchar(255)  NULL,
        PreviousLocalX     decimal(12, 6) NULL,
        PreviousLocalY     decimal(12, 6) NULL,
        KEY idx_prev_lookup (PreviousCensusID, TreeTag, StemTag)
    );

    -- Materialize the previous-census lookup once per distinct tag/stem key from
    -- the current scope.  This preserves the original "any matching previous row"
    -- semantics while avoiding repeated tree/stem/quadrat joins for every insert path.
    INSERT INTO previous_cross_census_lookup
        (PreviousCensusID, TreeTag, StemTag, PreviousQuadratName, PreviousLocalX, PreviousLocalY)
    SELECT DISTINCT scope_keys.PreviousCensusID,
           scope_keys.TreeTag,
           scope_keys.StemTag,
           q_prev.QuadratName,
           s_prev.LocalX,
           s_prev.LocalY
    FROM current_cross_census_keys scope_keys
             JOIN trees t_prev
                  ON t_prev.CensusID = scope_keys.PreviousCensusID
                      AND t_prev.TreeTag = scope_keys.TreeTag
                      AND t_prev.IsActive = 1
             JOIN stems s_prev
                  ON s_prev.TreeID = t_prev.TreeID
                      AND s_prev.CensusID = scope_keys.PreviousCensusID
                      AND s_prev.StemTag = scope_keys.StemTag
                      AND s_prev.IsActive = 1
             LEFT JOIN quadrats q_prev
                  ON q_prev.QuadratID = s_prev.QuadratID
                      AND q_prev.IsActive = 1;

    DROP TEMPORARY TABLE IF EXISTS cross_census_location_candidates;
    CREATE TEMPORARY TABLE cross_census_location_candidates
    (
        CoreMeasurementID  int        NOT NULL PRIMARY KEY,
        HasQuadratMismatch tinyint(1) NOT NULL,
        HasCoordinateDrift tinyint(1) NOT NULL,
        KEY idx_quadrat_mismatch (HasQuadratMismatch, CoreMeasurementID),
        KEY idx_coordinate_drift (HasCoordinateDrift, CoreMeasurementID)
    );

    INSERT INTO cross_census_location_candidates (CoreMeasurementID, HasQuadratMismatch, HasCoordinateDrift)
    SELECT scope.CoreMeasurementID,
           MAX(CASE
                   WHEN prev_lookup.PreviousQuadratName <> scope.CurrentQuadratName THEN 1
                   ELSE 0
               END) AS HasQuadratMismatch,
           MAX(CASE
                   WHEN scope.CurrentLocalX IS NOT NULL
                       AND scope.CurrentLocalY IS NOT NULL
                       AND prev_lookup.PreviousLocalX IS NOT NULL
                       AND prev_lookup.PreviousLocalY IS NOT NULL
                       AND ((scope.CurrentLocalX - prev_lookup.PreviousLocalX) * (scope.CurrentLocalX - prev_lookup.PreviousLocalX)) +
                           ((scope.CurrentLocalY - prev_lookup.PreviousLocalY) * (scope.CurrentLocalY - prev_lookup.PreviousLocalY)) > 100
                       THEN 1
                   ELSE 0
               END) AS HasCoordinateDrift
    FROM current_cross_census_scope scope
             JOIN previous_cross_census_lookup prev_lookup
                  ON prev_lookup.PreviousCensusID = scope.PreviousCensusID
                      AND prev_lookup.TreeTag = scope.TreeTag
                      AND prev_lookup.StemTag = scope.StemTag
    GROUP BY scope.CoreMeasurementID;

    IF vRunQuadratMismatch = 1 THEN
        INSERT INTO measurement_error_log (MeasurementID, ErrorID)
        SELECT candidate.CoreMeasurementID, vQuadratMismatchErrorID
        FROM cross_census_location_candidates candidate
        WHERE candidate.HasQuadratMismatch = 1
        ON DUPLICATE KEY UPDATE IsResolved = FALSE, ResolvedAt = NULL;
    END IF;

    IF vRunCoordinateDrift = 1 THEN
        INSERT INTO measurement_error_log (MeasurementID, ErrorID)
        SELECT candidate.CoreMeasurementID, vCoordinateDriftErrorID
        FROM cross_census_location_candidates candidate
        WHERE candidate.HasCoordinateDrift = 1
        ON DUPLICATE KEY UPDATE IsResolved = FALSE, ResolvedAt = NULL;
    END IF;
    DROP TEMPORARY TABLE IF EXISTS cross_census_location_candidates;
    DROP TEMPORARY TABLE IF EXISTS previous_cross_census_lookup;
    DROP TEMPORARY TABLE IF EXISTS current_cross_census_keys;
    DROP TEMPORARY TABLE IF EXISTS current_cross_census_scope;
    DROP TEMPORARY TABLE IF EXISTS current_cross_census_previous_map;
END $$

create
    definer = azureroot@`%` procedure reinsertdefaultvalidations()
begin
    set foreign_key_checks = 0;

    truncate sitespecificvalidations;

    -- ValidationIDs 1 and 2 intentionally delegate to RunSharedDBHChangeValidations().
    -- Keep the shared candidate SQL in that helper only; do not duplicate it here.
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (1, 'ValidateDBHGrowthExceedsMax', 'DBH growth exceeds maximum rate of 65 mm', 'measuredDBH',
            'CALL RunSharedDBHChangeValidations(@p_CensusID, @p_PlotID, 1, 0);', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (2, 'ValidateDBHShrinkageExceedsMax', 'DBH shrinkage exceeds maximum rate of 5 percent', 'measuredDBH',
            'CALL RunSharedDBHChangeValidations(@p_CensusID, @p_PlotID, 0, 1);', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (3, 'ValidateFindAllInvalidSpeciesCodes', 'Species Code is invalid (not defined in species table)',
            'speciesCode', 'insert into measurement_error_log (MeasurementID, ErrorID)
select distinct cm.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1) as ErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive = TRUE
         join stems s on cm.StemGUID = s.StemGUID and c.CensusID = s.CensusID and s.IsActive = TRUE
         join trees t on s.TreeID = t.TreeID and c.CensusID = t.CensusID and t.IsActive = TRUE
         left join species sp on t.SpeciesID = sp.SpeciesID and sp.IsActive = TRUE
         left join measurement_error_log e on e.MeasurementID = cm.CoreMeasurementID and e.ErrorID = (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
where cm.IsValidated is null and cm.IsActive is true
  and (@p_CensusID is null or c.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID)
  and e.MeasurementID is null
  and sp.SpeciesID is null;', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (4, 'ValidateFindDuplicatedQuadratsByName',
            'Quadrat\'s name matches existing OTHER quadrat (QuadratIDs are different but QuadratNames are the same)',
            'quadratName',
            'insert into measurement_error_log (MeasurementID, ErrorID)
    select distinct cm.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1) as ErrorID
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
             left join measurement_error_log e
                       on e.MeasurementID = cm.CoreMeasurementID and e.ErrorID = (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
    where cm.IsValidated is null
      and cm.IsActive is true
      and (@p_CensusID is null or c.CensusID = @p_CensusID)
      and (@p_PlotID is null or c.PlotID = @p_PlotID)
      and e.MeasurementID is null;',
            '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (5, 'ValidateFindDuplicateStemTreeTagCombinationsPerCensus',
            'Duplicate tree (and stem) tag found in census;Duplicate stem (and tree) tag found in census',
            'stemTag;treeTag',
            'insert into measurement_error_log (MeasurementID, ErrorID)
    select distinct cm.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1) as ErrorID
    from coremeasurements cm
             join census c on cm.CensusID = c.CensusID and c.IsActive is true
             join stems s on cm.StemGUID = s.StemGUID and c.CensusID = s.CensusID and s.IsActive is true
             join trees t on s.TreeID = t.TreeID and c.CensusID = t.CensusID and t.IsActive is true
             join (
                 -- FIXED: Find duplicate TreeTag+StemTag combinations in COREMEASUREMENTS within same census
                 -- Previous query looked at stems/trees tables which could flag single measurements
                 -- if there were orphaned or inactive stem entries with the same tags
                 select cm2.CensusID, t2.TreeTag, s2.StemTag
                 from coremeasurements cm2
                 join stems s2 on cm2.StemGUID = s2.StemGUID and cm2.CensusID = s2.CensusID
                 join trees t2 on s2.TreeID = t2.TreeID and s2.CensusID = t2.CensusID
                 where cm2.IsActive = true and s2.IsActive = true and t2.IsActive = true
                 group by cm2.CensusID, t2.TreeTag, s2.StemTag
                 having count(distinct cm2.CoreMeasurementID) > 1
             ) as duplicates ON cm.CensusID = duplicates.CensusID
                            AND t.TreeTag = duplicates.TreeTag
                            AND s.StemTag = duplicates.StemTag
             left join measurement_error_log e
                       on e.MeasurementID = cm.CoreMeasurementID and e.ErrorID = (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
    where cm.IsValidated is null and cm.IsActive is true
      and e.MeasurementID is null
      and (@p_CensusID is null or c.CensusID = @p_CensusID)
      and (@p_PlotID is null or c.PlotID = @p_PlotID);',
            '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (6, 'ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat', 'Outside census date bounds',
            'measurementDate', 'insert into measurement_error_log (MeasurementID, ErrorID)
select distinct cm.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1) as ErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         left join measurement_error_log e
                   on e.MeasurementID = cm.CoreMeasurementID and e.ErrorID = (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
where cm.IsValidated is null and cm.IsActive is true
  and e.MeasurementID is null
  and (cm.MeasurementDate < c.StartDate or cm.MeasurementDate > c.EndDate)
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (7, 'ValidateFindStemsInTreeWithDifferentSpecies',
            'Flagged;Different species',
            'stemTag;speciesCode',
            'insert into measurement_error_log (MeasurementID, ErrorID)
    select distinct cm.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1) as ErrorID
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
             left join measurement_error_log e
                       on e.MeasurementID = cm.CoreMeasurementID and e.ErrorID = (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
    where cm.IsValidated is null and cm.IsActive is true
        and e.MeasurementID is null
        and (@p_CensusID is null or cm.CensusID = @p_CensusID)
        and (@p_PlotID is null or c.PlotID = @p_PlotID);',
            '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (8, 'ValidateFindStemsOutsidePlots', 'Stem coordinates NULL, negative, or outside plot boundaries (both upper and lower bounds)',
            'stemTag;treeTag;stemLocalX;stemLocalY;quadratStartX;quadratStartY;plotGlobalX;plotGlobalY;plotDimensionX;plotDimensionY', 'insert into measurement_error_log (MeasurementID, ErrorID)
select distinct cm.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1) as ErrorID
from coremeasurements cm
join census c on cm.CensusID = c.CensusID and c.IsActive is true
join stems s on cm.StemGUID = s.StemGUID and c.CensusID = s.CensusID and s.IsActive is true
join quadrats q on s.QuadratID = q.QuadratID and q.IsActive is true
join plots p on c.PlotID = p.PlotID
left join measurement_error_log e on e.MeasurementID = cm.CoreMeasurementID and e.ErrorID = (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
where cm.IsValidated is null
and e.MeasurementID is null
and cm.IsActive is true
and (@p_CensusID is null or cm.CensusID = @p_CensusID)
and (@p_PlotID is null or c.PlotID = @p_PlotID)
-- Skip rows where plot/quadrat metadata is invalid (NULL or negative) - cannot validate stem positions
and q.StartX is not null and q.StartY is not null
and p.GlobalX is not null and p.GlobalY is not null
and p.DimensionX is not null and p.DimensionY is not null
and q.StartX >= 0 and q.StartY >= 0
and p.GlobalX >= 0 and p.GlobalY >= 0
and p.DimensionX > 0 and p.DimensionY > 0
-- Flag if stem coordinates are NULL, negative, or outside boundaries (inclusive boundaries - stems can be on edge)
and (
    s.LocalX is null
    or s.LocalY is null
    or s.LocalX < 0
    or s.LocalY < 0
    or (s.LocalX + q.StartX) < 0
    or (s.LocalX + q.StartX) > p.DimensionX
    or (s.LocalY + q.StartY) < 0
    or (s.LocalY + q.StartY) > p.DimensionY
)
-- Do NOT flag dead stems (status = ''dead'' or ''stem dead'') for missing coordinates
and NOT EXISTS (
    SELECT 1 FROM cmattributes cma
    JOIN attributes a ON cma.Code = a.Code
    WHERE cma.CoreMeasurementID = cm.CoreMeasurementID
    AND a.Status IN (''dead'', ''stem dead'')
);', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (9, 'ValidateFindTreeStemsInDifferentQuadrats',
            'Flagged;Flagged;Different quadrats',
            'stemTag;treeTag;quadratName',
            'insert into measurement_error_log (MeasurementID, ErrorID)
    select distinct cm.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1) as ErrorID
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
             left join measurement_error_log e
                       on e.MeasurementID = cm.CoreMeasurementID and e.ErrorID = (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
    where cm.IsValidated is null and cm.IsActive is true
      and e.MeasurementID is null
      and (@p_CensusID is null or cm.CensusID = @p_CensusID)
      and (@p_PlotID is null or c.PlotID = @p_PlotID);',
            '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (11, 'ValidateScreenMeasuredDiameterMinMax', 'Measured DBH is outside of species-defined bounds from specieslimits table',
            'measuredDBH;speciesCode;speciesLimitMin;speciesLimitMax', 'insert into measurement_error_log (MeasurementID, ErrorID)
select distinct cm.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1) as ErrorID
from coremeasurements cm
join census c on cm.CensusID = c.CensusID and c.IsActive is true
join stems s on cm.StemGUID = s.StemGUID and c.CensusID = s.CensusID and s.IsActive is true
join trees t on s.TreeID = t.TreeID and t.CensusID = c.CensusID and t.IsActive is true
join species sp on t.SpeciesID = sp.SpeciesID and sp.IsActive is true
join specieslimits sl on sp.SpeciesID = sl.SpeciesID
    and sl.CensusID = cm.CensusID
    and sl.LimitType = ''DBH''
    and sl.IsActive is true
left join measurement_error_log e on cm.CoreMeasurementID = e.MeasurementID
    and e.ErrorID = (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
where cm.IsValidated is null
and cm.IsActive is true
and e.MeasurementID is null
and cm.MeasuredDBH is not null
-- Flag if measured DBH is outside species-specific bounds
and (
    (sl.LowerBound is not null and cm.MeasuredDBH < sl.LowerBound)
    or (sl.UpperBound is not null and cm.MeasuredDBH > sl.UpperBound)
)
and (@p_CensusID is null or cm.CensusID = @p_CensusID)
and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (17, 'ValidateQuadratMismatchAcrossCensuses',
            'Quadrat mismatch with previous census for same TreeTag/StemTag',
            'quadratName;treeTag;stemTag',
            'CALL RunSharedCrossCensusLocationValidations(@p_CensusID, @p_PlotID, 1, 0);', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (18, 'ValidateCoordinateDriftAcrossCensuses',
            'Coordinate drift exceeds 10m versus previous census for same TreeTag/StemTag',
            'stemLocalX;stemLocalY;treeTag;stemTag',
            'CALL RunSharedCrossCensusLocationValidations(@p_CensusID, @p_PlotID, 0, 1);', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (12, 'ValidateScreenStemsWithMeasurementsButDeadAttributes',
            'Invalid DBH;Invalid HOM;DEAD-state attribute(s)',
            'measuredDBH;measuredHOM;attributes', 'insert into measurement_error_log (MeasurementID, ErrorID)
select distinct cm.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1) as ErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join cmattributes cma on cm.CoreMeasurementID = cma.CoreMeasurementID
         join attributes a on cma.Code = a.Code and a.IsActive is true
              and cma.Code = a.Code and a.Status in (\'dead\', \'stem dead\', \'missing\', \'broken below\', \'omitted\')
         left join measurement_error_log e
                   on cm.CoreMeasurementID = e.MeasurementID and e.ErrorID = (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
where cm.IsValidated is null and cm.IsActive is true
  and e.MeasurementID is null
  and ((cm.MeasuredDBH is not null and cm.MeasuredDBH <> 0)
    or (cm.MeasuredHOM is not null and cm.MeasuredHOM <> 0))
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);
', '', false);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (13, 'ValidateScreenStemsWithMissingMeasurementsButLiveAttributes',
            'Live stem is missing DBH measurement (HOM is optional)', 'measuredDBH;attributes', 'insert into measurement_error_log (MeasurementID, ErrorID)
select distinct cm.CoreMeasurementID, (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1) as ErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join cmattributes cma on cm.CoreMeasurementID = cma.CoreMeasurementID
         join attributes a on cma.Code = a.Code and a.IsActive is true
              and a.Status not in (\'dead\', \'stem dead\', \'missing\', \'broken below\', \'omitted\')
         left join measurement_error_log e
                   on cm.CoreMeasurementID = e.MeasurementID and e.ErrorID = (SELECT me2.ErrorID FROM measurement_errors me2 WHERE me2.ErrorSource = ''validation'' AND me2.ErrorCode = CAST(@validationProcedureID AS CHAR) LIMIT 1)
where cm.IsValidated is null and cm.IsActive is true
  and e.MeasurementID is null
  -- Only flag if DBH is missing - HOM is optional (defaults to standard 1.3m)
  and (cm.MeasuredDBH is null or cm.MeasuredDBH = 0)
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', false);
    set foreign_key_checks = 1;
end $$

-- refresh_failedmeasurements_current and reviewfailed removed:
-- These operated on the legacy failedmeasurements table.
-- Failure re-validation is now handled via API routes against
-- coremeasurements (StemGUID=NULL) + measurement_error_log.

DELIMITER ;
DROP PROCEDURE IF EXISTS bulkingestionprocess;
DELIMITER $$

CREATE
    DEFINER = azureroot@`%` PROCEDURE bulkingestionprocess(IN vFileID varchar(36), IN vBatchID varchar(36))
main_proc:
BEGIN
    DECLARE vCurrentCensusID int;
    DECLARE vCurrentPlotID int;
    DECLARE vCurrentPlotCensusNumber INT DEFAULT NULL;
    DECLARE vPreviousCensusID int DEFAULT NULL;
    DECLARE vPreviousPlotCensusNumber INT DEFAULT NULL;
    DECLARE vBatchFailed BOOLEAN DEFAULT FALSE;
    DECLARE vErrorMessage TEXT DEFAULT '';
    DECLARE vErrorCode VARCHAR(10) DEFAULT '';
    DECLARE vBatchRowCount INT DEFAULT 0;
    DECLARE vBatchScopeGroups INT DEFAULT 0;
    DECLARE vDataLossCount INT DEFAULT 0;
    DECLARE vProcessedCount INT DEFAULT 0;
    -- Fixed-width opaque id avoids overflow when long file names are combined
    -- with generated sub-batch ids.
    DECLARE vUploadId VARCHAR(50);
    DECLARE vProcStart DATETIME(6) DEFAULT NOW(6);
    DECLARE vStageStart DATETIME(6);
    DECLARE vValidationMs INT DEFAULT 0;
    DECLARE vDedupeMs INT DEFAULT 0;
    DECLARE vReferenceMs INT DEFAULT 0;
    DECLARE vPrevLookupMs INT DEFAULT 0;
    DECLARE vCrossCensusMs INT DEFAULT 0;
    DECLARE vTreeStemInsertMs INT DEFAULT 0;
    DECLARE vStemCrossIdMs INT DEFAULT 0;
    DECLARE vCoreInsertMs INT DEFAULT 0;
    DECLARE vAttributesMs INT DEFAULT 0;
    DECLARE vSoftValidationMs INT DEFAULT 0;

    -- Error handler with proper logging
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
        BEGIN
            GET DIAGNOSTICS CONDITION 1
                vErrorMessage = MESSAGE_TEXT,
                vErrorCode = MYSQL_ERRNO;

            SET vBatchFailed = TRUE;
            SET vUploadId = LEFT(
                SHA2(
                    CONCAT_WS(
                        '#',
                        DATABASE(),
                        COALESCE(vCurrentPlotID, 0),
                        COALESCE(vCurrentCensusID, 0),
                        COALESCE(vFileID, ''),
                        COALESCE(vBatchID, '')
                    ),
                    256
                ),
                40
            );
            ROLLBACK;

            -- Log to uploadmetrics
            INSERT IGNORE INTO uploadmetrics (
                uploadId, fileID, batchID, schema_name, plotID, censusID,
                sourceRecords, processedRecords, failedRecords, missingRecords,
                dataLossDetected, status, errorMessage, startTime, endTime
            ) VALUES (
                vUploadId, vFileID, vBatchID, DATABASE(),
                COALESCE(vCurrentPlotID, 0), COALESCE(vCurrentCensusID, 0),
                vBatchRowCount, 0, vBatchRowCount, 0,
                1, 'failed', CONCAT('Error ', vErrorCode, ': ', LEFT(vErrorMessage, 200)),
                NOW(), NOW()
            )
            ON DUPLICATE KEY UPDATE
                status = 'failed',
                failedRecords = vBatchRowCount,
                errorMessage = CONCAT('Error ', vErrorCode, ': ', LEFT(vErrorMessage, 200)),
                endTime = NOW();

            -- Log to uploadintegrityalerts
            INSERT IGNORE INTO uploadintegrityalerts (
                uploadId, fileID, batchID, plotID, censusID,
                type, message, severity,
                sourceRecords, processedRecords, failedRecords, missingRecords
            ) VALUES (
                vUploadId, vFileID, vBatchID,
                COALESCE(vCurrentPlotID, 0), COALESCE(vCurrentCensusID, 0),
                'PROCEDURE_EXCEPTION',
                CONCAT('SQL error ', vErrorCode, ': ', LEFT(vErrorMessage, 200)),
                'critical',
                vBatchRowCount, 0, vBatchRowCount, 0
            );

            -- Move all batch to coremeasurements as unresolved failures (StemGUID=NULL)
            INSERT IGNORE INTO coremeasurements
                (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
                 Description, UploadFileID, UploadBatchID,
                 RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY,
                 RawCodes, RawComments, SourceRowIndex, IsActive)
            SELECT
                (SELECT CensusID FROM temporarymeasurements WHERE FileID = vFileID AND BatchID = vBatchID LIMIT 1),
                NULL, FALSE,
                NULLIF(MeasurementDate, '1900-01-01'), NULLIF(DBH, 0), NULLIF(HOM, 0),
                LEFT(CONCAT('SQL Exception: Error ', vErrorCode, ': ', LEFT(vErrorMessage, 150)), 255),
                vFileID, vBatchID,
                NULLIF(TreeTag, ''), NULLIF(StemTag, ''), NULLIF(SpeciesCode, ''), NULLIF(QuadratName, ''),
                LocalX, LocalY, NULLIF(Codes, ''), NULLIF(Comments, ''),
                id, 1
            FROM temporarymeasurements
            WHERE FileID = vFileID AND BatchID = vBatchID
            ON DUPLICATE KEY UPDATE IsValidated = FALSE, Description = VALUES(Description);

            -- Link to error log
            INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
            SELECT cm.CoreMeasurementID, me.ErrorID, FALSE
            FROM coremeasurements cm
            JOIN measurement_errors me
                ON me.ErrorSource = 'ingestion' AND me.ErrorCode = 'SQL_EXCEPTION'
            WHERE cm.UploadBatchID = vBatchID AND cm.UploadFileID = vFileID AND cm.StemGUID IS NULL;

            DELETE FROM temporarymeasurements WHERE FileID = vFileID AND BatchID = vBatchID;

            DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, duplicate_failures, tag_stemtag_collision_groups, tag_stemtag_collision_failures,
                quadrat_resolution, species_resolution,
                filter_validity, filtered,
                classified_filtered, validation_failures, invalid_code_rows, hard_failure_rows, requested_prev_trees,
                requested_prev_stems, prev_tree_lookup, prev_stem_lookup,
                prev_match_ambiguities, tree_insert_candidates, tree_insert_failures,
                current_tree_lookup, stem_resolution_rows, stem_insert_candidates,
                unresolved_stem_rows, current_stem_lookup, resolved_batch_rows,
                core_insert_candidates, source_row_insert_conflicts, core_insert_failures, resolved_coremeasurements,
                orphaned_rows, tempcodes, idf_first_occurrence, same_batch_species_conflicts,
                species_mismatch_records, quadrat_mismatch_failures, coordinate_drift_failures;

            SELECT CONCAT('Batch ', vBatchID, ' failed: ', vErrorCode) as message, TRUE as batch_failed;
        END;

    SET @disable_triggers = 0;

    -- FIX: Set connection collation to match database to prevent collation errors in JSON_TABLE
    SET collation_connection = 'utf8mb4_0900_ai_ci';

    -- Get batch scope
    SELECT tm.CensusID, tm.PlotID, c.PlotCensusNumber
    INTO vCurrentCensusID, vCurrentPlotID, vCurrentPlotCensusNumber
    FROM temporarymeasurements tm
    LEFT JOIN census c
        ON c.CensusID = tm.CensusID
        AND c.PlotID = tm.PlotID
    WHERE tm.FileID = vFileID AND tm.BatchID = vBatchID
    GROUP BY tm.CensusID, tm.PlotID, c.PlotCensusNumber
    LIMIT 1;

    SELECT COUNT(*)
    INTO vBatchRowCount
    FROM temporarymeasurements
    WHERE FileID = vFileID AND BatchID = vBatchID;

    IF vBatchRowCount = 0 THEN
        SET @disable_triggers = 0;
        SELECT 'No data found' as message, FALSE as batch_failed;
        LEAVE main_proc;
    END IF;

    SET vUploadId = LEFT(
        SHA2(
            CONCAT_WS(
                '#',
                DATABASE(),
                COALESCE(vCurrentPlotID, 0),
                COALESCE(vCurrentCensusID, 0),
                COALESCE(vFileID, ''),
                COALESCE(vBatchID, '')
            ),
            256
        ),
        40
    );

    SELECT COUNT(*)
    INTO vBatchScopeGroups
    FROM (
        SELECT 1
        FROM temporarymeasurements
        WHERE FileID = vFileID AND BatchID = vBatchID
        GROUP BY CensusID, PlotID
    ) batch_scopes;

    IF vBatchScopeGroups != 1 THEN
        SET vErrorMessage = CONCAT('Batch ', vBatchID, ' contains mixed plot/census scope and cannot be processed safely');

        INSERT INTO uploadmetrics (
            uploadId, fileID, batchID, schema_name, plotID, censusID,
            sourceRecords, processedRecords, failedRecords, missingRecords,
            dataLossDetected, status, errorMessage, startTime, endTime
        ) VALUES (
            vUploadId, vFileID, vBatchID, DATABASE(),
            COALESCE(vCurrentPlotID, 0), COALESCE(vCurrentCensusID, 0),
            vBatchRowCount, 0, vBatchRowCount, 0,
            1, 'failed', LEFT(vErrorMessage, 255), NOW(6), NOW(6)
        )
        ON DUPLICATE KEY UPDATE
            status = 'failed',
            sourceRecords = vBatchRowCount,
            failedRecords = vBatchRowCount,
            missingRecords = 0,
            dataLossDetected = 1,
            errorMessage = LEFT(vErrorMessage, 255),
            endTime = NOW(6);

        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity,
            sourceRecords, processedRecords, failedRecords, missingRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, COALESCE(vCurrentPlotID, 0), COALESCE(vCurrentCensusID, 0),
            'MIXED_BATCH_SCOPE',
            LEFT(vErrorMessage, 255),
            'critical',
            vBatchRowCount, 0, vBatchRowCount, 0
        );

        SET @disable_triggers = 0;
        SELECT vErrorMessage AS message,
               TRUE AS batch_failed,
               vBatchRowCount AS records_failed,
               0 AS validation_ms, 0 AS dedupe_ms, 0 AS reference_ms,
               0 AS prev_lookup_ms, 0 AS cross_census_ms,
               0 AS tree_stem_insert_ms, 0 AS stem_crossid_ms,
               0 AS core_insert_ms, 0 AS attributes_ms,
               0 AS soft_validation_ms,
               0 AS total_duration_ms;
        LEAVE main_proc;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM census c
        WHERE c.CensusID = vCurrentCensusID
          AND c.PlotID = vCurrentPlotID
        LIMIT 1
    ) THEN
        SET vErrorMessage = CONCAT('Batch ', vBatchID, ' references missing census ', vCurrentCensusID, ' for plot ', vCurrentPlotID);

        INSERT INTO uploadmetrics (
            uploadId, fileID, batchID, schema_name, plotID, censusID,
            sourceRecords, processedRecords, failedRecords, missingRecords,
            dataLossDetected, status, errorMessage, startTime, endTime
        ) VALUES (
            vUploadId, vFileID, vBatchID, DATABASE(),
            COALESCE(vCurrentPlotID, 0), COALESCE(vCurrentCensusID, 0),
            vBatchRowCount, 0, vBatchRowCount, 0,
            1, 'failed', LEFT(vErrorMessage, 255), NOW(6), NOW(6)
        )
        ON DUPLICATE KEY UPDATE
            status = 'failed',
            sourceRecords = vBatchRowCount,
            failedRecords = vBatchRowCount,
            missingRecords = 0,
            dataLossDetected = 1,
            errorMessage = LEFT(vErrorMessage, 255),
            endTime = NOW(6);

        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity,
            sourceRecords, processedRecords, failedRecords, missingRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, COALESCE(vCurrentPlotID, 0), COALESCE(vCurrentCensusID, 0),
            'MISSING_CENSUS_SCOPE',
            LEFT(vErrorMessage, 255),
            'critical',
            vBatchRowCount, 0, vBatchRowCount, 0
        );

        SET @disable_triggers = 0;
        SELECT vErrorMessage AS message,
               TRUE AS batch_failed,
               vBatchRowCount AS records_failed,
               0 AS validation_ms, 0 AS dedupe_ms, 0 AS reference_ms,
               0 AS prev_lookup_ms, 0 AS cross_census_ms,
               0 AS tree_stem_insert_ms, 0 AS stem_crossid_ms,
               0 AS core_insert_ms, 0 AS attributes_ms,
               0 AS soft_validation_ms,
               0 AS total_duration_ms;
        LEAVE main_proc;
    END IF;

    SELECT c_prev.CensusID, c_prev.PlotCensusNumber
    INTO vPreviousCensusID, vPreviousPlotCensusNumber
    FROM census c_prev
    WHERE c_prev.PlotID = vCurrentPlotID
      AND c_prev.PlotCensusNumber = vCurrentPlotCensusNumber - 1
      AND c_prev.IsActive = 1
    ORDER BY c_prev.CensusID DESC
    LIMIT 1;

    -- ============================================================
    -- PERFORMANCE FIX: Use uploadmetrics for idempotency check
    -- instead of scanning coremeasurements with JSON extraction
    -- This changes O(N) per batch to O(1) using indexed lookup
    -- ============================================================
    IF EXISTS (
        SELECT 1 FROM uploadmetrics
        WHERE batchID = vBatchID
          AND censusID = vCurrentCensusID
          AND status = 'completed'
        LIMIT 1
    ) THEN
        -- Batch already processed, skip and clean up temporarymeasurements
        DELETE FROM temporarymeasurements WHERE FileID = vFileID AND BatchID = vBatchID;
        SET @disable_triggers = 0;
        SELECT CONCAT('Batch ', vBatchID, ' already processed, skipped') as message, FALSE as batch_failed;
        LEAVE main_proc;
    END IF;

    -- If a prior run crashed or failed mid-execution, uploadmetrics is left in
    -- status='processing' or status='failed' and coremeasurements may still
    -- contain unresolved rows from that attempt. Clean up the stale state so a
    -- retry can proceed cleanly instead of colliding on batch-scoped unique keys.
    IF EXISTS (
        SELECT 1 FROM uploadmetrics
        WHERE batchID = vBatchID
          AND censusID = vCurrentCensusID
          AND status IN ('processing', 'failed')
        LIMIT 1
    ) THEN
        -- Remove partial coremeasurements from the stale run
        DELETE FROM coremeasurements
        WHERE UploadBatchID = vBatchID AND UploadFileID = vFileID;
        -- Reset uploadmetrics so the fresh INSERT below succeeds
        DELETE FROM uploadmetrics
        WHERE batchID = vBatchID
          AND censusID = vCurrentCensusID
          AND status IN ('processing', 'failed');
    END IF;

    -- Initialize metrics
    INSERT IGNORE INTO uploadmetrics (
        uploadId, fileID, batchID, schema_name, plotID, censusID,
        sourceRecords, processedRecords, failedRecords, missingRecords,
        status, startTime
    ) VALUES (
        vUploadId, vFileID, vBatchID, DATABASE(),
        vCurrentPlotID, vCurrentCensusID,
        vBatchRowCount, 0, 0, 0,
        'processing', NOW()
    );

    DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, duplicate_failures, tag_stemtag_collision_groups, tag_stemtag_collision_failures,
        quadrat_resolution, species_resolution,
        filter_validity, filtered,
        classified_filtered, validation_failures, invalid_code_rows, hard_failure_rows, requested_prev_trees,
        requested_prev_stems, prev_tree_lookup, prev_stem_lookup,
        prev_match_ambiguities, tree_insert_candidates, tree_insert_failures,
        current_tree_lookup, stem_resolution_rows, stem_insert_candidates,
        unresolved_stem_rows, current_stem_lookup, resolved_batch_rows,
        core_insert_candidates, source_row_insert_conflicts, core_insert_failures, resolved_coremeasurements,
        orphaned_rows, tempcodes, idf_first_occurrence, same_batch_species_conflicts,
        species_mismatch_records, quadrat_mismatch_failures, coordinate_drift_failures;

    START TRANSACTION;

    CREATE TEMPORARY TABLE hard_failure_rows
    (
        SourceRowIndex BIGINT UNSIGNED NOT NULL,
        ErrorCode      VARCHAR(50)     NOT NULL,
        FailureReason  VARCHAR(255)    NOT NULL,
        PRIMARY KEY (SourceRowIndex, ErrorCode),
        KEY idx_hard_failure_errorcode (ErrorCode)
    );

    -- ============================================================
    -- STAGE 1: EARLY VALIDATION
    -- ============================================================
    SET vStageStart = NOW(6);

    CREATE TEMPORARY TABLE validation_failures AS
    SELECT tm.id,
           LEFT(CONCAT_WS('; ',
               IF(tm.TreeTag IS NULL OR TRIM(tm.TreeTag) = '',
                   'Missing required field: TreeTag', NULL),
               IF(tm.StemTag IS NULL OR TRIM(tm.StemTag) = '',
                   'Missing required field: StemTag', NULL),
               IF(tm.SpeciesCode IS NULL OR TRIM(tm.SpeciesCode) = '',
                   'Missing required field: SpeciesCode', NULL),
               IF(tm.QuadratName IS NULL OR TRIM(tm.QuadratName) = '',
                   'Missing required field: QuadratName', NULL),
               IF(tm.MeasurementDate IS NULL,
                   'Missing required field: MeasurementDate', NULL),
               IF(LENGTH(tm.TreeTag) > 20,
                   CONCAT('TreeTag exceeds maximum length of 20 characters: "', LEFT(tm.TreeTag, 25), '..." (', LENGTH(tm.TreeTag), ' chars)'), NULL),
               IF(LENGTH(tm.StemTag) > 10,
                   CONCAT('StemTag exceeds maximum length of 10 characters: "', tm.StemTag, '" (', LENGTH(tm.StemTag), ' chars)'), NULL),
               IF(LENGTH(tm.SpeciesCode) > 25,
                   CONCAT('SpeciesCode exceeds maximum length of 25 characters: "', tm.SpeciesCode, '" (', LENGTH(tm.SpeciesCode), ' chars)'), NULL),
               IF(tm.Comments IS NOT NULL AND LENGTH(tm.Comments) > 255,
                   CONCAT('Comments exceed maximum length of 255 characters (', LENGTH(tm.Comments), ' chars, truncated)'), NULL),
               IF(tm.Codes IS NOT NULL AND LENGTH(tm.Codes) > 255,
                   CONCAT('Codes exceed maximum length of 255 characters (', LENGTH(tm.Codes), ' chars, truncated)'), NULL),
               IF(tm.DBH < 0,
                   CONCAT('Invalid DBH: ', tm.DBH, ' (must be >= 0 or NULL)'), NULL),
               IF(tm.HOM < 0,
                   CONCAT('Invalid HOM: ', tm.HOM, ' (must be >= 0 or NULL)'), NULL),
               IF(tm.LocalX < 0, CONCAT('Invalid LocalX: ', tm.LocalX), NULL),
               IF(tm.LocalY < 0, CONCAT('Invalid LocalY: ', tm.LocalY), NULL),
               IF(tm.DBH = 0 AND tm.HOM = 0 AND (tm.Codes IS NULL OR TRIM(tm.Codes) = ''),
                   'Missing measurement data: DBH and HOM both 0 with no codes', NULL)
           ), 255) AS FailureReason
    FROM temporarymeasurements tm
    WHERE tm.FileID = vFileID AND tm.BatchID = vBatchID AND tm.CensusID = vCurrentCensusID
    HAVING FailureReason IS NOT NULL AND FailureReason != '';

    CREATE INDEX idx_validation_failures_id ON validation_failures (id);

    INSERT IGNORE INTO hard_failure_rows (SourceRowIndex, ErrorCode, FailureReason)
    SELECT vf.id, err.ErrorCode, vf.FailureReason
    FROM validation_failures vf
    JOIN (
        SELECT 'Missing required field: TreeTag' AS pattern, 'MISSING_FIELD_TREETAG' AS ErrorCode
        UNION ALL SELECT 'Missing required field: StemTag', 'MISSING_FIELD_STEMTAG'
        UNION ALL SELECT 'Missing required field: SpeciesCode', 'MISSING_FIELD_SPECIESCODE'
        UNION ALL SELECT 'Missing required field: QuadratName', 'MISSING_FIELD_QUADRATNAME'
        UNION ALL SELECT 'Missing required field: MeasurementDate', 'MISSING_FIELD_DATE'
        UNION ALL SELECT 'Missing measurement data', 'MISSING_MEASUREMENT_DATA'
        UNION ALL SELECT 'Invalid Local', 'INVALID_COORDINATE'
        UNION ALL SELECT 'exceeds maximum length', 'FIELD_TOO_LONG'
        UNION ALL SELECT 'Invalid DBH', 'NEGATIVE_DBH'
        UNION ALL SELECT 'Invalid HOM', 'NEGATIVE_HOM'
    ) err ON vf.FailureReason LIKE CONCAT('%', err.pattern, '%');

    IF EXISTS(SELECT 1 FROM validation_failures) THEN
        SET @validation_fail_count = (SELECT COUNT(*) FROM validation_failures);

        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity,
            sourceRecords, processedRecords, failedRecords, missingRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
            'VALIDATION_FAILURE',
            CONCAT(@validation_fail_count, ' records failed validation (NULL required fields or invalid values)'),
            'warning',
            vBatchRowCount, 0, @validation_fail_count, 0
        );
    END IF;

    SET vValidationMs = TIMESTAMPDIFF(MICROSECOND, vStageStart, NOW(6)) DIV 1000;

    -- ============================================================
    -- STAGE 1b: CODE VALIDATION
    -- ============================================================

    CREATE TEMPORARY TABLE invalid_code_rows AS
    SELECT tm.id,
           LEFT(CONCAT('Invalid attribute code(s): ',
                GROUP_CONCAT(DISTINCT TRIM(jt.code) ORDER BY TRIM(jt.code) SEPARATOR ', ')), 255) AS FailureReason
    FROM temporarymeasurements tm,
    JSON_TABLE(
        CONCAT('["', REPLACE(TRIM(tm.Codes), ';', '","'), '"]'),
        '$[*]' COLUMNS (code VARCHAR(10) COLLATE utf8mb4_0900_ai_ci PATH '$')
    ) jt
    LEFT JOIN attributes a ON a.Code = TRIM(jt.code) AND a.IsActive = 1
    WHERE tm.FileID = vFileID AND tm.BatchID = vBatchID AND tm.CensusID = vCurrentCensusID
      AND tm.id NOT IN (SELECT id FROM validation_failures)
      AND tm.Codes IS NOT NULL AND TRIM(tm.Codes) != ''
      AND a.Code IS NULL
    GROUP BY tm.id;

    CREATE INDEX idx_invalid_code_rows_id ON invalid_code_rows (id);

    INSERT IGNORE INTO hard_failure_rows (SourceRowIndex, ErrorCode, FailureReason)
    SELECT id, 'INVALID_ATTRIBUTE_CODE', FailureReason
    FROM invalid_code_rows;

    -- ============================================================
    -- STAGE 2: DEDUPLICATION
    -- ============================================================
    SET vStageStart = NOW(6);

    CREATE TEMPORARY TABLE initial_dup_filter AS
    SELECT MIN(id) AS id,
           COUNT(*) AS duplicate_count,
           FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode,
           QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate,
           NULLIF(GROUP_CONCAT(DISTINCT CASE WHEN Codes IS NOT NULL AND TRIM(Codes) != '' THEN TRIM(Codes) END
                   ORDER BY Codes SEPARATOR ';'), '') AS Codes,
           NULLIF(GROUP_CONCAT(DISTINCT CASE WHEN Comments IS NOT NULL AND TRIM(Comments) != '' THEN TRIM(Comments) END
                   ORDER BY Comments SEPARATOR ' | '), '') AS Comments
    FROM temporarymeasurements
    WHERE FileID = vFileID AND BatchID = vBatchID AND CensusID = vCurrentCensusID
      AND id NOT IN (SELECT SourceRowIndex FROM hard_failure_rows)
    GROUP BY FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode,
             QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate;

    CREATE INDEX idx_dup_filter_id ON initial_dup_filter (id);
    CREATE INDEX idx_dup_tree_species ON initial_dup_filter (TreeTag, SpeciesCode);
    CREATE INDEX idx_dup_quadrat ON initial_dup_filter (QuadratName);

    CREATE TEMPORARY TABLE duplicate_failures AS
    SELECT tm.id,
           LEFT(CONCAT('Duplicate entry: Same TreeTag/StemTag/DBH/HOM/Date. Original record ID: ', idf.id), 255) AS FailureReason
    FROM temporarymeasurements tm
    INNER JOIN initial_dup_filter idf
        ON tm.FileID = idf.FileID AND tm.BatchID = idf.BatchID
        AND tm.TreeTag = idf.TreeTag AND tm.StemTag = idf.StemTag
        AND tm.SpeciesCode = idf.SpeciesCode AND tm.QuadratName = idf.QuadratName
        AND tm.LocalX <=> idf.LocalX
        AND tm.LocalY <=> idf.LocalY
        AND COALESCE(tm.DBH, 0) = COALESCE(idf.DBH, 0)
        AND COALESCE(tm.HOM, 0) = COALESCE(idf.HOM, 0)
        AND COALESCE(tm.MeasurementDate, '1900-01-01') = COALESCE(idf.MeasurementDate, '1900-01-01')
    WHERE tm.id != idf.id AND idf.duplicate_count > 1;

    CREATE INDEX idx_duplicate_failures_id ON duplicate_failures (id);

    INSERT IGNORE INTO hard_failure_rows (SourceRowIndex, ErrorCode, FailureReason)
    SELECT id, 'DUPLICATE_ENTRY', FailureReason
    FROM duplicate_failures;

    IF EXISTS(SELECT 1 FROM duplicate_failures) THEN
        SET @dup_count = (SELECT COUNT(*) FROM duplicate_failures);

        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity,
            sourceRecords, processedRecords, failedRecords, missingRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
            'DUPLICATE_RECORDS',
            CONCAT(@dup_count, ' duplicate records detected and flagged as unresolved'),
            'info',
            vBatchRowCount, 0, @dup_count, 0
        );

        UPDATE uploadmetrics
        SET duplicatesDetected = 1
        WHERE uploadId = vUploadId;
    END IF;

    -- ----------------------------------------------------------------
    -- Stage 2b: Within-batch TreeTag+StemTag collision detection.
    -- Any rows sharing (CensusID, TreeTag, StemTag) within this batch
    -- that were NOT collapsed as exact duplicates in Stage 2a are
    -- flagged as DUPLICATE_TAG_STEMTAG. ALL rows in the collision
    -- group fail (no winner is picked, because non-tag fields differ
    -- and we have no safe basis to choose).
    -- ----------------------------------------------------------------
    CREATE TEMPORARY TABLE tag_stemtag_collision_groups AS
    SELECT CensusID, TreeTag, StemTag, COUNT(*) AS collision_count
    FROM temporarymeasurements
    WHERE FileID = vFileID AND BatchID = vBatchID AND CensusID = vCurrentCensusID
      AND id NOT IN (SELECT id FROM validation_failures)
      AND id NOT IN (SELECT id FROM duplicate_failures)
      AND TreeTag IS NOT NULL AND TRIM(TreeTag) <> ''
      AND StemTag IS NOT NULL AND TRIM(StemTag) <> ''
    GROUP BY CensusID, TreeTag, StemTag
    HAVING COUNT(*) > 1;

    CREATE INDEX idx_tag_stemtag_collision_groups
        ON tag_stemtag_collision_groups (CensusID, TreeTag, StemTag);

    CREATE TEMPORARY TABLE tag_stemtag_collision_failures AS
    SELECT tm.id,
           LEFT(CONCAT('Duplicate TreeTag/StemTag within upload batch: "',
                       tm.TreeTag, '"/"', tm.StemTag,
                       '" appears ', g.collision_count,
                       ' times with differing data; resolve in source file.'),
                255) AS FailureReason
    FROM temporarymeasurements tm
    INNER JOIN tag_stemtag_collision_groups g
        ON g.CensusID = tm.CensusID
       AND g.TreeTag = tm.TreeTag
       AND g.StemTag = tm.StemTag
    WHERE tm.FileID = vFileID AND tm.BatchID = vBatchID
      AND tm.id NOT IN (SELECT id FROM validation_failures)
      AND tm.id NOT IN (SELECT id FROM duplicate_failures);

    CREATE INDEX idx_tag_stemtag_collision_failures_id
        ON tag_stemtag_collision_failures (id);

    INSERT IGNORE INTO hard_failure_rows (SourceRowIndex, ErrorCode, FailureReason)
    SELECT id, 'DUPLICATE_TAG_STEMTAG', FailureReason
    FROM tag_stemtag_collision_failures;

    -- Remove collision rows from initial_dup_filter so they never reach
    -- filter_validity / filtered / downstream stages. In Scenario B each
    -- collision row has duplicate_count=1 in Stage 2a's GROUP BY, so its
    -- MIN(id) equals its own id — deleting by id is safe.
    DELETE idf
    FROM initial_dup_filter idf
    INNER JOIN tag_stemtag_collision_failures cf ON cf.id = idf.id;

    IF EXISTS(SELECT 1 FROM tag_stemtag_collision_failures) THEN
        SET @tag_stemtag_collision_count =
            (SELECT COUNT(*) FROM tag_stemtag_collision_failures);

        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity,
            sourceRecords, processedRecords, failedRecords, missingRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
            'DUPLICATE_TAG_STEMTAG',
            CONCAT(@tag_stemtag_collision_count,
                   ' records share a TreeTag/StemTag within the batch and were failed'),
            'warning',
            vBatchRowCount, 0, @tag_stemtag_collision_count, 0
        );

        UPDATE uploadmetrics
        SET duplicatesDetected = 1
        WHERE uploadId = vUploadId;
    END IF;

    SET vDedupeMs = TIMESTAMPDIFF(MICROSECOND, vStageStart, NOW(6)) DIV 1000;

    -- ============================================================
    -- STAGE 3: REFERENCE LOOKUPS
    -- ============================================================
    SET vStageStart = NOW(6);

    -- Build aggregating resolution tables for quadrat and species lookups.
    -- These collapse the reference rows down to one row per (PlotID, QuadratName)
    -- and one row per SpeciesCode, recording how many active rows matched. Joining
    -- against these tables instead of the raw reference tables guarantees that a
    -- single source row can never fan out into multiple candidates downstream,
    -- and lets us distinguish "no match" (INVALID_*) from "ambiguous match"
    -- (AMBIGUOUS_*) explicitly instead of silently producing duplicate rows.
    CREATE TEMPORARY TABLE quadrat_resolution AS
    SELECT q.PlotID,
           q.QuadratName,
           COUNT(*)        AS MatchCount,
           MIN(q.QuadratID) AS QuadratID,
           LEFT(GROUP_CONCAT(q.QuadratID ORDER BY q.QuadratID SEPARATOR ','), 200) AS MatchingIDs
    FROM quadrats q
    INNER JOIN (SELECT DISTINCT PlotID, QuadratName FROM initial_dup_filter) i
        ON i.PlotID = q.PlotID AND i.QuadratName = q.QuadratName
    WHERE q.IsActive = 1
    GROUP BY q.PlotID, q.QuadratName;

    CREATE INDEX idx_quadrat_resolution_lookup
        ON quadrat_resolution (PlotID, QuadratName);

    CREATE TEMPORARY TABLE species_resolution AS
    SELECT s.SpeciesCode,
           COUNT(*)        AS MatchCount,
           MIN(s.SpeciesID) AS SpeciesID,
           LEFT(GROUP_CONCAT(s.SpeciesID ORDER BY s.SpeciesID SEPARATOR ','), 200) AS MatchingIDs
    FROM species s
    INNER JOIN (SELECT DISTINCT SpeciesCode FROM initial_dup_filter) i
        ON i.SpeciesCode = s.SpeciesCode
    WHERE s.IsActive = 1
    GROUP BY s.SpeciesCode;

    CREATE INDEX idx_species_resolution_lookup
        ON species_resolution (SpeciesCode);

    CREATE TEMPORARY TABLE filter_validity AS
    SELECT i.id, i.FileID, i.BatchID, i.PlotID, i.CensusID, i.TreeTag,
           IFNULL(i.StemTag, '') AS StemTag, i.SpeciesCode, i.QuadratName,
           i.LocalX, i.LocalY,
           IFNULL(i.DBH, 0) AS DBH, IFNULL(i.HOM, 0) AS HOM,
           i.MeasurementDate, i.Codes, i.Comments,
           CASE
               WHEN tq.PlotID IS NULL
                   THEN CONCAT('Invalid quadrat name: "', i.QuadratName, '" not found in database')
               WHEN tq.MatchCount > 1
                   THEN CONCAT('Ambiguous quadrat name: "', i.QuadratName,
                               '" matches ', tq.MatchCount,
                               ' active quadrats in plot ', i.PlotID,
                               ' (QuadratIDs: ', tq.MatchingIDs, ')')
               WHEN ts.SpeciesCode IS NULL
                   THEN CONCAT('Invalid species code: "', i.SpeciesCode, '" not found in database')
               WHEN ts.MatchCount > 1
                   THEN CONCAT('Ambiguous species code: "', i.SpeciesCode,
                               '" matches ', ts.MatchCount,
                               ' active species records (SpeciesIDs: ', ts.MatchingIDs, ')')
               ELSE NULL
           END AS FailureReason,
           CASE
               WHEN tq.PlotID IS NULL OR tq.MatchCount > 1
                 OR ts.SpeciesCode IS NULL OR ts.MatchCount > 1
                   THEN FALSE
               ELSE TRUE
           END AS Valid,
           tq.QuadratID, ts.SpeciesID
    FROM initial_dup_filter i
    LEFT JOIN quadrat_resolution tq
        ON tq.PlotID = i.PlotID AND tq.QuadratName = i.QuadratName
    LEFT JOIN species_resolution ts
        ON ts.SpeciesCode = i.SpeciesCode;

    CREATE INDEX idx_validity_valid ON filter_validity (Valid);
    CREATE INDEX idx_validity_tree ON filter_validity (TreeTag, SpeciesID, CensusID);

    CREATE TEMPORARY TABLE filtered AS
    SELECT *
    FROM filter_validity
    WHERE Valid = TRUE;

    CREATE INDEX idx_filtered_id ON filtered (id);
    CREATE INDEX idx_filtered_tree_census ON filtered (TreeTag, CensusID);
    CREATE INDEX idx_filtered_stem_tree ON filtered (StemTag, TreeTag);
    CREATE INDEX idx_filtered_species ON filtered (SpeciesID);

    -- Prefix-anchored matching: order matters because the more-specific
    -- "Ambiguous quadrat name" must be tested before any pattern that would
    -- also match "quadrat name". Each branch maps directly to the message
    -- shape produced by the filter_validity CASE above.
    INSERT IGNORE INTO hard_failure_rows (SourceRowIndex, ErrorCode, FailureReason)
    SELECT fv.id,
           CASE
               WHEN fv.FailureReason LIKE 'Ambiguous quadrat name%' THEN 'AMBIGUOUS_QUADRAT'
               WHEN fv.FailureReason LIKE 'Ambiguous species code%' THEN 'AMBIGUOUS_SPECIES'
               WHEN fv.FailureReason LIKE 'Invalid quadrat name%'  THEN 'INVALID_QUADRAT'
               WHEN fv.FailureReason LIKE 'Invalid species code%'  THEN 'INVALID_SPECIES'
               ELSE 'SQL_EXCEPTION'
           END,
           LEFT(fv.FailureReason, 255)
    FROM filter_validity fv
    WHERE fv.Valid = FALSE;

    IF EXISTS(SELECT 1 FROM filter_validity WHERE Valid = FALSE) THEN
        SET @invalid_count = (SELECT COUNT(*) FROM filter_validity WHERE Valid = FALSE);

        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity,
            sourceRecords, processedRecords, failedRecords, missingRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
            'INVALID_REFERENCE_DATA',
            CONCAT(@invalid_count, ' records with invalid or ambiguous species codes / quadrat names'),
            'warning',
            vBatchRowCount, 0, @invalid_count, 0
        );

        UPDATE uploadmetrics
        SET referentialIntegrityPassed = 0
        WHERE uploadId = vUploadId;
    ELSE
        UPDATE uploadmetrics
        SET referentialIntegrityPassed = 1
        WHERE uploadId = vUploadId;
    END IF;

    SET vReferenceMs = TIMESTAMPDIFF(MICROSECOND, vStageStart, NOW(6)) DIV 1000;

    -- ============================================================
    -- STAGE 4: PREVIOUS CENSUS LOOKUPS AND AMBIGUITY GUARDS
    -- ============================================================
    SET vStageStart = NOW(6);

    IF vPreviousCensusID IS NOT NULL THEN
        CREATE TEMPORARY TABLE requested_prev_trees AS
        SELECT DISTINCT TreeTag
        FROM filtered;

        CREATE INDEX idx_requested_prev_trees_tag ON requested_prev_trees (TreeTag);

        CREATE TEMPORARY TABLE requested_prev_stems AS
        SELECT DISTINCT TreeTag, StemTag
        FROM filtered;

        CREATE INDEX idx_requested_prev_stems_tags ON requested_prev_stems (TreeTag, StemTag);

        CREATE TEMPORARY TABLE prev_tree_lookup AS
        SELECT rpt.TreeTag,
               COUNT(*) AS MatchCount,
               MIN(t.SpeciesID) AS PrevSpeciesID
        FROM requested_prev_trees rpt
        INNER JOIN trees t ON t.TreeTag = rpt.TreeTag
        WHERE t.IsActive = 1
          AND t.CensusID = vPreviousCensusID
        GROUP BY rpt.TreeTag;

        CREATE INDEX idx_prev_tree_lookup_tag ON prev_tree_lookup (TreeTag);

        CREATE TEMPORARY TABLE prev_stem_lookup AS
        SELECT rps.TreeTag,
               rps.StemTag,
               COUNT(*) AS MatchCount,
               MIN(s.LocalX) AS PrevX,
               MIN(s.LocalY) AS PrevY,
               MIN(q.QuadratName) AS PrevQuadratName,
               MIN(s.StemCrossID) AS PrevStemCrossID
        FROM requested_prev_stems rps
        INNER JOIN trees t
            ON t.TreeTag = rps.TreeTag
            AND t.CensusID = vPreviousCensusID
            AND t.IsActive = 1
        INNER JOIN stems s
            ON s.TreeID = t.TreeID
            AND s.CensusID = t.CensusID
            AND s.StemTag = rps.StemTag
            AND s.IsActive = 1
        INNER JOIN quadrats q
            ON s.QuadratID = q.QuadratID
            AND q.IsActive = 1
        GROUP BY rps.TreeTag, rps.StemTag;

        CREATE INDEX idx_prev_stem_lookup_tags ON prev_stem_lookup (TreeTag, StemTag);

        CREATE TEMPORARY TABLE prev_match_ambiguities AS
        SELECT f.id,
               LEFT(CONCAT_WS('; ',
                   CASE
                       WHEN COALESCE(ptl.MatchCount, 0) > 1
                           THEN CONCAT('Ambiguous previous census tree match: TreeTag "', f.TreeTag,
                                       '" matched ', ptl.MatchCount, ' active trees in Census ', vPreviousPlotCensusNumber)
                   END,
                   CASE
                       WHEN COALESCE(psl.MatchCount, 0) > 1
                           THEN CONCAT('Ambiguous previous census stem match: TreeTag "', f.TreeTag,
                                       '" StemTag "', f.StemTag, '" matched ', psl.MatchCount,
                                       ' active stems in Census ', vPreviousPlotCensusNumber)
                   END
               ), 255) AS FailureReason
        FROM filtered f
        LEFT JOIN prev_tree_lookup ptl ON ptl.TreeTag = f.TreeTag
        LEFT JOIN prev_stem_lookup psl ON psl.TreeTag = f.TreeTag AND psl.StemTag = f.StemTag
        WHERE COALESCE(ptl.MatchCount, 0) > 1 OR COALESCE(psl.MatchCount, 0) > 1;

        CREATE INDEX idx_prev_match_ambiguities_id ON prev_match_ambiguities (id);
    ELSE
        CREATE TEMPORARY TABLE prev_tree_lookup
        (
            TreeTag       VARCHAR(20) NOT NULL,
            MatchCount    INT         NOT NULL,
            PrevSpeciesID INT         NULL,
            PRIMARY KEY (TreeTag)
        );

        CREATE TEMPORARY TABLE prev_stem_lookup
        (
            TreeTag         VARCHAR(20)   NOT NULL,
            StemTag         VARCHAR(10)   NOT NULL,
            MatchCount      INT           NOT NULL,
            PrevX           DECIMAL(12,6) NULL,
            PrevY           DECIMAL(12,6) NULL,
            PrevQuadratName VARCHAR(255)  NULL,
            PrevStemCrossID INT           NULL,
            PRIMARY KEY (TreeTag, StemTag)
        );

        CREATE TEMPORARY TABLE prev_match_ambiguities
        (
            id            BIGINT UNSIGNED NOT NULL PRIMARY KEY,
            FailureReason VARCHAR(255)    NOT NULL
        );
    END IF;

    INSERT IGNORE INTO hard_failure_rows (SourceRowIndex, ErrorCode, FailureReason)
    SELECT pma.id, 'AMBIGUOUS_PREVIOUS_MATCH', pma.FailureReason
    FROM prev_match_ambiguities pma;

    IF EXISTS(SELECT 1 FROM prev_match_ambiguities) THEN
        SET @prev_ambiguity_count = (SELECT COUNT(*) FROM prev_match_ambiguities);

        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity,
            sourceRecords, processedRecords, failedRecords, missingRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
            'PREV_CENSUS_AMBIGUITY',
            CONCAT(@prev_ambiguity_count, ' records matched multiple active previous-census identities and were left unresolved'),
            'warning',
            vBatchRowCount, 0, @prev_ambiguity_count, 0
        );

        DELETE f
        FROM filtered f
        INNER JOIN prev_match_ambiguities pma ON pma.id = f.id;
    END IF;

    CREATE TEMPORARY TABLE classified_filtered AS
    SELECT f.*,
           CASE
               WHEN COALESCE(psl.MatchCount, 0) = 1 THEN 'old tree'
               WHEN COALESCE(ptl.MatchCount, 0) = 1 THEN 'multi stem'
               ELSE 'new recruit'
           END AS tree_state
    FROM filtered f
    LEFT JOIN prev_tree_lookup ptl ON ptl.TreeTag = f.TreeTag
    LEFT JOIN prev_stem_lookup psl ON psl.TreeTag = f.TreeTag AND psl.StemTag = f.StemTag;

    CREATE INDEX idx_classified_id ON classified_filtered (id);
    CREATE INDEX idx_classified_tree_census ON classified_filtered (TreeTag, CensusID);
    CREATE INDEX idx_classified_stem_tree ON classified_filtered (StemTag, TreeTag);
    CREATE INDEX idx_classified_species ON classified_filtered (SpeciesID);
    CREATE INDEX idx_classified_resolution ON classified_filtered (CensusID, TreeTag, SpeciesID, StemTag, QuadratID);

    SET vPrevLookupMs = TIMESTAMPDIFF(MICROSECOND, vStageStart, NOW(6)) DIV 1000;

    -- ================================================================
    -- STAGE 5: CROSS-CENSUS HARD VALIDATIONS
    -- ================================================================
    SET vStageStart = NOW(6);

    CREATE TEMPORARY TABLE quadrat_mismatch_failures AS
    SELECT DISTINCT f.id,
           f.QuadratName AS CurrentQuadrat,
           psl.PrevQuadratName AS PrevQuadrat,
           LEFT(CONCAT('Quadrat mismatch: Previous census quadrat was "', psl.PrevQuadratName,
                       '", current is "', f.QuadratName,
                       '". Trees cannot change quadrats between censuses. ',
                       'Please verify TreeTag is correct or contact administrator if tree was genuinely moved.'), 255)
               AS FailureReason
    FROM classified_filtered f
    INNER JOIN prev_stem_lookup psl
        ON psl.TreeTag = f.TreeTag AND psl.StemTag = f.StemTag AND psl.MatchCount = 1
    WHERE f.tree_state = 'old tree'
      AND psl.PrevQuadratName != f.QuadratName;

    CREATE INDEX idx_quadrat_mismatch_failures_id ON quadrat_mismatch_failures (id);

    CREATE TEMPORARY TABLE coordinate_drift_failures AS
    SELECT DISTINCT f.id,
           LEFT(CONCAT('Coordinate drift: ',
                       ROUND(SQRT(POW(f.LocalX - psl.PrevX, 2) + POW(f.LocalY - psl.PrevY, 2)), 2),
                       'm from previous census (>10m threshold). ',
                       'Previous: (', psl.PrevX, ', ', psl.PrevY, '), ',
                       'Current: (', f.LocalX, ', ', f.LocalY, '). ',
                       'Please verify coordinates or mark as approved if tree genuinely moved.'), 255)
               AS FailureReason
    FROM classified_filtered f
    INNER JOIN prev_stem_lookup psl
        ON psl.TreeTag = f.TreeTag AND psl.StemTag = f.StemTag
        AND psl.MatchCount = 1 AND psl.PrevQuadratName = f.QuadratName
    WHERE f.tree_state = 'old tree'
      AND f.LocalX IS NOT NULL
      AND f.LocalY IS NOT NULL
      AND psl.PrevX IS NOT NULL
      AND psl.PrevY IS NOT NULL
      AND SQRT(POW(f.LocalX - psl.PrevX, 2) + POW(f.LocalY - psl.PrevY, 2)) > 10.0;

    CREATE INDEX idx_coordinate_drift_failures_id ON coordinate_drift_failures (id);

    INSERT IGNORE INTO hard_failure_rows (SourceRowIndex, ErrorCode, FailureReason)
    SELECT id, 'QUADRAT_MISMATCH', FailureReason
    FROM quadrat_mismatch_failures;

    INSERT IGNORE INTO hard_failure_rows (SourceRowIndex, ErrorCode, FailureReason)
    SELECT id, 'COORDINATE_DRIFT', FailureReason
    FROM coordinate_drift_failures;

    IF EXISTS(SELECT 1 FROM quadrat_mismatch_failures) OR EXISTS(SELECT 1 FROM coordinate_drift_failures) THEN
        SET @cross_census_failures = (
            SELECT COUNT(*) FROM (
                SELECT id FROM quadrat_mismatch_failures
                UNION
                SELECT id FROM coordinate_drift_failures
            ) combined
        );

        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity,
            sourceRecords, processedRecords, failedRecords, missingRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
            'CROSS_CENSUS_VALIDATION_FAILURE',
            CONCAT(@cross_census_failures, ' records failed cross-census validation (quadrat changes, coordinate drift)'),
            'warning',
            vBatchRowCount, 0, @cross_census_failures, 0
        );

        DELETE f
        FROM classified_filtered f
        INNER JOIN (
            SELECT id FROM quadrat_mismatch_failures
            UNION
            SELECT id FROM coordinate_drift_failures
        ) failed ON failed.id = f.id;
    END IF;

    SET vCrossCensusMs = TIMESTAMPDIFF(MICROSECOND, vStageStart, NOW(6)) DIV 1000;

    DROP TEMPORARY TABLE IF EXISTS quadrat_mismatch_failures, coordinate_drift_failures;

    -- =====================================================
    -- STAGE 6: TREE/STEM RESOLUTION
    -- =====================================================
    SET vStageStart = NOW(6);

    CREATE TEMPORARY TABLE tree_insert_candidates AS
    SELECT DISTINCT cf.TreeTag,
           cf.SpeciesID,
           cf.CensusID
    FROM classified_filtered cf
    WHERE cf.CensusID = vCurrentCensusID;

    CREATE INDEX idx_tree_insert_candidates_key
        ON tree_insert_candidates (TreeTag, SpeciesID, CensusID);

    CREATE TEMPORARY TABLE tree_insert_failures AS
    SELECT cf.id AS SourceRowIndex,
           CASE
               WHEN c.CensusID IS NULL THEN 'MISSING_CENSUS_FOR_TREE'
               WHEN s.SpeciesID IS NULL THEN 'MISSING_SPECIES_FOR_TREE'
               WHEN t_any.TreeID IS NOT NULL AND t_active.TreeID IS NULL THEN 'TREE_RESOLUTION_FAILED'
           END AS ErrorCode,
           LEFT(
               CASE
                   WHEN c.CensusID IS NULL
                       THEN CONCAT('Tree insert blocked: Census ', vCurrentPlotCensusNumber,
                                   ' no longer exists for TreeTag "', cf.TreeTag, '"')
                   WHEN s.SpeciesID IS NULL
                       THEN CONCAT('Tree insert blocked: species ', cf.SpeciesID,
                                   ' for TreeTag "', cf.TreeTag, '" is missing or inactive')
                   WHEN t_any.TreeID IS NOT NULL AND t_active.TreeID IS NULL
                       THEN CONCAT('Tree resolution failed: matching tree exists but is inactive for TreeTag "',
                                   cf.TreeTag, '" in Census ', vCurrentPlotCensusNumber)
               END,
               255
           ) AS FailureReason
    FROM classified_filtered cf
    LEFT JOIN census c
        ON c.CensusID = cf.CensusID
        AND c.PlotID = vCurrentPlotID
    LEFT JOIN species s
        ON s.SpeciesID = cf.SpeciesID
        AND s.IsActive = 1
    LEFT JOIN trees t_any
        ON t_any.TreeTag = cf.TreeTag
        AND t_any.SpeciesID = cf.SpeciesID
        AND t_any.CensusID = cf.CensusID
    LEFT JOIN trees t_active
        ON t_active.TreeTag = cf.TreeTag
        AND t_active.SpeciesID = cf.SpeciesID
        AND t_active.CensusID = cf.CensusID
        AND t_active.IsActive = 1
    WHERE cf.CensusID = vCurrentCensusID
      AND (
          c.CensusID IS NULL
          OR s.SpeciesID IS NULL
          OR (t_any.TreeID IS NOT NULL AND t_active.TreeID IS NULL)
      );

    CREATE INDEX idx_tree_insert_failures_row
        ON tree_insert_failures (SourceRowIndex);

    INSERT IGNORE INTO hard_failure_rows (SourceRowIndex, ErrorCode, FailureReason)
    SELECT tif.SourceRowIndex, tif.ErrorCode, tif.FailureReason
    FROM tree_insert_failures tif
    WHERE tif.ErrorCode IS NOT NULL;

    INSERT INTO trees (TreeTag, SpeciesID, CensusID)
    SELECT tic.TreeTag, tic.SpeciesID, tic.CensusID
    FROM tree_insert_candidates tic
    LEFT JOIN census c
        ON c.CensusID = tic.CensusID
        AND c.PlotID = vCurrentPlotID
    LEFT JOIN species s
        ON s.SpeciesID = tic.SpeciesID
        AND s.IsActive = 1
    LEFT JOIN trees t_any
        ON t_any.TreeTag = tic.TreeTag
        AND t_any.SpeciesID = tic.SpeciesID
        AND t_any.CensusID = tic.CensusID
    WHERE c.CensusID IS NOT NULL
      AND s.SpeciesID IS NOT NULL
      AND t_any.TreeID IS NULL;

    CREATE TEMPORARY TABLE current_tree_lookup AS
    SELECT DISTINCT t.TreeID,
           t.TreeTag,
           t.SpeciesID,
           t.CensusID
    FROM trees t
    INNER JOIN classified_filtered cf
        ON cf.TreeTag = t.TreeTag
        AND cf.SpeciesID = t.SpeciesID
        AND cf.CensusID = t.CensusID
        AND cf.CensusID = vCurrentCensusID
    WHERE t.IsActive = 1;

    CREATE INDEX idx_current_tree_lookup_tree ON current_tree_lookup (TreeTag, SpeciesID, CensusID);
    CREATE INDEX idx_current_tree_lookup_id ON current_tree_lookup (TreeID, CensusID);

    CREATE TEMPORARY TABLE stem_resolution_rows AS
    SELECT cf.id,
           cf.CensusID,
           cf.TreeTag,
           cf.StemTag,
           cf.SpeciesCode,
           cf.QuadratName,
           cf.LocalX,
           cf.LocalY,
           cf.DBH,
           cf.HOM,
           cf.MeasurementDate,
           cf.Codes,
           cf.Comments,
           cf.QuadratID,
           cf.SpeciesID,
           cf.tree_state,
           ctl.TreeID,
           CASE
               WHEN psl.MatchCount = 1 AND psl.PrevStemCrossID IS NOT NULL THEN psl.PrevStemCrossID
               ELSE NULL
           END AS PrevStemCrossID
    FROM classified_filtered cf
    INNER JOIN current_tree_lookup ctl
        ON ctl.TreeTag = cf.TreeTag
        AND ctl.SpeciesID = cf.SpeciesID
        AND ctl.CensusID = vCurrentCensusID
    LEFT JOIN prev_stem_lookup psl
        ON psl.TreeTag = cf.TreeTag
        AND psl.StemTag = cf.StemTag
    WHERE cf.CensusID = vCurrentCensusID;

    CREATE INDEX idx_stem_resolution_rows_id ON stem_resolution_rows (id);
    CREATE INDEX idx_stem_resolution_rows_tree ON stem_resolution_rows (TreeID, CensusID, StemTag);

    CREATE TEMPORARY TABLE unresolved_stem_rows
    (
        SourceRowIndex BIGINT UNSIGNED NOT NULL,
        ErrorCode      VARCHAR(50)     NOT NULL,
        FailureReason  VARCHAR(255)    NOT NULL,
        PRIMARY KEY (SourceRowIndex, ErrorCode),
        KEY idx_unresolved_stem_error (ErrorCode)
    );

    INSERT INTO unresolved_stem_rows (SourceRowIndex, ErrorCode, FailureReason)
    SELECT cf.id,
           'STEM_TREE_RESOLUTION_FAILED',
           LEFT(CONCAT('Stem resolution failed: no active tree matched TreeTag "', cf.TreeTag,
                       '" / SpeciesID ', cf.SpeciesID, ' in Census ', vCurrentPlotCensusNumber), 255)
    FROM classified_filtered cf
    LEFT JOIN current_tree_lookup ctl
        ON ctl.TreeTag = cf.TreeTag
        AND ctl.SpeciesID = cf.SpeciesID
        AND ctl.CensusID = cf.CensusID
    LEFT JOIN tree_insert_failures tif
        ON tif.SourceRowIndex = cf.id
    WHERE cf.CensusID = vCurrentCensusID
      AND ctl.TreeID IS NULL
      AND tif.SourceRowIndex IS NULL;

    CREATE TEMPORARY TABLE stem_insert_candidates AS
    SELECT DISTINCT srr.TreeID,
           srr.QuadratID,
           srr.CensusID,
           srr.PrevStemCrossID AS StemCrossID,
           CASE
               WHEN TRIM(COALESCE(srr.StemTag, '')) = '' THEN NULL
               ELSE TRIM(srr.StemTag)
           END AS StemTag,
           srr.LocalX,
           srr.LocalY
    FROM stem_resolution_rows srr;

    CREATE INDEX idx_stem_insert_candidates_key
        ON stem_insert_candidates (TreeID, CensusID, StemTag);

    -- Inline StemCrossID inheritance: set PrevStemCrossID at INSERT time for
    -- stems that have an unambiguous match in the previous census. Existing
    -- same-tree/same-stem rows are skipped explicitly and resolved below.
    INSERT IGNORE INTO stems (TreeID, QuadratID, CensusID, StemCrossID, StemTag, LocalX, LocalY, Moved, StemDescription, IsActive)
    SELECT sic.TreeID, sic.QuadratID, sic.CensusID, sic.StemCrossID,
           sic.StemTag, sic.LocalX, sic.LocalY, 0, NULL, 1
    FROM stem_insert_candidates sic
    LEFT JOIN stems s_existing
        ON s_existing.TreeID = sic.TreeID
        AND s_existing.CensusID = sic.CensusID
        AND s_existing.StemTag <=> sic.StemTag
    WHERE s_existing.StemGUID IS NULL;

    CREATE TEMPORARY TABLE current_stem_lookup AS
    SELECT DISTINCT srr.id,
           s.StemGUID
    FROM stem_resolution_rows srr
    INNER JOIN stems s
        ON s.TreeID = srr.TreeID
        AND s.CensusID = srr.CensusID
        AND s.StemTag <=> srr.StemTag
        AND s.QuadratID = srr.QuadratID
        AND s.IsActive = 1;

    CREATE INDEX idx_current_stem_lookup_id
        ON current_stem_lookup (id, StemGUID);

    INSERT INTO unresolved_stem_rows (SourceRowIndex, ErrorCode, FailureReason)
    SELECT srr.id,
           'STEM_RESOLUTION_FAILED',
           LEFT(
               CASE
                   WHEN s_blocking.StemGUID IS NOT NULL AND s_blocking.IsActive = 0
                       THEN CONCAT('Stem resolution failed: matching TreeID ', srr.TreeID,
                                   ' / StemTag "', srr.StemTag, '" exists but is inactive in Census ', vCurrentPlotCensusNumber)
                   WHEN s_blocking.StemGUID IS NOT NULL AND s_blocking.IsActive = 1
                        AND s_blocking.QuadratID <> srr.QuadratID
                       THEN CONCAT('Stem resolution failed: TreeTag "', srr.TreeTag,
                                   '" / StemTag "', srr.StemTag,
                                   '" already exists in a different quadrat for Census ', vCurrentPlotCensusNumber)
                   ELSE CONCAT('Stem resolution failed: no active stem matched TreeTag "',
                               srr.TreeTag, '" / StemTag "', srr.StemTag,
                               '" after stem materialization')
               END,
               255
           )
    FROM stem_resolution_rows srr
    LEFT JOIN current_stem_lookup csl
        ON csl.id = srr.id
    LEFT JOIN stems s_blocking
        ON s_blocking.TreeID = srr.TreeID
        AND s_blocking.CensusID = srr.CensusID
        AND s_blocking.StemTag <=> srr.StemTag
    WHERE csl.StemGUID IS NULL;

    INSERT IGNORE INTO hard_failure_rows (SourceRowIndex, ErrorCode, FailureReason)
    SELECT usr.SourceRowIndex, usr.ErrorCode, usr.FailureReason
    FROM unresolved_stem_rows usr;

    CREATE TEMPORARY TABLE resolved_batch_rows AS
    SELECT srr.id,
           srr.CensusID,
           srr.TreeTag,
           srr.StemTag,
           srr.SpeciesCode,
           srr.QuadratName,
           srr.LocalX,
           srr.LocalY,
           srr.DBH,
           srr.HOM,
           srr.MeasurementDate,
           srr.Codes,
           srr.Comments,
           srr.QuadratID,
           srr.SpeciesID,
           srr.tree_state,
           csl.StemGUID
    FROM stem_resolution_rows srr
    INNER JOIN current_stem_lookup csl
        ON csl.id = srr.id;

    CREATE INDEX idx_resolved_batch_rows_id ON resolved_batch_rows (id);
    CREATE INDEX idx_resolved_batch_rows_stem ON resolved_batch_rows (StemGUID);

    SET vTreeStemInsertMs = TIMESTAMPDIFF(MICROSECOND, vStageStart, NOW(6)) DIV 1000;

    -- =====================================================
    -- STAGE 7: STEMCROSSID SELF-ASSIGN FOR NEW STEMS
    -- Inherited StemCrossIDs were set inline during stem INSERT (Stage 6).
    -- Remaining NULL StemCrossIDs are new stems that self-assign their StemGUID.
    -- =====================================================
    SET vStageStart = NOW(6);

    UPDATE stems s
    INNER JOIN (
        SELECT DISTINCT StemGUID
        FROM resolved_batch_rows
    ) batch_stems ON batch_stems.StemGUID = s.StemGUID
    SET s.StemCrossID = s.StemGUID
    WHERE s.StemCrossID IS NULL;

    SET vStemCrossIdMs = TIMESTAMPDIFF(MICROSECOND, vStageStart, NOW(6)) DIV 1000;

    -- =====================================================
    -- STAGE 8: COREMEASUREMENTS AND HARD FAILURE MATERIALIZATION
    -- =====================================================
    SET vStageStart = NOW(6);

    CREATE TEMPORARY TABLE core_insert_failures
    (
        SourceRowIndex BIGINT UNSIGNED NOT NULL,
        ErrorCode      VARCHAR(50)     NOT NULL,
        FailureReason  VARCHAR(255)    NOT NULL,
        PRIMARY KEY (SourceRowIndex, ErrorCode),
        KEY idx_core_insert_failures_error (ErrorCode)
    );

    INSERT IGNORE INTO core_insert_failures (SourceRowIndex, ErrorCode, FailureReason)
    SELECT rbr.id,
           'MEASUREMENT_INSERT_SKIPPED',
           LEFT(
               CASE
                   WHEN cm_existing_row.CoreMeasurementID IS NOT NULL AND cm_existing_row.StemGUID IS NOT NULL
                       THEN CONCAT('Measurement insert skipped: batch source row already materialized as CoreMeasurementID ',
                                   cm_existing_row.CoreMeasurementID)
                   WHEN cm_existing_row.CoreMeasurementID IS NOT NULL AND cm_existing_row.StemGUID IS NULL
                       THEN CONCAT('Measurement insert skipped: batch source row already exists as unresolved CoreMeasurementID ',
                                   cm_existing_row.CoreMeasurementID)
                   WHEN cm_existing_measure.CoreMeasurementID IS NOT NULL
                       THEN CONCAT('Measurement insert skipped: matching measurement already exists as CoreMeasurementID ',
                                   cm_existing_measure.CoreMeasurementID,
                                   ' for StemGUID ', rbr.StemGUID)
                   ELSE 'Measurement insert skipped: resolved row was not eligible for insertion'
               END,
               255
           )
    FROM resolved_batch_rows rbr
    LEFT JOIN coremeasurements cm_existing_row
        ON cm_existing_row.UploadBatchID = vBatchID
        AND cm_existing_row.UploadFileID = vFileID
        AND cm_existing_row.SourceRowIndex = rbr.id
    LEFT JOIN coremeasurements cm_existing_measure
        ON cm_existing_measure.StemGUID = rbr.StemGUID
        AND cm_existing_measure.CensusID = rbr.CensusID
        AND cm_existing_measure.MeasurementDate <=> rbr.MeasurementDate
        AND cm_existing_measure.MeasuredDBH <=> NULLIF(rbr.DBH, 0)
        AND cm_existing_measure.MeasuredHOM <=> NULLIF(rbr.HOM, 0)
    WHERE cm_existing_row.CoreMeasurementID IS NOT NULL
       OR cm_existing_measure.CoreMeasurementID IS NOT NULL;

    CREATE TEMPORARY TABLE core_insert_candidates AS
    SELECT rbr.*
    FROM resolved_batch_rows rbr
    LEFT JOIN core_insert_failures cif
        ON cif.SourceRowIndex = rbr.id
    WHERE cif.SourceRowIndex IS NULL;

    CREATE INDEX idx_core_insert_candidates_id ON core_insert_candidates (id);
    CREATE INDEX idx_core_insert_candidates_stem ON core_insert_candidates (StemGUID);

    CREATE TEMPORARY TABLE source_row_insert_conflicts AS
    SELECT cic.id AS SourceRowIndex
    FROM core_insert_candidates cic
    GROUP BY cic.id
    HAVING COUNT(*) > 1;

    CREATE INDEX idx_source_row_insert_conflicts_id ON source_row_insert_conflicts (SourceRowIndex);

    INSERT IGNORE INTO core_insert_failures (SourceRowIndex, ErrorCode, FailureReason)
    SELECT src.SourceRowIndex,
           'MEASUREMENT_INSERT_SKIPPED',
           'Measurement insert skipped: source row resolved to multiple candidate measurements'
    FROM source_row_insert_conflicts src;

    DROP TEMPORARY TABLE core_insert_candidates;

    CREATE TEMPORARY TABLE core_insert_candidates AS
    SELECT rbr.*
    FROM resolved_batch_rows rbr
    LEFT JOIN core_insert_failures cif
        ON cif.SourceRowIndex = rbr.id
    WHERE cif.SourceRowIndex IS NULL;

    CREATE INDEX idx_core_insert_candidates_id ON core_insert_candidates (id);
    CREATE INDEX idx_core_insert_candidates_stem ON core_insert_candidates (StemGUID);

    INSERT IGNORE INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
                                  Description, UserDefinedFields, UploadFileID, UploadBatchID,
                                  RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY,
                                  RawCodes, RawComments, SourceRowIndex, IsActive)
    SELECT cic.CensusID, cic.StemGUID, NULL,
           cic.MeasurementDate,
           NULLIF(cic.DBH, 0),
           NULLIF(cic.HOM, 0),
           NULLIF(cic.Comments, ''),
           JSON_OBJECT(
               'treestemstate',
               cic.tree_state,
               'uploadSession', JSON_OBJECT(
                   'fileID', vFileID,
                   'batchID', vBatchID
               )
           ),
           vFileID,
           vBatchID,
           cic.TreeTag, cic.StemTag, cic.SpeciesCode, cic.QuadratName,
           cic.LocalX, cic.LocalY, cic.Codes, cic.Comments,
           cic.id,
           1
    FROM core_insert_candidates cic
    ORDER BY cic.id;

    SET vProcessedCount = ROW_COUNT();

    CREATE TEMPORARY TABLE resolved_coremeasurements AS
    SELECT cic.id,
           cic.TreeTag,
           cic.SpeciesID,
           cic.SpeciesCode,
           cic.Codes,
           cm.CoreMeasurementID
    FROM core_insert_candidates cic
    INNER JOIN coremeasurements cm
        ON cm.SourceRowIndex = cic.id
        AND cm.UploadFileID = vFileID
        AND cm.UploadBatchID = vBatchID
        AND cm.StemGUID IS NOT NULL;

    CREATE INDEX idx_resolved_coremeasurements_id ON resolved_coremeasurements (id);
    CREATE INDEX idx_resolved_coremeasurements_tree ON resolved_coremeasurements (TreeTag, SpeciesID);

    CREATE TEMPORARY TABLE orphaned_rows
    (
        id            BIGINT UNSIGNED NOT NULL PRIMARY KEY,
        FailureReason VARCHAR(255)    NOT NULL
    );

    INSERT INTO orphaned_rows (id, FailureReason)
    SELECT cic.id,
           'Measurement insert skipped: row passed resolution but no batch coremeasurement row was created'
    FROM core_insert_candidates cic
    LEFT JOIN resolved_coremeasurements rcm ON rcm.id = cic.id
    WHERE rcm.CoreMeasurementID IS NULL;

    CREATE INDEX idx_orphaned_rows_id ON orphaned_rows (id);

    INSERT IGNORE INTO hard_failure_rows (SourceRowIndex, ErrorCode, FailureReason)
    SELECT cif.SourceRowIndex, cif.ErrorCode, cif.FailureReason
    FROM core_insert_failures cif;

    INSERT IGNORE INTO hard_failure_rows (SourceRowIndex, ErrorCode, FailureReason)
    SELECT id, 'MEASUREMENT_INSERT_SKIPPED', LEFT(FailureReason, 255)
    FROM orphaned_rows;

    IF EXISTS(SELECT 1 FROM core_insert_failures) OR EXISTS(SELECT 1 FROM orphaned_rows) THEN
        SET @orphaned_filtered = (
            SELECT COUNT(*) FROM (
                SELECT SourceRowIndex FROM core_insert_failures
                UNION
                SELECT id FROM orphaned_rows
            ) unresolved_measurements
        );

        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity, failedRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
            'ORPHANED_MEASUREMENT',
            CONCAT(@orphaned_filtered, ' measurement(s) passed validation but no batch measurement row could be created'),
            'critical', @orphaned_filtered
        );
    END IF;

    INSERT IGNORE INTO coremeasurements
        (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
         Description, UploadFileID, UploadBatchID,
         RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY,
         RawCodes, RawComments, SourceRowIndex, IsActive)
    SELECT vCurrentCensusID, NULL, FALSE,
           NULLIF(tm.MeasurementDate, '1900-01-01'), NULLIF(tm.DBH, 0), NULLIF(tm.HOM, 0),
           grouped_failures.FailureReason,
           vFileID, vBatchID,
           NULLIF(tm.TreeTag, ''), NULLIF(tm.StemTag, ''), NULLIF(tm.SpeciesCode, ''), NULLIF(tm.QuadratName, ''),
           tm.LocalX, tm.LocalY, NULLIF(tm.Codes, ''), NULLIF(tm.Comments, ''),
           tm.id, 1
    FROM (
        SELECT SourceRowIndex,
               LEFT(GROUP_CONCAT(DISTINCT FailureReason ORDER BY ErrorCode SEPARATOR '; '), 255) AS FailureReason
        FROM hard_failure_rows
        GROUP BY SourceRowIndex
    ) grouped_failures
    INNER JOIN temporarymeasurements tm ON tm.id = grouped_failures.SourceRowIndex
    LEFT JOIN coremeasurements cm_existing
        ON cm_existing.UploadBatchID = vBatchID
        AND cm_existing.UploadFileID = vFileID
        AND cm_existing.SourceRowIndex = grouped_failures.SourceRowIndex
    WHERE tm.FileID = vFileID
      AND tm.BatchID = vBatchID
      AND (cm_existing.CoreMeasurementID IS NULL OR cm_existing.StemGUID IS NULL)
    ON DUPLICATE KEY UPDATE IsValidated = FALSE, Description = VALUES(Description);

    INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
    SELECT DISTINCT cm.CoreMeasurementID, me.ErrorID, FALSE
    FROM hard_failure_rows hfr
    INNER JOIN coremeasurements cm
        ON cm.UploadBatchID = vBatchID
        AND cm.UploadFileID = vFileID
        AND cm.SourceRowIndex = hfr.SourceRowIndex
        AND cm.StemGUID IS NULL
    INNER JOIN measurement_errors me
        ON me.ErrorSource = 'ingestion' AND me.ErrorCode = hfr.ErrorCode;

    SET vDataLossCount = COALESCE((SELECT COUNT(DISTINCT SourceRowIndex) FROM hard_failure_rows), 0);
    SET vCoreInsertMs = TIMESTAMPDIFF(MICROSECOND, vStageStart, NOW(6)) DIV 1000;

    -- =====================================================
    -- STAGE 9: ATTRIBUTE MATERIALIZATION
    -- =====================================================
    SET vStageStart = NOW(6);

    IF EXISTS(SELECT 1 FROM resolved_coremeasurements WHERE Codes IS NOT NULL AND TRIM(Codes) != '') THEN
        CREATE TEMPORARY TABLE tempcodes AS
        SELECT rcm.CoreMeasurementID, TRIM(jt.code) AS Code
        FROM resolved_coremeasurements rcm,
        json_table(
            IF(rcm.Codes = '' OR TRIM(rcm.Codes) = '', '[]',
               CONCAT('["', REPLACE(TRIM(rcm.Codes), ';', '","'), '"]')),
            '$[*]' columns (code varchar(10) COLLATE utf8mb4_0900_ai_ci path '$')
        ) jt
        WHERE rcm.Codes IS NOT NULL AND TRIM(rcm.Codes) != '';

        INSERT IGNORE INTO cmattributes (CoreMeasurementID, Code)
        SELECT tc.CoreMeasurementID, tc.Code
        FROM tempcodes tc;
    END IF;

    SET vAttributesMs = TIMESTAMPDIFF(MICROSECOND, vStageStart, NOW(6)) DIV 1000;

    -- =====================================================
    -- STAGE 10: SOFT VALIDATIONS
    -- =====================================================
    SET vStageStart = NOW(6);

    CREATE TEMPORARY TABLE species_mismatch_records AS
    SELECT DISTINCT rcm.CoreMeasurementID
    FROM resolved_coremeasurements rcm
    INNER JOIN prev_tree_lookup ptl ON ptl.TreeTag = rcm.TreeTag
        AND ptl.MatchCount = 1
        AND ptl.PrevSpeciesID != rcm.SpeciesID;

    INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
    SELECT DISTINCT smr.CoreMeasurementID, me.ErrorID, FALSE
    FROM species_mismatch_records smr
    JOIN measurement_errors me ON me.ErrorSource = 'validation' AND me.ErrorCode = '20';

    IF EXISTS(SELECT 1 FROM species_mismatch_records) THEN
        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity,
            sourceRecords, processedRecords, failedRecords, missingRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
            'SPECIES_MISMATCH',
            CONCAT((SELECT COUNT(*) FROM species_mismatch_records),
                   ' record(s) with species code different from previous census. ',
                   'Review for potential tree re-identification or data entry errors.'),
            'warning',
            vBatchRowCount, vProcessedCount, 0, 0
        );
    END IF;

    DROP TEMPORARY TABLE IF EXISTS species_mismatch_records;

    DROP TEMPORARY TABLE IF EXISTS idf_first_occurrence;
    CREATE TEMPORARY TABLE idf_first_occurrence AS
    SELECT TreeTag, SpeciesCode
    FROM (
        SELECT TreeTag, SpeciesCode,
               ROW_NUMBER() OVER (PARTITION BY TreeTag ORDER BY id) as rn
        FROM resolved_batch_rows
    ) ranked
    WHERE rn = 1;

    CREATE TEMPORARY TABLE same_batch_species_conflicts AS
    SELECT DISTINCT rcm.CoreMeasurementID
    FROM resolved_coremeasurements rcm
    INNER JOIN idf_first_occurrence fo ON rcm.TreeTag = fo.TreeTag
    WHERE rcm.SpeciesCode != fo.SpeciesCode;

    INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
    SELECT DISTINCT sbsc.CoreMeasurementID, me.ErrorID, FALSE
    FROM same_batch_species_conflicts sbsc
    JOIN measurement_errors me ON me.ErrorSource = 'validation' AND me.ErrorCode = '21';

    IF EXISTS(SELECT 1 FROM same_batch_species_conflicts) THEN
        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity,
            sourceRecords, processedRecords, failedRecords, missingRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
            'SAME_BATCH_SPECIES_CONFLICT',
            CONCAT((SELECT COUNT(*) FROM same_batch_species_conflicts),
                   ' record(s) with same TreeTag but different species codes within same batch. ',
                   'First occurrence was treated as correct.'),
            'warning',
            vBatchRowCount, vProcessedCount, 0, 0
        );
    END IF;

    DROP TEMPORARY TABLE IF EXISTS same_batch_species_conflicts, idf_first_occurrence;
    SET vSoftValidationMs = TIMESTAMPDIFF(MICROSECOND, vStageStart, NOW(6)) DIV 1000;

    -- Info-level census warnings are intentionally excluded from the hot ingest path.
    -- They can be recomputed later from persisted coremeasurements if needed.

    DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, duplicate_failures, tag_stemtag_collision_groups, tag_stemtag_collision_failures,
        quadrat_resolution, species_resolution,
        filter_validity, filtered,
        classified_filtered, validation_failures, invalid_code_rows, hard_failure_rows, requested_prev_trees,
        requested_prev_stems, prev_tree_lookup, prev_stem_lookup,
        prev_match_ambiguities, tree_insert_candidates, tree_insert_failures,
        current_tree_lookup, stem_resolution_rows, stem_insert_candidates,
        unresolved_stem_rows, current_stem_lookup, resolved_batch_rows,
        core_insert_candidates, core_insert_failures, resolved_coremeasurements,
        orphaned_rows, tempcodes, idf_first_occurrence, same_batch_species_conflicts,
        species_mismatch_records, quadrat_mismatch_failures, coordinate_drift_failures;

    DELETE FROM temporarymeasurements WHERE FileID = vFileID AND BatchID = vBatchID;

    -- =====================================================
    -- FINAL RECONCILIATION CHECK
    -- Verify: input_rows = success + failed + deduplicated
    -- =====================================================
    SET @final_success = (
        SELECT COUNT(*) FROM coremeasurements cm
        WHERE cm.CensusID = vCurrentCensusID
          AND cm.StemGUID IS NOT NULL
          AND cm.UploadFileID = vFileID
          AND cm.UploadBatchID = vBatchID
    );
    SET @unaccounted = vBatchRowCount - @final_success - vDataLossCount;

    IF @unaccounted != 0 THEN
        SET vErrorMessage = CONCAT('Reconciliation mismatch: ', vBatchRowCount, ' input, ',
                                   @final_success, ' success, ', vDataLossCount,
                                   ' failed, ', @unaccounted, ' unaccounted');

        -- Log the mismatch as an integrity alert but COMMIT the successfully processed data.
        -- Rolling back would destroy all valid trees/stems/measurements for the entire batch
        -- due to a potentially benign counting discrepancy.
        COMMIT;

        INSERT IGNORE INTO uploadintegrityalerts (
            uploadId, fileID, batchID, plotID, censusID,
            type, message, severity, sourceRecords, processedRecords, failedRecords, missingRecords
        ) VALUES (
            vUploadId, vFileID, vBatchID, vCurrentPlotID, vCurrentCensusID,
            'RECONCILIATION_MISMATCH',
            LEFT(vErrorMessage, 255),
            IF(@unaccounted > 0, 'critical', 'warning'),
            vBatchRowCount, @final_success, vDataLossCount, ABS(@unaccounted)
        );

        UPDATE uploadmetrics
        SET processedRecords = @final_success,
            failedRecords = vDataLossCount,
            missingRecords = ABS(@unaccounted),
            dataLossDetected = 1,
            durationMs = TIMESTAMPDIFF(MICROSECOND, vProcStart, NOW(6)) DIV 1000,
            status = 'completed',
            errorMessage = LEFT(vErrorMessage, 255),
            endTime = NOW(6)
        WHERE uploadId = vUploadId;

        DROP TEMPORARY TABLE IF EXISTS initial_dup_filter, duplicate_failures, tag_stemtag_collision_groups, tag_stemtag_collision_failures,
            quadrat_resolution, species_resolution,
            filter_validity, filtered,
            classified_filtered, validation_failures, invalid_code_rows, hard_failure_rows, requested_prev_trees,
            requested_prev_stems, prev_tree_lookup, prev_stem_lookup,
            prev_match_ambiguities, tree_insert_candidates, tree_insert_failures,
            current_tree_lookup, stem_resolution_rows, stem_insert_candidates,
            unresolved_stem_rows, current_stem_lookup, resolved_batch_rows,
            core_insert_candidates, source_row_insert_conflicts, core_insert_failures, resolved_coremeasurements,
            orphaned_rows, tempcodes, idf_first_occurrence, same_batch_species_conflicts,
            species_mismatch_records, quadrat_mismatch_failures, coordinate_drift_failures;

        SET @disable_triggers = 0;

        SELECT vErrorMessage as message,
               FALSE as batch_failed,
               ABS(@unaccounted) as records_failed,
               vValidationMs AS validation_ms, vDedupeMs AS dedupe_ms, vReferenceMs AS reference_ms,
               vPrevLookupMs AS prev_lookup_ms, vCrossCensusMs AS cross_census_ms,
               vTreeStemInsertMs AS tree_stem_insert_ms, vStemCrossIdMs AS stem_crossid_ms,
               vCoreInsertMs AS core_insert_ms, vAttributesMs AS attributes_ms,
               vSoftValidationMs AS soft_validation_ms,
               TIMESTAMPDIFF(MICROSECOND, vProcStart, NOW(6)) DIV 1000 AS total_duration_ms;
        LEAVE main_proc;
    END IF;

    -- Final metrics update
    UPDATE uploadmetrics
    SET processedRecords = vProcessedCount,
        failedRecords = vDataLossCount,
        missingRecords = 0,
        dataLossDetected = IF(vDataLossCount > 0, 1, 0),
        durationMs = TIMESTAMPDIFF(MICROSECOND, vProcStart, NOW(6)) DIV 1000,
        status = 'completed',
        endTime = NOW(6)
    WHERE uploadId = vUploadId;

    COMMIT;

    SET @disable_triggers = 0;

    IF vDataLossCount > 0 THEN
        SELECT CONCAT('Batch ', vBatchID, ' processed: ', vProcessedCount, ' valid, ',
                      vDataLossCount, ' failed (see measurement_error_log and uploadintegrityalerts)') as message,
               FALSE as batch_failed, vDataLossCount as records_failed,
               vValidationMs AS validation_ms, vDedupeMs AS dedupe_ms, vReferenceMs AS reference_ms,
               vPrevLookupMs AS prev_lookup_ms, vCrossCensusMs AS cross_census_ms,
               vTreeStemInsertMs AS tree_stem_insert_ms, vStemCrossIdMs AS stem_crossid_ms,
               vCoreInsertMs AS core_insert_ms, vAttributesMs AS attributes_ms,
               vSoftValidationMs AS soft_validation_ms,
               TIMESTAMPDIFF(MICROSECOND, vProcStart, NOW(6)) DIV 1000 AS total_duration_ms;
    ELSE
        SELECT CONCAT('Batch ', vBatchID, ' processed successfully: ', vProcessedCount, ' records') as message,
               FALSE as batch_failed, 0 as records_failed,
               vValidationMs AS validation_ms, vDedupeMs AS dedupe_ms, vReferenceMs AS reference_ms,
               vPrevLookupMs AS prev_lookup_ms, vCrossCensusMs AS cross_census_ms,
               vTreeStemInsertMs AS tree_stem_insert_ms, vStemCrossIdMs AS stem_crossid_ms,
               vCoreInsertMs AS core_insert_ms, vAttributesMs AS attributes_ms,
               vSoftValidationMs AS soft_validation_ms,
               TIMESTAMPDIFF(MICROSECOND, vProcStart, NOW(6)) DIV 1000 AS total_duration_ms;
    END IF;
END $$

DELIMITER ;

-- uploaddatalossreport view is defined in tablestructures.sql (canonical location for views)
