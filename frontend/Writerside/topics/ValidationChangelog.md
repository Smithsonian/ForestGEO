# ValidationChangelog

Here is the `validationchangelog` table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.validationchangelog
(
    ValidationRunID    int auto_increment
        primary key,
    ProcedureName      varchar(255)                       not null,
    RunDateTime        datetime default CURRENT_TIMESTAMP not null,
    TargetRowID        int                                null,
    ValidationOutcome  enum ('Passed', 'Failed')          null,
    ErrorMessage       text                               null,
    ValidationCriteria text                               null,
    MeasuredValue      varchar(255)                       null,
    ExpectedValueRange varchar(255)                       null,
    AdditionalDetails  text                               null
);
```