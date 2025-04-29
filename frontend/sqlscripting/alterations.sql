create table if not exists censusattribute
(
    CAID     int auto_increment
        primary key,
    Code     varchar(10) not null,
    CensusID int         not null,
    constraint uq_code_census
        unique (Code, CensusID),
    constraint fk_ca_a
        foreign key (Code) references attributes (Code),
    constraint fk_ca_c
        foreign key (CensusID) references census (CensusID)
);

create table if not exists censuspersonnel (
    CPID int primary key auto_increment,
    PersonnelID int not null,
    CensusID int not null,
    constraint uq_personnel_census unique (PersonnelID, CensusID),
    constraint fk_cp_p foreign key (PersonnelID) references personnel (PersonnelID),
    constraint fk_cp_c foreign key (CensusID) references census (CensusID)
);

create table if not exists censusspecies (
    CSID int primary key auto_increment,
    SpeciesID int not null,
    CensusID int not null,
    constraint uq_species_census unique (SpeciesID, CensusID),
    constraint fk_cs_s foreign key (SpeciesID) references species (SpeciesID),
    constraint fk_cs_c foreign key (CensusID) references census (CensusID)
);



# alter table coremeasurements modify MeasuredDBH decimal(12, 6) null;
# alter table coremeasurements modify MeasuredHOM decimal(12, 6) null;
#
# alter table failedmeasurements modify X decimal(12, 6) null;
# alter table failedmeasurements modify Y decimal(12, 6) null;
# alter table failedmeasurements modify DBH decimal(12, 6) null;
# alter table failedmeasurements modify HOM decimal(12, 6) null;
#
# alter table measurementssummary modify StemLocalX decimal(12, 6) null;
# alter table measurementssummary modify StemLocalY decimal(12, 6) null;
# alter table measurementssummary modify MeasuredDBH decimal(12, 6) null;
# alter table measurementssummary modify MeasuredHOM decimal(12, 6) null;
#
# alter table plots modify GlobalX decimal(12, 6) null;
# alter table plots modify GlobalY decimal(12, 6) null;
# alter table plots modify GlobalZ decimal(12, 6) null;
# alter table plots modify DimensionX decimal(12, 6) null;
# alter table plots modify DimensionY decimal(12, 6) null;
# alter table plots modify Area decimal(12, 6) null;
#
# alter table quadrats modify StartX decimal(12, 6) null;
# alter table quadrats modify StartY decimal(12, 6) null;
# alter table quadrats modify Area decimal(12, 6) null;
#
# alter table stems modify LocalX decimal(12, 6) null;
# alter table stems modify LocalY decimal(12, 6) null;
#
# alter table temporarymeasurements modify LocalX decimal(12, 6) null;
# alter table temporarymeasurements modify LocalY decimal(12, 6) null;
# alter table temporarymeasurements modify DBH decimal(12, 6) null;
# alter table temporarymeasurements modify HOM decimal(12, 6) null;
#
# alter table specieslimits modify LowerBound decimal(12, 6) null;
# alter table specieslimits modify UpperBound decimal(12, 6) null;
