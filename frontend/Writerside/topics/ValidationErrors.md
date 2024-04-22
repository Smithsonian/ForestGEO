# ValidationErrors

Here is the `validationerrors` table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.validationerrors
(
    ValidationErrorID          int auto_increment
        primary key,
    ValidationErrorDescription text null
);

```