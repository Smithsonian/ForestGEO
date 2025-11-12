-- Direct test of what quadrat validation sees

USE forestgeo_testing;

-- Simulate what the procedure will see for TEST-CROSS-QUADRAT (should match)
SELECT 'TEST-CROSS-QUADRAT Analysis' as Test;

-- What old_trees table would contain (from census 2 upload)
SELECT 'Uploading Record (filtered/old_trees)' as Stage,
       'TEST-CROSS-QUADRAT' as TreeTag,
       '1' as StemTag,
       (SELECT QuadratID FROM quadrats WHERE QuadratName = '0102') as CurrentQuadratID,
       '0102' as CurrentQuadratName;

-- What prev_census subquery would find (from census 1)
SELECT 'Most Recent Previous Census' as Stage,
       t.TreeTag,
       s.StemTag,
       s.QuadratID as PrevQuadratID,
       q.QuadratName as PrevQuadratName
FROM stems s
INNER JOIN trees t ON s.TreeID = t.TreeID AND s.CensusID = t.CensusID
INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
INNER JOIN (
    SELECT t2.TreeTag, s2.StemTag, MAX(t2.CensusID) as MaxCensusID
    FROM trees t2
    JOIN stems s2 ON s2.TreeID = t2.TreeID AND s2.CensusID = t2.CensusID
    WHERE t2.CensusID < 2  -- Census 2
      AND t2.IsActive = 1
      AND s2.IsActive = 1
    GROUP BY t2.TreeTag, s2.StemTag
) max_census ON t.TreeTag = max_census.TreeTag
    AND s.StemTag = max_census.StemTag
    AND t.CensusID = max_census.MaxCensusID
WHERE t.TreeTag = 'TEST-CROSS-QUADRAT'
  AND s.StemTag = '1'
  AND t.IsActive = 1
  AND s.IsActive = 1;

-- Compare
SELECT 'Should Quadrat Validation Trigger?' as Question,
       CASE
           WHEN (SELECT QuadratID FROM quadrats WHERE QuadratName = '0102') !=
                (SELECT s.QuadratID
                 FROM stems s
                 JOIN trees t ON s.TreeID = t.TreeID
                 WHERE t.TreeTag = 'TEST-CROSS-QUADRAT'
                   AND s.StemTag = '1'
                   AND t.CensusID = 1)
           THEN 'YES - Quadrats differ'
           ELSE 'NO - Quadrats match'
       END as Answer;
