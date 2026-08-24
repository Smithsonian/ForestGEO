---
title: Validation Errors
description: Guide to all validation checks and how to resolve validation errors.
---

This guide explains all validation checks performed on your data and how to resolve validation errors.

---

## Understanding Validation

Validation is the process of checking your data for quality and consistency. The ForestGEO Application performs validations:

1. **During upload** - Format and required field checks
2. **After ingestion** - Business rule and data quality checks
3. **Cross-census** - Comparing with previous census data

:::note
Validation errors do NOT prevent your data from being saved. Data is saved but flagged for review. You can fix errors after upload.
:::

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
| **Outcome**        | The row is saved and flagged for review |

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
| **Outcome**        | The row is saved and flagged for review |

**Why this validation exists:**
Trees rarely shrink significantly. Large shrinkage usually indicates measurement error or stem damage.

**How to fix:**

1. Verify the previous measurement was correct
2. Check if measurement was taken at correct HOM (height)
3. Look for stem damage, bark loss, or cambial slippage
4. If shrinkage is real, document the reason in Comments
5. Edit the measurement if incorrect

---

### Reviewing growth and shrinkage findings in View Errors

Both checks compare the current measurement against the same tag/stem in the previous census, so
View Errors shows that comparison alongside each finding: the **Prior DBH** and **Prior HOM** from
the earlier census, and an **HOM Changed** chip when the height of measurement differs between the
two — a changed HOM is a common, legitimate explanation for an apparent shrinkage or growth
finding, not necessarily a measurement error. An **Export CSV** button on the errors screen exports
every flagged occurrence, including the prior-census columns, for review outside the application.

Neither check runs at all when the DBH it needs from either census is missing — there is nothing
to compare, so the row is silently skipped rather than flagged in either direction.

A related check, **Live stem is missing DBH measurement** (Validation ID 13, see the reference
table below), flags a live stem that carries no DBH at all. It exists but ships **disabled**; ask
your administrator to enable it if your site wants every live stem to carry a DBH.

---

## Species Validations

### Invalid Species Codes

| Detail             | Information                                              |
| ------------------ | -------------------------------------------------------- |
| **Validation ID**  | 3                                                        |
| **What it checks** | Species code exists in the Species List                  |
| **Error message**  | "Species Code is invalid (not defined in species table)" |
| **Outcome**        | The row is saved and flagged for review |

**How to fix:**

1. Go to Stem & Plot Details > Species List
2. Add the missing species code
3. If the code was a typo, edit the measurement with correct code

---

### Invalid Attribute Codes

| Detail             | Information                                                                |
| ------------------ | -------------------------------------------------------------------------- |
| **Validation ID**  | 14                                                                         |
| **What it checks** | Attribute / stem codes (`L`, `Q`, `D2`, etc.) exist in the Attributes list |
| **Outcome**        | The row is saved; the unknown code is flagged (soft warning since April 2026) |

**Behavior change (April 2026):** Invalid attribute codes used to block ingestion. They are now **soft warnings** — the row goes into the database and the unknown code is surfaced in the row's flags. You can either add the missing code to the Attributes list or correct the value via inline edit or Revision Upload.

**How to fix:**

1. Note the unrecognised code from the warning
2. Either add it under **Stem & Plot Details → Stem Codes**, or correct the row to use a known code

---

### Different Species on Same Tree

| Detail             | Information                                    |
| ------------------ | ---------------------------------------------- |
| **Validation ID**  | 7                                              |
| **What it checks** | All stems of a tree have the same species code |
| **Error message**  | "Flagged;Different species"                    |
| **Outcome**        | The row is saved and flagged for review |

**Why this validation exists:**
All stems from the same tree must be the same species. Different codes indicate a data entry error.

**How to fix:**

1. Determine the correct species for the tree
2. Update all stems of that tree to use the same species code
3. Check if stems were accidentally assigned wrong tree tags

---

## Location Validations

### Stems Outside Plot Boundaries

| Detail             | Information                                  |
| ------------------ | -------------------------------------------- |
| **Validation ID**  | 8                                            |
| **What it checks** | Stem coordinates fall within plot boundaries |
| **Error message**  | "Stem coordinates NULL, negative, or outside plot boundaries" |
| **Outcome**        | The row is saved and flagged for review |

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
| **Error message**  | "Flagged;Flagged;Different quadrats"        |
| **Outcome**        | The row is saved and flagged for review |

**Why this validation exists:**
A tree cannot physically span multiple quadrats. Different quadrats indicate a labeling error.

**How to fix:**

1. Determine which quadrat is correct for the tree
2. Update all stems to use the same quadrat name
3. Check if stems were given wrong tree tags

---

## Duplicate Detection Validations

### Duplicate Quadrat Names

| Detail             | Information                                     |
| ------------------ | ----------------------------------------------- |
| **Validation ID**  | 4                                               |
| **What it checks** | Quadrat names are unique within the plot        |
| **Error message**  | "Quadrat's name matches existing OTHER quadrat" |
| **Outcome**        | The row is saved and flagged for review |

**How to fix:**

1. Go to Stem & Plot Details > Quadrats
2. Rename one of the duplicate quadrats
3. Update measurements to use correct quadrat name

---

### Duplicate Tree/Stem Tag Combination

| Detail             | Information                                             |
| ------------------ | ------------------------------------------------------- |
| **Validation ID**  | 5                                                       |
| **What it checks** | Each TreeTag + StemTag combination is unique per census |
| **Error message**  | "Duplicate tree (and stem) tag found in census"         |
| **Outcome**        | The row is saved and flagged for review |

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
| **Outcome**        | The row is saved and flagged for review |

**How to fix:**

1. Verify the measurement date is correct
2. Check the census start and end dates
3. If measurement date is correct, census dates may need adjustment
4. Contact administrator to adjust census dates if needed

---

## Validation Quick Reference Table

| ID  | Validation Name             | What it Checks                                       | Default state |
| --- | --------------------------- | ---------------------------------------------------- | ------------- |
| 1   | DBH Growth Exceeds Max      | Growth > 65 mm since the previous census             | Enabled       |
| 2   | DBH Shrinkage Exceeds Max   | Shrinkage > 5% since the previous census             | Enabled       |
| 3   | Invalid Species Codes       | Code exists in the Species List                      | Enabled       |
| 4   | Duplicate Quadrat Names     | Quadrat name is unique within the plot               | Enabled       |
| 5   | Duplicate Tree/Stem Tags    | Tag combination is unique within the census          | Enabled       |
| 6   | Outside Census Dates        | Measurement date falls inside the census range       | Enabled       |
| 7   | Different Species Same Tree | All stems on a tree share one species                | Enabled       |
| 8   | Stems Outside Plots         | Coordinates are present, non-negative, and in bounds | Enabled       |
| 9   | Stems in Different Quadrats | All stems on a tree share one quadrat                | Enabled       |
| 11  | DBH Outside Species Bounds  | DBH within the species limits you defined            | Enabled       |
| 12  | Measurements on Dead Stems  | No measurements if the stem is marked dead           | **Disabled**  |
| 13  | Missing Measurements Live   | A stem with a live attribute carries a measurement    | **Disabled**  |
| 14  | Invalid Attribute Codes     | Attribute code exists in the Stem Codes list         | Enabled       |
| 15  | Abnormally High DBH         | DBH below the absolute maximum (3500 mm / 350 cm)    | Enabled       |
| 17  | Quadrat Mismatch            | Tag's quadrat matches the previous census            | Enabled       |
| 18  | Coordinate Drift            | Tag moved less than 10 m since the previous census   | Enabled       |

:::note
**Every validation runs after ingestion.** None of them can stop a row being written — a
validation that doesn't pass records an entry against the row so you can review it. Rows that
are rejected outright fail earlier, during ingestion, and are covered in the
[Failed Measurements Guide](/ForestGEO/errors/failed-measurements-guide/).
:::

:::note
**Gaps in the numbering are expected.** IDs 10, 16 and 19 are unused. Validation 16 was retired
in 2026 — its check duplicated logic already run inline during ingestion. If you see references
to V16 in older notes, ignore them.
:::

### Species checks raised during ingestion

Two further codes come from the ingestion process itself rather than from the configurable
validation list, so they do not appear in the table above and cannot be disabled.

| Code | What it means | What to do |
| ---- | ------------- | ---------- |
| **20** | **Species mismatch from previous census** — this tag was recorded as a different species last census | Decide which identification is correct. A genuine re-identification is fine; a mismatch on a tag you did not re-examine usually means a transcription error. |
| **21** | **Same-batch species conflict** — the same tag appears twice in your file with different species codes | Correct your file. The first occurrence was treated as authoritative, so the census may now hold the wrong species for that tag. |

:::caution
Code 21 matters more than it looks. The ingestion did not stop — it picked the first row it saw
and carried on, so the data is already in place and may be wrong. Check these before assuming
the upload was clean.
:::

---

## Enabling/Disabling Validations

Administrators can enable or disable specific validations:

1. Go to Census Hub > Validations
2. Find the validation in the list
3. Toggle the enable/disable switch
4. Changes take effect on next validation run

:::caution
Disabling validations may allow data quality issues to go undetected. Only disable if you have a specific reason.
:::
