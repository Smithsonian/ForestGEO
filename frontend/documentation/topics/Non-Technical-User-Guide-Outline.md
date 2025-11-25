# Non-Technical User Guide - Outline

This document provides an outline of key information and clarifications needed by non-technical users (forest researchers) to effectively use the ForestGEO Application.

---

## Section 1: Before You Begin - Prerequisites

### 1.1 What You Need Before Uploading Measurements

> {style="warning"}
> You CANNOT upload measurement data until you complete these steps!

**Checklist:**

- [ ] At least one Stem Code (Attribute) created
- [ ] At least one Personnel record added
- [ ] At least one Quadrat defined
- [ ] At least one Species in the Species List

**Why This Matters:**

- Measurements reference these records
- System cannot link measurements without them
- "View Data" option only appears when all fixed data exists

### 1.2 Understanding Census-Dependent vs Census-Independent Data

| Data Type    | Census-Dependent? | Notes                                    |
| ------------ | ----------------- | ---------------------------------------- |
| Species List | No                | Shared across all censuses               |
| Stem Codes   | No                | Shared across all censuses               |
| Quadrats     | Yes               | Must be set up per census (can rollover) |
| Personnel    | Yes               | Must be added per census (can rollover)  |
| Measurements | Yes               | Specific to each census                  |

### 1.3 Using Census Rollover

- **What it does:** Copies data from previous census to new census
- **What can be rolled over:** Personnel, Quadrats
- **When to use:** Starting a new census with mostly the same team/quadrats
- **How to access:** During census creation

---

## Section 2: Understanding Your Data

### 2.1 The Data Hierarchy

```
Site (e.g., "Panama")
└── Plot (e.g., "BCI 50-hectare plot")
    └── Quadrat (e.g., "0322")
        └── Tree (Tree Tag: 12345)
            └── Stem (Stem Tag: 0, 1, 2...)
                └── Measurement (DBH, HOM, Date, Codes)
```

### 2.2 Key Field Definitions

**Tree Tag**

- [Explain: Physical tag number on tree]
- [Explain: Must be unique within plot]
- [Explain: Never changes between censuses]

**Stem Tag**

- [Explain: Distinguishes multiple stems on same tree]
- [Explain: "0" = main stem, "1", "2" = additional stems]

**DBH (Diameter at Breast Height)**

- [Explain: The primary measurement]
- [Explain: Standard height = 1.3 meters]
- [Explain: Unit depends on site (mm or cm)]
- [Explain: Subject to validation rules]

**HOM (Height of Measure)**

- [Explain: Where you actually measured]
- [Explain: May differ from 1.3m for irregular stems]
- [Explain: Important for remeasurement consistency]

**Species Code**

- [Explain: Short code for species identification]
- [Explain: Must exist in Species List before upload]
- [Explain: Examples and format]

**Quadrat Name**

- [Explain: Code identifying subplot location]
- [Explain: Naming conventions]
- [Explain: Must exist before upload]

### 2.3 Stem Codes (Attributes) Explained

**What are Stem Codes?**

- Short codes describing tree/stem condition
- Created locally (can be in any language)
- Assigned to measurements during upload

**Status Categories:**
| Status | Meaning | Example Codes |
|--------|---------|---------------|
| Alive | Stem is alive and measured | A, L (leaning) |
| Alive-Not Measured | Alive but not measured this census | ANM |
| Dead | Entire tree is dead | D |
| Missing | Field crews missed this stem | M |
| Broken Below | Alive but broken, <1cm DBH | BB |
| Stem Dead | This specific stem is dead | SD |

---

## Section 3: Preparing Your Data File

### 3.1 File Format Requirements

- **Accepted formats:** CSV, TSV, TXT
- **Encoding:** UTF-8 recommended
- **Delimiter:** Auto-detected (comma, tab, semicolon)

### 3.2 Required Columns for Measurements

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

### 3.3 Common Data Preparation Mistakes

**Problem:** Species code not in Species List

- **Solution:** Add species to Species List before uploading

**Problem:** Duplicate Tree Tag + Stem Tag combination

- **Solution:** Each tree/stem combo must be unique per census

**Problem:** Quadrat name doesn't exist

- **Solution:** Add quadrat in Fixed Data before uploading

**Problem:** Invalid date format

- **Solution:** Use YYYY-MM-DD format

**Problem:** DBH contains text or special characters

- **Solution:** DBH must be numeric only

---

## Section 4: The Upload Process Explained

### 4.1 Overview of Upload Stages

```
[Select File] → [Preview Data] → [Process to Database] → [Validate] → [Azure Backup] → [Complete]
                                                            ↓
                                              [Review Errors] → [Fix & Retry]
```

### 4.2 Stage-by-Stage Walkthrough

**Stage 1: File Selection**

- [Screenshot placeholder]
- [Explain: Drop file in zone]
- [Explain: System auto-detects format]

**Stage 2: Preview and Confirm**

- [Screenshot placeholder]
- [Explain: Review parsed data]
- [Explain: Check headers match]
- [Explain: What to do if headers wrong]

**Stage 3: Database Processing**

- [Screenshot placeholder]
- [Explain: What the progress bar means]
- [Explain: Why it may take time]
- [Explain: What NOT to do (don't close browser)]

**Stage 4: Validation**

- [Screenshot placeholder]
- [Explain: What validation checks]
- [Explain: What happens if errors found]

**Stage 5: Completion**

- [Screenshot placeholder]
- [Explain: Confirmation message]
- [Explain: What happens next]

### 4.3 Understanding Upload Errors

**Pre-processing Errors**

- Occur during file parsing
- Usually formatting issues
- Download error file to see details

**Validation Errors**

- Occur after data is in database
- Data quality issues
- Can be reviewed in Failed Measurements

---

## Section 5: Understanding Validation

### 5.1 What is Validation?

- [Explain: Automatic quality checks]
- [Explain: Runs during upload]
- [Explain: Errors flagged but data saved]

### 5.2 Validation Rules Explained

**Growth Validations:**
| Rule | What It Checks | Why It Matters |
|------|---------------|----------------|
| DBH Growth Exceeds Max | Growth > 65mm since last census | May indicate measurement error |
| DBH Shrinkage Exceeds Max | Shrinkage > 5% since last census | Trees rarely shrink this much |

**Species Validations:**
| Rule | What It Checks | Why It Matters |
|------|---------------|----------------|
| Invalid Species Codes | Code not in Species List | Cannot link to taxonomy |
| Different Species Same Tree | Stems on tree have different species | All stems should match |

**Location Validations:**
| Rule | What It Checks | Why It Matters |
|------|---------------|----------------|
| Stems Outside Plots | Coordinates beyond plot boundaries | Possible coordinate error |
| Stems in Different Quadrats | Same tree's stems in multiple quadrats | All stems should be together |

**Duplicate Detection:**
| Rule | What It Checks | Why It Matters |
|------|---------------|----------------|
| Duplicate Quadrat Names | Same quadrat name used twice | Names must be unique |
| Duplicate Tree/Stem Combos | Same tag combination recorded twice | One record per stem per census |

### 5.3 How to Fix Validation Errors

1. View errors in data grid (marked with error icons)
2. Click cell to edit
3. Enter corrected value
4. Save
5. Error cleared when underlying issue fixed

### 5.4 Enabling/Disabling Validations

- [Explain: Not all validations needed for all sites]
- [Explain: How to enable/disable]
- [Explain: When to disable a validation]

---

## Section 6: Working with Failed Measurements

### 6.1 What are Failed Measurements?

- Records that couldn't be processed
- Stored separately for review
- Can be fixed and re-ingested

### 6.2 Common Failure Reasons

| Reason                 | What It Means                 | How to Fix                                 |
| ---------------------- | ----------------------------- | ------------------------------------------ |
| Invalid Species Code   | Species not in Species List   | Add species to Species List, then reingest |
| Tree/Stem Not Found    | Tag combination doesn't exist | Check tag numbers                          |
| Invalid Quadrat        | Quadrat not defined           | Add quadrat to Fixed Data                  |
| Missing Required Field | A required column was empty   | Fill in missing data                       |
| Duplicate Record       | Same tag combo already exists | Remove duplicate                           |

### 6.3 Reingestion Process

1. Review failed records in Failed Measurements table
2. Identify the issue
3. Fix the underlying problem (e.g., add missing species)
4. Click "Reingest" button
5. System re-processes without needing new file upload

---

## Section 7: Frequently Asked Questions

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

### Q: What's the difference between "Validated" and "No Errors"?

**A:**

- **Validated:** Passed all enabled validation checks
- **No Errors:** Has no current validation errors (but may not have been validated)

### Q: What is "Rollover"?

**A:** Copying data from a previous census to a new census. Useful for Personnel and Quadrats that haven't changed.

### Q: My upload seems stuck. What should I do?

**A:**

- Don't close the browser
- Large files can take several minutes
- Check the progress bar and ETC (estimated time)
- If truly stuck (>10 minutes no progress), refresh and retry

### Q: What happens to my file after upload?

**A:** Files are automatically backed up to Azure cloud storage. You can download them from the "Uploaded Files" page.

### Q: Can I upload the same file twice?

**A:** Yes, but it may create duplicate records. The validation system will flag duplicates.

### Q: How do I know if my data has errors?

**A:**

- Check the data grid for error icons on rows
- View the "Post-Census Statistics" for summary
- Check "Recent Changes" for modification history

---

## Section 8: Common Error Messages

| Error Message                         | What It Means                  | How to Fix                   |
| ------------------------------------- | ------------------------------ | ---------------------------- |
| "Species code not found"              | Species not in Species List    | Add species before uploading |
| "Duplicate tree/stem combination"     | Same tags already recorded     | Remove duplicate from file   |
| "Coordinates outside plot boundaries" | X/Y values beyond plot limits  | Check coordinate values      |
| "Required field missing"              | Empty value in required column | Fill in the data             |
| "Invalid date format"                 | Date not in expected format    | Use YYYY-MM-DD               |
| "Census not selected"                 | No census chosen               | Select a census from sidebar |

---

## Section 9: Quick Reference

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

### Where to Find Help

- Documentation: [link]
- GitHub Issues: [link]
- Feedback button in application
