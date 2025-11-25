---
title: Glossary of Terms
description: Definitions of key terminology used throughout the ForestGEO Application.
---

This glossary defines key terminology used throughout the ForestGEO Application, organized alphabetically.

---

## A

### Attribute

See [Stem Code](#stem-code-attribute).

### Audit Trail

See [Unified Changelog](#unified-changelog-audit-trail).

### Azure Blob Storage

Cloud storage service where uploaded files are automatically backed up.

**Key points:**

- Files are preserved for disaster recovery
- Accessible via Census Hub → Uploaded Files
- Includes metadata about upload date and user

---

## C

### Census

A defined time period during which field measurements are collected for a plot.

**Key points:**

- Defined by start and end dates
- Multiple censuses can exist per plot (Census 1, Census 2, etc.)
- Measurement dates establish census boundaries
- Census-dependent data must be re-entered or rolled over for each new census

### Census Hub

The main navigation section for working with measurement data.

**Pages included:**

- View Data
- Post-Census Statistics
- Recent Changes
- Uploaded Files
- View All Historical Data
- Validations

### Census Rollover

The process of copying unchanged data from a previous census to a new census.

**Key points:**

- Saves data re-entry time
- Available for: Personnel, Quadrats
- User selects which items to copy
- Accessed during census creation

### Core Measurements

See [Measurements](#measurements-core-measurements).

---

## D

### Dashboard

The main overview page showing census statistics and data health metrics.

**Key points:**

- Displays progress metrics and tachometer visualizations
- Shows stem statistics (old stems, multi-stems, new recruits)
- Lists recent changes
- Indicates data validity status for Fixed Data

### Data Grid

An interactive table interface for viewing and editing records.

**Key points:**

- Supports filtering and sorting
- Allows inline editing
- Features toolbar with columns, filters, search, upload, and export
- Used throughout the application for all data types

### DBH (Diameter at Breast Height)

The diameter of a tree stem measured at a standardized height (typically 1.3 meters or 4.5 feet above ground).

**Key points:**

- Primary measurement for forest inventory
- Unit varies by site (millimeters or centimeters)
- Subject to validation rules (growth limits, shrinkage limits)
- Recorded in the `dbh` column of measurements

---

## E

### ETC (Estimated Time to Completion)

The calculated remaining time for an upload or processing operation.

**Key points:**

- Displayed during file uploads
- Updates as processing continues
- Helps estimate when to expect completion

---

## F

### Failed Measurements

Measurement records that could not be successfully processed during data ingestion.

**Key points:**

- Stored in dedicated table for review
- Common causes: invalid species codes, missing fields, duplicate records
- Can be reviewed, edited, and re-ingested
- Accessible from View Data page or upload completion notification

### Fixed Data

Reference data that does not change between censuses (or changes rarely).

**Key points:**

- Includes: Species List, Stem Codes
- Must be set up BEFORE uploading measurements
- Shared across all censuses in a plot
- Managed in "Stem & Plot Details" section

### Form

A file type accepted for upload (CSV, TSV, or TXT format).

**Key points:**

- Each data type has specific required headers
- Headers can be viewed in the "Understanding the Headers" accordion
- Forms must contain required fields to be accepted

---

## G

### Global Coordinates

Absolute geographic position (UTM or GPS coordinates) of a stem.

**Key points:**

- Calculated from quadrat position plus local coordinates
- Used for mapping and spatial analysis
- Subject to validation (must be within plot boundaries)

---

## H

### HOM (Height of Measure)

The actual height above ground where the diameter measurement was taken.

**Key points:**

- Often differs from standard 1.3m for irregular stems
- Important for remeasurement consistency
- Recorded in the `hom` column of measurements

---

## I

### Ingestion

The process of loading uploaded data from temporary storage into the permanent database.

**Key points:**

- Validates and transforms data
- Links measurements to existing trees/stems or creates new records
- Two-stage process: staging then SQL processing
- Specific to measurements (Fixed Data uses direct upload)

---

## L

### Local Coordinates

Position within a quadrat (relative coordinates).

**Key points:**

- X, Y values (lx, ly) relative to quadrat origin
- Used for locating stems within the plot
- Combined with quadrat position to calculate global coordinates

---

## M

### Measurements (Core Measurements)

The actual diameter and date records for a stem at a specific point in time.

**Key points:**

- Primary data collected during census
- Includes: DBH, HOM, measurement date, attributes
- Each linked to a specific stem and census
- Uploaded via Census Hub → View Data

### Multi-stem

A tree with more than one woody trunk or branch meeting measurement criteria.

**Key points:**

- Main stem tagged "0"
- Additional stems tagged "1", "2", etc.
- All stems share the same Tree Tag
- All stems must be in the same quadrat

---

## P

### Personnel

Field staff and data collection team members.

**Key points:**

- Census-dependent (must be added for each census or rolled over)
- Includes: first name, last name, role, role description
- Managed in Stem & Plot Details → Personnel

### Plot

A specific geographic region marked for data collection within a site.

**Key points:**

- Has defined dimensions and coordinates
- Divided into quadrats
- Contains one or more censuses
- Selected in sidebar dropdown after site selection

### Post-Census Statistics

Statistical analyses run on completed census data.

**Key points:**

- Manually triggered by user
- Provides summary metrics and reports
- Accessed via Census Hub → Post-Census Statistics
- Runs queries against the current census data

### Pre-processing

Initial validation that occurs before data ingestion.

**Key points:**

- Checks for missing required fields, formatting errors
- Failures can be downloaded and corrected
- Different from post-ingestion validation
- Occurs during the upload process

---

## Q

### Quadrat

A subdivision of a plot into smaller geographic sections.

**Key points:**

- Each has specific coordinates (startX, startY) and dimensions (dimX, dimY)
- Named using codes (e.g., "0322")
- All stems must be assigned to a quadrat
- Census-dependent (can be rolled over)

---

## R

### Recent Changes

The page showing the audit trail of all data modifications.

**Key points:**

- Shows what changed, old/new values, who, when
- Accessed via Census Hub → Recent Changes
- Useful for tracking modifications and compliance

### Reingestion

Re-processing measurements that were previously failed or staged.

**Key points:**

- Allows retry without re-uploading files
- Used after fixing underlying data errors (e.g., adding missing species)
- Available from Failed Measurements modal

---

## S

### Schema

The database structure specific to each site.

**Key points:**

- Contains all data for a site's plots, censuses, measurements
- Each site has a unique schema
- Selected automatically when you choose a site

### Site

A collection of plots in a specific geographic location (e.g., "Panama", "BCI").

**Key points:**

- Top level of data hierarchy
- Users are assigned to specific sites by administrators
- Has unique database schema
- First selection in sidebar dropdown

### Species Code

A shorthand identifier for a species (e.g., "AESPO").

**Key points:**

- Must be unique within a plot
- Up to 25 characters
- Must exist in Species List before uploading measurements
- Used in the `spcode` column of measurements

### Species List

Complete inventory of all species found in the plot.

**Key points:**

- NOT census-dependent (shared across all censuses)
- Contains: species code, name, genus, family, authority
- Can only be reset via admin function
- Managed in Stem & Plot Details → Species List

### Staging Table

Temporary storage for uploaded measurements before final processing.

**Key points:**

- Holds data during ingestion validation
- Data moves to permanent tables or failed measurements after processing
- Specific to measurements upload process

### Stem

An individual woody trunk or branch of a tree.

**Key points:**

- Each has a Stem Tag (0 for main stem, 1+ for additional)
- Most trees have one stem (tag "0")
- Has local coordinates within the quadrat
- Linked to a single tree

### Stem & Plot Details

The navigation section for managing Fixed Data.

**Pages included:**

- Stem Codes (Attributes)
- Personnel
- Quadrats
- Species List

### Stem Code (Attribute)

Shorthand codes describing the condition or characteristic of a tree, stem, or measurement.

**Key points:**

- Locally created (can be in any language)
- Examples: "D" (dead), "L" (leaning), "B" (buttressed)
- Has status category: Alive, Dead, Missing, Broken Below, etc.
- NOT census-dependent

### Stem Tag

Number distinguishing multiple stems on the same tree.

**Key points:**

- "0" = main stem
- "1", "2", etc. = additional stems
- Combined with Tree Tag for unique stem identification
- Used in the `stemtag` column of measurements

---

## T

### Tree

An individual plant with a unique Tree Tag.

**Key points:**

- Has single species assigned
- Can have multiple stems (multi-stem trees)
- All stems must be in same quadrat
- Identified by Tree Tag

### Tree Tag

Unique identifier painted/attached to the tree in the field.

**Key points:**

- Permanent identification number
- Combined with Stem Tag for unique stem identification
- Used in the `tag` column of measurements

---

## U

### Unified Changelog (Audit Trail)

Complete record of all data modifications.

**Key points:**

- Shows: table, field, old values, new values, who, when
- Accessible under "Recent Changes" in Census Hub
- Used for compliance and tracking
- Captures all insert, update, and delete operations

### Uploaded Files

Page showing history of all files uploaded to the system.

**Key points:**

- Accessed via Census Hub → Uploaded Files
- Allows download of original uploaded files
- Shows upload date, user, and file metadata
- Files backed up to Azure Blob Storage

---

## V

### Validation

Automatic checks that verify data quality and logical consistency.

**Key points:**

- Runs automatically during measurements upload
- 12+ configurable rules
- Errors flagged but data still saved
- Can be enabled/disabled per rule in Validations page

### Validation Error

A flag indicating a measurement failed one or more validation checks.

**Key points:**

- Measurements with errors are still saved
- Can be reviewed and edited in data grid
- Cleared by fixing underlying issue
- Displayed with warning indicators in the grid

### View Data

The main page for viewing and editing measurements for the current census.

**Key points:**

- Shows measurements in data grid format
- Supports upload, filtering, sorting, editing
- Requires all Fixed Data to be populated first
- Accessed via Census Hub → View Data
