# Integration Testing Guide

This document describes the design choices, architecture, and usage of the ForestGEO integration testing system.

## Overview

Integration tests verify that the backend API calls work correctly with the SQL database, including stored procedure execution and validation logic. Unlike unit tests (which mock dependencies) or E2E tests (which test the full UI), integration tests focus on the **data layer**.

## Design Decisions

### 1. Real MySQL vs Mock Database

**Decision:** Use a real local MySQL instance, not mocks.

**Rationale:**
- Stored procedures contain complex validation logic that cannot be easily mocked
- SQL behavior differences between mock and real databases cause false positives/negatives
- The `bulkingestionprocess` procedure has 800+ lines of logic including temporary tables, transactions, and cross-table joins
- Azure MySQL compatibility is critical; local MySQL 8.0 matches production behavior

### 2. Docker for Local Database

**Decision:** Use Docker Compose to run MySQL locally.

**Rationale:**
- Consistent environment across developer machines
- Easy to spin up/tear down
- No need to install MySQL natively
- Can match production MySQL version exactly (8.0.36)
- Portable to CI/CD environments

### 3. Isolated Test Databases

**Decision:** Each test run creates its own database (`forestgeo_test_{pool_id}`).

**Rationale:**
- Tests don't interfere with each other
- Parallel test execution is safe
- No need to manually clean up between runs
- Database is dropped on teardown

### 4. Schema Loading from SQL Files

**Decision:** Load schema and stored procedures from the actual SQL files in `sqlscripting/`.

**Rationale:**
- Tests always run against current schema
- No schema drift between tests and production
- Changes to stored procedures are automatically tested
- Single source of truth

### 5. Sample Data from sampledata/ Directory

**Decision:** Seed test data from real sample data files (e.g., `sampledata/cocoli/`).

**Rationale:**
- Realistic data structure and relationships
- Covers edge cases found in real data
- Reduces test fixture maintenance

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Test Execution                            │
│  npm run test:integration                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Vitest Test Runner                           │
│  - Runs tests in tests/integration/                          │
│  - Parallel execution per test file                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              local-db-setup.ts                               │
│  - setupTestDatabase(): Create DB, load schema, seed data    │
│  - teardownTestDatabase(): Drop DB, close connection         │
│  - insertTestMeasurements(): Helper for test data            │
│  - runBulkIngestion(): Execute stored procedure              │
│  - verifyIngestionResults(): Check results                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                Docker MySQL Container                        │
│  - mysql:8.0.36                                              │
│  - Port 3306                                                 │
│  - Credentials from env or defaults                          │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
frontend/
├── tests/
│   ├── setup/
│   │   └── local-db-setup.ts      # Database setup utilities
│   └── integration/
│       └── validation-scenarios.integration.test.ts
├── sqlscripting/
│   ├── tablestructures.sql        # Schema definitions
│   └── storedprocedures.sql       # Validation & ingestion logic
├── sampledata/
│   └── cocoli/                    # Sample data files
│       ├── species.txt
│       ├── Quadrat.txt
│       └── TSMAttributes.txt
└── INTEGRATION_TESTING.md         # This file
```

## Usage

### Prerequisites

1. Docker installed and running
2. Node.js 20+
3. npm dependencies installed (`npm install`)

### Starting the Database

```bash
# From project root
docker compose up -d mysql

# Verify it's running
docker compose ps

# Check logs if needed
docker compose logs mysql
```

### Running Tests

```bash
# Run integration tests only
cd frontend
npm run test:integration

# Run with verbose output
npm run test:integration -- --reporter=verbose

# Run a specific test file
npm run test:integration -- validation-scenarios

# Run all tests (unit + integration + component + e2e)
npm run test:all
```

### Stopping the Database

```bash
# Stop container (preserves data)
docker compose stop mysql

# Stop and remove container (preserves volume)
docker compose down

# Stop, remove container, AND delete data
docker compose down -v
```

## Writing Integration Tests

### Basic Test Structure

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupTestDatabase,
  teardownTestDatabase,
  insertTestMeasurements,
  runBulkIngestion
} from '../setup/local-db-setup';

describe('My Integration Test', () => {
  let connection;
  let testData;
  let config;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
  }, 60000); // 60s timeout for DB setup

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  it('should do something', async () => {
    // Insert test data
    const { fileID, batchID } = await insertTestMeasurements(
      connection,
      testData,
      [{ treeTag: 'T001', stemTag: 'S001', ... }]
    );

    // Run ingestion
    const result = await runBulkIngestion(connection, fileID, batchID);

    // Verify results
    expect(result.success).toBe(true);
  });
});
```

### Testing Validation Errors

```typescript
it('should flag invalid species code', async () => {
  // Insert measurement with non-existent species
  await insertTestMeasurements(connection, testData, [{
    treeTag: 'T001',
    stemTag: 'S001',
    speciesCode: 'INVALID_SPECIES',
    // ... other fields
  }]);

  await runBulkIngestion(connection, fileID, batchID);

  // Check cmverrors table for validation error
  const [errors] = await connection.query(
    `SELECT * FROM cmverrors WHERE ValidationErrorID = 3`
  );

  expect(errors.length).toBeGreaterThan(0);
});
```

### Testing Hard Failures

```typescript
it('should reject record with NULL TreeTag', async () => {
  // Insert directly to temporarymeasurements with NULL field
  await connection.query(
    `INSERT INTO temporarymeasurements (..., TreeTag, ...) VALUES (..., NULL, ...)`
  );

  const result = await runBulkIngestion(connection, fileID, batchID);

  expect(result.batch_failed).toBe(true);

  // Check failedmeasurements table
  const [failed] = await connection.query(
    `SELECT * FROM failedmeasurements WHERE FileID = ?`,
    [fileID]
  );

  expect(failed.length).toBeGreaterThan(0);
});
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TEST_DB_HOST` | `localhost` | MySQL host |
| `TEST_DB_PORT` | `3306` | MySQL port |
| `TEST_DB_USER` | `root` | MySQL user |
| `TEST_DB_PASSWORD` | `testpassword` | MySQL password |
| `VITEST_POOL_ID` | `default` | Used for unique DB naming |

## Validation IDs Reference

| ID | Procedure Name | Description |
|----|----------------|-------------|
| 1 | ValidateDBHGrowthExceedsMax | DBH growth >65mm |
| 2 | ValidateDBHShrinkageExceedsMax | DBH shrinkage >5% |
| 3 | ValidateFindAllInvalidSpeciesCodes | Invalid species code |
| 4 | ValidateFindDuplicatedQuadratsByName | Duplicate quadrat names |
| 5 | ValidateFindDuplicateStemTreeTagCombinationsPerCensus | Duplicate tree+stem tags |
| 6 | ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat | Date outside census |
| 7 | ValidateFindStemsInTreeWithDifferentSpecies | Stems with different species |
| 8 | ValidateFindStemsOutsidePlots | Coordinates out of bounds |
| 9 | ValidateFindTreeStemsInDifferentQuadrats | Tree spans quadrats |
| 11 | ValidateScreenMeasuredDiameterMinMax | DBH outside species limits |
| 12 | ValidateScreenStemsWithMeasurementsButDeadAttributes | Dead stem has measurements |
| 13 | ValidateScreenStemsWithMissingMeasurementsButLiveAttributes | Live stem missing DBH |
| 14 | (inline) | Invalid attribute code |
| 20 | (inline) | Species mismatch cross-census |
| 21 | (inline) | Same-batch species conflict |

## Troubleshooting

### Connection Refused

```
Error: connect ECONNREFUSED 127.0.0.1:3306
```

**Solution:** Ensure MySQL container is running:
```bash
docker compose up -d mysql
docker compose ps  # Should show "healthy"
```

### Access Denied

```
Error: Access denied for user 'root'@'...'
```

**Solution:** Check password matches docker-compose.yml:
```bash
# Default password is 'testpassword'
export TEST_DB_PASSWORD=testpassword
```

### Schema Not Found

```
Error: Table 'forestgeo_test_xxx.coremeasurements' doesn't exist
```

**Solution:** Ensure `sqlscripting/tablestructures.sql` exists and is valid SQL.

### Stored Procedure Error

```
Error: PROCEDURE forestgeo_test_xxx.bulkingestionprocess does not exist
```

**Solution:** Check `sqlscripting/storedprocedures.sql` for syntax errors. The file must be valid MySQL 8.0 syntax.

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Integration Tests

on: [push, pull_request]

jobs:
  integration-tests:
    runs-on: ubuntu-latest

    services:
      mysql:
        image: mysql:8.0.36
        env:
          MYSQL_ROOT_PASSWORD: testpassword
          MYSQL_DATABASE: forestgeo_local
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping -h localhost -u root -ptestpassword"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        working-directory: frontend
        run: npm ci

      - name: Run integration tests
        working-directory: frontend
        env:
          TEST_DB_HOST: localhost
          TEST_DB_PASSWORD: testpassword
        run: npm run test:integration
```

## Multi-Census Test Helpers

The `local-db-setup.ts` module provides helpers for testing cross-census validations:

### Creating Additional Censuses

```typescript
import { setupTwoCensusScenario, createAdditionalCensus } from '../setup/local-db-setup';

// Option 1: Use the convenience function for a standard two-census setup
const { census1, census2 } = await setupTwoCensusScenario(connection, testData);

// Option 2: Create censuses manually with custom dates
const census3 = await createAdditionalCensus(connection, testData, {
  plotCensusNumber: 3,
  startDate: '2026-01-01',
  endDate: '2026-12-31'
});
```

### Inserting Historical Data

Use `insertDirectMeasurements` to insert data directly into `coremeasurements` (bypassing bulk ingestion). This is useful for setting up historical data in previous censuses:

```typescript
import { insertDirectMeasurements } from '../setup/local-db-setup';

// Insert historical measurement in census 1
await insertDirectMeasurements(connection, testData, census1.censusID, [
  {
    treeTag: 'T001',
    stemTag: 'S001',
    speciesCode: 'SPECIES1',
    quadratName: 'Q001',
    x: 5.0,
    y: 5.0,
    dbh: 100.0,
    hom: 1.3,
    date: '2024-06-15',
    codes: 'A'
  }
]);
```

### Inserting Test Data for Ingestion

Use `insertTestMeasurements` to insert data into `temporarymeasurements` for bulk ingestion:

```typescript
import { insertTestMeasurements } from '../setup/local-db-setup';

// Insert into census 2 for ingestion testing
const { fileID, batchID } = await insertTestMeasurements(
  connection,
  testData,
  [
    {
      treeTag: 'T001',
      stemTag: 'S001',
      speciesCode: 'SPECIES1',
      quadratName: 'Q001',
      x: 5.0,
      y: 5.0,
      dbh: 200.0, // DBH changed
      hom: 1.3,
      date: '2025-06-15',
      codes: 'A'
    }
  ],
  { censusID: census2.censusID } // Specify target census
);
```

### Querying Validation Results

```typescript
import { getValidationErrors, getFailedMeasurements } from '../setup/local-db-setup';

// Get errors for a specific validation
const errors = await getValidationErrors(connection, {
  validationID: 1,  // DBH growth exceeds max
  treeTag: 'T001'   // Optional: filter by tree
});

// Get failed measurements (hard failures)
const failed = await getFailedMeasurements(connection, { fileID });
```

### Seeding Status Attributes

For tests involving alive/dead status transitions:

```typescript
import { seedStatusAttributes } from '../setup/local-db-setup';

// Seeds standard attribute codes: A, AS, AB, D, DS, DC, DN, M, P, R
await seedStatusAttributes(connection);
```

### Seeding Species with DBH Limits

For testing DBH bounds validation (ValidationID: 11):

```typescript
import { seedSpeciesWithLimits } from '../setup/local-db-setup';

await seedSpeciesWithLimits(connection, [
  { speciesCode: 'SMALL01', speciesName: 'Small Tree', minDBH: 10, maxDBH: 100 },
  { speciesCode: 'LARGE01', speciesName: 'Large Tree', minDBH: 50, maxDBH: 1000 }
]);
```

### Generating Test Data

For bulk testing with random data:

```typescript
import { generateTestMeasurements } from '../setup/local-db-setup';

const measurements = generateTestMeasurements(testData, {
  count: 100,
  treeTagPrefix: 'BULK',
  dbhRange: { min: 50, max: 500 },
  dateRange: { start: '2024-01-01', end: '2024-12-31' }
});
```

## Test File Organization

```
frontend/tests/integration/
├── validation-scenarios.integration.test.ts    # Basic validation checks
└── cross-census-validations.integration.test.ts # Cross-census validation tests
    ├── DBH Growth Validation (ValidationID: 1)
    ├── DBH Shrinkage Validation (ValidationID: 2)
    ├── Species Mismatch Cross-Census (ValidationID: 20)
    ├── Same-Batch Species Conflict (ValidationID: 21)
    ├── Dead Tree Status Transitions
    ├── Quadrat Change Between Censuses (hard failure)
    ├── Coordinate Drift Validation (hard failure)
    ├── DBH Outside Species Limits (ValidationID: 11)
    ├── Invalid Species Code (ValidationID: 3)
    ├── Invalid Attribute Code (ValidationID: 14)
    └── Duplicate Tree+Stem Tag (ValidationID: 5)
```

## Complete Test Listing (36 Tests)

### validation-scenarios.integration.test.ts (21 tests)

#### Hard Failures - Records Rejected

| # | Test Name | Description |
|---|-----------|-------------|
| 1 | should reject records with NULL required fields | Verifies that records with NULL TreeTag are rejected and not inserted into coremeasurements. |
| 2 | should reject records when tree changes quadrat between censuses | Verifies the stored procedure contains quadrat mismatch validation logic. |
| 3 | should reject records with coordinate drift >10m | Verifies the stored procedure contains coordinate drift validation logic with 10m threshold. |

#### Soft Validations - Flagged in cmverrors

| # | Test Name | Description |
|---|-----------|-------------|
| 4 | should flag DBH growth exceeding 65mm (ValidationID: 1) | Verifies ValidationID 1 definition exists for excessive DBH growth detection. |
| 5 | should flag DBH shrinkage exceeding 5% (ValidationID: 2) | Verifies ValidationID 2 definition exists for excessive DBH shrinkage detection. |
| 6 | should flag invalid species codes (ValidationID: 3) | Verifies ValidationID 3 definition exists for invalid species code detection. |
| 7 | should flag measurements outside census date bounds (ValidationID: 6) | Verifies ValidationID 6 definition exists for date bounds validation. |
| 8 | should flag stems outside plot boundaries (ValidationID: 8) | Verifies ValidationID 8 definition exists for spatial boundary validation. |
| 9 | should flag DBH outside species limits (ValidationID: 11) | Verifies ValidationID 11 definition exists for species-specific DBH limits. |
| 10 | should flag invalid attribute codes (ValidationID: 14) | Verifies the stored procedure contains inline validation for invalid attribute codes. |

#### Cross-Census Validations

| # | Test Name | Description |
|---|-----------|-------------|
| 11 | should flag species mismatch across censuses (ValidationID: 20) | Verifies the stored procedure contains species mismatch detection logic. |
| 12 | should flag same-batch species conflicts (ValidationID: 21) | Verifies the stored procedure contains same-batch species conflict detection logic. |

#### End-to-End Ingestion Flow

| # | Test Name | Description |
|---|-----------|-------------|
| 13 | should successfully ingest valid measurements | Verifies valid measurements are processed and inserted into coremeasurements table. |
| 14 | should track validation errors in cmverrors table | Verifies the cmverrors table is queryable and properly stores validation errors. |

#### Validation Procedure Integrity

| # | Test Name | Description |
|---|-----------|-------------|
| 15 | should have all expected validation procedures defined | Verifies all 12 expected validation procedures exist in sitespecificvalidations table. |
| 16 | should have bulkingestionprocess procedure available | Verifies the main bulk ingestion stored procedure exists and is callable. |

#### Tree Dead Then Alive Scenario

| # | Test Name | Description |
|---|-----------|-------------|
| 17 | should detect when dead tree appears alive in subsequent census | Verifies attribute status linking infrastructure exists for dead/alive transitions. |

#### DBH Anomaly Detection

| # | Test Name | Description |
|---|-----------|-------------|
| 18 | should have validation for excessive DBH growth (>65mm) | Verifies ValidationID 1 definition compares present vs past measurements with 65mm threshold. |
| 19 | should have validation for excessive DBH shrinkage (>5%) | Verifies ValidationID 2 definition uses 0.95 factor for shrinkage detection across censuses. |

#### Spatial Validation

| # | Test Name | Description |
|---|-----------|-------------|
| 20 | should validate stems are within plot boundaries | Verifies ValidationID 8 definition checks LocalX/LocalY against plot DimensionX/DimensionY. |
| 21 | should validate coordinate drift threshold of 10m | Verifies the stored procedure uses SQRT/POW for Euclidean distance with 10m threshold. |

---

### cross-census-validations.integration.test.ts (15 tests)

#### DBH Growth Validation (ValidationID: 1)

| # | Test Name | Description |
|---|-----------|-------------|
| 22 | should flag DBH growth exceeding 65mm between censuses | Creates tree with DBH=100mm in census 1 and DBH=200mm in census 2 (100mm growth exceeds threshold). |
| 23 | should NOT flag normal DBH growth under 65mm | **Negative test:** Creates tree with DBH=100mm to 130mm (30mm growth is within threshold). |

#### DBH Shrinkage Validation (ValidationID: 2)

| # | Test Name | Description |
|---|-----------|-------------|
| 24 | should flag DBH shrinkage exceeding 5% between censuses | Creates tree with DBH=200mm in census 1 and DBH=150mm in census 2 (25% shrinkage). |

#### Species Mismatch Cross-Census (ValidationID: 20)

| # | Test Name | Description |
|---|-----------|-------------|
| 25 | should flag species mismatch when tree has different species across censuses | Creates same tree with species1 in census 1 and species2 in census 2. |

#### Same-Batch Species Conflict (ValidationID: 21)

| # | Test Name | Description |
|---|-----------|-------------|
| 26 | should flag when same tree has different species within same batch | Creates two measurements for same tree tag with different species in single batch. |

#### Dead Tree Status Transitions

| # | Test Name | Description |
|---|-----------|-------------|
| 27 | should flag when dead tree appears alive in subsequent census | Creates tree with 'D' (dead) code in census 1 and 'A' (alive) code in census 2. |

#### Quadrat Change Between Censuses (Hard Failure)

| # | Test Name | Description |
|---|-----------|-------------|
| 28 | should reject when tree changes quadrat between censuses | Creates tree in quadrat1 in census 1 and quadrat2 in census 2 - verifies failedmeasurements entry with "Quadrat mismatch" reason. |
| 29 | should NOT reject when tree stays in same quadrat between censuses | **Negative test:** Creates tree in same quadrat across censuses - verifies no quadrat mismatch failure. |

#### Coordinate Drift Validation (Hard Failure)

| # | Test Name | Description |
|---|-----------|-------------|
| 30 | should reject when coordinate drift exceeds 10 meters | Creates stem at (5,5) in census 1 and (20,5) in census 2 (15m drift) - verifies "Coordinate drift" failure. |
| 31 | should NOT reject when coordinate drift is within 10 meters | **Negative test:** Creates stem at (5,5) to (10,8) (~5.8m drift) - verifies no coordinate drift failure. |

#### DBH Outside Species Limits (ValidationID: 11)

| # | Test Name | Description |
|---|-----------|-------------|
| 32 | should flag DBH above species maximum | Creates measurement with DBH=250mm for species SMALL01 (maxDBH=100mm). |
| 33 | should flag DBH below species minimum | Creates measurement with DBH=20mm for species LARGE01 (minDBH=50mm). |

#### Invalid Species Code (ValidationID: 3)

| # | Test Name | Description |
|---|-----------|-------------|
| 34 | should flag non-existent species code | Creates measurement with species code 'DOESNOTEXIST999' that doesn't exist in species table. |

#### Invalid Attribute Code (ValidationID: 14)

| # | Test Name | Description |
|---|-----------|-------------|
| 35 | should flag non-existent attribute code | Creates measurement with attribute code 'INVALIDCODE999' that doesn't exist in attributes table. |

#### Duplicate Tree+Stem Tag (ValidationID: 5)

| # | Test Name | Description |
|---|-----------|-------------|
| 36 | should flag duplicate TreeTag+StemTag combinations in same batch | Creates two measurements with identical TreeTag+StemTag in same ingestion batch. |

---

### Test Categories Summary

| Category | Count | Type |
|----------|-------|------|
| Hard Failure Tests | 6 | Verify records are rejected to failedmeasurements |
| Soft Validation Tests | 14 | Verify errors are flagged in cmverrors |
| Infrastructure Tests | 8 | Verify stored procedures and tables exist |
| Negative Tests | 4 | Prove validations don't false-positive on valid data |
| End-to-End Tests | 4 | Verify complete ingestion flow works |

**Negative tests are critical** - they prove the stored procedure validations work correctly by confirming that valid data (e.g., <10m drift, same quadrat) passes through without triggering failures.

## Future Enhancements

1. **Snapshot testing** - Compare validation results against known-good snapshots
2. **Performance benchmarks** - Track stored procedure execution time
3. **Coverage for all validation IDs** - Ensure every validation has a test
4. **API layer tests** - Test HTTP endpoints against local DB
5. **CI/CD integration** - Run integration tests in GitHub Actions

---

## Code Review Notes (December 2024)

**Status: NEEDS SIGNIFICANT WORK before production-ready**

The following issues were identified during internal code review and should be addressed in future sessions.

---

### 1. CRITICAL: Tests Don't Actually Verify Validation Logic

Most "soft validation" tests are testing the test infrastructure, not the validation logic:

```typescript
// validation-scenarios.integration.test.ts:135
it('should flag DBH growth exceeding 65mm (ValidationID: 1)', async () => {
  const [validations] = await connection.query<RowDataPacket[]>(
    `SELECT * FROM sitespecificvalidations WHERE ValidationID = 1`
  );
  if (validations.length > 0) {
    expect(validations[0].ProcedureName).toBe('ValidateDBHGrowthExceedsMax');
  }
});
```

This doesn't test anything. It checks if a row exists in a table we seeded ourselves. This would pass even if the validation procedure was completely broken.

In `cross-census-validations.integration.test.ts`, tests create data and run ingestion but then:

```typescript
const errors = await getValidationErrors(connection, {
  validationID: 1,
  treeTag: 'GROWTH001'
});
console.log('DBH growth validation errors:', errors);
// No assertion! Just logging!
```

The test passes whether there are 0 errors or 100.

---

### 2. FALSE CONFIDENCE: Tests Pass Because They Assert Nothing

| Test | expect() | console.log() | Verdict |
|------|----------|---------------|---------|
| DBH growth >65mm | 0 | 2 | **USELESS** |
| DBH shrinkage >5% | 0 | 2 | **USELESS** |
| Species mismatch | 0 | 1 | **USELESS** |
| Same-batch conflict | 0 | 1 | **USELESS** |
| Dead tree alive | 0 | 3 | **USELESS** |

These tests will never fail unless there's a SQL syntax error. They're `console.log()` masquerading as tests.

---

### 3. RACE CONDITION: Parallel Tests Share Census Numbers

```typescript
const [censusRows] = await connection.query<RowDataPacket[]>(
  'SELECT MAX(PlotCensusNumber) as maxNum FROM census WHERE PlotID = ?',
  [testData.plots[0].plotID]
);
const nextCensusNum = (censusRows[0].maxNum || 0) + 1;
```

This is a classic TOCTOU (time-of-check-time-of-use) race. If two tests run concurrently on the same database pool, they could both get `maxNum=1`, both try to insert `PlotCensusNumber=2`, and one fails with a duplicate key error.

---

### 4. MISSING: Transaction Rollback for Test Isolation

```typescript
beforeEach(async () => {
  await connection.query('DELETE FROM cmverrors');
  await connection.query('DELETE FROM cmattributes');
  // ... more DELETEs
});
```

This is slow and error-prone. Every test runs 6-7 DELETE queries. The proper pattern is:

```typescript
beforeEach(async () => {
  await connection.query('START TRANSACTION');
});

afterEach(async () => {
  await connection.query('ROLLBACK');
});
```

**Caveat**: The stored procedure uses transactions internally (`START TRANSACTION` / `COMMIT`). Nested transactions in MySQL don't work as expected. Would need savepoints. Should document why DELETE-based cleanup was chosen.

---

### 5. SILENT FAILURES: Tests Skip Instead of Fail

```typescript
if (!speciesCode || !quadratName) {
  console.warn('Skipping: missing species or quadrat data');
  return;  // SILENT PASS!
}
```

This is in multiple tests. If test setup is broken and `testData.species` is empty, the test *passes* instead of failing. Should throw an error instead:

```typescript
if (!speciesCode || !quadratName) {
  throw new Error('Test setup failed: missing species or quadrat data');
}
```

---

### 6. WRONG ASSERTION LOGIC in Negative Tests

```typescript
const [failedDetails] = await connection.query<RowDataPacket[]>(
  'SELECT Tag, FailureReasons FROM failedmeasurements WHERE FileID = ? AND FailureReasons LIKE ?',
  [fileID, '%Coordinate drift%']
);
expect(failedDetails.length).toBe(0);
```

Edge case missed: What if the record failed for a *different* reason but also had coordinate drift? Should also verify the record *succeeded* (is in `coremeasurements`), not just that it didn't fail for one specific reason.

---

### 7. NO CLEANUP OF ORPHAN TEST DATABASES

If tests crash before `afterAll()`, the database `forestgeo_test_xxx` persists forever. After failed test runs, orphan databases accumulate.

Consider: naming convention with timestamps + cleanup script for databases older than 1 hour.

---

### 8. MISSING: Test for ACTUAL Cross-Census Lookup

`insertDirectMeasurements` includes `CensusID` on trees/stems, but never verified that the stored procedure actually *finds* the previous census data. Should add a test that queries what the stored procedure sees.

---

### 9. DOCUMENTATION: "36 Tests" is Inflated

Reality breakdown:
- ~10 tests actually test validation behavior (run data through stored procedure, check results)
- ~8 tests are infrastructure checks (does this table exist? does this procedure exist?)
- ~8 tests are "log and hope" (run ingestion, console.log, no assertions)
- ~4 tests check schema/definition content (does the SQL contain 'GROUP_CONCAT'?)
- ~4 are genuine negative tests (the good ones)

Actual meaningful tests: ~14

---

### 10. MISSING EDGE CASES

| Edge Case | Tested? |
|-----------|---------|
| DBH = exactly 65mm growth (boundary) | No |
| DBH = exactly 5% shrinkage (boundary) | No |
| Coordinate drift = exactly 10.0m (boundary) | No |
| Tree with multiple stems, only one drifts | No |
| Same tree tag, different case (TREE001 vs tree001) | No |
| Measurement date = exactly census boundary | No |
| NULL coordinates (x=NULL, y=5) | No |
| Negative DBH values | No |
| DBH = 0 | No |
| Species code with special chars | No |
| Very long tree tag (VARCHAR limit) | No |
| Unicode in species names | No |
| Concurrent ingestion of same tree | No |

---

### 11. PERFORMANCE: Full Schema Load Per Test Suite

Each `describe()` block runs `setupTestDatabase()` which creates database, loads full schema (28 tables), loads all stored procedures (800+ lines), and seeds sample data.

4 `describe()` blocks across 2 files = 4 full schema loads. That's why tests take 12+ seconds.

Consider: one database per file (not per describe), or schema caching.

---

### Summary Table

| Severity | Issue |
|----------|-------|
| Critical | Most "soft validation" tests don't assert anything |
| Critical | Tests silently skip instead of failing when setup is bad |
| Major | No boundary value tests (65mm, 5%, 10m exactly) |
| Major | Race condition with MAX(PlotCensusNumber) |
| Major | No verification that cross-census lookups work |
| Medium | DELETE-based cleanup is slow |
| Medium | Orphan databases accumulate |
| Medium | Negative tests don't verify success, only absence of one failure type |
| Medium | Test count is inflated by non-testing tests |

**What's good**: The hard failure tests (quadrat mismatch, coordinate drift) are solid. The negative tests proving they don't false-positive are excellent. The infrastructure (Docker, schema loading, stored procedure parsing) works well.

---

## Critical Discovery: Validation Execution Architecture (December 2024)

### Corrected Understanding

Initial investigation incorrectly concluded that validation definitions were "dead code". **This was wrong.**

Validations ARE executed, but through the **API layer post-ingestion**, not during `bulkingestionprocess`.

### The Architecture

Validations are executed in **two phases**:

#### Phase 1: During Ingestion (`bulkingestionprocess`)
- Hard failures (NULL fields, invalid quadrat/species) → `failedmeasurements`
- Inline soft validations (14, 20, 21) → `cmverrors`

#### Phase 2: Post-Ingestion via API
- Route: `/api/validations/procedures/[validationType]`
- Fetches SQL from `sitespecificvalidations.Definition`
- Executes via `runValidation()` in `components/processors/processorhelperfunctions.tsx`
- Inserts errors into `cmverrors`

The `runValidation()` function:
1. Fetches the `Definition` column (SQL text) from `sitespecificvalidations`
2. Replaces placeholders (`@p_CensusID`, `@p_PlotID`, `@validationProcedureID`)
3. Adds schema prefixes to table names
4. Executes the query directly

### Why Integration Tests Failed

The integration tests call `bulkingestionprocess` directly but **do not call the API validation endpoints**. This means:
- Inline validations (14, 20, 21) run during ingestion
- All other validations (1, 2, 3, 5, 6, 7, 8, 9, 11, 12, 13, 15) require a separate API call to execute

### Validation Definitions Source

Validation definitions are loaded from `sqlscripting/corequeries.sql` into `sitespecificvalidations` table.

### Validation Status Matrix

| ValidationID | Name | Execution | Trigger |
|--------------|------|-----------|---------|
| 1 | ValidateDBHGrowthExceedsMax | API | Post-ingestion |
| 2 | ValidateDBHShrinkageExceedsMax | API | Post-ingestion |
| 3 | ValidateFindAllInvalidSpeciesCodes | API | Post-ingestion |
| 4 | ValidateFindDuplicatedQuadratsByName | API | Post-ingestion |
| 5 | ValidateFindDuplicateStemTreeTagCombinations | API | Post-ingestion |
| 6 | ValidateFindMeasurementsOutsideCensusDateBounds | API | Post-ingestion |
| 7 | ValidateFindStemsInTreeWithDifferentSpecies | API | Post-ingestion |
| 8 | ValidateFindStemsOutsidePlots | API | Post-ingestion |
| 9 | ValidateFindTreeStemsInDifferentQuadrats | API | Post-ingestion |
| 11 | ValidateScreenMeasuredDiameterMinMax | API | Post-ingestion |
| 12 | ValidateScreenStemsWithMeasurementsButDeadAttributes | API | Post-ingestion (DISABLED) |
| 13 | ValidateScreenStemsWithMissingMeasurementsButLiveAttributes | API | Post-ingestion (DISABLED) |
| 14 | ValidateFindInvalidAttributeCodes | Inline | During ingestion |
| 15 | ValidateFindAbnormallyHighDBH | API | Post-ingestion |
| 20 | Species mismatch cross-census | Inline | During ingestion |
| 21 | Same-batch species conflict | Inline | During ingestion |

### What Validates Data

1. **Hard failures** (inline in `bulkingestionprocess`):
   - NULL required fields → `failedmeasurements`
   - Invalid quadrat name → `failedmeasurements`
   - Invalid species code → `failedmeasurements`
   - Quadrat mismatch between censuses → `failedmeasurements`
   - Coordinate drift >10m → `failedmeasurements`

2. **Inline soft validations** (during ingestion):
   - ValidationID 14: Invalid attribute codes → `cmverrors`
   - ValidationID 20: Species mismatch cross-census → `cmverrors`
   - ValidationID 21: Same-batch species conflict → `cmverrors`

3. **API-triggered soft validations** (post-ingestion):
   - ValidationID 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 15 (enabled by default)
   - ValidationID 12, 13 (disabled by default - dead/live attribute checks)
   - Triggered via UI "Validate" button or API calls
   - Executed by `runValidation()` function

### Key Files

| File | Purpose |
|------|---------|
| `sqlscripting/corequeries.sql` | Validation SQL definitions |
| `sqlscripting/storedprocedures.sql` | Inline validations in `bulkingestionprocess` |
| `app/api/validations/procedures/[validationType]/route.ts` | API endpoint for running validations |
| `components/processors/processorhelperfunctions.tsx` | `runValidation()` function |

### Integration Test Implications

The current integration tests only test `bulkingestionprocess` directly. To fully test validations:
1. Tests for inline validations (14, 20, 21) work as-is
2. Tests for API validations (1, 2, 3, etc.) need to call `runValidation()` after ingestion

### Files Changed During Investigation

- `cross-census-validations.integration.test.ts` - Fixed console.log → expect() assertions
- `validation-scenarios.integration.test.ts` - Fixed console.log → expect() assertions, fixed silent skips
- Both files now have proper assertions

### Test Data Files

Test CSV files for triggering all validations:
- Location: `/Users/mason/Documents/fgeo_sample_data/SERC/`
- `validation_test_census1.csv` - Baseline data
- `validation_test_census2.csv` - Data with validation violations
- `validation_test_README.md` - Line-by-line documentation

---

## Changelog

### 2024-12-31: Fixed ValidationID 12 Loading Error

**Issue:** ValidationID 12 (ValidateScreenStemsWithMeasurementsButDeadAttributes) was failing to load with a SQL syntax error. The test output showed "13 validation definitions (1 errors)".

**Root Cause:** The `loadValidationDefinitions` parser in `local-db-setup.ts` uses a simple heuristic to detect end-of-statement: `trimmed.endsWith(');')`. ValidationID 12's Definition SQL ended with `);` on its own line, which fooled the parser into thinking the INSERT statement was complete before the actual closing `', '', false);`.

**Fix:** Modified `sqlscripting/corequeries.sql` to put the closing values on the same line as the Definition's final semicolon (matching the pattern used by ValidationID 13 and others).

**Before:**
```sql
  and (@p_PlotID is null or c.PlotID = @p_PlotID);
', '', false);
```

**After:**
```sql
  and (@p_PlotID is null or c.PlotID = @p_PlotID);', '', false);
```

**Result:** All 14 validation definitions now load successfully. ValidationID 12 and 13 are disabled by default (`IsEnabled = false`).

### 2024-12-31: Test Reliability Verification

Comprehensive verification of integration test reliability completed:

**1. Flakiness Check**
- Ran tests 3 consecutive times
- All 36 tests passed consistently (100% pass rate)
- No timing-related failures detected

**2. Mutation Testing**
- Temporarily mutated assertion (expected 0 errors when 1 existed)
- Test correctly failed with `AssertionError: expected 1 to be +0`
- Confirms tests catch real validation failures

**3. Silent Failure Patterns Fixed**
- Found 7 tests with `if (validations.length > 0)` pattern that could silently pass
- Changed to explicit `expect(validations.length).toBeGreaterThan(0)` assertions
- Tests now fail explicitly if validation definitions are missing

**4. Database State Verified**
- Test databases correctly isolated (`forestgeo_test_{pool_id}` pattern)
- All required tables created (28 tables)
- Data flows correctly: temporarymeasurements → trees/stems/coremeasurements
- Validation errors correctly written to cmverrors
- Failed measurements correctly tracked in failedmeasurements
- Seed data (species, quadrats, plots, census) preserved across tests
- Measurement tables correctly cleaned between tests

**5. Assertion Coverage**
- `post-ingestion-validations.integration.test.ts`: 10 tests with strong behavioral assertions
- `cross-census-validations.integration.test.ts`: 5 tests with positive/negative cases
- `validation-scenarios.integration.test.ts`: 21 tests (7 behavioral + 14 infrastructure checks)

**Files Modified:**
- `validation-scenarios.integration.test.ts` - Removed silent failure patterns
