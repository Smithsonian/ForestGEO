# Family

Here is the `family` table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.family
(
    FamilyID    int auto_increment
        primary key,
    Family      varchar(32) null,
    ReferenceID int         null,
    constraint Family_Reference_ReferenceID_fk
        foreign key (ReferenceID) references forestgeo_testing.reference (ReferenceID)
);
```