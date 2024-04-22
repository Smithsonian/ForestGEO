# Species

Here is the `species` table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.species
(
    SpeciesID         int auto_increment
        primary key,
    GenusID           int            null,
    SpeciesCode       varchar(25)    null,
    CurrentTaxonFlag  bit            null,
    ObsoleteTaxonFlag bit            null,
    SpeciesName       varchar(64)    null,
    DefaultDBHMin     decimal(10, 2) null,
    DefaultDBHMax     decimal(10, 2) null,
    DefaultHOMMin     decimal(10, 2) null,
    DefaultHOMMax     decimal(10, 2) null,
    IDLevel           varchar(8)     null,
    Authority         varchar(128)   null,
    FieldFamily       varchar(32)    null,
    Description       text           null,
    ReferenceID       int            null,
    constraint Species_Genus_GenusID_fk
        foreign key (GenusID) references forestgeo_testing.genus (GenusID),
    constraint Species_Reference_ReferenceID_fk
        foreign key (ReferenceID) references forestgeo_testing.reference (ReferenceID)
);
```