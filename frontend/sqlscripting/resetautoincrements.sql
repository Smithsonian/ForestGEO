-- Reset auto_increment for plots
SET @max_value = (SELECT IFNULL(MAX(PlotID), 0)
                  FROM plots);
SET @query = CONCAT('ALTER TABLE plots AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- Reset auto_increment for census
SET @max_value = (SELECT IFNULL(MAX(CensusID), 0)
                  FROM census);
SET @query = CONCAT('ALTER TABLE census AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- Reset auto_increment for quadrats
SET @max_value = (SELECT IFNULL(MAX(QuadratID), 0)
                  FROM quadrats);
SET @query = CONCAT('ALTER TABLE quadrats AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Reset auto_increment for reference
SET @max_value = (SELECT IFNULL(MAX(ReferenceID), 0)
                  FROM reference);
SET @query = CONCAT('ALTER TABLE reference AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Reset auto_increment for family
SET @max_value = (SELECT IFNULL(MAX(FamilyID), 0)
                  FROM family);
SET @query = CONCAT('ALTER TABLE family AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Reset auto_increment for genus
SET @max_value = (SELECT IFNULL(MAX(GenusID), 0)
                  FROM genus);
SET @query = CONCAT('ALTER TABLE genus AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Reset auto_increment for roles
SET @max_value = (SELECT IFNULL(MAX(RoleID), 0)
                  FROM roles);
SET @query = CONCAT('ALTER TABLE roles AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Reset auto_increment for personnel
SET @max_value = (SELECT IFNULL(MAX(PersonnelID), 0)
                  FROM personnel);
SET @query = CONCAT('ALTER TABLE personnel AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Reset auto_increment for quadratpersonnel
SET @max_value = (SELECT IFNULL(MAX(QuadratPersonnelID), 0)
                  FROM quadratpersonnel);
SET @query = CONCAT('ALTER TABLE quadratpersonnel AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Reset auto_increment for species
SET @max_value = (SELECT IFNULL(MAX(SpeciesID), 0)
                  FROM species);
SET @query = CONCAT('ALTER TABLE species AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Reset auto_increment for specieslimits
SET @max_value = (SELECT IFNULL(MAX(SpeciesLimitID), 0)
                  FROM specieslimits);
SET @query = CONCAT('ALTER TABLE specieslimits AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Reset auto_increment for subquadrats
SET @max_value = (SELECT IFNULL(MAX(SubquadratID), 0)
                  FROM subquadrats);
SET @query = CONCAT('ALTER TABLE subquadrats AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Reset auto_increment for trees
SET @max_value = (SELECT IFNULL(MAX(TreeID), 0)
                  FROM trees);
SET @query = CONCAT('ALTER TABLE trees AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Reset auto_increment for stems
SET @max_value = (SELECT IFNULL(MAX(StemID), 0)
                  FROM stems);
SET @query = CONCAT('ALTER TABLE stems AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Reset auto_increment for coremeasurements
SET @max_value = (SELECT IFNULL(MAX(CoreMeasurementID), 0)
                  FROM coremeasurements);
SET @query = CONCAT('ALTER TABLE coremeasurements AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Reset auto_increment for cmattributes
SET @max_value = (SELECT IFNULL(MAX(CMAID), 0)
                  FROM cmattributes);
SET @query = CONCAT('ALTER TABLE cmattributes AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Reset auto_increment for cmverrors
SET @max_value = (SELECT IFNULL(MAX(CMVErrorID), 0)
                  FROM cmverrors);
SET @query = CONCAT('ALTER TABLE cmverrors AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Reset auto_increment for specimens
SET @max_value = (SELECT IFNULL(MAX(SpecimenID), 0)
                  FROM specimens);
SET @query = CONCAT('ALTER TABLE specimens AUTO_INCREMENT = ', @max_value + 1);
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Reset auto_increment for unifiedchangelog
# SET @max_value = (SELECT IFNULL(MAX(ChangeID), 0) FROM unifiedchangelog);
# SET @query = CONCAT('ALTER TABLE unifiedchangelog AUTO_INCREMENT = ', @max_value + 1);
# PREPARE stmt FROM @query;
# EXECUTE stmt;
# DEALLOCATE PREPARE stmt;

truncate table unifiedchangelog;

-- Reset auto_increment for validationchangelog
# SET @max_value = (SELECT IFNULL(MAX(ValidationRunID), 0) FROM validationchangelog);
# SET @new_auto_increment = @max_value + 1;
# ALTER TABLE validationchangelog AUTO_INCREMENT = @new_auto_increment;
truncate table validationchangelog;

-- Reset auto_increment for viewfulltable
CALL RefreshViewFullTable();

CALL RefreshMeasurementsSummary();