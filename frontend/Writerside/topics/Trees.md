# Trees

Here is the `trees` table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.trees
(
    TreeID       int auto_increment
        primary key,
    TreeTag      varchar(10) null,
    SpeciesID    int         null,
    SubSpeciesID int         null,
    constraint Trees_Species_SpeciesID_fk
        foreign key (SpeciesID) references forestgeo_testing.species (SpeciesID),
    constraint Trees_SubSpecies_SubSpeciesID_fk
        foreign key (SubSpeciesID) references forestgeo_testing.subspecies (SubSpeciesID)
);
```