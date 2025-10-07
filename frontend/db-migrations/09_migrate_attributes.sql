-- ================================================================
-- Migration Script 09: Migrate Attributes
-- ================================================================
-- Purpose: Migrate attribute codes and link them to measurements
-- Uses stable_mpala.tsmattributes for attribute definitions
-- Parses ListOfTSM field from viewfulltable to create attribute links
-- Also handles Status field
-- ================================================================

USE forestgeo_testing;

-- ================================================================
-- STEP 1: Populate Attributes Table
-- ================================================================
-- Migrate attributes from tsmattributes table
INSERT INTO attributes (
    Code,
    Description,
    Status,
    IsActive
)
SELECT DISTINCT
    tsm.TSMCode AS Code,
    tsm.Description,
    -- Map status from tsmattributes to the enum in forestgeo_testing
    CASE
        WHEN tsm.Status = 'alive' THEN 'alive'
        WHEN tsm.Status = 'dead' THEN 'dead'
        WHEN tsm.Status LIKE '%dead%' THEN 'dead'
        WHEN tsm.Status LIKE '%broken below%' THEN 'broken below'
        WHEN tsm.Status LIKE '%missing%' THEN 'missing'
        ELSE 'alive'  -- Default to alive for unmapped statuses
    END AS Status,
    1 AS IsActive
FROM stable_mpala.tsmattributes tsm
WHERE tsm.TSMCode IS NOT NULL AND tsm.TSMCode != '';

SELECT 'Attributes populated' AS Status, COUNT(*) AS AttributeCount FROM attributes;

-- ================================================================
-- STEP 2: Create temporary table to parse ListOfTSM
-- ================================================================
-- This table will help us link TSM codes from ListOfTSM to measurements
DROP TEMPORARY TABLE IF EXISTS temp_tsm_links;

CREATE TEMPORARY TABLE temp_tsm_links (
    old_DBHID INT,
    TSMCode VARCHAR(10),
    old_StemID INT,
    old_CensusID INT,
    INDEX idx_dbhid (old_DBHID),
    INDEX idx_stem (old_StemID),
    INDEX idx_code (TSMCode)
);

-- Parse ListOfTSM field (comma-separated codes) and insert into temp table
-- Note: This is a simplified approach - for complex parsing, may need application code
INSERT INTO temp_tsm_links (old_DBHID, TSMCode, old_StemID, old_CensusID)
SELECT DISTINCT
    v.DBHID AS old_DBHID,
    TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(v.ListOfTSM, ',', numbers.n), ',', -1)) AS TSMCode,
    v.StemID AS old_StemID,
    v.CensusID AS old_CensusID
FROM stable_mpala.viewfulltable v
CROSS JOIN (
    SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
    UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10
) numbers
WHERE v.ListOfTSM IS NOT NULL
    AND CHAR_LENGTH(v.ListOfTSM) > 0
    AND numbers.n <= 1 + CHAR_LENGTH(v.ListOfTSM) - CHAR_LENGTH(REPLACE(v.ListOfTSM, ',', ''))
    AND TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(v.ListOfTSM, ',', numbers.n), ',', -1)) != '';

SELECT 'TSM codes parsed from ListOfTSM' AS Status, COUNT(*) AS LinkCount FROM temp_tsm_links;

-- ================================================================
-- STEP 3: Link Attributes to Core Measurements
-- ================================================================
-- Link parsed TSM codes to measurements via cmattributes
INSERT INTO cmattributes (
    CoreMeasurementID,
    Code
)
SELECT DISTINCT
    cm.CoreMeasurementID,
    ttl.TSMCode AS Code
FROM temp_tsm_links ttl
JOIN id_map_stems s_map ON ttl.old_StemID = s_map.old_StemID
JOIN id_map_census c_map ON ttl.old_CensusID = c_map.old_CensusID
JOIN coremeasurements cm ON
    cm.StemGUID = s_map.new_StemGUID
    AND cm.CensusID = c_map.new_CensusID
JOIN attributes a ON a.Code = ttl.TSMCode
WHERE ttl.TSMCode IS NOT NULL AND ttl.TSMCode != '';

SELECT 'Attributes linked to measurements' AS Status, COUNT(*) AS LinkCount FROM cmattributes;

-- ================================================================
-- STEP 4: Add Status as an attribute if not already captured
-- ================================================================
-- Create a mapping for status codes if they don't exist
INSERT IGNORE INTO attributes (Code, Description, Status, IsActive)
VALUES
    ('ALIVE', 'Tree/Stem is alive', 'alive', 1),
    ('DEAD', 'Tree/Stem is dead', 'dead', 1),
    ('STEM_DEAD', 'Stem is dead', 'stem dead', 1),
    ('BROKEN_BELOW', 'Broken below measurement height', 'broken below', 1),
    ('OMITTED', 'Measurement omitted', 'omitted', 1),
    ('MISSING', 'Tree/Stem is missing', 'missing', 1);

-- Link status codes to measurements based on viewfulltable.Status
INSERT INTO cmattributes (CoreMeasurementID, Code)
SELECT DISTINCT
    cm.CoreMeasurementID,
    CASE v.Status
        WHEN 'alive' THEN 'ALIVE'
        WHEN 'dead' THEN 'DEAD'
        WHEN 'stem dead' THEN 'STEM_DEAD'
        WHEN 'broken below' THEN 'BROKEN_BELOW'
        WHEN 'omitted' THEN 'OMITTED'
        WHEN 'missing' THEN 'MISSING'
        ELSE 'ALIVE'
    END AS Code
FROM stable_mpala.viewfulltable v
JOIN stable_mpala.dbh sdbh ON v.DBHID = sdbh.DBHID
JOIN id_map_stems s_map ON sdbh.StemID = s_map.old_StemID
JOIN id_map_census c_map ON sdbh.CensusID = c_map.old_CensusID
JOIN coremeasurements cm ON
    cm.StemGUID = s_map.new_StemGUID
    AND cm.CensusID = c_map.new_CensusID
WHERE v.Status IS NOT NULL
    AND NOT EXISTS (
        -- Avoid duplicates
        SELECT 1 FROM cmattributes cma
        WHERE cma.CoreMeasurementID = cm.CoreMeasurementID
            AND cma.Code = CASE v.Status
                WHEN 'alive' THEN 'ALIVE'
                WHEN 'dead' THEN 'DEAD'
                WHEN 'stem dead' THEN 'STEM_DEAD'
                WHEN 'broken below' THEN 'BROKEN_BELOW'
                WHEN 'omitted' THEN 'OMITTED'
                WHEN 'missing' THEN 'MISSING'
                ELSE 'ALIVE'
            END
    );

-- ================================================================
-- Validation Queries
-- ================================================================
SELECT
    'Attributes Migration Summary' AS Description,
    (SELECT COUNT(*) FROM attributes) AS TotalAttributes,
    (SELECT COUNT(*) FROM cmattributes) AS TotalAttributeLinks,
    (SELECT COUNT(DISTINCT CoreMeasurementID) FROM cmattributes) AS MeasurementsWithAttributes;

-- Check attribute distribution
SELECT
    a.Code,
    a.Description,
    a.Status,
    COUNT(cma.CoreMeasurementID) AS UsageCount
FROM attributes a
LEFT JOIN cmattributes cma ON a.Code = cma.Code
GROUP BY a.Code, a.Description, a.Status
ORDER BY UsageCount DESC;

-- Check measurements without attributes
SELECT
    'Measurements without attributes' AS Warning,
    COUNT(*) AS Count
FROM coremeasurements cm
WHERE NOT EXISTS (
    SELECT 1 FROM cmattributes cma WHERE cma.CoreMeasurementID = cm.CoreMeasurementID
);

-- Sample of measurements with their attributes
SELECT
    p.PlotName,
    t.TreeTag,
    sp.SpeciesCode,
    cm.MeasuredDBH,
    GROUP_CONCAT(a.Code ORDER BY a.Code SEPARATOR ', ') AS Attributes
FROM coremeasurements cm
JOIN stems st ON cm.StemGUID = st.StemGUID
JOIN trees t ON st.TreeID = t.TreeID
JOIN species sp ON t.SpeciesID = sp.SpeciesID
JOIN quadrats q ON st.QuadratID = q.QuadratID
JOIN plots p ON q.PlotID = p.PlotID
LEFT JOIN cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
LEFT JOIN attributes a ON cma.Code = a.Code
GROUP BY p.PlotName, t.TreeTag, sp.SpeciesCode, cm.MeasuredDBH
ORDER BY cm.CoreMeasurementID
LIMIT 20;

-- Clean up temporary table
DROP TEMPORARY TABLE IF EXISTS temp_tsm_links;
