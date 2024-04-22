# CMAttributes

Here is the `cmattributes` table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.cmattributes
(
    CMAID             int auto_increment
        primary key,
    CoreMeasurementID int         null,
    Code              varchar(10) null,
    constraint CMAttributes_Attributes_Code_fk
        foreign key (Code) references forestgeo_testing.attributes (Code),
    constraint CMAttributes_CoreMeasurements_CoreMeasurementID_fk
        foreign key (CoreMeasurementID) references forestgeo_testing.coremeasurements (CoreMeasurementID)
);
```