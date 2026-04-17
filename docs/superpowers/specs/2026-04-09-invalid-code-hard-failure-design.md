# Invalid Attribute Code Hard Failure

## Problem

When a measurement row contains attribute codes that don't exist in the `attributes` table (e.g., "MX", "I"), `bulkingestionprocess` silently drops them during Stage 9 (attribute materialization). The row ingests successfully into `coremeasurements` with an empty Codes column. An error is logged to `measurement_error_log` with ErrorCode `'14'`, but the row itself is not marked as failed.

Users expect invalid codes to cause the row to fail so they can correct the data and re-upload.

**Affected tags (cocoli example):** 011381 and 011377 with codes "MX" and "I".

## Design

### Approach: Early validation (new Stage 1b)

Add a code validation stage between Stage 1 (early validation) and Stage 2 (deduplication) in `bulkingestionprocess`. Rows with any invalid attribute code are routed to `hard_failure_rows` before they ever enter tree/stem resolution or core insert. This follows the existing pattern where each stage validates one concern and routes failures to `hard_failure_rows`.

### Change 1: New error code in `measurement_errors` seed data

**File:** `sqlscripting/tablestructures.sql`

Add to the `INSERT IGNORE INTO measurement_errors` block:

```sql
('ingestion', 'INVALID_ATTRIBUTE_CODE', 'Row contains invalid attribute code(s)')
```

The existing `('validation', '14', 'Invalid attribute code')` row is left in place to avoid breaking foreign key constraints on historical `measurement_error_log` data.

### Change 2: New Stage 1b — Code Validation

**File:** `sqlscripting/storedprocedures.sql` (between Stage 1 and Stage 2)

```sql
-- STAGE 1b: CODE VALIDATION
CREATE TEMPORARY TABLE invalid_code_rows AS
SELECT tm.id,
       LEFT(CONCAT('Invalid attribute code(s): ',
            GROUP_CONCAT(DISTINCT jt.code ORDER BY jt.code SEPARATOR ', ')), 255) AS FailureReason
FROM temporarymeasurements tm,
JSON_TABLE(
    CONCAT('["', REPLACE(TRIM(tm.Codes), ';', '","'), '"]'),
    '$[*]' COLUMNS (code VARCHAR(10) PATH '$')
) jt
LEFT JOIN attributes a ON a.Code = TRIM(jt.code) AND a.IsActive = 1
WHERE tm.FileID = vFileID AND tm.BatchID = vBatchID AND tm.CensusID = vCurrentCensusID
  AND tm.id NOT IN (SELECT id FROM validation_failures)
  AND tm.Codes IS NOT NULL AND TRIM(tm.Codes) != ''
  AND a.Code IS NULL
GROUP BY tm.id;

INSERT IGNORE INTO hard_failure_rows (SourceRowIndex, ErrorCode, FailureReason)
SELECT id, 'INVALID_ATTRIBUTE_CODE', FailureReason
FROM invalid_code_rows;
```

Behavior:
- Parses semicolon-delimited codes using the same `JSON_TABLE` pattern already in Stage 9
- LEFT JOINs against `attributes` to find codes with no active match
- Groups by row ID, building a failure reason that lists all invalid codes (e.g., `"Invalid attribute code(s): I, MX"`)
- Routes failing rows to `hard_failure_rows`
- Rows with NULL/empty Codes pass through untouched
- Only processes rows that survived Stage 1

### Change 3: Fix Stage 2 dedup exclusion

**File:** `sqlscripting/storedprocedures.sql` (Stage 2 `initial_dup_filter` query)

Change:
```sql
AND id NOT IN (SELECT id FROM validation_failures)
```
To:
```sql
AND id NOT IN (SELECT SourceRowIndex FROM hard_failure_rows)
```

This is a strict superset — `hard_failure_rows` already contains everything from `validation_failures` plus the new invalid-code rows. This also makes the pipeline more robust: any future validation stage that writes to `hard_failure_rows` before dedup will be automatically excluded.

### Change 4: Simplify Stage 9 attribute materialization

**File:** `sqlscripting/storedprocedures.sql` (Stage 9)

Since all codes reaching Stage 9 are now pre-validated, remove:

1. The `INNER JOIN attributes a ON a.Code = tc.Code AND a.IsActive = 1` guard on the `cmattributes` insert (line ~2912). Simplify to:
   ```sql
   INSERT IGNORE INTO cmattributes (CoreMeasurementID, Code)
   SELECT tc.CoreMeasurementID, tc.Code
   FROM tempcodes tc;
   ```

2. The invalid-code error logging block (lines ~2914–2920) that logs ErrorCode `'14'` to `measurement_error_log`. This is now dead code.

The `INSERT IGNORE` on `cmattributes` is retained as protection against duplicate key violations.

## Behavior Summary

| Scenario | Before | After |
|----------|--------|-------|
| Row with all valid codes (e.g., "D;A") | Succeeds, codes materialized | No change |
| Row with all invalid codes (e.g., "MX;I") | Succeeds with empty codes column, error '14' logged | Hard failure, row in View Errors with "Invalid attribute code(s): I, MX" |
| Row with mixed codes (e.g., "D;MX") | Succeeds with only "D" materialized, error '14' logged for "MX" | Hard failure, entire row fails with "Invalid attribute code(s): MX" |
| Row with no codes | Succeeds | No change |

## Files Modified

| File | Change |
|------|--------|
| `sqlscripting/tablestructures.sql` | Add `INVALID_ATTRIBUTE_CODE` to `measurement_errors` seed data |
| `sqlscripting/storedprocedures.sql` | Add Stage 1b code validation between Stage 1 and Stage 2 |
| `sqlscripting/storedprocedures.sql` | Change Stage 2 dedup exclusion to use `hard_failure_rows` |
| `sqlscripting/storedprocedures.sql` | Remove INNER JOIN attributes guard and error '14' logging from Stage 9 |

### Change 5: Add `invalid_code_rows` to temp table cleanup

**File:** `sqlscripting/storedprocedures.sql`

The `invalid_code_rows` temporary table must be added to all three `DROP TEMPORARY TABLE IF EXISTS` cleanup lists (error handler ~line 1567, success path ~line 3006, and early-exit path ~line 3065).

## Timing

Stage 1b's execution time is folded into `vValidationMs`. No new timing variable needed.

## No UI Changes

Rows with invalid codes will appear in the View Errors page as hard failures (`StemGUID = NULL`) with the specific invalid codes listed in the error description. `RawCodes` preserves the original uploaded string.
