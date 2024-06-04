###### Output:
```Text
Executing statement: DROP TABLE IF EXISTS `LogTreeHistoryd`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `LogMeasurementHistoryd`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `MeasurementAttributes`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `TreeAttributes`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `ViewFullTable`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Specimen`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `CurrentObsolete`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `TreeTaxChange`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `LogMAttrHistoryd`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `LogSpeciesInventory`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `CensusView`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Log`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `DBHAttributes`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `DBH`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `SpeciesInventory`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `SpeciesReference`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Coordinates`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Features`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `FeatureTypes`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `ViewTaxonomy`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `viewAbund`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `DataCollection`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `PersonnelRole`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Personnel`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `RoleReference`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `CensusQuadrat`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Quadrat`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Measurement`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `MeasurementType`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `RemeasAttribs`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Remeasurement`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Stem`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Tree`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `SubSpecies`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Species`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Genus`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Family`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Reference`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Census`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Site`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Country`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `TSMAttributes`;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Reference`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Reference` (   `ReferenceID` smallint(5) unsigned NOT NULL AUTO_INCREMENT,   `Citation` varchar(150) DEFAULT NULL,   `PublicationTitle` text,   `FullReference` text,   `DateofPublication` date DEFAULT NULL,   PRIMARY KEY (`ReferenceID`) ) ENGINE=InnoDB AUTO_INCREMENT=93 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `ViewTaxonomy`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `ViewTaxonomy` (   `ViewID` int(11) NOT NULL AUTO_INCREMENT,   `SpeciesID` int(11) DEFAULT NULL,   `SubspeciesID` int(11) DEFAULT NULL,   `Family` char(32) DEFAULT NULL,   `Mnemonic` char(10) DEFAULT NULL,   `Genus` char(32) DEFAULT NULL,   `SpeciesName` char(64) DEFAULT NULL,   `Rank` char(20) DEFAULT NULL,   `Subspecies` char(64) DEFAULT NULL,   `Authority` char(128) DEFAULT NULL,   `IDLevel` char(12) DEFAULT NULL,   `subspMnemonic` char(10) DEFAULT NULL,   `subspAuthority` varchar(120) DEFAULT NULL,   `FieldFamily` char(32) DEFAULT NULL,   `Lifeform` char(20) DEFAULT NULL,   `Description` text,   `wsg` decimal(10,6) DEFAULT NULL,   `wsglevel` enum('local','species','genus','family','none') DEFAULT NULL,   `ListOfOldNames` varchar(255) DEFAULT NULL,   `Specimens` varchar(255) DEFAULT NULL,   `Reference` varchar(255) DEFAULT NULL,   PRIMARY KEY (`ViewID`),   KEY `SpeciesID` (`SpeciesID`),   KEY `SubspeciesID` (`SubspeciesID`),   KEY `IDLevel` (`IDLevel`) ) ENGINE=MyISAM AUTO_INCREMENT=1413 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `viewAbund`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `viewAbund` (   `SpeciesID` int(11) DEFAULT NULL,   `SubSpeciesID` int(11) DEFAULT NULL,   `Genus` char(32) DEFAULT NULL,   `Species` char(64) DEFAULT NULL,   `SubSpecies` char(64) DEFAULT NULL,   `Mnemonic` char(10) DEFAULT NULL,   `Trees` int(11) DEFAULT NULL,   `Sites` int(11) DEFAULT NULL,   `IDLevel` char(12) DEFAULT NULL ) ENGINE=InnoDB DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `TSMAttributes`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `TSMAttributes` (   `TSMID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `TSMCode` char(10) NOT NULL,   `Description` varchar(128) NOT NULL,   `Status` enum('alive','alive-not measured','dead','missing','broken below','stem dead') DEFAULT NULL,   PRIMARY KEY (`TSMID`) ) ENGINE=InnoDB AUTO_INCREMENT=66 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `SpeciesReference`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `SpeciesReference` (   `SpRefID` int(11) NOT NULL AUTO_INCREMENT,   `SpeciesID` int(11) DEFAULT NULL,   `ReferenceID` int(11) DEFAULT NULL,   PRIMARY KEY (`SpRefID`),   KEY `SpeciesID` (`SpeciesID`),   KEY `ReferenceID` (`ReferenceID`) ) ENGINE=MyISAM AUTO_INCREMENT=118 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `LogSpeciesInventory`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `LogSpeciesInventory` (   `SpeciesInvHistID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `SpeciesInvID` int(10) unsigned NOT NULL,   `CensusID` int(10) unsigned NOT NULL,   `PlotID` int(10) unsigned NOT NULL,   `SpeciesID` int(10) unsigned NOT NULL,   `SubSpeciesID` int(10) unsigned DEFAULT NULL,   `DateOfChange` date DEFAULT NULL,   `DescriptionOfChange` varchar(128) DEFAULT NULL,   PRIMARY KEY (`SpeciesInvHistID`) ) ENGINE=InnoDB AUTO_INCREMENT=47 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `LogMAttrHistoryd`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `LogMAttrHistoryd` (   `LogMAttrHistoryID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `MeasureID` int(10) unsigned NOT NULL,   `CensusID` int(10) unsigned NOT NULL,   `TSMID` int(10) unsigned NOT NULL,   `DateOfChange` date DEFAULT NULL,   `DescriptionOfChange` varchar(128) DEFAULT NULL,   PRIMARY KEY (`LogMAttrHistoryID`),   KEY `Ref21225` (`MeasureID`,`CensusID`,`TSMID`) ) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Country`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Country` (   `CountryID` smallint(5) unsigned NOT NULL AUTO_INCREMENT,   `CountryName` varchar(64) DEFAULT NULL,   PRIMARY KEY (`CountryID`) ) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `TreeTaxChange`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `TreeTaxChange` (   `ChangeCodeID` int(10) unsigned NOT NULL,   `Description` varchar(128) DEFAULT NULL,   PRIMARY KEY (`ChangeCodeID`) ) ENGINE=InnoDB DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `RoleReference`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `RoleReference` (   `RoleID` smallint(5) unsigned NOT NULL AUTO_INCREMENT,   `Description` varchar(128) DEFAULT NULL,   PRIMARY KEY (`RoleID`) ) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `ViewFullTable`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `ViewFullTable` (   `DBHID` int(11) NOT NULL,   `PlotName` varchar(35) DEFAULT NULL,   `PlotID` int(11) DEFAULT NULL,   `Family` char(32) DEFAULT NULL,   `Genus` char(32) DEFAULT NULL,   `SpeciesName` char(64) DEFAULT NULL,   `Mnemonic` char(10) DEFAULT NULL,   `Subspecies` char(64) DEFAULT NULL,   `SpeciesID` int(11) DEFAULT NULL,   `SubspeciesID` int(11) DEFAULT NULL,   `QuadratName` varchar(12) DEFAULT NULL,   `QuadratID` int(11) DEFAULT NULL,   `PX` decimal(16,5) DEFAULT NULL,   `PY` decimal(16,5) DEFAULT NULL,   `QX` decimal(16,5) DEFAULT NULL,   `QY` decimal(16,5) DEFAULT NULL,   `TreeID` int(11) DEFAULT NULL,   `Tag` char(10) DEFAULT NULL,   `StemID` int(11) DEFAULT NULL,   `StemNumber` int(11) DEFAULT NULL,   `StemTag` varchar(32) DEFAULT NULL,   `PrimaryStem` char(20) DEFAULT NULL,   `CensusID` int(11) DEFAULT NULL,   `PlotCensusNumber` int(11) DEFAULT NULL,   `DBH` float DEFAULT NULL,   `HOM` decimal(10,2) DEFAULT NULL,   `ExactDate` date DEFAULT NULL,   `Date` int(11) DEFAULT NULL,   `ListOfTSM` varchar(256) DEFAULT NULL,   `HighHOM` tinyint(1) DEFAULT NULL,   `LargeStem` tinyint(1) DEFAULT NULL,   `Status` enum('alive','dead','stem dead','broken below','omitted','missing') DEFAULT 'alive',   PRIMARY KEY (`DBHID`),   KEY `SpeciesID` (`SpeciesID`),   KEY `SubspeciesID` (`SubspeciesID`),   KEY `QuadratID` (`QuadratID`),   KEY `TreeID` (`TreeID`),   KEY `StemID` (`StemID`),   KEY `Tag` (`Tag`),   KEY `CensusID` (`CensusID`),   KEY `Genus` (`Genus`,`SpeciesName`),   KEY `Mnemonic` (`Mnemonic`),   KEY `CensusID_2` (`CensusID`),   KEY `PlotCensusNumber` (`PlotCensusNumber`),   KEY `StemTag` (`StemTag`),   KEY `DBH` (`DBH`),   KEY `Date` (`Date`),   KEY `Date_2` (`Date`),   KEY `ListOfTSM` (`ListOfTSM`),   KEY `Status` (`Status`),   KEY `HighHOM` (`HighHOM`) ) ENGINE=MyISAM DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `LogTreeHistoryd`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `LogTreeHistoryd` (   `TreeID` int(10) unsigned NOT NULL,   `TreeHistoryID` int(10) unsigned NOT NULL,   `ChangeCodeID` int(10) unsigned DEFAULT NULL,   `ChangeDate` date DEFAULT NULL,   `ChangeDescription` varchar(128) DEFAULT NULL,   `QuadratID` int(10) unsigned DEFAULT NULL,   `PlotID` int(10) unsigned DEFAULT NULL,   `Tag` char(10) DEFAULT NULL,   `X` float DEFAULT NULL,   `Y` float DEFAULT NULL,   `SpeciesID` int(10) unsigned DEFAULT NULL,   `SubSpeciesID` int(10) unsigned DEFAULT NULL,   PRIMARY KEY (`TreeID`,`TreeHistoryID`),   KEY `Ref186` (`TreeID`),   KEY `Ref32221` (`ChangeCodeID`) ) ENGINE=InnoDB DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `MeasurementType`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `MeasurementType` (   `MeasurementTypeID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `UOM` varchar(32) NOT NULL,   `Type` varchar(256) DEFAULT NULL,   PRIMARY KEY (`MeasurementTypeID`) ) ENGINE=InnoDB DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Personnel`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Personnel` (   `PersonnelID` smallint(5) unsigned NOT NULL AUTO_INCREMENT,   `FirstName` varchar(32) DEFAULT NULL,   `LastName` varchar(32) NOT NULL,   PRIMARY KEY (`PersonnelID`) ) ENGINE=InnoDB AUTO_INCREMENT=109 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `LogMeasurementHistoryd`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `LogMeasurementHistoryd` (   `MeasureID` int(10) unsigned NOT NULL,   `CensusID` int(10) unsigned NOT NULL,   `MeasurementHistoryID` int(10) unsigned NOT NULL,   `StemID` int(10) unsigned DEFAULT NULL,   `TreeID` int(10) unsigned DEFAULT NULL,   `DateOfChange` date NOT NULL,   `DescriptionOfChange` varchar(128) DEFAULT NULL,   `DBH` float DEFAULT NULL,   `HOM` float DEFAULT NULL,   `ExactDate` date DEFAULT NULL,   PRIMARY KEY (`MeasureID`,`CensusID`,`MeasurementHistoryID`),   KEY `Ref287` (`MeasureID`,`CensusID`) ) ENGINE=InnoDB DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `FeatureTypes`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `FeatureTypes` (   `FeatureTypeID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `Type` varchar(32) NOT NULL,   PRIMARY KEY (`FeatureTypeID`) ) ENGINE=InnoDB DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Country`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Country` (   `CountryID` smallint(5) unsigned NOT NULL AUTO_INCREMENT,   `CountryName` varchar(64) DEFAULT NULL,   PRIMARY KEY (`CountryID`) ) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Site`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Site` (   `PlotID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `PlotName` char(64) DEFAULT NULL,   `LocationName` varchar(128) DEFAULT NULL,   `CountryID` smallint(5) unsigned NOT NULL,   `ShapeOfSite` char(32) DEFAULT NULL,   `DescriptionOfSite` varchar(128) DEFAULT NULL,   `Area` float unsigned NOT NULL,   `QDimX` float unsigned NOT NULL,   `QDimY` float unsigned NOT NULL,   `GUOM` varchar(32) NOT NULL,   `GZUOM` varchar(32) NOT NULL,   `PUOM` varchar(32) NOT NULL,   `QUOM` varchar(32) NOT NULL,   `GCoorCollected` varchar(32) DEFAULT NULL,   `PCoorCollected` varchar(32) DEFAULT NULL,   `QCoorCollected` varchar(32) DEFAULT NULL,   `IsStandardSize` enum('Y','N') DEFAULT NULL,   PRIMARY KEY (`PlotID`),   KEY `Ref87173` (`CountryID`),   CONSTRAINT `Site_ibfk_1` FOREIGN KEY (`CountryID`) REFERENCES `Country` (`CountryID`) ) ENGINE=InnoDB AUTO_INCREMENT=189 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Quadrat`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Quadrat` (   `PlotID` int(10) unsigned NOT NULL,   `QuadratName` char(8) DEFAULT NULL,   `Area` float unsigned DEFAULT NULL,   `IsStandardShape` enum('Y','N') NOT NULL,   `QuadratID` int(10) unsigned NOT NULL AUTO_INCREMENT,   PRIMARY KEY (`QuadratID`),   KEY `Ref69` (`PlotID`),   KEY `QuadratName` (`QuadratName`,`PlotID`),   CONSTRAINT `Quadrat_ibfk_1` FOREIGN KEY (`PlotID`) REFERENCES `Site` (`PlotID`) ) ENGINE=InnoDB AUTO_INCREMENT=3160 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Census`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Census` (   `CensusID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `PlotID` int(10) unsigned NOT NULL,   `PlotCensusNumber` char(16) DEFAULT NULL,   `StartDate` date DEFAULT NULL,   `EndDate` date DEFAULT NULL,   `Description` varchar(128) DEFAULT NULL,   PRIMARY KEY (`CensusID`),   KEY `Ref610` (`PlotID`),   CONSTRAINT `Census_ibfk_1` FOREIGN KEY (`PlotID`) REFERENCES `Site` (`PlotID`) ) ENGINE=InnoDB AUTO_INCREMENT=289 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `RoleReference`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `RoleReference` (   `RoleID` smallint(5) unsigned NOT NULL AUTO_INCREMENT,   `Description` varchar(128) DEFAULT NULL,   PRIMARY KEY (`RoleID`) ) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Personnel`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Personnel` (   `PersonnelID` smallint(5) unsigned NOT NULL AUTO_INCREMENT,   `FirstName` varchar(32) DEFAULT NULL,   `LastName` varchar(32) NOT NULL,   PRIMARY KEY (`PersonnelID`) ) ENGINE=InnoDB AUTO_INCREMENT=109 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `PersonnelRole`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `PersonnelRole` (   `PersonnelRoleID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `PersonnelID` smallint(5) unsigned NOT NULL,   `RoleID` smallint(5) unsigned NOT NULL,   PRIMARY KEY (`PersonnelRoleID`),   KEY `RoleID` (`RoleID`),   KEY `PersonnelID` (`PersonnelID`),   CONSTRAINT `PersonnelRole_ibfk_1` FOREIGN KEY (`RoleID`) REFERENCES `RoleReference` (`RoleID`),   CONSTRAINT `PersonnelRole_ibfk_2` FOREIGN KEY (`PersonnelID`) REFERENCES `Personnel` (`PersonnelID`) ) ENGINE=InnoDB AUTO_INCREMENT=71 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `DataCollection`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `DataCollection` (   `CensusID` int(10) unsigned NOT NULL,   `StartDate` date DEFAULT NULL,   `EndDate` date DEFAULT NULL,   `DataCollectionID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `PersonnelRoleID` int(10) unsigned NOT NULL,   `QuadratID` int(10) unsigned NOT NULL,   PRIMARY KEY (`DataCollectionID`),   KEY `Ref1743` (`CensusID`),   KEY `QuadratID` (`QuadratID`),   KEY `PersonnelRoleID` (`PersonnelRoleID`),   CONSTRAINT `DataCollection_ibfk_4` FOREIGN KEY (`QuadratID`) REFERENCES `Quadrat` (`QuadratID`),   CONSTRAINT `DataCollection_ibfk_5` FOREIGN KEY (`CensusID`) REFERENCES `Census` (`CensusID`),   CONSTRAINT `DataCollection_ibfk_6` FOREIGN KEY (`PersonnelRoleID`) REFERENCES `PersonnelRole` (`PersonnelRoleID`) ) ENGINE=InnoDB AUTO_INCREMENT=11965 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Reference`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Reference` (   `ReferenceID` smallint(5) unsigned NOT NULL AUTO_INCREMENT,   `Citation` varchar(150) DEFAULT NULL,   `PublicationTitle` text,   `FullReference` text,   `DateofPublication` date DEFAULT NULL,   PRIMARY KEY (`ReferenceID`) ) ENGINE=InnoDB AUTO_INCREMENT=93 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Family`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Family` (   `FamilyID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `Family` char(32) DEFAULT NULL,   `ReferenceID` smallint(5) unsigned DEFAULT NULL,   PRIMARY KEY (`FamilyID`),   KEY `Ref84175` (`ReferenceID`),   CONSTRAINT `Family_ibfk_1` FOREIGN KEY (`ReferenceID`) REFERENCES `Reference` (`ReferenceID`) ) ENGINE=InnoDB AUTO_INCREMENT=555 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Genus`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Genus` (   `GenusID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `Genus` char(32) DEFAULT NULL,   `ReferenceID` smallint(5) unsigned DEFAULT NULL,   `Authority` char(32) DEFAULT NULL,   `FamilyID` int(10) unsigned NOT NULL,   PRIMARY KEY (`GenusID`),   KEY `Ref2868` (`FamilyID`),   KEY `Ref84176` (`ReferenceID`),   CONSTRAINT `Genus_ibfk_1` FOREIGN KEY (`FamilyID`) REFERENCES `Family` (`FamilyID`),   CONSTRAINT `Genus_ibfk_2` FOREIGN KEY (`ReferenceID`) REFERENCES `Reference` (`ReferenceID`) ) ENGINE=InnoDB AUTO_INCREMENT=21303 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Species`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Species` (   `SpeciesID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `CurrentTaxonFlag` smallint(6) DEFAULT NULL,   `ObsoleteTaxonFlag` smallint(6) DEFAULT NULL,   `GenusID` int(10) unsigned NOT NULL,   `SpeciesName` char(64) DEFAULT NULL,   `Mnemonic` char(10) DEFAULT NULL,   `Authority` varchar(128) DEFAULT NULL,   `IDLEVEL` enum('subspecies','species','superspecies','genus','family','multiple','none','variety') DEFAULT NULL,   `FieldFamily` char(32) DEFAULT NULL,   `Description` text,   `Lifeform` enum('Emergent Tree','Tree','Midcanopy Tree','Understory Tree','Shrub','Herb','Liana') DEFAULT NULL,   `LocalName` varchar(128) DEFAULT NULL,   PRIMARY KEY (`SpeciesID`),   KEY `Ref26208` (`GenusID`),   KEY `Mnemonic` (`Mnemonic`),   CONSTRAINT `Species_ibfk_1` FOREIGN KEY (`GenusID`) REFERENCES `Genus` (`GenusID`) ) ENGINE=InnoDB AUTO_INCREMENT=1709 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `SubSpecies`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `SubSpecies` (   `SubSpeciesID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `SpeciesID` int(10) unsigned NOT NULL,   `CurrentTaxonFlag` smallint(6) DEFAULT NULL,   `ObsoleteTaxonFlag` smallint(6) DEFAULT NULL,   `SubSpeciesName` char(64) DEFAULT NULL,   `Mnemonic` char(10) DEFAULT NULL,   `Authority` varchar(128) DEFAULT NULL,   `InfraSpecificLevel` char(32) DEFAULT NULL,   PRIMARY KEY (`SubSpeciesID`),   KEY `Ref92193` (`SpeciesID`),   CONSTRAINT `SubSpecies_ibfk_1` FOREIGN KEY (`SpeciesID`) REFERENCES `Species` (`SpeciesID`) ) ENGINE=InnoDB AUTO_INCREMENT=35 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Tree`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Tree` (   `TreeID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `Tag` char(10) DEFAULT NULL,   `SpeciesID` int(10) unsigned NOT NULL,   `SubSpeciesID` int(10) unsigned DEFAULT NULL,   PRIMARY KEY (`TreeID`),   KEY `Ref92217` (`SpeciesID`),   KEY `Ref93219` (`SubSpeciesID`),   KEY `Tag` (`Tag`),   CONSTRAINT `Tree_ibfk_2` FOREIGN KEY (`SpeciesID`) REFERENCES `Species` (`SpeciesID`),   CONSTRAINT `Tree_ibfk_3` FOREIGN KEY (`SubSpeciesID`) REFERENCES `SubSpecies` (`SubSpeciesID`) ) ENGINE=InnoDB AUTO_INCREMENT=526117 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Stem`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Stem` (   `StemID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `TreeID` int(10) unsigned NOT NULL,   `StemTag` varchar(32) DEFAULT NULL,   `StemDescription` varchar(128) DEFAULT NULL,   `QuadratID` int(10) unsigned NOT NULL,   `StemNumber` int(10) unsigned NOT NULL,   `Moved` enum('Y','N') NOT NULL DEFAULT 'N',   `GX` decimal(16,5) DEFAULT NULL,   `GY` decimal(16,5) DEFAULT NULL,   `GZ` decimal(16,5) DEFAULT NULL,   `PX` decimal(16,5) DEFAULT NULL,   `PY` decimal(16,5) DEFAULT NULL,   `PZ` decimal(16,5) DEFAULT NULL,   `QX` decimal(16,5) DEFAULT NULL,   `QY` decimal(16,5) DEFAULT NULL,   `QZ` decimal(16,5) DEFAULT NULL,   PRIMARY KEY (`StemID`),   KEY `Ref150` (`TreeID`),   CONSTRAINT `Stem_ibfk_1` FOREIGN KEY (`TreeID`) REFERENCES `Tree` (`TreeID`) ) ENGINE=InnoDB AUTO_INCREMENT=1077728 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `MeasurementType`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `MeasurementType` (   `MeasurementTypeID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `UOM` varchar(32) NOT NULL,   `Type` varchar(256) DEFAULT NULL,   PRIMARY KEY (`MeasurementTypeID`) ) ENGINE=InnoDB DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Measurement`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Measurement` (   `MeasureID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `CensusID` int(10) unsigned NOT NULL,   `TreeID` int(10) unsigned NOT NULL,   `StemID` int(10) unsigned NOT NULL,   `MeasurementTypeID` int(10) unsigned NOT NULL,   `Measure` varchar(256) NOT NULL,   `ExactDate` date NOT NULL,   `Comments` varchar(128) DEFAULT NULL,   PRIMARY KEY (`MeasureID`),   KEY `CensusID` (`CensusID`),   KEY `TreeID` (`TreeID`),   KEY `StemID` (`StemID`),   KEY `MeasurementTypeID` (`MeasurementTypeID`),   CONSTRAINT `Measurement_ibfk_1` FOREIGN KEY (`CensusID`) REFERENCES `Census` (`CensusID`),   CONSTRAINT `Measurement_ibfk_2` FOREIGN KEY (`TreeID`) REFERENCES `Tree` (`TreeID`),   CONSTRAINT `Measurement_ibfk_3` FOREIGN KEY (`StemID`) REFERENCES `Stem` (`StemID`),   CONSTRAINT `Measurement_ibfk_4` FOREIGN KEY (`MeasurementTypeID`) REFERENCES `MeasurementType` (`MeasurementTypeID`) ) ENGINE=InnoDB DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `CensusQuadrat`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `CensusQuadrat` (   `CensusID` int(10) unsigned NOT NULL,   `QuadratID` int(10) unsigned NOT NULL,   `CensusQuadratID` int(10) unsigned NOT NULL AUTO_INCREMENT,   PRIMARY KEY (`CensusQuadratID`),   KEY `Ref534` (`CensusID`),   KEY `QuadratID` (`QuadratID`),   CONSTRAINT `CensusQuadrat_ibfk_1` FOREIGN KEY (`CensusID`) REFERENCES `Census` (`CensusID`),   CONSTRAINT `CensusQuadrat_ibfk_2` FOREIGN KEY (`QuadratID`) REFERENCES `Quadrat` (`QuadratID`) ) ENGINE=InnoDB AUTO_INCREMENT=14749 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `TSMAttributes`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `TSMAttributes` (   `TSMID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `TSMCode` char(10) NOT NULL,   `Description` varchar(128) NOT NULL,   `Status` enum('alive','alive-not measured','dead','missing','broken below','stem dead') DEFAULT NULL,   PRIMARY KEY (`TSMID`) ) ENGINE=InnoDB AUTO_INCREMENT=66 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Remeasurement`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Remeasurement` (   `CensusID` int(10) unsigned NOT NULL,   `StemID` int(10) unsigned NOT NULL,   `DBH` float DEFAULT NULL,   `HOM` float DEFAULT NULL,   `ExactDate` date DEFAULT NULL,   `RemeasureID` int(10) unsigned NOT NULL AUTO_INCREMENT,   PRIMARY KEY (`RemeasureID`),   KEY `Ref1957` (`StemID`),   KEY `Ref5106` (`CensusID`),   CONSTRAINT `Remeasurement_ibfk_1` FOREIGN KEY (`CensusID`) REFERENCES `Census` (`CensusID`),   CONSTRAINT `Remeasurement_ibfk_3` FOREIGN KEY (`StemID`) REFERENCES `Stem` (`StemID`) ) ENGINE=InnoDB AUTO_INCREMENT=4071 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `RemeasAttribs`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `RemeasAttribs` (   `TSMID` int(10) unsigned NOT NULL,   `RemeasureID` int(10) unsigned NOT NULL,   `RmAttID` int(10) unsigned NOT NULL AUTO_INCREMENT,   PRIMARY KEY (`RmAttID`),   KEY `Ref2073` (`TSMID`),   KEY `RemeasureID` (`RemeasureID`),   CONSTRAINT `RemeasAttribs_ibfk_2` FOREIGN KEY (`TSMID`) REFERENCES `TSMAttributes` (`TSMID`),   CONSTRAINT `RemeasAttribs_ibfk_3` FOREIGN KEY (`RemeasureID`) REFERENCES `Remeasurement` (`RemeasureID`) ) ENGINE=InnoDB AUTO_INCREMENT=1730 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `DBH`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `DBH` (   `CensusID` int(10) unsigned NOT NULL,   `StemID` int(10) unsigned NOT NULL,   `DBH` float DEFAULT NULL,   `HOM` decimal(10,2) DEFAULT NULL,   `PrimaryStem` varchar(20) DEFAULT NULL,   `ExactDate` date DEFAULT NULL,   `DBHID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `Comments` varchar(128) DEFAULT NULL,   PRIMARY KEY (`DBHID`),   KEY `Ref549` (`CensusID`),   KEY `Ref1951` (`StemID`),   CONSTRAINT `DBH_ibfk_1` FOREIGN KEY (`CensusID`) REFERENCES `Census` (`CensusID`),   CONSTRAINT `DBH_ibfk_2` FOREIGN KEY (`StemID`) REFERENCES `Stem` (`StemID`) ) ENGINE=InnoDB AUTO_INCREMENT=2759651 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `DBHAttributes`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `DBHAttributes` (   `TSMID` int(10) unsigned NOT NULL,   `DBHID` int(10) unsigned DEFAULT NULL,   `DBHAttID` int(10) unsigned NOT NULL AUTO_INCREMENT,   PRIMARY KEY (`DBHAttID`),   KEY `Ref2053` (`TSMID`),   KEY `DBHID` (`DBHID`),   CONSTRAINT `DBHAttributes_ibfk_2` FOREIGN KEY (`TSMID`) REFERENCES `TSMAttributes` (`TSMID`),   CONSTRAINT `DBHAttributes_ibfk_3` FOREIGN KEY (`DBHID`) REFERENCES `DBH` (`DBHID`) ) ENGINE=InnoDB AUTO_INCREMENT=987997 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `SpeciesInventory`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `SpeciesInventory` (   `SpeciesInvID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `CensusID` int(10) unsigned NOT NULL,   `PlotID` int(10) unsigned NOT NULL,   `SpeciesID` int(10) unsigned NOT NULL,   `SubSpeciesID` int(10) unsigned DEFAULT NULL,   PRIMARY KEY (`SpeciesInvID`),   KEY `Ref92198` (`SpeciesID`),   KEY `Ref93199` (`SubSpeciesID`),   KEY `Ref5222` (`CensusID`),   KEY `Ref642` (`PlotID`),   CONSTRAINT `SpeciesInventory_ibfk_1` FOREIGN KEY (`CensusID`) REFERENCES `Census` (`CensusID`),   CONSTRAINT `SpeciesInventory_ibfk_2` FOREIGN KEY (`PlotID`) REFERENCES `Site` (`PlotID`),   CONSTRAINT `SpeciesInventory_ibfk_3` FOREIGN KEY (`SpeciesID`) REFERENCES `Species` (`SpeciesID`),   CONSTRAINT `SpeciesInventory_ibfk_4` FOREIGN KEY (`SubSpeciesID`) REFERENCES `SubSpecies` (`SubSpeciesID`) ) ENGINE=InnoDB AUTO_INCREMENT=13118 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `FeatureTypes`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `FeatureTypes` (   `FeatureTypeID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `Type` varchar(32) NOT NULL,   PRIMARY KEY (`FeatureTypeID`) ) ENGINE=InnoDB DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Features`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Features` (   `FeatureID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `FeatureTypeID` int(10) unsigned NOT NULL,   `Name` varchar(32) NOT NULL,   `ShortDescrip` varchar(32) DEFAULT NULL,   `LongDescrip` varchar(128) DEFAULT NULL,   PRIMARY KEY (`FeatureID`),   KEY `FeatureTypeID` (`FeatureTypeID`),   CONSTRAINT `Features_ibfk_1` FOREIGN KEY (`FeatureTypeID`) REFERENCES `FeatureTypes` (`FeatureTypeID`) ) ENGINE=InnoDB DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Coordinates`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Coordinates` (   `CoorID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `FeatureID` int(10) unsigned DEFAULT NULL,   `PlotID` int(10) unsigned DEFAULT NULL,   `QuadratID` int(10) unsigned DEFAULT NULL,   `GX` decimal(16,5) DEFAULT NULL,   `GY` decimal(16,5) DEFAULT NULL,   `GZ` decimal(16,5) DEFAULT NULL,   `PX` decimal(16,5) DEFAULT NULL,   `PY` decimal(16,5) DEFAULT NULL,   `PZ` decimal(16,5) DEFAULT NULL,   `QX` decimal(16,5) DEFAULT NULL,   `QY` decimal(16,5) DEFAULT NULL,   `QZ` decimal(16,5) DEFAULT NULL,   `CoordinateNo` int(10) unsigned DEFAULT NULL,   PRIMARY KEY (`CoorID`),   KEY `FeatureID` (`FeatureID`),   KEY `PlotID` (`PlotID`),   KEY `QuadratID` (`QuadratID`),   CONSTRAINT `Coordinates_ibfk_1` FOREIGN KEY (`FeatureID`) REFERENCES `Features` (`FeatureID`),   CONSTRAINT `Coordinates_ibfk_2` FOREIGN KEY (`PlotID`) REFERENCES `Site` (`PlotID`),   CONSTRAINT `Coordinates_ibfk_3` FOREIGN KEY (`QuadratID`) REFERENCES `Quadrat` (`QuadratID`) ) ENGINE=InnoDB AUTO_INCREMENT=3349 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Log`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Log` (   `LogID` bigint(20) unsigned NOT NULL AUTO_INCREMENT,   `PersonnelID` smallint(5) unsigned DEFAULT NULL,   `ChangedTable` varchar(32) NOT NULL,   `PrimaryKey` varchar(32) NOT NULL,   `ChangedColumn` varchar(32) NOT NULL,   `ChangeDate` date DEFAULT NULL,   `ChangeTime` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,   `Description` varchar(256) DEFAULT NULL,   `Action` enum('I','D','U') NOT NULL,   `Old` varchar(512) NOT NULL,   `New` varchar(512) NOT NULL,   PRIMARY KEY (`LogID`),   KEY `PersonnelID` (`PersonnelID`),   CONSTRAINT `Log_ibfk_1` FOREIGN KEY (`PersonnelID`) REFERENCES `Personnel` (`PersonnelID`) ) ENGINE=InnoDB AUTO_INCREMENT=91765 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `TreeTaxChange`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `TreeTaxChange` (   `ChangeCodeID` int(10) unsigned NOT NULL,   `Description` varchar(128) DEFAULT NULL,   PRIMARY KEY (`ChangeCodeID`) ) ENGINE=InnoDB DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `CurrentObsolete`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `CurrentObsolete` (   `COID` int(11) NOT NULL AUTO_INCREMENT,   `SpeciesID` int(10) unsigned NOT NULL,   `ObsoleteSpeciesID` int(10) unsigned NOT NULL,   `SubSpeciesID` int(11) DEFAULT NULL,   `ObsoleteSubSpeciesID` int(11) DEFAULT NULL,   `ChangeDate` datetime NOT NULL,   `Reversed` tinyint(1) NOT NULL DEFAULT '0',   `ChangeCodeID` int(10) unsigned NOT NULL,   `ChangeNote` varchar(128) DEFAULT NULL,   PRIMARY KEY (`COID`),   KEY `Ref32191` (`ChangeCodeID`),   KEY `Ref92192` (`SpeciesID`),   KEY `Ref92212` (`ObsoleteSpeciesID`),   KEY `Reversed` (`Reversed`),   CONSTRAINT `CurrentObsolete_ibfk_1` FOREIGN KEY (`SpeciesID`) REFERENCES `Species` (`SpeciesID`),   CONSTRAINT `CurrentObsolete_ibfk_2` FOREIGN KEY (`ObsoleteSpeciesID`) REFERENCES `Species` (`SpeciesID`),   CONSTRAINT `CurrentObsolete_ibfk_3` FOREIGN KEY (`ChangeCodeID`) REFERENCES `TreeTaxChange` (`ChangeCodeID`) ) ENGINE=InnoDB AUTO_INCREMENT=403 DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `Specimen`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `Specimen` (   `SpecimenID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `TreeID` int(10) unsigned DEFAULT NULL,   `Collector` char(64) DEFAULT NULL,   `SpecimenNumber` int(10) unsigned DEFAULT NULL,   `SpeciesID` int(10) unsigned NOT NULL,   `SubSpeciesID` int(10) unsigned DEFAULT NULL,   `Herbarium` char(32) DEFAULT NULL,   `Voucher` smallint(5) unsigned DEFAULT NULL,   `CollectionDate` date DEFAULT NULL,   `DeterminedBy` char(64) DEFAULT NULL,   `Description` varchar(128) DEFAULT NULL,   PRIMARY KEY (`SpecimenID`),   KEY `Ref93194` (`SubSpeciesID`),   KEY `Ref92196` (`SpeciesID`),   KEY `Ref1171` (`TreeID`),   CONSTRAINT `Specimen_ibfk_1` FOREIGN KEY (`SpeciesID`) REFERENCES `Species` (`SpeciesID`),   CONSTRAINT `Specimen_ibfk_2` FOREIGN KEY (`SubSpeciesID`) REFERENCES `SubSpecies` (`SubSpeciesID`),   CONSTRAINT `Specimen_ibfk_3` FOREIGN KEY (`TreeID`) REFERENCES `Tree` (`TreeID`) ) ENGINE=InnoDB DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `TreeAttributes`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `TreeAttributes` (   `CensusID` int(10) unsigned NOT NULL,   `TreeID` int(10) unsigned NOT NULL,   `TSMID` int(10) unsigned NOT NULL,   `TAttID` int(10) unsigned NOT NULL AUTO_INCREMENT,   PRIMARY KEY (`TAttID`),   KEY `Ref163` (`TreeID`),   KEY `Ref2064` (`TSMID`),   KEY `Ref5107` (`CensusID`),   CONSTRAINT `TreeAttributes_ibfk_1` FOREIGN KEY (`CensusID`) REFERENCES `Census` (`CensusID`),   CONSTRAINT `TreeAttributes_ibfk_2` FOREIGN KEY (`TreeID`) REFERENCES `Tree` (`TreeID`),   CONSTRAINT `TreeAttributes_ibfk_3` FOREIGN KEY (`TSMID`) REFERENCES `TSMAttributes` (`TSMID`) ) ENGINE=InnoDB DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Executing statement: DROP TABLE IF EXISTS `MeasurementAttributes`;
Success: The statement executed successfully.
=========================
Executing statement: CREATE TABLE `MeasurementAttributes` (   `MAttID` int(10) unsigned NOT NULL AUTO_INCREMENT,   `MeasureID` int(10) unsigned NOT NULL,   `TSMID` int(10) unsigned NOT NULL,   PRIMARY KEY (`MAttID`),   KEY `MeasureID` (`MeasureID`),   KEY `TSMID` (`TSMID`),   CONSTRAINT `MeasurementAttributes_ibfk_1` FOREIGN KEY (`MeasureID`) REFERENCES `Measurement` (`MeasureID`),   CONSTRAINT `MeasurementAttributes_ibfk_3` FOREIGN KEY (`TSMID`) REFERENCES `TSMAttributes` (`TSMID`) ) ENGINE=InnoDB DEFAULT CHARSET=latin1;;
Success: The statement executed successfully.
=========================
Press Enter to start executing INSERT statements...
```