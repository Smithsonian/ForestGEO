# Reference

Here is the `reference` table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.reference
(
    ReferenceID       int auto_increment
        primary key,
    PublicationTitle  varchar(64) null,
    FullReference     text        null,
    DateOfPublication date        null,
    Citation          varchar(50) null
);
```