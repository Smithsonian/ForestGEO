# Subspecies

Here is the `subspecies` table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.subspecies
(
    SubSpeciesID       int auto_increment
        primary key,
    SubSpeciesCode     varchar(10)  null,
    SpeciesID          int          null,
    CurrentTaxonFlag   bit          null,
    ObsoleteTaxonFlag  bit          null,
    SubSpeciesName     text         null,
    Authority          varchar(128) null,
    InfraSpecificLevel char(32)     null,
    constraint SubSpecies_Species_SpeciesID_fk
        foreign key (SpeciesID) references forestgeo_testing.species (SpeciesID)
);
```