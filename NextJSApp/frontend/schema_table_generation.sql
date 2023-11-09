IF NOT EXISTS (
    SELECT * FROM sys.schemas WHERE name = N'forestgeo'
)
EXEC('CREATE SCHEMA [forestgeo] AUTHORIZATION [dbo]');
GO

create table forestgeo.Attributes
(
    Code        varchar(10) not null
        constraint Attributes_pk
            primary key,
    Description varchar(max),
    Status      varchar(5)
)
    go

-- exec sp_addextendedproperty 'MS_Description',
--      'set of codes denoting attributes to describe trees, stems, measurements, etc', 'SCHEMA', 'forestgeo', 'TABLE',
--      'Attributes'
-- go

-- exec sp_addextendedproperty 'MS_Description',
--      'up to 10-char attribute code. maps to TSMAttribute & DBHAttribute tables in CTFSWeb.', 'SCHEMA', 'forestgeo',
--      'TABLE', 'Attributes', 'COLUMN', 'Code'
-- go

-- exec sp_addextendedproperty 'MS_Description', 'free text description of attribute for user clarity', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Attributes', 'COLUMN', 'Description'
-- go

-- exec sp_addextendedproperty 'MS_Description',
--      'summary category for code: one of ALIVE, ALIVE NOT MEASURED, DEAD, MISSING, BROKEN BELOW, or STEM DEAD', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Attributes', 'COLUMN', 'Status'
-- go

create table forestgeo.MeasurementTypes
(
    MeasurementTypeID          int not null
        constraint MeasurementTypes_pk
            primary key,
    MeasurementTypeDescription int
)
    go

-- exec sp_addextendedproperty 'MS_Description', 'unique identifier for a type of measurement', 'SCHEMA', 'forestgeo',
--      'TABLE', 'MeasurementTypes', 'COLUMN', 'MeasurementTypeID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'free text description of each measurement type', 'SCHEMA', 'forestgeo',
--      'TABLE', 'MeasurementTypes', 'COLUMN', 'MeasurementTypeDescription'
-- go

create table forestgeo.Personnel
(
    PersonnelID int not null
        constraint Personnel_pk
            primary key,
    FirstName   varchar(50),
    LastName    varchar(50),
    Role        varchar(50)
)
    go

-- exec sp_addextendedproperty 'MS_Description', 'list of personnel and their roles', 'SCHEMA', 'forestgeo', 'TABLE',
--      'Personnel'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'unique personnel identifier', 'SCHEMA', 'forestgeo', 'TABLE',
--      'Personnel', 'COLUMN', 'PersonnelID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'personnel first name', 'SCHEMA', 'forestgeo', 'TABLE', 'Personnel',
--      'COLUMN', 'FirstName'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'personnel last name', 'SCHEMA', 'forestgeo', 'TABLE', 'Personnel',
--      'COLUMN', 'LastName'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'role assigned to personnel (replaces role table foreign key)', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Personnel', 'COLUMN', 'Role'
-- go

create table forestgeo.Plots
(
    PlotID          int not null
        constraint PlotID_PK
            primary key,
    PlotName        varchar(max),
    LocationName    varchar(max),
    CountryName     varchar(max),
    Area            float,
    PlotX           float,
    PlotY           float,
    PlotZ           float,
    PlotShape       varchar(max),
    PlotDescription varchar(max)
)
    go

-- exec sp_addextendedproperty 'MS_Description', 'Basic plot information', 'SCHEMA', 'forestgeo', 'TABLE', 'Plots'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'Primary key to ID plots', 'SCHEMA', 'forestgeo', 'TABLE', 'Plots',
--      'COLUMN', 'PlotID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'plot text name', 'SCHEMA', 'forestgeo', 'TABLE', 'Plots', 'COLUMN',
--      'PlotName'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'basic location information', 'SCHEMA', 'forestgeo', 'TABLE', 'Plots',
--      'COLUMN', 'LocationName'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'replacement for country table', 'SCHEMA', 'forestgeo', 'TABLE', 'Plots',
--      'COLUMN', 'CountryName'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'area of plot in square meters', 'SCHEMA', 'forestgeo', 'TABLE', 'Plots',
--      'COLUMN', 'Area'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'plot X coordinate', 'SCHEMA', 'forestgeo', 'TABLE', 'Plots', 'COLUMN',
--      'PlotX'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'plot Y coordinate', 'SCHEMA', 'forestgeo', 'TABLE', 'Plots', 'COLUMN',
--      'PlotY'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'plot elevation coordinate', 'SCHEMA', 'forestgeo', 'TABLE', 'Plots',
--      'COLUMN', 'PlotZ'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'basic shape of plot and any notable features to be considered', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Plots', 'COLUMN', 'PlotShape'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'text field for more plot details', 'SCHEMA', 'forestgeo', 'TABLE',
--      'Plots', 'COLUMN', 'PlotDescription'
-- go

create table forestgeo.Census
(
    CensusID         int not null
        constraint Census_pk
            primary key,
    PlotID           int
        constraint Census_Plots_PlotID_fk
            references forestgeo.Plots,
    PlotCensusNumber varchar(16),
    StartDate        date,
    EndDate          date,
    Description      varchar(max)
    )
    go

-- exec sp_addextendedproperty 'MS_Description', 'storing base census information', 'SCHEMA', 'forestgeo', 'TABLE',
--      'Census'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'PK identifying unique censuses', 'SCHEMA', 'forestgeo', 'TABLE',
--      'Census', 'COLUMN', 'CensusID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK identifying respective plot ', 'SCHEMA', 'forestgeo', 'TABLE',
--      'Census', 'COLUMN', 'PlotID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description',
--      'Integer census number for an individual plot, 1=first census, 2=second census, etc. If there are more than one plot in the database, each one has a census 1.',
--      'SCHEMA', 'forestgeo', 'TABLE', 'Census', 'COLUMN', 'PlotCensusNumber'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'Date on which the first measurement of the census was taken.', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Census', 'COLUMN', 'StartDate'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'Date on which the last measurement of the census was taken.', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Census', 'COLUMN', 'EndDate'
-- go
--
-- exec sp_addextendedproperty 'MS_Description',
--      'Notes pertinent to the census or general description of the conditions prevailing at the time.', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Census', 'COLUMN', 'Description'
-- go

create table forestgeo.Quadrats
(
    QuadratID    int not null
        constraint Quadrats_PK
            primary key,
    PlotID       int
        constraint Quadrats_Plots_FK
            references forestgeo.Plots,
    PersonnelID  int
        constraint Quadrats_Personnel_fk
            references forestgeo.Personnel,
    QuadratName  varchar(max),
    QuadratX     float,
    QuadratY     float,
    QuadratZ     float,
    DimensionX   int,
    DimensionY   int,
    Area         float,
    QuadratShape varchar(max)
)
    go

-- exec sp_addextendedproperty 'MS_Description', 'quadrat breakdown of plots', 'SCHEMA', 'forestgeo', 'TABLE', 'Quadrats'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'PK identifying quadrat IN plot', 'SCHEMA', 'forestgeo', 'TABLE',
--      'Quadrats', 'COLUMN', 'QuadratID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK pointing to plot --> one to many relationship plot:quadrat', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Quadrats', 'COLUMN', 'PlotID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK pointing to ID --> one person works each quadrat', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Quadrats', 'COLUMN', 'PersonnelID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'quick descriptive name for quadrat (not necessarily used)', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Quadrats', 'COLUMN', 'QuadratName'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'quadrat x coordinate (given by premeasured stake)', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Quadrats', 'COLUMN', 'QuadratX'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'quadrat y coordinate (given by premeasured stake)', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Quadrats', 'COLUMN', 'QuadratY'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'quadrat elevation coordinate (given by premeasured stake coordinate)',
--      'SCHEMA', 'forestgeo', 'TABLE', 'Quadrats', 'COLUMN', 'QuadratZ'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'x-dimension of quadrat (usually 20m)', 'SCHEMA', 'forestgeo', 'TABLE',
--      'Quadrats', 'COLUMN', 'DimensionX'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'y-dimension of quadrat (usually 20 meters)', 'SCHEMA', 'forestgeo',
--      'TABLE', 'Quadrats', 'COLUMN', 'DimensionY'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'area of specific quadrat in square meters', 'SCHEMA', 'forestgeo',
--      'TABLE', 'Quadrats', 'COLUMN', 'Area'
-- go
--
-- exec sp_addextendedproperty 'MS_Description',
--      'free text description of quadrat''s shape just in case it is not regular/does not confirm', 'SCHEMA', 'forestgeo',
--      'TABLE', 'Quadrats', 'COLUMN', 'QuadratShape'
-- go

create table forestgeo.Reference
(
    ReferenceID       int not null
        constraint Reference_pk
            primary key,
    PublicationTitle  varchar(64),
    FullReference     varchar(max),
    DateOfPublication date
)
    go

-- exec sp_addextendedproperty 'MS_Description',
--      'All the references and citations referred to in the Family, Genus, Species and SubSpecies tables', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Reference'
-- go
--
-- exec sp_addextendedproperty 'MS_Description',
--      'Primary key, an integer automatically generated to uniquely identify a reference or citation.', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Reference', 'COLUMN', 'ReferenceID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'Title of journal, book or other publication.', 'SCHEMA', 'forestgeo',
--      'TABLE', 'Reference', 'COLUMN', 'PublicationTitle'
-- go
--
-- exec sp_addextendedproperty 'MS_Description',
--      'Complete reference or citation ideally in format required for publication.', 'SCHEMA', 'forestgeo', 'TABLE',
--      'Reference', 'COLUMN', 'FullReference'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'Date of publication of journal etc. (format is yyyy-mm-dd).', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Reference', 'COLUMN', 'DateOfPublication'
-- go

create table forestgeo.Family
(
    FamilyID    int not null
        constraint Family_pk
            primary key,
    Family      varchar(32),
    ReferenceID int
        constraint Family_Reference_ReferenceID_fk
            references forestgeo.Reference
)
    go

-- exec sp_addextendedproperty 'MS_Description',
--      'Single record per family, following Angiosperm Phylogeny Group (APG) classification. All databases include the entire table of all Angiosperm families.',
--      'SCHEMA', 'forestgeo', 'TABLE', 'Family'
-- go
--
-- exec sp_addextendedproperty 'MS_Description',
--      'Taxonomic family name (from the Angiosperm Phylogeny Group - APG - system).', 'SCHEMA', 'forestgeo', 'TABLE',
--      'Family', 'COLUMN', 'Family'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK to Reference table', 'SCHEMA', 'forestgeo', 'TABLE', 'Family',
--      'COLUMN', 'ReferenceID'
-- go

create table forestgeo.Genus
(
    GenusID     int not null
        constraint Genus_pk
            primary key,
    FamilyID    int
        constraint Genus_Family_FamilyID_fk
            references forestgeo.Family,
    GenusName   varchar(32),
    ReferenceID int
        constraint Genus_Reference_ReferenceID_fk
            references forestgeo.Reference,
    Authority   varchar(32)
)
    go

-- exec sp_addextendedproperty 'MS_Description',
--      'Single record per genus, following Angiosperm Phylogeny Group classification. All databases include the entire table of all Angiosperm genera',
--      'SCHEMA', 'forestgeo', 'TABLE', 'Genus'
-- go
--
-- exec sp_addextendedproperty 'MS_Description',
--      'Primary key, an integer automatically generated to uniquely identify a plant genus.', 'SCHEMA', 'forestgeo',
--      'TABLE', 'Genus', 'COLUMN', 'GenusID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK reference to Family table', 'SCHEMA', 'forestgeo', 'TABLE', 'Genus',
--      'COLUMN', 'FamilyID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'Taxonomic genus of the plant, according to the APG system.', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Genus', 'COLUMN', 'GenusName'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'citation for taxonomic work on the genus.', 'SCHEMA', 'forestgeo',
--      'TABLE', 'Genus', 'COLUMN', 'ReferenceID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'Taxonomic authority for the classification of the genus.', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Genus', 'COLUMN', 'Authority'
-- go

create table forestgeo.Species
(
    SpeciesCode       varchar(10) not null
        constraint Species_pk
            primary key,
    GenusID           int
        constraint Species_Genus_GenusID_fk
            references forestgeo.Genus,
    CurrentTaxonFlag  bit,
    ObsoleteTaxonFlag bit,
    SpeciesName       varchar(64),
    IDLevel           varchar(8),
    Authority         varchar(128),
    FieldFamily       varchar(32),
    Description       varchar(max),
    ReferenceID       int
        constraint Species_Reference_ReferenceID_fk
            references forestgeo.Reference
)
    go

-- exec sp_addextendedproperty 'MS_Description',
--      'Single record for every species name ever used in the plot, whether current or obsolete. May be morphospecies. ',
--      'SCHEMA', 'forestgeo', 'TABLE', 'Species'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'unique code identifier', 'SCHEMA', 'forestgeo', 'TABLE', 'Species',
--      'COLUMN', 'SpeciesCode'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK to genus table', 'SCHEMA', 'forestgeo', 'TABLE', 'Species', 'COLUMN',
--      'GenusID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', '1 if name is current, 0 if not current.', 'SCHEMA', 'forestgeo', 'TABLE',
--      'Species', 'COLUMN', 'CurrentTaxonFlag'
-- go
--
-- exec sp_addextendedproperty 'MS_Description',
--      '1 if name is obsolete, 0 if not obsolete. A name can be both current and obsolete in different context eg. a taxon has been split.',
--      'SCHEMA', 'forestgeo', 'TABLE', 'Species', 'COLUMN', 'ObsoleteTaxonFlag'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'Species part of Latin name; (or may be a morphospecies name).', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Species', 'COLUMN', 'SpeciesName'
-- go
--
-- exec sp_addextendedproperty 'MS_Description',
--      'The deepest taxonomic level for which full identification is known. Limited to values species, genus, famil none, or multiple. None is used when family is not known. Multiple is used when the name may include mixture of more than one species.',
--      'SCHEMA', 'forestgeo', 'TABLE', 'Species', 'COLUMN', 'IDLevel'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'Taxonomic authority for the classification of the species.', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Species', 'COLUMN', 'Authority'
-- go
--
-- exec sp_addextendedproperty 'MS_Description',
--      'The family determination in the field. May be an obsolete family name no longer in the Family tabl Generally used when it is different from the Family table or to indicate family when the genus is unknow and should be NULL otherwise.',
--      'SCHEMA', 'forestgeo', 'TABLE', 'Species', 'COLUMN', 'FieldFamily'
-- go
--
-- exec sp_addextendedproperty 'MS_Description',
--      'A free text description of the species, as relevant for the plot (especially, who identified and how).', 'SCHEMA',
--      'forestgeo', 'TABLE', 'Species', 'COLUMN', 'Description'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK reference to Reference Table', 'SCHEMA', 'forestgeo', 'TABLE',
--      'Species', 'COLUMN', 'ReferenceID'
-- go

create table forestgeo.CurrentObsolete
(
    SpeciesCode         varchar(10) not null
        constraint CurrentObsolete_Species_SpeciesCode_fk
            references forestgeo.Species,
    ObsoleteSpeciesCode varchar(10) not null
        constraint CurrentObsolete_Species_SpeciesCode_fk2
            references forestgeo.Species,
    ChangeDate          date        not null,
    ChangeCodeID        int,
    ChangeNote          varchar(max),
    constraint CurrentObsolete_pk
        primary key (SpeciesCode, ObsoleteSpeciesCode, ChangeDate)
)
    go

-- exec sp_addextendedproperty 'MS_Description', 'One record for each event changing the name of one species.', 'SCHEMA',
--      'forestgeo', 'TABLE', 'CurrentObsolete'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK referencing species (new name)', 'SCHEMA', 'forestgeo', 'TABLE',
--      'CurrentObsolete', 'COLUMN', 'SpeciesCode'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK referencing species (old or obsolete name)', 'SCHEMA', 'forestgeo',
--      'TABLE', 'CurrentObsolete', 'COLUMN', 'ObsoleteSpeciesCode'
-- go

create table forestgeo.SubSpecies
(
    SubSpeciesCode     varchar(10) not null
        constraint SubSpecies_pk
            primary key,
    SpeciesCode        varchar(10)
        constraint SubSpecies_Species_SpeciesCode_fk
            references forestgeo.Species,
    CurrentTaxonFlag   bit,
    ObsoleteTaxonFlag  bit,
    SubSpeciesName     varchar(max),
    Authority          varchar(128),
    InfraSpecificLevel char(32)
)
    go

-- exec sp_addextendedproperty 'MS_Description',
--      'condit-referenced table of subspecies information respective to a species', 'SCHEMA', 'forestgeo', 'TABLE',
--      'SubSpecies'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'unique code identifier for subspecies --> replacement for mnemonic
-- field. up to 10-character code', 'SCHEMA', 'forestgeo', 'TABLE', 'SubSpecies', 'COLUMN', 'SubSpeciesCode'
-- go
--
-- exec sp_addextendedproperty 'MS_Description',
--      'FK referencing respective species for subspecies name --> up to 10-digit code', 'SCHEMA', 'forestgeo', 'TABLE',
--      'SubSpecies', 'COLUMN', 'SpeciesCode'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'boolean flag to indicate if taxonomically current name', 'SCHEMA',
--      'forestgeo', 'TABLE', 'SubSpecies', 'COLUMN', 'CurrentTaxonFlag'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'boolean taxonomic flag to indicate obsolete taxonomic flag.
-- a name can be both current and obsolete in different contexts (i.e., a
-- taxon has been split)', 'SCHEMA', 'forestgeo', 'TABLE', 'SubSpecies', 'COLUMN', 'ObsoleteTaxonFlag'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'string name of subspecies for reference', 'SCHEMA', 'forestgeo', 'TABLE',
--      'SubSpecies', 'COLUMN', 'SubSpeciesName'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'Taxonomic authority for the classification of the subspecies.', 'SCHEMA',
--      'forestgeo', 'TABLE', 'SubSpecies', 'COLUMN', 'Authority'
-- go
--
-- exec sp_addextendedproperty 'MS_Description',
--      'Indicates whether the name refers to a subspecies, a variety, a subvariety, a form, etc.', 'SCHEMA', 'forestgeo',
--      'TABLE', 'SubSpecies', 'COLUMN', 'InfraSpecificLevel'
-- go

create table forestgeo.SpeciesInventory
(
    SpeciesInventoryID int not null
        constraint SpeciesInventory_pk
            primary key,
    CensusID           int
        constraint SpeciesInventory_Census_CensusID_fk
            references forestgeo.Census,
    PlotID             int
        constraint SpeciesInventory_Plots_PlotID_fk
            references forestgeo.Plots,
    SpeciesCode        varchar(10)
        constraint SpeciesInventory_Species_SpeciesCode_fk
            references forestgeo.Species,
    SubSpeciesCode     varchar(10)
        constraint SpeciesInventory_SubSpecies_SubSpeciesCode_fk
            references forestgeo.SubSpecies
)
    go

-- exec sp_addextendedproperty 'MS_Description',
--      'Used only for plot-less inventories in which species presence alone is indicated. Each record indicates a single species observation at one site.',
--      'SCHEMA', 'forestgeo', 'TABLE', 'SpeciesInventory'
-- go
--
-- exec sp_addextendedproperty 'MS_Description',
--      'Primary key, an integer automatically generated to uniquely identify a species inventory record.', 'SCHEMA',
--      'forestgeo', 'TABLE', 'SpeciesInventory', 'COLUMN', 'SpeciesInventoryID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK to respective census', 'SCHEMA', 'forestgeo', 'TABLE',
--      'SpeciesInventory', 'COLUMN', 'CensusID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK to respective plot', 'SCHEMA', 'forestgeo', 'TABLE',
--      'SpeciesInventory', 'COLUMN', 'PlotID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK to respective species', 'SCHEMA', 'forestgeo', 'TABLE',
--      'SpeciesInventory', 'COLUMN', 'SpeciesCode'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK to respective subspecies', 'SCHEMA', 'forestgeo', 'TABLE',
--      'SpeciesInventory', 'COLUMN', 'SubSpeciesCode'
-- go

create table forestgeo.Trees
(
    TreeID      int not null
        constraint PK_Trees
            primary key,
    TreeTag     varchar(10),
    SpeciesCode varchar(10)
        constraint Trees_Species_SpeciesCode_fk
            references forestgeo.Species
)
    go

-- exec sp_addextendedproperty 'MS_Description', 'catalog of trees and species information (no other info set here)',
--      'SCHEMA', 'forestgeo', 'TABLE', 'Trees'
-- go
--
-- exec sp_addextendedproperty 'MS_Description',
--      'unique identifier for each species entry (by varchar code instead of int)', 'SCHEMA', 'forestgeo', 'TABLE',
--      'Trees', 'COLUMN', 'TreeTag'
-- go
--
-- exec sp_addextendedproperty 'MS_Description',
--      'unique identifier for each species entry (by varchar code instead of int)', 'SCHEMA', 'forestgeo', 'TABLE',
--      'Trees', 'COLUMN', 'SpeciesCode'
-- go

create table forestgeo.Stems
(
    StemID          int not null
        constraint PK_Stems
            primary key,
    TreeID          int
        constraint FK_Stems_Trees
            references forestgeo.Trees,
    QuadratID       int
        constraint FK_Stems_Quadrats
            references forestgeo.Quadrats,
    StemNumber      int,
    StemTag         int,
    TreeTag         int,
    StemX           float,
    StemY           float,
    StemZ           float,
    Moved           bit,
    StemDescription varchar(max)
    )
    go

-- exec sp_addextendedproperty 'MS_Description',
--      'All the stems in the plot from all the censuses, and their location. A stem may have moved to another location due to landslides.',
--      'SCHEMA', 'forestgeo', 'TABLE', 'Stems'
-- go

create table forestgeo.CoreMeasurements
(
    CoreMeasurementID int not null
        constraint CoreMeasurements_pk
            primary key,
    CensusID          int
        constraint CoreMeasurements_Census_CensusID_fk
            references forestgeo.Census,
    PlotID            int
        constraint CoreMeasurements_Plots_PlotID_fk
            references forestgeo.Plots,
    QuadratID         int
        constraint CoreMeasurements_Quadrats_QuadratID_fk
            references forestgeo.Quadrats,
    TreeID            int
        constraint FK_CoreMeasurements_Trees
            references forestgeo.Trees,
    StemID            int
        constraint FK_CoreMeasurements_Stems
            references forestgeo.Stems,
    PersonnelID       int
        constraint CoreMeasurements_Personnel_PersonnelID_fk
            references forestgeo.Personnel,
    MeasurementTypeID int
        constraint CoreMeasurements_MeasurementTypes_MeasurementTypeID_fk
            references forestgeo.MeasurementTypes,
    MeasurementDate   date,
    Measurement       varchar(max),
    IsRemeasurement   bit,
    IsCurrent         bit,
    UserDefinedFields varchar(max)
)
    go

-- exec sp_addextendedproperty 'MS_Description',
--      'Census measurement storage. designated "core" data, amended to add many-to-many conn to measurement types',
--      'SCHEMA', 'forestgeo', 'TABLE', 'CoreMeasurements'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'unique ID given to each measurement', 'SCHEMA', 'forestgeo', 'TABLE',
--      'CoreMeasurements', 'COLUMN', 'CoreMeasurementID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK identifying respective census', 'SCHEMA', 'forestgeo', 'TABLE',
--      'CoreMeasurements', 'COLUMN', 'CensusID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK identifying respective Plot', 'SCHEMA', 'forestgeo', 'TABLE',
--      'CoreMeasurements', 'COLUMN', 'PlotID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK identifying respective quadrat of measurement', 'SCHEMA', 'forestgeo',
--      'TABLE', 'CoreMeasurements', 'COLUMN', 'QuadratID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK IDing specific tree where measurement was taken', 'SCHEMA',
--      'forestgeo', 'TABLE', 'CoreMeasurements', 'COLUMN', 'TreeID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK IDing specific stem of measurement', 'SCHEMA', 'forestgeo', 'TABLE',
--      'CoreMeasurements', 'COLUMN', 'StemID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK to Personnel to ID person making measurements', 'SCHEMA', 'forestgeo',
--      'TABLE', 'CoreMeasurements', 'COLUMN', 'PersonnelID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'Date that measurement was recorded in yyyy-mm-dd format', 'SCHEMA',
--      'forestgeo', 'TABLE', 'CoreMeasurements', 'COLUMN', 'MeasurementDate'
-- go
--
-- exec sp_addextendedproperty 'MS_Description',
--      'Free text box for measurement. numbers and decimals should be converted to string before entry', 'SCHEMA',
--      'forestgeo', 'TABLE', 'CoreMeasurements', 'COLUMN', 'Measurement'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'Flag to indicate whether this measurement is a redo of another one',
--      'SCHEMA', 'forestgeo', 'TABLE', 'CoreMeasurements', 'COLUMN', 'IsRemeasurement'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'Flag to indicate if measurement is current/accurate', 'SCHEMA',
--      'forestgeo', 'TABLE', 'CoreMeasurements', 'COLUMN', 'IsCurrent'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'free text box for bag of JSON-defined user fields and data', 'SCHEMA',
--      'forestgeo', 'TABLE', 'CoreMeasurements', 'COLUMN', 'UserDefinedFields'
-- go

create table forestgeo.CMAttributes
(
    CMAID             int not null
        constraint CMAttributes_pk
            primary key,
    CoreMeasurementID int
        constraint CMAttributes_CoreMeasurements_CoreMeasurementID_fk
            references forestgeo.CoreMeasurements,
    Code              varchar(10)
        constraint CMAttributes_Attributes_Code_fk
            references forestgeo.Attributes
)
    go

-- exec sp_addextendedproperty 'MS_Description',
--      'Many-to-many structured table for recording attributes unique to a measurement, tree, or stem', 'SCHEMA',
--      'forestgeo', 'TABLE', 'CMAttributes'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'unique ID identifying a measurement-attribute combination', 'SCHEMA',
--      'forestgeo', 'TABLE', 'CMAttributes', 'COLUMN', 'CMAID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK reference to the respective measurement ID', 'SCHEMA', 'forestgeo',
--      'TABLE', 'CMAttributes', 'COLUMN', 'CoreMeasurementID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK reference to the respective attribute code', 'SCHEMA', 'forestgeo',
--      'TABLE', 'CMAttributes', 'COLUMN', 'Code'
-- go

-- create table CMTypes
-- (
--     CMTypeID          int not null
--         constraint CMTypes_pk
--             primary key,
--     CoreMeasurementID int
--         constraint CMTypes_CoreMeasurements_CoreMeasurementID_fk
--             references CoreMeasurements,
--     MeasurementTypeID int
--         constraint CMTypes_MeasurementTypes_MeasurementTypeID_fk
--             references MeasurementTypes
-- )
-- go

-- exec sp_addextendedproperty 'MS_Description', 'many-to-many pair system between MeasurementTypes and CoreMeasurements',
--      'SCHEMA', 'forestgeo', 'TABLE', 'CMTypes'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'unique pair ID', 'SCHEMA', 'forestgeo', 'TABLE', 'CMTypes', 'COLUMN',
--      'CMTypeID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK pointing to respective measurement ', 'SCHEMA', 'forestgeo', 'TABLE',
--      'CMTypes', 'COLUMN', 'CoreMeasurementID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK pointing to respective measurement type ID', 'SCHEMA', 'forestgeo',
--      'TABLE', 'CMTypes', 'COLUMN', 'MeasurementTypeID'
-- go

create table forestgeo.ValidationErrors
(
    ValidationErrorID          int not null
        constraint ValidationErrors_pk
            primary key,
    ValidationErrorDescription varchar(max)
    )
    go

-- exec sp_addextendedproperty 'MS_Description', 'many-to-many schema to track validation errors in insertion', 'SCHEMA',
--      'forestgeo', 'TABLE', 'ValidationErrors'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'unique ID assigned to validation error', 'SCHEMA', 'forestgeo', 'TABLE',
--      'ValidationErrors', 'COLUMN', 'ValidationErrorID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'text description of error/qualifying information', 'SCHEMA', 'forestgeo',
--      'TABLE', 'ValidationErrors', 'COLUMN', 'ValidationErrorDescription'
-- go

create table forestgeo.CMVErrors
(
    CMVErrorID        int not null
        constraint CMVErrors_pk
            primary key,
    CoreMeasurementID int
        constraint CMVErrors_CoreMeasurements_CoreMeasurementID_fk
            references forestgeo.CoreMeasurements,
    ValidationErrorID int
        constraint CMVErrors_ValidationErrors_ValidationErrorID_fk
            references forestgeo.ValidationErrors
)
    go

-- exec sp_addextendedproperty 'MS_Description',
--      'many-to-many connection point between CoreMeasurements and ValidationErrors', 'SCHEMA', 'forestgeo', 'TABLE',
--      'CMVErrors'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'unique ID referencing a measurement-error combination', 'SCHEMA',
--      'forestgeo', 'TABLE', 'CMVErrors', 'COLUMN', 'CMVErrorID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK referencing a unique measurement', 'SCHEMA', 'forestgeo', 'TABLE',
--      'CMVErrors', 'COLUMN', 'CoreMeasurementID'
-- go
--
-- exec sp_addextendedproperty 'MS_Description', 'FK referencing a unique error code', 'SCHEMA', 'forestgeo', 'TABLE',
--      'CMVErrors', 'COLUMN', 'ValidationErrorID'
-- go


