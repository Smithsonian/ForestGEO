# Subquadrats

Here is the `subquadrats` table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.subquadrats
(
    SQID      int auto_increment
        primary key,
    SQName    char(15) null,
    QuadratID int      null,
    Xindex    int      null,
    Yindex    int      null,
    SQindex   int      null comment 'SQindex should tell you in which order the subquads are surveyed. This will be useful later.',
    constraint SQName
        unique (SQName),
    constraint subquadrats_ibfk_1
        foreign key (QuadratID) references forestgeo_testing.quadrats (QuadratID)
);
```