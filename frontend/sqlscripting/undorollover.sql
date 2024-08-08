-- Start transaction to ensure atomicity
START TRANSACTION;

-- Identify the most recent CensusID
SET
@latest_census_id = (SELECT MAX(CensusID) FROM census);

-- Identify quadrat IDs associated with the latest CensusID
SET
@quadrat_ids = (SELECT GROUP_CONCAT(QuadratID) FROM quadrats WHERE CensusID = @latest_census_id);

-- Delete rolled-over data in the quadrats table referenced to the newly created CensusID
DELETE
FROM quadrats
WHERE CensusID = @latest_census_id;

-- Delete rolled-over data in the personnel table referenced to the newly created CensusID
DELETE
FROM personnel
WHERE CensusID = @latest_census_id;

-- Delete rolled-over data in the stems table referenced by the quadrat IDs
DELETE
FROM stems
WHERE FIND_IN_SET(QuadratID, @quadrat_ids);

-- Delete the newly created CensusID from the census table
DELETE
FROM census
WHERE CensusID = @latest_census_id;

-- Reset the auto_increment of the census table to ensure the next row added has the same CensusID as the one removed
SET
@new_auto_increment = @latest_census_id;
SET
@sql = CONCAT('ALTER TABLE census AUTO_INCREMENT = ', @new_auto_increment);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Commit the transaction
COMMIT;
