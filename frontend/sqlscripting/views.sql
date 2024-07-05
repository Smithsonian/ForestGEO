create definer = azureroot@`%` view alltaxonomiesview as
select `s`.`SpeciesID`           AS `SpeciesID`,
       `f`.`FamilyID`            AS `FamilyID`,
       `g`.`GenusID`             AS `GenusID`,
       `r`.`ReferenceID`         AS `ReferenceID`,
       `s`.`SpeciesCode`         AS `SpeciesCode`,
       `f`.`Family`              AS `Family`,
       `g`.`Genus`               AS `Genus`,
       `g`.`GenusAuthority`      AS `GenusAuthority`,
       `s`.`SpeciesName`         AS `SpeciesName`,
       `s`.`SubspeciesName`      AS `SubSpeciesName`,
       `s`.`IDLevel`             AS `SpeciesIDLevel`,
       `s`.`SpeciesAuthority`    AS `SpeciesAuthority`,
       `s`.`SubspeciesAuthority` AS `SubspeciesAuthority`,
       `s`.`ValidCode`           AS `ValidCode`,
       `s`.`FieldFamily`         AS `FieldFamily`,
       `s`.`Description`         AS `SpeciesDescription`,
       `r`.`PublicationTitle`    AS `PublicationTitle`,
       `r`.`FullReference`       AS `FullReference`,
       `r`.`DateOfPublication`   AS `DateOfPublication`,
       `r`.`Citation`            AS `Citation`
from (((`family` `f` join `genus` `g`
        on ((`f`.`FamilyID` = `g`.`FamilyID`))) join `species` `s`
       on ((`g`.`GenusID` = `s`.`GenusID`))) left join `reference` `r`
      on ((`s`.`ReferenceID` = `r`.`ReferenceID`)));

create definer = azureroot@`%` view measurementssummaryview as
select `cm`.`CoreMeasurementID`                                            AS `CoreMeasurementID`,
       `p`.`PlotID`                                                        AS `PlotID`,
       `c`.`CensusID`                                                      AS `CensusID`,
       `q`.`QuadratID`                                                     AS `QuadratID`,
       `s`.`SpeciesID`                                                     AS `SpeciesID`,
       `t`.`TreeID`                                                        AS `TreeID`,
       `st`.`StemID`                                                       AS `StemID`,
       `qp`.`PersonnelID`                                                  AS `PersonnelID`,
       `p`.`PlotName`                                                      AS `PlotName`,
       `q`.`QuadratName`                                                   AS `QuadratName`,
       `s`.`SpeciesCode`                                                   AS `SpeciesCode`,
       `t`.`TreeTag`                                                       AS `TreeTag`,
       `st`.`StemTag`                                                      AS `StemTag`,
       `st`.`LocalX`                                                       AS `StemLocalX`,
       `st`.`LocalY`                                                       AS `StemLocalY`,
       `st`.`CoordinateUnits`                                              AS `StemUnits`,
       coalesce(concat(`pe`.`FirstName`, ' ', `pe`.`LastName`), 'Unknown') AS `PersonnelName`,
       `cm`.`MeasurementDate`                                              AS `MeasurementDate`,
       `cm`.`MeasuredDBH`                                                  AS `MeasuredDBH`,
       `cm`.`DBHUnit`                                                      AS `DBHUnits`,
       `cm`.`MeasuredHOM`                                                  AS `MeasuredHOM`,
       `cm`.`HOMUnit`                                                      AS `HOMUnits`,
       `cm`.`IsValidated`                                                  AS `IsValidated`,
       `cm`.`Description`                                                  AS `Description`,
       (select group_concat(`ca`.`Code` separator '; ')
        from `cmattributes` `ca`
        where (`ca`.`CoreMeasurementID` = `cm`.`CoreMeasurementID`))       AS `Attributes`
from ((((((((((`coremeasurements` `cm` left join `stems` `st`
               on ((`cm`.`StemID` = `st`.`StemID`))) left join `trees` `t`
              on ((`st`.`TreeID` = `t`.`TreeID`))) left join `species` `s`
             on ((`t`.`SpeciesID` = `s`.`SpeciesID`))) left join `genus` `g`
            on ((`s`.`GenusID` = `g`.`GenusID`))) left join `family` `f`
           on ((`g`.`FamilyID` = `f`.`FamilyID`))) left join `quadrats` `q`
          on ((`st`.`QuadratID` = `q`.`QuadratID`))) left join `plots` `p`
         on ((`q`.`PlotID` = `p`.`PlotID`))) left join `census` `c`
        on ((`q`.`CensusID` = `c`.`CensusID`))) left join `quadratpersonnel` `qp`
       on ((`q`.`QuadratID` = `qp`.`QuadratID`))) left join `personnel` `pe`
      on ((`qp`.`PersonnelID` = `pe`.`PersonnelID`)))
order by `cm`.`CoreMeasurementID`;

create definer = azureroot@`%` view stemtaxonomiesview as
select `s`.`StemID`               AS `StemID`,
       `t`.`TreeID`               AS `TreeID`,
       `f`.`FamilyID`             AS `FamilyID`,
       `g`.`GenusID`              AS `GenusID`,
       `sp`.`SpeciesID`           AS `SpeciesID`,
       `s`.`StemTag`              AS `StemTag`,
       `t`.`TreeTag`              AS `TreeTag`,
       `sp`.`SpeciesCode`         AS `SpeciesCode`,
       `f`.`Family`               AS `Family`,
       `g`.`Genus`                AS `Genus`,
       `sp`.`SpeciesName`         AS `SpeciesName`,
       `sp`.`SubspeciesName`      AS `SubspeciesName`,
       `sp`.`ValidCode`           AS `ValidCode`,
       `g`.`GenusAuthority`       AS `GenusAuthority`,
       `sp`.`SpeciesAuthority`    AS `SpeciesAuthority`,
       `sp`.`SubspeciesAuthority` AS `SubspeciesAuthority`,
       `sp`.`IDLevel`             AS `SpeciesIDLevel`,
       `sp`.`FieldFamily`         AS `SpeciesFieldFamily`
from ((((`stems` `s` join `trees` `t`
         on ((`s`.`TreeID` = `t`.`TreeID`))) join `species` `sp`
        on ((`t`.`SpeciesID` = `sp`.`SpeciesID`))) join `genus` `g`
       on ((`sp`.`GenusID` = `g`.`GenusID`))) left join `family` `f`
      on ((`g`.`FamilyID` = `f`.`FamilyID`)));

create definer = azureroot@`%` view viewfulltable as
select `cm`.`CoreMeasurementID`   AS `CoreMeasurementID`,
       `cm`.`MeasurementDate`     AS `MeasurementDate`,
       `cm`.`MeasuredDBH`         AS `MeasuredDBH`,
       `cm`.`DBHUnit`             AS `DBHUnit`,
       `cm`.`MeasuredHOM`         AS `MeasuredHOM`,
       `cm`.`HOMUnit`             AS `HOMUnit`,
       `cm`.`Description`         AS `CoreMeasurementDescription`,
       `cm`.`IsValidated`         AS `IsValidated`,
       `cm`.`UserDefinedFields`   AS `UserDefinedFields`,
       `p`.`PlotID`               AS `PlotID`,
       `p`.`PlotName`             AS `PlotName`,
       `p`.`LocationName`         AS `LocationName`,
       `p`.`CountryName`          AS `CountryName`,
       `p`.`DimensionX`           AS `DimensionX`,
       `p`.`DimensionY`           AS `DimensionY`,
       `p`.`Area`                 AS `PlotArea`,
       `p`.`GlobalX`              AS `GlobalX`,
       `p`.`GlobalY`              AS `GlobalY`,
       `p`.`GlobalZ`              AS `GlobalZ`,
       `p`.`DimensionUnits`       AS `PlotUnit`,
       `p`.`PlotShape`            AS `PlotShape`,
       `p`.`PlotDescription`      AS `PlotDescription`,
       `c`.`CensusID`             AS `CensusID`,
       `c`.`StartDate`            AS `CensusStartDate`,
       `c`.`EndDate`              AS `CensusEndDate`,
       `c`.`Description`          AS `CensusDescription`,
       `c`.`PlotCensusNumber`     AS `PlotCensusNumber`,
       `q`.`QuadratID`            AS `QuadratID`,
       `q`.`QuadratName`          AS `QuadratName`,
       `q`.`DimensionX`           AS `QuadratDimensionX`,
       `q`.`DimensionY`           AS `QuadratDimensionY`,
       `q`.`Area`                 AS `QuadratArea`,
       `q`.`QuadratShape`         AS `QuadratShape`,
       `q`.`DimensionUnits`       AS `QuadratUnit`,
       `sq`.`SubquadratID`        AS `SubquadratID`,
       `sq`.`SubquadratName`      AS `SubquadratName`,
       `sq`.`DimensionX`          AS `SubquadratDimensionX`,
       `sq`.`DimensionY`          AS `SubquadratDimensionY`,
       `sq`.`QX`                  AS `QX`,
       `sq`.`QY`                  AS `QY`,
       `sq`.`CoordinateUnits`     AS `SubquadratUnit`,
       `t`.`TreeID`               AS `TreeID`,
       `t`.`TreeTag`              AS `TreeTag`,
       `s`.`StemID`               AS `StemID`,
       `s`.`StemTag`              AS `StemTag`,
       `s`.`LocalX`               AS `LocalX`,
       `s`.`LocalY`               AS `LocalY`,
       `s`.`CoordinateUnits`      AS `StemUnit`,
       `per`.`PersonnelID`        AS `PersonnelID`,
       `per`.`FirstName`          AS `FirstName`,
       `per`.`LastName`           AS `LastName`,
       `r`.`RoleName`             AS `PersonnelRoles`,
       `qp`.`QuadratPersonnelID`  AS `QuadratPersonnelID`,
       `sp`.`SpeciesID`           AS `SpeciesID`,
       `sp`.`SpeciesCode`         AS `SpeciesCode`,
       `sp`.`SpeciesName`         AS `SpeciesName`,
       `sp`.`SubspeciesName`      AS `SubspeciesName`,
       `sp`.`SubspeciesAuthority` AS `SubspeciesAuthority`,
       `sp`.`IDLevel`             AS `IDLevel`,
       `sl`.`SpeciesLimitID`      AS `SpeciesLimitID`,
       `sl`.`LimitType`           AS `LimitType`,
       `sl`.`UpperBound`          AS `UpperBound`,
       `sl`.`LowerBound`          AS `LowerBound`,
       `sl`.`Unit`                AS `SpeciesLimitUnit`,
       `g`.`GenusID`              AS `GenusID`,
       `g`.`Genus`                AS `Genus`,
       `g`.`GenusAuthority`       AS `GenusAuthority`,
       `fam`.`FamilyID`           AS `FamilyID`,
       `fam`.`Family`             AS `Family`,
       `ref`.`ReferenceID`        AS `ReferenceID`,
       `ref`.`PublicationTitle`   AS `PublicationTitle`,
       `ref`.`FullReference`      AS `FullReference`,
       `ref`.`DateOfPublication`  AS `DateOfPublication`,
       `ref`.`Citation`           AS `Citation`,
       `attr`.`Code`              AS `AttributeCode`,
       `attr`.`Description`       AS `AttributeDescription`,
       `attr`.`Status`            AS `AttributeStatus`,
       `cmv`.`CMVErrorID`         AS `CMVErrorID`,
       `cmv`.`ValidationErrorID`  AS `ValidationErrorID`,
       `cvp`.`Description`        AS `ValidationErrorDescription`,
       `vl`.`ValidationRunID`     AS `ValidationRunID`,
       `vl`.`ProcedureName`       AS `ProcedureName`,
       `vl`.`RunDateTime`         AS `RunDateTime`,
       `vl`.`TargetRowID`         AS `TargetRowID`,
       `vl`.`ValidationOutcome`   AS `ValidationOutcome`,
       `vl`.`ErrorMessage`        AS `ErrorMessage`,
       `vl`.`ValidationCriteria`  AS `ValidationCriteria`,
       `vl`.`MeasuredValue`       AS `MeasuredValue`,
       `vl`.`ExpectedValueRange`  AS `ExpectedValueRange`,
       `vl`.`AdditionalDetails`   AS `AdditionalDetails`
from (((((((((((((((((((`coremeasurements` `cm` left join `stems` `s`
                        on ((`cm`.`StemID` = `s`.`StemID`))) left join `trees` `t`
                       on ((`s`.`TreeID` = `t`.`TreeID`))) left join `species` `sp`
                      on ((`t`.`SpeciesID` = `sp`.`SpeciesID`))) left join `genus` `g`
                     on ((`sp`.`GenusID` = `g`.`GenusID`))) left join `family` `fam`
                    on ((`g`.`FamilyID` = `fam`.`FamilyID`))) left join `specieslimits` `sl`
                   on ((`sp`.`SpeciesCode` = `sl`.`SpeciesCode`))) left join `quadrats` `q`
                  on ((`s`.`QuadratID` = `q`.`QuadratID`))) left join `plots` `p`
                 on ((`q`.`PlotID` = `p`.`PlotID`))) left join `subquadrats` `sq`
                on ((`q`.`QuadratID` = `sq`.`QuadratID`))) left join `census` `c`
               on ((`q`.`CensusID` = `c`.`CensusID`))) left join `quadratpersonnel` `qp`
              on ((`q`.`QuadratID` = `qp`.`QuadratID`))) left join `personnel` `per`
             on ((`qp`.`PersonnelID` = `per`.`PersonnelID`))) left join `roles` `r`
            on ((`per`.`RoleID` = `r`.`RoleID`))) left join `reference` `ref`
           on ((`fam`.`ReferenceID` = `ref`.`ReferenceID`))) left join `cmattributes` `cma`
          on ((`cm`.`CoreMeasurementID` = `cma`.`CoreMeasurementID`))) left join `attributes` `attr`
         on ((`attr`.`Code` = `cma`.`Code`))) left join `cmverrors` `cmv`
        on ((`cm`.`CoreMeasurementID` = `cmv`.`CoreMeasurementID`))) left join `catalog`.`validationprocedures` `cvp`
       on ((`cmv`.`ValidationErrorID` = `cvp`.`ValidationID`))) left join `validationchangelog` `vl`
      on ((`vl`.`TargetRowID` = `cm`.`CoreMeasurementID`)));

