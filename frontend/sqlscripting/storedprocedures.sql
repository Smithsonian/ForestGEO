drop procedure if exists RefreshMeasurementsSummary;
drop procedure if exists RefreshViewFullTable;
drop procedure if exists reviewfailed;
drop procedure if exists reingestfailedrows;
drop procedure if exists clearcensus;
drop procedure if exists bulkingestionprocess;

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
             JOIN stems st ON cm.StemID = st.StemID
             JOIN trees t ON st.TreeID = t.TreeID
             JOIN species s ON t.SpeciesID = s.SpeciesID
             JOIN quadrats q ON st.QuadratID = q.QuadratID
             JOIN census c ON cm.CensusID = c.CensusID
             JOIN plots p ON p.PlotID = c.PlotID
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
    SET @CURRENT_CENSUS_ID = (SELECT CensusID
                              FROM temporarymeasurements
                              WHERE FileID = vFileID
                                AND BatchID = vBatchID
                              LIMIT 1);
    drop temporary table if exists initial_dup_filter, treestemstates, trees_snapshot, tempcodes, treestates,
        stemstates, filtered, filter_validity, filter_validity_dup,
        preexisting_trees, preexisting_stems, preinsert_core, duplicate_ids;

    drop temporary table if exists old_trees, multi_stems, new_recruits;

    create temporary table initial_dup_filter as
    select distinct id,
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
                    Codes
    from temporarymeasurements
    where FileID = vFileID
      and BatchID = vBatchID;

    -- 1) Are you ever losing rows because TreeTag or Date is null?
    SELECT COUNT(*) AS missing_tag_or_date
    FROM initial_dup_filter
    WHERE TreeTag IS NULL
       OR MeasurementDate IS NULL;

    -- 2) How many initial rows have a matching quadrats row?
    SELECT SUM(qv.QuadratsVersioningID IS NOT NULL) AS matched_quadrat,
           SUM(qv.QuadratsVersioningID IS NULL)     AS no_quadrat
    FROM initial_dup_filter AS i
             LEFT JOIN quadrats AS qm
                       ON qm.QuadratName = i.QuadratName
                           AND qm.IsActive = TRUE
             LEFT JOIN censusquadrats AS cq
                       ON cq.QuadratID = qm.QuadratID
                           AND cq.CensusID = i.CensusID
             LEFT JOIN quadratsversioning AS qv
                       ON qv.QuadratsVersioningID = cq.QuadratsVersioningID;

    -- 3) Of those matched_quadrat rows, how many have q.PlotID = i.PlotID?
    SELECT SUM(qv.PlotID = i.PlotID)  AS plot_match,
           SUM(qv.PlotID <> i.PlotID) AS plot_mismatch
    FROM initial_dup_filter i
             LEFT JOIN quadrats qm ON qm.QuadratName = i.QuadratName AND qm.IsActive = TRUE
             LEFT JOIN censusquadrats cq ON cq.QuadratID = qm.QuadratID AND cq.CensusID = i.CensusID
             LEFT JOIN quadratsversioning qv
                       ON qv.QuadratsVersioningID = cq.QuadratsVersioningID;

    -- 4) How many rows have a matching species?
    SELECT SUM(sv.SpeciesVersioningID IS NOT NULL) AS matched_species,
           SUM(sv.SpeciesVersioningID IS NULL)     AS no_species
    FROM initial_dup_filter AS i
             LEFT JOIN species AS sm
                       ON sm.SpeciesCode = i.SpeciesCode
                           AND sm.IsActive = TRUE
             LEFT JOIN censusspecies AS cs
                       ON cs.SpeciesID = sm.SpeciesID
                           AND cs.CensusID = i.CensusID
             LEFT JOIN speciesversioning AS sv
                       ON sv.SpeciesVersioningID = cs.SpeciesVersioningID;

    -- 5) And finally the census join:
    SELECT SUM(cq.CensusID = i.CensusID) AS census_match,
           SUM(cq.CensusID IS NULL)      AS no_census
    FROM initial_dup_filter i
             LEFT JOIN quadrats qm ON qm.QuadratName = i.QuadratName AND qm.IsActive = TRUE
             LEFT JOIN censusquadrats cq ON cq.QuadratID = qm.QuadratID AND cq.CensusID = i.CensusID;


    create temporary table filter_validity as
    select distinct i.id,
                    i.FileID,
                    i.BatchID,
                    i.PlotID,
                    i.CensusID,
                    i.TreeTag                                                  as TreeTag,
                    ifnull(i.StemTag, '')                                      as StemTag,
                    i.SpeciesCode                                              as SpeciesCode,
                    i.QuadratName                                              as QuadratName,
                    ifnull(i.LocalX, 0)                                        as LocalX,
                    ifnull(i.LocalY, 0)                                        as LocalY,
                    ifnull(i.DBH, 0)                                           as DBH,
                    ifnull(i.HOM, 0)                                           as HOM,
                    i.MeasurementDate                                          as MeasurementDate,
                    i.Codes                                                    as Codes,
                    if((((i.DBH = 0) or (i.HOM = 0)) and
                        (i.Codes is null or trim(i.Codes) = '')), false, true) as Valid,
                    ifnull(
                            (select sum(if(av.Code is null, 1, 0))
                             from json_table(
                                          if(i.Codes is null or trim(i.Codes) = '', '[]',
                                             concat('["', replace(trim(i.Codes), ';', '","'), '"]')
                                          ),
                                          '$[*]' columns ( code varchar(10) path '$')
                                  ) jt
                                      LEFT JOIN censusattributes cav
                                                ON cav.Code = jt.code
                                                    AND cav.CensusID = i.CensusID
                                      LEFT JOIN attributesversioning av
                                                ON av.AttributesVersioningID = cav.AttributesVersioningID),
                            0
                    )                                                          as invalid_count
    from initial_dup_filter i
             JOIN quadrats qm
                  ON qm.QuadratName = i.QuadratName AND qm.IsActive = TRUE
             JOIN censusquadrats cq
                  ON cq.QuadratID = qm.QuadratID AND cq.CensusID = i.CensusID
             JOIN quadratsversioning qv
                  ON qv.QuadratID = cq.QuadratID
             JOIN species s2
                  ON s2.SpeciesCode = i.SpeciesCode AND s2.IsActive = TRUE
             JOIN censusspecies cs
                  ON cs.SpeciesID = s2.SpeciesID AND cs.CensusID = i.CensusID
             JOIN speciesversioning sv
                  ON sv.SpeciesVersioningID = cs.SpeciesVersioningID
             JOIN census c
                  ON c.CensusID = i.CensusID AND c.IsActive = TRUE
    WHERE i.TreeTag IS NOT NULL
      AND qv.PlotID = i.PlotID
      AND i.MeasurementDate IS NOT NULL
      and i.MeasurementDate is not null;

    select count(*) as 'filter_validity' from filter_validity;

    create temporary table filter_validity_dup as
    select * from filter_validity;

    create temporary table if not exists filtered as
    select distinct fv.*
    from filter_validity fv
    where invalid_count = 0
      and not exists (select 1
                      from coremeasurements cm
                               join stems s on cm.StemID = s.StemID
                               join trees t on s.TreeID = t.TreeID
                      where cm.CensusID = fv.CensusID
                        and t.TreeTag = fv.TreeTag
                        and s.StemTag = fv.StemTag
                        and cm.MeasuredDBH = fv.DBH
                        and cm.MeasuredHOM = fv.HOM
                        and cm.MeasurementDate = fv.MeasurementDate);

    select count(*) as 'filtered' from filtered;

    insert ignore into failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes)
    select distinct PlotID,
                    CensusID,
                    nullif(TreeTag, '')                   as Tag,
                    nullif(StemTag, '')                   as StemTag,
                    nullif(SpeciesCode, '')               as SpCode,
                    nullif(QuadratName, '')               as Quadrat,
                    nullif(LocalX, 0)                     as X,
                    nullif(LocalY, 0)                     as Y,
                    nullif(DBH, 0)                        as DBH,
                    nullif(HOM, 0)                        as HOM,
                    nullif(MeasurementDate, '1900-01-01') as MeasurementDate,
                    nullif(Codes, '')                     as Codes
    from (
             -- Condition 1: Rows that appear in filter_validity with invalid codes.
             select fv.PlotID,
                    fv.CensusID,
                    fv.TreeTag,
                    fv.StemTag,
                    fv.SpeciesCode,
                    fv.QuadratName,
                    fv.LocalX,
                    fv.LocalY,
                    fv.DBH,
                    fv.HOM,
                    fv.MeasurementDate,
                    fv.Codes
             from (select * from filter_validity) fv
             where fv.invalid_count > 0

             union

             -- Condition 2: Rows from temporarymeasurements that are missing from filter_validity (e.g., due to failed joins)
             select tm.PlotID,
                    tm.CensusID,
                    coalesce(tm.TreeTag, ''),
                    coalesce(tm.StemTag, ''),
                    coalesce(tm.SpeciesCode, ''),
                    coalesce(tm.QuadratName, ''),
                    coalesce(tm.LocalX, -1),
                    coalesce(tm.LocalY, -1),
                    coalesce(tm.DBH, -1),
                    coalesce(tm.HOM, -1),
                    coalesce(tm.MeasurementDate, '1900-01-01'),
                    coalesce(tm.Codes, '')
             from temporarymeasurements tm
             where tm.BatchID = vBatchID
               and tm.FileID = vFileID
               and not exists (select 1
                               from filter_validity_dup f
                               where f.id = tm.id)) as combined;

    create temporary table old_trees as
    select f.*
    from filtered f
             join trees t on t.TreeTag = f.TreeTag
             join stems s on s.TreeID = t.TreeID and s.StemTag = f.StemTag;

    create temporary table multi_stems as
    select f.*
    from filtered f
             join trees t on t.TreeTag = f.TreeTag
    where f.id not in (select id from old_trees)
      and not exists (select 1 from stems s where s.TreeID = t.TreeID and s.StemTag = f.StemTag);

    create temporary table new_recruits as
    select f.*
    from filtered f
             left join trees t on t.TreeTag = f.TreeTag
    where t.TreeTag is null
      and f.id not in (select id from old_trees)
      and f.id not in (select id from multi_stems);

    -- re-inserting old trees and old stems
    insert into trees (TreeTag, SpeciesID)
    select distinct binary ot.TreeTag, sp.SpeciesID
    from old_trees ot
             join species sp on ot.SpeciesCode = sp.SpeciesCode
             left join multi_stems ms on ot.id = ms.id
             left join new_recruits nr on ot.id = nr.id
    where ms.id is null
      and nr.id is null
    on duplicate key update TreeTag   = values(TreeTag),
                            SpeciesID = values(SpeciesID);

    insert into stems (TreeID, QuadratID, StemTag, LocalX, LocalY)
    select distinct t.TreeID, q.QuadratID, ot.StemTag, ot.LocalX, ot.LocalY
    from old_trees ot
             join trees t on ot.TreeTag = t.TreeTag
             join quadrats q on q.QuadratName = ot.QuadratName and q.PlotID = ot.PlotID
             left join multi_stems ms on ot.id = ms.id
             left join new_recruits nr on ot.id = nr.id
    where ms.id is null
      and nr.id is null
    on duplicate key update QuadratID = values(stems.QuadratID),
                            StemTag   = values(StemTag),
                            LocalX    = values(LocalX),
                            LocalY    = values(LocalY);

    -- handle multi stems
    insert into trees (TreeTag, SpeciesID)
    select distinct binary ms.TreeTag, sp.SpeciesID
    from multi_stems ms
             join species sp on ms.SpeciesCode = sp.SpeciesCode
             left join old_trees ot on ms.id = ot.id
             left join new_recruits nr on ms.id = nr.id
    where ot.id is null
      and nr.id is null
    on duplicate key update TreeTag   = values(TreeTag),
                            SpeciesID = values(SpeciesID);

    insert into stems (TreeID, QuadratID, StemTag, LocalX, LocalY)
    select distinct t.TreeID, q.QuadratID, ms.StemTag, ms.LocalX, ms.LocalY
    from multi_stems ms
             join trees t on t.TreeTag = ms.TreeTag
             join quadrats q on q.QuadratName = ms.QuadratName and q.PlotID = ms.PlotID
             left join old_trees ot on ms.id = ot.id
             left join new_recruits nr on ms.id = nr.id
    where ot.id is null
      and nr.id is null
    on duplicate key update QuadratID = values(stems.QuadratID),
                            StemTag   = values(StemTag),
                            LocalX    = values(LocalX),
                            LocalY    = values(LocalY);

    -- handle new recruits
    insert into trees (TreeTag, SpeciesID)
    select distinct binary nt.TreeTag, sp.SpeciesID
    from new_recruits nt
             join species sp on sp.SpeciesCode = nt.SpeciesCode
             left join old_trees ot on ot.id = nt.id
             left join multi_stems ms on ms.id = nt.id
    where ot.id is null
      and ms.id is null
    on duplicate key update TreeTag   = values(TreeTag),
                            SpeciesID = values(SpeciesID);

    insert into stems (TreeID, QuadratID, StemTag, LocalX, LocalY)
    select distinct t.TreeID, q.QuadratID, nt.StemTag, nt.LocalX, nt.LocalY
    from new_recruits nt
             join trees t on t.TreeTag = nt.TreeTag
             join quadrats q on q.QuadratName = nt.QuadratName and q.PlotID = nt.PlotID
             left join multi_stems ms on ms.id = nt.id
             left join old_trees ot on ot.id = nt.id
    where ms.id is null
      and ot.id is null
    on duplicate key update QuadratID = values(QuadratID),
                            StemTag   = values(StemTag),
                            LocalX    = values(LocalX),
                            LocalY    = values(LocalY);

    -- handle old recruit insertion first:
    insert into coremeasurements (CensusID, StemID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
                                  UserDefinedFields, IsActive)
    select distinct ot.CensusID,
                    s.StemID,
                    null                                      as IsValidated,
                    ot.MeasurementDate,
                    ot.DBH,
                    ot.HOM,
                    json_object('treestemstate', 'old trees') as UserDefinedFields,
                    true
    from old_trees ot
             join quadrats q on q.QuadratName = ot.QuadratName and q.PlotID = ot.PlotID
             join stems s on s.StemTag = ot.StemTag and s.QuadratID = q.QuadratID
             join trees t on s.TreeID = t.TreeID and t.TreeTag = ot.TreeTag
    on duplicate key update CensusID        = values(CensusID),
                            StemID          = values(StemID),
                            MeasurementDate = values(MeasurementDate),
                            MeasuredDBH     = values(MeasuredDBH),
                            MeasuredHOM     = values(MeasuredHOM),
                            IsActive        = TRUE,
                            IsValidated     = null;

    -- handle multi stems insertion:
    insert into coremeasurements (CensusID, StemID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
                                  UserDefinedFields, IsActive)
    select distinct ms.CensusID,
                    s.StemID,
                    null                                       as IsValidated,
                    ms.MeasurementDate,
                    ms.DBH,
                    ms.HOM,
                    json_object('treestemstate', 'multi stem') as UserDefinedFields,
                    true
    from multi_stems ms
             join quadrats q on q.QuadratName = ms.QuadratName and q.PlotID = ms.PlotID
             join stems s on s.StemTag = ms.StemTag and s.QuadratID = q.QuadratID
             join trees t on s.TreeID = t.TreeID and t.TreeTag = ms.TreeTag
             left join old_trees ot on ot.id = ms.id
             left join new_recruits nt on nt.id = ms.id
    where ot.id is null
      and nt.id is null
    on duplicate key update CensusID        = values(CensusID),
                            StemID          = values(StemID),
                            MeasurementDate = values(MeasurementDate),
                            MeasuredDBH     = values(MeasuredDBH),
                            MeasuredHOM     = values(MeasuredHOM),
                            IsActive        = TRUE,
                            IsValidated     = null;

    -- handle new recruits
    insert into coremeasurements (CensusID, StemID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
                                  UserDefinedFields, IsActive)
    select distinct nr.CensusID,
                    s.StemID,
                    null                                        as IsValidated,
                    nr.MeasurementDate,
                    nr.DBH,
                    nr.HOM,
                    json_object('treestemstate', 'new recruit') as UserDefinedFields,
                    true
    from new_recruits nr
             join quadrats q on q.QuadratName = nr.QuadratName and q.PlotID = nr.PlotID
             join stems s on s.StemTag = nr.StemTag and s.QuadratID = q.QuadratID
             join trees t on s.TreeID = t.TreeID and t.TreeTag = nr.TreeTag
             left join old_trees ot on ot.id = nr.id
             left join multi_stems mt on mt.id = nr.id
    where ot.id is null
      and mt.id is null
    on duplicate key update CensusID        = values(CensusID),
                            StemID          = values(StemID),
                            MeasurementDate = values(MeasurementDate),
                            MeasuredDBH     = values(MeasuredDBH),
                            MeasuredHOM     = values(MeasuredHOM),
                            IsActive        = TRUE,
                            IsValidated     = null;

    create temporary table tempcodes as
    select cm.CoreMeasurementID,
           trim(jt.code) as Code
    from filtered f
             join trees t on t.TreeTag = f.TreeTag
             join quadrats q on q.QuadratName = f.QuadratName
             join stems s on s.StemTag = f.StemTag and s.TreeID = t.TreeID and s.QuadratID = q.QuadratID
             join coremeasurements cm
                  on cm.StemID = s.StemID and cm.CensusID = f.CensusID and
                     cm.MeasurementDate = f.MeasurementDate and cm.MeasuredDBH = f.DBH and cm.MeasuredHOM = f.HOM,
         json_table(
                 if(f.Codes = '' or trim(f.Codes) = '', '[]',
                    concat('["', replace(trim(f.Codes), ';', '","'), '"]')),
                 '$[*]' columns ( code varchar(10) path '$')
         ) jt;

    insert into cmattributes (CoreMeasurementID, Code)
    select tc.CoreMeasurementID, tc.Code
    from tempcodes tc
    on duplicate key update CoreMeasurementID = values(CoreMeasurementID),
                            Code              = values(Code);

    -- collapser
    set foreign_key_checks = 0;
    call RefreshMeasurementsSummary();

    create temporary table if not exists dup_cms as
    select ms1.CoreMeasurementID
    from measurementssummary ms1
             inner join measurementssummary ms2 on ms1.QuadratName = ms2.QuadratName and
                                                   ms1.CensusID = ms2.CensusID and
                                                   ms1.StemID = ms2.StemID and
                                                   ms1.MeasuredDBH <=> ms2.MeasuredDBH and
                                                   ms1.MeasuredHOM <=> ms2.MeasuredHOM and
                                                   ms1.MeasurementDate = ms2.MeasurementDate and
                                                   ms1.Attributes <=> ms2.Attributes and
                                                   ms1.CoreMeasurementID > ms2.CoreMeasurementID;

    delete ca
    from cmattributes ca
             join dup_cms dc on ca.CoreMeasurementID = dc.CoreMeasurementID;

    delete cm
    from coremeasurements cm
             join dup_cms dc on cm.CoreMeasurementID = dc.CoreMeasurementID;

    drop temporary table if exists dup_cms;
    set foreign_key_checks = 1;

    update coremeasurements set MeasuredDBH = null where MeasuredDBH = 0;
    update coremeasurements set MeasuredHOM = null where MeasuredHOM = 0;

    drop temporary table if exists old_trees, multi_stems, new_recruits;
    drop temporary table if exists initial_dup_filter, treestemstates,trees_snapshot, tempcodes, treestates,
        stemstates, filtered, filter_validity, filter_validity_dup,
        preexisting_trees, preexisting_stems, preinsert_core, duplicate_ids;
end;

create
    definer = azureroot@`%` procedure clearcensus(IN targetCensusID int)
BEGIN
    set foreign_key_checks = 0;
    START TRANSACTION;

    DELETE FROM temporarymeasurements WHERE CensusID = targetCensusID;
    delete from failedmeasurements where CensusID = targetCensusID;

    DELETE cma
    FROM cmattributes cma
             JOIN coremeasurements cm ON cma.CoreMeasurementID = cm.CoreMeasurementID
    WHERE cm.CensusID = targetCensusID;

    DELETE cme
    FROM cmverrors cme
             JOIN coremeasurements cm ON cme.CoreMeasurementID = cm.CoreMeasurementID
    WHERE cm.CensusID = targetCensusID;

    DELETE FROM measurementssummary WHERE CensusID = targetCensusID;
    delete from coremeasurements where CensusID = targetCensusID;

    DELETE FROM quadratpersonnel WHERE CensusID = targetCensusID;

    DELETE FROM censuspersonnel WHERE CensusID = targetCensusID;
    DELETE FROM censusattributes WHERE CensusID = targetCensusID;
    DELETE FROM censusquadrats WHERE CensusID = targetCensusID;
    DELETE FROM censusspecies WHERE CensusID = targetCensusID;

    DELETE FROM specieslimits WHERE CensusID = targetCensusID;

    delete from census WHERE CensusID = targetCensusID;

    alter table failedmeasurements
        auto_increment = 1;
    ALTER TABLE temporarymeasurements
        AUTO_INCREMENT = 1;
    ALTER TABLE cmattributes
        AUTO_INCREMENT = 1;
    ALTER TABLE cmverrors
        AUTO_INCREMENT = 1;
    ALTER TABLE coremeasurements
        AUTO_INCREMENT = 1;
    ALTER TABLE quadratpersonnel
        AUTO_INCREMENT = 1;
    ALTER TABLE personnel
        AUTO_INCREMENT = 1;
    ALTER TABLE censusquadrats
        AUTO_INCREMENT = 1;
    ALTER TABLE censusattributes
        AUTO_INCREMENT = 1;
    ALTER TABLE censuspersonnel
        AUTO_INCREMENT = 1;
    ALTER TABLE censusspecies
        AUTO_INCREMENT = 1;
    ALTER TABLE specieslimits
        AUTO_INCREMENT = 1;
    ALTER TABLE census
        AUTO_INCREMENT = 1;
    COMMIT;

    set foreign_key_checks = 1;
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
    definer = azureroot@`%` procedure reviewfailed()
begin
    update failedmeasurements set FailureReasons = '';
    update failedmeasurements fm2
        left join species s on fm2.SpCode = s.SpeciesCode
        left join quadrats q on fm2.PlotID = q.PlotID and fm2.Quadrat = q.QuadratName
        left join (select fm.FailedMeasurementID,
                          ifnull(
                                  (select sum(if(a.Code is null, 1, 0))
                                   from json_table(
                                                if(fm.Codes is null or trim(fm.Codes) = '', '[]',
                                                   concat('["', replace(trim(fm.Codes), ';', '","'), '"]')
                                                ),
                                                '$[*]' columns ( code varchar(10) path '$')
                                        ) jt
                                            left join attributes a
                                                      on a.Code = jt.code), 0
                          ) AS invalid_codes
                   from failedmeasurements fm) sub on sub.FailedMeasurementID = fm2.FailedMeasurementID
    set fm2.FailureReasons = trim(both '|' from concat_ws('|',
                                                          if(fm2.SpCode is null or fm2.SpCode = '', 'SpCode missing', null),
                                                          if(fm2.SpCode is not null and s.SpeciesID is null,
                                                             'SpCode invalid', null),
                                                          if(fm2.Quadrat is null or fm2.Quadrat = '', 'Quadrat missing', null),
                                                          if(fm2.Quadrat is not null and q.QuadratID is null,
                                                             'Quadrat invalid', null),
                                                          if(fm2.X is null or fm2.X = 0 or fm2.X = -1, 'Missing X', null),
                                                          if(fm2.Y is null or fm2.Y = 0 or fm2.Y = -1, 'Missing Y', null),
                                                          if((fm2.Codes is null or trim(fm2.Codes) = '') and
                                                             (fm2.DBH is null or fm2.DBH in (-1, 0)),
                                                             'Missing Codes and DBH', null),
                                                          if((fm2.Codes is null or trim(fm2.Codes) = '') and
                                                             (fm2.HOM is null or fm2.HOM in (-1, 0)),
                                                             'Missing Codes and HOM', null),
                                                          if(fm2.Date is null or fm2.Date = '1900-01-01', 'Missing Date', null),
                                                          if(sub.invalid_codes > 0, 'Invalid Codes', null)));
end;

