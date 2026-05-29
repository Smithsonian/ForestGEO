-- Seed fixture for checkFinishedCensus precondition integration tests.
--
-- Targets the app schema (tablestructures.sql).
-- Populates one fully-valid measurement that passes all 8 precondition checks,
-- plus all the reference data those checks require.
--
-- Exact column names confirmed against tablestructures.sql.
-- Table creation order respects FK constraints.

SET FOREIGN_KEY_CHECKS = 0;

-- plots: PlotID=1
INSERT INTO plots (PlotID, PlotName) VALUES (1, 'Test Plot');

-- census: CensusID=1, PlotID=1, PlotCensusNumber=1
INSERT INTO census (CensusID, PlotID, PlotCensusNumber, StartDate, EndDate, Description)
VALUES (1, 1, 1, '2024-01-01', '2024-12-31', 'Precondition test census');

-- quadrats: QuadratID=1, PlotID=1, QuadratName='A1'
-- QuadratName≤8 chars (CTFS dest limit)
INSERT INTO quadrats (QuadratID, PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, IsActive)
VALUES (1, 1, 'A1', 0.0, 0.0, 20, 20, 400.0, 1);

-- family: FamilyID=1, Family='Testaceae' (9 chars ≤ 64 CTFS limit)
INSERT INTO family (FamilyID, Family, IsActive) VALUES (1, 'Testaceae', 1);

-- genus: GenusID=1, FamilyID=1, Genus='Foobaria' (8 chars ≤ 64 CTFS limit)
INSERT INTO genus (GenusID, FamilyID, Genus, IsActive) VALUES (1, 1, 'Foobaria', 1);

-- species: SpeciesID=1, GenusID=1
--   SpeciesCode='FOO' (3 chars ≤ 10 CTFS Mnemonic limit)
--   SpeciesName='foo' (3 chars ≤ 64 CTFS limit)
--   SubspeciesName=NULL (not a subspecies row)
--   IDLevel='species', IsActive=1
INSERT INTO species (SpeciesID, GenusID, SpeciesCode, SpeciesName, SubspeciesName, IDLevel, IsActive)
VALUES (1, 1, 'FOO', 'foo', NULL, 'species', 1);

-- attributes: Code='LI' (alive), IsActive=1
-- attributes PK is (Code, IsActive)
INSERT INTO attributes (Code, Description, Status, IsActive)
VALUES ('LI', 'living', 'alive', 1);

-- trees: TreeID=1, TreeTag='1' (1 char ≤ 10 CTFS limit), SpeciesID=1, CensusID=1, IsActive=1
INSERT INTO trees (TreeID, TreeTag, SpeciesID, CensusID, IsActive)
VALUES (1, '1', 1, 1, 1);

-- stems: StemGUID=1, TreeID=1, QuadratID=1, CensusID=1
--   StemTag='1' (1 char ≤ 32 CTFS limit), IsActive=1
INSERT INTO stems (StemGUID, TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
VALUES (1, 1, 1, 1, '1', 1.0, 1.0, 1);

-- coremeasurements: CoreMeasurementID=1, CensusID=1, StemGUID=1
--   IsValidated=TRUE, Description=NULL (≤128 chars for CTFS DBH.Comments)
--   IsActive=1
INSERT INTO coremeasurements
  (CoreMeasurementID, CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description, IsActive)
VALUES
  (1, 1, 1, TRUE, '2024-06-01', 12.300000, 1.300000, NULL, 1);

-- cmattributes: CoreMeasurementID=1, Code='LI'
INSERT INTO cmattributes (CMAID, CoreMeasurementID, Code) VALUES (1, 1, 'LI');

-- measurement_error_log: no rows → happy path has no unresolved errors

SET FOREIGN_KEY_CHECKS = 1;
