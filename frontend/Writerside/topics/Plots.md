# Plots

Here is the plots table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.plots
(
    PlotID          int auto_increment
        primary key,
    PlotName        text           null,
    LocationName    text           null,
    CountryName     text           null,
    DimensionX      int            null,
    DimensionY      int            null,
    Area            decimal(10, 2) null,
    GlobalX         decimal(10, 2) null,
    GlobalY         decimal(10, 2) null,
    GlobalZ         decimal(10, 2) null,
    PlotShape       text           null,
    PlotDescription text           null
);
```