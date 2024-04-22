# CoreMeasurements

Here is the `coremeasurements` table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.coremeasurements
(
    CoreMeasurementID int auto_increment
        primary key,
    CensusID          int              null,
    PlotID            int              null,
    QuadratID         int              null,
    SubQuadratID      int              null,
    TreeID            int              null,
    StemID            int              null,
    PersonnelID       int              null,
    IsValidated       bit default b'0' null,
    MeasurementDate   date             null,
    MeasuredDBH       decimal(10, 2)   null,
    MeasuredHOM       decimal(10, 2)   null,
    Description       text             null,
    UserDefinedFields text             null,
    constraint CoreMeasurements_Census_CensusID_fk
        foreign key (CensusID) references forestgeo_testing.census (CensusID),
    constraint CoreMeasurements_Personnel_PersonnelID_fk
        foreign key (PersonnelID) references forestgeo_testing.personnel (PersonnelID),
    constraint FK_CoreMeasurements_Stems
        foreign key (StemID) references forestgeo_testing.stems (StemID),
    constraint FK_CoreMeasurements_Trees
        foreign key (TreeID) references forestgeo_testing.trees (TreeID),
    constraint coremeasurements_plots_PlotID_fk
        foreign key (PlotID) references forestgeo_testing.plots (PlotID),
    constraint coremeasurements_quadrats_QuadratID_fk
        foreign key (QuadratID) references forestgeo_testing.quadrats (QuadratID),
    constraint coremeasurements_subquadrats_SQID_fk
        foreign key (SubQuadratID) references forestgeo_testing.subquadrats (SQID)
);
```