drop view if exists alltaxonomiesview;
drop view if exists measurementssummaryview;
drop view if exists stemtaxonomiesview;
drop view if exists viewfulltableview;

CREATE VIEW alltaxonomiesview AS
select `s`.`SpeciesID`           AS `SpeciesID`,
       `f`.`FamilyID`            AS `FamilyID`,
       `g`.`GenusID`             AS `GenusID`,
       `s`.`SpeciesCode`         AS `SpeciesCode`,
       `f`.`Family`              AS `Family`,
       `g`.`Genus`               AS `Genus`,
       `g`.`GenusAuthority`      AS `GenusAuthority`,
       `s`.`SpeciesName`         AS `SpeciesName`,
       `s`.`SubspeciesName`      AS `SubspeciesName`,
       `s`.`IDLevel`             AS `IDLevel`,
       `s`.`SpeciesAuthority`    AS `SpeciesAuthority`,
       `s`.`SubspeciesAuthority` AS `SubspeciesAuthority`,
       `s`.`ValidCode`           AS `ValidCode`,
       `s`.`FieldFamily`         AS `FieldFamily`,
       `s`.`Description`         AS `SpeciesDescription`
from ((`family` `f` join `genus` `g`
       on ((`f`.`FamilyID` = `g`.`FamilyID`))) join `species` `s`
      on ((`g`.`GenusID` = `s`.`GenusID`)))