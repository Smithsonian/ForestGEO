alter table quadrats
    drop key unique_quadrat_name_per_plot;

alter table quadrats
    add constraint unique_full_quadrat
        unique (PlotID, QuadratName, StartX, `StartY`, `DimensionX`, `DimensionY`, `Area`, `IsActive`);


alter table species
    drop key SpeciesCode;

alter table species
    add constraint SpeciesCode
        unique (SpeciesCode, SpeciesName, SubspeciesName, IsActive, `IDLevel`, SpeciesAuthority, SubspeciesAuthority,
                FieldFamily, Description);

alter table species
    drop key species_SpeciesCode_IsActive_uindex;

alter table species
    drop key species_SpeciesCode_uindex;



