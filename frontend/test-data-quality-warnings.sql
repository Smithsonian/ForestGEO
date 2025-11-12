-- Test Data Quality Warnings
-- This script tests the three new warning-level validations

-- Clean up test data first
DELETE cm FROM coremeasurements cm
JOIN stems s ON cm.StemGUID = s.StemGUID
JOIN trees t ON s.TreeID = t.TreeID
WHERE t.TreeTag LIKE 'TEST-WARN%';

DELETE FROM stems WHERE TreeID IN (SELECT TreeID FROM trees WHERE TreeTag LIKE 'TEST-WARN%');
DELETE FROM trees WHERE TreeTag LIKE 'TEST-WARN%';
DELETE FROM failedmeasurements WHERE Tag LIKE 'TEST-WARN%';
DELETE FROM temporarymeasurements WHERE TreeTag LIKE 'TEST-WARN%';
DELETE FROM uploadintegrityalerts WHERE fileID = 'test-warnings';

SELECT '✅ Cleanup complete' as Status;

-- Insert test data for warnings
INSERT INTO temporarymeasurements (TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Comments, FileID, BatchID, PlotID, CensusID)
VALUES
-- Same tree/stem/date with different DBH values (should trigger warning 1)
('TEST-WARN-1', '1', 'ACACBR', '0101', 5.5, 10.2, 15.3, 1.30, '2020-06-15', 'First measurement', 'test-warnings', 'batch-1', 1, 2),
('TEST-WARN-1', '1', 'ACACBR', '0101', 5.5, 10.2, 16.5, 1.30, '2020-06-15', 'Second measurement - different DBH same date', 'test-warnings', 'batch-1', 1, 2),
-- Future date (should trigger warning 2)
('TEST-WARN-2', '1', 'ACACBR', '0101', 6.0, 11.0, 20.5, 1.30, '2099-12-31', 'Future date measurement', 'test-warnings', 'batch-1', 1, 2),
-- Normal valid record
('TEST-WARN-3', '1', 'ACACBR', '0101', 7.0, 12.0, 25.0, 1.30, '2020-06-20', 'Normal measurement', 'test-warnings', 'batch-1', 1, 2);

SELECT '✅ Test data inserted (4 records)' as Status;

-- Run the procedure
CALL bulkingestionprocess('test-warnings', 'batch-1');

-- Check results
SELECT
    (SELECT COUNT(*) FROM coremeasurements cm
     JOIN stems s ON cm.StemGUID = s.StemGUID
     JOIN trees t ON s.TreeID = t.TreeID
     WHERE t.TreeTag LIKE 'TEST-WARN%') as ValidRecords,
    (SELECT COUNT(*) FROM failedmeasurements WHERE Tag LIKE 'TEST-WARN%') as FailedRecords;

-- Check for data quality warnings in uploadintegrityalerts
SELECT
    type,
    message,
    severity,
    processedRecords
FROM uploadintegrityalerts
WHERE fileID = 'test-warnings'
  AND severity = 'info'
ORDER BY type;

SELECT '✅ Test complete - Check warnings above' as Status;
