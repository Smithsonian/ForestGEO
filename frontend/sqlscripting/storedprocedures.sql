drop procedure if exists bulkingestioncollapser;
drop procedure if exists bulkingestionprocess;
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
             join stems st ON cm.StemID = st.StemID and st.CensusID = c.CensusID
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
    where t.CensusID is null;

    update trees set CensusID = vCensusID where TreeID in (select TreeID from missing_trees);
    drop temporary table if exists missing_trees;

    update coremeasurements set MeasuredDBH = null where MeasuredDBH = 0;
    update coremeasurements set MeasuredHOM = null where MeasuredHOM = 0;
    DELETE cm1
    FROM coremeasurements cm1
             INNER JOIN coremeasurements cm2
    WHERE cm1.CoreMeasurementID > cm2.CoreMeasurementID
      AND cm1.StemID = cm2.StemID
      AND cm1.MeasurementDate = cm2.MeasurementDate
      AND cm1.CensusID = vCensusID;
end;

create
    definer = azureroot@`%` procedure bulkingestionprocess(IN vFileID varchar(36), IN vBatchID varchar(36))
begin
    declare vCurrentCensusID int;
    set @disable_triggers = 0;

    select CensusID
    into vCurrentCensusID
    from temporarymeasurements
    where FileID = vFileID
      and BatchID = vBatchID
    limit 1;

    -- Clean up temporary tables including new ones for deduplication
    drop temporary table if exists initial_dup_filter, treestemstates, trees_snapshot, tempcodes, treestates,
        stemstates, filtered, filter_validity, filter_validity_dup, tmp_tree_stems,
        preexisting_trees, preexisting_stems, preinsert_core, duplicate_ids, old_trees, multi_stems, new_recruits,
        tmp_trees, tmp_quads, tmp_species, tmp_existing_stems, unique_trees_to_insert, unique_stems_to_insert;

    -- FIXED: More aggressive deduplication based on key business fields only
    create temporary table initial_dup_filter engine = memory as
    select min(id)                                                                        as id,
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
           -- Take first non-empty values for variable fields
           max(case when Codes is not null and trim(Codes) != '' then Codes end)          as Codes,
           max(case when Comments is not null and trim(Comments) != '' then Comments end) as Comments
    from temporarymeasurements
    where FileID = vFileID
      and BatchID = vBatchID
      and CensusID = vCurrentCensusID
    group by FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode,
             QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate;

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
                            (select sum(if(a.Code is null, 1, 0))
                             from json_table(
                                          if(i.Codes is null or trim(i.Codes) = '', '[]',
                                             concat('[\"', replace(trim(i.Codes), ';', '\",\"'), '\"]')
                                          ),
                                          '$[*]' columns ( code varchar(10) path '$')
                                  ) jt
                                      left join attributes a
                                                on a.Code = jt.code),
                            0
                    )                                                          as invalid_count
    from initial_dup_filter i
             left join quadrats tq on tq.QuadratName = i.QuadratName
             left join species ts on ts.SpeciesCode = i.SpeciesCode
    where i.TreeTag is not null
      and (tq.QuadratID is not null and ts.SpeciesID is not null)
      and i.MeasurementDate is not null;

    create temporary table filter_validity_dup engine = memory as
    select * from filter_validity;

    create temporary table if not exists filtered engine = memory as
    select distinct fv.*
    from filter_validity fv
    where invalid_count = 0;

    -- Insert failed measurements (unchanged)
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
             -- Condition 2: Rows from temporarymeasurements that are missing from filter_validity
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

    -- FIXED: Improved categorization logic using EXISTS clauses to prevent multiple matching
    create temporary table old_trees engine = memory as
    select distinct f.*
    from filtered f
    where exists (select 1
                  from trees t
                           join stems s on s.TreeID = t.TreeID and s.CensusID = t.CensusID
                  where t.TreeTag = f.TreeTag
                    and s.StemTag = f.StemTag
                    and t.CensusID < f.CensusID
                    and t.IsActive = 1
                    and s.IsActive = 1);

    create temporary table multi_stems engine = memory as
    select distinct f.*
    from filtered f
    where exists (select 1
                  from trees t
                  where t.TreeTag = f.TreeTag
                    and t.CensusID < f.CensusID
                    and t.IsActive = 1)
      and exists (select 1
                  from trees t2
                           join stems s on s.TreeID = t2.TreeID and s.CensusID = t2.CensusID
                  where t2.TreeTag = f.TreeTag
                    and s.StemTag <> f.StemTag
                    and t2.CensusID < f.CensusID
                    and t2.IsActive = 1
                    and s.IsActive = 1)
      and not exists (select 1
                      from old_trees ot
                      where ot.id = f.id);

    create temporary table new_recruits engine = memory as
    select distinct f.*
    from filtered f
    where not exists (select 1
                      from old_trees ot
                      where ot.id = f.id)
      and not exists (select 1
                      from multi_stems ms
                      where ms.id = f.id);

    -- FIXED: Create a deduplicated table for tree insertions using UNION instead of UNION ALL
    create temporary table unique_trees_to_insert engine = memory as
    select distinct TreeTag, SpeciesCode, CensusID
    from (select ot.TreeTag, ot.SpeciesCode, ot.CensusID
          from old_trees ot
          union
          select ms.TreeTag, ms.SpeciesCode, ms.CensusID
          from multi_stems ms
          union
          select nr.TreeTag, nr.SpeciesCode, nr.CensusID
          from new_recruits nr) combined
    where CensusID = vCurrentCensusID;

    -- FIXED: Remove any existing duplicates in trees table for this census before insertion
    delete t1
    from trees t1
             inner join trees t2
    where t1.TreeID > t2.TreeID
      and t1.TreeTag = t2.TreeTag
      and t1.CensusID = t2.CensusID
      and t1.CensusID = vCurrentCensusID;

    -- FIXED: Use INSERT IGNORE with deduplicated source
    INSERT IGNORE INTO trees (TreeTag, SpeciesID, CensusID)
    SELECT binary uti.TreeTag, ts.SpeciesID, uti.CensusID
    FROM unique_trees_to_insert uti
             JOIN species ts on ts.SpeciesCode = uti.SpeciesCode and ts.IsActive = 1
    WHERE NOT EXISTS (SELECT 1
                      FROM trees t
                      WHERE t.TreeTag = uti.TreeTag
                        AND t.CensusID = uti.CensusID
                        AND t.SpeciesID = ts.SpeciesID
                          FOR
                      UPDATE);

    -- FIXED: Create deduplicated table for stems insertions
    create temporary table unique_stems_to_insert engine = memory as
    select distinct TreeTag, QuadratName, StemTag, LocalX, LocalY, CensusID, SpeciesCode
    from (select ot.TreeTag, ot.QuadratName, ot.StemTag, ot.LocalX, ot.LocalY, ot.CensusID, ot.SpeciesCode
          from old_trees ot
          union
          select ms.TreeTag, ms.QuadratName, ms.StemTag, ms.LocalX, ms.LocalY, ms.CensusID, ms.SpeciesCode
          from multi_stems ms
          union
          select nr.TreeTag, nr.QuadratName, nr.StemTag, nr.LocalX, nr.LocalY, nr.CensusID, nr.SpeciesCode
          from new_recruits nr) combined
    where CensusID = vCurrentCensusID;

    -- FIXED: Remove existing stem duplicates before insertion
    delete s1
    from stems s1
             inner join stems s2
    where s1.StemID > s2.StemID
      and s1.StemTag = s2.StemTag
      and s1.TreeID = s2.TreeID
      and s1.CensusID = s2.CensusID
      and s1.CensusID = vCurrentCensusID;

    -- FIXED: Use INSERT IGNORE with deduplicated stems
    insert ignore into stems (TreeID, QuadratID, CensusID, StemNumber, StemTag, LocalX, LocalY, Moved, StemDescription,
                              IsActive)
    select distinct t.TreeID,
                    tq.QuadratID,
                    vCurrentCensusID          as CensusID,
                    -1                        as StemNumber,
                    coalesce(usi.StemTag, '') as StemTag,
                    coalesce(usi.LocalX, -1)  as LocalX,
                    coalesce(usi.LocalY, -1)  as LocalY,
                    false                     as Moved,
                    ''                        as StemDescription,
                    1                         as IsActive
    from unique_stems_to_insert usi
             join quadrats tq on tq.QuadratName = usi.QuadratName and tq.IsActive = 1
             join species ts on ts.SpeciesCode = usi.SpeciesCode and ts.IsActive = 1
             join trees t
                  on t.TreeTag = usi.TreeTag and t.SpeciesID = ts.SpeciesID and t.CensusID = vCurrentCensusID and
                     t.IsActive = 1;

    update stems
    set StemTag         = nullif(StemTag, ' '),
        LocalX          = nullif(LocalX, -1),
        LocalY          = nullif(LocalY, -1),
        StemDescription = nullif(StemDescription, ' ')
    where CensusID = vCurrentCensusID;

    -- Handle core measurements insertion (using deduplicated source)
    insert ignore into coremeasurements (CensusID, StemID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
                                         Description,
                                         UserDefinedFields, IsActive)
    select distinct f.CensusID,
                    s.StemID,
                    null                                      as IsValidated,
                    coalesce(f.MeasurementDate, '1900-01-01') as MeasurementDate,
                    coalesce(f.DBH, -1)                       as MeasuredDBH,
                    coalesce(f.HOM, -1)                       as MeasuredHOM,
                    coalesce(f.Comments, ' ')                 as Description,
                    json_object('treestemstate', f.state)     as UserDefinedFields,
                    1                                         as IsActive
    from (select ot.id              as id,
                 ot.CensusID        as CensusID,
                 ot.TreeTag         as TreeTag,
                 ot.StemTag         as StemTag,
                 ot.QuadratName     as QuadratName,
                 ot.MeasurementDate as MeasurementDate,
                 ot.DBH             as DBH,
                 ot.HOM             as HOM,
                 ot.Comments        as Comments,
                 'old tree'         as state,
                 ot.SpeciesCode     as SpeciesCode
          from old_trees ot
          union
          select ms.id              as id,
                 ms.CensusID        as CensusID,
                 ms.TreeTag         as TreeTag,
                 ms.StemTag         as StemTag,
                 ms.QuadratName     as QuadratName,
                 ms.MeasurementDate as MeasurementDate,
                 ms.DBH             as DBH,
                 ms.HOM             as HOM,
                 ms.Comments        as Comments,
                 'multi stem'       as state,
                 ms.SpeciesCode     as SpeciesCode
          from multi_stems ms
          union
          select nr.id              as id,
                 nr.CensusID        as CensusID,
                 nr.TreeTag         as TreeTag,
                 nr.StemTag         as StemTag,
                 nr.QuadratName     as QuadratName,
                 nr.MeasurementDate as MeasurementDate,
                 nr.DBH             as DBH,
                 nr.HOM             as HOM,
                 nr.Comments        as Comments,
                 'new recruit'      as state,
                 nr.SpeciesCode     as SpeciesCode
          from new_recruits nr) as f
             join quadrats tq on tq.QuadratName = f.QuadratName and tq.IsActive = 1
             join species ts on ts.SpeciesCode = f.SpeciesCode and ts.IsActive = 1
             join trees t
                  on t.TreeTag = f.TreeTag and t.SpeciesID = ts.SpeciesID and t.CensusID = f.CensusID and t.IsActive = 1
             join stems s on s.StemTag = f.StemTag and s.QuadratID = tq.QuadratID and s.TreeID = t.TreeID and
                             s.CensusID = f.CensusID and s.IsActive = 1;

    update coremeasurements
    set MeasurementDate = nullif(MeasurementDate, '1900-01-01'),
        MeasuredDBH     = nullif(MeasuredDBH, -1),
        MeasuredHOM     = nullif(MeasuredHOM, -1),
        Description     = nullif(Description, ' ')
    where CensusID = vCurrentCensusID;

    -- Handle attribute codes (unchanged)
    -- FIXED: Remove problematic exact value matching - use StemID/CensusID only
    create temporary table tempcodes engine = memory as
    select cm.CoreMeasurementID,
           trim(jt.code) as Code
    from filtered f
             join quadrats tq on tq.QuadratName = f.QuadratName and tq.IsActive = 1
             join species ts on ts.SpeciesCode = f.SpeciesCode and ts.IsActive = 1
             join trees t
                  on t.TreeTag = f.TreeTag and t.SpeciesID = ts.SpeciesID and t.CensusID = f.CensusID and t.IsActive = 1
             join stems s
                  on s.StemTag = f.StemTag and s.TreeID = t.TreeID and s.QuadratID = tq.QuadratID and
                     s.CensusID = f.CensusID and s.IsActive = 1
             join coremeasurements cm
                  on cm.StemID = s.StemID and cm.CensusID = f.CensusID and cm.IsActive = 1,
         json_table(
                 if(f.Codes = '' or trim(f.Codes) = '', '[]',
                    concat('[\"', replace(trim(f.Codes), ';', '\",\"'), '\"]')),
                 '$[*]' columns ( code varchar(10) path '$')
         ) jt
    where f.Codes is not null
      and trim(f.Codes) != '';

    insert ignore into cmattributes (CoreMeasurementID, Code)
    select tc.CoreMeasurementID, tc.Code
    from tempcodes tc;

    -- Clean up temporary tables
    drop temporary table if exists initial_dup_filter, treestemstates, trees_snapshot, tempcodes, treestates,
        stemstates, filtered, filter_validity, filter_validity_dup, tmp_tree_stems,
        preexisting_trees, preexisting_stems, preinsert_core, duplicate_ids, old_trees, multi_stems, new_recruits,
        tmp_trees, tmp_quads, tmp_species, tmp_existing_stems, unique_trees_to_insert, unique_stems_to_insert;

    set @disable_triggers = 0;
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
                join ${schema}.stems s on s.StemID = cm.StemID and s.CensusID = c.CensusID and s.IsActive is true
                join ${schema}.quadrats q on q.QuadratID = s.QuadratID and q.IsActive is true
                where cm.CensusID = ${currentCensusID} and q.PlotID = ${currentPlotID}
                group by q.QuadratName;',
            'Calculating the number of total records, organized by quadrat',
            true),
           ('Number of ALL Stem Records',
            'SELECT COUNT(s.StemID) AS TotalStems
               FROM ${schema}.stems s
               JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID and cm.IsActive is true
               JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
               JOIN ${schema}.attributes a ON cma.Code = a.Code and a.IsActive is true
               JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID and q.IsActive is true
               WHERE s.CensusID = ${currentCensusID} and s.IsActive is true AND q.PlotID = ${currentPlotID};',
            'Calculating the number of total stem records for the current site, plot, and census',
            true),
           ('Number of all LIVE stem records',
            'SELECT COUNT(s.StemID) AS LiveStems
    FROM ${schema}.stems s
             JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID and cm.IsActive is true
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
    join ${schema}.stems s on s.StemID = cm.StemID and s.IsActive is true
    join ${schema}.census c on c.CensusID = cm.CensusID and c.IsActive is true
    join ${schema}.trees t on t.CensusID = c.CensusID and t.IsActive is true
    join ${schema}.quadrats q on q.QuadratID = s.QuadratID and q.IsActive is true
    where c.CensusID = ${currentCensusID} and c.PlotID = ${currentPlotID}',
            'Calculating the total number of all trees for the current site, plot, and census', true),
           ('All dead or missing stems and count by census',
            'SELECT cm.CensusID,
               COUNT(s.StemID) AS DeadOrMissingStems,
               GROUP_CONCAT(s.StemTag ORDER BY s.StemTag) AS DeadOrMissingStemList
               FROM ${schema}.stems s
               JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID and cm.IsActive is true
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
             join ${schema}.stems s on s.StemID = cm.StemID
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
             join ${schema}.stems s on s.StemID = cm.StemID and s.CensusID = c.CensusID and s.IsActive is true
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
                  ON cm_current.StemID = s_current.StemID
                      AND cm_current.CensusID = s_current.CensusID
                      AND cm_current.IsActive = 1
    WHERE c_current.IsActive = 1
      AND c_current.PlotID = ${currentPlotID}
      AND NOT EXISTS (SELECT 1
                      FROM ${schema}.coremeasurements AS cm_last
                      WHERE cm_last.StemID = s_current.StemID
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
                             s_current.StemID
                      FROM ${schema}.stems AS s_current
                               JOIN ${schema}.coremeasurements AS cm_current
                                    ON cm_current.StemID = s_current.StemID
                                        AND cm_current.CensusID = (SELECT currentID FROM current_census)
                                        AND cm_current.IsActive = 1
                      WHERE s_current.IsActive = 1
                        AND NOT EXISTS (SELECT 1
                                        FROM ${schema}.coremeasurements AS cm_last
                                        WHERE cm_last.StemID = s_current.StemID
                                          AND cm_last.CensusID = (SELECT previousID FROM previous_census)
                                          AND cm_last.IsActive = 1)),
         NewStemCounts AS (SELECT q.QuadratName,
                                  COUNT(ns.StemID) AS NewStemCount
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
                  ON cm.StemID = s.StemID
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
                  ON cm.StemID = s.StemID
                      AND cm.CensusID = cc.CensusID
                      AND cm.IsActive = 1
             JOIN ${schema}.cmattributes AS cma
                  ON cma.CoreMeasurementID = cm.CoreMeasurementID
             JOIN ${schema}.attributes a on a.Code = cma.Code
             JOIN ${schema}.species sp on sp.SpeciesID = t.SpeciesID
    WHERE cc.PlotID = ${currentCensusID}
      AND a.Status = ''dead''
    ORDER BY sp.SpeciesName, s.StemID;',
            'dead stems by species, organized to determine which species (if any) are struggling', true);
end;

create
    definer = azureroot@`%` procedure reinsertdefaultvalidations()
begin
    truncate sitespecificvalidations;
    truncate sitespecificvalidations;

    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (1, 'ValidateDBHGrowthExceedsMax', 'DBH growth exceeds maximum rate of 65 mm', 'measuredDBH', '
insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm_present.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm_present
         join coremeasurements cm_past
              on cm_present.StemID = cm_past.StemID and cm_present.CensusID <> cm_past.CensusID and
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
         join coremeasurements cm_past on cm_present.StemID = cm_past.StemID and cm_present.CensusID <> cm_past.CensusID and cm_past.IsActive IS TRUE
         join census c_present on cm_present.CensusID = c_present.CensusID and c_present.IsActive is true
         join census c_past on cm_past.CensusID = c_past.CensusID and c_past.IsActive is true
         join plots p ON c_present.PlotID = p.PlotID and c_past.PlotID = p.PlotID
         join cmattributes cma_present on cma_present.CoreMeasurementID = cm_present.CoreMeasurementID
         join attributes a_present on a_present.Code = cma_present.Code
         join cmattributes cma_past on cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
         join attributes a_past on a_past.Code = cma_past.Code
         left join cmverrors e on e.CoreMeasurementID = cm_present.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where c_past.PlotCensusNumber >= 1
  and c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1
  and cm_present.IsActive is true
  and a_present.Status not in (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\')
  and a_past.Status not in (\'dead\', \'stem dead\', \'broken below\', \'missing\', \'omitted\')
  and (cm_present.IsValidated is null and cm_past.IsValidated is true)
  and (@p_CensusID IS NULL OR cm_present.CensusID = @p_CensusID)
  and (@p_PlotID IS NULL OR c_present.PlotID = @p_PlotID)
  and e.CoreMeasurementID is null and cm_past.MeasuredDBH > 0
  and (cm_present.MeasuredDBH < (cm_past.MeasuredDBH * 0.95));', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (3, 'ValidateFindAllInvalidSpeciesCodes', 'Species Code is invalid (not defined in species table)',
            'speciesCode', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive = TRUE
         join stems s on cm.StemID = s.StemID and c.CensusID = s.CensusID and s.IsActive = TRUE
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
            'quadratName', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join stems s on cm.StemID = s.StemID and c.CensusID = s.CensusID and s.IsActive is true
         join quadrats q on s.QuadratID = q.QuadratID and q.IsActive is true
         join (select s2.CensusID, q2.QuadratName
               from quadrats q2
                    join stems s2 on q2.QuadratID = s2.QuadratID
               group by s2.CensusID, q2.QuadratName
               having count(distinct q2.QuadratID) > 1) as ambiguous
         left join cmverrors e
                   on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null
  and cm.IsActive is true
  and (@p_CensusID is null or c.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID)
  and e.CoreMeasurementID is null;', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (5, 'ValidateFindDuplicateStemTreeTagCombinationsPerCensus',
            'Duplicate tree (and stem) tag found in census;Duplicate stem (and tree) tag found in census',
            'stemTag;treeTag', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         left join cmverrors e
                   on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
         join (select StemID, CensusID, count(*) AS MeasurementCount
               from coremeasurements
               group by StemID, CensusID
               having COUNT(*) > 1) dup on cm.StemID = dup.StemID and cm.CensusID = dup.CensusID
where cm.IsValidated is null and cm.IsActive is true
  and e.CoreMeasurementID is null
  and (@p_CensusID is null or c.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
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
    VALUES (7, 'ValidateFindStemsInTreeWithDifferentSpecies', 'Flagged;Different species', 'stemTag;speciesCode', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select min(cm.CoreMeasurementID), @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join stems s on cm.StemID = s.StemID and c.CensusID = s.CensusID and s.IsActive is true
         join trees t on t.TreeID = s.TreeID and t.CensusID = c.CensusID and t.IsActive is true
         join species sp on t.SpeciesID = sp.SpeciesID and sp.IsActive is true
         left join cmverrors e
                   on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null
   or e.CoreMeasurementID is null and cm.IsActive is true
    and (@p_CensusID is null or cm.CensusID = @p_CensusID)
    and (@p_PlotID is null or c.PlotID = @p_PlotID)
group by t.TreeTag
having count(distinct sp.SpeciesCode) > 1;', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (8, 'ValidateFindStemsOutsidePlots', 'Flagged;X outside plot OR;Y outside plot',
            'stemTag;stemLocalX;stemLocalY', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
join census c on cm.CensusID = c.CensusID and c.IsActive is true
join stems s on cm.StemID = s.StemID and c.CensusID = s.CensusID and s.IsActive is true
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
    VALUES (9, 'ValidateFindTreeStemsInDifferentQuadrats', 'Flagged;Flagged;Different quadrats',
            'stemTag;treeTag;quadratName', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join stems s1 on cm.StemID = s1.StemID and c.CensusID = s1.CensusID and s1.IsActive is true
         join trees t on s1.TreeID = t.TreeID and c.CensusID = t.CensusID and t.IsActive is true
         join stems s2 on t.TreeID = s2.TreeID and s1.StemID <> s2.StemID and s2.IsActive is true
         left join cmverrors e
                   on e.CoreMeasurementID = cm.CoreMeasurementID and e.ValidationErrorID = @validationProcedureID
where cm.IsValidated is null and cm.IsActive is true
  and e.CoreMeasurementID is null
  and s1.QuadratID <> s2.QuadratID
  and (@p_CensusID is null or cm.CensusID = @p_CensusID)
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', true);
    INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition,
                                         ChangelogDefinition, IsEnabled)
    VALUES (11, 'ValidateScreenMeasuredDiameterMinMax', 'Measured DBH is outside of species-defined bounds',
            'measuredDBH', 'insert into cmverrors (CoreMeasurementID, ValidationErrorID)
select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
from coremeasurements cm
         join census c on cm.CensusID = c.CensusID and c.IsActive is true
         join stems s on cm.StemID = s.StemID and c.CensusID = s.CensusID and s.IsActive is true
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
                          s.SpeciesID
                   FROM failedmeasurements fm
                            LEFT JOIN species s
                                      ON s.SpeciesCode = fm.SpCode) AS ssub
        ON ssub.FailedMeasurementID = fm2.FailedMeasurementID

        -- quadrat version snapshot
        LEFT JOIN (SELECT fm.FailedMeasurementID,
                          q.QuadratID
                   FROM failedmeasurements fm
                            LEFT JOIN quadrats q
                                      ON q.QuadratName = fm.Quadrat
                                          AND q.PlotID = fm.PlotID) AS qsub
        ON qsub.FailedMeasurementID = fm2.FailedMeasurementID

        -- invalid‐codes count via censusattributes → attributesversioning
        LEFT JOIN (SELECT fm.FailedMeasurementID,
                          IFNULL((SELECT SUM(IF(a.Code IS NULL, 1, 0))
                                  FROM JSON_TABLE(
                                               IF(fm.Codes IS NULL OR TRIM(fm.Codes) = '',
                                                  '[]',
                                                  CONCAT('["', REPLACE(TRIM(fm.Codes), ';', '","'), '"]')
                                               ),
                                               '$[*]' COLUMNS (code VARCHAR(10) PATH '$')
                                       ) AS jt
                                           LEFT JOIN attributes a
                                                     ON a.Code = jt.code),
                                 0) AS invalid_codes
                   FROM failedmeasurements fm) AS csub
        ON csub.FailedMeasurementID = fm2.FailedMeasurementID

    -- assemble the FailureReasons string
    SET fm2.FailureReasons = TRIM(BOTH '|' FROM CONCAT_WS('|',
                                                          IF(fm2.SpCode IS NULL OR fm2.SpCode = '', 'SpCode missing', NULL),
                                                          IF(fm2.SpCode IS NOT NULL AND
                                                             ssub.SpeciesID IS NULL,
                                                             'SpCode invalid', NULL),
                                                          IF(fm2.Quadrat IS NULL OR fm2.Quadrat = '', 'Quadrat missing', NULL),
                                                          IF(fm2.Quadrat IS NOT NULL AND
                                                             qsub.QuadratID IS NULL,
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

