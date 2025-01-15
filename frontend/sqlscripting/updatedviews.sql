CREATE VIEW alltaxonomiesview AS
SELECT s.SpeciesID           AS SpeciesID,
       f.FamilyID            AS FamilyID,
       g.GenusID             AS GenusID,
       s.SpeciesCode         AS SpeciesCode,
       f.Family              AS Family,
       g.Genus               AS Genus,
       g.GenusAuthority      AS GenusAuthority,
       s.SpeciesName         AS SpeciesName,
       s.SubspeciesName      AS SubSpeciesName,
       s.IDLevel             AS SpeciesIDLevel,
       s.SpeciesAuthority    AS SpeciesAuthority,
       s.SubspeciesAuthority AS SubspeciesAuthority,
       s.ValidCode           AS ValidCode,
       s.FieldFamily         AS FieldFamily,
       s.Description         AS SpeciesDescription
FROM family f
         JOIN genus g ON f.FamilyID = g.FamilyID
         JOIN species s ON g.GenusID = s.GenusID;
