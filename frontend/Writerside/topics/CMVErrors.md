# CMVErrors

Here is the `cmverrors` table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.cmverrors
(
    CMVErrorID        int auto_increment
        primary key,
    CoreMeasurementID int null,
    ValidationErrorID int null,
    constraint CMVErrors_CoreMeasurements_CoreMeasurementID_fk
        foreign key (CoreMeasurementID) references forestgeo_testing.coremeasurements (CoreMeasurementID),
    constraint cmverrors_validationerrors_ValidationErrorID_fk
        foreign key (ValidationErrorID) references forestgeo_testing.validationerrors (ValidationErrorID)
);
```