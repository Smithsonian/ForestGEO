# ForestGEO Database Migration Guide

## Overview

This directory contains SQL migration scripts to migrate data from the denormalized `stable_mpala.viewfulltable` to the normalized `forestgeo_testing` schema.

## Source Data

- **Database**: `stable_mpala`
- **Primary Source**: `viewfulltable` (575,018 rows)
- **Supporting Tables**: `stem`, `dbh`, `tsmattributes`, `census`, `quadrat`, `coordinates`

## Target Schema

- **Database**: `forestgeo_testing`
- **Tables**: `plots`, `quadrats`, `family`, `genus`, `species`, `census`, `trees`, `stems`, `coremeasurements`, `attributes`, `cmattributes`

## Migration Strategy

### Key Features

1. **Preserves Relationships**: All foreign key relationships are maintained through ID mapping tables
2. **No ID Conflicts**: Old IDs are mapped to new auto-incremented IDs
3. **Data Integrity**: Comprehensive validation queries ensure data quality
4. **Coordinates**: Uses actual stem coordinates from `stable_mpala.stem` table (QX, QY)
5. **Attributes**: Parses `ListOfTSM` field and links attributes to measurements

### Migration Order

Scripts must be executed in this order due to foreign key dependencies:

```
01. create_mapping_tables.sql    → Create ID mapping tables
02. migrate_plots.sql            → Migrate plot data
03. migrate_quadrats.sql         → Migrate quadrat data (depends on plots)
04. migrate_taxonomy.sql         → Migrate family → genus → species
05. migrate_census.sql           → Migrate census data (depends on plots)
06. migrate_trees.sql            → Migrate tree data (depends on species, census)
07. migrate_stems.sql            → Migrate stem data (depends on trees, quadrats, census)
08. migrate_coremeasurements.sql → Migrate measurements (depends on stems, census)
09. migrate_attributes.sql       → Migrate attributes and link to measurements
10. validation_queries.sql       → Comprehensive validation checks
```

## Quick Start

### Prerequisites

1. MySQL client installed and accessible via command line
2. Network access to Azure MySQL server
3. Credentials for the database (stored in `.env` file)
4. **IMPORTANT**: Backup your database before running migration!

### Option 1: Automated Migration (Recommended)

Run the master script to execute all migrations in order:

```bash
cd /Users/sambokar/Documents/ForestGEO/frontend/db-migrations
./00_run_all_migrations.sh
```

This script will:

- Execute all migration scripts in order
- Log all output to a timestamped log file
- Stop on first error
- Provide a summary at the end

### Option 2: Manual Migration

Execute scripts individually for better control:

```bash
# Set connection variables
MYSQL_HOST="forestgeo-mysqldataserver.mysql.database.azure.com"
MYSQL_USER="azureroot"
MYSQL_PASSWORD="P@ssw0rd"
MYSQL_PORT="3306"

# Execute each script
mysql -h $MYSQL_HOST -u $MYSQL_USER -p$MYSQL_PASSWORD -P $MYSQL_PORT --ssl < 01_create_mapping_tables.sql
mysql -h $MYSQL_HOST -u $MYSQL_USER -p$MYSQL_PASSWORD -P $MYSQL_PORT --ssl < 02_migrate_plots.sql
# ... continue with remaining scripts
```

## Migration Details

### 1. Plots Migration

- **Source**: `stable_mpala.viewfulltable` (distinct PlotID/PlotName)
- **Calculations**: Plot dimensions calculated from coordinate extents
- **Expected**: 1 plot (Mpala)

### 2. Quadrats Migration

- **Source**: `stable_mpala.viewfulltable` + `stable_mpala.coordinates`
- **Coordinates**: Upper-left corner (PX, PY) from coordinates table
- **Dimensions**: 20m x 20m (400 sq m area)
- **Expected**: ~3,750 quadrats

### 3. Taxonomy Migration

- **Family**: Distinct families from viewfulltable
- **Genus**: Linked to families
- **Species**: Includes subspecies, uses Mnemonic as SpeciesCode
- **Expected**: Variable based on data diversity

### 4. Census Migration

- **Source**: `stable_mpala.census`
- **Dates**: Handles invalid dates (0000-00-00) as NULL
- **Expected**: 2 censuses

### 5. Trees Migration

- **Source**: `stable_mpala.viewfulltable` (distinct TreeID/Tag)
- **Links**: Species + Census
- **Expected**: ~100,000+ unique trees

### 6. Stems Migration

- **Source**: `stable_mpala.stem` (for accurate coordinates)
- **Coordinates**: QX, QY as LocalX, LocalY (quadrat-local coordinates)
- **Links**: Trees + Quadrats + Census
- **Expected**: ~300,000+ stems

### 7. Core Measurements Migration

- **Source**: `stable_mpala.dbh`
- **Date Logic**: Uses ExactDate when available
- **Measurements**: DBH (mm), HOM (m)
- **Expected**: 575,018 measurements

### 8. Attributes Migration

- **Source**: `stable_mpala.tsmattributes` + `viewfulltable.ListOfTSM` + `viewfulltable.Status`
- **Parsing**: Splits comma-separated ListOfTSM codes
- **Linking**: Creates entries in `cmattributes` table
- **Expected**: Variable based on attribute usage

## Validation

The `10_validation_queries.sql` script performs comprehensive checks:

### Data Integrity Checks

- Row count comparisons (source vs target)
- Taxonomy hierarchy validation
- Spatial data validation (coordinate ranges)
- Foreign key relationship integrity
- Orphaned record detection

### Data Quality Checks

- DBH/HOM value ranges and statistics
- Suspicious outlier detection
- Missing coordinate detection
- Attribute distribution analysis
- Census coverage analysis

### Expected Results

After successful migration, you should see:

- ~575,000 measurements
- ~300,000 stems
- ~100,000 trees
- ~3,750 quadrats
- 1 plot
- 2 censuses
- Complete taxonomy hierarchy
- All relationships properly linked

## Troubleshooting

### Common Issues

#### Issue 1: Foreign Key Constraint Errors

**Cause**: Scripts executed out of order
**Solution**: Drop all data and re-run from script 01

```sql
USE forestgeo_testing;
SET FOREIGN_KEY_CHECKS = 0;
-- Truncate all tables
TRUNCATE TABLE cmattributes;
TRUNCATE TABLE attributes;
TRUNCATE TABLE coremeasurements;
TRUNCATE TABLE stems;
TRUNCATE TABLE trees;
TRUNCATE TABLE census;
TRUNCATE TABLE species;
TRUNCATE TABLE genus;
TRUNCATE TABLE family;
TRUNCATE TABLE quadrats;
TRUNCATE TABLE plots;
SET FOREIGN_KEY_CHECKS = 1;
```

#### Issue 2: Duplicate Key Errors

**Cause**: Re-running scripts without clearing previous data
**Solution**: Clear target tables before re-running

#### Issue 3: Missing Coordinates

**Cause**: Some stems don't have coordinates in source data
**Solution**: This is expected - validation query will report count

#### Issue 4: Connection Timeout

**Cause**: Large data volume, slow network
**Solution**: Increase MySQL timeout settings or run scripts on server

### Validation Failures

If validation queries show discrepancies:

1. **Check mapping table counts**: Should match source distinct IDs
2. **Review log file**: Check for warnings during migration
3. **Run sample queries**: Manually verify data transformation
4. **Check for NULL values**: Some fields may intentionally be NULL

## Post-Migration Steps

1. **Review Validation Results**
   - Check all validation query outputs
   - Investigate any warnings or discrepancies
   - Verify row counts match expectations

2. **Spot Check Data**
   - Select random samples and compare with source
   - Verify coordinate transformations
   - Check taxonomy hierarchy
   - Validate measurement data

3. **Performance Optimization** (Optional)
   - Add additional indexes if needed
   - Update table statistics
   - Analyze query performance

4. **Clean Up** (Optional)
   - Drop mapping tables if no longer needed
   - Archive log files
   - Document any issues encountered

5. **Update Application Code**
   - Modify queries to use new schema
   - Update API endpoints
   - Test all functionality

## Mapping Tables

The migration creates temporary mapping tables to track ID conversions:

- `id_map_plots`: old_PlotID → new_PlotID
- `id_map_quadrats`: old_QuadratID → new_QuadratID
- `id_map_family`: old_FamilyID → new_FamilyID
- `id_map_genus`: old_GenusID → new_GenusID
- `id_map_species`: old_SpeciesID → new_SpeciesID
- `id_map_census`: old_CensusID → new_CensusID
- `id_map_trees`: old_TreeID → new_TreeID
- `id_map_stems`: old_StemID → new_StemGUID

**Keep these tables** until you're certain the migration is successful. They're useful for:

- Debugging data issues
- Tracing records from old to new IDs
- Incremental updates if needed

## Important Notes

1. **Coordinate System**
   - **PX, PY**: Plot-level coordinates (upper-left of plot)
   - **QX, QY**: Quadrat-local coordinates (within 20m x 20m quadrat)
   - Migration uses QX, QY from `stem` table as LocalX, LocalY

2. **Date Handling**
   - Uses `ExactDate` from DBH table when available
   - Invalid dates (0000-00-00) converted to NULL

3. **Subspecies**
   - Combined with species in the same `species` table
   - Old SubspeciesID tracked in mapping table

4. **Attributes**
   - TSM codes from `ListOfTSM` parsed and linked individually
   - Status field also mapped to attribute codes
   - Multiple attributes can link to one measurement

## Support

For questions or issues:

1. Review validation query output
2. Check the migration log file
3. Verify source data in `stable_mpala` schema
4. Test with sample data first

## Schema Diagram

```
plots (PlotID)
  └── quadrats (QuadratID, PlotID FK)
  └── census (CensusID, PlotID FK)
      └── trees (TreeID, SpeciesID FK, CensusID FK)
          └── stems (StemGUID, TreeID FK, QuadratID FK, CensusID FK)
              └── coremeasurements (CoreMeasurementID, StemGUID FK, CensusID FK)
                  └── cmattributes (CoreMeasurementID FK, Code FK)
                      └── attributes (Code)

family (FamilyID)
  └── genus (GenusID, FamilyID FK)
      └── species (SpeciesID, GenusID FK)
          └── trees (SpeciesID FK)
```

## Files in This Directory

- `00_run_all_migrations.sh` - Master automation script
- `01_create_mapping_tables.sql` - Create ID mapping tables
- `02_migrate_plots.sql` - Migrate plot data
- `03_migrate_quadrats.sql` - Migrate quadrat data
- `04_migrate_taxonomy.sql` - Migrate family/genus/species
- `05_migrate_census.sql` - Migrate census records
- `06_migrate_trees.sql` - Migrate tree records
- `07_migrate_stems.sql` - Migrate stem records
- `08_migrate_coremeasurements.sql` - Migrate measurements
- `09_migrate_attributes.sql` - Migrate and link attributes
- `10_validation_queries.sql` - Comprehensive validation
- `README.md` - This file
- `migration_*.log` - Generated log files (after running)

## License & Credits

Created for the ForestGEO project to migrate Mpala plot data from legacy schema to normalized schema.
