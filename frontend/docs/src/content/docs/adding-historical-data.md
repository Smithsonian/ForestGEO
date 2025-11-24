---
title: Adding Historical Data
description: Learn how to add historical data to the ForestGEO application through file uploads.
---

When you first start using the application, you'll need to add historical data from previous censuses. This guide explains the data types, file formats, and upload process.

---

## Overview

Adding historical data involves:

1. **Creating censuses** for each historical period
2. **Uploading Fixed Data** (attributes, personnel, quadrats, species)
3. **Uploading Measurements** for each census

:::note
You must complete the Fixed Data uploads before you can upload measurements. The measurements form references Fixed Data records.
:::

---

## Understanding the Forms

The app accepts file uploads (called `forms`) in either **CSV** or **TSV** format.

A "complete" census comprises the following data types:

| Form Type | Description | Census-Dependent |
|-----------|-------------|------------------|
| **Attributes** (Stem Codes) | Codes describing stem conditions | No |
| **Personnel** | Field staff for the census | Yes (can rollover) |
| **Quadrats** | Plot subdivisions | Yes (can rollover) |
| **Species** | Species inventory | No |
| **Measurements** | DBH measurements and dates | Yes |

:::caution
**Measurements are locked** until at least one record exists in each of the other data types!
:::

---

## Form Headers Quick Reference

Each form accepts specific headers. **Headers in bold are required.**

| Form Type    | H1            | H2           | H3         | H4              | H5         | H6       | H7           | H8                  | H9       | H10   | H11      |
| ------------ | ------------- | ------------ | ---------- | --------------- | ---------- | -------- | ------------ | ------------------- | -------- | ----- | -------- |
| attributes   | **code**      | description  | status     |                 |            |          |              |                     |          |       |          |
| personnel    | **firstname** | **lastname** | **role**   | roledescription |            |          |              |                     |          |       |          |
| quadrats     | **quadrat**   | **startx**   | **starty** | **dimx**        | **dimy**   | **area** | quadratshape |                     |          |       |          |
| species      | **spcode**    | family       | genus      | **species**     | subspecies | idlevel  | authority    | subspeciesauthority |          |       |          |
| measurements | **tag**       | stemtag      | **spcode** | **quadrat**     | **lx**     | **ly**   | dbh          | hom                 | **date** | codes | comments |

:::caution
Files that do not contain the required headers will be rejected!
:::

---

## Detailed Form Specifications

### The `attributes` Form (Stem Codes)

**Navigation**: Stem & Plot Details → Stem Codes → Upload

| Header | Required | Type | Description | Constraints |
|--------|----------|------|-------------|-------------|
| `code` | Yes | String | Attribute code | Max 10 characters |
| `description` | No | String | Explanation of the attribute | |
| `status` | No | String | Classification category | See values below |

**Valid `status` values:**
- `alive` - Stem is living and measured
- `alive-not measured` - Living but not measured this census
- `dead` - Entire tree is dead
- `missing` - Not found during census
- `broken below` - Broken below measurement point
- `stem dead` - This specific stem is dead

### The `personnel` Form

**Navigation**: Stem & Plot Details → Personnel → Upload

| Header | Required | Type | Description |
|--------|----------|------|-------------|
| `firstname` | Yes | String | First name |
| `lastname` | Yes | String | Last name |
| `role` | Yes | String | Brief task description |
| `roledescription` | No | String | Detailed role explanation |

### The `quadrats` Form

**Navigation**: Stem & Plot Details → Quadrats → Upload

| Header | Required | Type | Description |
|--------|----------|------|-------------|
| `quadrat` | Yes | String | Unique quadrat identifier (e.g., "0322") |
| `startx` | Yes | Decimal | X-coordinate of quadrat origin |
| `starty` | Yes | Decimal | Y-coordinate of quadrat origin |
| `dimx` | Yes | Decimal | Width along X-axis |
| `dimy` | Yes | Decimal | Width along Y-axis |
| `area` | Yes | Decimal | Total area of quadrat |
| `quadratshape` | No | String | Shape description |

### The `species` Form

**Navigation**: Stem & Plot Details → Species List → Upload

| Header | Required | Type | Description |
|--------|----------|------|-------------|
| `spcode` | Yes | String | Unique species code (e.g., "AESPO") |
| `family` | No | String | Taxonomic family |
| `genus` | No | String | Taxonomic genus |
| `species` | Yes | String | Species name |
| `subspecies` | No | String | Subspecies taxonomy |
| `idlevel` | No | String | Deepest identification level |
| `authority` | No | String | Taxonomic authority |
| `subspeciesauthority` | No | String | Subspecies authority |

### The `measurements` Form

**Navigation**: Census Hub → View Data → Upload

| Header | Required | Type | Description |
|--------|----------|------|-------------|
| `tag` | Yes | String/Number | Tree tag identifier |
| `stemtag` | No | String/Number | Stem identifier (default: 0) |
| `spcode` | Yes | String | Species code (must exist in Species List) |
| `quadrat` | Yes | String | Quadrat name (must exist in Quadrats) |
| `lx` | Yes | Decimal | X-coordinate within quadrat |
| `ly` | Yes | Decimal | Y-coordinate within quadrat |
| `dbh` | No | Decimal | Diameter at breast height |
| `hom` | No | Decimal | Height of measurement |
| `date` | Yes | Date | Measurement date (YYYY-MM-DD) |
| `codes` | No | String | Comma-separated attribute codes |
| `comments` | No | String | Additional notes |

---

## Workflow for Multiple Historical Censuses

If you have data from multiple past censuses, follow this workflow:

### Step 1: Plan Your Census Order

Start with the **oldest** census and work forward chronologically. This ensures:
- Tree/stem references are established in order
- Growth validations work correctly (they compare to previous census)

### Step 2: Set Up Fixed Data (Once)

**Species** and **Stem Codes** are shared across all censuses - upload these once:

1. Navigate to **Stem & Plot Details → Species List**
2. Upload your complete species list
3. Navigate to **Stem & Plot Details → Stem Codes**
4. Upload your attribute codes

### Step 3: For Each Historical Census

Repeat these steps for each census, starting with the oldest:

1. **Create the census** via the Census dropdown
2. **Add Personnel** for that census
3. **Add Quadrats** for that census (or use Rollover from previous)
4. **Upload Measurements** for that census

### Using Census Rollover

When creating a new census that shares data with a previous census:

1. In the Census Creation popup, find the Rollover sections
2. For **Personnel**: Select a previous census to copy personnel records
3. For **Quadrats**: Select a previous census to copy quadrat definitions
4. Click **Customize** to select specific records to copy

:::tip
Rollover saves significant time when the same field team and quadrat structure are used across multiple censuses.
:::

---

## Common Issues and Solutions

### "Species code not found"

**Cause**: The `spcode` in your measurements file doesn't exist in the Species List.

**Solution**:
1. Add the missing species to the Species List
2. Re-upload measurements, or use "Reingest" for failed records

### "Quadrat not found"

**Cause**: The `quadrat` value doesn't match any defined quadrat.

**Solution**:
1. Check for typos or case sensitivity
2. Add the missing quadrat to the Quadrats data
3. Re-upload or reingest

### "Required field missing"

**Cause**: A required column is empty for one or more rows.

**Solution**:
1. Download the error report
2. Fill in missing values
3. Re-upload the corrected file

### Headers not recognized

**Cause**: Header names don't match expected values.

**Solution**:
- Headers are case-insensitive
- Remove extra spaces
- Use exact header names from the tables above

---

## Best Practices for Historical Data

1. **Back up original files** before modifying them for upload
2. **Start with oldest census** to establish proper tree/stem references
3. **Use consistent species codes** across all census files
4. **Validate dates** are within the census period
5. **Check for duplicates** before uploading
6. **Upload in batches** if you have very large files (50,000+ rows)
7. **Review failed measurements** promptly and resolve issues
8. **Export after upload** to verify data was loaded correctly
