--
-- Minimal reference data for csv-to-sql-v2 integration tests.
--
-- Targets the canonical CTFS schema (see canonical-ddl.sql).
-- Note: the canonical schema has NO `Plot` table — `Site` IS the plot table
-- and its primary key `PlotID` is what Census/Quadrat/etc. reference.
--
-- TSMAttributes Description values are load-bearing — csv-to-sql-v2 matches
-- them via LOWER(Description) IN ('main','secondary') and LIKE '%dead%' /
-- LIKE '%stem lost%' predicates.
--

INSERT INTO Country (CountryID, CountryName) VALUES (1, 'Testland');

INSERT INTO Site (
  PlotID, PlotName, LocationName, CountryID, ShapeOfSite, DescriptionOfSite,
  Area, QDimX, QDimY, GUOM, GZUOM, PUOM, QUOM, IsStandardSize
) VALUES (
  1, 'TEST', 'Test Forest Plot', 1, 'rectangle', 'Integration test plot',
  4.0, 20.0, 20.0, 'm', 'm', 'm', 'm', 'Y'
);

INSERT INTO Census (CensusID, PlotID, PlotCensusNumber, StartDate, EndDate, Description)
VALUES (1, 1, '1', '2024-01-01', '2024-12-31', 'Test census 1');

INSERT INTO Quadrat (QuadratID, PlotID, QuadratName, Area, IsStandardShape) VALUES
  (1, 1, 'A1', 400.0, 'Y'),
  (2, 1, 'A2', 400.0, 'Y'),
  (3, 1, 'B1', 400.0, 'Y'),
  (4, 1, 'B2', 400.0, 'Y');

INSERT INTO Family (FamilyID, Family) VALUES (1, 'Testaceae');

INSERT INTO Genus (GenusID, Genus, FamilyID, Authority) VALUES
  (1, 'Foobaria', 1, 'L.'),
  (2, 'Barbaria',  1, 'L.'),
  (3, 'Bazbaria',  1, 'L.'),
  (4, 'Quxbaria',  1, 'L.'),
  (5, 'Quuxbaria', 1, 'L.');

INSERT INTO Species (SpeciesID, GenusID, CurrentTaxonFlag, SpeciesName, Mnemonic, IDLevel) VALUES
  (1, 1, 1, 'foo',  'FOO',  'species'),
  (2, 2, 1, 'bar',  'BAR',  'species'),
  (3, 3, 1, 'baz',  'BAZ',  'species'),
  (4, 4, 1, 'qux',  'QUX',  'species'),
  (5, 5, 1, 'quux', 'QUUX', 'species');

INSERT INTO TSMAttributes (TSMID, TSMCode, Description, Status) VALUES
  (1, 'M',  'main',                      'alive'),
  (2, 'S',  'secondary',                 'alive'),
  (3, 'LI', 'living',                    'alive'),
  (4, 'A',  'alive',                     'alive'),
  (5, 'D',  'dead',                      'dead'),
  (6, 'SD', 'stem dead',                 'stem dead'),
  (7, 'SL', 'stem lost',                 'missing'),
  (8, 'BB', 'broken below',              'broken below');
