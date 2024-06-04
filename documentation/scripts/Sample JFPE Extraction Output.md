###### Output:
```Text
Extracting SQL statements from bci.sql...
Starting extraction process
Captured table: Census
Foreign key reference from Census to Site
Captured table: CensusQuadrat
Foreign key reference from CensusQuadrat to Census
Foreign key reference from CensusQuadrat to Quadrat
Captured table: Coordinates
Foreign key reference from Coordinates to Features
Foreign key reference from Coordinates to Site
Foreign key reference from Coordinates to Quadrat
Captured table: Country
Captured table: CurrentObsolete
Foreign key reference from CurrentObsolete to Species
Foreign key reference from CurrentObsolete to Species
Foreign key reference from CurrentObsolete to TreeTaxChange
Captured table: DBH
Foreign key reference from DBH to Census
Foreign key reference from DBH to Stem
Captured table: DBHAttributes
Foreign key reference from DBHAttributes to TSMAttributes
Foreign key reference from DBHAttributes to DBH
Captured table: DataCollection
Foreign key reference from DataCollection to Quadrat
Foreign key reference from DataCollection to Census
Foreign key reference from DataCollection to PersonnelRole
Captured table: Family
Foreign key reference from Family to Reference
Captured table: FeatureTypes
Captured table: Features
Foreign key reference from Features to FeatureTypes
Captured table: Genus
Foreign key reference from Genus to Family
Foreign key reference from Genus to Reference
Captured table: Log
Foreign key reference from Log to Personnel
Captured table: LogMAttrHistoryd
Captured table: LogMeasurementHistoryd
Captured table: LogSpeciesInventory
Captured table: LogTreeHistoryd
Captured table: Measurement
Foreign key reference from Measurement to Census
Foreign key reference from Measurement to Tree
Foreign key reference from Measurement to Stem
Foreign key reference from Measurement to MeasurementType
Captured table: MeasurementAttributes
Foreign key reference from MeasurementAttributes to Measurement
Foreign key reference from MeasurementAttributes to TSMAttributes
Captured table: MeasurementType
Captured table: Personnel
Captured table: PersonnelRole
Foreign key reference from PersonnelRole to RoleReference
Foreign key reference from PersonnelRole to Personnel
Captured table: Quadrat
Foreign key reference from Quadrat to Site
Captured table: Reference
Captured table: RemeasAttribs
Foreign key reference from RemeasAttribs to TSMAttributes
Foreign key reference from RemeasAttribs to Remeasurement
Captured table: Remeasurement
Foreign key reference from Remeasurement to Census
Foreign key reference from Remeasurement to Stem
Captured table: RoleReference
Captured table: Site
Foreign key reference from Site to Country
Captured table: Species
Foreign key reference from Species to Genus
Captured table: SpeciesInventory
Foreign key reference from SpeciesInventory to Census
Foreign key reference from SpeciesInventory to Site
Foreign key reference from SpeciesInventory to Species
Foreign key reference from SpeciesInventory to SubSpecies
Captured table: SpeciesReference
Captured table: Specimen
Foreign key reference from Specimen to Species
Foreign key reference from Specimen to SubSpecies
Foreign key reference from Specimen to Tree
Captured table: Stem
Foreign key reference from Stem to Tree
Captured table: SubSpecies
Foreign key reference from SubSpecies to Species
Captured table: TSMAttributes
Captured table: Tree
Foreign key reference from Tree to Species
Foreign key reference from Tree to SubSpecies
Captured table: TreeAttributes
Foreign key reference from TreeAttributes to Census
Foreign key reference from TreeAttributes to Tree
Foreign key reference from TreeAttributes to TSMAttributes
Captured table: TreeTaxChange
Captured table: ViewFullTable
Captured table: ViewTaxonomy
Captured table: viewAbund
Captured DROP TABLE: Census
Captured DROP TABLE: CensusQuadrat
Captured DROP TABLE: CensusView
Captured DROP TABLE: Coordinates
Captured DROP TABLE: Country
Captured DROP TABLE: CurrentObsolete
Captured DROP TABLE: DBH
Captured DROP TABLE: DBHAttributes
Captured DROP TABLE: DataCollection
Captured DROP TABLE: Family
Captured DROP TABLE: FeatureTypes
Captured DROP TABLE: Features
Captured DROP TABLE: Genus
Captured DROP TABLE: Log
Captured DROP TABLE: LogMAttrHistoryd
Captured DROP TABLE: LogMeasurementHistoryd
Captured DROP TABLE: LogSpeciesInventory
Captured DROP TABLE: LogTreeHistoryd
Captured DROP TABLE: Measurement
Captured DROP TABLE: MeasurementAttributes
Captured DROP TABLE: MeasurementType
Captured DROP TABLE: Personnel
Captured DROP TABLE: PersonnelRole
Captured DROP TABLE: Quadrat
Captured DROP TABLE: Reference
Captured DROP TABLE: RemeasAttribs
Captured DROP TABLE: Remeasurement
Captured DROP TABLE: RoleReference
Captured DROP TABLE: Site
Captured DROP TABLE: Species
Captured DROP TABLE: SpeciesInventory
Captured DROP TABLE: SpeciesReference
Captured DROP TABLE: Specimen
Captured DROP TABLE: Stem
Captured DROP TABLE: SubSpecies
Captured DROP TABLE: TSMAttributes
Captured DROP TABLE: Tree
Captured DROP TABLE: TreeAttributes
Captured DROP TABLE: TreeTaxChange
Captured DROP TABLE: ViewFullTable
Captured DROP TABLE: ViewTaxonomy
Captured DROP TABLE: viewAbund
Visited table: Country
Visited table: Site
Visited table: Quadrat
Visited table: Census
Visited table: RoleReference
Visited table: Personnel
Visited table: PersonnelRole
Visited table: DataCollection
Visited table: Reference
Visited table: Family
Visited table: Genus
Visited table: Species
Visited table: SubSpecies
Visited table: Tree
Visited table: Stem
Visited table: MeasurementType
Visited table: Measurement
Visited table: CensusQuadrat
Visited table: TSMAttributes
Visited table: Remeasurement
Visited table: RemeasAttribs
Visited table: DBH
Visited table: DBHAttributes
Visited table: SpeciesInventory
Visited table: FeatureTypes
Visited table: Features
Visited table: Coordinates
Visited table: Log
Visited table: TreeTaxChange
Visited table: CurrentObsolete
Visited table: Specimen
Visited table: TreeAttributes
Visited table: MeasurementAttributes
Writing table without FK to file: Reference
Writing table without FK to file: ViewTaxonomy
Writing table without FK to file: viewAbund
Writing table without FK to file: TSMAttributes
Writing table without FK to file: SpeciesReference
Writing table without FK to file: LogSpeciesInventory
Writing table without FK to file: LogMAttrHistoryd
Writing table without FK to file: Country
Writing table without FK to file: TreeTaxChange
Writing table without FK to file: RoleReference
Writing table without FK to file: ViewFullTable
Writing table without FK to file: LogTreeHistoryd
Writing table without FK to file: MeasurementType
Writing table without FK to file: Personnel
Writing table without FK to file: LogMeasurementHistoryd
Writing table without FK to file: FeatureTypes
Writing table with FK to file: Country
Writing table with FK to file: Site
Writing table with FK to file: Quadrat
Writing table with FK to file: Census
Writing table with FK to file: RoleReference
Writing table with FK to file: Personnel
Writing table with FK to file: PersonnelRole
Writing table with FK to file: DataCollection
Writing table with FK to file: Reference
Writing table with FK to file: Family
Writing table with FK to file: Genus
Writing table with FK to file: Species
Writing table with FK to file: SubSpecies
Writing table with FK to file: Tree
Writing table with FK to file: Stem
Writing table with FK to file: MeasurementType
Writing table with FK to file: Measurement
Writing table with FK to file: CensusQuadrat
Writing table with FK to file: TSMAttributes
Writing table with FK to file: Remeasurement
Writing table with FK to file: RemeasAttribs
Writing table with FK to file: DBH
Writing table with FK to file: DBHAttributes
Writing table with FK to file: SpeciesInventory
Writing table with FK to file: FeatureTypes
Writing table with FK to file: Features
Writing table with FK to file: Coordinates
Writing table with FK to file: Log
Writing table with FK to file: TreeTaxChange
Writing table with FK to file: CurrentObsolete
Writing table with FK to file: Specimen
Writing table with FK to file: TreeAttributes
Writing table with FK to file: MeasurementAttributes
Captured INSERT INTO for table: Census
Captured INSERT INTO for table: CensusQuadrat
Captured INSERT INTO for table: Coordinates
Captured INSERT INTO for table: Country
Captured INSERT INTO for table: CurrentObsolete
Captured INSERT INTO for table: DBH
...
Captured INSERT INTO for table: DBH
Captured INSERT INTO for table: DBHAttributes
...
Captured INSERT INTO for table: DBHAttributes
Captured INSERT INTO for table: DataCollection
Captured INSERT INTO for table: Family
Captured INSERT INTO for table: Genus
Captured INSERT INTO for table: Log
...
Captured INSERT INTO for table: Log
Captured INSERT INTO for table: LogMAttrHistoryd
Captured INSERT INTO for table: LogMeasurementHistoryd
Captured INSERT INTO for table: LogSpeciesInventory
Captured INSERT INTO for table: LogTreeHistoryd
Captured INSERT INTO for table: Personnel
Captured INSERT INTO for table: PersonnelRole
Captured INSERT INTO for table: Quadrat
Captured INSERT INTO for table: Reference
Captured INSERT INTO for table: RemeasAttribs
Captured INSERT INTO for table: Remeasurement
Captured INSERT INTO for table: RoleReference
Captured INSERT INTO for table: Site
Captured INSERT INTO for table: Species
Captured INSERT INTO for table: SpeciesInventory
Captured INSERT INTO for table: SpeciesReference
Captured INSERT INTO for table: Stem
...
Captured INSERT INTO for table: Stem
Captured INSERT INTO for table: SubSpecies
Captured INSERT INTO for table: TSMAttributes
Captured INSERT INTO for table: Tree
...
Captured INSERT INTO for table: Tree
Captured INSERT INTO for table: TreeTaxChange
Captured INSERT INTO for table: ViewFullTable
...
Captured INSERT INTO for table: ViewFullTable
Captured INSERT INTO for table: ViewTaxonomy
Captured INSERT INTO for table: viewAbund
Visited drop table: TSMAttributes
Visited drop table: Country
Visited drop table: Site
Visited drop table: Census
Visited drop table: Reference
Visited drop table: Family
Visited drop table: Genus
Visited drop table: Species
Visited drop table: SubSpecies
Visited drop table: Tree
Visited drop table: Stem
Visited drop table: Remeasurement
Visited drop table: RemeasAttribs
Visited drop table: MeasurementType
Visited drop table: Measurement
Visited drop table: Quadrat
Visited drop table: CensusQuadrat
Visited drop table: RoleReference
Visited drop table: Personnel
Visited drop table: PersonnelRole
Visited drop table: DataCollection
Visited drop table: viewAbund
Visited drop table: ViewTaxonomy
Visited drop table: FeatureTypes
Visited drop table: Features
Visited drop table: Coordinates
Visited drop table: SpeciesReference
Visited drop table: SpeciesInventory
Visited drop table: DBH
Visited drop table: DBHAttributes
Visited drop table: Log
Visited drop table: CensusView
Visited drop table: LogSpeciesInventory
Visited drop table: LogMAttrHistoryd
Visited drop table: TreeTaxChange
Visited drop table: CurrentObsolete
Visited drop table: Specimen
Visited drop table: ViewFullTable
Visited drop table: TreeAttributes
Visited drop table: MeasurementAttributes
Visited drop table: LogMeasurementHistoryd
Visited drop table: LogTreeHistoryd
Writing DROP TABLE to file: LogTreeHistoryd
Writing DROP TABLE to file: LogMeasurementHistoryd
Writing DROP TABLE to file: MeasurementAttributes
Writing DROP TABLE to file: TreeAttributes
Writing DROP TABLE to file: ViewFullTable
Writing DROP TABLE to file: Specimen
Writing DROP TABLE to file: CurrentObsolete
Writing DROP TABLE to file: TreeTaxChange
Writing DROP TABLE to file: LogMAttrHistoryd
Writing DROP TABLE to file: LogSpeciesInventory
Writing DROP TABLE to file: CensusView
Writing DROP TABLE to file: Log
Writing DROP TABLE to file: DBHAttributes
Writing DROP TABLE to file: DBH
Writing DROP TABLE to file: SpeciesInventory
Writing DROP TABLE to file: SpeciesReference
Writing DROP TABLE to file: Coordinates
Writing DROP TABLE to file: Features
Writing DROP TABLE to file: FeatureTypes
Writing DROP TABLE to file: ViewTaxonomy
Writing DROP TABLE to file: viewAbund
Writing DROP TABLE to file: DataCollection
Writing DROP TABLE to file: PersonnelRole
Writing DROP TABLE to file: Personnel
Writing DROP TABLE to file: RoleReference
Writing DROP TABLE to file: CensusQuadrat
Writing DROP TABLE to file: Quadrat
Writing DROP TABLE to file: Measurement
Writing DROP TABLE to file: MeasurementType
Writing DROP TABLE to file: RemeasAttribs
Writing DROP TABLE to file: Remeasurement
Writing DROP TABLE to file: Stem
Writing DROP TABLE to file: Tree
Writing DROP TABLE to file: SubSpecies
Writing DROP TABLE to file: Species
Writing DROP TABLE to file: Genus
Writing DROP TABLE to file: Family
Writing DROP TABLE to file: Reference
Writing DROP TABLE to file: Census
Writing DROP TABLE to file: Site
Writing DROP TABLE to file: Country
Writing DROP TABLE to file: TSMAttributes

```