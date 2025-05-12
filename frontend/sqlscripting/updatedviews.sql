
DROP VIEW IF EXISTS alltaxonomiesview;
CREATE VIEW alltaxonomiesview AS
SELECT sv.SpeciesID           AS SpeciesID,
       cs.CensusID            AS CensusID,
       f.FamilyID             AS FamilyID,
       g.GenusID              AS GenusID,
       sv.SpeciesCode         AS SpeciesCode,
       f.Family               AS Family,
       g.Genus                AS Genus,
       g.GenusAuthority       AS GenusAuthority,
       sv.SpeciesName         AS SpeciesName,
       sv.SubspeciesName      AS SubspeciesName,
       sv.IDLevel             AS IDLevel,
       sv.SpeciesAuthority    AS SpeciesAuthority,
       sv.SubspeciesAuthority AS SubspeciesAuthority,
       sv.ValidCode           AS ValidCode,
       sv.FieldFamily         AS FieldFamily,
       sv.Description         AS SpeciesDescription
FROM censusspecies AS cs
         JOIN speciesversioning AS sv
              ON cs.SpeciesVersioningID = sv.SpeciesVersioningID
         JOIN census AS c
              ON cs.CensusID = c.CensusID
                  AND c.IsActive <> 0
         LEFT JOIN genus AS g
                   ON sv.GenusID = g.GenusID
                       AND g.IsActive = 1
         LEFT JOIN family AS f
                   ON g.FamilyID = f.FamilyID
                       AND f.IsActive = 1
WHERE f.IsActive = 1;
