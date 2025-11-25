-- Test script to verify dead stem validation exclusion
-- This inserts test data to verify that dead stems with null coordinates are NOT flagged

USE forestgeo_testing;

-- Insert test stems with null coordinates
-- Test 1: Dead stem (DN) with null coordinates - should NOT be flagged
INSERT INTO stems (StemGUID, TreeGUID, QuadratID, StemNumber, LocalX, LocalY, Codes, IsActive, CensusID)
VALUES
    (UUID(), (SELECT TreeGUID FROM trees WHERE TreeTag = '10001' LIMIT 1), 1, 1, NULL, NULL, 'DN', TRUE, 1);

-- Test 2: Living stem (LI) with null coordinates - SHOULD be flagged
INSERT INTO stems (StemGUID, TreeGUID, QuadratID, StemNumber, LocalX, LocalY, Codes, IsActive, CensusID)
VALUES
    (UUID(), (SELECT TreeGUID FROM trees WHERE TreeTag = '10002' LIMIT 1), 1, 1, NULL, NULL, 'LI', TRUE, 1);

-- Test 3: Standing dead (DS) with null coordinates - should NOT be flagged
INSERT INTO stems (StemGUID, TreeGUID, QuadratID, StemNumber, LocalX, LocalY, Codes, IsActive, CensusID)
VALUES
    (UUID(), (SELECT TreeGUID FROM trees WHERE TreeTag = '10003' LIMIT 1), 1, 1, NULL, NULL, 'DS', TRUE, 1);

-- Insert corresponding core measurements
INSERT INTO coremeasurements (CoreMeasurementID, CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description, UserDefinedFields, IsActive)
SELECT
    UUID(),
    1,
    s.StemGUID,
    NULL,
    '2008-02-04',
    10.0,
    1.3,
    'Test measurement',
    '',
    TRUE
FROM stems s
WHERE s.CensusID = 1 AND s.Codes IN ('DN', 'LI', 'DS')
AND NOT EXISTS (SELECT 1 FROM coremeasurements cm WHERE cm.StemGUID = s.StemGUID);

-- Insert attributes for the measurements
INSERT INTO cmattributes (CoreMeasurementID, Code)
SELECT cm.CoreMeasurementID, s.Codes
FROM coremeasurements cm
JOIN stems s ON cm.StemGUID = s.StemGUID
WHERE s.Codes IN ('DN', 'LI', 'DS')
AND NOT EXISTS (SELECT 1 FROM cmattributes cma WHERE cma.CoreMeasurementID = cm.CoreMeasurementID);

-- Show what we inserted
SELECT
    t.TreeTag,
    s.StemNumber,
    s.LocalX,
    s.LocalY,
    s.Codes as StemCode,
    a.Status as AttributeStatus
FROM stems s
JOIN trees t ON s.TreeGUID = t.TreeGUID
LEFT JOIN attributes a ON s.Codes = a.Code
WHERE s.CensusID = 1 AND s.Codes IN ('DN', 'LI', 'DS')
ORDER BY t.TreeTag;
