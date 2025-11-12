-- ============================================================
-- COMPREHENSIVE FAILURE SCENARIO TESTING
-- Tests damaged data, duplicates, and missing critical fields
-- ============================================================

USE forestgeo_testing;

-- ============================================================
-- TEST 7: Comprehensive Damaged/Invalid Data
-- ============================================================

SELECT '=== TEST 7: Comprehensive Damaged Data ===' as '';

SET @testFileID7 = 'COMPFAIL-001';
SET @testBatchID7 = UUID();

INSERT INTO temporarymeasurements
(FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Comments)
VALUES
-- Valid baseline
(@testFileID7, @testBatchID7, 1, 2, 'COMPFAIL001', '1', 'ACACBR', '0101', 5.5, 10.2, 15.3, 1.30, '2020-06-15', 'Valid'),
-- Invalid species
(@testFileID7, @testBatchID7, 1, 2, 'COMPFAIL002', '1', 'INVALIDSPECIES', '0101', 5.5, 10.2, 20.0, 1.30, '2020-06-15', 'Invalid species'),
-- Invalid quadrat
(@testFileID7, @testBatchID7, 1, 2, 'COMPFAIL003', '1', 'ACACBR', 'BADQUADRAT', 5.5, 10.2, 25.0, 1.30, '2020-06-15', 'Invalid quadrat'),
-- Missing coordinates
(@testFileID7, @testBatchID7, 1, 2, 'COMPFAIL004', '1', 'ACACBR', '0101', NULL, 10.2, 30.0, 1.30, '2020-06-15', 'Missing LocalX'),
(@testFileID7, @testBatchID7, 1, 2, 'COMPFAIL005', '1', 'ACACBR', '0101', 5.5, NULL, 35.0, 1.30, '2020-06-15', 'Missing LocalY'),
-- Missing TreeTag (critical)
(@testFileID7, @testBatchID7, 1, 2, NULL, '1', 'ACACBR', '0101', 5.5, 10.2, 40.0, 1.30, '2020-06-15', 'Missing TreeTag'),
-- Missing StemTag
(@testFileID7, @testBatchID7, 1, 2, 'COMPFAIL007', NULL, 'ACACBR', '0101', 5.5, 10.2, 45.0, 1.30, '2020-06-15', 'Missing StemTag'),
-- Missing SpeciesCode (critical)
(@testFileID7, @testBatchID7, 1, 2, 'COMPFAIL008', '1', NULL, '0101', 5.5, 10.2, 50.0, 1.30, '2020-06-15', 'Missing SpeciesCode'),
-- Missing QuadratName (critical)
(@testFileID7, @testBatchID7, 1, 2, 'COMPFAIL009', '1', 'ACACBR', NULL, 5.5, 10.2, 55.0, 1.30, '2020-06-15', 'Missing QuadratName'),
-- Invalid DBH (string)
(@testFileID7, @testBatchID7, 1, 2, 'COMPFAIL010', '1', 'ACACBR', '0101', 5.5, 10.2, NULL, 1.30, '2020-06-15', 'Would be BADDBH but NULL'),
-- Negative DBH
(@testFileID7, @testBatchID7, 1, 2, 'COMPFAIL011', '1', 'ACACBR', '0101', 5.5, 10.2, -50.0, 1.30, '2020-06-15', 'Negative DBH'),
-- Missing DBH (might be allowed for dead trees)
(@testFileID7, @testBatchID7, 1, 2, 'COMPFAIL014', '1', 'ACACBR', '0101', 5.5, 10.2, NULL, 1.30, '2020-06-15', 'Missing DBH'),
-- Missing HOM (might be allowed)
(@testFileID7, @testBatchID7, 1, 2, 'COMPFAIL015', '1', 'ACACBR', '0101', 5.5, 10.2, 70.0, NULL, '2020-06-15', 'Missing HOM');

SELECT CONCAT('✓ Inserted ', COUNT(*), ' test records with various failures') as Status
FROM temporarymeasurements
WHERE FileID = @testFileID7;

-- Process
CALL bulkingestionprocess(@testFileID7, @testBatchID7);

-- Check results
SELECT '✓ Processing complete. Checking results...' as '';

SET @valid_count7 = (
    SELECT COUNT(*)
    FROM coremeasurements cm
    JOIN stems s ON cm.StemGUID = s.StemGUID
    JOIN trees t ON s.TreeID = t.TreeID
    WHERE t.TreeTag LIKE 'COMPFAIL%'
    AND cm.CensusID = 2
);

SET @failed_count7 = (
    SELECT COUNT(*)
    FROM failedmeasurements
    WHERE (Tag LIKE 'COMPFAIL%' OR Tag IS NULL)
    AND CensusID = 2
);

SELECT
    CONCAT('Valid records: ', @valid_count7) as '',
    CONCAT('Failed records: ', @failed_count7) as '',
    CONCAT('Total: ', @valid_count7 + @failed_count7) as '',
    CASE
        WHEN (@valid_count7 + @failed_count7) >= 13 THEN '✅ TEST 7 PASSED: All records accounted for'
        ELSE CONCAT('⚠️ TEST 7: Data loss detected - expected 13+, got ', (@valid_count7 + @failed_count7))
    END as Result;

-- Show valid records
SELECT 'Valid records:' as '';
SELECT
    t.TreeTag,
    sp.SpeciesCode,
    q.QuadratName,
    cm.MeasuredDBH,
    cm.MeasuredHOM
FROM coremeasurements cm
JOIN stems s ON cm.StemGUID = s.StemGUID
JOIN trees t ON s.TreeID = t.TreeID
JOIN species sp ON t.SpeciesID = sp.SpeciesID
JOIN quadrats q ON s.QuadratID = q.QuadratID
WHERE t.TreeTag LIKE 'COMPFAIL%'
AND cm.CensusID = 2
ORDER BY t.TreeTag;

-- Show failed records with reasons
SELECT 'Failed records:' as '';
SELECT Tag, StemTag, SpCode, Quadrat, DBH, HOM, FailureReasons, Comments
FROM failedmeasurements
WHERE (Tag LIKE 'COMPFAIL%' OR Tag IS NULL)
AND CensusID = 2
ORDER BY Tag;

-- ============================================================
-- TEST 8: Duplicate Records (Unique Constraint Violations)
-- ============================================================

SELECT '=== TEST 8: Duplicate Records ===' as '';

SET @testFileID8 = 'DUPTEST-001';
SET @testBatchID8 = UUID();

-- Insert pairs of duplicates
INSERT INTO temporarymeasurements
(FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Comments)
VALUES
-- Duplicate 1: Exact duplicate (same tree, stem, census, dbh, hom, date)
(@testFileID8, @testBatchID8, 1, 2, 'DUPTEST001', '1', 'ACACBR', '0101', 5.5, 10.2, 15.3, 1.30, '2020-06-15', 'Original'),
(@testFileID8, @testBatchID8, 1, 2, 'DUPTEST001', '1', 'ACACBR', '0101', 5.5, 10.2, 15.3, 1.30, '2020-06-15', 'Exact duplicate'),

-- Duplicate 2: Same tree/stem but different measurement
(@testFileID8, @testBatchID8, 1, 2, 'DUPTEST002', '1', 'ACACDR', '0102', 8.2, 12.5, 22.8, 1.30, '2020-06-15', 'Original'),
(@testFileID8, @testBatchID8, 1, 2, 'DUPTEST002', '1', 'ACACDR', '0102', 8.2, 12.5, 22.8, 1.30, '2020-06-15', 'Same measurement duplicate'),

-- Duplicate 3: Same tree/stem but different DBH (should both succeed - different measurements)
(@testFileID8, @testBatchID8, 1, 2, 'DUPTEST003', '1', 'ACACET', '0103', 12.1, 18.9, 8.5, 1.30, '2020-06-15', 'First measurement'),
(@testFileID8, @testBatchID8, 1, 2, 'DUPTEST003', '1', 'ACACET', '0103', 12.1, 18.9, 18.5, 1.30, '2020-06-16', 'Different measurement');

SELECT CONCAT('✓ Inserted ', COUNT(*), ' records with duplicates') as Status
FROM temporarymeasurements
WHERE FileID = @testFileID8;

-- Process
CALL bulkingestionprocess(@testFileID8, @testBatchID8);

-- Check results
SELECT '✓ Processing complete. Checking duplicate handling...' as '';

SET @valid_count8 = (
    SELECT COUNT(*)
    FROM coremeasurements cm
    JOIN stems s ON cm.StemGUID = s.StemGUID
    JOIN trees t ON s.TreeID = t.TreeID
    WHERE t.TreeTag LIKE 'DUPTEST%'
    AND cm.CensusID = 2
);

SET @failed_count8 = (
    SELECT COUNT(*)
    FROM failedmeasurements
    WHERE Tag LIKE 'DUPTEST%'
    AND CensusID = 2
);

SELECT
    CONCAT('Valid records: ', @valid_count8) as '',
    CONCAT('Failed/Rejected records: ', @failed_count8) as '',
    CONCAT('Total input: 6') as '',
    CASE
        WHEN @valid_count8 BETWEEN 3 AND 4 THEN '✅ TEST 8 PASSED: Duplicate detection working (exact duplicates rejected)'
        WHEN @valid_count8 = 6 THEN '⚠️ TEST 8: All duplicates were inserted (INSERT IGNORE used?)'
        ELSE CONCAT('⚠️ TEST 8: Unexpected result - ', @valid_count8, ' valid records')
    END as Result;

-- Show what succeeded
SELECT 'Valid records inserted:' as '';
SELECT
    t.TreeTag,
    s.StemTag,
    cm.MeasuredDBH,
    cm.MeasurementDate,
    cm.Description as Comments
FROM coremeasurements cm
JOIN stems s ON cm.StemGUID = s.StemGUID
JOIN trees t ON s.TreeID = t.TreeID
WHERE t.TreeTag LIKE 'DUPTEST%'
AND cm.CensusID = 2
ORDER BY t.TreeTag, cm.MeasurementDate, cm.MeasuredDBH;

-- Show duplicates that failed
SELECT 'Rejected duplicates:' as '';
SELECT Tag, StemTag, DBH, Date, FailureReasons
FROM failedmeasurements
WHERE Tag LIKE 'DUPTEST%'
AND CensusID = 2;

-- ============================================================
-- SUMMARY REPORT
-- ============================================================

SELECT '=== COMPREHENSIVE FAILURE TESTING SUMMARY ===' as '';

SELECT
    'Test 7: Damaged Data' as Test,
    (@valid_count7 + @failed_count7) as RecordsProcessed,
    @failed_count7 as FailedRecords,
    CASE
        WHEN (@valid_count7 + @failed_count7) >= 13 THEN '✅ PASS'
        ELSE '❌ FAIL (Data loss)'
    END as Status

UNION ALL

SELECT
    'Test 8: Duplicates',
    @valid_count8,
    @failed_count8,
    CASE
        WHEN @valid_count8 BETWEEN 3 AND 4 THEN '✅ PASS'
        WHEN @valid_count8 = 6 THEN '⚠️ WARN (No deduplication)'
        ELSE '❌ FAIL'
    END;

-- ============================================================
-- CLEANUP (Run after reviewing results)
-- ============================================================
/*
DELETE cm FROM coremeasurements cm
JOIN stems s ON cm.StemGUID = s.StemGUID
JOIN trees t ON s.TreeID = t.TreeID
WHERE t.TreeTag LIKE 'COMPFAIL%' OR t.TreeTag LIKE 'DUPTEST%';

DELETE FROM stems WHERE TreeID IN (
    SELECT TreeID FROM trees
    WHERE TreeTag LIKE 'COMPFAIL%' OR TreeTag LIKE 'DUPTEST%'
);
DELETE FROM trees WHERE TreeTag LIKE 'COMPFAIL%' OR TreeTag LIKE 'DUPTEST%';
DELETE FROM failedmeasurements WHERE Tag LIKE 'COMPFAIL%' OR Tag LIKE 'DUPTEST%' OR Tag IS NULL;
DELETE FROM temporarymeasurements WHERE FileID LIKE 'COMPFAIL%' OR FileID LIKE 'DUPTEST%';

SELECT 'Cleanup complete' as Status;
*/
