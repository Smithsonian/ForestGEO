# ForestGEO Database Migration Guide

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [Key Concepts](#key-concepts)
5. [Migration Process](#migration-process)
6. [Validation & Verification](#validation--verification)
7. [Troubleshooting](#troubleshooting)
8. [File Reference](#file-reference)
9. [Advanced Topics](#advanced-topics)

---

## Introduction

### What This Does

This migration system converts forest plot data from the legacy CTFS schema (denormalized `viewfulltable`) to the normalized ForestGEO schema used by the web application.

**Source Schema** (legacy): `stable_*` (e.g., `stable_mpala`, `stable_bci`)
- Single denormalized view: `viewfulltable`
- Supporting tables: `stem`, `dbh`, `census`, `tsmattributes`

**Target Schema** (new): `forestgeo_*` (e.g., `forestgeo_mpala`, `forestgeo_testing`)
- Normalized tables: `plots`, `quadrats`, `trees`, `stems`, `coremeasurements`
- Taxonomy: `family` → `genus` → `species`
- Validation: `cmverrors`, `sitespecificvalidations`

### Why Migration Is Needed

The legacy CTFS schema stores all data in a single denormalized view. The new ForestGEO schema:
- Separates concerns (spatial, taxonomic, measurement data)
- Tracks data per-census (each census gets its own tree/stem records)
- Supports validation workflows
- Enables the web application's features

### Schema Relationship Diagram

```
SPATIAL                          TAXONOMIC                    MEASUREMENT
───────                          ────────                     ───────────
plots                            family
  │                                │
  ├── quadrats                   genus
  │     │                          │
  └── census ─────────────────── species
        │                          │
        └── trees ─────────────────┘
              │
              └── stems ──────────────────────── coremeasurements
                    │                                   │
                    │                                   └── cmattributes
                    │                                         │
                    └─────────────────────────────────── attributes
```

---

## Prerequisites

### Required Software

| Software | Version | Check Command |
|----------|---------|---------------|
| MySQL client | 8.0+ | `mysql --version` or `mariadb --version` |
| Bash | 4.0+ | `bash --version` |

### Required Access

- Network access to Azure MySQL server
- Database credentials (found in `frontend/.env.local`)
- Read access to source schema (e.g., `stable_mpala`)
- Write access to target schema (e.g., `forestgeo_mpala`)

### Before You Start

1. **Backup your target database** - migrations are destructive
2. **Verify source data exists**:
   ```sql
   SELECT COUNT(*) FROM stable_mpala.viewfulltable;
   -- Should return > 0 rows
   ```
3. **Check credentials** in `frontend/.env.local`:
   ```
   AZURE_SQL_SERVER=forestgeo-mysqldataserver.mysql.database.azure.com
   AZURE_SQL_USER=azureroot
   AZURE_SQL_PASSWORD=<password>
   ```

---

## Quick Start

### Option 1: Interactive Mode (Recommended for First-Time Users)

```bash
cd frontend/db-migrations
./run_migration.sh
```

The script will prompt you for:
- Source schema (e.g., `stable_mpala`)
- Target schema (e.g., `forestgeo_mpala`)
- Site name, location, and country

### Option 2: Command Line (Recommended for Automation)

```bash
cd frontend/db-migrations
./run_migration.sh \
  --source stable_mpala \
  --target forestgeo_mpala \
  --site "Mpala" \
  --location "Mpala Research Centre" \
  --country "Kenya"
```

### Option 3: Step-by-Step (For Debugging)

```bash
# 1. Connect to MySQL
MYSQL_PWD='<password>' mysql -h forestgeo-mysqldataserver.mysql.database.azure.com \
  -u azureroot --ssl -D forestgeo_mpala

# 2. Run scripts in order
SOURCE frontend/db-migrations/00_migration_framework.sql;
SOURCE frontend/sqlscripting/resetschema.sql;

SET @source_schema = 'stable_mpala';
SET @location_name = 'Mpala';
SET @country_name = 'Kenya';
SOURCE frontend/db-migrations/01_migrate_all_data.sql;
SOURCE frontend/db-migrations/02_validate_migration.sql;
SOURCE frontend/db-migrations/03_apply_schema_changes.sql;
```

### Checking Progress

```bash
# Check migration status
./run_migration.sh --status --target forestgeo_mpala

# Or in MySQL:
CALL migration_progress();
```

### Resuming After Failure

```bash
./run_migration.sh --resume --target forestgeo_mpala
```

---

## Key Concepts

### Census-Aware Mapping

**This is the most important concept to understand.**

In the legacy schema, a tree has ONE TreeID regardless of which census it was measured in:
```
TreeID=1234 appears in Census 1 AND Census 2
```

In the new schema, each tree gets a SEPARATE record per census:
```
TreeID=5001 (Census 1, TreeTag='ABC')
TreeID=5002 (Census 2, TreeTag='ABC')  ← Same physical tree, different record
```

**Why this matters**: When migrating measurements, we must link each measurement to the correct census-specific tree/stem. The mapping tables use composite keys:

```sql
-- Mapping table structure
id_map_trees (
    old_TreeID INT,
    old_CensusID INT,      -- ← Census is part of the key
    new_TreeID INT,
    PRIMARY KEY (old_TreeID, old_CensusID)
)
```

**What can go wrong**: If mappings are not census-aware, Census 2 measurements may incorrectly link to Census 1 stems, causing:
- Missing rows in `measurementssummary`
- Incorrect data in reports
- Validation failures

### ID Mapping Tables

The migration creates temporary tables to track how old IDs map to new IDs:

| Mapping Table | Old ID | New ID |
|---------------|--------|--------|
| `id_map_plots` | PlotID | PlotID |
| `id_map_quadrats` | QuadratID | QuadratID |
| `id_map_family` | FamilyID | FamilyID |
| `id_map_genus` | GenusID | GenusID |
| `id_map_species` | SpeciesID | SpeciesID |
| `id_map_census` | CensusID | CensusID |
| `id_map_trees` | (TreeID, CensusID) | TreeID |
| `id_map_stems` | (StemID, CensusID) | StemGUID |

**Keep these tables** after migration - they're useful for debugging.

### StemCrossID: Cross-Census Stem Tracking

**Purpose**: Track the same physical stem across multiple censuses.

Since each census has its own stem records (census-aware mapping), we need a way to link stems that represent the same physical stem measured in different censuses. This is what `StemCrossID` does.

**How it works**:

```
Census 1: StemGUID=100, StemCrossID=100 (self-reference - first appearance)
Census 2: StemGUID=200, StemCrossID=100 (links to Census 1 stem)
Census 3: StemGUID=300, StemCrossID=100 (links to Census 1 stem)
```

All three records represent the same physical stem. To find all historical measurements of a stem:

```sql
-- Find all records for the same physical stem
SELECT s.*, c.PlotCensusNumber
FROM stems s
JOIN census c ON s.CensusID = c.CensusID
WHERE s.StemCrossID = (SELECT StemCrossID FROM stems WHERE StemGUID = 100);
```

**Algorithm** (matches `bulkingestionprocess` stored procedure):

1. Process censuses in order (earliest first)
2. For first-census stems: `StemCrossID = StemGUID` (self-reference)
3. For later-census stems: Find previous census stem with matching `TreeTag + StemTag`
   - If found: Inherit its `StemCrossID`
   - If not found: `StemCrossID = StemGUID` (new stem)

**Validation checks**:
- No NULL StemCrossID on active stems
- All StemCrossID values reference valid StemGUIDs
- Stems linked by same StemCrossID have matching TreeTag + StemTag

### Migration State Tracking

The migration framework tracks progress in a `migration_state` table:

```sql
-- View progress
CALL migration_progress();

-- Output:
-- step_order | step_name              | status    | rows_affected
-- 1          | 01_create_mapping...   | completed | 8
-- 2          | 02_migrate_plots       | completed | 1
-- 3          | 03_migrate_quadrats    | completed | 3750
-- ...
```

This enables:
- **Resume**: Continue from where you left off after a failure
- **Audit**: See how long each step took and how many rows were affected
- **Idempotency**: Steps that completed won't run again

---

## Migration Process

### What Happens During Migration

```
┌─────────────────────────────────────────────────────────────────────┐
│ Step 1: Framework Setup                                              │
│   Creates migration_state and migration_config tables               │
│   Installs helper procedures                                         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 2: Schema Reset                                                 │
│   Truncates all target tables                                        │
│   Preserves table structures                                         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 3: Data Migration (01_migrate_all_data.sql)                     │
│   3a. Create mapping tables                                          │
│   3b. Migrate plots (1 row for Mpala)                               │
│   3c. Migrate quadrats (~3,750 rows)                                │
│   3d. Migrate taxonomy (family → genus → species)                   │
│   3e. Migrate census (2 rows for Mpala)                             │
│   3f. Migrate trees (~100,000 rows per census)                      │
│   3g. Migrate stems (~300,000 rows per census)                      │
│   3g2. Populate StemCrossID (cross-census stem linking)             │
│   3h. Migrate measurements (~500,000 rows)                          │
│   3i. Migrate attributes and link to measurements                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 4: Validation (02_validate_migration.sql)                       │
│   Checks for orphaned records                                        │
│   Verifies census consistency                                        │
│   Compares row counts                                                │
│   FAILS if critical issues found                                     │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 5: Schema Changes (03_apply_schema_changes.sql)                 │
│   Adds performance indexes                                           │
│   Creates upload tracking tables                                     │
│   Removes FK constraints for error handling                         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 6: Stored Procedures                                            │
│   Deploys bulkingestionprocess, RefreshMeasurementsSummary, etc.    │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Step 7: Refresh Views                                                │
│   Calls RefreshMeasurementsSummary()                                │
│   Populates measurementssummary table                               │
└─────────────────────────────────────────────────────────────────────┘
```

### Expected Row Counts (Mpala Example)

After successful migration, you should see approximately:

| Table | Expected Rows |
|-------|---------------|
| plots | 1 |
| quadrats | ~3,750 |
| family | ~50 |
| genus | ~150 |
| species | ~300 |
| census | 2 |
| trees | ~200,000 (combined across censuses) |
| stems | ~600,000 (combined across censuses) |
| coremeasurements | ~520,000 |
| measurementssummary | ~520,000 (should match coremeasurements) |

---

## Validation & Verification

### Automatic Validation

The `02_validate_migration.sql` script runs these checks:

#### Critical Checks (Migration FAILS if any fail)

| Check | What It Validates |
|-------|-------------------|
| Orphaned genus | Every genus has a valid family |
| Orphaned species | Every species has a valid genus |
| Trees without species | Every tree has a valid species |
| Stems without trees | Every stem has a valid tree |
| Stems without quadrats | Every stem has a valid quadrat |
| Measurements without stems | Every measurement has a valid stem |
| Measurements without census | Every measurement has a valid census |
| **Census mismatch (stem)** | Measurement.CensusID = Stem.CensusID |
| **Census mismatch (tree)** | Stem.CensusID = Tree.CensusID |
| **StemCrossID null** | Every active stem has StemCrossID populated |
| **StemCrossID invalid** | Every StemCrossID references a valid StemGUID |

#### Data Quality Checks (Warnings only)

- DBH values within reasonable range (10-2000mm)
- Stems with missing coordinates
- Measurements with NULL dates
- Broken StemCrossID chains (rare)

### Manual Verification

After migration, verify key metrics:

```sql
-- 1. Check total measurements migrated
SELECT COUNT(*) FROM coremeasurements;

-- 2. Check measurementssummary matches (CRITICAL)
SELECT
    (SELECT COUNT(*) FROM coremeasurements) AS measurements,
    (SELECT COUNT(*) FROM measurementssummary) AS in_summary,
    (SELECT COUNT(*) FROM coremeasurements) -
    (SELECT COUNT(*) FROM measurementssummary) AS missing;
-- "missing" should be 0!

-- 3. Check census consistency (should return 0)
SELECT COUNT(*)
FROM coremeasurements cm
JOIN stems st ON cm.StemGUID = st.StemGUID
WHERE cm.CensusID != st.CensusID;

-- 4. Check measurements per census
SELECT
    c.PlotCensusNumber,
    COUNT(*) AS measurements
FROM coremeasurements cm
JOIN census c ON cm.CensusID = c.CensusID
GROUP BY c.PlotCensusNumber;

-- 5. Check StemCrossID population (should be 0 NULLs)
SELECT
    COUNT(*) AS total_active_stems,
    SUM(CASE WHEN StemCrossID IS NULL THEN 1 ELSE 0 END) AS null_stemcrossid,
    SUM(CASE WHEN StemCrossID = StemGUID THEN 1 ELSE 0 END) AS self_referenced,
    SUM(CASE WHEN StemCrossID != StemGUID THEN 1 ELSE 0 END) AS cross_census_linked
FROM stems WHERE IsActive = 1;
-- "null_stemcrossid" should be 0!

-- 6. Check cross-census linkage by census
SELECT
    c.PlotCensusNumber AS Census,
    COUNT(*) AS Total_Stems,
    SUM(CASE WHEN s.StemCrossID = s.StemGUID THEN 1 ELSE 0 END) AS New_In_This_Census,
    SUM(CASE WHEN s.StemCrossID != s.StemGUID THEN 1 ELSE 0 END) AS Linked_From_Previous
FROM stems s
JOIN census c ON s.CensusID = c.CensusID
WHERE s.IsActive = 1
GROUP BY c.PlotCensusNumber;
```

---

## Troubleshooting

### Common Issues

#### Issue: "MIGRATION VALIDATION FAILED: Critical data integrity issues"

**Cause**: One of the critical checks failed.

**Solution**:
1. Check the validation output for specific failures
2. Look at the `migration_state` table for the error message
3. Common fixes:
   - Reset schema and re-run migration
   - Check source data for issues

```sql
-- See what failed
SELECT * FROM migration_state WHERE status = 'failed';
```

#### Issue: measurementssummary has fewer rows than coremeasurements

**Cause**: Census mismatch - measurements are linked to wrong-census stems.

**Solution**: This was the original bug that led to the census-aware mapping fix. Ensure you're using the consolidated migration scripts (`01_migrate_all_data.sql`) which have the fix.

```sql
-- Diagnose the issue
SELECT
    cm.CensusID AS measurement_census,
    st.CensusID AS stem_census,
    COUNT(*) AS mismatch_count
FROM coremeasurements cm
JOIN stems st ON cm.StemGUID = st.StemGUID
WHERE cm.CensusID != st.CensusID
GROUP BY cm.CensusID, st.CensusID;
```

#### Issue: "Access denied" or connection errors

**Cause**: Invalid credentials or network issues.

**Solution**:
1. Verify credentials in `frontend/.env.local`
2. Test connection manually:
   ```bash
   MYSQL_PWD='<password>' mysql -h forestgeo-mysqldataserver.mysql.database.azure.com \
     -u azureroot --ssl -e "SELECT 1"
   ```
3. If using MariaDB client, use `--skip-ssl-verify-server-cert` instead of `--ssl`

#### Issue: Script stops with "Duplicate entry" error

**Cause**: Re-running migration without resetting schema first.

**Solution**:
```bash
# Reset and start fresh
./run_migration.sh --reset --source stable_mpala --target forestgeo_mpala ...
```

Or manually:
```sql
SOURCE frontend/sqlscripting/resetschema.sql;
```

#### Issue: Migration takes too long (> 30 minutes)

**Cause**: Large dataset or slow network connection.

**Solution**:
- Run migration from a machine closer to the database (same Azure region)
- Increase MySQL timeout: `SET GLOBAL wait_timeout=28800;`
- Monitor progress: `CALL migration_progress();`

### Getting Help

1. **Check the log file**: `migration_YYYYMMDD_HHMMSS.log`
2. **Review validation output**: Look for specific error messages
3. **Check migration state**: `CALL migration_progress();`
4. **Verify source data**: Ensure source schema has expected data

---

## File Reference

### Consolidated Scripts (Recommended)

| File | Purpose | When to Use |
|------|---------|-------------|
| `run_migration.sh` | Main orchestration script | **Start here** - handles everything |
| `00_migration_framework.sql` | State tracking, helper procedures | Automatically run by `run_migration.sh` |
| `01_migrate_all_data.sql` | All data migration | Automatically run by `run_migration.sh` |
| `02_validate_migration.sql` | Validation checks | Automatically run by `run_migration.sh` |
| `03_apply_schema_changes.sql` | Post-migration schema mods | Automatically run by `run_migration.sh` |
| `99_cleanup.sql` | Drop mapping tables | Run manually when migration is verified |

### Supporting Files

| File | Purpose |
|------|---------|
| `README.md` | This documentation |
| `migration_*.log` | Generated log files |

### Legacy Scripts (For Reference Only)

These are the original 19 separate files. Use the consolidated scripts above instead.

<details>
<summary>Click to expand legacy file list</summary>

| File | Replaced By |
|------|-------------|
| `00_run_all_migrations.sh` | `run_migration.sh` |
| `00a_reset_target_schema.sql` | `resetschema.sql` |
| `00b_ensure_table_structures.sql` | `03_apply_schema_changes.sql` |
| `01_create_mapping_tables.sql` | `01_migrate_all_data.sql` |
| `02_migrate_plots.sql` | `01_migrate_all_data.sql` |
| `03_migrate_quadrats.sql` | `01_migrate_all_data.sql` |
| `04_migrate_taxonomy.sql` | `01_migrate_all_data.sql` |
| `05_migrate_census.sql` | `01_migrate_all_data.sql` |
| `06_migrate_trees.sql` | `01_migrate_all_data.sql` |
| `07_migrate_stems.sql` | `01_migrate_all_data.sql` |
| `08_migrate_coremeasurements.sql` | `01_migrate_all_data.sql` |
| `09_migrate_attributes.sql` | `01_migrate_all_data.sql` |
| `10_validation_queries.sql` | `02_validate_migration.sql` |
| `10a_critical_validation.sql` | `02_validate_migration.sql` |
| `11-14_*.sql` | `03_apply_schema_changes.sql` |
| `15_deploy_bulkingestionprocess.sql` | `storedprocedures.sql` |

</details>

---

## Advanced Topics

### Running Migration for a New Site

If you're setting up a completely new site (not Mpala), you need:

1. **Source data** in a `stable_<sitename>` schema with `viewfulltable`
2. **Target schema** created (can be empty)
3. Run migration with appropriate parameters:

```bash
./run_migration.sh \
  --source stable_newsite \
  --target forestgeo_newsite \
  --site "New Site Name" \
  --location "Location Description" \
  --country "Country Name"
```

### Deploying Stored Procedures Separately

If you only need to update stored procedures (not migrate data):

```bash
cd frontend
./DEPLOY_ALL_SCHEMAS.sh
```

Or for a single schema:
```bash
MYSQL_PWD='<password>' mysql -h <host> -u <user> --ssl \
  -D forestgeo_mpala < sqlscripting/storedprocedures.sql
```

### Schema Synchronization

All ForestGEO schemas should have identical stored procedures. To sync:

```bash
# Compare schemas
./sync_schema_procedures.sh --compare --all

# Sync a specific schema with baseline (forestgeo_panama)
./sync_schema_procedures.sh --target forestgeo_testing
```

### Keeping Mapping Tables

By default, `99_cleanup.sql` drops the mapping tables. To keep them:

```bash
./run_migration.sh --skip-cleanup ...
```

The mapping tables are useful for:
- Debugging data issues
- Tracing old IDs to new IDs
- Running incremental updates

### Understanding the Source Schema (CTFS)

The legacy CTFS schema uses a denormalized `viewfulltable` that joins:

| Source Table | Key Columns |
|--------------|-------------|
| `viewfulltable` | TreeID, StemID, SpeciesID, CensusID, QuadratID, PlotID, DBH, HOM, etc. |
| `stem` | StemID, QX, QY (local coordinates) |
| `dbh` | DBHID, StemID, CensusID, ExactDate |
| `census` | CensusID, PlotCensusNumber, StartDate, EndDate |
| `tsmattributes` | TSMCode, Description, Status |

The migration extracts and normalizes this into the ForestGEO schema.

---

## Appendix: Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AZURE_SQL_SERVER` | MySQL host | `forestgeo-mysqldataserver.mysql.database.azure.com` |
| `AZURE_SQL_USER` | MySQL username | `azureroot` |
| `AZURE_SQL_PASSWORD` | MySQL password | (required) |
| `AZURE_SQL_PORT` | MySQL port | `3306` |

These are read from `frontend/.env.local` by `run_migration.sh`.
