# Attributes

Here is the attributes table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.attributes
(
    Code        varchar(10)                                                                                                     not null
        primary key,
    Description text                                                                                                            null,
    Status      enum ('alive', 'alive-not measured', 'dead', 'stem dead', 'broken below', 'omitted', 'missing') default 'alive' null
);
```