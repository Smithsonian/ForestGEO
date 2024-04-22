# Stems

Here is the `stems` table definition. <br /> 
Please use this as a benchmark when implementing API changes. <br /> 
API RDS types should correspond to columns in creation script!

```SQL
create table forestgeo_testing.stems
(
    StemID          int auto_increment
        primary key,
    TreeID          int            null,
    SubQuadratID    int            null,
    StemNumber      int            null,
    StemTag         varchar(10)    null,
    LocalX          decimal(10, 2) null,
    LocalY          decimal(10, 2) null,
    Moved           bit            null,
    StemDescription text           null,
    constraint FK_Stems_Trees
        foreign key (TreeID) references forestgeo_testing.trees (TreeID),
    constraint stems_subquadrats_SQID_fk
        foreign key (SubQuadratID) references forestgeo_testing.subquadrats (SQID)
);
```