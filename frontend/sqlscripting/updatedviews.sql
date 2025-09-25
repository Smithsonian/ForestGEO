DROP VIEW IF EXISTS alltaxonomiesview;
CREATE VIEW alltaxonomiesview AS
SELECT s.SpeciesID           AS SpeciesID,
       c.CensusID            AS CensusID,
       f.FamilyID            AS FamilyID,
       g.GenusID             AS GenusID,
       s.SpeciesCode         AS SpeciesCode,
       f.Family              AS Family,
       g.Genus               AS Genus,
       g.GenusAuthority      AS GenusAuthority,
       s.SpeciesName         AS SpeciesName,
       s.SubspeciesName      AS SubspeciesName,
       s.IDLevel             AS IDLevel,
       s.SpeciesAuthority    AS SpeciesAuthority,
       s.SubspeciesAuthority AS SubspeciesAuthority,
       s.ValidCode           AS ValidCode,
       s.FieldFamily         AS FieldFamily,
       s.Description         AS SpeciesDescription
FROM species s
         LEFT JOIN genus AS g ON s.GenusID = g.GenusID AND g.IsActive = 1
         LEFT JOIN family AS f ON g.FamilyID = f.FamilyID AND f.IsActive = 1
WHERE s.IsActive = 1;
