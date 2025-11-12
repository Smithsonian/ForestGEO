-- ============================================================
-- OPTION 3: Direct Stored Procedure Testing
-- Tests the upload system stored procedures for data integrity
-- ============================================================

USE forestgeo_testing;

-- ============================================================
-- TEST 1: Valid Measurements Processing (No Data Loss)
-- ============================================================

SELECT '=== TEST 1: Valid Measurements Processing ===' as '';

-- Step 1: Insert test data into temporarymeasurements
SET @testFileID1 = 'SPTEST-VALID-001';
SET @testBatchID1 = UUID();

INSERT INTO temporarymeasurements
(FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
VALUES
(@testFileID1, @testBatchID1, 1, 2, 'SPTEST-V001', '1', 'ACACBR', '0101', 5.5, 10.2, 15.3, 1.30, '2020-06-15', NULL, 'Test valid 1'),
(@testFileID1, @testBatchID1, 1, 2, 'SPTEST-V002', '1', 'ACACDR', '0102', 8.2, 12.5, 22.8, 1.30, '2020-06-15', 'M', 'Test valid 2'),
(@testFileID1, @testBatchID1, 1, 2, 'SPTEST-V003', '1', 'ACACET', '0103', 12.1, 18.9, 8.5, 1.30, '2020-06-15', NULL, 'Test valid 3');

SELECT CONCAT('✓ Inserted ', COUNT(*), ' rows into temporarymeasurements') as Status
FROM temporarymeasurements
WHERE FileID = @testFileID1;

-- Step 2: Count before processing
SET @temp_count_before = (SELECT COUNT(*) FROM temporarymeasurements WHERE FileID = @testFileID1);
SELECT CONCAT('Temp records before: ', @temp_count_before) as '';

-- Step 3: Call stored procedure
CALL bulkingestionprocess(@testFileID1, @testBatchID1);

-- Step 4: Verify data moved to coremeasurements
SELECT CONCAT('✓ Processed records. Checking results...') as '';

-- Check if records exist in coremeasurements via stems
SELECT
    CASE
        WHEN COUNT(*) = 3 THEN CONCAT('✅ TEST 1 PASSED: All 3 valid records in coremeasurements (found ', COUNT(*), ')')
        ELSE CONCAT('❌ TEST 1 FAILED: Expected 3 records, found ', COUNT(*))
    END as Result
FROM coremeasurements cm
JOIN stems s ON cm.StemGUID = s.StemGUID
WHERE s.TreeTag LIKE 'SPTEST-V%'
AND cm.CensusID = 2;

-- Show detailed results
SELECT
    s.TreeTag,
    s.StemTag,
    sp.SpeciesCode,
    q.QuadratName,
    cm.MeasuredDBH,
    cm.MeasuredHOM,
    cm.MeasurementDate,
    cm.Description as Codes
FROM coremeasurements cm
JOIN stems s ON cm.StemGUID = s.StemGUID
JOIN species sp ON s.SpeciesID = sp.SpeciesID
JOIN quadrats q ON s.QuadratID = q.QuadratID
WHERE s.TreeTag LIKE 'SPTEST-V%'
AND cm.CensusID = 2
ORDER BY s.TreeTag;

-- Check for data loss
SELECT
    CASE
        WHEN COUNT(*) = 0 THEN '✅ No data loss detected'
        ELSE CONCAT('⚠️  Data loss detected: ', COUNT(*), ' records in uploaddatalossreport')
    END as DataLossCheck
FROM uploaddatalossreport
WHERE FileID = @testFileID1;

-- ============================================================
-- TEST 2: Failed Measurements Processing
-- ============================================================

SELECT '=== TEST 2: Failed Measurements Processing ===' as '';

-- Step 1: Insert invalid data (species doesn't exist)
SET @testFileID2 = 'SPTEST-INVALID-001';
SET @testBatchID2 = UUID();

INSERT INTO temporarymeasurements
(FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
VALUES
(@testFileID2, @testBatchID2, 1, 2, 'SPTEST-I001', '1', 'INVALID_SPECIES_CODE', '0101', 5.5, 10.2, 15.3, 1.30, '2020-06-15', NULL, 'Test invalid species');

-- Step 2: Call procedure (should handle error and move to failedmeasurements)
CALL bulkingestionprocess(@testFileID2, @testBatchID2);

-- Step 3: Verify it went to failedmeasurements
SELECT
    CASE
        WHEN COUNT(*) > 0 THEN CONCAT('✅ TEST 2 PASSED: Invalid record moved to failedmeasurements (', COUNT(*), ' records)')
        ELSE '❌ TEST 2 FAILED: Invalid record not found in failedmeasurements'
    END as Result
FROM failedmeasurements
WHERE FileID = @testFileID2;

-- Show failure details
SELECT Tag, StemTag, SpCode, FailureReason
FROM failedmeasurements
WHERE FileID = @testFileID2
LIMIT 5;

-- ============================================================
-- TEST 3: Mixed Valid/Invalid Data
-- ============================================================

SELECT '=== TEST 3: Mixed Valid/Invalid Data ===' as '';

SET @testFileID3 = 'SPTEST-MIXED-001';
SET @testBatchID3 = UUID();

INSERT INTO temporarymeasurements
(FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
VALUES
(@testFileID3, @testBatchID3, 1, 2, 'SPTEST-M001', '1', 'ACACBR', '0101', 5.5, 10.2, 15.3, 1.30, '2020-06-15', NULL, 'Mixed test valid'),
(@testFileID3, @testBatchID3, 1, 2, 'SPTEST-M002', '1', 'ACACDR', '', 8.2, 12.5, 22.8, 1.30, '2020-06-15', NULL, 'Mixed test missing quadrat'),
(@testFileID3, @testBatchID3, 1, 2, 'SPTEST-M003', '1', 'ACACET', '0103', 12.1, 18.9, -999, 1.30, '2020-06-15', NULL, 'Mixed test invalid DBH');

SELECT CONCAT('✓ Inserted ', COUNT(*), ' mixed records') as Status
FROM temporarymeasurements
WHERE FileID = @testFileID3;

-- Process
CALL bulkingestionprocess(@testFileID3, @testBatchID3);

-- Verify results
SELECT '✓ Checking mixed data results...' as '';

-- Count valid records
SET @valid_count = (
    SELECT COUNT(*)
    FROM coremeasurements cm
    JOIN stems s ON cm.StemGUID = s.StemGUID
    WHERE s.TreeTag LIKE 'SPTEST-M%'
    AND cm.CensusID = 2
);

-- Count failed records
SET @failed_count = (
    SELECT COUNT(*)
    FROM failedmeasurements
    WHERE Tag LIKE 'SPTEST-M%'
    AND CensusID = 2
);

SELECT
    CONCAT('Valid records: ', @valid_count) as '',
    CONCAT('Failed records: ', @failed_count) as '',
    CASE
        WHEN (@valid_count + @failed_count) = 3 THEN '✅ TEST 3 PASSED: All records accounted for (no data loss)'
        ELSE CONCAT('❌ TEST 3 FAILED: Data loss detected. Expected 3 total, got ', (@valid_count + @failed_count))
    END as Result;

-- ============================================================
-- TEST 4: Tree-Stem State Categorization
-- ============================================================

SELECT '=== TEST 4: Tree-Stem State Categorization ===' as '';

SET @testFileID4 = 'SPTEST-STATES-001';
SET @testBatchID4 = UUID();

INSERT INTO temporarymeasurements
(FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
VALUES
(@testFileID4, @testBatchID4, 1, 2, 'SPTEST-S001', '1', 'ACACBR', '0101', 5.5, 10.2, 15.3, 1.30, '2020-06-15', NULL, 'No code - should be valid'),
(@testFileID4, @testBatchID4, 1, 2, 'SPTEST-S002', '1', 'ACACDR', '0102', 8.2, 12.5, 22.8, 1.30, '2020-06-15', 'M', 'Multi-stem - should be pending'),
(@testFileID4, @testBatchID4, 1, 2, 'SPTEST-S003', '1', 'ACACET', '0103', 12.1, 18.9, 8.5, 1.30, '2020-06-15', 'D', 'Dead - should be pending'),
(@testFileID4, @testBatchID4, 1, 2, 'SPTEST-S004', '1', 'ACACGA', '0104', 7.5, 14.2, 12.1, 1.30, '2020-06-15', 'A', 'Needs checking - should be pending');

-- Process
CALL bulkingestionprocess(@testFileID4, @testBatchID4);

-- Check validation states
SELECT
    s.TreeTag,
    cm.Description as Codes,
    cm.IsValidated,
    CASE
        WHEN cm.IsValidated = 1 THEN 'Valid'
        WHEN cm.IsValidated = 0 THEN 'Invalid'
        WHEN cm.IsValidated IS NULL THEN 'Pending'
    END as ValidationState
FROM coremeasurements cm
JOIN stems s ON cm.StemGUID = s.StemGUID
WHERE s.TreeTag LIKE 'SPTEST-S%'
AND cm.CensusID = 2
ORDER BY s.TreeTag;

-- Verify categorization logic
SELECT
    CASE
        WHEN (
            SELECT COUNT(*)
            FROM coremeasurements cm
            JOIN stems s ON cm.StemGUID = s.StemGUID
            WHERE s.TreeTag LIKE 'SPTEST-S%'
            AND cm.CensusID = 2
        ) = 4 THEN '✅ TEST 4 PASSED: All 4 records processed with state categorization'
        ELSE '❌ TEST 4 FAILED: Not all records processed'
    END as Result;

-- ============================================================
-- SUMMARY REPORT
-- ============================================================

SELECT '=== FINAL SUMMARY ===' as '';

SELECT
    'Test 1: Valid Measurements' as Test,
    (SELECT COUNT(*) FROM coremeasurements cm JOIN stems s ON cm.StemGUID = s.StemGUID WHERE s.TreeTag LIKE 'SPTEST-V%') as Records,
    CASE
        WHEN (SELECT COUNT(*) FROM coremeasurements cm JOIN stems s ON cm.StemGUID = s.StemGUID WHERE s.TreeTag LIKE 'SPTEST-V%') = 3
        THEN '✅ PASS'
        ELSE '❌ FAIL'
    END as Status

UNION ALL

SELECT
    'Test 2: Failed Measurements',
    (SELECT COUNT(*) FROM failedmeasurements WHERE FileID = @testFileID2),
    CASE
        WHEN (SELECT COUNT(*) FROM failedmeasurements WHERE FileID = @testFileID2) > 0
        THEN '✅ PASS'
        ELSE '❌ FAIL'
    END

UNION ALL

SELECT
    'Test 3: Mixed Data (No Loss)',
    (@valid_count + @failed_count),
    CASE
        WHEN (@valid_count + @failed_count) = 3
        THEN '✅ PASS'
        ELSE '❌ FAIL'
    END

UNION ALL

SELECT
    'Test 4: State Categorization',
    (SELECT COUNT(*) FROM coremeasurements cm JOIN stems s ON cm.StemGUID = s.StemGUID WHERE s.TreeTag LIKE 'SPTEST-S%'),
    CASE
        WHEN (SELECT COUNT(*) FROM coremeasurements cm JOIN stems s ON cm.StemGUID = s.StemGUID WHERE s.TreeTag LIKE 'SPTEST-S%') = 4
        THEN '✅ PASS'
        ELSE '❌ FAIL'
    END;

-- ============================================================
-- DATA LOSS CHECK
-- ============================================================

SELECT '=== DATA LOSS VERIFICATION ===' as '';

SELECT
    FileID,
    COUNT(*) as LossEvents,
    '⚠️  CRITICAL' as Severity
FROM uploaddatalossreport
WHERE FileID LIKE 'SPTEST%'
GROUP BY FileID

UNION ALL

SELECT
    'No data loss detected',
    0,
    '✅ OK'
WHERE NOT EXISTS (
    SELECT 1 FROM uploaddatalossreport WHERE FileID LIKE 'SPTEST%'
);

-- ============================================================
-- CLEANUP (Run separately after reviewing results)
-- ============================================================
-- Uncomment to clean up test data:
/*
DELETE cm FROM coremeasurements cm
JOIN stems s ON cm.StemGUID = s.StemGUID
WHERE s.TreeTag LIKE 'SPTEST%';

DELETE FROM stems WHERE TreeTag LIKE 'SPTEST%';
DELETE FROM trees WHERE TreeTag LIKE 'SPTEST%';
DELETE FROM failedmeasurements WHERE Tag LIKE 'SPTEST%' OR FileID LIKE 'SPTEST%';
DELETE FROM temporarymeasurements WHERE FileID LIKE 'SPTEST%';

SELECT 'Test data cleaned up' as Status;
*/
