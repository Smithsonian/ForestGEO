create index idx_coremeasurementid_coremeasurements on coremeasurements(CoreMeasurementID);
create index idx_censusid_coremeasurements on coremeasurements(CensusID);
create index idx_stemid_coremeasurements on coremeasurements(StemID);
create index idx_measurementdate_coremeasurements on coremeasurements(MeasurementDate);
create index idx_cmid_cid_coremeasurements on coremeasurements(CoreMeasurementID, CensusID);
create index idx_cmid_cid_sid_coremeasurements on coremeasurements(CoreMeasurementID, CensusID, StemID);

create index idx_stemid_stems on stems (StemID);
create index idx_treeid_stems on stems (TreeID);
create index idx_quadratid_stems on stems (QuadratID);
create index idx_stemid_treeid_stems on stems(StemID, TreeID);
create index idx_sid_tid_qid_stems on stems (StemID, TreeID, QuadratID);

create index idx_quadratid_quadrats on quadrats (QuadratID);
create index idx_plotid_quadrats on quadrats (PlotID);
create index idx_censusid_quadrats on quadrats(CensusID);
create index idx_qid_pid_quadrats on quadrats (QuadratID, PlotID);
create index idx_pid_cid_quadrats on quadrats (PlotID, CensusID);
create index idx_qid_pid_cid_quadrats on quadrats (QuadratID, PlotID, CensusID);

-- DEPRECATED
-- Covering indexes for alltaxonomiesview
CREATE INDEX idx_family_covering_family ON family (FamilyID, Family(32));
CREATE INDEX idx_genus_covering_genus ON genus (GenusID, FamilyID, Genus(32), GenusAuthority(32));
CREATE INDEX idx_species_covering_species ON species (SpeciesID, GenusID, SpeciesCode(25), SpeciesName(64), SubspeciesName(64), IDLevel(20), SpeciesAuthority(64), SubspeciesAuthority(64), ValidCode(100), FieldFamily(32), Description(100), ReferenceID);
CREATE INDEX idx_reference_covering_reference ON reference (ReferenceID, PublicationTitle(64), FullReference(100), DateOfPublication, Citation(50));

-- Covering indexes for measurementssummaryview
CREATE INDEX idx_coremeasurements_covering_coremeasurements ON coremeasurements (CoreMeasurementID, CensusID, StemID, MeasurementDate, MeasuredDBH, DBHUnit, MeasuredHOM, HOMUnit, IsValidated, Description(100));
CREATE INDEX idx_stems_covering_stems ON stems (StemID, TreeID, QuadratID, LocalX, LocalY, CoordinateUnits);
CREATE INDEX idx_trees_covering_trees ON trees (TreeID, SpeciesID, TreeTag(10));
CREATE INDEX idx_species_covering_species_measurement ON species (SpeciesID, GenusID, SpeciesCode(25));
CREATE INDEX idx_genus_covering_genus_measurement ON genus (GenusID, FamilyID);
CREATE INDEX idx_family_covering_family_measurement ON family (FamilyID);
CREATE INDEX idx_quadrats_covering_quadrats ON quadrats (QuadratID, PlotID, QuadratName(64));
CREATE INDEX idx_plots_covering_plots ON plots (PlotID, PlotName(255));
CREATE INDEX idx_census_covering_census ON census (CensusID);
CREATE INDEX idx_quadratpersonnel_covering_quadratpersonnel ON quadratpersonnel (QuadratID, PersonnelID);
CREATE INDEX idx_personnel_covering_personnel ON personnel (PersonnelID, FirstName(50), LastName(50));
CREATE INDEX idx_cmattributes_covering_cmattributes ON cmattributes (CoreMeasurementID, Code(10));

-- Covering indexes for stemtaxonomiesview
CREATE INDEX idx_stems_covering_stems_taxonomies ON stems (StemID, TreeID, QuadratID, LocalX, LocalY, CoordinateUnits);
CREATE INDEX idx_trees_covering_trees_taxonomies ON trees (TreeID, SpeciesID, TreeTag(10));
CREATE INDEX idx_quadrats_covering_quadrats_taxonomies ON quadrats (QuadratID, PlotID, QuadratName(64));
CREATE INDEX idx_census_covering_census_taxonomies ON census (CensusID, PlotID);
CREATE INDEX idx_plots_covering_plots_taxonomies ON plots (PlotID, PlotName(255));
CREATE INDEX idx_species_covering_species_taxonomies ON species (SpeciesID, GenusID, SpeciesCode(25), SpeciesName(64), SubspeciesName(64), IDLevel(20), SpeciesAuthority(64), SubspeciesAuthority(64), ValidCode(100), FieldFamily(32));
CREATE INDEX idx_genus_covering_genus_taxonomies ON genus (GenusID, FamilyID, Genus(32), GenusAuthority(32));
CREATE INDEX idx_family_covering_family_taxonomies ON family (FamilyID, Family(32));

-- Covering indexes for viewfulltableview
CREATE INDEX idx_coremeasurements_covering_coremeasurements_full ON coremeasurements (CoreMeasurementID, MeasurementDate, MeasuredDBH, DBHUnit, MeasuredHOM, HOMUnit, IsValidated, Description(100));
CREATE INDEX idx_stems_covering_stems_full ON stems (StemID, TreeID, QuadratID, LocalX, LocalY, CoordinateUnits);
CREATE INDEX idx_trees_covering_trees_full ON trees (TreeID, SpeciesID, TreeTag(10));
CREATE INDEX idx_species_covering_species_full ON species (SpeciesID, GenusID, SpeciesCode(25), SpeciesName(64), SubspeciesName(64), SubspeciesAuthority(64), IDLevel(20));
CREATE INDEX idx_genus_covering_genus_full ON genus (GenusID, FamilyID, Genus(32), GenusAuthority(32));
CREATE INDEX idx_family_covering_family_full ON family (FamilyID, Family(32));
CREATE INDEX idx_specieslimits_covering_specieslimits_full ON specieslimits (SpeciesCode(25));
CREATE INDEX idx_quadrats_covering_quadrats_full ON quadrats (QuadratID, PlotID, QuadratName(64), DimensionX, DimensionY, Area, QuadratShape(64), DimensionUnits);
CREATE INDEX idx_quadratpersonnel_covering_quadratpersonnel_full ON quadratpersonnel (QuadratID, PersonnelID);
CREATE INDEX idx_personnel_covering_personnel_full ON personnel (PersonnelID, FirstName(50), LastName(50), RoleID);
CREATE INDEX idx_plots_covering_plots_full ON plots (PlotID, PlotName(100), LocationName(100), CountryName(100), DimensionX, DimensionY, Area, GlobalX, GlobalY, GlobalZ, DimensionUnits, PlotShape(64), PlotDescription(100));
CREATE INDEX idx_subquadrats_covering_subquadrats_full ON subquadrats (SubquadratID, SubquadratName(25), DimensionX, DimensionY, QX, QY, CoordinateUnits);
CREATE INDEX idx_census_covering_census_full ON census (CensusID, StartDate, EndDate, Description(100), PlotCensusNumber);
CREATE INDEX idx_roles_covering_roles_full ON roles (RoleID, RoleName(255));
CREATE INDEX idx_attributes_covering_attributes_full ON attributes (Code(10), Description(100), Status);
CREATE INDEX idx_cmattributes_covering_cmattributes_full ON cmattributes (CoreMeasurementID, Code(10));
