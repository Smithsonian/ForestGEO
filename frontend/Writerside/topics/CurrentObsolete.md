# CurrentObsolete

Here is the `currentobsolete` table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.currentobsolete
(
    SpeciesID         int  not null,
    ObsoleteSpeciesID int  not null,
    ChangeDate        date not null,
    ChangeCodeID      int  null,
    ChangeNote        text null,
    primary key (SpeciesID, ObsoleteSpeciesID, ChangeDate),
    constraint CurrentObsolete_Species_SpeciesID_fk
        foreign key (SpeciesID) references forestgeo_testing.species (SpeciesID),
    constraint CurrentObsolete_Species_SpeciesID_fk2
        foreign key (ObsoleteSpeciesID) references forestgeo_testing.species (SpeciesID)
);
```