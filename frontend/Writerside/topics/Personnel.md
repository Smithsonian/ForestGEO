# Personnel

Here is the personnel table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.personnel
(
    PersonnelID int auto_increment
        primary key,
    FirstName   varchar(50)  null,
    LastName    varchar(50)  null,
    Role        varchar(150) null
);
```