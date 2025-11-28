---
title: Non-Technical User Guide
description: Guide for forest researchers to effectively use the ForestGEO Application.
---

This document provides key information for non-technical users (forest researchers) to effectively use the ForestGEO Application.

---

## Before You Begin - Prerequisites

### What You Need Before Uploading Measurements

:::caution
You CANNOT upload measurement data until you complete these steps!
:::

**Checklist:**

- [ ] At least one Stem Code (Attribute) created
- [ ] At least one Personnel record added
- [ ] At least one Quadrat defined
- [ ] At least one Species in the Species List

**Why This Matters:**

- Measurements reference these records
- System cannot link measurements without them
- "View Data" option only appears when all fixed data exists

### Census-Dependent vs Census-Independent Data

| Data Type    | Census-Dependent? | Notes                                    |
| ------------ | ----------------- | ---------------------------------------- |
| Species List | No                | Shared across all censuses               |
| Stem Codes   | No                | Shared across all censuses               |
| Quadrats     | Yes               | Must be set up per census (can rollover) |
| Personnel    | Yes               | Must be added per census (can rollover)  |
| Measurements | Yes               | Specific to each census                  |

---

## Understanding Your Data

### The Data Hierarchy

```
Site (e.g., "Panama")
└── Plot (e.g., "BCI 50-hectare plot")
    └── Quadrat (e.g., "0322")
        └── Tree (Tree Tag: 12345)
            └── Stem (Stem Tag: 0, 1, 2...)
                └── Measurement (DBH, HOM, Date, Codes)
```

### Key Field Definitions

**Tree Tag**

- Physical tag number on tree
- Must be unique within plot
- Never changes between censuses

**Stem Tag**

- Distinguishes multiple stems on same tree
- "0" = main stem, "1", "2" = additional stems

**DBH (Diameter at Breast Height)**

- The primary measurement
- Standard height = 1.3 meters
- Unit depends on site (mm or cm)
- Subject to validation rules

**HOM (Height of Measure)**

- Where you actually measured
- May differ from 1.3m for irregular stems
- Important for remeasurement consistency

**Species Code**

- Short code for species identification
- Must exist in Species List before upload

**Quadrat Name**

- Code identifying subplot location
- Must exist before upload

---

## Preparing Your Data File

### File Format Requirements

- **Accepted formats:** CSV, TSV, TXT
- **Encoding:** UTF-8 recommended
- **Delimiter:** Auto-detected (comma, tab, semicolon)

### Required Columns for Measurements

| Column      | Required? | Description             | Example    |
| ----------- | --------- | ----------------------- | ---------- |
| Tag         | Yes       | Tree tag number         | 12345      |
| StemTag     | Yes       | Stem identifier         | 0          |
| SpeciesCode | Yes       | Species code            | AESPO      |
| QuadratName | Yes       | Quadrat identifier      | 0322       |
| DBH         | Yes       | Diameter measurement    | 125.5      |
| HOM         | No        | Height of measurement   | 1.3        |
| Date        | Yes       | Measurement date        | 2024-06-15 |
| Codes       | No        | Stem codes/attributes   | A,L        |
| LocalX      | No        | X coordinate in quadrat | 5.2        |
| LocalY      | No        | Y coordinate in quadrat | 8.7        |

### Common Data Preparation Mistakes

| Problem                                   | Solution                                       |
| ----------------------------------------- | ---------------------------------------------- |
| Species code not in Species List          | Add species to Species List before uploading   |
| Duplicate Tree Tag + Stem Tag combination | Each tree/stem combo must be unique per census |
| Quadrat name doesn't exist                | Add quadrat in Fixed Data before uploading     |
| Invalid date format                       | Use YYYY-MM-DD format                          |
| DBH contains text or special characters   | DBH must be numeric only                       |

---

## The Upload Process Explained

### Overview of Upload Stages

```
[Select File] → [Preview Data] → [Process to Database] → [Validate] → [Azure Backup] → [Complete]
                                                            ↓
                                              [Review Errors] → [Fix & Retry]
```

---

## Understanding Validation

### Validation Rules Explained

**Growth Validations:**

| Rule                      | What It Checks                   | Why It Matters                 |
| ------------------------- | -------------------------------- | ------------------------------ |
| DBH Growth Exceeds Max    | Growth > 65mm since last census  | May indicate measurement error |
| DBH Shrinkage Exceeds Max | Shrinkage > 5% since last census | Trees rarely shrink this much  |

**Species Validations:**

| Rule                        | What It Checks                       | Why It Matters          |
| --------------------------- | ------------------------------------ | ----------------------- |
| Invalid Species Codes       | Code not in Species List             | Cannot link to taxonomy |
| Different Species Same Tree | Stems on tree have different species | All stems should match  |

**Location Validations:**

| Rule                        | What It Checks                         | Why It Matters               |
| --------------------------- | -------------------------------------- | ---------------------------- |
| Stems Outside Plots         | Coordinates beyond plot boundaries     | Possible coordinate error    |
| Stems in Different Quadrats | Same tree's stems in multiple quadrats | All stems should be together |

---

## Frequently Asked Questions

### Q: Why can't I see the "View Data" option?

**A:** You must have all Fixed Data set up first:

- At least one Stem Code
- At least one Personnel record
- At least one Quadrat
- At least one Species

### Q: Can I edit data after upload?

**A:** Yes. Use the View Data page to edit individual measurements. All changes are logged in the audit trail.

### Q: Can I delete a census?

**A:** Only the most recent (latest) census can be deleted. Previous censuses are preserved as historical data.

### Q: My upload seems stuck. What should I do?

**A:**

- Don't close the browser
- Large files can take several minutes
- Check the progress bar and ETC (estimated time)
- If truly stuck (>10 minutes no progress), refresh and retry

### Q: What happens to my file after upload?

**A:** Files are automatically backed up to Azure cloud storage. You can download them from the "Uploaded Files" page.

---

## Quick Reference

### Upload File Requirements

- Format: CSV, TSV, or TXT
- Required columns: Tag, StemTag, SpeciesCode, QuadratName, DBH, Date
- Headers must match exactly (case-sensitive)

### Before First Upload

1. Create at least one Stem Code
2. Add at least one Personnel
3. Define at least one Quadrat
4. Add at least one Species

### Data Hierarchy

Site → Plot → Census → Quadrat → Tree → Stem → Measurement

### Key Validations to Know

- Growth cannot exceed 65mm per census
- Shrinkage cannot exceed 5%
- All stems on a tree must be in same quadrat
- All stems on a tree must have same species
