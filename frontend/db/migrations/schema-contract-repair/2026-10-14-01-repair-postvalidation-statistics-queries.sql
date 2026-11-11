-- Migration 2026-10-14-01: repair post-census statistics queries Q4/Q5/Q6 (S1 #506)
--
-- GUARDED REPAIR: matches each QueryName's QueryDefinition (whitespace-normalized,
-- binary/case-sensitive) against the known buggy signature. Verbatim match → repaired
-- and cache cleared; missing → inserted; anything else (including case-only differences
-- or NULL) → retained as site customization and counted. IDEMPOTENT: repaired/inserted
-- rows no longer match the buggy guard; subsequent runs are no-ops for those rows.
-- BINARY comparisons avoid ER_CANT_AGGREGATE_2COLLATIONS across collation variants.

SET @q4_name := 'Number of all trees';
SET @q4_buggy_norm := 'select count(t.TreeID) as TotalTrees from ${schema}.coremeasurements cm join ${schema}.stems s on s.StemGUID = cm.StemGUID and s.IsActive is true join ${schema}.census c on c.CensusID = cm.CensusID and c.IsActive is true join ${schema}.trees t on t.CensusID = c.CensusID and t.IsActive is true join ${schema}.quadrats q on q.QuadratID = s.QuadratID and q.IsActive is true where c.CensusID = ${currentCensusID} and c.PlotID = ${currentPlotID}';
SET @q4_fixed := 'select count(distinct t.TreeID) as TotalTrees
from ${schema}.coremeasurements cm
join ${schema}.stems s on s.StemGUID = cm.StemGUID and s.IsActive is true
join ${schema}.census c on c.CensusID = cm.CensusID and c.IsActive is true
join ${schema}.trees t on t.TreeID = s.TreeID and t.CensusID = c.CensusID and t.IsActive is true
join ${schema}.quadrats q on q.QuadratID = s.QuadratID and q.IsActive is true
where cm.IsActive is true and c.CensusID = ${currentCensusID} and c.PlotID = ${currentPlotID}';
SET @q4_fixed_norm := TRIM(REGEXP_REPLACE(@q4_fixed, '\\s+', ' '));
SET @q4_description := 'Calculating the total number of all trees for the current site, plot, and census';

SET @q5_name := 'All dead or missing stems and count by census';
SET @q5_buggy_norm := 'SELECT cm.CensusID, COUNT(s.StemGUID) AS DeadOrMissingStems, GROUP_CONCAT(s.StemTag ORDER BY s.StemTag) AS DeadOrMissingStemList FROM ${schema}.stems s JOIN ${schema}.coremeasurements cm ON cm.StemGUID = s.StemGUID and cm.IsActive is true JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID JOIN ${schema}.attributes a ON a.Code = cma.Code and a.IsActive is true WHERE a.Status IN (\'dead\', \'missing\') and s.IsActive is true GROUP BY cm.CensusID;';
SET @q5_fixed := 'SELECT dm.CensusID,
       COUNT(*) AS DeadOrMissingStems,
       GROUP_CONCAT(dm.StemTag ORDER BY dm.StemTag) AS DeadOrMissingStemList
FROM (
         SELECT DISTINCT cm.CensusID, s.StemGUID, s.StemTag
         FROM ${schema}.stems s
         JOIN ${schema}.coremeasurements cm ON cm.StemGUID = s.StemGUID and cm.IsActive is true
         JOIN ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
         JOIN ${schema}.attributes a ON a.Code = cma.Code and a.IsActive is true
         JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID and q.IsActive is true
         WHERE a.Status IN (\'dead\', \'missing\') and s.IsActive is true
           and cm.CensusID = ${currentCensusID} and q.PlotID = ${currentPlotID}
     ) dm
GROUP BY dm.CensusID;';
SET @q5_fixed_norm := TRIM(REGEXP_REPLACE(@q5_fixed, '\\s+', ' '));
SET @q5_description := 'Finds and returns a count of, then all dead or missing stems by census';

SET @q6_name := 'All trees outside plot limits';
SET @q6_buggy_norm := 'select t.TreeTag, (s.LocalX + q.StartX + p.GlobalX) as GlobalStemX, (s.LocalY + q.StartY + p.GlobalY) as GlobalStemY from ${schema}.coremeasurements cm join ${schema}.stems s on s.StemGUID = cm.StemGUID join ${schema}.census c on c.CensusID = cm.CensusID join ${schema}.plots p on p.PlotID = c.PlotID join ${schema}.trees t on t.CensusID = c.CensusID and t.TreeID = s.TreeID and t.IsActive is true join ${schema}.quadrats q on q.QuadratID = s.QuadratID and q.IsActive is true where (s.LocalX is null or q.StartX is null or p.GlobalX is null or p.DimensionX is null) or (s.LocalY is null or q.StartY is null or p.GlobalY is null or p.DimensionY is null) or (s.LocalX + q.StartX + p.GlobalX) > (p.GlobalX + p.DimensionX) or (s.LocalY + q.StartY + p.GlobalY) > (p.GlobalY + p.DimensionY) and (p.PlotID = ${currentPlotID} and c.CensusID = ${currentCensusID});';
SET @q6_fixed := 'select distinct t.TreeTag,
       (s.LocalX + q.StartX + p.GlobalX) as GlobalStemX,
       (s.LocalY + q.StartY + p.GlobalY) as GlobalStemY
from ${schema}.coremeasurements cm
         join ${schema}.stems s on s.StemGUID = cm.StemGUID and s.IsActive is true
         join ${schema}.census c on c.CensusID = cm.CensusID and c.IsActive is true
         join ${schema}.plots p on p.PlotID = c.PlotID
         join ${schema}.trees t on t.CensusID = c.CensusID and t.TreeID = s.TreeID and t.IsActive is true
         join ${schema}.quadrats q on q.QuadratID = s.QuadratID and q.IsActive is true
where cm.IsActive is true
  and (
       (s.LocalX is null or q.StartX is null or p.GlobalX is null or p.DimensionX is null)
    or (s.LocalY is null or q.StartY is null or p.GlobalY is null or p.DimensionY is null)
    or (s.LocalX + q.StartX + p.GlobalX) > (p.GlobalX + p.DimensionX)
    or (s.LocalY + q.StartY + p.GlobalY) > (p.GlobalY + p.DimensionY)
    or (s.LocalX + q.StartX + p.GlobalX) < p.GlobalX
    or (s.LocalY + q.StartY + p.GlobalY) < p.GlobalY
  )
  and p.PlotID = ${currentPlotID} and c.CensusID = ${currentCensusID};';
SET @q6_fixed_norm := TRIM(REGEXP_REPLACE(@q6_fixed, '\\s+', ' '));
SET @q6_description := 'Finds and returns any trees outside plot limits';

-- --------------------------------------------------------------------------
-- Q4: 'Number of all trees'
-- --------------------------------------------------------------------------
UPDATE postvalidationqueries
   SET QueryDefinition = @q4_fixed,
       LastRunAt = NULL,
       LastRunResult = NULL,
       LastRunStatus = NULL,
       LastRunPlotID = NULL,
       LastRunCensusID = NULL
 WHERE CAST(QueryName AS BINARY) = CAST(@q4_name AS BINARY)
   AND CAST(TRIM(REGEXP_REPLACE(QueryDefinition, '\\s+', ' ')) AS BINARY) = CAST(@q4_buggy_norm AS BINARY);
SET @q4_repaired := ROW_COUNT();

INSERT INTO postvalidationqueries (QueryName, QueryDefinition, Description, IsEnabled)
SELECT @q4_name, @q4_fixed, @q4_description, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM postvalidationqueries WHERE CAST(QueryName AS BINARY) = CAST(@q4_name AS BINARY)
);
SET @q4_inserted := ROW_COUNT();

SET @q4_customized := (
  SELECT COUNT(*) FROM postvalidationqueries
   WHERE CAST(QueryName AS BINARY) = CAST(@q4_name AS BINARY)
     AND NOT (CAST(TRIM(REGEXP_REPLACE(COALESCE(QueryDefinition, ''), '\\s+', ' ')) AS BINARY) <=> CAST(@q4_fixed_norm AS BINARY))
);

-- --------------------------------------------------------------------------
-- Q5: 'All dead or missing stems and count by census'
-- --------------------------------------------------------------------------
UPDATE postvalidationqueries
   SET QueryDefinition = @q5_fixed,
       LastRunAt = NULL,
       LastRunResult = NULL,
       LastRunStatus = NULL,
       LastRunPlotID = NULL,
       LastRunCensusID = NULL
 WHERE CAST(QueryName AS BINARY) = CAST(@q5_name AS BINARY)
   AND CAST(TRIM(REGEXP_REPLACE(QueryDefinition, '\\s+', ' ')) AS BINARY) = CAST(@q5_buggy_norm AS BINARY);
SET @q5_repaired := ROW_COUNT();

INSERT INTO postvalidationqueries (QueryName, QueryDefinition, Description, IsEnabled)
SELECT @q5_name, @q5_fixed, @q5_description, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM postvalidationqueries WHERE CAST(QueryName AS BINARY) = CAST(@q5_name AS BINARY)
);
SET @q5_inserted := ROW_COUNT();

SET @q5_customized := (
  SELECT COUNT(*) FROM postvalidationqueries
   WHERE CAST(QueryName AS BINARY) = CAST(@q5_name AS BINARY)
     AND NOT (CAST(TRIM(REGEXP_REPLACE(COALESCE(QueryDefinition, ''), '\\s+', ' ')) AS BINARY) <=> CAST(@q5_fixed_norm AS BINARY))
);

-- --------------------------------------------------------------------------
-- Q6: 'All trees outside plot limits'
-- --------------------------------------------------------------------------
UPDATE postvalidationqueries
   SET QueryDefinition = @q6_fixed,
       LastRunAt = NULL,
       LastRunResult = NULL,
       LastRunStatus = NULL,
       LastRunPlotID = NULL,
       LastRunCensusID = NULL
 WHERE CAST(QueryName AS BINARY) = CAST(@q6_name AS BINARY)
   AND CAST(TRIM(REGEXP_REPLACE(QueryDefinition, '\\s+', ' ')) AS BINARY) = CAST(@q6_buggy_norm AS BINARY);
SET @q6_repaired := ROW_COUNT();

INSERT INTO postvalidationqueries (QueryName, QueryDefinition, Description, IsEnabled)
SELECT @q6_name, @q6_fixed, @q6_description, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM postvalidationqueries WHERE CAST(QueryName AS BINARY) = CAST(@q6_name AS BINARY)
);
SET @q6_inserted := ROW_COUNT();

SET @q6_customized := (
  SELECT COUNT(*) FROM postvalidationqueries
   WHERE CAST(QueryName AS BINARY) = CAST(@q6_name AS BINARY)
     AND NOT (CAST(TRIM(REGEXP_REPLACE(COALESCE(QueryDefinition, ''), '\\s+', ' ')) AS BINARY) <=> CAST(@q6_fixed_norm AS BINARY))
);

-- --------------------------------------------------------------------------
-- Per-query detail: makes a skipped customization visible instead of silent.
-- Not visible in deployment logs (the runner discards result sets); kept for
-- interactive/manual runs.
-- --------------------------------------------------------------------------
SELECT @q4_name AS QueryName, @q4_repaired AS RowsRepaired, @q4_inserted AS RowsInserted, @q4_customized AS RowsSkippedCustomized
UNION ALL
SELECT @q5_name, @q5_repaired, @q5_inserted, @q5_customized
UNION ALL
SELECT @q6_name, @q6_repaired, @q6_inserted, @q6_customized;

SELECT CONCAT(
  'Migration 2026-10-14-01 complete: ',
  (@q4_repaired + @q5_repaired + @q6_repaired), ' repaired, ',
  (@q4_inserted + @q5_inserted + @q6_inserted), ' inserted, ',
  (@q4_customized + @q5_customized + @q6_customized), ' left untouched as site customizations.'
) AS Status;
