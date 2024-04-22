# Quadrats

Here is the quadrats table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.quadrats
(
    QuadratID    int auto_increment
        primary key,
    PlotID       int            null,
    CensusID     int            null,
    QuadratName  text           null,
    DimensionX   int            null,
    DimensionY   int            null,
    Area         decimal(10, 2) null,
    QuadratShape text           null,
    constraint Quadrats_Plots_FK
        foreign key (PlotID) references forestgeo_testing.plots (PlotID),
    constraint quadrats_census_CensusID_fk
        foreign key (CensusID) references forestgeo_testing.census (CensusID)
);
```