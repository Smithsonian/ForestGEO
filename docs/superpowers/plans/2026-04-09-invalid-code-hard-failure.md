# Invalid Attribute Code Hard Failure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rows with invalid attribute codes should hard-fail during ingestion instead of silently stripping the codes.

**Architecture:** Add early code validation (Stage 1b) to `bulkingestionprocess` between Stage 1 and Stage 2. Rows with any code not in `attributes` are routed to `hard_failure_rows` with a message listing the specific invalid codes. Stage 9 is simplified since all surviving codes are pre-validated.

**Tech Stack:** MySQL stored procedures, TypeScript test harness (mysql2, tsx)

---

### Task 1: Add `INVALID_ATTRIBUTE_CODE` error to seed data

**Goal:** Register the new ingestion error code so the stored procedure can reference it.

**Files:**
- Modify: `frontend/sqlscripting/tablestructures.sql:858`

**Acceptance Criteria:**
- [ ] `INVALID_ATTRIBUTE_CODE` error row exists in `measurement_errors` seed data
- [ ] Existing `('validation', '14', ...)` row is preserved

**Verify:** `grep 'INVALID_ATTRIBUTE_CODE' frontend/sqlscripting/tablestructures.sql` → shows the new row

**Steps:**

- [ ] **Step 1: Add the new error code to the seed INSERT**

In `frontend/sqlscripting/tablestructures.sql`, change:

```sql
       ('ingestion', 'SQL_EXCEPTION', 'Ingestion SQL exception'),
       ('validation', '14', 'Invalid attribute code'),
```

To:

```sql
       ('ingestion', 'SQL_EXCEPTION', 'Ingestion SQL exception'),
       ('ingestion', 'INVALID_ATTRIBUTE_CODE', 'Row contains invalid attribute code(s)'),
       ('validation', '14', 'Invalid attribute code'),
```

- [ ] **Step 2: Commit**

```bash
git add frontend/sqlscripting/tablestructures.sql
git commit -m "Add INVALID_ATTRIBUTE_CODE to measurement_errors seed data"
```

---

### Task 2: Add Stage 1b code validation to `bulkingestionprocess`

**Goal:** Detect and hard-fail rows with invalid attribute codes before deduplication.

**Files:**
- Modify: `frontend/sqlscripting/storedprocedures.sql:1892` (insert new stage after Stage 1)
- Modify: `frontend/sqlscripting/storedprocedures.sql:1910` (fix dedup exclusion)
- Modify: `frontend/sqlscripting/storedprocedures.sql:1567,1794,3003,3062` (add `invalid_code_rows` to cleanup lists)

**Acceptance Criteria:**
- [ ] New Stage 1b validates codes against `attributes` table
- [ ] Rows with any invalid code are routed to `hard_failure_rows` with `INVALID_ATTRIBUTE_CODE`
- [ ] Failure reason lists specific invalid codes (e.g., `"Invalid attribute code(s): I, MX"`)
- [ ] Rows with NULL/empty codes pass through untouched
- [ ] Stage 2 dedup now excludes all `hard_failure_rows`, not just `validation_failures`
- [ ] `invalid_code_rows` temp table is in all cleanup lists

**Verify:** Run the test from Task 3

**Steps:**

- [ ] **Step 1: Add Stage 1b after the `SET vValidationMs` line (~line 1892)**

Insert after `SET vValidationMs = TIMESTAMPDIFF(MICROSECOND, vStageStart, NOW(6)) DIV 1000;` (line 1892) and before the Stage 2 comment:

```sql

    -- ============================================================
    -- STAGE 1b: CODE VALIDATION
    -- ============================================================

    CREATE TEMPORARY TABLE invalid_code_rows AS
    SELECT tm.id,
           LEFT(CONCAT('Invalid attribute code(s): ',
                GROUP_CONCAT(DISTINCT TRIM(jt.code) ORDER BY TRIM(jt.code) SEPARATOR ', ')), 255) AS FailureReason
    FROM temporarymeasurements tm,
    JSON_TABLE(
        CONCAT('["', REPLACE(TRIM(tm.Codes), ';', '","'), '"]'),
        '$[*]' COLUMNS (code VARCHAR(10) COLLATE utf8mb4_0900_ai_ci PATH '$')
    ) jt
    LEFT JOIN attributes a ON a.Code = TRIM(jt.code) AND a.IsActive = 1
    WHERE tm.FileID = vFileID AND tm.BatchID = vBatchID AND tm.CensusID = vCurrentCensusID
      AND tm.id NOT IN (SELECT id FROM validation_failures)
      AND tm.Codes IS NOT NULL AND TRIM(tm.Codes) != ''
      AND a.Code IS NULL
    GROUP BY tm.id;

    CREATE INDEX idx_invalid_code_rows_id ON invalid_code_rows (id);

    INSERT IGNORE INTO hard_failure_rows (SourceRowIndex, ErrorCode, FailureReason)
    SELECT id, 'INVALID_ATTRIBUTE_CODE', FailureReason
    FROM invalid_code_rows;

```

- [ ] **Step 2: Fix Stage 2 dedup exclusion (line ~1910)**

In the `initial_dup_filter` CREATE TABLE, change:

```sql
      AND id NOT IN (SELECT id FROM validation_failures)
```

To:

```sql
      AND id NOT IN (SELECT SourceRowIndex FROM hard_failure_rows)
```

- [ ] **Step 3: Add `invalid_code_rows` to all three DROP TEMPORARY TABLE cleanup lists**

There are three `DROP TEMPORARY TABLE IF EXISTS` blocks that need updating:

1. **Error handler (~line 1567):** Add `invalid_code_rows` after `validation_failures`:
   ```
   classified_filtered, validation_failures, invalid_code_rows, hard_failure_rows, requested_prev_trees,
   ```

2. **Pre-transaction cleanup (~line 1794):** Same change:
   ```
   classified_filtered, validation_failures, invalid_code_rows, hard_failure_rows, requested_prev_trees,
   ```

3. **Success cleanup (~line 3003):** Same change:
   ```
   classified_filtered, validation_failures, invalid_code_rows, hard_failure_rows, requested_prev_trees,
   ```

4. **Early-exit cleanup (~line 3062):** Same change:
   ```
   classified_filtered, validation_failures, invalid_code_rows, hard_failure_rows, requested_prev_trees,
   ```

- [ ] **Step 4: Commit**

```bash
git add frontend/sqlscripting/storedprocedures.sql
git commit -m "Add Stage 1b code validation to bulkingestionprocess

Rows with attribute codes not in the attributes table are now hard-failed
before deduplication. The failure reason lists specific invalid codes.
Also fixes dedup exclusion to use hard_failure_rows instead of just
validation_failures."
```

---

### Task 3: Simplify Stage 9 attribute materialization

**Goal:** Remove redundant invalid-code handling from Stage 9 since codes are now pre-validated.

**Files:**
- Modify: `frontend/sqlscripting/storedprocedures.sql:2909-2920`

**Acceptance Criteria:**
- [ ] `cmattributes` INSERT no longer JOINs against `attributes` (just inserts from `tempcodes` directly)
- [ ] Invalid-code error logging block (ErrorCode `'14'`) is removed
- [ ] `INSERT IGNORE` is retained on `cmattributes`

**Verify:** Run the test from Task 4

**Steps:**

- [ ] **Step 1: Simplify the cmattributes INSERT and remove error logging**

In Stage 9 (~lines 2909–2920), change:

```sql
        INSERT IGNORE INTO cmattributes (CoreMeasurementID, Code)
        SELECT tc.CoreMeasurementID, tc.Code
        FROM tempcodes tc
        INNER JOIN attributes a ON a.Code = tc.Code AND a.IsActive = 1;

        INSERT IGNORE INTO measurement_error_log (MeasurementID, ErrorID, IsResolved)
        SELECT DISTINCT tc.CoreMeasurementID, me.ErrorID, FALSE
        FROM tempcodes tc
        LEFT JOIN attributes a ON a.Code = tc.Code AND a.IsActive = 1
        INNER JOIN measurement_errors me
            ON me.ErrorSource = 'validation' AND me.ErrorCode = '14'
        WHERE a.Code IS NULL;
```

To:

```sql
        INSERT IGNORE INTO cmattributes (CoreMeasurementID, Code)
        SELECT tc.CoreMeasurementID, tc.Code
        FROM tempcodes tc;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/sqlscripting/storedprocedures.sql
git commit -m "Remove redundant invalid-code handling from Stage 9

All codes reaching Stage 9 are now pre-validated by Stage 1b, so the
INNER JOIN against attributes and the error '14' logging are dead code."
```

---

### Task 4: Update and extend `verify-codes.ts` test

**Goal:** Update the existing test to also cover invalid-code hard failure and mixed-code failure.

**Files:**
- Modify: `frontend/tests/benchmarks/verify-codes.ts`

**Acceptance Criteria:**
- [ ] Existing valid-code tests still pass (A, D, A;D)
- [ ] New test: row with all invalid codes (e.g., "MX") hard-fails (`StemGUID IS NULL`)
- [ ] New test: row with mixed codes (e.g., "D;MX") hard-fails entirely
- [ ] New test: failure reason contains the specific invalid code names
- [ ] New test: `measurement_error_log` has `INVALID_ATTRIBUTE_CODE` entry for failed rows

**Verify:** `npx tsx tests/benchmarks/verify-codes.ts` → exits 0 with PASS

**Steps:**

- [ ] **Step 1: Seed the new error code and add invalid-code test rows**

In `verify-codes.ts`, update the error seeding (line ~50) to include the new error:

```typescript
  await conn.query(`INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
    VALUES ('ingestion', 'SQL_EXCEPTION', 'err'),
           ('ingestion', 'INVALID_ATTRIBUTE_CODE', 'Row contains invalid attribute code(s)'),
           ('validation', '14', 'Invalid attribute code')`);
```

Add two more rows to the `temporarymeasurements` INSERT (after the T3 row, line ~92):

```typescript
     (?,?,?,?,'T4','1','ACERRU','Q01',4,4,14,1.3,'2025-06-15','MX',NULL),
     (?,?,?,?,'T5','1','ACERRU','Q01',5,5,15,1.3,'2025-06-15','D;MX',NULL)`,
    [fileID, batchID, plotID, c2, fileID, batchID, plotID, c2, fileID, batchID, plotID, c2,
     fileID, batchID, plotID, c2, fileID, batchID, plotID, c2]
```

- [ ] **Step 2: Add census 1 seed data for T4 and T5**

Extend the seed loop from `i <= 3` to `i <= 5`:

```typescript
  for (let i = 1; i <= 5; i++) {
```

- [ ] **Step 3: Add assertions for T4 (all invalid) and T5 (mixed codes)**

After the existing assertions, add:

```typescript
  // T4: all invalid code "MX" → should hard-fail (StemGUID IS NULL)
  const [t4Failed] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT CoreMeasurementID, RawCodes, Description FROM coremeasurements
     WHERE CensusID=? AND RawTreeTag='T4' AND StemGUID IS NULL`, [c2]
  );
  const t4Pass = t4Failed.length === 1
    && (t4Failed[0].Description as string).includes('MX');
  console.log(`T4 failed: ${t4Failed.length === 1} reason includes MX: ${t4Pass} (expected: true)`);

  // T5: mixed code "D;MX" → should hard-fail entirely (not partial success)
  const [t5Failed] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT CoreMeasurementID, RawCodes, Description FROM coremeasurements
     WHERE CensusID=? AND RawTreeTag='T5' AND StemGUID IS NULL`, [c2]
  );
  const t5Pass = t5Failed.length === 1
    && (t5Failed[0].Description as string).includes('MX');
  console.log(`T5 failed: ${t5Failed.length === 1} reason includes MX: ${t5Pass} (expected: true)`);

  // Verify no cmattributes for T4 or T5
  const [t4t5Attrs] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT ca.Code FROM cmattributes ca
     JOIN coremeasurements cm ON cm.CoreMeasurementID=ca.CoreMeasurementID
     WHERE cm.CensusID=? AND cm.RawTreeTag IN ('T4','T5')`, [c2]
  );
  const noAttrsPass = t4t5Attrs.length === 0;
  console.log(`T4/T5 no attrs: ${noAttrsPass} (expected: true)`);

  // Verify measurement_error_log has INVALID_ATTRIBUTE_CODE for T4 and T5
  const [errorLogRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT cm.RawTreeTag, me.ErrorCode FROM measurement_error_log mel
     JOIN coremeasurements cm ON cm.CoreMeasurementID=mel.MeasurementID
     JOIN measurement_errors me ON me.ErrorID=mel.ErrorID
     WHERE cm.CensusID=? AND me.ErrorCode='INVALID_ATTRIBUTE_CODE'
     ORDER BY cm.RawTreeTag`, [c2]
  );
  const errorLogPass = errorLogRows.length === 2
    && errorLogRows.some((r: any) => r.RawTreeTag === 'T4')
    && errorLogRows.some((r: any) => r.RawTreeTag === 'T5');
  console.log(`Error log entries: ${errorLogRows.length} (expected: 2), pass: ${errorLogPass}`);
```

- [ ] **Step 4: Update the final pass check**

```typescript
  const pass =
    t1Codes.length === 1 && t1Codes[0] === 'A' &&
    t2Codes.length === 1 && t2Codes[0] === 'D' &&
    t3Codes.length === 2 && t3Codes[0] === 'A' && t3Codes[1] === 'D' &&
    t4Pass && t5Pass && noAttrsPass && errorLogPass;
```

- [ ] **Step 5: Run the test**

Run: `cd frontend && npx tsx tests/benchmarks/verify-codes.ts`
Expected: PASS with all assertions true, exit 0

- [ ] **Step 6: Commit**

```bash
git add frontend/tests/benchmarks/verify-codes.ts
git commit -m "Extend verify-codes test for invalid code hard failure

Tests that rows with unknown codes (MX) hard-fail, mixed codes (D;MX)
also fail entirely, and measurement_error_log gets the right entries."
```
