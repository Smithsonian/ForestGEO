-- =====================================================
-- COMPREHENSIVE CROSS-CENSUS VALIDATION TESTS
-- Tests all 4 new validation rules
-- =====================================================

USE forestgeo_testing;

-- Cleanup first
DELETE cm FROM coremeasurements cm
JOIN stems s ON cm.StemGUID = s.StemGUID
JOIN trees t ON s.TreeID = t.TreeID
WHERE t.TreeTag LIKE 'TEST-CROSS-%';

DELETE FROM stems WHERE TreeID IN (SELECT TreeID FROM trees WHERE TreeTag LIKE 'TEST-CROSS-%');
DELETE FROM trees WHERE TreeTag LIKE 'TEST-CROSS-%';
DELETE FROM failedmeasurements WHERE Tag LIKE 'TEST-CROSS-%';
DELETE FROM temporarymeasurements WHERE TreeTag LIKE 'TEST-CROSS-%';
DELETE FROM uploadintegrityalerts WHERE fileID = 'test-cross-census';
DELETE FROM cmverrors WHERE CoreMeasurementID IN (
    SELECT cm.CoreMeasurementID FROM coremeasurements cm
    JOIN stems s ON cm.StemGUID = s.StemGUID
    JOIN trees t ON s.TreeID = t.TreeID
    WHERE t.TreeTag LIKE 'TEST-CROSS-%'
);

SELECT '✅ Cleanup complete' as Status;

-- =====================================================
-- SETUP: Census 1 Data (Baseline)
-- =====================================================

-- Create baseline trees in Census 1
INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive)
VALUES
  ('TEST-CROSS-QUADRAT', 10, 1, 1),    -- For quadrat change test
  ('TEST-CROSS-DRIFT', 10, 1, 1),      -- For coordinate drift test
  ('TEST-CROSS-SPECIES', 10, 1, 1),    -- For species mismatch test
  ('TEST-CROSS-BATCH', 10, 1, 1);      -- For same-batch species conflict test

-- Create stems for Census 1
INSERT INTO stems (TreeID, StemTag, QuadratID, LocalX, LocalY, CensusID, IsActive)
SELECT t.TreeID, '1', 1, 5.5, 10.2, 1, 1
FROM trees t
WHERE t.TreeTag IN ('TEST-CROSS-QUADRAT', 'TEST-CROSS-DRIFT', 'TEST-CROSS-SPECIES', 'TEST-CROSS-BATCH')
  AND t.CensusID = 1;

-- Create measurements for Census 1
INSERT INTO coremeasurements (CensusID, StemGUID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsActive)
SELECT 1, s.StemGUID, 15.3, 1.30, '2020-06-15', 1
FROM stems s
JOIN trees t ON s.TreeID = t.TreeID
WHERE t.TreeTag IN ('TEST-CROSS-QUADRAT', 'TEST-CROSS-DRIFT', 'TEST-CROSS-SPECIES', 'TEST-CROSS-BATCH')
  AND s.CensusID = 1;

SELECT '✅ Census 1 baseline data created' as Status;

-- =====================================================
-- TEST 1: Quadrat Change Detection (HARD FAILURE)
-- =====================================================

INSERT INTO temporarymeasurements (
    FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode,
    QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Comments
)
VALUES
    ('test-cross-census', 'batch-1', 1, 2, 'TEST-CROSS-QUADRAT', '1', 'ACACBR',
     '0102', 25.5, 30.2, 17.3, 1.30, '2021-06-15',  -- Changed from quadrat 0101 to 0102
     'TEST 1: Should FAIL - tree changed quadrats');

SELECT '✅ Test 1: Quadrat change data inserted' as Status;

-- =====================================================
-- TEST 2: Coordinate Drift Detection (HARD FAILURE)
-- =====================================================

INSERT INTO temporarymeasurements (
    FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode,
    QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Comments
)
VALUES
    ('test-cross-census', 'batch-1', 1, 2, 'TEST-CROSS-DRIFT', '1', 'ACACBR',
     '0101', 15.5, 20.2, 18.5, 1.30, '2021-06-15',  -- Coordinates drifted 14.14m (>10m threshold)
     'TEST 2: Should FAIL - coordinates drifted >10m');

SELECT '✅ Test 2: Coordinate drift data inserted' as Status;

-- =====================================================
-- TEST 3: Species Mismatch Detection (SOFT - Accept but Flag)
-- =====================================================

INSERT INTO temporarymeasurements (
    FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode,
    QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Comments
)
VALUES
    ('test-cross-census', 'batch-1', 1, 2, 'TEST-CROSS-SPECIES', '1', 'ACACDR',  -- Changed from ACACBR to ACACDR
     '0101', 5.5, 10.2, 18.0, 1.30, '2021-06-15',
     'TEST 3: Should ACCEPT but FLAG ValidationErrorID=20 - species changed');

SELECT '✅ Test 3: Species mismatch data inserted' as Status;

-- =====================================================
-- TEST 4: Same-Batch Species Conflict (SOFT - Accept but Flag)
-- =====================================================

-- First row with ACACBR (should be treated as correct)
INSERT INTO temporarymeasurements (
    FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode,
    QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Comments
)
VALUES
    ('test-cross-census', 'batch-1', 1, 2, 'TEST-CROSS-BATCH', '1', 'ACACBR',
     '0101', 5.5, 10.2, 19.0, 1.30, '2021-06-15',
     'TEST 4a: First occurrence - should be treated as correct'),
    ('test-cross-census', 'batch-1', 1, 2, 'TEST-CROSS-BATCH', '2', 'ACACDR',  -- Different species
     '0101', 6.0, 11.0, 14.5, 1.30, '2021-06-15',
     'TEST 4b: Should ACCEPT but FLAG ValidationErrorID=21 - different species in same batch');

SELECT '✅ Test 4: Same-batch species conflict data inserted' as Status;

-- =====================================================
-- RUN THE PROCEDURE
-- =====================================================

SELECT '🚀 Running bulkingestionprocess...' as Status;

CALL bulkingestionprocess('test-cross-census', 'batch-1');

SELECT '✅ Procedure completed' as Status;

-- =====================================================
-- VERIFY RESULTS
-- =====================================================

-- Test 1 & 2: Should be in failedmeasurements (HARD FAILURES)
SELECT
    '=== HARD FAILURES (should be in failedmeasurements) ===' as TestSection,
    Tag, StemTag, Quadrat, X, Y,
    CASE
        WHEN FailureReasons LIKE '%Quadrat mismatch%' THEN '✅ TEST 1 PASSED'
        WHEN FailureReasons LIKE '%Coordinate drift%' THEN '✅ TEST 2 PASSED'
        ELSE '❌ UNEXPECTED'
    END as Result,
    LEFT(FailureReasons, 100) as FailureReason
FROM failedmeasurements
WHERE Tag LIKE 'TEST-CROSS-%'
ORDER BY Tag;

-- Test 3 & 4: Should be in coremeasurements (SOFT VALIDATIONS)
SELECT
    '=== SOFT VALIDATIONS (should be in coremeasurements) ===' as TestSection,
    t.TreeTag, s.StemTag, sp.SpeciesCode,
    cm.MeasuredDBH,
    CASE
        WHEN EXISTS(SELECT 1 FROM cmverrors WHERE CoreMeasurementID = cm.CoreMeasurementID AND ValidationErrorID = 20)
            THEN '✅ TEST 3 PASSED (ValidationErrorID=20)'
        WHEN EXISTS(SELECT 1 FROM cmverrors WHERE CoreMeasurementID = cm.CoreMeasurementID AND ValidationErrorID = 21)
            THEN '✅ TEST 4 PASSED (ValidationErrorID=21)'
        ELSE 'NO VALIDATION ERROR'
    END as Result
FROM coremeasurements cm
JOIN stems s ON cm.StemGUID = s.StemGUID
JOIN trees t ON s.TreeID = t.TreeID
JOIN species sp ON t.SpeciesID = sp.SpeciesID
WHERE t.TreeTag LIKE 'TEST-CROSS-%'
  AND cm.CensusID = 2
ORDER BY t.TreeTag, s.StemTag;

-- Check validation errors detail
SELECT
    '=== Validation Errors Detail ===' as TestSection,
    t.TreeTag, s.StemTag, ve.ValidationErrorID,
    CASE ve.ValidationErrorID
        WHEN 20 THEN 'Species Mismatch'
        WHEN 21 THEN 'Same-Batch Species Conflict'
        ELSE 'Unknown'
    END as ValidationErrorType
FROM cmverrors ve
JOIN coremeasurements cm ON ve.CoreMeasurementID = cm.CoreMeasurementID
JOIN stems s ON cm.StemGUID = s.StemGUID
JOIN trees t ON s.TreeID = t.TreeID
WHERE t.TreeTag LIKE 'TEST-CROSS-%'
  AND cm.CensusID = 2
ORDER BY t.TreeTag, s.StemTag;

-- Check uploadintegrityalerts
SELECT
    '=== Upload Integrity Alerts ===' as TestSection,
    type, severity, message
FROM uploadintegrityalerts
WHERE fileID = 'test-cross-census'
ORDER BY type;

-- Final Summary
SELECT
    '=== FINAL SUMMARY ===' as TestSection,
    (SELECT COUNT(*) FROM failedmeasurements WHERE Tag LIKE 'TEST-CROSS-%') as HardFailures_Expected_2,
    (SELECT COUNT(*) FROM coremeasurements cm
     JOIN stems s ON cm.StemGUID = s.StemGUID
     JOIN trees t ON s.TreeID = t.TreeID
     WHERE t.TreeTag LIKE 'TEST-CROSS-%' AND cm.CensusID = 2) as SoftValidations_Expected_2,
    (SELECT COUNT(*) FROM cmverrors ve
     JOIN coremeasurements cm ON ve.CoreMeasurementID = cm.CoreMeasurementID
     JOIN stems s ON cm.StemGUID = s.StemGUID
     JOIN trees t ON s.TreeID = t.TreeID
     WHERE t.TreeTag LIKE 'TEST-CROSS-%' AND ve.ValidationErrorID IN (20, 21)) as ValidationErrors_Expected_2,
    CASE
        WHEN (SELECT COUNT(*) FROM failedmeasurements WHERE Tag LIKE 'TEST-CROSS-%') = 2
         AND (SELECT COUNT(*) FROM coremeasurements cm
              JOIN stems s ON cm.StemGUID = s.StemGUID
              JOIN trees t ON s.TreeID = t.TreeID
              WHERE t.TreeTag LIKE 'TEST-CROSS-%' AND cm.CensusID = 2) = 2
         AND (SELECT COUNT(*) FROM cmverrors ve
              JOIN coremeasurements cm ON ve.CoreMeasurementID = cm.CoreMeasurementID
              JOIN stems s ON cm.StemGUID = s.StemGUID
              JOIN trees t ON s.TreeID = t.TreeID
              WHERE t.TreeTag LIKE 'TEST-CROSS-%' AND ve.ValidationErrorID IN (20, 21)) = 2
        THEN '✅ ALL TESTS PASSED'
        ELSE '❌ SOME TESTS FAILED'
    END as OverallResult;

SELECT '✅ Test complete - Review results above' as Status;
