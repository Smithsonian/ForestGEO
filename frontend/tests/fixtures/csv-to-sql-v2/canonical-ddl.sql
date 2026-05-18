--
-- Database: `CTFS NEW DATABASE`
--

-- --------------------------------------------------------

--
-- Table structure for table `Census`
--

CREATE TABLE IF NOT EXISTS `Census` (
  `CensusID` int(10) unsigned NOT NULL auto_increment,
  `PlotID` int(10) unsigned NOT NULL,
  `PlotCensusNumber` char(16) default NULL,
  `StartDate` date default NULL,
  `EndDate` date default NULL,
  `Description` varchar(128) default NULL,
  PRIMARY KEY  (`CensusID`),
  KEY `Ref610` (`PlotID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `CensusQuadrat`
--

CREATE TABLE IF NOT EXISTS `CensusQuadrat` (
  `CensusID` int(10) unsigned NOT NULL,
  `QuadratID` int(10) unsigned NOT NULL,
  `CensusQuadratID` int(10) unsigned NOT NULL auto_increment,
  PRIMARY KEY  (`CensusQuadratID`),
  KEY `Ref534` (`CensusID`),
  KEY `QuadratID` (`QuadratID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `Coordinates`
--

CREATE TABLE IF NOT EXISTS `Coordinates` (
  `CoorID` int(10) unsigned NOT NULL auto_increment,
  `FeatureID` int(10) unsigned default NULL,
  `PlotID` int(10) unsigned default NULL,
  `QuadratID` int(10) unsigned default NULL,
  `GX` float default NULL,
  `GY` float default NULL,
  `GZ` float default NULL,
  `PX` float default NULL,
  `PY` float default NULL,
  `PZ` float default NULL,
  `QX` float default NULL,
  `QY` float default NULL,
  `QZ` float default NULL,
  `CoordinateNo` int(10) unsigned default NULL,
  PRIMARY KEY  (`CoorID`),
  KEY `FeatureID` (`FeatureID`),
  KEY `PlotID` (`PlotID`),
  KEY `QuadratID` (`QuadratID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `Country`
--

CREATE TABLE IF NOT EXISTS `Country` (
  `CountryID` smallint(5) unsigned NOT NULL auto_increment,
  `CountryName` varchar(64) default NULL,
  PRIMARY KEY  (`CountryID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `CurrentObsolete`
--

CREATE TABLE IF NOT EXISTS `CurrentObsolete` (
  `SpeciesID` int(10) unsigned NOT NULL,
  `ObsoleteSpeciesID` int(10) unsigned NOT NULL,
  `ChangeDate` datetime NOT NULL,
  `ChangeCodeID` int(10) unsigned NOT NULL,
  `ChangeNote` varchar(128) default NULL,
  PRIMARY KEY  (`SpeciesID`,`ObsoleteSpeciesID`,`ChangeDate`),
  KEY `Ref32191` (`ChangeCodeID`),
  KEY `Ref92192` (`SpeciesID`),
  KEY `Ref92212` (`ObsoleteSpeciesID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `DataCollection`
--

CREATE TABLE IF NOT EXISTS `DataCollection` (
  `CensusID` int(10) unsigned NOT NULL,
  `StartDate` date default NULL,
  `EndDate` date default NULL,
  `DataCollectionID` int(10) unsigned NOT NULL auto_increment,
  `PersonnelRoleID` int(10) unsigned NOT NULL,
  `QuadratID` int(10) unsigned NOT NULL,
  PRIMARY KEY  (`DataCollectionID`),
  KEY `Ref1743` (`CensusID`),
  KEY `QuadratID` (`QuadratID`),
  KEY `PersonnelRoleID` (`PersonnelRoleID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `DBH`
--

CREATE TABLE IF NOT EXISTS `DBH` (
  `MeasureID` int(10) unsigned NOT NULL,
  `CensusID` int(10) unsigned NOT NULL,
  `StemID` int(10) unsigned NOT NULL,
  `DBH` float default NULL,
  `HOM` char(16) default NULL,
  `PrimaryStem` varchar(20) default NULL,
  `ExactDate` date default NULL,
  `DBHID` int(10) unsigned NOT NULL auto_increment,
  `Comments` varchar(128) default NULL,
  PRIMARY KEY  (`DBHID`),
  KEY `Ref549` (`CensusID`),
  KEY `Ref1951` (`StemID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `DBHAttributes`
--

CREATE TABLE IF NOT EXISTS `DBHAttributes` (
  `CensusID` int(10) unsigned NOT NULL,
  `TSMID` int(10) unsigned NOT NULL,
  `DBHID` int(10) unsigned default NULL,
  `DBHAttID` int(10) unsigned NOT NULL auto_increment,
  PRIMARY KEY  (`DBHAttID`),
  KEY `Ref252` (`CensusID`),
  KEY `Ref2053` (`TSMID`),
  KEY `DBHID` (`DBHID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `Family`
--

CREATE TABLE IF NOT EXISTS `Family` (
  `FamilyID` int(10) unsigned NOT NULL auto_increment,
  `Family` char(32) default NULL,
  `ReferenceID` smallint(5) unsigned default NULL,
  PRIMARY KEY  (`FamilyID`),
  KEY `Ref84175` (`ReferenceID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `Features`
--

CREATE TABLE IF NOT EXISTS `Features` (
  `FeatureID` int(10) unsigned NOT NULL auto_increment,
  `FeatureTypeID` int(10) unsigned NOT NULL,
  `Name` varchar(32) NOT NULL,
  `ShortDescrip` varchar(32) default NULL,
  `LongDescrip` varchar(128) default NULL,
  PRIMARY KEY  (`FeatureID`),
  KEY `FeatureTypeID` (`FeatureTypeID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `FeatureTypes`
--

CREATE TABLE IF NOT EXISTS `FeatureTypes` (
  `FeatureTypeID` int(10) unsigned NOT NULL auto_increment,
  `Type` varchar(32) NOT NULL,
  PRIMARY KEY  (`FeatureTypeID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `Genus`
--

CREATE TABLE IF NOT EXISTS `Genus` (
  `GenusID` int(10) unsigned NOT NULL auto_increment,
  `Genus` char(32) default NULL,
  `ReferenceID` smallint(5) unsigned default NULL,
  `Authority` char(32) default NULL,
  `FamilyID` int(10) unsigned NOT NULL,
  PRIMARY KEY  (`GenusID`),
  KEY `Ref2868` (`FamilyID`),
  KEY `Ref84176` (`ReferenceID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `Log`
--

CREATE TABLE IF NOT EXISTS `Log` (
  `LogID` bigint(20) unsigned NOT NULL auto_increment,
  `PersonnelID` smallint(5) unsigned default NULL,
  `ChangedTable` varchar(32) NOT NULL,
  `PrimaryKey` varchar(32) NOT NULL,
  `ChangedColumn` varchar(32) NOT NULL,
  `ChangeDate` date default NULL,
  `ChangeTime` timestamp NOT NULL default CURRENT_TIMESTAMP on update CURRENT_TIMESTAMP,
  `Description` varchar(256) default NULL,
  `Action` enum('I','D','U') NOT NULL,
  `Old` varchar(512) NOT NULL,
  `New` varchar(512) NOT NULL,
  PRIMARY KEY  (`LogID`),
  KEY `PersonnelID` (`PersonnelID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `Measurement`
--

CREATE TABLE IF NOT EXISTS `Measurement` (
  `MeasureID` int(10) unsigned NOT NULL auto_increment,
  `CensusID` int(10) unsigned NOT NULL,
  `TreeID` int(10) unsigned NOT NULL,
  `StemID` int(10) unsigned NOT NULL,
  `MeasurementTypeID` int(10) unsigned NOT NULL,
  `Measure` varchar(256) NOT NULL,
  `ExactDate` date NOT NULL,
  `Comments` varchar(128) default NULL,
  PRIMARY KEY  (`MeasureID`),
  KEY `CensusID` (`CensusID`),
  KEY `TreeID` (`TreeID`),
  KEY `StemID` (`StemID`),
  KEY `MeasurementTypeID` (`MeasurementTypeID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `MeasurementAttributes`
--

CREATE TABLE IF NOT EXISTS `MeasurementAttributes` (
  `MAttID` int(10) unsigned NOT NULL auto_increment,
  `MeasureID` int(10) unsigned NOT NULL,
  `CensusID` int(10) unsigned NOT NULL,
  `TSMID` int(10) unsigned NOT NULL,
  PRIMARY KEY  (`MAttID`),
  KEY `MeasureID` (`MeasureID`),
  KEY `CensusID` (`CensusID`),
  KEY `TSMID` (`TSMID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `MeasurementType`
--

CREATE TABLE IF NOT EXISTS `MeasurementType` (
  `MeasurementTypeID` int(10) unsigned NOT NULL auto_increment,
  `UOM` varchar(32) NOT NULL,
  `Type` varchar(256) default NULL,
  PRIMARY KEY  (`MeasurementTypeID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `Personnel`
--

CREATE TABLE IF NOT EXISTS `Personnel` (
  `PersonnelID` smallint(5) unsigned NOT NULL auto_increment,
  `FirstName` varchar(32) default NULL,
  `LastName` varchar(32) NOT NULL,
  PRIMARY KEY  (`PersonnelID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `PersonnelRole`
--

CREATE TABLE IF NOT EXISTS `PersonnelRole` (
  `PersonnelRoleID` int(10) unsigned NOT NULL auto_increment,
  `PersonnelID` smallint(5) unsigned NOT NULL,
  `RoleID` smallint(5) unsigned NOT NULL,
  PRIMARY KEY  (`PersonnelRoleID`),
  KEY `RoleID` (`RoleID`),
  KEY `PersonnelID` (`PersonnelID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `Quadrat`
--

CREATE TABLE IF NOT EXISTS `Quadrat` (
  `PlotID` int(10) unsigned NOT NULL,
  `QuadratName` char(8) default NULL,
  `Area` float unsigned default NULL,
  `IsStandardShape` enum('Y','N') NOT NULL,
  `QuadratID` int(10) unsigned NOT NULL auto_increment,
  PRIMARY KEY  (`QuadratID`),
  KEY `Ref69` (`PlotID`),
  KEY `indQuadName` (`QuadratName`,`PlotID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `Reference`
--

CREATE TABLE IF NOT EXISTS `Reference` (
  `ReferenceID` smallint(5) unsigned NOT NULL auto_increment,
  `PublicationTitle` varchar(64) default NULL,
  `FullReference` varchar(256) default NULL,
  `DateofPublication` date default NULL,
  PRIMARY KEY  (`ReferenceID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `RemeasAttribs`
--

CREATE TABLE IF NOT EXISTS `RemeasAttribs` (
  `CensusID` int(10) unsigned NOT NULL,
  `TSMID` int(10) unsigned NOT NULL,
  `RemeasureID` int(10) unsigned NOT NULL,
  `RmAttID` int(10) unsigned NOT NULL auto_increment,
  PRIMARY KEY  (`RmAttID`),
  KEY `Ref2073` (`TSMID`),
  KEY `Ref2274` (`CensusID`),
  KEY `RemeasureID` (`RemeasureID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `Remeasurement`
--

CREATE TABLE IF NOT EXISTS `Remeasurement` (
  `CensusID` int(10) unsigned NOT NULL,
  `StemID` int(10) unsigned NOT NULL,
  `DBH` float default NULL,
  `HOM` float default NULL,
  `ExactDate` date default NULL,
  `RemeasureID` int(10) unsigned NOT NULL auto_increment,
  PRIMARY KEY  (`RemeasureID`),
  KEY `Ref1957` (`StemID`),
  KEY `Ref5106` (`CensusID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `RoleReference`
--

CREATE TABLE IF NOT EXISTS `RoleReference` (
  `RoleID` smallint(5) unsigned NOT NULL auto_increment,
  `Description` varchar(128) default NULL,
  PRIMARY KEY  (`RoleID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `Site`
--

CREATE TABLE IF NOT EXISTS `Site` (
  `PlotID` int(10) unsigned NOT NULL auto_increment,
  `PlotName` char(64) default NULL,
  `LocationName` varchar(128) default NULL,
  `CountryID` smallint(5) unsigned NOT NULL,
  `ShapeOfSite` char(32) default NULL,
  `DescriptionOfSite` varchar(128) default NULL,
  `Area` float unsigned NOT NULL,
  `QDimX` float unsigned NOT NULL,
  `QDimY` float unsigned NOT NULL,
  `GUOM` varchar(32) NOT NULL,
  `GZUOM` varchar(32) NOT NULL,
  `PUOM` varchar(32) NOT NULL,
  `QUOM` varchar(32) NOT NULL,
  `GCoorCollected` varchar(32) default NULL,
  `PCoorCollected` varchar(32) default NULL,
  `QCoorCollected` varchar(32) default NULL,
  `IsStandardSize` enum('Y','N') default NULL,
  PRIMARY KEY  (`PlotID`),
  KEY `Ref87173` (`CountryID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `Species`
--

CREATE TABLE IF NOT EXISTS `Species` (
  `SpeciesID` int(10) unsigned NOT NULL auto_increment,
  `CurrentTaxonFlag` smallint(6) default NULL,
  `ObsoleteTaxonFlag` smallint(6) default NULL,
  `GenusID` int(10) unsigned NOT NULL,
  `ReferenceID` smallint(5) unsigned default NULL,
  `SpeciesName` char(64) default NULL,
  `Mnemonic` char(10) default NULL,
  `Authority` varchar(128) default NULL,
  `IDLevel` char(8) default NULL,
  `FieldFamily` char(32) default NULL,
  `Description` varchar(128) default NULL,
  PRIMARY KEY  (`SpeciesID`),
  KEY `Ref26208` (`GenusID`),
  KEY `indMnemonic` (`Mnemonic`),
  KEY `Ref84209` (`ReferenceID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `SpeciesInventory`
--

CREATE TABLE IF NOT EXISTS `SpeciesInventory` (
  `SpeciesInvID` int(10) unsigned NOT NULL auto_increment,
  `CensusID` int(10) unsigned NOT NULL,
  `PlotID` int(10) unsigned NOT NULL,
  `SpeciesID` int(10) unsigned NOT NULL,
  `SubSpeciesID` int(10) unsigned default NULL,
  PRIMARY KEY  (`SpeciesInvID`),
  KEY `Ref92198` (`SpeciesID`),
  KEY `Ref93199` (`SubSpeciesID`),
  KEY `Ref5222` (`CensusID`),
  KEY `Ref642` (`PlotID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `Specimen`
--

CREATE TABLE IF NOT EXISTS `Specimen` (
  `SpecimenID` int(10) unsigned NOT NULL auto_increment,
  `TreeID` int(10) unsigned default NULL,
  `Collector` char(64) default NULL,
  `SpecimenNumber` int(10) unsigned default NULL,
  `SpeciesID` int(10) unsigned NOT NULL,
  `SubSpeciesID` int(10) unsigned default NULL,
  `Herbarium` char(32) default NULL,
  `Voucher` smallint(5) unsigned default NULL,
  `CollectionDate` date default NULL,
  `DeterminedBy` char(64) default NULL,
  `Description` varchar(128) default NULL,
  PRIMARY KEY  (`SpecimenID`),
  KEY `Ref93194` (`SubSpeciesID`),
  KEY `Ref92196` (`SpeciesID`),
  KEY `Ref1171` (`TreeID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `Stem`
--

CREATE TABLE IF NOT EXISTS `Stem` (
  `StemID` int(10) unsigned NOT NULL auto_increment,
  `TreeID` int(10) unsigned NOT NULL,
  `StemTag` varchar(32) default NULL,
  `StemDescription` varchar(128) default NULL,
  `QuadratID` int(10) unsigned NOT NULL,
  `StemNumber` int(10) unsigned NOT NULL,
  `Moved` enum('Y','N') NOT NULL default 'N',
  `GX` float default NULL,
  `GY` float default NULL,
  `GZ` float default NULL,
  `PX` float default NULL,
  `PY` float default NULL,
  `PZ` float default NULL,
  `QX` float default NULL,
  `QY` float default NULL,
  `QZ` float default NULL,
  PRIMARY KEY  (`StemID`),
  KEY `Ref150` (`TreeID`,`StemTag`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `SubSpecies`
--

CREATE TABLE IF NOT EXISTS `SubSpecies` (
  `SubSpeciesID` int(10) unsigned NOT NULL auto_increment,
  `SpeciesID` int(10) unsigned NOT NULL,
  `CurrentTaxonFlag` smallint(6) default NULL,
  `ObsoleteTaxonFlag` smallint(6) default NULL,
  `SubSpeciesName` char(64) default NULL,
  `Mnemonic` char(10) default NULL,
  `Authority` varchar(128) default NULL,
  `InfraSpecificLevel` char(32) default NULL,
  PRIMARY KEY  (`SubSpeciesID`),
  KEY `Ref92193` (`SpeciesID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `Tree`
--

CREATE TABLE IF NOT EXISTS `Tree` (
  `TreeID` int(10) unsigned NOT NULL auto_increment,
  `Tag` char(10) default NULL,
  `SpeciesID` int(10) unsigned NOT NULL,
  `SubSpeciesID` int(10) unsigned default NULL,
  PRIMARY KEY  (`TreeID`),
  KEY `Ref92217` (`SpeciesID`),
  KEY `Ref93219` (`SubSpeciesID`),
  KEY `indTreeTag` (`Tag`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `TreeAttributes`
--

CREATE TABLE IF NOT EXISTS `TreeAttributes` (
  `CensusID` int(10) unsigned NOT NULL,
  `TreeID` int(10) unsigned NOT NULL,
  `TSMID` int(10) unsigned NOT NULL,
  `TAttID` int(10) unsigned NOT NULL auto_increment,
  PRIMARY KEY  (`TAttID`),
  KEY `Ref163` (`TreeID`),
  KEY `Ref2064` (`TSMID`),
  KEY `Ref5107` (`CensusID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `TreeTaxChange`
--

CREATE TABLE IF NOT EXISTS `TreeTaxChange` (
  `ChangeCodeID` int(10) unsigned NOT NULL,
  `Description` varchar(128) default NULL,
  PRIMARY KEY  (`ChangeCodeID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

-- --------------------------------------------------------

--
-- Table structure for table `TSMAttributes`
--

CREATE TABLE IF NOT EXISTS `TSMAttributes` (
  `TSMID` int(10) unsigned NOT NULL auto_increment,
  `TSMCode` char(10) NOT NULL,
  `Description` varchar(128) NOT NULL,
  PRIMARY KEY  (`TSMID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `Census`
--
ALTER TABLE `Census`
  ADD CONSTRAINT `Census_ibfk_1` FOREIGN KEY (`PlotID`) REFERENCES `Site` (`PlotID`);

--
-- Constraints for table `CensusQuadrat`
--
ALTER TABLE `CensusQuadrat`
  ADD CONSTRAINT `CensusQuadrat_ibfk_1` FOREIGN KEY (`CensusID`) REFERENCES `Census` (`CensusID`),
  ADD CONSTRAINT `CensusQuadrat_ibfk_2` FOREIGN KEY (`QuadratID`) REFERENCES `Quadrat` (`QuadratID`);

--
-- Constraints for table `Coordinates`
--
ALTER TABLE `Coordinates`
  ADD CONSTRAINT `Coordinates_ibfk_1` FOREIGN KEY (`FeatureID`) REFERENCES `Features` (`FeatureID`),
  ADD CONSTRAINT `Coordinates_ibfk_2` FOREIGN KEY (`PlotID`) REFERENCES `Site` (`PlotID`),
  ADD CONSTRAINT `Coordinates_ibfk_3` FOREIGN KEY (`QuadratID`) REFERENCES `Quadrat` (`QuadratID`);

--
-- Constraints for table `CurrentObsolete`
--
ALTER TABLE `CurrentObsolete`
  ADD CONSTRAINT `CurrentObsolete_ibfk_1` FOREIGN KEY (`SpeciesID`) REFERENCES `Species` (`SpeciesID`),
  ADD CONSTRAINT `CurrentObsolete_ibfk_2` FOREIGN KEY (`ObsoleteSpeciesID`) REFERENCES `Species` (`SpeciesID`),
  ADD CONSTRAINT `CurrentObsolete_ibfk_3` FOREIGN KEY (`ChangeCodeID`) REFERENCES `TreeTaxChange` (`ChangeCodeID`);

--
-- Constraints for table `DataCollection`
--
ALTER TABLE `DataCollection`
  ADD CONSTRAINT `DataCollection_ibfk_4` FOREIGN KEY (`QuadratID`) REFERENCES `Quadrat` (`QuadratID`),
  ADD CONSTRAINT `DataCollection_ibfk_5` FOREIGN KEY (`CensusID`) REFERENCES `Census` (`CensusID`),
  ADD CONSTRAINT `DataCollection_ibfk_6` FOREIGN KEY (`PersonnelRoleID`) REFERENCES `PersonnelRole` (`PersonnelRoleID`);

--
-- Constraints for table `DBH`
--
ALTER TABLE `DBH`
  ADD CONSTRAINT `DBH_ibfk_1` FOREIGN KEY (`CensusID`) REFERENCES `Census` (`CensusID`),
  ADD CONSTRAINT `DBH_ibfk_2` FOREIGN KEY (`StemID`) REFERENCES `Stem` (`StemID`);

--
-- Constraints for table `DBHAttributes`
--
ALTER TABLE `DBHAttributes`
  ADD CONSTRAINT `DBHAttributes_ibfk_2` FOREIGN KEY (`TSMID`) REFERENCES `TSMAttributes` (`TSMID`),
  ADD CONSTRAINT `DBHAttributes_ibfk_3` FOREIGN KEY (`DBHID`) REFERENCES `DBH` (`DBHID`);

--
-- Constraints for table `Family`
--
ALTER TABLE `Family`
  ADD CONSTRAINT `Family_ibfk_1` FOREIGN KEY (`ReferenceID`) REFERENCES `Reference` (`ReferenceID`);

--
-- Constraints for table `Features`
--
ALTER TABLE `Features`
  ADD CONSTRAINT `Features_ibfk_1` FOREIGN KEY (`FeatureTypeID`) REFERENCES `FeatureTypes` (`FeatureTypeID`);

--
-- Constraints for table `Genus`
--
ALTER TABLE `Genus`
  ADD CONSTRAINT `Genus_ibfk_1` FOREIGN KEY (`FamilyID`) REFERENCES `Family` (`FamilyID`),
  ADD CONSTRAINT `Genus_ibfk_2` FOREIGN KEY (`ReferenceID`) REFERENCES `Reference` (`ReferenceID`);

--
-- Constraints for table `Log`
--
ALTER TABLE `Log`
  ADD CONSTRAINT `Log_ibfk_1` FOREIGN KEY (`PersonnelID`) REFERENCES `Personnel` (`PersonnelID`);

--
-- Constraints for table `Measurement`
--
ALTER TABLE `Measurement`
  ADD CONSTRAINT `Measurement_ibfk_1` FOREIGN KEY (`CensusID`) REFERENCES `Census` (`CensusID`),
  ADD CONSTRAINT `Measurement_ibfk_2` FOREIGN KEY (`TreeID`) REFERENCES `Tree` (`TreeID`),
  ADD CONSTRAINT `Measurement_ibfk_3` FOREIGN KEY (`StemID`) REFERENCES `Stem` (`StemID`),
  ADD CONSTRAINT `Measurement_ibfk_4` FOREIGN KEY (`MeasurementTypeID`) REFERENCES `MeasurementType` (`MeasurementTypeID`);

--
-- Constraints for table `MeasurementAttributes`
--
ALTER TABLE `MeasurementAttributes`
  ADD CONSTRAINT `MeasurementAttributes_ibfk_1` FOREIGN KEY (`MeasureID`) REFERENCES `Measurement` (`MeasureID`),
  ADD CONSTRAINT `MeasurementAttributes_ibfk_2` FOREIGN KEY (`CensusID`) REFERENCES `Census` (`CensusID`),
  ADD CONSTRAINT `MeasurementAttributes_ibfk_3` FOREIGN KEY (`TSMID`) REFERENCES `TSMAttributes` (`TSMID`);

--
-- Constraints for table `PersonnelRole`
--
ALTER TABLE `PersonnelRole`
  ADD CONSTRAINT `PersonnelRole_ibfk_1` FOREIGN KEY (`RoleID`) REFERENCES `RoleReference` (`RoleID`),
  ADD CONSTRAINT `PersonnelRole_ibfk_2` FOREIGN KEY (`PersonnelID`) REFERENCES `Personnel` (`PersonnelID`);

--
-- Constraints for table `Quadrat`
--
ALTER TABLE `Quadrat`
  ADD CONSTRAINT `Quadrat_ibfk_1` FOREIGN KEY (`PlotID`) REFERENCES `Site` (`PlotID`);

--
-- Constraints for table `RemeasAttribs`
--
ALTER TABLE `RemeasAttribs`
  ADD CONSTRAINT `RemeasAttribs_ibfk_2` FOREIGN KEY (`TSMID`) REFERENCES `TSMAttributes` (`TSMID`),
  ADD CONSTRAINT `RemeasAttribs_ibfk_3` FOREIGN KEY (`RemeasureID`) REFERENCES `Remeasurement` (`RemeasureID`);

--
-- Constraints for table `Remeasurement`
--
ALTER TABLE `Remeasurement`
  ADD CONSTRAINT `Remeasurement_ibfk_1` FOREIGN KEY (`CensusID`) REFERENCES `Census` (`CensusID`),
  ADD CONSTRAINT `Remeasurement_ibfk_3` FOREIGN KEY (`StemID`) REFERENCES `Stem` (`StemID`);

--
-- Constraints for table `Site`
--
ALTER TABLE `Site`
  ADD CONSTRAINT `Site_ibfk_1` FOREIGN KEY (`CountryID`) REFERENCES `Country` (`CountryID`);

--
-- Constraints for table `Species`
--
ALTER TABLE `Species`
  ADD CONSTRAINT `Species_ibfk_1` FOREIGN KEY (`GenusID`) REFERENCES `Genus` (`GenusID`);

--
-- Constraints for table `SpeciesInventory`
--
ALTER TABLE `SpeciesInventory`
  ADD CONSTRAINT `SpeciesInventory_ibfk_1` FOREIGN KEY (`CensusID`) REFERENCES `Census` (`CensusID`),
  ADD CONSTRAINT `SpeciesInventory_ibfk_2` FOREIGN KEY (`PlotID`) REFERENCES `Site` (`PlotID`),
  ADD CONSTRAINT `SpeciesInventory_ibfk_3` FOREIGN KEY (`SpeciesID`) REFERENCES `Species` (`SpeciesID`),
  ADD CONSTRAINT `SpeciesInventory_ibfk_4` FOREIGN KEY (`SubSpeciesID`) REFERENCES `SubSpecies` (`SubSpeciesID`);

--
-- Constraints for table `Specimen`
--
ALTER TABLE `Specimen`
  ADD CONSTRAINT `Specimen_ibfk_1` FOREIGN KEY (`SpeciesID`) REFERENCES `Species` (`SpeciesID`),
  ADD CONSTRAINT `Specimen_ibfk_2` FOREIGN KEY (`SubSpeciesID`) REFERENCES `SubSpecies` (`SubSpeciesID`),
  ADD CONSTRAINT `Specimen_ibfk_3` FOREIGN KEY (`TreeID`) REFERENCES `Tree` (`TreeID`);

--
-- Constraints for table `Stem`
--
ALTER TABLE `Stem`
  ADD CONSTRAINT `Stem_ibfk_1` FOREIGN KEY (`TreeID`) REFERENCES `Tree` (`TreeID`);

--
-- Constraints for table `SubSpecies`
--
ALTER TABLE `SubSpecies`
  ADD CONSTRAINT `SubSpecies_ibfk_1` FOREIGN KEY (`SpeciesID`) REFERENCES `Species` (`SpeciesID`);

--
-- Constraints for table `Tree`
--
ALTER TABLE `Tree`
  ADD CONSTRAINT `Tree_ibfk_2` FOREIGN KEY (`SpeciesID`) REFERENCES `Species` (`SpeciesID`),
  ADD CONSTRAINT `Tree_ibfk_3` FOREIGN KEY (`SubSpeciesID`) REFERENCES `SubSpecies` (`SubSpeciesID`);

--
-- Constraints for table `TreeAttributes`
--
ALTER TABLE `TreeAttributes`
  ADD CONSTRAINT `TreeAttributes_ibfk_1` FOREIGN KEY (`CensusID`) REFERENCES `Census` (`CensusID`),
  ADD CONSTRAINT `TreeAttributes_ibfk_2` FOREIGN KEY (`TreeID`) REFERENCES `Tree` (`TreeID`),
  ADD CONSTRAINT `TreeAttributes_ibfk_3` FOREIGN KEY (`TSMID`) REFERENCES `TSMAttributes` (`TSMID`);
#  Database changes and conversion script for major release 2014
# Shameema Esufali Last updated Aug 21 2014

# ***************************************************************************
# 1.  MAKE ID LEVELS CONSISTENT ACROSS DATABASES
# ***************************************************************************
/* ID LEVELS defined by R. Condit's email of August 16th 2012
#  addition of 'superspecies' to accomodate data from Taiwan

>>> Yes, AAAA** is correctly assigned IDlevel='multiple'.
>>>
>>> If all the remaining are valid morphospecies, then the IDlevel should
>>> be 'subspecies', 'species', 'genus', 'family', or 'none'. It gives the
>>> level of taxonomy to which the identity is known. So to answer your
>>> questions,
>>>
>>>> If we know up to variety, IDlevel =  'subspecies'
>>>> If known up to species, IDlevel = 'species'
>>>> If known up to genus (but valid morphospecies), IDlevel = 'genus'
>>>> If known only up to family (but valid morphospecies), IDlevel = 'family'
>>>
>>> IDlevel='none' is for cases of valid morphospecies for which the
>>> family is not known. There are a few of those around.
>>>
>>> The idea is that any IDlevel='multiple' should be excluded from
>>> species level analyses because they represent a mixture of species. In
>>> many plots, there is only one such mnemonic, as you have at Palanan.
>>> But there are some plots with many different 'multiple' mnemonics,
>>> such as FICU** to mean cases where the genus is known to be Ficus, but
>>> the mnemonic includes a mixture of different Ficus which can't be
>>> distinguished.
*/

# This data has to be converted from existing data.  Script updateidlevels.sql 
# goes through all the current and stable databases and updates them to valid equivalents 
 ALTER TABLE `Species` 
  MODIFY COLUMN IDLEVEL 
  ENUM('subspecies','species','superspecies','genus','family','multiple','none','variety');


# ***************************************************************************
# 2 ADD LIFEFORM TO SPECIES 
# ***************************************************************************
# This update can be done without data and sites advised to add data at their convenience
 ALTER TABLE `Species` 
  ADD COLUMN `Lifeform` 
  ENUM('Emergent Tree', 'Tree', 'Midcanopy Tree', 'Understory Tree', 'Shrub','Herb', 'Liana');
 

/*
use information_schema;
select c.table_name,c.column_name,c.table_schema from INFORMATION_SCHEMA.COLUMNS c where c.table_name='Species' and c.column_name='IDLevel' and 
c.table_schema like 'current_%' or c.table_schema like 'stable_%'

*/
  

# ***************************************************************************
# 3 ADD LOCALNAME TO SPECIES TABLE
# ***************************************************************************
# This update can be done without data and sites advised to add data at their convenience.  
# In some instances the data is available in the original files sent to us and 
# we (SL and SE) can do the update ourselves.

  ALTER TABLE `Species` ADD COLUMN `LocalName` VARCHAR(128);
  
  
# ***************************************************************************
# 4 ADD STATUS COLUMN TO TSMATTRIBUTES 
# ***************************************************************************

# Definition of these statuses

# 'alive' - Tree is alive
# 'dead' - Tree is dead
# 'not found' - Tree was recorded in previous census and not reported alive or dead in 
# current  census.  Should this be derived rather than specified as a status of an attribute?  
#    There are two cases.  1. Field workers mark it as missing 2. The data is just not there
# 'broken below'  - Tree is alive but the stem is broken.   

# This update can be done without data and we must ensure that the statuses are filled in.  Clear
# guidelines for this must be agreed so that SL and SE can, in consultation with the sites update the # TSMAttributes table for each site.

--  ALTER TABLE `TSMAttributes`  
--  ADD COLUMN `Status` ENUM('alive,alive-not measured','dead','not found','broken below');
  ALTER TABLE `TSMAttributes`  
  ADD COLUMN `Status` ENUM('alive','alive-not measured','dead','missing','broken below','stem dead');


# ***************************************************************************
# 5. RENAME TAX1temp TO ViewTaxonomy  
# ***************************************************************************
# Anudeep must change the script that creates this table.  Make the fields CHAR rather 
# than ENUM because this is a created view. 

  RENAME TABLE TAX1temp TO ViewTaxonomy;
  ALTER TABLE ViewTaxonomy ADD COLUMN `LocalName` VARCHAR(128);
  ALTER TABLE ViewTaxonomy ADD COLUMN FieldFamily CHAR(32);
  ALTER TABLE ViewTaxonomy ADD COLUMN `Lifeform` CHAR(32);
  ALTER TABLE ViewTaxonomy  MODIFY COLUMN IDLevel CHAR(32);
  

# ***************************************************************************  
# 6.  Remove CensusID from DBHAttributes, MeasurementAttributes and RemeasAttribs
# ***************************************************************************
/*
use INFORMATION_SCHEMA;
select TABLE_NAME,COLUMN_NAME,CONSTRAINT_NAME,
REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME from KEY_COLUMN_USAGE
where TABLE_SCHEMA = "stable_fushan" and TABLE_NAME = "MeasurementAttributes" 
and referenced_column_name is not NULL;
*/
ALTER TABLE MeasurementAttributes
  DROP FOREIGN KEY MeasurementAttributes_ibfk_2;
DROP INDEX censusid ON MeasurementAttributes;
ALTER TABLE DBHAttributes DROP COLUMN censusid;
ALTER TABLE MeasurementAttributes DROP COLUMN censusid;
ALTER TABLE RemeasAttribs DROP COLUMN censusid;

# ***************************************************************************  
# 7.  Add columns to ViewFullTable
# ***************************************************************************

ALTER TABLE ViewFullTable
 ADD COLUMN HighHOM bool,
 ADD COLUMN MainStem bool,
 MODIFY COLUMN Status VARCHAR(25);


#  Find and change the coordinates to decimal Stem, Coordinates and ViewFullTable  (check?)
# Have Taiwan run the update.

ALTER TABLE Stem MODIFY COLUMN GX decimal(16,5), MODIFY COLUMN GY decimal(16,5),MODIFY COLUMN GZ decimal(16,5);
ALTER TABLE Stem MODIFY COLUMN PX decimal(16,5), MODIFY COLUMN PY decimal(16,5),MODIFY COLUMN PZ decimal(16,5);
ALTER TABLE Stem MODIFY COLUMN QX decimal(16,5), MODIFY COLUMN QY decimal(16,5),MODIFY COLUMN QZ decimal(16,5);

ALTER TABLE Coordinates MODIFY COLUMN GX decimal(16,5), MODIFY COLUMN GY decimal(16,5),MODIFY COLUMN GZ decimal(16,5);
ALTER TABLE Coordinates MODIFY COLUMN PX decimal(16,5), MODIFY COLUMN PY decimal(16,5),MODIFY COLUMN PZ decimal(16,5);
ALTER TABLE Coordinates MODIFY COLUMN QX decimal(16,5), MODIFY COLUMN QY decimal(16,5),MODIFY COLUMN QZ decimal(16,5);

ALTER TABLE ViewFullTable MODIFY COLUMN PX decimal(16,5), MODIFY COLUMN PY decimal(16,5);
ALTER TABLE Coordinates MODIFY COLUMN QX decimal(16,5), MODIFY COLUMN QY decimal(16,5);




  

 






