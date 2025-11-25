---
title: Failed Measurements Guide
description: Learn about failed measurements, why they occur, and how to fix and reingest them.
---

This guide explains what failed measurements are, why they occur, and how to fix and reingest them.

---

## What are Failed Measurements?

Failed measurements are data records that could not be successfully processed into the database during upload. Instead of being lost, they are stored in a separate "Failed Measurements" table where you can review, fix, and retry them.

:::note
Failed measurements are NOT lost data. They are safely stored and can be recovered.
:::

---

## Accessing Failed Measurements

There are two ways to access failed measurements:

1. **After Upload** - A modal automatically appears if measurements failed during upload
2. **From Measurements Hub** - Click "View Failed Measurements" button in the measurements view

---

## Understanding Failure Reasons

Each failed measurement has one or more failure reasons explaining why it couldn't be processed.

### Missing Data Failures

| Failure Reason      | Field        | Cause                                | How to Fix                      |
| ------------------- | ------------ | ------------------------------------ | ------------------------------- |
| **SpCode missing**  | Species Code | Species code is empty                | Add a valid species code        |
| **Quadrat missing** | Quadrat      | Quadrat name is empty                | Add a valid quadrat name        |
| **Missing X**       | X Coordinate | X coordinate is empty or -1          | Provide X coordinate            |
| **Missing Y**       | Y Coordinate | Y coordinate is empty or -1          | Provide Y coordinate            |
| **Missing Tag**     | Tree Tag     | Tree tag is empty                    | Provide tree tag                |
| **Missing StemTag** | Stem Tag     | Stem tag is empty                    | Provide stem tag                |
| **Missing Date**    | Date         | Measurement date is empty or invalid | Provide valid date (YYYY-MM-DD) |

### Invalid Reference Failures

| Failure Reason      | Field           | Cause                                      | How to Fix                                     |
| ------------------- | --------------- | ------------------------------------------ | ---------------------------------------------- |
| **SpCode invalid**  | Species Code    | Species code doesn't exist in Species List | Add species to Fixed Data, then reingest       |
| **Quadrat invalid** | Quadrat         | Quadrat name doesn't exist for the plot    | Add quadrat to Fixed Data, then reingest       |
| **Invalid Codes**   | Attribute Codes | One or more codes don't exist              | Add missing codes to Attributes, then reingest |

---

## The Failed Measurements Modal

When failed measurements exist, you'll see a modal with these options:

### Available Actions

| Button              | What it Does                                      | When to Use                                                       |
| ------------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| **Reingest All**    | Moves all failed records back to processing queue | After fixing the underlying issues (e.g., adding missing species) |
| **Clear Failed**    | Permanently deletes all failed measurements       | When failures are not recoverable or duplicates                   |
| **Clear Temporary** | Deletes temporary staging records                 | To clean up after a failed upload attempt                         |
| **Close**           | Close the modal without action                    | When you want to fix issues before deciding                       |

---

## How to Fix Failed Measurements

### Method 1: Fix and Reingest (Recommended)

Best when failures are due to missing reference data (species, quadrats, codes).

**Steps:**

1. Review the failure reasons in the modal or data grid
2. Add missing data to Fixed Data:
   - Missing species → Fixed Data > Species List
   - Missing quadrats → Fixed Data > Quadrats
   - Missing codes → Fixed Data > Stem Codes
3. Return to Failed Measurements
4. Click "Reingest All"
5. System will reprocess using the newly added data

### Method 2: Edit Individual Records

Best when failures are due to typos or incorrect values.

**Steps:**

1. Open the Failed Measurements data grid
2. Click on a row to expand/edit
3. Correct the error(s):
   - Fix typos in species codes
   - Correct tag numbers
   - Add missing values
4. Save the changes
5. Click "Reingest" for that row (or reingest all)

### Method 3: Clear and Re-upload

Best when there are many errors in the original file.

**Steps:**

1. Click "Clear Failed" to remove failed records
2. Fix your original CSV file
3. Upload the corrected file

---

## Reingestion Process Explained

When you click "Reingest":

1. Failed records are moved to the temporary staging table
2. The system runs the full ingestion process again
3. Records that pass validation move to the main database
4. Records that still fail return to Failed Measurements
5. You can review any remaining failures

:::caution
Records that fail reingestion will show updated failure reasons. The original errors may have been fixed, but new issues found.
:::

---

## Common Scenarios and Solutions

### Scenario 1: "SpCode invalid" for multiple records

**Cause:** Species code in your file doesn't exist in Species List.

**Solution:**

1. Note the invalid species code(s) from the failure messages
2. Go to Fixed Data > Species List
3. Add the missing species (with correct taxonomy)
4. Return and click "Reingest All"

### Scenario 2: "Quadrat invalid" errors

**Cause:** Quadrat names in your file don't match defined quadrats.

**Solution:**

1. Check the quadrat names in failure messages
2. Go to Fixed Data > Quadrats
3. Either:
   - Add the missing quadrats, OR
   - Note the correct quadrat names and edit the failed records
4. Reingest

### Scenario 3: Same failures keep appearing after reingest

**Cause:** The underlying issue wasn't actually fixed.

**Solution:**

1. Double-check that species/quadrats were saved correctly
2. Ensure the code in Fixed Data matches EXACTLY (case-sensitive)
3. Verify the data wasn't accidentally modified
4. Try editing the failed record directly instead

---

## FAQ: Failed Measurements

### Q: Will I lose my failed measurements if I close the browser?

**A:** No. Failed measurements are saved in the database and persist until you clear or reingest them.

### Q: Can I edit failed measurements directly?

**A:** Yes. Use the Failed Measurements data grid to edit individual records.

### Q: What happens if I reingest and records still fail?

**A:** They return to Failed Measurements with updated failure reasons.

### Q: Can I reingest one record at a time?

**A:** Yes. You can reingest individual records or all at once.

### Q: Should I clear failed measurements before re-uploading?

**A:** Yes, to avoid duplicates. Clear failed measurements if you're going to upload a corrected file.
