drop procedure if exists RefreshMeasurementsSummary;
drop procedure if exists RefreshViewFullTable;
drop procedure if exists bulkingestionprocess;
drop procedure if exists clearcensus;
drop procedure if exists reingestfailedrows;
drop procedure if exists reviewfailed;
drop procedure if exists bulkingestioncollapser;
create
    definer = azureroot@`%` procedure RefreshMeasurementsSummary()
BEGIN
    SET foreign_key_checks = 0;
    TRUNCATE measurementssummary;
    INSERT IGNORE INTO measurementssummary (CoreMeasurementID,
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
    SELECT cm.CoreMeasurementID                                 AS CoreMeasurementID,
           st.StemID                                            AS StemID,
           tv.TreeID                                            AS TreeID,
           sv.SpeciesID                                         AS SpeciesID,
           qv.QuadratID                                         AS QuadratID,
           COALESCE(qv.PlotID, 0)                               AS PlotID,
           COALESCE(cm.CensusID, 0)                             AS CensusID,
           sv.SpeciesName                                       AS SpeciesName,
           sv.SubspeciesName                                    AS SubspeciesName,
           sv.SpeciesCode                                       AS SpeciesCode,
           tv.TreeTag                                           AS TreeTag,
           st.StemTag                                           AS StemTag,
           st.LocalX                                            AS StemLocalX,
           st.LocalY                                            AS StemLocalY,
           qv.QuadratName                                       AS QuadratName,
           cm.MeasurementDate                                   AS MeasurementDate,
           cm.MeasuredDBH                                       AS MeasuredDBH,
           cm.MeasuredHOM                                       AS MeasuredHOM,
           cm.IsValidated                                       AS IsValidated,
           cm.Description                                       AS Description,
           (SELECT GROUP_CONCAT(DISTINCT av.Code SEPARATOR '; ')
            FROM cmattributes ca
                     left join attributesversioning av on av.Code = ca.Code
            WHERE ca.CoreMeasurementID = cm.CoreMeasurementID)  AS Attributes,
           cm.UserDefinedFields                                 AS UserDefinedFields,
           (SELECT GROUP_CONCAT(CONCAT(vp.ProcedureName, '->', vp.Description) SEPARATOR ';')
            FROM sitespecificvalidations vp
                     left JOIN cmverrors cmv ON cmv.ValidationErrorID = vp.ValidationID
            WHERE cmv.CoreMeasurementID = cm.CoreMeasurementID) AS Errors
    FROM coremeasurements cm
             join census c ON cm.CensusID = c.CensusID
             join stems st ON cm.StemID = st.StemID
             join treesversioning tv on tv.CensusID = c.CensusID and tv.TreeID = st.TreeID
             join speciesversioning sv on c.CensusID = sv.CensusID and tv.SpeciesID = sv.SpeciesID
             join quadratsversioning qv on qv.CensusID = c.CensusID and qv.QuadratID = st.QuadratID;

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
             left join treesversioning tv on t.TreeID = tv.TreeID
    where tv.TreesVersioningID is null
      and t.TreeID is not null;

    insert into censustrees (TreeID, CensusID)
    select TreeID, vCensusID
    from missing_trees
    on duplicate key update TreeID            = values(TreeID),
                            CensusID          = values(CensusID),
                            TreesVersioningID = values(TreesVersioningID);

    drop temporary table if exists missing_trees;

    #     set foreign_key_checks = 0;
#
#     call RefreshMeasurementsSummary();
#
#     create temporary table if not exists dup_cms engine = memory as
#     select ms1.CoreMeasurementID
#     from measurementssummary ms1
#              inner join measurementssummary ms2 on ms1.QuadratName = ms2.QuadratName and
#                                                    ms1.CensusID = ms2.CensusID and
#                                                    ms1.StemID = ms2.StemID and
#                                                    ms1.MeasuredDBH <=> ms2.MeasuredDBH and
#                                                    ms1.MeasuredHOM <=> ms2.MeasuredHOM and
#                                                    ms1.MeasurementDate = ms2.MeasurementDate and
#                                                    ms1.Attributes <=> ms2.Attributes and
#                                                    ms1.CoreMeasurementID > ms2.CoreMeasurementID;
#
#     delete ca
#     from cmattributes ca
#              join dup_cms dc on ca.CoreMeasurementID = dc.CoreMeasurementID;
#
#     delete cm
#     from coremeasurements cm
#              join dup_cms dc on cm.CoreMeasurementID = dc.CoreMeasurementID;
#
#     drop temporary table if exists dup_cms;
#     set foreign_key_checks = 1;

    update coremeasurements set MeasuredDBH = null where MeasuredDBH = 0;
    update coremeasurements set MeasuredHOM = null where MeasuredHOM = 0;
end;

create
    definer = azureroot@`%` procedure bulkingestionprocess(IN vFileID varchar(36), IN vBatchID varchar(36))
begin
    set @disable_triggers = 0;

    select CensusID
    into @CURRENT_CENSUS_ID
    from temporarymeasurements
    where FileID = vFileID
      and BatchID = vBatchID
    limit 1;

    drop temporary table if exists initial_dup_filter, treestemstates, trees_snapshot, tempcodes, treestates,
        stemstates, filtered, filter_validity, filter_validity_dup,
        preexisting_trees, preexisting_stems, preinsert_core, duplicate_ids, old_trees, multi_stems, new_recruits,
        tmp_trees, tmp_quads, tmp_species, tmp_existing_stems;

    CREATE TEMPORARY TABLE tmp_trees ENGINE = MEMORY AS
    SELECT ct.TreeID, tv.TreeTag, tv.TreesVersioningID
    FROM censustrees ct
             JOIN treesversioning tv
                  ON ct.TreesVersioningID = tv.TreesVersioningID
    WHERE ct.CensusID = @CURRENT_CENSUS_ID;
    CREATE INDEX idx_tmp_trees_tag ON tmp_trees (TreeTag);

    CREATE TEMPORARY TABLE tmp_quads ENGINE = MEMORY AS
    SELECT cq.QuadratID, qv.QuadratsVersioningID, qv.QuadratName
    FROM censusquadrats cq
             JOIN quadratsversioning qv
                  ON cq.QuadratsVersioningID = qv.QuadratsVersioningID
    WHERE cq.CensusID = @CURRENT_CENSUS_ID;
    CREATE INDEX idx_tmp_quads_name ON tmp_quads (QuadratName);

    CREATE TEMPORARY TABLE tmp_species ENGINE = MEMORY AS
    SELECT cs.SpeciesID, sv.SpeciesVersioningID, sv.SpeciesCode
    FROM censusspecies cs
             JOIN speciesversioning sv
                  ON cs.SpeciesVersioningID = sv.SpeciesVersioningID
    WHERE cs.CensusID = @CURRENT_CENSUS_ID;
    CREATE INDEX idx_tmp_spec_code ON tmp_species (SpeciesCode);

    create temporary table tmp_existing_stems engine = memory as
    select StemID, TreeID, QuadratID, StemTag from stems;
    create index idx_tmp_es_tree_stem ON tmp_existing_stems (TreeID, StemTag);

    create temporary table initial_dup_filter engine = memory as
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
                    Codes,
                    Comments
    from temporarymeasurements
    where FileID = vFileID
      and BatchID = vBatchID
      and CensusID = @CURRENT_CENSUS_ID;

    create temporary table filter_validity engine = memory as
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
                    i.Comments                                                 as Comments,
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
                                      left join attributesversioning av
                                                on av.Code = jt.code and
                                                   av.CensusID = i.CensusID),
                            0
                    )                                                          as invalid_count
    from initial_dup_filter i
             left join tmp_quads tq on tq.QuadratName = i.QuadratName
             left join tmp_species ts on ts.SpeciesCode = i.SpeciesCode
    where i.TreeTag is not null
      and (tq.QuadratsVersioningID is not null and
           ts.SpeciesVersioningID is not null) -- using OR will pass the row if one condition is satisfied but not the other
      and i.MeasurementDate is not null;

    create temporary table filter_validity_dup engine = memory as
    select * from filter_validity;

    create temporary table if not exists filtered engine = memory as
    select distinct fv.*
    from filter_validity fv
    where invalid_count = 0
      and not exists (select 1
                      from coremeasurements cm
                               join tmp_existing_stems s on cm.StemID = s.StemID and fv.StemTag = s.StemTag
                               join tmp_trees tt on tt.TreeID = s.TreeID and tt.TreeTag = fv.TreeTag
                      where cm.CensusID = fv.CensusID
                        and cm.MeasuredDBH = fv.DBH
                        and cm.MeasuredHOM = fv.HOM
                        and cm.MeasurementDate = fv.MeasurementDate);

    insert ignore into failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes,
                                           Comments)
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
                    nullif(Codes, '')                     as Codes,
                    nullif(Comments, '')                  as Comments
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
                    fv.Codes,
                    fv.Comments
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
                    coalesce(tm.Codes, ''),
                    coalesce(tm.Comments, '')
             from temporarymeasurements tm
             where tm.BatchID = vBatchID
               and tm.FileID = vFileID
               and not exists (select 1
                               from filter_validity_dup f
                               where f.id = tm.id)) as combined;


    create temporary table old_trees engine = memory as
    select distinct f.*
    from filtered f
             join tmp_trees tt on tt.TreeTag = f.TreeTag
             join tmp_quads tq on tq.QuadratName = f.QuadratName
             join tmp_existing_stems s on s.TreeID = tt.TreeID and s.QuadratID = tq.QuadratID and s.StemTag = f.StemTag;

    create temporary table multi_stems engine = memory as
    select distinct f.*
    from filtered f
             join tmp_trees tt on tt.TreeTag = f.TreeTag
             left join tmp_existing_stems s on s.TreeID = tt.TreeID and s.StemTag = f.StemTag
             left join old_trees ot on ot.id = f.id
    where ot.id is null
      and s.StemID is null;

    create temporary table new_recruits engine = memory as
    select distinct f.*
    from filtered f
             left join tmp_trees tt on tt.TreeTag = f.TreeTag
             left join multi_stems ms on ms.id = f.id
             left join old_trees ot on ot.id = f.id
    where tt.TreesVersioningID is null
      and ms.id is null
      and ot.id is null;

    insert into trees (TreeTag, SpeciesID)
    select distinct binary f.TreeTag, ts.SpeciesID
    from (select TreeTag, SpeciesCode, CensusID
          from old_trees
          union all
          select TreeTag, SpeciesCode, CensusID
          from multi_stems
          union all
          select TreeTag, SpeciesCode, CensusID
          from new_recruits) as f
             join tmp_species ts on ts.SpeciesCode = f.SpeciesCode
    where f.CensusID = @CURRENT_CENSUS_ID
    on duplicate key update TreeTag = values(TreeTag), SpeciesID = values(SpeciesID);

    insert into stems (TreeID, QuadratID, StemTag, LocalX, LocalY)
    select distinct t.TreeID, tq.QuadratID, f.StemTag, f.LocalX, f.LocalY
    from (select TreeTag, QuadratName, StemTag, LocalX, LocalY, CensusID, SpeciesCode
          from old_trees
          union all
          select TreeTag, QuadratName, StemTag, LocalX, LocalY, CensusID, SpeciesCode
          from multi_stems
          union all
          select TreeTag, QuadratName, StemTag, LocalX, LocalY, CensusID, SpeciesCode
          from new_recruits) as f
             join tmp_quads tq on tq.QuadratName = f.QuadratName
             join tmp_species ts on ts.SpeciesCode = f.SpeciesCode
             join trees t
                  on t.TreeTag = f.TreeTag and t.SpeciesID = ts.SpeciesID
    on duplicate key update QuadratID = values(QuadratID),
                            StemTag   = values(StemTag),
                            LocalX    = values(LocalX),
                            LocalY    = values(LocalY);

    -- handle old recruit insertion first:
    insert into coremeasurements (CensusID, StemID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description,
                                  UserDefinedFields, IsActive)
    select distinct f.CensusID,
                    s.StemID,
                    null                                  as IsValidated,
                    f.MeasurementDate,
                    f.DBH                                 as MeasuredDBH,
                    f.HOM                                 as MeasuredHOM,
                    f.Comments                            as Comments,
                    json_object('treestemstate', f.state) as UserDefinedFields,
                    true                                  as IsActive
    from (select id,
                 CensusID,
                 TreeTag,
                 StemTag,
                 QuadratName,
                 MeasurementDate,
                 DBH,
                 HOM,
                 Comments,
                 'old tree' as state,
                 SpeciesCode
          from old_trees
          union all
          select id,
                 CensusID,
                 TreeTag,
                 StemTag,
                 QuadratName,
                 MeasurementDate,
                 DBH,
                 HOM,
                 Comments,
                 'multi stem' as state,
                 SpeciesCode
          from multi_stems
          union all
          select id,
                 CensusID,
                 TreeTag,
                 StemTag,
                 QuadratName,
                 MeasurementDate,
                 DBH,
                 HOM,
                 Comments,
                 'new recruit' as state,
                 SpeciesCode
          from new_recruits) as f
             join tmp_quads tq on tq.QuadratName = f.QuadratName
             join tmp_species ts on ts.SpeciesCode = f.SpeciesCode
             join trees t on t.TreeTag = f.TreeTag and t.SpeciesID = ts.SpeciesID
             join stems s on s.StemTag = f.StemTag and s.QuadratID = tq.QuadratID and s.TreeID = t.TreeID
    on duplicate key update CensusID          = values(CensusID),
                            StemID            = values(StemID),
                            MeasurementDate   = values(MeasurementDate),
                            MeasuredDBH       = values(MeasuredDBH),
                            MeasuredHOM       = values(MeasuredHOM),
                            Description       = values(Description),
                            IsActive          = values(IsActive),
                            IsValidated       = values(IsValidated),
                            UserDefinedFields = values(UserDefinedFields);

    create temporary table tempcodes engine = memory as
    select cm.CoreMeasurementID,
           trim(jt.code) as Code
    from filtered f
             join tmp_quads tq
                  on tq.QuadratName = f.QuadratName
             join tmp_species ts on ts.SpeciesCode = f.SpeciesCode
             join trees t on t.TreeTag = f.TreeTag and t.SpeciesID = ts.SpeciesID
             join stems s on s.StemTag = f.StemTag and s.TreeID = t.TreeID and s.QuadratID = tq.QuadratID
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

    drop temporary table if exists initial_dup_filter, treestemstates, trees_snapshot, tempcodes, treestates,
        stemstates, filtered, filter_validity, filter_validity_dup,
        preexisting_trees, preexisting_stems, preinsert_core, duplicate_ids, old_trees, multi_stems, new_recruits,
        tmp_trees, tmp_quads, tmp_species, tmp_existing_stems;

    set @disable_triggers = 0;
end;

create
    definer = azureroot@`%` procedure clearcensus(IN targetCensusID int)
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
    definer = azureroot@`%` procedure reviewfailed()
begin
    -- 1) clear out old failure reasons
    UPDATE failedmeasurements
    SET FailureReasons = '';

    -- 2) now re-populate, using versioned lookups
    UPDATE failedmeasurements AS fm2
        -- species version snapshot
        LEFT JOIN (SELECT fm.FailedMeasurementID,
                          sv.SpeciesVersioningID
                   FROM failedmeasurements fm
                            LEFT JOIN speciesversioning sv
                                      ON sv.SpeciesCode = fm.SpCode
                            LEFT JOIN censusspecies cs
                                      ON cs.SpeciesVersioningID = sv.SpeciesVersioningID
                                          AND cs.CensusID = fm.CensusID) AS ssub
        ON ssub.FailedMeasurementID = fm2.FailedMeasurementID

        -- quadrat version snapshot
        LEFT JOIN (SELECT fm.FailedMeasurementID,
                          qv.QuadratsVersioningID
                   FROM failedmeasurements fm
                            LEFT JOIN quadratsversioning qv
                                      ON qv.QuadratName = fm.Quadrat
                                          AND qv.PlotID = fm.PlotID
                            LEFT JOIN censusquadrats cq
                                      ON cq.QuadratsVersioningID = qv.QuadratsVersioningID
                                          AND cq.CensusID = fm.CensusID) AS qsub
        ON qsub.FailedMeasurementID = fm2.FailedMeasurementID

        -- invalid‐codes count via censusattributes → attributesversioning
        LEFT JOIN (SELECT fm.FailedMeasurementID,
                          IFNULL((SELECT SUM(IF(av.Code IS NULL, 1, 0))
                                  FROM JSON_TABLE(
                                               IF(fm.Codes IS NULL OR TRIM(fm.Codes) = '',
                                                  '[]',
                                                  CONCAT('["', REPLACE(TRIM(fm.Codes), ';', '","'), '"]')
                                               ),
                                               '$[*]' COLUMNS (code VARCHAR(10) PATH '$')
                                       ) AS jt
                                           LEFT JOIN censusattributes cav
                                                     ON cav.Code = jt.code
                                                         AND cav.CensusID = fm.CensusID
                                           LEFT JOIN attributesversioning av
                                                     ON av.AttributesVersioningID = cav.AttributesVersioningID),
                                 0) AS invalid_codes
                   FROM failedmeasurements fm) AS csub
        ON csub.FailedMeasurementID = fm2.FailedMeasurementID

    -- assemble the FailureReasons string
    SET fm2.FailureReasons = TRIM(BOTH '|' FROM CONCAT_WS('|',
                                                          IF(fm2.SpCode IS NULL OR fm2.SpCode = '', 'SpCode missing', NULL),
                                                          IF(fm2.SpCode IS NOT NULL AND
                                                             ssub.SpeciesVersioningID IS NULL,
                                                             'SpCode invalid', NULL),
                                                          IF(fm2.Quadrat IS NULL OR fm2.Quadrat = '', 'Quadrat missing', NULL),
                                                          IF(fm2.Quadrat IS NOT NULL AND
                                                             qsub.QuadratsVersioningID IS NULL,
                                                             'Quadrat invalid', NULL),
                                                          IF(fm2.X IS NULL OR fm2.X IN (0, -1), 'Missing X', NULL),
                                                          IF(fm2.Y IS NULL OR fm2.Y IN (0, -1), 'Missing Y', NULL),
                                                          IF((fm2.Codes IS NULL OR TRIM(fm2.Codes) = '')
                                                                 AND (fm2.DBH IS NULL OR fm2.DBH IN (0, -1)),
                                                             'Missing Codes and DBH', NULL),
                                                          IF((fm2.Codes IS NULL OR TRIM(fm2.Codes) = '')
                                                                 AND (fm2.HOM IS NULL OR fm2.HOM IN (0, -1)),
                                                             'Missing Codes and HOM', NULL),
                                                          IF(fm2.Date IS NULL OR fm2.Date = '1900-01-01', 'Missing Date', NULL),
                                                          IF(csub.invalid_codes > 0, 'Invalid Codes', NULL)
                                                ));
end;

