# QuadratPersonnel

Here is the `quadratpersonnel` table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.quadratpersonnel
(
    QuadratPersonnelID int auto_increment
        primary key,
    QuadratID          int          null,
    PersonnelID        int          null,
    AssignedDate       date         null,
    Role               varchar(150) null,
    constraint fk_QuadratPersonnel_Personnel
        foreign key (PersonnelID) references forestgeo_testing.personnel (PersonnelID),
    constraint fk_QuadratPersonnel_Quadrats
        foreign key (QuadratID) references forestgeo_testing.quadrats (QuadratID)
);
```