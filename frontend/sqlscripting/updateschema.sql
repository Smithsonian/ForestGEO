set foreign_key_checks = 0;
CREATE INDEX idx_attributes_codes ON attributes (Code);
CREATE INDEX idx_attributes_description ON attributes (Description);
CREATE INDEX idx_attributes_status ON attributes (Status);

ALTER TABLE measurementssummary
    DROP COLUMN DBHUnits,
    DROP COLUMN HOMUnits,
    DROP COLUMN StemUnits,
    ADD COLUMN UserDefinedFields JSON NULL;

ALTER TABLE measurementssummary
    DROP PRIMARY KEY,
    ADD PRIMARY KEY (CoreMeasurementID, StemID, TreeID, SpeciesID, QuadratID, PlotID, CensusID);

ALTER TABLE measurementssummary
    MODIFY COLUMN StemID INT NOT NULL,
    MODIFY COLUMN TreeID INT NOT NULL,
    MODIFY COLUMN SpeciesID INT NOT NULL,
    MODIFY COLUMN QuadratID INT NOT NULL,
    MODIFY COLUMN PlotID INT NOT NULL,
    MODIFY COLUMN CensusID INT NOT NULL;

CREATE INDEX idx_attributes ON measurementssummary (Attributes);
CREATE INDEX idx_censusid ON measurementssummary (CensusID);
CREATE INDEX idx_coremeasurementid ON measurementssummary (CoreMeasurementID);
CREATE INDEX idx_description ON measurementssummary (Description);
CREATE INDEX idx_isvalidated ON measurementssummary (IsValidated);
CREATE INDEX idx_measureddbh ON measurementssummary (MeasuredDBH);
CREATE INDEX idx_measuredhom ON measurementssummary (MeasuredHOM);
CREATE INDEX idx_measurementdate ON measurementssummary (MeasurementDate);
CREATE INDEX idx_plotid ON measurementssummary (PlotID);
CREATE INDEX idx_quadratid ON measurementssummary (QuadratID);
CREATE INDEX idx_quadratname ON measurementssummary (QuadratName);
CREATE INDEX idx_speciescode ON measurementssummary (SpeciesCode);
CREATE INDEX idx_speciesid ON measurementssummary (SpeciesID);
CREATE INDEX idx_speciesname ON measurementssummary (SpeciesName);
CREATE INDEX idx_stemid ON measurementssummary (StemID);
CREATE INDEX idx_stemlocalx ON measurementssummary (StemLocalX);
CREATE INDEX idx_stemlocaly ON measurementssummary (StemLocalY);
CREATE INDEX idx_stemtag ON measurementssummary (StemTag);
CREATE INDEX idx_subspeciesname ON measurementssummary (SubspeciesName);
CREATE INDEX idx_treeid ON measurementssummary (TreeID);
CREATE INDEX idx_treetag ON measurementssummary (TreeTag);

ALTER TABLE plots
    CHANGE COLUMN DimensionUnits DefaultDimensionUnits ENUM ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') DEFAULT 'm',
    CHANGE COLUMN CoordinateUnits DefaultCoordinateUnits ENUM ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') DEFAULT 'm',
    CHANGE COLUMN AreaUnits DefaultAreaUnits ENUM ('km2', 'hm2', 'dam2', 'm2', 'dm2', 'cm2', 'mm2') DEFAULT 'm2';

ALTER TABLE plots
    ADD COLUMN DefaultDBHUnits ENUM ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') DEFAULT 'mm' NOT NULL,
    ADD COLUMN DefaultHOMUnits ENUM ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') DEFAULT 'm'  NOT NULL;

CREATE INDEX idx_area ON plots (Area);
CREATE INDEX idx_countryname ON plots (CountryName);
CREATE INDEX idx_defaultareaunits ON plots (DefaultAreaUnits);
CREATE INDEX idx_defaultcoordinateunits ON plots (DefaultCoordinateUnits);
CREATE INDEX idx_defaultdbhunits ON plots (DefaultDBHUnits);
CREATE INDEX idx_defaultdimensionunits ON plots (DefaultDimensionUnits);
CREATE INDEX idx_defaulthomunits ON plots (DefaultHOMUnits);
CREATE INDEX idx_dimensionx ON plots (DimensionX);
CREATE INDEX idx_dimensiony ON plots (DimensionY);
CREATE INDEX idx_globalx ON plots (GlobalX);
CREATE INDEX idx_globaly ON plots (GlobalY);
CREATE INDEX idx_globalz ON plots (GlobalZ);
CREATE INDEX idx_locationname ON plots (LocationName);
CREATE INDEX idx_plotdescription ON plots (PlotDescription);
CREATE INDEX idx_plotname ON plots (PlotName);
CREATE INDEX idx_plotshape ON plots (PlotShape);

CREATE INDEX idx_description ON census (Description);
CREATE INDEX idx_enddate ON census (EndDate);
CREATE INDEX idx_plotcensusnumber ON census (PlotCensusNumber);
CREATE INDEX idx_plotid ON census (PlotID);
CREATE INDEX idx_startdate ON census (StartDate);

CREATE INDEX idx_description ON postvalidationqueries (Description(255));
CREATE INDEX idx_isenabled ON postvalidationqueries (IsEnabled);
CREATE INDEX idx_lastrunat ON postvalidationqueries (LastRunAt);
CREATE INDEX idx_lastrunresult ON postvalidationqueries (LastRunResult(255));
CREATE INDEX idx_lastrunstatus ON postvalidationqueries (LastRunStatus);
CREATE INDEX idx_querydefinition ON postvalidationqueries (QueryDefinition(255));
CREATE INDEX idx_queryname ON postvalidationqueries (QueryName);

ALTER TABLE quadrats
    DROP COLUMN DimensionUnits,
    DROP COLUMN CoordinateUnits;

CREATE INDEX idx_area ON quadrats (Area);
CREATE INDEX idx_dimensionx ON quadrats (DimensionX);
CREATE INDEX idx_dimensiony ON quadrats (DimensionY);
CREATE INDEX idx_plotid ON quadrats (PlotID);
CREATE INDEX idx_quadratname ON quadrats (QuadratName);
CREATE INDEX idx_quadratshape ON quadrats (QuadratShape);
CREATE INDEX idx_startx ON quadrats (StartX);
CREATE INDEX idx_starty ON quadrats (StartY);

ALTER TABLE species
    DROP CONSTRAINT SpeciesCode,
    ADD CONSTRAINT SpeciesCode UNIQUE (SpeciesCode, SpeciesName, SubspeciesName);

CREATE INDEX idx_description ON species (Description);
CREATE INDEX idx_fieldfamily ON species (FieldFamily);
CREATE INDEX idx_genusid ON species (GenusID);
CREATE INDEX idx_idlevel ON species (IDLevel);
CREATE INDEX idx_referenceid ON species (ReferenceID);
CREATE INDEX idx_speciesauthority ON species (SpeciesAuthority);
CREATE INDEX idx_speciescode ON species (SpeciesCode);
CREATE INDEX idx_speciesname ON species (SpeciesName);
CREATE INDEX idx_subspeciesauthority ON species (SubspeciesAuthority);
CREATE INDEX idx_subspeciesname ON species (SubspeciesName);
CREATE INDEX idx_validcode ON species (ValidCode);

ALTER TABLE stems
    ADD CONSTRAINT unique_stem_coordinates UNIQUE (StemTag, TreeID, QuadratID, LocalX, LocalY),
    DROP COLUMN CoordinateUnits;

CREATE INDEX idx_localx ON stems (LocalX);
CREATE INDEX idx_localy ON stems (LocalY);
CREATE INDEX idx_moved ON stems (Moved);
CREATE INDEX idx_quadratid ON stems (QuadratID);
CREATE INDEX idx_stemdescription ON stems (StemDescription);
CREATE INDEX idx_stemnumber ON stems (StemNumber);
CREATE INDEX idx_stemtag ON stems (StemTag);
CREATE INDEX idx_treeid ON stems (TreeID);

ALTER TABLE coremeasurements
    DROP COLUMN DBHUnit,
    DROP COLUMN HOMUnit;

ALTER TABLE coremeasurements
    ADD CONSTRAINT unique_measurements UNIQUE (CensusID, StemID, MeasuredDBH, MeasuredHOM);

CREATE INDEX idx_censusid ON coremeasurements (CensusID);
CREATE INDEX idx_description ON coremeasurements (Description);
CREATE INDEX idx_isvalidated ON coremeasurements (IsValidated);
CREATE INDEX idx_measureddbh ON coremeasurements (MeasuredDBH);
CREATE INDEX idx_measuredhom ON coremeasurements (MeasuredHOM);
CREATE INDEX idx_measurementdate ON coremeasurements (MeasurementDate);
CREATE INDEX idx_stemid ON coremeasurements (StemID);

ALTER TABLE cmattributes
    ADD CONSTRAINT unique_cm_attribute UNIQUE (CoreMeasurementID, Code);

ALTER TABLE cmverrors
    ADD CONSTRAINT unique_cmverrors_cm_valerror UNIQUE (CoreMeasurementID, ValidationErrorID);

CREATE INDEX idx_localx ON specimens (StemID);
CREATE INDEX idx_personnelid ON specimens (PersonnelID);
CREATE INDEX idx_speciesid ON specimens (SpeciesID);
CREATE INDEX idx_description ON specimens (Description);
CREATE INDEX idx_herbarium ON specimens (Herbarium);
CREATE INDEX idx_voucher ON specimens (Voucher);
CREATE INDEX idx_collectiondate ON specimens (CollectionDate);
CREATE INDEX idx_determinedby ON specimens (DeterminedBy);

CREATE INDEX idx_censusid ON unifiedchangelog (CensusID);
CREATE INDEX idx_changedby ON unifiedchangelog (ChangedBy);
CREATE INDEX idx_changetimestamp ON unifiedchangelog (ChangeTimestamp);
CREATE INDEX idx_operation ON unifiedchangelog (Operation);
CREATE INDEX idx_plotid ON unifiedchangelog (PlotID);
CREATE INDEX idx_recordid ON unifiedchangelog (RecordID);
CREATE INDEX idx_tablename ON unifiedchangelog (TableName);

CREATE INDEX idx_censusdescription ON viewfulltable (CensusDescription);
CREATE INDEX idx_censusenddate ON viewfulltable (CensusEndDate);
CREATE INDEX idx_censusid ON viewfulltable (CensusID);
CREATE INDEX idx_censusstartdate ON viewfulltable (CensusStartDate);
CREATE INDEX idx_coremeasurementid ON viewfulltable (CoreMeasurementID);
CREATE INDEX idx_countryname ON viewfulltable (CountryName);
CREATE INDEX idx_description ON viewfulltable (Description);
CREATE INDEX idx_dimensionx ON viewfulltable (DimensionX);
CREATE INDEX idx_dimensiony ON viewfulltable (DimensionY);
CREATE INDEX idx_family ON viewfulltable (Family);
CREATE INDEX idx_familyid ON viewfulltable (FamilyID);
CREATE INDEX idx_genus ON viewfulltable (Genus);
CREATE INDEX idx_genusauthority ON viewfulltable (GenusAuthority);
CREATE INDEX idx_genusid ON viewfulltable (GenusID);
CREATE INDEX idx_isvalidated ON viewfulltable (IsValidated);
CREATE INDEX idx_locationname ON viewfulltable (LocationName);
CREATE INDEX idx_measureddbh ON viewfulltable (MeasuredDBH);
CREATE INDEX idx_measuredhom ON viewfulltable (MeasuredHOM);
CREATE INDEX idx_measurementdate ON viewfulltable (MeasurementDate);
CREATE INDEX idx_plotarea ON viewfulltable (PlotArea);
CREATE INDEX idx_plotareaunits ON viewfulltable (PlotAreaUnits);
CREATE INDEX idx_plotcensusnumber ON viewfulltable (PlotCensusNumber);
CREATE INDEX idx_plotcoordinateunits ON viewfulltable (PlotCoordinateUnits);
CREATE INDEX idx_plotdescription ON viewfulltable (PlotDescription);
CREATE INDEX idx_plotdimensionunits ON viewfulltable (PlotDimensionUnits);
CREATE INDEX idx_plotglobalx ON viewfulltable (PlotGlobalX);
CREATE INDEX idx_plotglobaly ON viewfulltable (PlotGlobalY);
CREATE INDEX idx_plotglobalz ON viewfulltable (PlotGlobalZ);
CREATE INDEX idx_plotid ON viewfulltable (PlotID);
CREATE INDEX idx_plotname ON viewfulltable (PlotName);
CREATE INDEX idx_plotshape ON viewfulltable (PlotShape);
CREATE INDEX idx_quadrarea ON viewfulltable (QuadratArea);
CREATE INDEX idx_quadratdimensionx ON viewfulltable (QuadratDimensionX);
CREATE INDEX idx_quadratdimensiony ON viewfulltable (QuadratDimensionY);
CREATE INDEX idx_quadratid ON viewfulltable (QuadratID);
CREATE INDEX idx_quadratname ON viewfulltable (QuadratName);
CREATE INDEX idx_quadratshape ON viewfulltable (QuadratShape);
CREATE INDEX idx_quadratstartx ON viewfulltable (QuadratStartX);
CREATE INDEX idx_quadratstarty ON viewfulltable (QuadratStartY);
CREATE INDEX idx_speciescode ON viewfulltable (SpeciesCode);
CREATE INDEX idx_speciesid ON viewfulltable (SpeciesID);
CREATE INDEX idx_speciesidlevel ON viewfulltable (SpeciesIDLevel);
CREATE INDEX idx_speciesname ON viewfulltable (SpeciesName);
CREATE INDEX idx_stemid ON viewfulltable (StemID);
CREATE INDEX idx_stemlocalx ON viewfulltable (StemLocalX);
CREATE INDEX idx_stemlocaly ON viewfulltable (StemLocalY);
CREATE INDEX idx_stemtag ON viewfulltable (StemTag);
CREATE INDEX idx_subspeciesauthority ON viewfulltable (SubspeciesAuthority);
CREATE INDEX idx_subspeciesname ON viewfulltable (SubspeciesName);
CREATE INDEX idx_treeid ON viewfulltable (TreeID);
CREATE INDEX idx_treetag ON viewfulltable (TreeTag);

set foreign_key_checks = 1;