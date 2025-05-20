
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
FROM family f
         LEFT JOIN genus g
                   ON f.FamilyID = g.FamilyID and g.IsActive IS TRUE
         LEFT JOIN species s
                   ON g.GenusID = s.GenusID
                       AND s.IsActive <> 0
         JOIN censusspecies cs
              ON cs.SpeciesID = s.SpeciesID
         LEFT JOIN census c
                   ON c.CensusID = cs.CensusID
                       AND c.IsActive <> 0
WHERE f.IsActive IS TRUE;
