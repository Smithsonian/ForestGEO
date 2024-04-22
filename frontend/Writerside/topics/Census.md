# Census

Here is the census table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.census
(
    CensusID         int auto_increment
        primary key,
    PlotID           int  null,
    StartDate        date null,
    EndDate          date null,
    Description      text null,
    PlotCensusNumber int  null,
    constraint Census_Plots_PlotID_fk
        foreign key (PlotID) references forestgeo_testing.plots (PlotID)
);
```