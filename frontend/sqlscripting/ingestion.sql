-- =====================================================================================
-- BULK INGESTION PROCESSING PROCEDURE
-- =====================================================================================
-- Processes temporarymeasurements data for a specific FileID/BatchID combination.
-- 
-- Features:
-- - Cross-census stem tracking via StemGUID (unique per insertion) and StemCrossID (tracks same stem across censuses)
-- - Categorizes stems as old_trees, multi_stems, or new_recruits based on previous census records
-- - Performs comprehensive deduplication to prevent data contamination from parallel processing
-- - Maintains referential integrity through proper tree/stem/measurement relationships
-- 
-- Parameters:
-- - vFileID: Unique identifier for the uploaded file
-- - vBatchID: Unique identifier for the processing batch
-- 
-- Processing Flow:
-- 1. Validates input data exists
-- 2. Categorizes stems based on historical records  
-- 3. Inserts trees, stems, and measurements with proper cross-census tracking
-- 4. Populates StemCrossID for temporal stem analysis
-- =====================================================================================

drop procedure if exists bulkingestionprocess;
create
    definer = azureroot@`%` procedure bulkingestionprocess(IN vFileID varchar(36), IN vBatchID varchar(36))
main_proc: begin
    declare vCurrentCensusID int;
    set @disable_triggers = 0;

    select CensusID
    into vCurrentCensusID
    from temporarymeasurements
    where FileID = vFileID
      and BatchID = vBatchID
    limit 1;

    IF (SELECT COUNT(*) FROM temporarymeasurements WHERE FileID = vFileID AND BatchID = vBatchID) = 0 THEN
        SET @disable_triggers = 0;
        SELECT 'No data found for specified FileID/BatchID' as message;
        LEAVE main_proc;
    END IF;

    -- Clean up temporary tables including new ones for deduplication
    drop temporary table if exists initial_dup_filter, treestemstates, trees_snapshot, tempcodes, treestates,
        stemstates, filtered, filter_validity, filter_validity_dup, tmp_tree_stems,
        preexisting_trees, preexisting_stems, preinsert_core, duplicate_ids, old_trees, multi_stems, new_recruits,
        tmp_trees, tmp_quads, tmp_species, tmp_existing_stems, unique_trees_to_insert, unique_stems_to_insert;

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
    where s1.StemGUID > s2.StemGUID
      and s1.StemTag = s2.StemTag
      and s1.TreeID = s2.TreeID
      and s1.CensusID = s2.CensusID
      and s1.CensusID = vCurrentCensusID;

    -- FIXED: Use INSERT IGNORE with deduplicated stems
    insert ignore into stems (TreeID, QuadratID, CensusID, StemCrossID, StemTag, LocalX, LocalY, Moved, StemDescription,
                              IsActive)
    select distinct t.TreeID,
                    tq.QuadratID,
                    vCurrentCensusID          as CensusID,
                    NULL                      as StemCrossID, -- Will be populated by trigger or post-processing
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

    UPDATE stems s1
    SET s1.StemCrossID = (
        SELECT MIN(s2.StemGUID) 
        FROM stems s2 
        WHERE s2.TreeID = s1.TreeID 
          AND s2.StemTag = s1.StemTag 
          AND s2.QuadratID = s1.QuadratID 
          AND s2.LocalX = s1.LocalX 
          AND s2.LocalY = s1.LocalY
    )
    WHERE s1.CensusID = vCurrentCensusID 
      AND s1.StemCrossID IS NULL
      AND EXISTS (
          SELECT 1 FROM old_trees ot 
          JOIN trees t ON t.TreeTag = ot.TreeTag AND t.CensusID = s1.CensusID
          WHERE t.TreeID = s1.TreeID 
            AND ot.StemTag = s1.StemTag
      );

    UPDATE stems s1
    SET s1.StemCrossID = s1.StemGUID
    WHERE s1.CensusID = vCurrentCensusID 
      AND s1.StemCrossID IS NULL;

    -- Handle core measurements insertion (using deduplicated source)
    insert ignore into coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
                                         Description,
                                         UserDefinedFields, IsActive)
    select distinct f.CensusID,
                    s.StemGUID,
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
    -- FIXED: Remove problematic exact value matching - use StemGUID/CensusID only
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
                  on cm.StemGUID = s.StemGUID and cm.CensusID = f.CensusID and cm.IsActive = 1,
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