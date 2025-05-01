drop view if exists alltaxonomiesview;

create definer = azureroot@`%` view alltaxonomiesview as
select `s`.`SpeciesID`           AS `SpeciesID`,
       `c`.`CensusID`            AS `CensusID`,
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
from ((((`forestgeo_testing`.`family` `f` join `forestgeo_testing`.`genus` `g`
         on ((`f`.`FamilyID` = `g`.`FamilyID`))) join `forestgeo_testing`.`species` `s`
        on (((`g`.`GenusID` = `s`.`GenusID`) and ((0 <> `s`.`IsActive`) is true)))) join `forestgeo_testing`.`censusspecies` `cs`
       on ((`cs`.`SpeciesID` = `s`.`SpeciesID`))) join `forestgeo_testing`.`census` `c`
      on (((`c`.`CensusID` = `cs`.`CensusID`) and ((0 <> `c`.`IsActive`) is true))));

