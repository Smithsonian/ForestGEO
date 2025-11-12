# Test Data Files for bulkingestionprocess

**Purpose:** Comprehensive test data sets for validating the fixed `bulkingestionprocess` stored procedure.

**Created:** 2025-11-10
**Total Test Sets:** 10
**Coverage:** ~95% of identified edge cases

---

## Quick Reference

| File                                   | Records | Focus Area                               | Priority  |
| -------------------------------------- | ------- | ---------------------------------------- | --------- |
| `test-set-1-null-fields.csv`           | 5       | NULL required fields                     | ✅ TESTED |
| `test-set-6-date-edge-cases.csv`       | 9       | Date boundaries & validation             | HIGH      |
| `test-set-7-multi-stem-temporal.csv`   | 12      | Multi-stem trees & temporal measurements | CRITICAL  |
| `test-set-8-string-safety.csv`         | 10      | Special characters & Unicode             | HIGH      |
| `test-set-9-numeric-boundaries.csv`    | 11      | Numeric edge cases                       | MEDIUM    |
| `test-set-10-comprehensive-stress.csv` | 20      | Mixed scenarios                          | HIGH      |

---

## Test Set Descriptions

### Test Set 1: NULL Field Validation ✅ TESTED

**File:** `test-set-1-null-fields.csv`
**Records:** 5
**Status:** ✅ Fully tested and passing

**Scenarios:**

- NULL StemTag
- NULL SpeciesCode
- NULL QuadratName
- NULL TreeTag
- Valid baseline

**Expected Results:**

- Valid: 1
- Failed: 4
- Data Loss: 0

**Validation Points:**

- ✅ NULL required fields caught
- ✅ Specific error messages provided
- ✅ No data loss

---

### Test Set 6: Date Edge Cases

**File:** `test-set-6-date-edge-cases.csv`
**Records:** 9
**Status:** ⏳ Ready for testing

**Scenarios:**

- NULL date (should fail)
- `1900-01-01` placeholder date (converts to NULL)
- Future dates (2099, 2199)
- Very old date (1850)
- Leap year (2020-02-29)
- Year boundaries (Jan 1, Dec 31)
- Normal valid date

**Expected Results:**

- Valid: 8
- Failed: 1 (NULL date)
- Data Loss: 0

**Validation Points:**

- [ ] NULL date rejected with error message
- [ ] `1900-01-01` converts to NULL (intentional design)
- [ ] Future dates accepted (or rejected per business rules)
- [ ] Leap year handled correctly
- [ ] Year boundaries handled correctly

**Business Rules to Clarify:**

- Should future dates be rejected?
- Should dates before 1900 be rejected?
- Is `1900-01-01` → NULL conversion acceptable?

---

### Test Set 7: Multi-Stem & Temporal Measurements ✅ PARTIALLY TESTED

**File:** `test-set-7-multi-stem-temporal.csv`
**Records:** 12
**Status:** ✅ Critical scenarios tested

**Scenarios:**

- Multi-stem tree (4 stems, same TreeTag)
- Temporal measurements (4 months, same tree/stem)
- Multi-stem temporal (2 stems over 2 months)

**Expected Results:**

- Valid: 12 (ALL should be valid)
- Failed: 0
- Data Loss: 0

**Validation Points:**

- ✅ Multi-stem trees NOT treated as duplicates
- ✅ Temporal measurements preserved
- [ ] Multi-stem temporal combinations work

**Critical:** These scenarios MUST NOT be flagged as duplicates!

---

### Test Set 8: String Safety & Special Characters

**File:** `test-set-8-string-safety.csv`
**Records:** 10
**Status:** ⏳ Ready for testing

**Scenarios:**

- Apostrophes in tags (`O'Malley`)
- Double quotes in comments
- Unicode (Chinese, Russian characters)
- Empty strings
- Whitespace-only strings
- Semicolons (code delimiter)
- Newlines in comments
- Very long comments (>255 chars)
- Normal ASCII baseline

**Expected Results:**

- Valid: 6-7 (depends on Unicode support)
- Failed: 2-3 (empty/whitespace strings)
- Data Loss: 0

**Validation Points:**

- [ ] SQL injection safety (apostrophes handled)
- [ ] Unicode characters supported
- [ ] Empty/whitespace strings rejected
- [ ] Long strings truncated or rejected gracefully
- [ ] Special delimiters don't break parsing

**Security Note:** SQL injection attempts should be safely escaped by MySQL parameter binding.

---

### Test Set 9: Numeric Boundaries

**File:** `test-set-9-numeric-boundaries.csv`
**Records:** 11
**Status:** ⏳ Ready for testing

**Scenarios:**

- Both DBH and HOM NULL (with/without codes)
- Both DBH and HOM zero (with/without codes)
- Extreme values near decimal(12,6) limits
- Zero coordinates (0,0)
- NULL coordinates
- Very small values (0.001)
- Maximum precision (6 decimal places)

**Expected Results:**

- Valid: 8-9 (depends on business rules for NULL DBH/HOM)
- Failed: 1-2 (both zero without codes)
- Data Loss: 0

**Validation Points:**

- [ ] Both DBH and HOM NULL handling (business rule dependent)
- [ ] Both zero without codes rejected
- [ ] Both zero WITH codes accepted
- [ ] Extreme values within limits accepted
- [ ] Precision preserved
- [ ] Zero coordinates acceptable

**Business Rules to Clarify:**

- Is NULL DBH and NULL HOM without codes acceptable?
- Are zero coordinates (0,0) valid?

---

### Test Set 10: Comprehensive Stress Test

**File:** `test-set-10-comprehensive-stress.csv`
**Records:** 20
**Status:** ⏳ Ready for testing

**Scenarios:** Mixed batch with ALL failure types:

- Valid records (various)
- NULL field violations
- Duplicates (3 exact copies)
- Negative values (DBH, HOM)
- Multi-stem trees
- Temporal measurements
- Future dates
- Zero values with/without codes
- NULL measurements
- Special characters

**Expected Results:**

- Valid: 12-13
- Failed: 7-8
- Data Loss: 0

**Validation Points:**

- [ ] All failure types correctly categorized
- [ ] No interference between validation rules
- [ ] Audit trail complete (uploadintegrityalerts)
- [ ] Performance acceptable (< 5 seconds)

---

## How to Use These Test Files

### Method 1: Manual SQL INSERT

```sql
-- Clean test data
DELETE cm FROM coremeasurements cm JOIN stems s ON cm.StemGUID = s.StemGUID JOIN trees t ON s.TreeID = t.TreeID WHERE t.TreeTag LIKE 'TEST-%';
DELETE FROM stems WHERE TreeID IN (SELECT TreeID FROM trees WHERE TreeTag LIKE 'TEST-%');
DELETE FROM trees WHERE TreeTag LIKE 'TEST-%';
DELETE FROM failedmeasurements WHERE Tag LIKE 'TEST-%';
DELETE FROM temporarymeasurements WHERE TreeTag LIKE 'TEST-%';

-- Insert from CSV (example for test-set-6)
LOAD DATA LOCAL INFILE '/path/to/test-set-6-date-edge-cases.csv'
INTO TABLE temporarymeasurements
FIELDS TERMINATED BY ','
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 ROWS
(TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Comments)
SET FileID = 'test-set-6',
    BatchID = 'batch-1',
    PlotID = 1,
    CensusID = 2;

-- Run procedure
CALL bulkingestionprocess('test-set-6', 'batch-1');

-- Verify results
SELECT
    COUNT(*) as Input,
    (SELECT COUNT(*) FROM coremeasurements cm JOIN stems s ON cm.StemGUID = s.StemGUID JOIN trees t ON s.TreeID = t.TreeID WHERE t.TreeTag LIKE 'TEST-DATE-%') as Valid,
    (SELECT COUNT(*) FROM failedmeasurements WHERE Tag LIKE 'TEST-DATE-%') as Failed;
```

### Method 2: Via Upload System (Recommended)

1. Use the frontend upload interface
2. Select CSV file
3. Choose PlotID = 1, CensusID = 2
4. Upload
5. Review results in uploaddatalossreport

### Method 3: Automated Test Script

```bash
#!/bin/bash
for testfile in test-set-*.csv; do
    echo "Testing $testfile..."
    # Your upload script here
    # Verify results
    # Generate report
done
```

---

## Expected Test Results Summary

| Test Set              | Input  | Expected Valid | Expected Failed | Expected Loss |
| --------------------- | ------ | -------------- | --------------- | ------------- |
| Set 1: NULL fields    | 5      | 1              | 4               | 0             |
| Set 6: Dates          | 9      | 8              | 1               | 0             |
| Set 7: Multi/Temporal | 12     | 12             | 0               | 0             |
| Set 8: Strings        | 10     | 6-7            | 3-4             | 0             |
| Set 9: Numeric        | 11     | 8-9            | 2-3             | 0             |
| Set 10: Stress        | 20     | 12-13          | 7-8             | 0             |
| **TOTAL**             | **67** | **47-50**      | **17-20**       | **0**         |

**Critical Success Criteria:** Data Loss = 0 for ALL test sets

---

## Validation Checklist

After running each test set:

- [ ] **Data Accountability:** Input count = Valid count + Failed count
- [ ] **Zero Data Loss:** No records lost/unaccounted for
- [ ] **Specific Error Messages:** All failed records have FailureReasons
- [ ] **Audit Trail:** uploadintegrityalerts populated
- [ ] **Metrics Logged:** uploadmetrics entry created
- [ ] **No Batch Failures:** Procedure completes without SQL exception
- [ ] **Performance:** Processing time < 10 seconds for test sets

---

## Known Limitations

1. **Hash Constraint on failedmeasurements:**
   - Multiple identical failures map to single record
   - Use uploadintegrityalerts for true counts

2. **temporarymeasurements Schema Limits:**
   - Fields have same varchar limits as target tables
   - Very long strings can't be inserted for testing
   - String length validation is safety net for edge cases

3. **Business Rules Pending:**
   - Date range validation (future/old dates)
   - NULL DBH and NULL HOM acceptance criteria
   - Same-date different-DBH handling

---

## Troubleshooting

### Data Loss Detected

1. Check temporarymeasurements for orphaned records
2. Check procedure logs in uploadintegrityalerts
3. Verify hash collisions in failedmeasurements
4. Review procedure error handler output

### Unexpected Failures

1. Verify reference data (species, quadrats) is active
2. Check collation settings (should be utf8mb4_0900_ai_ci)
3. Review validation logic in procedure
4. Check for schema changes

### Performance Issues

1. Verify indexes on temporarymeasurements
2. Check batch size (keep under 1000 records)
3. Review temporary table creation time
4. Monitor MySQL server load

---

## Additional Test Scenarios (Not Yet Implemented)

### High Priority

- Cross-census linking (requires census 1 data setup)
- Very large batches (1000+ records)
- Inactive quadrat validation
- Case sensitivity verification

### Medium Priority

- Code formatting edge cases (multiple semicolons, spaces)
- Extreme precision numeric values
- Concurrent batch processing

### Low Priority

- Non-standard date formats (would fail at MySQL level)
- Invalid characters in quadrat names
- Performance benchmarking

---

## Contributing New Test Cases

When adding new test scenarios:

1. **Create descriptive CSV filename:** `test-set-##-description.csv`
2. **Include header row:** Column names matching temporarymeasurements
3. **Add comments column:** Explain what each record tests
4. **Use TEST- prefix:** For easy cleanup (`DELETE FROM ... WHERE Tag LIKE 'TEST-%'`)
5. **Document expected results:** Valid/Failed counts
6. **Update this README:** Add to table and descriptions

---

## References

- Main test report: `COMPREHENSIVE_TEST_REPORT.md`
- Edge case analysis: `UNTESTED_EDGE_CASES_ANALYSIS.md`
- Critical findings: `CRITICAL_EDGE_CASE_TEST_RESULTS.md`
- Fixed procedure: `bulkingestionprocess_FIXED_FINAL.sql`

---

**Last Updated:** 2025-11-10
**Total Test Records Available:** 67
**Estimated Test Coverage:** ~95% of identified edge cases
