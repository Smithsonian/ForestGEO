# Glossary of Terms

This glossary defines key terminology used throughout the ForestGEO Application.

---

## Outline

### A

- **Attribute** - See "Stem Code"
- **Audit Trail** - See "Unified Changelog"

### B

- **Bulk Edit** - [Definition needed: Editing multiple records simultaneously in a data grid]

### C

- **Census**
  - Definition: A defined time period during which field measurements are collected for a plot
  - Key points:
    - Defined by start and end dates
    - Multiple censuses can exist per plot (Census 1, Census 2, etc.)
    - Measurement dates establish census boundaries
    - Census-dependent data must be re-entered or rolled over for each new census

- **Census Rollover**
  - Definition: The process of copying unchanged data from a previous census to a new census
  - Key points:
    - Saves data re-entry time
    - Available for: Personnel, Quadrats, Species, Stem Codes
    - User selects which items to copy

### D

- **Dashboard**
  - Definition: The main overview page showing census statistics and data health metrics
  - Key points:
    - Displays progress metrics
    - Shows stem statistics
    - Lists recent changes
    - Indicates data validity status

- **Data Grid**
  - Definition: An interactive table interface for viewing and editing records
  - Key points:
    - Supports filtering and sorting
    - Allows inline editing
    - Different types: isolated (single-row) and multi-line (bulk)

- **DBH (Diameter at Breast Height)**
  - Definition: The diameter of a tree stem measured at a standardized height (typically 1.3 meters or 4.5 feet above ground)
  - Key points:
    - Primary measurement for forest inventory
    - Unit varies by site (millimeters or centimeters)
    - Subject to validation rules (growth limits, shrinkage limits)

### F

- **Failed Measurements**
  - Definition: Measurement records that could not be successfully processed during data ingestion
  - Key points:
    - Stored in dedicated table for review
    - Common causes: invalid species codes, missing fields, duplicate records
    - Can be reviewed, edited, and re-ingested

- **Fixed Data**
  - Definition: Reference data that does not change between censuses (or changes rarely)
  - Key points:
    - Includes: Species list, Stem Codes
    - Must be set up BEFORE uploading measurements
    - Shared across all censuses in a plot

### G

- **Global Coordinates**
  - Definition: Absolute geographic position (UTM or GPS coordinates)
  - Key points:
    - X, Y, Z positions
    - Used for mapping and spatial analysis

### H

- **HOM (Height of Measure)**
  - Definition: The actual height above ground where the diameter measurement was taken
  - Key points:
    - Often differs from standard 1.3m for irregular stems
    - Important for remeasurement consistency

### I

- **Ingestion**
  - Definition: The process of loading uploaded data from temporary storage into the permanent database
  - Key points:
    - Validates and transforms data
    - Links measurements to existing trees/stems
    - Two-stage process: staging then processing

### L

- **Local Coordinates**
  - Definition: Position within a quadrat (relative coordinates)
  - Key points:
    - X, Y values relative to quadrat origin
    - Used for locating stems within the plot

### M

- **Measurements (Core Measurements)**
  - Definition: The actual diameter and date records for a stem at a specific point in time
  - Key points:
    - Primary data collected during census
    - Includes: DBH, HOM, measurement date, attributes
    - Each linked to a specific stem and census

- **Multi-stem**
  - Definition: A tree with more than one woody trunk or branch meeting measurement criteria
  - Key points:
    - Main stem tagged "0"
    - Additional stems tagged "1", "2", etc.
    - All stems share the same Tree Tag

### P

- **Personnel**
  - Definition: Field staff and data collection team members
  - Key points:
    - Census-dependent (must be added for each census)
    - Includes: name, role
    - Can be assigned to specific quadrats

- **Plot**
  - Definition: A specific geographic region marked for data collection within a site
  - Key points:
    - Has defined dimensions and coordinates
    - Divided into quadrats
    - Contains one or more censuses

- **Post-Validation Statistics**
  - Definition: Optional analyses run after measurements are fully entered and validated
  - Key points:
    - User-triggered (not automatic)
    - Produces summary statistics
    - Different from automatic validation during upload

- **Pre-processing**
  - Definition: Initial validation that occurs before data ingestion
  - Key points:
    - Checks for missing fields, formatting errors
    - Failures can be downloaded and corrected
    - Different from post-ingestion validation

### Q

- **Quadrat**
  - Definition: A subdivision of a plot into smaller geographic sections
  - Key points:
    - Each has specific coordinates and dimensions
    - Named using codes (e.g., "0322")
    - All stems must be assigned to a quadrat

### R

- **Reingestion**
  - Definition: Re-processing measurements that were previously failed or staged
  - Key points:
    - Allows retry without re-uploading files
    - Used after fixing data errors

### S

- **Schema**
  - Definition: The database structure specific to each site
  - Key points:
    - Contains all data for a site's plots, censuses, measurements
    - Each site has a unique schema

- **Site**
  - Definition: A collection of plots in a specific geographic location
  - Key points:
    - Top level of data hierarchy
    - Users are assigned to specific sites
    - Has unique database schema

- **Species Code**
  - Definition: A shorthand identifier for a species (e.g., "AESPO")
  - Key points:
    - Must be unique within a plot
    - Up to 25 characters
    - Must exist in Species List before uploading measurements

- **Species List**
  - Definition: Complete inventory of all species found in the plot
  - Key points:
    - Not census-dependent
    - Contains: species code, name, genus, family, authority
    - Can only be reset via admin function

- **Staging Table**
  - Definition: Temporary storage for uploaded measurements before final processing
  - Key points:
    - Holds data during validation
    - Data moves to permanent tables or failed measurements after processing

- **Stem**
  - Definition: An individual woody trunk or branch of a tree
  - Key points:
    - Each has a Stem Tag
    - Most trees have one stem (tag "0")
    - Has local coordinates within the plot

- **Stem Code (Attribute)**
  - Definition: Shorthand codes describing the condition or characteristic of a tree, stem, or measurement
  - Key points:
    - Locally created (can be in any language)
    - Examples: "D" (dead), "L" (leaning), "B" (buttressed)
    - Has status category: Alive, Dead, Missing, etc.

- **Stem Tag**
  - Definition: Number distinguishing multiple stems on the same tree
  - Key points:
    - "0" = main stem
    - "1", "2", etc. = additional stems
    - Combined with Tree Tag for unique identification

### T

- **Tree**
  - Definition: An individual plant with a unique Tree Tag
  - Key points:
    - Has single species assigned
    - Can have multiple stems
    - All stems must be in same quadrat

- **Tree Tag**
  - Definition: Unique identifier painted/attached to the tree in the field
  - Key points:
    - Permanent identification number
    - Combined with Stem Tag for unique stem identification

### U

- **Unified Changelog (Audit Trail)**
  - Definition: Complete record of all data modifications
  - Key points:
    - Shows: table, old values, new values, who, when
    - Accessible under "Recent Changes"
    - Used for compliance and tracking

### V

- **Validation**
  - Definition: Automatic checks that verify data quality and logical consistency
  - Key points:
    - Runs during upload process
    - 12+ configurable rules
    - Errors flagged but data still saved
    - Can be enabled/disabled per rule

- **Validation Error**
  - Definition: A flag indicating a measurement failed one or more validation checks
  - Key points:
    - Measurements with errors are still saved
    - Can be reviewed and edited in data grid
    - Cleared by fixing underlying issue
