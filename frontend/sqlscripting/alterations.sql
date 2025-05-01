-- 0) turn off foreign-key checks
SET FOREIGN_KEY_CHECKS = 0;

-- 1) ── attributes ── change PK to (Code,IsActive)
ALTER TABLE attributes
    ADD COLUMN IsActive  TINYINT(1) NOT NULL DEFAULT 1 AFTER Status,
    ADD COLUMN DeletedAt DATETIME   NULL AFTER IsActive,
    DROP PRIMARY KEY,
    ADD PRIMARY KEY (Code, IsActive);

-- 2) ── census ── add IsActive/DeletedAt
ALTER TABLE census
    ADD COLUMN IsActive  TINYINT(1) NOT NULL DEFAULT 1 AFTER PlotCensusNumber,
    ADD COLUMN DeletedAt DATETIME   NULL AFTER IsActive;

-- 3) ── family ── dedupe then add IsActive/DeletedAt + tighten unique
DELETE f1
FROM family f1
         JOIN family f2
              ON f1.Family = f2.Family
                  AND f1.FamilyID > f2.FamilyID;

ALTER TABLE family
    ADD COLUMN IsActive  TINYINT(1) NOT NULL DEFAULT 1 AFTER ReferenceID,
    ADD COLUMN DeletedAt DATETIME   NULL AFTER IsActive,
    DROP INDEX unique_families,
    ADD UNIQUE KEY unique_families (Family, IsActive);

-- 4) ── genus ── dedupe then add IsActive/DeletedAt + tighten unique
DELETE g1
FROM genus g1
         JOIN genus g2
              ON g1.Genus = g2.Genus
                  AND g1.GenusID > g2.GenusID;

ALTER TABLE genus
    ADD COLUMN IsActive  TINYINT(1) NOT NULL DEFAULT 1 AFTER ReferenceID,
    ADD COLUMN DeletedAt DATETIME   NULL AFTER IsActive,
    DROP INDEX unique_genus,
    ADD UNIQUE KEY unique_genus (Genus, IsActive);

-- 5) ── roles ── dedupe then add IsActive/DeletedAt + tighten unique
DELETE r1
FROM roles r1
         JOIN roles r2
              ON r1.RoleName = r2.RoleName
                  AND r1.RoleID > r2.RoleID;

ALTER TABLE roles
    ADD COLUMN IsActive  TINYINT(1) NOT NULL DEFAULT 1 AFTER RoleDescription,
    ADD COLUMN DeletedAt DATETIME   NULL AFTER IsActive,
    DROP INDEX unique_roles,
    ADD UNIQUE KEY unique_roles (RoleName, IsActive);

-- 6) ── personnel → split into censuspersonnel ──
-- 6a) dedupe personnel by name (keep lowest ID per first+last)
DELETE p1
FROM personnel p1
         JOIN personnel p2
              ON p1.FirstName = p2.FirstName
                  AND p1.LastName = p2.LastName
                  AND p1.PersonnelID > p2.PersonnelID;

-- 6b) create new censuspersonnel
CREATE TABLE IF NOT EXISTS censuspersonnel
(
    CPID        INT AUTO_INCREMENT PRIMARY KEY,
    PersonnelID INT NOT NULL,
    CensusID    INT NOT NULL,
    UNIQUE KEY uq_personnel_census (PersonnelID, CensusID),
    FOREIGN KEY (PersonnelID) REFERENCES personnel (PersonnelID),
    FOREIGN KEY (CensusID) REFERENCES census (CensusID)
);

-- 6c) migrate old links (ignoring duplicates)
INSERT IGNORE INTO censuspersonnel (PersonnelID, CensusID)
SELECT PersonnelID, CensusID
FROM personnel
WHERE CensusID IS NOT NULL;

insert into censusattributes (Code, CensusID)
SELECT a.Code, c.CensusID
from attributes a
cross join census c;

-- 6d) drop old CensusID col, add active flags + new unique
ALTER TABLE personnel
    DROP FOREIGN KEY personnel_census_CensusID_fk,
    DROP INDEX unique_full_name_per_census,
    DROP COLUMN CensusID,
    ADD COLUMN IsActive  TINYINT(1) NOT NULL DEFAULT 1 AFTER RoleID,
    ADD COLUMN DeletedAt DATETIME   NULL AFTER IsActive,
    ADD UNIQUE KEY personnel_name_active (FirstName, LastName, IsActive);

-- 7) ── trees ── dedupe then add IsActive/DeletedAt + tighten unique
DELETE t1
FROM trees t1
         JOIN trees t2
              ON t1.TreeTag = t2.TreeTag
                  AND t1.TreeID > t2.TreeID;

ALTER TABLE trees
    ADD COLUMN IsActive  TINYINT(1) NOT NULL DEFAULT 1 AFTER SpeciesID,
    ADD COLUMN DeletedAt DATETIME   NULL AFTER IsActive,
#   DROP INDEX trees_TreeTag_index,
    ADD UNIQUE KEY trees_TreeTag_active (TreeTag, IsActive);

-- 8) ── stems ── dedupe then add IsActive/DeletedAt + tighten unique
DELETE s1
FROM stems s1
         JOIN stems s2
              ON s1.StemTag = s2.StemTag
                  AND s1.TreeID = s2.TreeID
                  AND s1.QuadratID = s2.QuadratID
                  AND s1.LocalX = s2.LocalX
                  AND s1.LocalY = s2.LocalY
                  AND s1.StemID > s2.StemID;

ALTER TABLE stems
    ADD COLUMN IsActive  TINYINT(1) NOT NULL DEFAULT 1 AFTER StemDescription,
    ADD COLUMN DeletedAt DATETIME   NULL AFTER IsActive,
    DROP INDEX unique_stem_coordinates,
    ADD UNIQUE KEY unique_stem_coords_active
        (StemTag, TreeID, QuadratID, LocalX, LocalY, IsActive);

-- 9) ── coremeasurements & specimens ── just add soft-delete flags
ALTER TABLE coremeasurements
    ADD COLUMN IsActive  TINYINT(1) NOT NULL DEFAULT 1 AFTER UserDefinedFields,
    ADD COLUMN DeletedAt DATETIME   NULL AFTER IsActive;

ALTER TABLE specimens
    ADD COLUMN IsActive  TINYINT(1) NOT NULL DEFAULT 1 AFTER Description,
    ADD COLUMN DeletedAt DATETIME   NULL AFTER IsActive;

-- 10) ── species ── dedupe then add IsActive/DeletedAt + tighten unique
DELETE s1
FROM species s1
         JOIN species s2
              ON s1.SpeciesCode = s2.SpeciesCode
                  AND s1.SpeciesID > s2.SpeciesID;

ALTER TABLE species
    ADD COLUMN IsActive  TINYINT(1) NOT NULL DEFAULT 1 AFTER ReferenceID,
    ADD COLUMN DeletedAt DATETIME   NULL AFTER IsActive,
#   DROP INDEX species_SpeciesCode_uindex,
    DROP INDEX SpeciesCode,
    ADD UNIQUE KEY species_code_active (SpeciesCode, IsActive),
    ADD UNIQUE KEY species_code_name_active
        (SpeciesCode, SpeciesName, SubspeciesName, IsActive);

-- 11) ── create censusspecies join table
CREATE TABLE IF NOT EXISTS censusspecies
(
    CSID      INT AUTO_INCREMENT PRIMARY KEY,
    SpeciesID INT NOT NULL,
    CensusID  INT NOT NULL,
    UNIQUE KEY uq_species_census (SpeciesID, CensusID),
    FOREIGN KEY (SpeciesID) REFERENCES species (SpeciesID),
    FOREIGN KEY (CensusID) REFERENCES census (CensusID)
);

-- 12) ── specieslimits ── add soft-delete flags
ALTER TABLE specieslimits
    ADD COLUMN IsActive  TINYINT(1) NOT NULL DEFAULT 1 AFTER LowerBound,
    ADD COLUMN DeletedAt DATETIME   NULL AFTER IsActive;

-- 13) ── create censusattributes join table
CREATE TABLE IF NOT EXISTS censusattributes
(
    CAID     INT AUTO_INCREMENT PRIMARY KEY,
    Code     VARCHAR(10) NOT NULL,
    CensusID INT         NOT NULL,
    UNIQUE KEY uq_code_census (Code, CensusID),
    FOREIGN KEY (Code) REFERENCES attributes (Code),
    FOREIGN KEY (CensusID) REFERENCES census (CensusID)
);

-- 14) ── the rest of your tables already match schema B, so no change needed

-- 15) turn foreign-key checks back on
SET FOREIGN_KEY_CHECKS = 1;
