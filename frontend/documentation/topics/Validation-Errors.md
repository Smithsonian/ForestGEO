# Validation Errors

This guide explains all validation checks performed on your data and how to resolve validation errors.

---

## Understanding Validation

Validation is the process of checking your data for quality and consistency. The ForestGEO Application performs validations:

1. **During upload** - Format and required field checks
2. **After ingestion** - Business rule and data quality checks
3. **Cross-census** - Comparing with previous census data

> {style="note"}
> Validation errors do NOT prevent your data from being saved. Data is saved but flagged for review. You can fix errors after upload.

---

## Validation Error Display

When validation errors occur:

- Rows are marked with an error icon in the data grid
- You can filter to show only rows with errors
- Clicking a row shows the specific validation failures
- Errors can be fixed by editing the row directly

---

## Growth and Measurement Validations

### DBH Growth Exceeds Maximum

| Detail             | Information                                    |
| ------------------ | ---------------------------------------------- |
| **Validation ID**  | 1                                              |
| **What it checks** | DBH growth greater than 65mm since last census |
| **Error message**  | "DBH growth exceeds maximum rate of 65 mm"     |
| **Severity**       | Warning (data saved but flagged)               |

**Why this validation exists:**
Trees typically don't grow more than 65mm in diameter between censuses. Exceeding this threshold often indicates a measurement error.

**How to fix:**

1. Verify the previous census measurement was recorded correctly
2. Verify the current measurement is accurate
3. Check if measurement units are consistent (mm vs cm)
4. If growth is legitimate (fast-growing species), document in Comments field
5. Edit the measurement if incorrect

---

### DBH Shrinkage Exceeds Maximum

| Detail             | Information                                       |
| ------------------ | ------------------------------------------------- |
| **Validation ID**  | 2                                                 |
| **What it checks** | DBH shrinkage greater than 5% from last census    |
| **Error message**  | "DBH shrinkage exceeds maximum rate of 5 percent" |
| **Severity**       | Warning (data saved but flagged)                  |

**Why this validation exists:**
Trees rarely shrink significantly. Large shrinkage usually indicates measurement error or stem damage.

**How to fix:**

1. Verify the previous measurement was correct
2. Check if measurement was taken at correct HOM (height)
3. Look for stem damage, bark loss, or cambial slippage
4. If shrinkage is real, document the reason in Comments
5. Edit the measurement if incorrect

---

## Species Validations

### Invalid Species Codes

| Detail             | Information                                              |
| ------------------ | -------------------------------------------------------- |
| **Validation ID**  | 3                                                        |
| **What it checks** | Species code exists in the Species List                  |
| **Error message**  | "Species Code is invalid (not defined in species table)" |
| **Severity**       | Error (may prevent processing)                           |

**How to fix:**

1. Go to Fixed Data > Species List
2. Add the missing species code
3. If the code was a typo, edit the measurement with correct code

---

### Different Species on Same Tree

| Detail             | Information                                    |
| ------------------ | ---------------------------------------------- |
| **Validation ID**  | 7                                              |
| **What it checks** | All stems of a tree have the same species code |
| **Error message**  | "Flagged - Different species"                  |
| **Severity**       | Warning                                        |

**Why this validation exists:**
All stems from the same tree must be the same species. Different codes indicate a data entry error.

**How to fix:**

1. Determine the correct species for the tree
2. Update all stems of that tree to use the same species code
3. Check if stems were accidentally assigned wrong tree tags

---

### Species Changed from Previous Census

| Detail             | Information                           |
| ------------------ | ------------------------------------- |
| **Validation ID**  | 20                                    |
| **What it checks** | Species code matches previous census  |
| **Error message**  | "Species mismatch vs previous census" |
| **Severity**       | Info                                  |

**How to fix:**

1. Verify the current species identification is correct
2. If species was re-identified, document the reason
3. Update if the previous census was incorrect

---

## Location Validations

### Stems Outside Plot Boundaries

| Detail             | Information                                  |
| ------------------ | -------------------------------------------- |
| **Validation ID**  | 8                                            |
| **What it checks** | Stem coordinates fall within plot boundaries |
| **Error message**  | "X outside plot" or "Y outside plot"         |
| **Severity**       | Error                                        |

**Why this validation exists:**
Coordinates outside plot boundaries indicate measurement or data entry errors.

**How to fix:**

1. Verify LocalX and LocalY values are correct
2. Check the quadrat's StartX and StartY values
3. Ensure coordinates are in correct units (usually meters)
4. Recalculate or remeasure if necessary

---

### Stems from Same Tree in Different Quadrats

| Detail             | Information                                 |
| ------------------ | ------------------------------------------- |
| **Validation ID**  | 9                                           |
| **What it checks** | All stems of a tree are in the same quadrat |
| **Error message**  | "Different quadrats"                        |
| **Severity**       | Warning                                     |

**Why this validation exists:**
A tree cannot physically span multiple quadrats. Different quadrats indicate a labeling error.

**How to fix:**

1. Determine which quadrat is correct for the tree
2. Update all stems to use the same quadrat name
3. Check if stems were given wrong tree tags

---

### Coordinate Drift Detected

| Detail             | Information                                                    |
| ------------------ | -------------------------------------------------------------- |
| **What it checks** | Coordinate change >10 meters from previous census              |
| **Error message**  | "Coordinate drift: [X]m from previous census (>10m threshold)" |
| **Severity**       | Error                                                          |

**Why this validation exists:**
Trees don't move. Large coordinate changes indicate measurement or recording errors.

**How to fix:**

1. Verify current coordinates are accurate
2. Compare with previous census coordinates
3. Check if the tree tag was reassigned
4. If genuinely different (GPS correction), contact administrator

---

## Duplicate Detection Validations

### Duplicate Quadrat Names

| Detail             | Information                                     |
| ------------------ | ----------------------------------------------- |
| **Validation ID**  | 4                                               |
| **What it checks** | Quadrat names are unique within the plot        |
| **Error message**  | "Quadrat's name matches existing OTHER quadrat" |
| **Severity**       | Warning                                         |

**How to fix:**

1. Go to Fixed Data > Quadrats
2. Rename one of the duplicate quadrats
3. Update measurements to use correct quadrat name

---

### Duplicate Tree/Stem Tag Combination

| Detail             | Information                                             |
| ------------------ | ------------------------------------------------------- |
| **Validation ID**  | 5                                                       |
| **What it checks** | Each TreeTag + StemTag combination is unique per census |
| **Error message**  | "Duplicate tree (and stem) tag found in census"         |
| **Severity**       | Error                                                   |

**Why this validation exists:**
Each stem can only have one measurement per census. Duplicates indicate double-entry.

**How to fix:**

1. Identify which record is correct
2. Delete the duplicate record
3. If both are valid measurements, assign different stem tags

---

## Date Validations

### Measurement Outside Census Date Bounds

| Detail             | Information                                     |
| ------------------ | ----------------------------------------------- |
| **Validation ID**  | 6                                               |
| **What it checks** | Measurement date falls within census date range |
| **Error message**  | "Outside census date bounds"                    |
| **Severity**       | Error                                           |

**How to fix:**

1. Verify the measurement date is correct
2. Check the census start and end dates
3. If measurement date is correct, census dates may need adjustment
4. Contact administrator to adjust census dates if needed

---

## Measurement Consistency Validations

### DBH Outside Species Bounds

| Detail             | Information                                         |
| ------------------ | --------------------------------------------------- |
| **Validation ID**  | 11                                                  |
| **What it checks** | Measured DBH falls within species-defined min/max   |
| **Error message**  | "Measured DBH is outside of species-defined bounds" |
| **Severity**       | Warning                                             |

**How to fix:**

1. Verify the measurement is accurate
2. Verify the species identification is correct
3. If measurement is legitimate, species limits may need updating
4. Contact administrator to adjust species limits if needed

---

### Measurements on Dead Stems

| Detail             | Information                                       |
| ------------------ | ------------------------------------------------- |
| **Validation ID**  | 12                                                |
| **What it checks** | Dead/missing stems should not have DBH/HOM values |
| **Error message**  | "Invalid DBH/HOM - DEAD-state attribute(s)"       |
| **Severity**       | Warning                                           |
| **Status**         | Currently disabled                                |

**How to fix:**

1. If stem is truly dead, remove DBH and HOM values (set to NULL)
2. If stem is alive, remove dead/missing attribute codes
3. Verify the attribute codes are correct

---

### Missing Measurements on Live Stems

| Detail             | Information                                  |
| ------------------ | -------------------------------------------- |
| **Validation ID**  | 13                                           |
| **What it checks** | Live stems should have DBH and/or HOM values |
| **Error message**  | "Missing DBH/HOM - LIVE-state attribute(s)"  |
| **Severity**       | Warning                                      |
| **Status**         | Currently disabled                           |

**How to fix:**

1. Provide DBH and/or HOM measurements
2. If stem couldn't be measured, add appropriate attribute code
3. Verify attribute codes reflect actual stem status

---

## Cross-Census Validations

### Quadrat Mismatch from Previous Census

| Detail             | Information                                                             |
| ------------------ | ----------------------------------------------------------------------- |
| **What it checks** | Tree remains in same quadrat as previous census                         |
| **Error message**  | "Quadrat mismatch: Previous census quadrat was '[X]', current is '[Y]'" |
| **Severity**       | Error (hard failure)                                                    |

**Why this validation exists:**
Trees cannot change quadrats between censuses. This indicates a labeling or recording error.

**How to fix:**

1. Verify the TreeTag is correct
2. Check if the tag was reassigned to a different tree
3. If tree genuinely needs to change quadrats, contact administrator

---

## Attribute/Code Validations

### Invalid Attribute Codes

| Detail             | Information                             |
| ------------------ | --------------------------------------- |
| **What it checks** | All codes exist in the Attributes table |
| **Error message**  | "Invalid Codes"                         |
| **Severity**       | Error                                   |

**How to fix:**

1. Go to Fixed Data > Stem Codes (Attributes)
2. Add any missing codes
3. Or correct typos in the codes field

---

## Validation Status Reference

| Status            | Meaning                   | Action                            |
| ----------------- | ------------------------- | --------------------------------- |
| **Validated**     | Passed all enabled checks | No action needed                  |
| **Errors Found**  | Failed one or more checks | Review and fix flagged issues     |
| **Not Validated** | Checks not yet run        | Validation will run automatically |

---

## Enabling/Disabling Validations

Administrators can enable or disable specific validations:

1. Go to Measurements Hub > Validations
2. Find the validation in the list
3. Toggle the enable/disable switch
4. Changes take effect on next validation run

> {style="warning"}
> Disabling validations may allow data quality issues to go undetected. Only disable if you have a specific reason.

---

## Validation Quick Reference Table

| ID  | Validation Name             | What it Checks          | Severity |
| --- | --------------------------- | ----------------------- | -------- |
| 1   | DBH Growth Exceeds Max      | Growth > 65mm           | Warning  |
| 2   | DBH Shrinkage Exceeds Max   | Shrinkage > 5%          | Warning  |
| 3   | Invalid Species Codes       | Code in Species List    | Error    |
| 4   | Duplicate Quadrat Names     | Unique quadrat names    | Warning  |
| 5   | Duplicate Tree/Stem Tags    | Unique tag combination  | Error    |
| 6   | Outside Census Dates        | Date in census range    | Error    |
| 7   | Different Species Same Tree | Consistent species      | Warning  |
| 8   | Stems Outside Plots         | Coordinates in bounds   | Error    |
| 9   | Stems in Different Quadrats | Same quadrat per tree   | Warning  |
| 11  | DBH Outside Species Bounds  | Within species limits   | Warning  |
| 12  | Measurements on Dead Stems  | No measurements if dead | Warning  |
| 13  | Missing Measurements Live   | Measurements if alive   | Warning  |
