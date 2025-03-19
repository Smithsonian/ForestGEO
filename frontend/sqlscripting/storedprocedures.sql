drop procedure if exists bulkingestionprocess;
drop procedure if exists clearcensus;
drop procedure if exists RefreshMeasurementsSummary;
drop procedure if exists RefreshViewFullTable;
drop procedure if exists reingestfailedrows;

create
    definer = azureroot@`%` procedure RefreshMeasurementsSummary()
BEGIN
    SET foreign_key_checks = 0;
    TRUNCATE measurementssummary;
    INSERT INTO measurementssummary (CoreMeasurementID,
                                     StemID,
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
    SELECT COALESCE(cm.CoreMeasurementID, 0)                    AS CoreMeasurementID,
           COALESCE(st.StemID, 0)                               AS StemID,
           COALESCE(t.TreeID, 0)                                AS TreeID,
           COALESCE(s.SpeciesID, 0)                             AS SpeciesID,
           COALESCE(q.QuadratID, 0)                             AS QuadratID,
           COALESCE(q.PlotID, 0)                                AS PlotID,
           COALESCE(cm.CensusID, 0)                             AS CensusID,
           s.SpeciesName                                        AS SpeciesName,
           s.SubspeciesName                                     AS SubspeciesName,
           s.SpeciesCode                                        AS SpeciesCode,
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
           (SELECT GROUP_CONCAT(DISTINCT ca.Code SEPARATOR '; ')
            FROM cmattributes ca
            WHERE ca.CoreMeasurementID = cm.CoreMeasurementID)  AS Attributes,
           cm.UserDefinedFields                                 AS UserDefinedFields,
           (SELECT GROUP_CONCAT(CONCAT(vp.ProcedureName, '->', vp.Description) SEPARATOR ';')
            FROM catalog.validationprocedures vp
                     JOIN cmverrors cmv ON cmv.ValidationErrorID = vp.ValidationID
            WHERE cmv.CoreMeasurementID = cm.CoreMeasurementID) AS Errors
    FROM coremeasurements cm
             LEFT JOIN stems st ON cm.StemID = st.StemID
             LEFT JOIN trees t ON st.TreeID = t.TreeID
             LEFT JOIN species s ON t.SpeciesID = s.SpeciesID
             LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
             LEFT JOIN census c ON cm.CensusID = c.CensusID
             LEFT JOIN plots p ON p.PlotID = c.PlotID
    ON DUPLICATE KEY UPDATE SpeciesName       = VALUES(SpeciesName),
                            SubspeciesName    = VALUES(SubspeciesName),
                            SpeciesCode       = VALUES(SpeciesCode),
                            TreeTag           = VALUES(TreeTag),
                            StemTag           = VALUES(StemTag),
                            StemLocalX        = VALUES(StemLocalX),
                            StemLocalY        = VALUES(StemLocalY),
                            QuadratName       = VALUES(QuadratName),
                            MeasurementDate   = VALUES(MeasurementDate),
                            MeasuredDBH       = VALUES(MeasuredDBH),
                            MeasuredHOM       = VALUES(MeasuredHOM),
                            IsValidated       = VALUES(IsValidated),
                            Description       = VALUES(Description),
                            Attributes        = VALUES(Attributes),
                            UserDefinedFields = VALUES(UserDefinedFields),
                            Errors            = VALUES(Errors);

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
    INSERT INTO viewfulltable (CoreMeasurementID,
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
                               StemID,
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
           s.StemID                                            AS StemID,
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
             LEFT JOIN stems s ON cm.StemID = s.StemID
             LEFT JOIN trees t ON s.TreeID = t.TreeID
             LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
             LEFT JOIN genus g ON sp.GenusID = g.GenusID
             LEFT JOIN family f ON g.FamilyID = f.FamilyID
             LEFT JOIN quadrats q ON s.QuadratID = q.QuadratID
             LEFT JOIN plots p ON q.PlotID = p.PlotID
             LEFT JOIN census c ON cm.CensusID = c.CensusID
             LEFT JOIN cmattributes ca ON ca.CoreMeasurementID = cm.CoreMeasurementID
             LEFT JOIN attributes a ON a.Code = ca.Code
    ON DUPLICATE KEY UPDATE MeasurementDate            = VALUES(MeasurementDate),
                            MeasuredDBH                = VALUES(MeasuredDBH),
                            MeasuredHOM                = VALUES(MeasuredHOM),
                            Description                = VALUES(Description),
                            IsValidated                = VALUES(IsValidated),
                            PlotID                     = VALUES(PlotID),
                            PlotName                   = VALUES(PlotName),
                            LocationName               = VALUES(LocationName),
                            CountryName                = VALUES(CountryName),
                            DimensionX                 = VALUES(DimensionX),
                            DimensionY                 = VALUES(DimensionY),
                            PlotArea                   = VALUES(PlotArea),
                            PlotGlobalX                = VALUES(PlotGlobalX),
                            PlotGlobalY                = VALUES(PlotGlobalY),
                            PlotGlobalZ                = VALUES(PlotGlobalZ),
                            PlotShape                  = VALUES(PlotShape),
                            PlotDescription            = VALUES(PlotDescription),
                            PlotDefaultDimensionUnits  = VALUES(PlotDefaultDimensionUnits),
                            PlotDefaultCoordinateUnits = VALUES(PlotDefaultCoordinateUnits),
                            PlotDefaultAreaUnits       = VALUES(PlotDefaultAreaUnits),
                            PlotDefaultDBHUnits        = VALUES(PlotDefaultDBHUnits),
                            PlotDefaultHOMUnits        = VALUES(PlotDefaultHOMUnits),
                            CensusID                   = VALUES(CensusID),
                            CensusStartDate            = VALUES(CensusStartDate),
                            CensusEndDate              = VALUES(CensusEndDate),
                            CensusDescription          = VALUES(CensusDescription),
                            PlotCensusNumber           = VALUES(PlotCensusNumber),
                            QuadratID                  = VALUES(QuadratID),
                            QuadratName                = VALUES(QuadratName),
                            QuadratDimensionX          = VALUES(QuadratDimensionX),
                            QuadratDimensionY          = VALUES(QuadratDimensionY),
                            QuadratArea                = VALUES(QuadratArea),
                            QuadratStartX              = VALUES(QuadratStartX),
                            QuadratStartY              = VALUES(QuadratStartY),
                            QuadratShape               = VALUES(QuadratShape),
                            TreeID                     = VALUES(TreeID),
                            TreeTag                    = VALUES(TreeTag),
                            StemID                     = VALUES(StemID),
                            StemTag                    = VALUES(StemTag),
                            StemLocalX                 = VALUES(StemLocalX),
                            StemLocalY                 = VALUES(StemLocalY),
                            SpeciesID                  = VALUES(SpeciesID),
                            SpeciesCode                = VALUES(SpeciesCode),
                            SpeciesName                = VALUES(SpeciesName),
                            SubspeciesName             = VALUES(SubspeciesName),
                            SubspeciesAuthority        = VALUES(SubspeciesAuthority),
                            SpeciesIDLevel             = VALUES(SpeciesIDLevel),
                            GenusID                    = VALUES(GenusID),
                            Genus                      = VALUES(Genus),
                            GenusAuthority             = VALUES(GenusAuthority),
                            FamilyID                   = VALUES(FamilyID),
                            Family                     = VALUES(Family),
                            Attributes                 = VALUES(Attributes),
                            UserDefinedFields          = VALUES(UserDefinedFields);

    -- Re-enable foreign key checks
    SET foreign_key_checks = 1;
END;

create
    definer = azureroot@`%` procedure bulkingestionprocess(IN vFileID varchar(36), IN vBatchID varchar(36))
begin
    drop temporary table if exists tempcodes;
    drop temporary table if exists treestates;
    drop temporary table if exists stemstates;
    drop temporary table if exists filtered;
    DROP TEMPORARY TABLE IF EXISTS preexisting_trees;
    DROP TEMPORARY TABLE IF EXISTS preexisting_stems;
    set @disable_triggers = 1;
    create temporary table filtered as
    SELECT i.*
    FROM temporarymeasurements i
             LEFT JOIN quadrats q ON i.QuadratName = q.QuadratName
             left join censusquadrat cq on cq.QuadratID = q.QuadratID
             left join census c on cq.CensusID = c.CensusID
             LEFT JOIN species s ON i.SpeciesCode = s.SpeciesCode
    WHERE i.BatchID = vBatchID
      AND i.FileID = vFileID
      and c.CensusID = i.CensusID
      and q.PlotID = i.PlotID
      AND (q.QuadratID IS NOT NULL OR s.SpeciesID IS NOT NULL)
      and i.MeasurementDate IS NOT NULL;

    INSERT INTO failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes)
    SELECT tm.PlotID,
           tm.CensusID,
           tm.TreeTag,
           tm.StemTag,
           tm.SpeciesCode,
           tm.QuadratName,
           tm.LocalX,
           tm.LocalY,
           tm.DBH,
           tm.HOM,
           tm.MeasurementDate,
           tm.Codes
    FROM temporarymeasurements tm
    WHERE tm.BatchID = vBatchID
      AND tm.FileID = vFileID
      AND NOT EXISTS (SELECT 1
                      FROM filtered f
                      WHERE f.id = tm.id)
    ON DUPLICATE KEY UPDATE PlotID = values(PlotID),
                            CensusID = values(CensusID),
                            Tag = values(Tag),
                            StemTag = values(StemTag),
                            SpCode = values(SpCode),
                            Quadrat = values(Quadrat),
                            X = values(X),
                            Y = values(Y),
                            DBH = values(DBH),
                            HOM = values(HOM),
                            Date = values(Date),
                            Codes = values(Codes);

    -- Capture a snapshot of trees before inserting new rows
    CREATE TEMPORARY TABLE preexisting_trees AS
    SELECT * FROM trees;

-- Insert into trees as before
    INSERT INTO trees (TreeTag, SpeciesID)
    SELECT f.TreeTag, s.SpeciesID
    FROM filtered f
             JOIN species s ON s.SpeciesCode = f.SpeciesCode
    ON DUPLICATE KEY UPDATE TreeTag   = VALUES(TreeTag),
                            SpeciesID = VALUES(SpeciesID);

-- Create temporary table for tree states using the pre-insert snapshot
    CREATE TEMPORARY TABLE treestates AS
    SELECT DISTINCT f.TreeTag,
                    IF(pt.TreeID IS NULL, 'insert', 'update') AS TreeState
    FROM filtered f
             JOIN species s ON s.SpeciesCode = f.SpeciesCode
             LEFT JOIN preexisting_trees pt ON pt.TreeTag = f.TreeTag;


-- Similarly, capture a snapshot of stems before inserting new rows
    CREATE TEMPORARY TABLE preexisting_stems AS
    SELECT * FROM stems;

-- Insert into stems as before
    INSERT INTO stems (TreeID, QuadratID, StemTag, LocalX, LocalY)
    SELECT t.TreeID, q.QuadratID, f.StemTag, f.LocalX, f.LocalY
    FROM filtered f
             JOIN trees t ON t.TreeTag = f.TreeTag
             JOIN quadrats q ON q.QuadratName = f.QuadratName
    ON DUPLICATE KEY UPDATE QuadratID = VALUES(QuadratID),
                            StemTag   = VALUES(StemTag),
                            LocalX    = VALUES(LocalX),
                            LocalY    = VALUES(LocalY);

-- Create temporary table for stem states using the pre-insert snapshot
    CREATE TEMPORARY TABLE stemstates AS
    SELECT DISTINCT f.StemTag,
                    IF(ps.StemID IS NULL, 'insert', 'update') AS StemState
    FROM filtered f
             JOIN quadrats q ON q.QuadratName = f.QuadratName
             LEFT JOIN preexisting_stems ps ON ps.StemTag = f.StemTag;


    insert into coremeasurements (CensusID, StemID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
                                  UserDefinedFields)
    select f.CensusID,
           s.StemID,
           null,
           f.MeasurementDate,
           f.DBH,
           f.HOM,
           json_object('treestemstate', case
                                            when ss.StemState = 'insert' and ts.TreeState = 'insert'
                                                then 'new recruit'
                                            when ss.StemState = 'insert' and ts.TreeState = 'update'
                                                then 'multistem'
                                            when ss.StemState = 'update' and ts.TreeState = 'update'
                                                then 'old tree' end)
    from filtered f
             join stems s on s.StemTag = f.StemTag
             join trees t on t.TreeID = s.TreeID and t.TreeTag = f.TreeTag
             join treestates ts on ts.TreeTag = f.TreeTag
             join stemstates ss on ss.StemTag = s.StemTag
    ON DUPLICATE KEY UPDATE StemID = values(StemID),
                            MeasuredDBH       = values(MeasuredDBH),
                            MeasuredHOM       = values(MeasuredHOM),
                            MeasurementDate   = VALUES(MeasurementDate),
                            UserDefinedFields = VALUES(UserDefinedFields);

    CREATE TEMPORARY TABLE tempcodes AS
    SELECT cm.CoreMeasurementID,
           TRIM(jt.code) AS Code
    FROM filtered f
             JOIN trees t ON t.TreeTag = f.TreeTag
             JOIN stems s ON s.StemTag = f.StemTag AND s.TreeID = t.TreeID
             join quadrats q on q.QuadratName = f.QuadratName
             join coremeasurements cm
                  on cm.StemID = s.StemID and cm.CensusID = f.CensusID and
                     (cm.MeasuredDBH = f.DBH or cm.MeasuredDBH is null) and
                     (cm.MeasuredHOM = f.HOM or cm.MeasuredHOM is null) and
                     (cm.MeasurementDate = f.MeasurementDate or cm.MeasurementDate is null),
         JSON_TABLE(
                 IF(f.Codes IS NULL OR TRIM(f.Codes) = '', '[]',
                    CONCAT('["', REPLACE(TRIM(f.Codes), ';', '","'), '"]')),
                 '$[*]' COLUMNS ( code VARCHAR(10) PATH '$')
         ) jt;

    insert into cmattributes (CoreMeasurementID, Code)
    select tc.CoreMeasurementID, tc.Code
    from tempcodes tc
    on duplicate key update CoreMeasurementID = values(CoreMeasurementID),
                            Code              = values(Code);

    drop temporary table if exists tempcodes;
    drop temporary table if exists treestates;
    drop temporary table if exists stemstates;
    drop temporary table if exists filtered;
    set @disable_triggers = 0;
end;

create
    definer = azureroot@`%` procedure clearcensus(IN targetCensusID int)
BEGIN
    SET @disable_triggers = 1;

    START TRANSACTION;

    DELETE FROM temporarymeasurements WHERE CensusID = targetCensusID;

    DELETE cma FROM cmattributes cma
    JOIN coremeasurements cm ON cma.CoreMeasurementID = cm.CoreMeasurementID
    WHERE cm.CensusID = targetCensusID;

    DELETE cme FROM cmverrors cme
    JOIN coremeasurements cm ON cme.CoreMeasurementID = cm.CoreMeasurementID
    WHERE cm.CensusID = targetCensusID;

    DELETE FROM measurementssummary WHERE CensusID = targetCensusID;
    DELETE FROM coremeasurements WHERE CensusID = targetCensusID;

    DELETE FROM quadratpersonnel WHERE CensusID = targetCensusID;

    DELETE FROM personnel WHERE CensusID = targetCensusID;

    DELETE FROM censusquadrat WHERE CensusID = targetCensusID;

    DELETE FROM specieslimits WHERE CensusID = targetCensusID;

    DELETE FROM census WHERE CensusID = targetCensusID;

    ALTER TABLE temporarymeasurements AUTO_INCREMENT = 1;
    ALTER TABLE cmattributes AUTO_INCREMENT = 1;
    ALTER TABLE cmverrors AUTO_INCREMENT = 1;
    ALTER TABLE coremeasurements AUTO_INCREMENT = 1;
    ALTER TABLE quadratpersonnel AUTO_INCREMENT = 1;
    ALTER TABLE personnel AUTO_INCREMENT = 1;
    ALTER TABLE censusquadrat AUTO_INCREMENT = 1;
    ALTER TABLE specieslimits AUTO_INCREMENT = 1;
    ALTER TABLE census AUTO_INCREMENT = 1;

    COMMIT;

    SET @disable_triggers = 0;
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

