--
-- Prior-census reference data for csv-to-sql-v2 integration tests.
--
-- Layers on top of seed-census-1.sql. Adds:
--   - A second Census row (CensusID=2, PlotCensusNumber='2') for the same plot.
--     Tests that consume this fixture target this census via --census-number 2.
--   - Three trees with one stem each in the prior census (CensusID=1):
--       Tag=1 / StemTag=1 (FOO) — used by the "O" / "M" / HOM scenarios.
--       Tag=2 / StemTag=1 (BAR) — used by the HOM-inheritance scenario (HOM=2.0).
--       Tag=3 / StemTag=OLD (BAZ) — used by the resprout-reuse scenario.
--   - DBH measurements for each prior stem under CensusID=1.
--
-- Census 1 was created on date 2024-01-01..2024-12-31; the new "target" Census 2
-- starts strictly later so Stage 4's prior-census ordering picks Census 1 as prior.

INSERT INTO Census (CensusID, PlotID, PlotCensusNumber, StartDate, EndDate, Description)
VALUES (2, 1, '2', '2025-01-01', '2025-12-31', 'Test census 2');

-- Tree 1 — O/M scenario subject (FOO species, one prior stem)
INSERT INTO Tree (TreeID, Tag, SpeciesID, SubSpeciesID) VALUES (1, '1', 1, NULL);
INSERT INTO Stem (StemID, TreeID, StemTag, QuadratID, StemNumber, QX, QY)
  VALUES (1, 1, '1', 1, 0, 1.0, 1.0);
INSERT INTO DBH (MeasureID, CensusID, StemID, DBH, HOM, PrimaryStem, ExactDate)
  VALUES (0, 1, 1, 12.0, '1.3', NULL, '2024-01-15');

-- Tree 2 — HOM inheritance scenario subject (BAR species, HOM=2.0)
INSERT INTO Tree (TreeID, Tag, SpeciesID, SubSpeciesID) VALUES (2, '2', 2, NULL);
INSERT INTO Stem (StemID, TreeID, StemTag, QuadratID, StemNumber, QX, QY)
  VALUES (2, 2, '1', 1, 0, 2.0, 2.0);
INSERT INTO DBH (MeasureID, CensusID, StemID, DBH, HOM, PrimaryStem, ExactDate)
  VALUES (0, 1, 2, 18.0, '2.0', NULL, '2024-01-15');

-- Tree 3 — resprout-reuse scenario subject (BAZ species, prior stem StemTag='OLD')
INSERT INTO Tree (TreeID, Tag, SpeciesID, SubSpeciesID) VALUES (3, '3', 3, NULL);
INSERT INTO Stem (StemID, TreeID, StemTag, QuadratID, StemNumber, QX, QY)
  VALUES (3, 3, 'OLD', 2, 0, 3.0, 3.0);
INSERT INTO DBH (MeasureID, CensusID, StemID, DBH, HOM, PrimaryStem, ExactDate)
  VALUES (0, 1, 3, 15.0, '1.3', NULL, '2024-01-15');
