# CTFSWeb Data Migration

Moving data from CTFSWeb's database schema to the ForestGEO App's schema is a layered, multi-step process. This guide
will outline the basic process developed to achieve this using a series of examples, SQL files, and Bash scripts. Please
ensure your development environment is compatible with Unix systems before you proceed.

---

## Before You Begin

Before getting started, please ensure you have the following starting components:

- A SQL flat file of an existing site
  - This should be a very large (think 100s of MBs) SQL file that contains a direct SQL dump of a full site's census
    history.
- An empty data source to migrate the old schema into.
- An empty data source to migrate the data into.
- Time!
  - A word to the wise, this takes a ridiculous amount of time, so make sure you have a couple hours to spare. I'd
  - recommend making sure your machine is plugged in and has a steady internet connection.

---

For the purposes of this guide, we're going to name the old schema `ctfsweb` and the new schema `forestgeo`.

### Why do you need to create a data source for the old data?

Migration from schema to schema is easier to work with than working from a flat file. Having the old data source
directly
viewable will let you confirm whether the migration has worked by reviewing foreign key connections directly.
Additionally, the flat file will often contain other nonessential statements that can potentially disrupt the
execution of the flat file.

### Preparing Data Sources

Begin by ensuring that your data sources are correctly formatted (have all required tables).<br />

1. For our `ctfsweb` example schema, you can use this SQL script

```SQL
-- reset_ctfsweb_tables.sql
DROP TABLE IF EXISTS `Census`;
CREATE TABLE IF NOT EXISTS `Census` (
  `CensusID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `PlotID` int(10) unsigned NOT NULL,
  `PlotCensusNumber` char(16) DEFAULT NULL,
  `StartDate` date DEFAULT NULL,
  `EndDate` date DEFAULT NULL,
  `Description` varchar(128) DEFAULT NULL,
  PRIMARY KEY (`CensusID`),
  KEY `Ref610` (`PlotID`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `CensusQuadrat`;
CREATE TABLE IF NOT EXISTS `CensusQuadrat` (
  `CensusID` int(10) unsigned NOT NULL,
  `QuadratID` int(10) unsigned NOT NULL,
  `CensusQuadratID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`CensusQuadratID`),
  KEY `Ref534` (`CensusID`),
  KEY `QuadratID` (`QuadratID`)
) ENGINE=InnoDB AUTO_INCREMENT=641 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `Coordinates`;
CREATE TABLE IF NOT EXISTS `Coordinates` (
  `CoorID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `FeatureID` int(10) unsigned DEFAULT NULL,
  `PlotID` int(10) unsigned DEFAULT NULL,
  `QuadratID` int(10) unsigned DEFAULT NULL,
  `GX` decimal(16,5) DEFAULT NULL,
  `GY` decimal(16,5) DEFAULT NULL,
  `GZ` decimal(16,5) DEFAULT NULL,
  `PX` decimal(16,5) DEFAULT NULL,
  `PY` decimal(16,5) DEFAULT NULL,
  `PZ` decimal(16,5) DEFAULT NULL,
  `QX` decimal(16,5) DEFAULT NULL,
  `QY` decimal(16,5) DEFAULT NULL,
  `QZ` decimal(16,5) DEFAULT NULL,
  `CoordinateNo` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`CoorID`),
  KEY `FeatureID` (`FeatureID`),
  KEY `PlotID` (`PlotID`),
  KEY `QuadratID` (`QuadratID`)
) ENGINE=InnoDB AUTO_INCREMENT=642 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `Country`;
CREATE TABLE IF NOT EXISTS `Country` (
  `CountryID` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `CountryName` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`CountryID`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `CurrentObsolete`;
CREATE TABLE IF NOT EXISTS `CurrentObsolete` (
  `SpeciesID` int(10) unsigned NOT NULL,
  `ObsoleteSpeciesID` int(10) unsigned NOT NULL,
  `ChangeDate` datetime NOT NULL,
  `ChangeCodeID` int(10) unsigned NOT NULL,
  `ChangeNote` varchar(128) DEFAULT NULL,
  PRIMARY KEY (`SpeciesID`,`ObsoleteSpeciesID`,`ChangeDate`),
  KEY `Ref32191` (`ChangeCodeID`),
  KEY `Ref92192` (`SpeciesID`),
  KEY `Ref92212` (`ObsoleteSpeciesID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `DBH`;
CREATE TABLE IF NOT EXISTS `DBH` (
  `CensusID` int(10) unsigned NOT NULL,
  `StemID` int(10) unsigned NOT NULL,
  `DBH` float DEFAULT NULL,
  `HOM` decimal(10,2) DEFAULT NULL,
  `PrimaryStem` varchar(20) DEFAULT NULL,
  `ExactDate` date DEFAULT NULL,
  `DBHID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `Comments` varchar(128) DEFAULT NULL,
  PRIMARY KEY (`DBHID`),
  KEY `Ref549` (`CensusID`),
  KEY `Ref1951` (`StemID`)
) ENGINE=InnoDB AUTO_INCREMENT=278618 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `DBHAttributes`;
CREATE TABLE IF NOT EXISTS `DBHAttributes` (
  `TSMID` int(10) unsigned NOT NULL,
  `DBHID` int(10) unsigned DEFAULT NULL,
  `DBHAttID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`DBHAttID`),
  KEY `Ref2053` (`TSMID`),
  KEY `DBHID` (`DBHID`)
) ENGINE=InnoDB AUTO_INCREMENT=262884 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `DataCollection`;
CREATE TABLE IF NOT EXISTS `DataCollection` (
  `CensusID` int(10) unsigned NOT NULL,
  `StartDate` date DEFAULT NULL,
  `EndDate` date DEFAULT NULL,
  `DataCollectionID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `PersonnelRoleID` int(10) unsigned NOT NULL,
  `QuadratID` int(10) unsigned NOT NULL,
  PRIMARY KEY (`DataCollectionID`),
  KEY `Ref1743` (`CensusID`),
  KEY `QuadratID` (`QuadratID`),
  KEY `PersonnelRoleID` (`PersonnelRoleID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `Family`;
CREATE TABLE IF NOT EXISTS `Family` (
  `FamilyID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `Family` char(32) DEFAULT NULL,
  `ReferenceID` smallint(5) unsigned DEFAULT NULL,
  PRIMARY KEY (`FamilyID`),
  KEY `Ref84175` (`ReferenceID`)
) ENGINE=InnoDB AUTO_INCREMENT=550 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `FeatureTypes`;
CREATE TABLE IF NOT EXISTS `FeatureTypes` (
  `FeatureTypeID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `Type` varchar(32) NOT NULL,
  PRIMARY KEY (`FeatureTypeID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `Features`;
CREATE TABLE IF NOT EXISTS `Features` (
  `FeatureID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `FeatureTypeID` int(10) unsigned NOT NULL,
  `Name` varchar(32) NOT NULL,
  `ShortDescrip` varchar(32) DEFAULT NULL,
  `LongDescrip` varchar(128) DEFAULT NULL,
  PRIMARY KEY (`FeatureID`),
  KEY `FeatureTypeID` (`FeatureTypeID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `Genus`;
CREATE TABLE IF NOT EXISTS `Genus` (
  `GenusID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `Genus` char(32) DEFAULT NULL,
  `ReferenceID` smallint(5) unsigned DEFAULT NULL,
  `Authority` char(32) DEFAULT NULL,
  `FamilyID` int(10) unsigned NOT NULL,
  PRIMARY KEY (`GenusID`),
  KEY `Ref2868` (`FamilyID`),
  KEY `Ref84176` (`ReferenceID`)
) ENGINE=InnoDB AUTO_INCREMENT=21253 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `Log`;
CREATE TABLE IF NOT EXISTS `Log` (
  `LogID` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `PersonnelID` smallint(5) unsigned DEFAULT NULL,
  `ChangedTable` varchar(32) NOT NULL,
  `PrimaryKey` varchar(32) NOT NULL,
  `ChangedColumn` varchar(32) NOT NULL,
  `ChangeDate` date DEFAULT NULL,
  `ChangeTime` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `Description` varchar(256) DEFAULT NULL,
  `Action` enum('I','D','U') NOT NULL,
  `Old` varchar(512) NOT NULL,
  `New` varchar(512) NOT NULL,
  PRIMARY KEY (`LogID`),
  KEY `PersonnelID` (`PersonnelID`)
) ENGINE=InnoDB AUTO_INCREMENT=4253 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `LogLthValue`;
CREATE TABLE IF NOT EXISTS `LogLthValue` (
  `TreeID` int(10) unsigned NOT NULL,
  `TreeHistoryID` int(10) unsigned NOT NULL,
  `QuadratID` int(10) unsigned DEFAULT NULL,
  `PlotID` int(10) unsigned DEFAULT NULL,
  `Tag` char(10) DEFAULT NULL,
  `X` float DEFAULT NULL,
  `Y` float DEFAULT NULL,
  `SubSpeciesID` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`TreeID`,`TreeHistoryID`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `Measurement`;
CREATE TABLE IF NOT EXISTS `Measurement` (
  `MeasureID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `CensusID` int(10) unsigned NOT NULL,
  `TreeID` int(10) unsigned NOT NULL,
  `StemID` int(10) unsigned NOT NULL,
  `MeasurementTypeID` int(10) unsigned NOT NULL,
  `Measure` varchar(256) NOT NULL,
  `ExactDate` date NOT NULL,
  `Comments` varchar(128) DEFAULT NULL,
  PRIMARY KEY (`MeasureID`),
  KEY `CensusID` (`CensusID`),
  KEY `TreeID` (`TreeID`),
  KEY `StemID` (`StemID`),
  KEY `MeasurementTypeID` (`MeasurementTypeID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `MeasurementAttributes`;
CREATE TABLE IF NOT EXISTS `MeasurementAttributes` (
  `MAttID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `MeasureID` int(10) unsigned NOT NULL,
  `TSMID` int(10) unsigned NOT NULL,
  PRIMARY KEY (`MAttID`),
  KEY `MeasureID` (`MeasureID`),
  KEY `TSMID` (`TSMID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `MeasurementType`;
CREATE TABLE IF NOT EXISTS `MeasurementType` (
  `MeasurementTypeID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `UOM` varchar(32) NOT NULL,
  `Type` varchar(256) DEFAULT NULL,
  PRIMARY KEY (`MeasurementTypeID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `Personnel`;
CREATE TABLE IF NOT EXISTS `Personnel` (
  `PersonnelID` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `FirstName` varchar(32) DEFAULT NULL,
  `LastName` varchar(32) NOT NULL,
  PRIMARY KEY (`PersonnelID`)
) ENGINE=InnoDB AUTO_INCREMENT=55 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `PersonnelRole`;
CREATE TABLE IF NOT EXISTS `PersonnelRole` (
  `PersonnelRoleID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `PersonnelID` smallint(5) unsigned NOT NULL,
  `RoleID` smallint(5) unsigned NOT NULL,
  PRIMARY KEY (`PersonnelRoleID`),
  KEY `RoleID` (`RoleID`),
  KEY `PersonnelID` (`PersonnelID`)
) ENGINE=InnoDB AUTO_INCREMENT=49 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `Quadrat`;
CREATE TABLE IF NOT EXISTS `Quadrat` (
  `PlotID` int(10) unsigned NOT NULL,
  `QuadratName` char(8) DEFAULT NULL,
  `Area` float unsigned DEFAULT NULL,
  `IsStandardShape` enum('Y','N') NOT NULL,
  `QuadratID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`QuadratID`),
  KEY `Ref69` (`PlotID`),
  KEY `indQuadName` (`QuadratName`,`PlotID`)
) ENGINE=InnoDB AUTO_INCREMENT=641 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `Reference`;
CREATE TABLE IF NOT EXISTS `Reference` (
  `ReferenceID` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `PublicationTitle` varchar(64) DEFAULT NULL,
  `FullReference` varchar(256) DEFAULT NULL,
  `DateofPublication` date DEFAULT NULL,
  PRIMARY KEY (`ReferenceID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `RemeasAttribs`;
CREATE TABLE IF NOT EXISTS `RemeasAttribs` (
  `TSMID` int(10) unsigned NOT NULL,
  `RemeasureID` int(10) unsigned NOT NULL,
  `RmAttID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`RmAttID`),
  KEY `Ref2073` (`TSMID`),
  KEY `RemeasureID` (`RemeasureID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `Remeasurement`;
CREATE TABLE IF NOT EXISTS `Remeasurement` (
  `CensusID` int(10) unsigned NOT NULL,
  `StemID` int(10) unsigned NOT NULL,
  `DBH` float DEFAULT NULL,
  `HOM` float DEFAULT NULL,
  `ExactDate` date DEFAULT NULL,
  `RemeasureID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`RemeasureID`),
  KEY `Ref1957` (`StemID`),
  KEY `Ref5106` (`CensusID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `ReviewChange`;
CREATE TABLE IF NOT EXISTS `ReviewChange` (
  `RID` int(4) unsigned NOT NULL,
  `TreeID` int(10) unsigned NOT NULL,
  `QuadratID` int(10) unsigned NOT NULL,
  `PlotID` int(10) unsigned NOT NULL,
  `FmSpeciesID` int(10) unsigned NOT NULL,
  `ToSpeciesID` int(10) unsigned NOT NULL,
  `ChangeCodeID` int(10) unsigned NOT NULL,
  `Tag` char(10) DEFAULT NULL,
  PRIMARY KEY (`RID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `ReviewNewSpecies`;
CREATE TABLE IF NOT EXISTS `ReviewNewSpecies` (
  `SpeciesID` int(10) unsigned NOT NULL,
  `genusID` int(10) unsigned NOT NULL,
  `ReferenceID` smallint(5) unsigned DEFAULT NULL,
  `FullSpeciesName` char(128) DEFAULT NULL,
  `Authority` varchar(128) DEFAULT NULL,
  `IDLevel` char(8) DEFAULT NULL,
  `FieldFamily` char(32) DEFAULT NULL,
  `Description` varchar(128) DEFAULT NULL,
  `PublicationTitle` varchar(128) DEFAULT NULL,
  `FullReference` varchar(256) DEFAULT NULL,
  `DateOfPublication` date DEFAULT NULL,
  PRIMARY KEY (`SpeciesID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `RoleReference`;
CREATE TABLE IF NOT EXISTS `RoleReference` (
  `RoleID` smallint(5) unsigned NOT NULL AUTO_INCREMENT,
  `Description` varchar(128) DEFAULT NULL,
  PRIMARY KEY (`RoleID`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `Site`;
CREATE TABLE IF NOT EXISTS `Site` (
  `PlotID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `PlotName` char(64) DEFAULT NULL,
  `LocationName` varchar(128) DEFAULT NULL,
  `CountryID` smallint(5) unsigned NOT NULL,
  `ShapeOfSite` char(32) DEFAULT NULL,
  `DescriptionOfSite` varchar(128) DEFAULT NULL,
  `Area` float unsigned NOT NULL,
  `QDimX` float unsigned NOT NULL,
  `QDimY` float unsigned NOT NULL,
  `GUOM` varchar(32) NOT NULL,
  `GZUOM` varchar(32) NOT NULL,
  `PUOM` varchar(32) NOT NULL,
  `QUOM` varchar(32) NOT NULL,
  `GCoorCollected` varchar(32) DEFAULT NULL,
  `PCoorCollected` varchar(32) DEFAULT NULL,
  `QCoorCollected` varchar(32) DEFAULT NULL,
  `IsStandardSize` enum('Y','N') DEFAULT NULL,
  PRIMARY KEY (`PlotID`),
  KEY `Ref87173` (`CountryID`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `Species`;
CREATE TABLE IF NOT EXISTS `Species` (
  `SpeciesID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `CurrentTaxonFlag` smallint(6) DEFAULT NULL,
  `ObsoleteTaxonFlag` smallint(6) DEFAULT NULL,
  `GenusID` int(10) unsigned NOT NULL,
  `ReferenceID` smallint(5) unsigned DEFAULT NULL,
  `SpeciesName` char(64) DEFAULT NULL,
  `Mnemonic` char(10) DEFAULT NULL,
  `Authority` varchar(128) DEFAULT NULL,
  `IDLEVEL` enum('subspecies','species','superspecies','genus','family','multiple','none','variety') DEFAULT NULL,
  `FieldFamily` char(32) DEFAULT NULL,
  `Description` varchar(128) DEFAULT NULL,
  `Lifeform` enum('Emergent Tree','Tree','Midcanopy Tree','Understory Tree','Shrub','Herb','Liana') DEFAULT NULL,
  `LocalName` varchar(128) DEFAULT NULL,
  PRIMARY KEY (`SpeciesID`),
  KEY `Ref26208` (`GenusID`),
  KEY `indMnemonic` (`Mnemonic`),
  KEY `Ref84209` (`ReferenceID`)
) ENGINE=InnoDB AUTO_INCREMENT=75 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `SpeciesInventory`;
CREATE TABLE IF NOT EXISTS `SpeciesInventory` (
  `SpeciesInvID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `CensusID` int(10) unsigned NOT NULL,
  `PlotID` int(10) unsigned NOT NULL,
  `SpeciesID` int(10) unsigned NOT NULL,
  `SubSpeciesID` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`SpeciesInvID`),
  KEY `Ref92198` (`SpeciesID`),
  KEY `Ref93199` (`SubSpeciesID`),
  KEY `Ref5222` (`CensusID`),
  KEY `Ref642` (`PlotID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `Specimen`;
CREATE TABLE IF NOT EXISTS `Specimen` (
  `SpecimenID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `TreeID` int(10) unsigned DEFAULT NULL,
  `Collector` char(64) DEFAULT NULL,
  `SpecimenNumber` int(10) unsigned DEFAULT NULL,
  `SpeciesID` int(10) unsigned NOT NULL,
  `SubSpeciesID` int(10) unsigned DEFAULT NULL,
  `Herbarium` char(32) DEFAULT NULL,
  `Voucher` smallint(5) unsigned DEFAULT NULL,
  `CollectionDate` date DEFAULT NULL,
  `DeterminedBy` char(64) DEFAULT NULL,
  `Description` varchar(128) DEFAULT NULL,
  PRIMARY KEY (`SpecimenID`),
  KEY `Ref93194` (`SubSpeciesID`),
  KEY `Ref92196` (`SpeciesID`),
  KEY `Ref1171` (`TreeID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `SqlLog`;
CREATE TABLE IF NOT EXISTS `SqlLog` (
  `SqlID` int(4) NOT NULL DEFAULT '0',
  `ToTableName` varchar(23) DEFAULT NULL,
  `SqlStmt` varchar(16384) DEFAULT NULL,
  PRIMARY KEY (`SqlID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `Stem`;
CREATE TABLE IF NOT EXISTS `Stem` (
  `StemID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `TreeID` int(10) unsigned NOT NULL,
  `StemTag` varchar(32) DEFAULT NULL,
  `StemDescription` varchar(128) DEFAULT NULL,
  `QuadratID` int(10) unsigned NOT NULL,
  `StemNumber` int(10) unsigned DEFAULT NULL,
  `Moved` enum('Y','N') NOT NULL DEFAULT 'N',
  `GX` decimal(16,5) DEFAULT NULL,
  `GY` decimal(16,5) DEFAULT NULL,
  `GZ` decimal(16,5) DEFAULT NULL,
  `PX` decimal(16,5) DEFAULT NULL,
  `PY` decimal(16,5) DEFAULT NULL,
  `PZ` decimal(16,5) DEFAULT NULL,
  `QX` decimal(16,5) DEFAULT NULL,
  `QY` decimal(16,5) DEFAULT NULL,
  `QZ` decimal(16,5) DEFAULT NULL,
  PRIMARY KEY (`StemID`),
  KEY `Ref150` (`TreeID`)
) ENGINE=InnoDB AUTO_INCREMENT=72556 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `SubSpecies`;
CREATE TABLE IF NOT EXISTS `SubSpecies` (
  `SubSpeciesID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `SpeciesID` int(10) unsigned NOT NULL,
  `CurrentTaxonFlag` smallint(6) DEFAULT NULL,
  `ObsoleteTaxonFlag` smallint(6) DEFAULT NULL,
  `SubSpeciesName` char(64) DEFAULT NULL,
  `Mnemonic` char(10) DEFAULT NULL,
  `Authority` varchar(128) DEFAULT NULL,
  `InfraSpecificLevel` char(32) DEFAULT NULL,
  PRIMARY KEY (`SubSpeciesID`),
  KEY `Ref92193` (`SpeciesID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `TAX2temp`;
CREATE TABLE IF NOT EXISTS `TAX2temp` (
  `SpeciesID` int(11) NOT NULL,
  `ObsoleteSpeciesID` int(11) NOT NULL,
  `ObsoleteGenusName` char(32) DEFAULT NULL,
  `ObsoleteSpeciesName` char(64) DEFAULT NULL,
  `ObsoleteGenSpeName` char(128) DEFAULT NULL,
  `Description` char(128) DEFAULT NULL,
  `ChangeDate` date NOT NULL,
  `Family` char(32) DEFAULT NULL,
  `Genus` char(32) DEFAULT NULL,
  `SpeciesName` char(64) DEFAULT NULL,
  `Authority` char(128) DEFAULT NULL,
  `IDLevel` char(8) DEFAULT NULL,
  PRIMARY KEY (`SpeciesID`,`ObsoleteSpeciesID`,`ChangeDate`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `TAX3temp`;
CREATE TABLE IF NOT EXISTS `TAX3temp` (
  `PlotSpeciesID` int(11) NOT NULL AUTO_INCREMENT,
  `PlotID` int(11) NOT NULL,
  `SpeciesID` int(11) NOT NULL,
  `SubSpeciesID` int(11) DEFAULT NULL,
  PRIMARY KEY (`PlotSpeciesID`),
  KEY `TAX3Plot` (`PlotID`,`SpeciesID`,`SubSpeciesID`)
) ENGINE=InnoDB AUTO_INCREMENT=71 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `TSMAttributes`;
CREATE TABLE IF NOT EXISTS `TSMAttributes` (
  `TSMID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `TSMCode` char(10) NOT NULL,
  `Description` varchar(128) NOT NULL,
  `Status` enum('alive','alive-not measured','dead','missing','broken below','stem dead') DEFAULT NULL,
  PRIMARY KEY (`TSMID`)
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `TempQuadrat`;
CREATE TABLE IF NOT EXISTS `TempQuadrat` (
  `QuadratID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `QuadratName` char(8) DEFAULT NULL,
  `StartX` float DEFAULT NULL,
  `StartY` float DEFAULT NULL,
  `DimX` float DEFAULT NULL,
  `DimY` float DEFAULT NULL,
  `CensusID` int(10) unsigned NOT NULL,
  `PlotCensusNumber` int(10) unsigned NOT NULL,
  `PlotID` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`QuadratID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `TempQuadratDates`;
CREATE TABLE IF NOT EXISTS `TempQuadratDates` (
  `TempQuadID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `QuadratName` varchar(12) DEFAULT NULL,
  `PrevDate` date DEFAULT NULL,
  PRIMARY KEY (`TempQuadID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `TempSpecies`;
CREATE TABLE IF NOT EXISTS `TempSpecies` (
  `TempID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `Mnemonic` varchar(10) DEFAULT NULL,
  `Genus` varchar(32) DEFAULT NULL,
  `SpeciesName` varchar(64) DEFAULT NULL,
  `FieldFamily` varchar(32) DEFAULT NULL,
  `Authority` varchar(128) DEFAULT NULL,
  `IDLevel` varchar(8) DEFAULT NULL,
  `GenusID` int(10) DEFAULT NULL,
  `SpeciesID` int(10) DEFAULT NULL,
  `Family` char(32) DEFAULT NULL,
  `Errors` varchar(256) DEFAULT NULL,
  PRIMARY KEY (`TempID`),
  KEY `indexGenus` (`Genus`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `TempSpeciesError`;
CREATE TABLE IF NOT EXISTS `TempSpeciesError` (
  `TempID` int(10) unsigned NOT NULL DEFAULT '0',
  `Mnemonic` varchar(10) DEFAULT NULL,
  `Genus` varchar(32) DEFAULT NULL,
  `SpeciesName` varchar(64) DEFAULT NULL,
  `FieldFamily` varchar(32) DEFAULT NULL,
  `Authority` varchar(128) DEFAULT NULL,
  `IDLevel` varchar(8) DEFAULT NULL,
  `GenusID` int(10) DEFAULT NULL,
  `SpeciesID` int(10) DEFAULT NULL,
  `Family` char(32) DEFAULT NULL,
  `Errors` varchar(256) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `Tree`;
CREATE TABLE IF NOT EXISTS `Tree` (
  `TreeID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `Tag` char(10) DEFAULT NULL,
  `SpeciesID` int(10) unsigned NOT NULL,
  `SubSpeciesID` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`TreeID`),
  KEY `Ref92217` (`SpeciesID`),
  KEY `Ref93219` (`SubSpeciesID`),
  KEY `indTreeTag` (`Tag`)
) ENGINE=InnoDB AUTO_INCREMENT=49311 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `TreeAttributes`;
CREATE TABLE IF NOT EXISTS `TreeAttributes` (
  `CensusID` int(10) unsigned NOT NULL,
  `TreeID` int(10) unsigned NOT NULL,
  `TSMID` int(10) unsigned NOT NULL,
  `TAttID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (`TAttID`),
  KEY `Ref163` (`TreeID`),
  KEY `Ref2064` (`TSMID`),
  KEY `Ref5107` (`CensusID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `TreeTaxChange`;
CREATE TABLE IF NOT EXISTS `TreeTaxChange` (
  `ChangeCodeID` int(10) unsigned NOT NULL,
  `Description` varchar(128) DEFAULT NULL,
  PRIMARY KEY (`ChangeCodeID`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `ViewFullTable`;
CREATE TABLE IF NOT EXISTS `ViewFullTable` (
  `DBHID` int(11) NOT NULL,
  `PlotName` varchar(35) DEFAULT NULL,
  `PlotID` int(11) DEFAULT NULL,
  `Family` char(32) DEFAULT NULL,
  `Genus` char(32) DEFAULT NULL,
  `SpeciesName` char(64) DEFAULT NULL,
  `Mnemonic` char(10) DEFAULT NULL,
  `Subspecies` char(64) DEFAULT NULL,
  `SpeciesID` int(11) DEFAULT NULL,
  `SubspeciesID` int(11) DEFAULT NULL,
  `QuadratName` varchar(12) DEFAULT NULL,
  `QuadratID` int(11) DEFAULT NULL,
  `PX` decimal(16,5) DEFAULT NULL,
  `PY` decimal(16,5) DEFAULT NULL,
  `QX` decimal(16,5) DEFAULT NULL,
  `QY` decimal(16,5) DEFAULT NULL,
  `TreeID` int(11) DEFAULT NULL,
  `Tag` char(10) DEFAULT NULL,
  `StemID` int(11) DEFAULT NULL,
  `StemNumber` int(11) DEFAULT NULL,
  `StemTag` varchar(32) DEFAULT NULL,
  `PrimaryStem` char(20) DEFAULT NULL,
  `CensusID` int(11) DEFAULT NULL,
  `PlotCensusNumber` int(11) DEFAULT NULL,
  `DBH` float DEFAULT NULL,
  `HOM` decimal(10,2) DEFAULT NULL,
  `ExactDate` date DEFAULT NULL,
  `Date` int(11) DEFAULT NULL,
  `ListOfTSM` varchar(256) DEFAULT NULL,
  `HighHOM` tinyint(1) DEFAULT NULL,
  `LargeStem` tinyint(1) DEFAULT NULL,
  `Status` enum('alive','dead','stem dead','broken below','omitted','missing') DEFAULT 'alive',
  PRIMARY KEY (`DBHID`),
  KEY `SpeciesID` (`SpeciesID`),
  KEY `SubspeciesID` (`SubspeciesID`),
  KEY `QuadratID` (`QuadratID`),
  KEY `TreeID` (`TreeID`),
  KEY `StemID` (`StemID`),
  KEY `Tag` (`Tag`),
  KEY `CensusID` (`CensusID`),
  KEY `Genus` (`Genus`,`SpeciesName`),
  KEY `Mnemonic` (`Mnemonic`),
  KEY `CensusID_2` (`CensusID`),
  KEY `PlotCensusNumber` (`PlotCensusNumber`),
  KEY `StemTag` (`StemTag`),
  KEY `DBH` (`DBH`),
  KEY `Date` (`Date`),
  KEY `Date_2` (`Date`),
  KEY `ListOfTSM` (`ListOfTSM`),
  KEY `Status` (`Status`),
  KEY `HighHOM` (`HighHOM`)
) ENGINE=MyISAM DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `ViewTaxonomy`;
CREATE TABLE IF NOT EXISTS `ViewTaxonomy` (
  `ViewID` int(11) NOT NULL AUTO_INCREMENT,
  `SpeciesID` int(11) DEFAULT NULL,
  `SubspeciesID` int(11) DEFAULT NULL,
  `Family` char(32) DEFAULT NULL,
  `Mnemonic` char(10) DEFAULT NULL,
  `Genus` char(32) DEFAULT NULL,
  `SpeciesName` char(64) DEFAULT NULL,
  `Rank` char(20) DEFAULT NULL,
  `Subspecies` char(64) DEFAULT NULL,
  `Authority` char(128) DEFAULT NULL,
  `IDLevel` char(12) DEFAULT NULL,
  `subspMnemonic` char(10) DEFAULT NULL,
  `subspAuthority` varchar(120) DEFAULT NULL,
  `FieldFamily` char(32) DEFAULT NULL,
  `Lifeform` char(20) DEFAULT NULL,
  `Description` text,
  `wsg` decimal(10,6) DEFAULT NULL,
  `wsglevel` enum('local','species','genus','family','none') DEFAULT NULL,
  `ListOfOldNames` varchar(255) DEFAULT NULL,
  `Specimens` varchar(255) DEFAULT NULL,
  `Reference` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`ViewID`),
  KEY `SpeciesID` (`SpeciesID`),
  KEY `SubspeciesID` (`SubspeciesID`),
  KEY `IDLevel` (`IDLevel`)
) ENGINE=MyISAM AUTO_INCREMENT=76 DEFAULT CHARSET=latin1;



DROP TABLE IF EXISTS `stagePersonnel`;
CREATE TABLE IF NOT EXISTS `stagePersonnel` (
  `PersonnelRoleID` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `FirstName` char(30) DEFAULT NULL,
  `LastName` char(32) DEFAULT NULL,
  `RoleID` int(11) DEFAULT NULL,
  `PersonnelID` int(11) DEFAULT NULL,
  `Role` char(25) DEFAULT NULL,
  PRIMARY KEY (`PersonnelRoleID`)
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=latin1;
```

{collapsible="true" collapsed-title="ctfsweb generation"}

2. For our `forestgeo` example schema, you can use this SQL script:

```SQL
set foreign_key_checks = 0;
drop table if exists attributes;
create table attributes
(
    Code        varchar(10)                                                                                                     not null
        primary key,
    Description text                                                                                                            null,
    Status      enum ('alive', 'alive-not measured', 'dead', 'stem dead', 'broken below', 'omitted', 'missing') default 'alive' null
);

drop table if exists personnel;
create table personnel
(
    PersonnelID int auto_increment
        primary key,
    FirstName   varchar(50)  null,
    LastName    varchar(50)  null,
    Role        varchar(150) null comment 'semicolon-separated, like attributes in coremeasurements'
);

drop table if exists plots;
create table plots
(
    PlotID          int auto_increment
        primary key,
    PlotName        text                                                        null,
    LocationName    text                                                        null,
    CountryName     text                                                        null,
    DimensionX      int                                                         null,
    DimensionY      int                                                         null,
    Area            decimal(10, 6)                                              null,
    GlobalX         decimal(10, 6)                                              null,
    GlobalY         decimal(10, 6)                                              null,
    GlobalZ         decimal(10, 6)                                              null,
    Unit            enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm' null,
    PlotShape       text                                                        null,
    PlotDescription text                                                        null
);

drop table if exists census;
create table census
(
    CensusID         int auto_increment
        primary key,
    PlotID           int  null,
    StartDate        date null,
    EndDate          date null,
    Description      text null,
    PlotCensusNumber int  null,
    constraint Census_Plots_PlotID_fk
        foreign key (PlotID) references plots (PlotID)
            on update cascade
);

drop table if exists quadrats;
create table quadrats
(
    QuadratID    int auto_increment
        primary key,
    PlotID       int                                                         null,
    CensusID     int                                                         null,
    QuadratName  text                                                        null,
    StartX       decimal(10, 6)                                              null,
    StartY       decimal(10, 6)                                              null,
    DimensionX   int                                                         null,
    DimensionY   int                                                         null,
    Area         decimal(10, 6)                                              null,
    QuadratShape text                                                        null,
    Unit         enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm' null,
    constraint Quadrats_Plots_FK
        foreign key (PlotID) references plots (PlotID)
            on update cascade,
    constraint quadrats_census_CensusID_fk
        foreign key (CensusID) references census (CensusID)
            on update cascade
);

drop table if exists quadratpersonnel;
create table quadratpersonnel
(
    QuadratPersonnelID int auto_increment
        primary key,
    QuadratID          int  not null,
    PersonnelID        int  not null,
    AssignedDate       date null,
    constraint fk_QuadratPersonnel_Personnel
        foreign key (PersonnelID) references personnel (PersonnelID)
            on update cascade,
    constraint fk_QuadratPersonnel_Quadrats
        foreign key (QuadratID) references quadrats (QuadratID)
            on update cascade
);

drop table if exists reference;
create table reference
(
    ReferenceID       int auto_increment
        primary key,
    PublicationTitle  varchar(64) null,
    FullReference     text        null,
    DateOfPublication date        null,
    Citation          varchar(50) null
);

drop table if exists family;
create table family
(
    FamilyID    int auto_increment
        primary key,
    Family      varchar(32) null,
    ReferenceID int         null,
    constraint Family
        unique (Family),
    constraint Family_Reference_ReferenceID_fk
        foreign key (ReferenceID) references reference (ReferenceID)
            on update cascade
);
drop table if exists genus;
create table genus
(
    GenusID        int auto_increment
        primary key,
    FamilyID       int         null,
    Genus          varchar(32) null,
    ReferenceID    int         null,
    GenusAuthority varchar(32) null,
    constraint Genus
        unique (Genus),
    constraint Genus_Family_FamilyID_fk
        foreign key (FamilyID) references family (FamilyID)
            on update cascade,
    constraint Genus_Reference_ReferenceID_fk
        foreign key (ReferenceID) references reference (ReferenceID)
            on update cascade
);
drop table if exists species;
create table species
(
    SpeciesID           int auto_increment
        primary key,
    GenusID             int          null,
    SpeciesCode         varchar(25)  null,
    CurrentTaxonFlag    bit          null,
    ObsoleteTaxonFlag   bit          null,
    SpeciesName         varchar(64)  null,
    SubspeciesName      varchar(255) null,
    IDLevel             varchar(20)  null,
    SpeciesAuthority    varchar(128) null,
    SubspeciesAuthority varchar(255) null,
    FieldFamily         varchar(32)  null,
    Description         text         null,
    ReferenceID         int          null,
    constraint SpeciesCode
        unique (SpeciesCode),
    constraint Species_SpeciesCode
        unique (SpeciesCode),
    constraint Species_Genus_GenusID_fk
        foreign key (GenusID) references genus (GenusID)
            on update cascade,
    constraint Species_Reference_ReferenceID_fk
        foreign key (ReferenceID) references reference (ReferenceID)
            on update cascade
);
drop table if exists specieslimits;
create table specieslimits
(
    SpeciesLimitID int auto_increment
        primary key,
    SpeciesCode    varchar(25)                                                 null,
    LimitType      enum ('DBH', 'HOM')                                         null,
    UpperBound     decimal(10, 6)                                              null,
    LowerBound     decimal(10, 6)                                              null,
    Unit           enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm' null,
    constraint specieslimits_ibfk_1
        foreign key (SpeciesCode) references species (SpeciesCode)
            on update cascade
);
drop table if exists subquadrats;
create table subquadrats
(
    SubquadratID   int auto_increment
        primary key,
    SubquadratName varchar(25)                                                 null,
    QuadratID      int                                                         null,
    DimensionX     int                                             default 5   null,
    DimensionY     int                                             default 5   null,
    X              int                                                         null comment 'corner x index value (standardized)',
    Y              int                                                         null comment 'corner y index value (standardized)',
    Unit           enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm' null,
    Ordering       int                                                         null comment 'SQindex should tell you in which order the subquads are surveyed. This will be useful later.',
    constraint SQName
        unique (SubquadratName),
    constraint subquadrats_ibfk_1
        foreign key (QuadratID) references quadrats (QuadratID)
            on update cascade
);

create index QuadratID
    on subquadrats (QuadratID);

drop table if exists trees;
create table trees
(
    TreeID    int auto_increment
        primary key,
    TreeTag   varchar(10) null,
    SpeciesID int         null,
    constraint TreeTag
        unique (TreeTag),
    constraint Trees_Species_SpeciesID_fk
        foreign key (SpeciesID) references species (SpeciesID)
            on update cascade
);
drop table if exists stems;
create table stems
(
    StemID          int auto_increment
        primary key,
    TreeID          int                                                         null,
    QuadratID       int                                                         null,
    SubquadratID    int                                                         null,
    StemNumber      int                                                         null,
    StemTag         varchar(10)                                                 null,
    LocalX          decimal(10, 6)                                              null,
    LocalY          decimal(10, 6)                                              null,
    Unit            enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm' null,
    Moved           bit                                                         null,
    StemDescription text                                                        null,
    constraint StemTag
        unique (StemTag),
    constraint FK_Stems_Trees
        foreign key (TreeID) references trees (TreeID)
            on update cascade,
    constraint stems_quadrats_QuadratID_fk
        foreign key (QuadratID) references quadrats (QuadratID)
            on update cascade,
    constraint stems_subquadrats_SQID_fk
        foreign key (SubquadratID) references subquadrats (SubquadratID)
            on update cascade
);
drop table if exists coremeasurements;
create table coremeasurements
(
    CoreMeasurementID int auto_increment
        primary key,
    CensusID          int                                                          null,
    PlotID            int                                                          null,
    QuadratID         int                                                          null,
    SubQuadratID      int                                                          null,
    TreeID            int                                                          null,
    StemID            int                                                          null,
    PersonnelID       int                                                          null,
    IsValidated       bit                                             default b'0' null,
    MeasurementDate   date                                                         null,
    MeasuredDBH       decimal(10, 6)                                               null,
    DBHUnit           enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm'  null,
    MeasuredHOM       decimal(10, 6)                                               null,
    HOMUnit           enum ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm') default 'm'  null,
    Description       text                                                         null,
    UserDefinedFields text                                                         null,
    constraint CoreMeasurements_Census_CensusID_fk
        foreign key (CensusID) references census (CensusID)
            on update cascade,
    constraint CoreMeasurements_Personnel_PersonnelID_fk
        foreign key (PersonnelID) references personnel (PersonnelID)
            on update cascade,
    constraint FK_CoreMeasurements_Stems
        foreign key (StemID) references stems (StemID)
            on update cascade,
    constraint FK_CoreMeasurements_Trees
        foreign key (TreeID) references trees (TreeID)
            on update cascade,
    constraint coremeasurements_plots_PlotID_fk
        foreign key (PlotID) references plots (PlotID)
            on update cascade,
    constraint coremeasurements_quadrats_QuadratID_fk
        foreign key (QuadratID) references quadrats (QuadratID)
            on update cascade,
    constraint coremeasurements_subquadrats_SQID_fk
        foreign key (SubQuadratID) references subquadrats (SubquadratID)
            on update cascade
);
drop table if exists cmattributes;
create table cmattributes
(
    CMAID             int auto_increment
        primary key,
    CoreMeasurementID int         null,
    Code              varchar(10) null,
    constraint CMAttributes_Attributes_Code_fk
        foreign key (Code) references attributes (Code)
            on update cascade,
    constraint CMAttributes_CoreMeasurements_CoreMeasurementID_fk
        foreign key (CoreMeasurementID) references coremeasurements (CoreMeasurementID)
            on update cascade
);

create index idx_censusid
    on coremeasurements (CensusID);

create index idx_quadratid
    on coremeasurements (SubQuadratID);

create index idx_stemid
    on coremeasurements (StemID);

create index idx_treeid
    on coremeasurements (TreeID);

create index idx_stemid
    on stems (StemID);
drop table if exists validationchangelog;
create table validationchangelog
(
    ValidationRunID    int auto_increment
        primary key,
    ProcedureName      varchar(255)                       not null,
    RunDateTime        datetime default CURRENT_TIMESTAMP not null,
    TargetRowID        int                                null,
    ValidationOutcome  enum ('Passed', 'Failed')          null,
    ErrorMessage       text                               null,
    ValidationCriteria text                               null,
    MeasuredValue      varchar(255)                       null,
    ExpectedValueRange varchar(255)                       null,
    AdditionalDetails  text                               null
);
drop table if exists validationerrors;
create table validationerrors
(
    ValidationErrorID          int auto_increment
        primary key,
    ValidationErrorDescription text null
);
drop table if exists cmverrors;
create table cmverrors
(
    CMVErrorID        int auto_increment
        primary key,
    CoreMeasurementID int null,
    ValidationErrorID int null,
    constraint CMVErrors_CoreMeasurements_CoreMeasurementID_fk
        foreign key (CoreMeasurementID) references coremeasurements (CoreMeasurementID)
            on update cascade,
    constraint cmverrors_validationerrors_ValidationErrorID_fk
        foreign key (ValidationErrorID) references validationerrors (ValidationErrorID)
            on update cascade
);

set foreign_key_checks = 1;
```

{collapsible="true" collapsed-title="forestgeo generation"}

Make sure you run these while pointing to the correct databases! While we're using example values, you should use
appropriately named schemas for both of these cases (i.e., `ctfsweb_scbi` and `forestgeo_scbi`, or `ctfsweb_bci` and
`forestgeo_bci`).

### Importing Flat File to `ctfsweb` Schema

Next, we need to move all of the data from the site flat file we have on hand. <br />
Start by creating and running the following Bash script:

```Bash
#!/bin/bash

# List of tables to extract INSERT INTO statements
tables=("Census" "CensusQuadrat" "Coordinates" "Country" "CurrentObsolete" "DBH" "DBHAttributes" "DataCollection" "Family" "FeatureTypes" "Features" "Genus" "Log" "LogLthValue" "Measurement" "MeasurementAttributes" "MeasurementType" "Personnel" "PersonnelRole" "Quadrat" "Reference" "RemeasAttribs" "Remeasurement" "ReviewChange" "ReviewNewSpecies" "RoleReference" "Site" "Species" "SpeciesInventory" "Specimen" "SqlLog" "Stem" "SubSpecies" "TAX2temp" "TAX3temp" "TSMAttributes" "TempQuadrat" "TempQuadratDates" "TempSpecies" "TempSpeciesError" "Tree" "TreeAttributes" "TreeTaxChange" "ViewFullTable" "ViewTaxonomy" "stagePersonnel")

# Path to the source SQL file
source_file="crc 2.sql"

# Output directory for the individual insert files
output_dir="insert_statements"
mkdir -p "$output_dir"

for table in "${tables[@]}"; do
    perl -0777 -ne "
    if (/INSERT\s+INTO\s+\`${table}\`\s+VALUES\s+\(.*?\);.*?(?=\/\*\!40000 ALTER TABLE)/s) {
        print \"SET FOREIGN_KEY_CHECKS = 0;\\n\$&\\nSET FOREIGN_KEY_CHECKS = 1;\\n\"
    }
    " "$source_file" > "$output_dir/${table}_insert.sql"
done
```

{collapsible="true" collapsed-title="break down flat file"}

> Make sure you place this script in the same directory as your flat file, and change the `source_file` name to your
> flat file's name!
> {style="warning"}

After you run this script, you should see a new directory called `insert_statements` in your directory, which should
contain a collection of insertion SQL scripts. <br />

> Verify that those scripts are correctly populated by referencing the flat file before continuing.
> {style="note"}

Now that you have the `insert_statements` directory, run the following Bash script to load them all into a single
runnable SQL file that's been cleaned to only contain the core insertion statements and also toggles
foreign_key_checks before and after execution to ensure a clean insertion:

```Bash
#!/bin/bash

# Output directory for the individual insert files
output_dir="insert_statements"

# Combined file
combined_file="all_inserts.sql"

echo "SET FOREIGN_KEY_CHECKS = 0;" > "$combined_file"
for file in "$output_dir"/*.sql; do
    cat "$file" >> "$combined_file"
done
echo "SET FOREIGN_KEY_CHECKS = 1;" >> "$combined_file"
```

{collapsible="true" collapsed-title="insertion statement assembly"}

> Make sure your `output_dir` reference correctly points to the `insert_statements` directory and isn't inside it.<br />
> {style="warning"}

Once this completes, you should end up with a single script called `all_inserts.sql` that contains all of the
insertion statements originally incorporated into your flat file. Now that you have this, access your MySQL server
and navigate to the schema you are using to hold the CTFSWeb-formatted data.

Run the `all_inserts.sql` script, and verify that the tables are correctly populated by checking the flat file and
then the tables.

### Migrating `ctfsweb` to `forestgeo`

You're almost done! The only part left is to actually migrate the data in the `ctfsweb` schema to the `forestgeo`
schema. Use this script:

```SQL
SET foreign_key_checks = 0;

-- Create temporary mapping tables
CREATE TABLE IF NOT EXISTS temp_census_mapping (
    old_CensusID INT,
    new_CensusID INT
);

CREATE TABLE IF NOT EXISTS temp_plot_mapping (
    old_PlotID INT,
    new_PlotID INT
);

CREATE TABLE IF NOT EXISTS temp_personnel_mapping (
    old_PersonnelID INT,
    new_PersonnelID INT
);

CREATE TABLE IF NOT EXISTS temp_quadrat_mapping (
    old_QuadratID INT,
    new_QuadratID INT
);

CREATE TABLE IF NOT EXISTS temp_genus_mapping (
    old_GenusID INT,
    new_GenusID INT
);

CREATE TABLE IF NOT EXISTS temp_species_mapping (
    old_SpeciesID INT,
    new_SpeciesID INT
);

CREATE TABLE IF NOT EXISTS temp_stem_mapping (
    old_StemID INT,
    new_StemID INT
);

-- Insert into plots and populate mapping table with GROUP BY to avoid duplicates
INSERT INTO forestgeo_scbi.plots (PlotName, LocationName, CountryName, Area, GlobalX, GlobalY, GlobalZ, Unit, PlotDescription)
SELECT LEFT(s.PlotName, 65535), LEFT(s.LocationName, 65535), c.CountryName, s.Area,
       MIN(co.GX), MIN(co.GY), MIN(co.GZ), IF(s.PUOM IN ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'), s.PUOM, 'm'), LEFT(s.DescriptionOfSite, 65535)
FROM ctfsweb_scbi.Site s
LEFT JOIN ctfsweb_scbi.Country c ON s.CountryID = c.CountryID
LEFT JOIN ctfsweb_scbi.Coordinates co ON s.PlotID = co.PlotID
WHERE EXISTS (SELECT 1 FROM ctfsweb_scbi.Site s)
GROUP BY s.PlotID, s.PlotName, s.LocationName, c.CountryName, s.Area, s.PUOM, s.DescriptionOfSite;

-- Properly capture the last insert ID for each row inserted
INSERT INTO temp_plot_mapping (old_PlotID, new_PlotID)
SELECT s.PlotID, (
    SELECT PlotID
    FROM forestgeo_scbi.plots
    WHERE PlotName = LEFT(s.PlotName, 65535)
      AND LocationName = LEFT(s.LocationName, 65535)
      AND CountryName = c.CountryName
      AND Area = s.Area
      AND GlobalX = MIN(co.GX)
      AND GlobalY = MIN(co.GY)
      AND GlobalZ = MIN(co.GZ)
      AND Unit = IF(s.PUOM IN ('km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'), s.PUOM, 'm')
      AND PlotDescription = LEFT(s.DescriptionOfSite, 65535)
    LIMIT 1
)
FROM ctfsweb_scbi.Site s
LEFT JOIN ctfsweb_scbi.Country c ON s.CountryID = c.CountryID
LEFT JOIN ctfsweb_scbi.Coordinates co ON s.PlotID = co.PlotID
WHERE EXISTS (SELECT 1 FROM ctfsweb_scbi.Site s)
GROUP BY s.PlotID, s.PlotName, s.LocationName, c.CountryName, s.Area, s.PUOM, s.DescriptionOfSite;

-- Insert into personnel and populate mapping table
INSERT INTO forestgeo_scbi.personnel (FirstName, LastName, Role)
SELECT p.FirstName, p.LastName, GROUP_CONCAT(rr.Description SEPARATOR ', ')
FROM ctfsweb_scbi.Personnel p
JOIN ctfsweb_scbi.PersonnelRole pr ON p.PersonnelID = pr.PersonnelID
JOIN ctfsweb_scbi.RoleReference rr ON pr.RoleID = rr.RoleID
GROUP BY p.PersonnelID, p.FirstName, p.LastName;

INSERT INTO temp_personnel_mapping (old_PersonnelID, new_PersonnelID)
SELECT p.PersonnelID, (
    SELECT PersonnelID
    FROM forestgeo_scbi.personnel
    WHERE FirstName = p.FirstName
      AND LastName = p.LastName
    LIMIT 1
)
FROM ctfsweb_scbi.Personnel p
GROUP BY p.PersonnelID, p.FirstName, p.LastName;

-- Insert into census and populate mapping table
INSERT INTO forestgeo_scbi.census (PlotID, StartDate, EndDate, Description, PlotCensusNumber)
SELECT PlotID, StartDate, EndDate, LEFT(Description, 65535), PlotCensusNumber
FROM ctfsweb_scbi.Census
WHERE EXISTS (SELECT 1 FROM ctfsweb_scbi.Census);

INSERT INTO temp_census_mapping (old_CensusID, new_CensusID)
SELECT CensusID, (
    SELECT CensusID
    FROM forestgeo_scbi.census
    WHERE PlotID = c.PlotID
      AND StartDate = c.StartDate
      AND EndDate = c.EndDate
      AND Description = LEFT(c.Description, 65535)
      AND PlotCensusNumber = c.PlotCensusNumber
    LIMIT 1
)
FROM ctfsweb_scbi.Census c
WHERE EXISTS (SELECT 1 FROM ctfsweb_scbi.Census);

-- Insert into quadrats and populate mapping table
INSERT INTO forestgeo_scbi.quadrats (PlotID, CensusID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, Unit)
SELECT q.PlotID, cq.CensusID, LEFT(q.QuadratName, 65535), MIN(co.PX), MIN(co.PY), s.QDimX, s.QDimY, q.Area,
       CASE WHEN q.IsStandardShape = 'Y' THEN 'standard' ELSE 'not standard' END,
       IFNULL(s.QUOM, 'm') AS Unit
FROM ctfsweb_scbi.Quadrat q
LEFT JOIN ctfsweb_scbi.CensusQuadrat cq ON q.QuadratID = cq.QuadratID
LEFT JOIN ctfsweb_scbi.Coordinates co ON q.QuadratID = co.QuadratID
LEFT JOIN ctfsweb_scbi.Site s ON q.PlotID = s.PlotID
WHERE EXISTS (SELECT 1 FROM ctfsweb_scbi.Quadrat q)
GROUP BY q.QuadratID, q.PlotID, cq.CensusID, q.QuadratName, s.QDimX, s.QDimY, q.Area, q.IsStandardShape, s.QUOM;

INSERT INTO temp_quadrat_mapping (old_QuadratID, new_QuadratID)
SELECT q.QuadratID, (
    SELECT QuadratID
    FROM forestgeo_scbi.quadrats
    WHERE PlotID = q.PlotID
      AND CensusID = cq.CensusID
      AND QuadratName = LEFT(q.QuadratName, 65535)
      AND StartX = MIN(co.PX)
      AND StartY = MIN(co.PY)
      AND DimensionX = s.QDimX
      AND DimensionY = s.QDimY
      AND Area = q.Area
      AND QuadratShape = CASE WHEN q.IsStandardShape = 'Y' THEN 'standard' ELSE 'not standard' END
      AND Unit = IFNULL(s.QUOM, 'm')
    LIMIT 1
)
FROM ctfsweb_scbi.Quadrat q
LEFT JOIN ctfsweb_scbi.CensusQuadrat cq ON q.QuadratID = cq.QuadratID
LEFT JOIN ctfsweb_scbi.Coordinates co ON q.QuadratID = co.QuadratID
LEFT JOIN ctfsweb_scbi.Site s ON q.PlotID = s.PlotID
WHERE EXISTS (SELECT 1 FROM ctfsweb_scbi.Quadrat q)
GROUP BY q.QuadratID, q.PlotID, cq.CensusID, q.QuadratName, s.QDimX, s.QDimY, q.Area, q.IsStandardShape, s.QUOM;

-- Insert into genus and populate mapping table
INSERT INTO forestgeo_scbi.genus (FamilyID, Genus, ReferenceID)
SELECT FamilyID, Genus, ReferenceID
FROM ctfsweb_scbi.Genus
WHERE EXISTS (SELECT 1 FROM ctfsweb_scbi.Genus);

INSERT INTO temp_genus_mapping (old_GenusID, new_GenusID)
SELECT GenusID, (
    SELECT GenusID
    FROM forestgeo_scbi.genus
    WHERE FamilyID = g.FamilyID
      AND Genus = g.Genus
      AND ReferenceID = g.ReferenceID
    LIMIT 1
)
FROM ctfsweb_scbi.Genus g
WHERE EXISTS (SELECT 1 FROM ctfsweb_scbi.Genus);

-- Insert into species and populate mapping table
INSERT INTO forestgeo_scbi.species (GenusID, SpeciesCode, CurrentTaxonFlag, ObsoleteTaxonFlag, SpeciesName, SubspeciesName, IDLevel, SpeciesAuthority, SubspeciesAuthority, FieldFamily, Description, ReferenceID)
SELECT sp.GenusID, sp.Mnemonic, sp.CurrentTaxonFlag, sp.ObsoleteTaxonFlag, sp.Mnemonic, MIN(subs.SubSpeciesName), sp.IDLevel, sp.Authority, MIN(subs.Authority), sp.FieldFamily, LEFT(sp.Description, 65535), sp.ReferenceID
FROM ctfsweb_scbi.Species sp
LEFT JOIN ctfsweb_scbi.SubSpecies subs ON sp.SpeciesID = subs.SpeciesID
LEFT JOIN ctfsweb_scbi.Reference ref ON sp.ReferenceID = ref.ReferenceID
WHERE EXISTS (SELECT 1 FROM ctfsweb_scbi.Species)
GROUP BY sp.SpeciesID, sp.GenusID, sp.Mnemonic, sp.CurrentTaxonFlag, sp.ObsoleteTaxonFlag, sp.IDLevel, sp.Authority, sp.FieldFamily, sp.Description, sp.ReferenceID;

INSERT INTO temp_species_mapping (old_SpeciesID, new_SpeciesID)
SELECT sp.SpeciesID, (
    SELECT SpeciesID
    FROM forestgeo_scbi.species
    WHERE GenusID = sp.GenusID
      AND SpeciesCode = sp.Mnemonic
      AND CurrentTaxonFlag = sp.CurrentTaxonFlag
      AND ObsoleteTaxonFlag = sp.ObsoleteTaxonFlag
      AND SpeciesName = sp.Mnemonic
      AND SubspeciesName = MIN(subs.SubSpeciesName)
      AND IDLevel = sp.IDLevel
      AND SpeciesAuthority = sp.Authority
      AND SubspeciesAuthority = MIN(subs.Authority)
      AND FieldFamily = sp.FieldFamily
      AND Description = LEFT(sp.Description, 65535)
      AND ReferenceID = sp.ReferenceID
    LIMIT 1
)
FROM ctfsweb_scbi.Species sp
LEFT JOIN ctfsweb_scbi.SubSpecies subs ON sp.SpeciesID = subs.SpeciesID
LEFT JOIN ctfsweb_scbi.Reference ref ON sp.ReferenceID = ref.ReferenceID
WHERE EXISTS (SELECT 1 FROM ctfsweb_scbi.Species)
GROUP BY sp.SpeciesID, sp.GenusID, sp.Mnemonic, sp.CurrentTaxonFlag, sp.ObsoleteTaxonFlag, sp.IDLevel, sp.Authority, sp.FieldFamily, sp.Description, sp.ReferenceID;

-- Insert into stems and populate mapping table
INSERT INTO forestgeo_scbi.stems (TreeID, QuadratID, SubquadratID, StemNumber, StemTag, LocalX, LocalY, Unit, Moved, StemDescription)
SELECT s.TreeID, s.QuadratID, NULL, s.StemNumber, s.StemTag, MIN(co.QX), MIN(co.QY),
       IFNULL(si.QUOM, 'm') AS Unit, s.Moved, LEFT(s.StemDescription, 65535)
FROM ctfsweb_scbi.Stem s
LEFT JOIN ctfsweb_scbi.Coordinates co ON s.QuadratID = co.QuadratID
LEFT JOIN ctfsweb_scbi.Quadrat q ON q.QuadratID = s.QuadratID
LEFT JOIN ctfsweb_scbi.Site si ON q.PlotID = si.PlotID
WHERE EXISTS (SELECT 1 FROM ctfsweb_scbi.Stem)
GROUP BY s.StemID, s.TreeID, s.QuadratID, s.StemNumber, s.StemTag, s.Moved, s.StemDescription, si.QUOM;

INSERT INTO temp_stem_mapping (old_StemID, new_StemID)
SELECT s.StemID, (
    SELECT StemID
    FROM forestgeo_scbi.stems
    WHERE TreeID = s.TreeID
      AND QuadratID = s.QuadratID
      AND SubquadratID IS NULL
      AND StemNumber = s.StemNumber
      AND StemTag = s.StemTag
      AND LocalX = MIN(co.QX)
      AND LocalY = MIN(co.QY)
      AND Unit = IFNULL(si.QUOM, 'm')
      AND Moved = s.Moved
      AND StemDescription = LEFT(s.StemDescription, 65535)
    LIMIT 1
)
FROM ctfsweb_scbi.Stem s
LEFT JOIN ctfsweb_scbi.Coordinates co ON s.QuadratID = co.QuadratID
LEFT JOIN ctfsweb_scbi.Quadrat q ON q.QuadratID = s.QuadratID
LEFT JOIN ctfsweb_scbi.Site si ON q.PlotID = si.PlotID
WHERE EXISTS (SELECT 1 FROM ctfsweb_scbi.Stem)
GROUP BY s.StemID, s.TreeID, s.QuadratID, s.StemNumber, s.StemTag, s.Moved, s.StemDescription, si.QUOM;

-- Insert into coremeasurements and populate mapping table
INSERT INTO forestgeo_scbi.coremeasurements (CensusID, PlotID, QuadratID, SubQuadratID, TreeID, StemID, PersonnelID, IsValidated, MeasurementDate, MeasuredDBH, DBHUnit, MeasuredHOM, HOMUnit, Description, UserDefinedFields)
SELECT dbh.CensusID, s.PlotID, q.QuadratID, NULL, t.TreeID, dbh.StemID, NULL, NULL,
       dbh.ExactDate, dbh.DBH, 'm', CONVERT(dbh.HOM, DECIMAL(10,6)), 'm', LEFT(dbh.Comments, 65535), NULL
FROM ctfsweb_scbi.DBH dbh
JOIN ctfsweb_scbi.Census c ON dbh.CensusID = c.CensusID
JOIN ctfsweb_scbi.Site s ON c.PlotID = s.PlotID
JOIN ctfsweb_scbi.Quadrat q ON s.PlotID = q.PlotID
JOIN ctfsweb_scbi.Tree t ON dbh.StemID = t.TreeID
WHERE EXISTS (SELECT 1 FROM ctfsweb_scbi.DBH)
GROUP BY dbh.DBHID, dbh.CensusID, s.PlotID, q.QuadratID, t.TreeID, dbh.StemID, dbh.ExactDate, dbh.DBH, dbh.HOM, dbh.Comments;

INSERT INTO temp_stem_mapping (old_StemID, new_StemID)
SELECT dbh.StemID, (
    SELECT StemID
    FROM forestgeo_scbi.coremeasurements cm
    WHERE CensusID = dbh.CensusID
      AND PlotID = s.PlotID
      AND QuadratID = q.QuadratID
      AND TreeID = t.TreeID
      AND StemID = dbh.StemID
      AND MeasurementDate = dbh.ExactDate
      AND MeasuredDBH = dbh.DBH
      AND MeasuredHOM = CONVERT(dbh.HOM, DECIMAL(10,6))
    LIMIT 1
)
FROM ctfsweb_scbi.DBH dbh
JOIN ctfsweb_scbi.Census c ON dbh.CensusID = c.CensusID
JOIN ctfsweb_scbi.Site s ON c.PlotID = s.PlotID
JOIN ctfsweb_scbi.Quadrat q ON s.PlotID = q.PlotID
JOIN ctfsweb_scbi.Tree t ON dbh.StemID = t.TreeID
WHERE EXISTS (SELECT 1 FROM ctfsweb_scbi.DBH)
GROUP BY dbh.DBHID, dbh.CensusID, s.PlotID, q.QuadratID, t.TreeID, dbh.StemID, dbh.ExactDate, dbh.DBH, dbh.HOM, dbh.Comments;

-- Insert into quadratpersonnel
INSERT INTO forestgeo_scbi.quadratpersonnel (QuadratID, PersonnelID, AssignedDate)
SELECT dc.QuadratID, dc.PersonnelRoleID, dc.StartDate
FROM ctfsweb_scbi.DataCollection dc
WHERE EXISTS (SELECT 1 FROM ctfsweb_scbi.DataCollection)
GROUP BY dc.DataCollectionID, dc.QuadratID, dc.PersonnelRoleID, dc.StartDate;

-- Insert into attributes
INSERT INTO forestgeo_scbi.attributes (Code, Description, Status)
SELECT TSMCode, LEFT(Description, 65535),
       CASE
           WHEN Status IN ('alive', 'alive-not measured', 'dead', 'stem dead', 'broken below', 'omitted', 'missing') THEN Status
           ELSE NULL
       END
FROM ctfsweb_scbi.TSMAttributes
WHERE EXISTS (SELECT 1 FROM ctfsweb_scbi.TSMAttributes)
GROUP BY TSMCode, Description, Status;

-- Insert into cmattributes
INSERT INTO forestgeo_scbi.cmattributes (CoreMeasurementID, Code)
SELECT cm.CoreMeasurementID, a.Code
FROM ctfsweb_scbi.DBHAttributes dbha
JOIN ctfsweb_scbi.TSMAttributes tsm ON dbha.TSMID = tsm.TSMID
JOIN forestgeo_scbi.coremeasurements cm ON dbha.DBHID = cm.StemID
JOIN forestgeo_scbi.attributes a ON tsm.TSMCode = a.Code
WHERE EXISTS (SELECT 1 FROM ctfsweb_scbi.DBHAttributes)
GROUP BY dbha.DBHAttID, cm.CoreMeasurementID, a.Code;

-- Update foreign keys in related tables
UPDATE forestgeo_scbi.coremeasurements cm
JOIN temp_census_mapping tcm ON cm.CensusID = tcm.old_CensusID
SET cm.CensusID = tcm.new_CensusID;

UPDATE forestgeo_scbi.coremeasurements cm
JOIN temp_plot_mapping tpm ON cm.PlotID = tpm.old_PlotID
SET cm.PlotID = tpm.new_PlotID;

UPDATE forestgeo_scbi.coremeasurements cm
JOIN temp_quadrat_mapping tqm ON cm.QuadratID = tqm.old_QuadratID
SET cm.QuadratID = tqm.new_QuadratID;

UPDATE forestgeo_scbi.coremeasurements cm
JOIN temp_stem_mapping tsm ON cm.StemID = tsm.old_StemID
SET cm.StemID = tsm.new_StemID;

UPDATE forestgeo_scbi.coremeasurements cm
JOIN temp_species_mapping tsm ON cm.TreeID = tsm.old_SpeciesID
SET cm.TreeID = tsm.new_SpeciesID;

UPDATE forestgeo_scbi.cmattributes ca
JOIN temp_species_mapping tsm ON ca.CoreMeasurementID = tsm.old_SpeciesID
SET ca.CoreMeasurementID = tsm.new_SpeciesID;

UPDATE forestgeo_scbi.quadratpersonnel qp
JOIN temp_quadrat_mapping tqm ON qp.QuadratID = tqm.old_QuadratID
SET qp.QuadratID = tqm.new_QuadratID;

UPDATE forestgeo_scbi.quadratpersonnel qp
JOIN temp_personnel_mapping tpm ON qp.PersonnelID = tpm.old_PersonnelID
SET qp.PersonnelID = tpm.new_PersonnelID;

-- Drop temporary mapping tables
DROP TABLE IF EXISTS temp_census_mapping;
DROP TABLE IF EXISTS temp_plot_mapping;
DROP TABLE IF EXISTS temp_personnel_mapping;
DROP TABLE IF EXISTS temp_quadrat_mapping;
DROP TABLE IF EXISTS temp_genus_mapping;
DROP TABLE IF EXISTS temp_species_mapping;
DROP TABLE IF EXISTS temp_stem_mapping;

SET foreign_key_checks = 1;
```

{collapsible="true" collapsed-title="migration script"}

> Make sure you change the name of the targeted and targeting schema in this script to your schema names! They are
> currently set to `ctfsweb_scbi` and `forestgeo_scbi`, respectively, and must be changed, otherwise the script will
> fail.
> {style="warning"}

### As the Migration Continues

This will take a good amount of time (average for me was between 1-3 hours). As the script runs, you may find it
beneficial to have some way to monitor the progress of the script's execution, so the following script may come in
hand.

> Make sure you run it in a new command-line/terminal instance!

> Make sure you replace the DB_NAME variable with your schema's name!

```Bash
#!/bin/bash

DB_NAME="forestgeo_scbi"

# List of tables to monitor
TABLES=(
    "plots"
    "personnel"
    "census"
    "quadrats"
    "genus"
    "species"
    "stems"
    "coremeasurements"
    "quadratpersonnel"
    "attributes"
    "cmattributes"
)

# Interval in seconds
INTERVAL=20
# Timeout for MySQL queries in seconds
QUERY_TIMEOUT=10

cleanup() {
    process_ids=$(mysql --defaults-file=~/.my.cnf  -D $DB_NAME -se "SHOW PROCESSLIST;" | awk '/SELECT COUNT/ {print $1}')
    for pid in $process_ids; do
        mysql --defaults-file=~/.my.cnf -D $DB_NAME -se "KILL $pid;"
        echo "-----------------------------"
        echo "Killed process ID $pid"
        echo "-----------------------------"
    done
}

while true; do
  echo "-----------------------------"
  echo "$(date): Row counts in forestgeo_scbi schema"
  echo "-----------------------------"

  for TABLE in "${TABLES[@]}"; do
    timeout $QUERY_TIMEOUT mysql --defaults-file=~/.my.cnf -D $DB_NAME -se "SELECT COUNT(*) FROM $TABLE;" > /tmp/${TABLE}_count &
    QUERY_PID=$!
    wait $QUERY_PID

    if [ $? -eq 124 ]; then
      echo "$TABLE: query timed out"
    else
      ROW_COUNT=$(cat /tmp/${TABLE}_count)
      echo "$TABLE: $ROW_COUNT rows"
    fi

    cleanup
  done

  echo "-----------------------------"
  echo "$(date): SHOW PROCESSLIST output"
  echo "-----------------------------"
  mysql --defaults-file=~/.my.cnf -D $DB_NAME -e "SHOW PROCESSLIST;"
  echo "-----------------------------"

  sleep $INTERVAL
done


```

{collapsible="true" collapsed-title="migration monitoring script"}

Additionally, the following script may prove useful (it did for me) to remove accumulating `SELECT COUNT(*)` queries
in your processlist (I saw them starting to pile up as the script continued. The script as it is should
automatically remove them, so this is just a backup in case it becomes necessary). Like the migration script, run
this from another terminal instance:

```Bash
#!/bin/bash

# Database credentials
DB_NAME="forestgeo_scbi"

# Find all process IDs of the SELECT COUNT(*) queries
process_ids=$(mysql --defaults-file=~/.my.cnf  -D $DB_NAME -se "SHOW PROCESSLIST;" | awk '/SELECT COUNT/ {print $1}')

# Kill each process
for pid in $process_ids; do
  mysql  --defaults-file=~/.my.cnf  -D $DB_NAME -se "KILL $pid;"
  echo "Killed process ID $pid"
done
```

{collapsible="true" collapsed-title="backup monitoring cleanup script"}

#### Prerequisites:

1. Make sure you create the file `~/.my.cnf` in the `~` directory and add your connection credentials to it (example
   here):

```Bash
[client]
user=<username>
password=<password>
host=forestgeo-mysqldataserver.mysql.database.azure.com
```

> Make sure you replace the <> portions with your actual credentials! I've left the host endpoint as it is because
> that shouldn't change unless absolutely necessary, but make sure you check that as well.

### After Migration Completes

Make sure you check all of the now-populated tables to ensure that the system has not messed up populating them.

> One of the issues I ran into was even though the flat file only specified one plot, the plots table after the
> migration contained several hundred duplicates of that single plot.
> {style="note"}
