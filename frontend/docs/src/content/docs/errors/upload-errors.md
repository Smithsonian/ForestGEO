---
title: Upload Errors
description: Guide to errors that may occur during file upload and processing stages.
---

This guide covers errors that may occur during the file upload and processing stages.

---

## File Parsing Errors

### File Reading Errors

| Error Message              | Cause                               | How to Fix                                 |
| -------------------------- | ----------------------------------- | ------------------------------------------ |
| "File reading was aborted" | File read operation was interrupted | Try uploading the file again               |
| "File reading has failed"  | Cannot read the file contents       | Check file is not corrupted; try re-saving |
| "Failed to read file"      | File access error                   | Ensure file is not open in another program |

### CSV Parsing Errors

| Error Message                                 | Cause                                  | How to Fix                                                            |
| --------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| "Error on row: [N]. [message]"                | Malformed CSV data on specific row     | Check row N for formatting issues (unescaped quotes, wrong delimiter) |
| "File [name] was rejected"                    | File does not meet upload requirements | Check file type (must be CSV, TSV, or TXT)                            |
| "Delimiter validation issues for file [name]" | Inconsistent or incorrect delimiter    | Re-save file with consistent delimiter (comma, tab, or semicolon)     |

### Header Validation Errors

| Error Message                            | Cause                                    | How to Fix                                                           |
| ---------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| "Missing required fields: [fields]"      | Required columns not found in header row | Add the listed columns to your CSV file                              |
| "Tag values contain delimiter character" | Tag field contains comma/tab             | Remove special characters from tag values or use proper CSV escaping |
| "Unusually long tag values detected"     | Fields may have been concatenated        | Check delimiter settings; verify tag values are correct length       |

---

## Server Communication Errors

### Network Errors

| Error Message                 | Cause                          | How to Fix                                                  |
| ----------------------------- | ------------------------------ | ----------------------------------------------------------- |
| "Request timeout after [N]ms" | Server did not respond in time | Wait a moment and retry; check your internet connection     |
| "Server error: 500"           | Internal server error          | Wait and retry; if persistent, contact administrator        |
| "Server error: 503"           | Server temporarily unavailable | Server may be overloaded; wait and retry later              |
| "Server error: [code]"        | Various server-side issues     | Note the error code and contact administrator if persistent |

### Authentication Errors

| Error Message                            | Cause                            | How to Fix                      |
| ---------------------------------------- | -------------------------------- | ------------------------------- |
| "Unauthorized - authentication required" | Session expired or not logged in | Log out and log back in         |
| "You must be logged in to upload data"   | Not authenticated                | Log in before attempting upload |

---

## Batch Processing Errors

### Setup Errors

| Error Message                                                             | Cause                        | How to Fix                                                 |
| ------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------- |
| "Missing required context. Please ensure a plot and census are selected." | No plot or census selected   | Select a plot and census from the sidebar before uploading |
| "Failed to setup bulk processor: [status]"                                | Cannot initialize processing | Try the upload again; contact administrator if persistent  |
| "Another upload is in progress for Plot [X], Census [Y]"                  | Concurrent upload detected   | Wait for the other upload to complete                      |
| "Failed to acquire application lock for file [ID]"                        | System lock conflict         | Wait a moment and retry                                    |

### Processing Errors

| Error Message                                    | Cause                           | How to Fix                                                |
| ------------------------------------------------ | ------------------------------- | --------------------------------------------------------- |
| "API returned status [code] for batch [ID]"      | Batch processing failed         | Check data for issues; may need to fix and re-upload      |
| "Collapser failed: [status]"                     | Final data consolidation failed | Contact administrator with error details                  |
| "Failed to move batch to failed measurements"    | Cannot save error records       | Contact administrator; data may need manual recovery      |
| "Queue processing stalled - timeout after [N]ms" | Processing took too long        | Large files may need to be split; retry with smaller file |

### Verification Errors

| Error Message                           | Cause                                        | How to Fix                                                          |
| --------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| "Upload verification failed for [file]" | Data verification step failed                | Check your data file for issues and re-upload                       |
| "No data found in database for [file]"  | Upload appeared to succeed but no data found | Upload may have failed silently; try again or contact administrator |

---

## Data Validation Errors (Pre-Processing)

### Required Field Errors

| Error Message                             | Cause                       | How to Fix                             |
| ----------------------------------------- | --------------------------- | -------------------------------------- |
| "Missing required field: TreeTag"         | TreeTag column is empty     | Provide TreeTag value for all rows     |
| "Missing required field: StemTag"         | StemTag column is empty     | Provide StemTag value for all rows     |
| "Missing required field: SpeciesCode"     | SpeciesCode column is empty | Provide SpeciesCode value for all rows |
| "Missing required field: QuadratName"     | QuadratName column is empty | Provide QuadratName value for all rows |
| "Missing required field: MeasurementDate" | Date column is empty        | Provide date value for all rows        |

### Field Length Errors

| Error Message                                         | Cause                    | How to Fix                                      |
| ----------------------------------------------------- | ------------------------ | ----------------------------------------------- |
| "TreeTag exceeds maximum length of 20 characters"     | Tag value too long       | Shorten TreeTag to 20 characters or less        |
| "StemTag exceeds maximum length of 10 characters"     | Tag value too long       | Shorten StemTag to 10 characters or less        |
| "SpeciesCode exceeds maximum length of 25 characters" | Code too long            | Shorten SpeciesCode to 25 characters or less    |
| "Comments exceed maximum length of 255 characters"    | Comment text too long    | Shorten Comments field                          |
| "Codes exceed maximum length of 255 characters"       | Too many attribute codes | Reduce number of codes or contact administrator |

### Numeric Value Errors

| Error Message                                                | Cause                   | How to Fix                                   |
| ------------------------------------------------------------ | ----------------------- | -------------------------------------------- |
| "Invalid DBH: [value] (must be >= 0 or NULL)"                | Negative DBH value      | DBH cannot be negative; use 0 or leave empty |
| "Invalid HOM: [value] (must be >= 0 or NULL)"                | Negative HOM value      | HOM cannot be negative; use 0 or leave empty |
| "Invalid LocalX: [value]"                                    | Invalid X coordinate    | Ensure LocalX is a non-negative number       |
| "Invalid LocalY: [value]"                                    | Invalid Y coordinate    | Ensure LocalY is a non-negative number       |
| "Missing measurement data: DBH and HOM both 0 with no codes" | No measurement provided | Provide DBH, HOM, or attribute codes         |

---

## Duplicate Detection Errors

| Error Message                                                                  | Cause                       | How to Fix                           |
| ------------------------------------------------------------------------------ | --------------------------- | ------------------------------------ |
| "Duplicate entry: Same TreeTag/StemTag/DBH/HOM/Date. Original record ID: [ID]" | Exact duplicate row in file | Remove duplicate rows from your file |

:::note
Duplicates are automatically detected and moved to Failed Measurements. You can review them there and decide how to proceed.
:::

---

## Reference Data Errors

| Error Message                                          | Cause                       | How to Fix                                                    |
| ------------------------------------------------------ | --------------------------- | ------------------------------------------------------------- |
| "Invalid quadrat name: '[name]' not found in database" | Quadrat doesn't exist       | Add the quadrat in Fixed Data > Quadrats before uploading     |
| "Invalid species code: '[code]' not found in database" | Species not in Species List | Add the species in Fixed Data > Species List before uploading |

:::caution
These errors will cause measurements to fail. Always ensure all quadrats and species exist in Fixed Data BEFORE uploading measurements.
:::

---

## Error Recovery Actions

### If your upload fails partway through:

1. **Don't panic** - Your data is not lost
2. **Check Failed Measurements** - Successfully parsed rows that failed validation are stored there
3. **Fix the issues** - Correct your source file based on error messages
4. **Re-upload** - Upload the corrected file

### If you see "Request timeout":

1. **Wait** - Give the server 30 seconds to recover
2. **Do not close your browser** - The upload may still be processing
3. **Check progress** - Look at the progress bar for any movement
4. **Retry if needed** - If no progress after 2 minutes, refresh and retry

### If you see repeated server errors:

1. **Note the error code** (500, 503, etc.)
2. **Wait 5 minutes** - Server may be recovering
3. **Try a smaller file** - Split large uploads into smaller batches
4. **Contact administrator** - If errors persist after multiple attempts

---

## Best Practices to Avoid Upload Errors

1. **Validate your file first**
   - Open in a spreadsheet program and check formatting
   - Ensure all required columns are present
   - Check for empty cells in required fields

2. **Use consistent formatting**
   - Same delimiter throughout (comma or tab)
   - Same date format (YYYY-MM-DD recommended)
   - No special characters in tag fields

3. **Check Fixed Data first**
   - Verify all species codes exist
   - Verify all quadrat names exist
   - Add any missing Fixed Data before uploading

4. **Upload in reasonable batches**
   - Very large files (>100,000 rows) may timeout
   - Consider splitting into multiple files

5. **Don't upload during peak hours**
   - If others are uploading, you may see timeouts
   - Coordinate with your team for large uploads
