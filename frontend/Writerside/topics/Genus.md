# Genus

Here is the `genus` table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.genus
(
    GenusID     int auto_increment
        primary key,
    FamilyID    int         null,
    Genus       varchar(32) null,
    ReferenceID int         null,
    Authority   varchar(32) null,
    constraint Genus_Family_FamilyID_fk
        foreign key (FamilyID) references forestgeo_testing.family (FamilyID),
    constraint Genus_Reference_ReferenceID_fk
        foreign key (ReferenceID) references forestgeo_testing.reference (ReferenceID)
);
```