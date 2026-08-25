/**
 * Cross-Census Validation Integration Tests
 *
 * This file tests HARD FAILURES and INLINE validations that run during bulkingestionprocess.
 *
 * Hard Failures (reject records):
 * - Quadrat change between censuses (trees can't move)
 * - Coordinate drift >10m within same quadrat
 *
 * Inline Validations (accept but flag in measurement_error_log):
 * - ValidationID 14: Invalid attribute code
 * - ValidationID 20: Species mismatch across censuses
 * - ValidationID 21: Same-batch species conflict
 *
 * NOTE: ValidationIDs 1 and 2 run post-ingestion via the validation framework.
 * ValidationIDs 20 and 21 are inline soft validations emitted by bulkingestionprocess.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestMeasurements,
  insertTestMeasurements,
  insertDirectMeasurements,
  runBulkIngestion,
  runValidationForTest,
  getValidationErrors,
  getFailedMeasurements,
  getTreeState,
  getTreeStatesForBatch,
  seedStatusAttributes,
  setupTwoCensusScenario,
  type TestData,
  type CensusInfo
} from '../setup/local-db-setup';
import type { Connection, RowDataPacket } from 'mysql2/promise';

describe('Hard Failure Validation Tests', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let census1: CensusInfo;
  let census2: CensusInfo;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;

    // Set up two censuses for cross-census tests
    const scenario = await setupTwoCensusScenario(connection, testData);
    census1 = scenario.census1;
    census2 = scenario.census2;
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    // Clean up and preserve the two census records created in beforeAll
    await cleanupTestMeasurements(connection, testData, { preserveCensusCount: 2 });
  });

  describe('Quadrat Change Between Censuses', () => {
    /**
     * Scenario: Same tree appears in different quadrats between censuses
     * Expected: Hard failure - trees can't move between quadrats
     */
    it('should reject when tree changes quadrat between censuses', async () => {
      if (testData.quadrats.length < 2) {
        throw new Error('Test setup failed: need at least 2 quadrats for this test');
      }

      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadrat1 = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;
      const quadrat2 = testData.quadrats[1]?.QuadratName || testData.quadrats[1]?.Quadrat;

      if (!speciesCode || !quadrat1 || !quadrat2) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Census 1: Tree in quadrat1
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'MOVTREE001',
          stemTag: 'S001',
          speciesCode,
          quadratName: quadrat1,
          x: 5.0,
          y: 5.0,
          dbh: 100.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      // Census 2: Same tree in quadrat2 (impossible!)
      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'MOVTREE001',
            stemTag: 'S001',
            speciesCode,
            quadratName: quadrat2, // Different quadrat!
            x: 5.0,
            y: 5.0,
            dbh: 105.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          }
        ],
        { censusID: census2.censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);

      // Check uploadintegrityalerts for validation failure
      const [alerts] = await connection.query<RowDataPacket[]>('SELECT type, message, severity FROM uploadintegrityalerts WHERE fileID = ?', [fileID]);

      // Check for failed measurements (coremeasurements with StemGUID IS NULL + ingestion errors)
      const failedDetails = await getFailedMeasurements(connection, { fileID });

      // The stored procedure puts cross-census validation failures in coremeasurements
      // with StemGUID IS NULL and logs errors in measurement_error_log.
      // Check that the record was flagged as a failure with the correct reason
      expect(failedDetails.length).toBeGreaterThan(0);
      expect(failedDetails[0].FailureReasons).toContain('Quadrat mismatch');

      // Check that the upload alert was created
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].type).toBe('CROSS_CENSUS_VALIDATION_FAILURE');

      // The message should indicate a failure occurred
      expect(result.message).toContain('failed');
    });

    /**
     * NEGATIVE TEST: Same quadrat across censuses should NOT trigger validation failure
     * This proves the validation is actually checking the condition, not always failing
     */
    it('should NOT reject when tree stays in same quadrat between censuses', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Census 1: Tree in quadratName
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'STAYTREE001',
          stemTag: 'S001',
          speciesCode,
          quadratName, // Same quadrat
          x: 5.0,
          y: 5.0,
          dbh: 100.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      // Census 2: Same tree in SAME quadrat (should NOT fail)
      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'STAYTREE001',
            stemTag: 'S001',
            speciesCode,
            quadratName, // SAME quadrat - no mismatch!
            x: 5.0,
            y: 5.0,
            dbh: 105.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          }
        ],
        { censusID: census2.censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);

      // Check that NO quadrat mismatch failure was recorded
      const failedDetails = await getFailedMeasurements(connection, { fileID });
      const quadratMismatchFailures = failedDetails.filter(f => f.FailureReasons?.includes('Quadrat mismatch'));

      // Should NOT have any quadrat mismatch failures
      expect(quadratMismatchFailures.length).toBe(0);

      // ASSERTION: Record should not hard-fail for valid same-quadrat data
      expect(result.batch_failed, `Unexpected batch failure: ${result.message}`).toBe(false);
    });
  });

  describe('Coordinate Drift Validation', () => {
    /**
     * Scenario: Same stem has coordinates that differ by >10m between censuses
     * Expected: Hard failure - coordinate drift exceeds threshold
     */
    it('should reject when coordinate drift exceeds 10 meters', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Census 1: Stem at position (5, 5)
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'DRIFT001',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 5.0,
          y: 5.0,
          dbh: 100.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      // Census 2: Same stem at position (20, 5) - 15m drift exceeds 10m threshold
      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'DRIFT001',
            stemTag: 'S001',
            speciesCode,
            quadratName,
            x: 20.0, // 15m away from original position
            y: 5.0,
            dbh: 105.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          }
        ],
        { censusID: census2.censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);

      // Check failed measurements for drift detection
      const failed = await getFailedMeasurements(connection, { fileID });

      // Check upload alerts
      const [alerts] = await connection.query<RowDataPacket[]>('SELECT type, message FROM uploadintegrityalerts WHERE fileID = ?', [fileID]);

      // The stored procedure puts cross-census validation failures in coremeasurements
      // with StemGUID IS NULL and logs errors in measurement_error_log
      expect(failed.length).toBeGreaterThan(0);
      expect(failed[0].FailureReasons).toBeDefined();
      expect(failed[0].FailureReasons.toLowerCase()).toContain('coordinate');

      // Check that the upload alert was created
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].type).toBe('CROSS_CENSUS_VALIDATION_FAILURE');

      // The message should indicate a failure occurred
      expect(result.message).toContain('failed');
    });

    /**
     * NEGATIVE TEST: Coordinate drift within threshold should NOT trigger validation failure
     * This proves the validation is actually checking the 10m threshold, not always failing
     */
    it('should NOT reject when coordinate drift is within 10 meters', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Census 1: Stem at position (5, 5)
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'SMALLDRIFT001',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 5.0,
          y: 5.0,
          dbh: 100.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      // Census 2: Same stem at position (10, 8) - 6.4m drift (within 10m threshold)
      // sqrt((10-5)^2 + (8-5)^2) = sqrt(25 + 9) = sqrt(34) ≈ 5.83m
      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'SMALLDRIFT001',
            stemTag: 'S001',
            speciesCode,
            quadratName,
            x: 10.0, // 5m difference
            y: 8.0, // 3m difference - total drift ~5.83m (within 10m)
            dbh: 105.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          }
        ],
        { censusID: census2.censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);

      // Check that NO coordinate drift failure was recorded
      const failedDetails = await getFailedMeasurements(connection, { fileID });
      const coordinateDriftFailures = failedDetails.filter(f => f.FailureReasons?.toLowerCase().includes('coordinate'));

      // Should NOT have any coordinate drift failures
      expect(coordinateDriftFailures.length).toBe(0);

      // ASSERTION: Record should not hard-fail for valid small-drift data
      expect(result.batch_failed, `Unexpected batch failure: ${result.message}`).toBe(false);
    });

    /**
     * BOUNDARY TEST: Coordinate drift of exactly 10.0 meters
     * sqrt(6^2 + 8^2) = sqrt(36 + 64) = sqrt(100) = 10.0m exactly
     * Expected: Exactly 10m should NOT trigger (validation is for >10m)
     */
    it('should NOT reject when coordinate drift is exactly 10 meters (boundary test)', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Census 1: Stem at position (0, 0)
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'EXACT10M',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 0.0,
          y: 0.0,
          dbh: 100.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      // Census 2: Position (6, 8) gives exactly 10m drift
      // sqrt(6^2 + 8^2) = sqrt(36 + 64) = sqrt(100) = 10.0m exactly
      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'EXACT10M',
            stemTag: 'S001',
            speciesCode,
            quadratName,
            x: 6.0,
            y: 8.0,
            dbh: 105.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          }
        ],
        { censusID: census2.censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);

      // Check for coordinate drift failure
      const failedDetails = await getFailedMeasurements(connection, { fileID });
      const coordinateFailures = failedDetails.filter(f => f.FailureReasons?.toLowerCase().includes('coordinate'));

      // Exactly 10m should NOT trigger - validation is for EXCEEDS (>10m)
      expect(coordinateFailures.length).toBe(0);
      expect(result.batch_failed, `Unexpected batch failure: ${result.message}`).toBe(false);
    });

    /**
     * BOUNDARY TEST: Coordinate drift of 10.01 meters (just over threshold)
     * This confirms the validation triggers at the boundary.
     */
    it('should reject when coordinate drift is 10.01 meters (just over boundary)', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Census 1: Stem at position (0, 0)
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'OVER10M',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 0.0,
          y: 0.0,
          dbh: 100.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      // Census 2: Position (6.005, 8.005) gives ~10.01m drift
      // sqrt(6.005^2 + 8.005^2) ≈ 10.01m
      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'OVER10M',
            stemTag: 'S001',
            speciesCode,
            quadratName,
            x: 6.005,
            y: 8.005,
            dbh: 105.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          }
        ],
        { censusID: census2.censusID }
      );

      await runBulkIngestion(connection, fileID, batchID);

      // Check for coordinate drift failure
      const failedDetails = await getFailedMeasurements(connection, { fileID });
      const coordinateFailures = failedDetails.filter(f => f.FailureReasons?.toLowerCase().includes('coordinate'));

      // 10.01m SHOULD trigger - just over threshold
      expect(coordinateFailures.length).toBeGreaterThan(0);
    });
  });
});

describe('Inline Validation Data Tests', () => {
  /**
   * NOTE: Most soft validations (3, 5, 11) run POST-INGESTION via the API layer.
   * Tests for these are in: tests/integration/post-ingestion-validations.integration.test.ts
   *
   * ValidationIDs 14, 20, and 21 run INLINE during bulkingestionprocess.
   */
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let census1: CensusInfo;
  let census2: CensusInfo;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;

    // Set up two censuses for cross-census tests
    const scenario = await setupTwoCensusScenario(connection, testData);
    census1 = scenario.census1;
    census2 = scenario.census2;
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    // Clean up and preserve the two census records created in beforeAll
    await cleanupTestMeasurements(connection, testData, { preserveCensusCount: 2 });
  });

  describe('Invalid Attribute Code (ValidationID: 14)', () => {
    it('should flag non-existent attribute code', async () => {
      // ValidationID 14 is a soft, post-ingestion validation: bulkingestionprocess drops
      // the unknown code (preserving it in coremeasurements.RawCodes) without flagging it
      // inline; the runner produces the error by parsing RawCodes. Ingest, then validate.
      // The code MUST be <= 10 chars: ValidationID 14 parses RawCodes via
      // json_table(... code varchar(10) ...), so under STRICT_TRANS_TABLES a longer token
      // is silently skipped (real attribute codes are <= 10 chars — attributes.Code).
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Insert measurement with invalid attribute code
      const { fileID, batchID } = await insertTestMeasurements(connection, testData, [
        {
          treeTag: 'BADCODE001',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 12.0,
          y: 12.0,
          dbh: 100.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'NOSUCH' // invalid attribute code (<= 10 chars; see note above)
        }
      ]);

      await runBulkIngestion(connection, fileID, batchID);
      await runValidationForTest(connection, 14);

      // Check for ValidationID 14 error (invalid attribute code)
      const errors = await getValidationErrors(connection, { validationID: 14 });

      // ASSERTION: Non-existent attribute code should trigger ValidationID 14
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].ValidationErrorID).toBe(14);
    });
  });

  describe('Species Mismatch Cross-Census (ValidationID: 20)', () => {
    /**
     * Scenario: Tree is recorded with Species A in census 1, then Species B in census 2.
     * This is biologically impossible (trees don't change species) and indicates data error.
     * Expected: Soft validation error (record accepted, flagged in measurement_error_log)
     */
    it('should flag when tree has different species across censuses', async () => {
      // Need at least 2 species
      const species1Code = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const species2Code = testData.species[1]?.SpeciesCode || testData.species[1]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!species1Code || !species2Code || !quadratName) {
        throw new Error('Test setup failed: need at least 2 species and 1 quadrat');
      }

      // Insert tree with species1 in census 1 (directly into coremeasurements)
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'SPMISMATCH01',
          stemTag: 'S001',
          speciesCode: species1Code,
          quadratName,
          x: 8.0,
          y: 8.0,
          dbh: 100.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      // Insert same tree with species2 in census 2 (via bulk ingestion)
      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'SPMISMATCH01', // Same tree
            stemTag: 'S001',
            speciesCode: species2Code, // Different species!
            quadratName,
            x: 8.0,
            y: 8.0,
            dbh: 120.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          }
        ],
        { censusID: census2.censusID }
      );

      await runBulkIngestion(connection, fileID, batchID);

      // Check for ValidationID 20 error (species mismatch cross-census)
      const errors = await getValidationErrors(connection, { validationID: 20 });

      // ASSERTION: Different species for same tree across censuses should trigger ValidationID 20
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].ValidationErrorID).toBe(20);
    });
  });

  describe('Same-Batch Species Conflict (ValidationID: 21)', () => {
    /**
     * Scenario: Same tree tag appears twice in the same batch with different species.
     * This is definitely a data entry error.
     * Expected: Soft validation error (flagged in measurement_error_log)
     */
    it('should flag when same tree has different species within same batch', async () => {
      // Need at least 2 species
      const species1Code = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const species2Code = testData.species[1]?.SpeciesCode || testData.species[1]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!species1Code || !species2Code || !quadratName) {
        throw new Error('Test setup failed: need at least 2 species and 1 quadrat');
      }

      // Insert two measurements for same tree with different species in same batch
      const { fileID, batchID } = await insertTestMeasurements(connection, testData, [
        {
          treeTag: 'BATCHCONFLICT01',
          stemTag: 'S001',
          speciesCode: species1Code,
          quadratName,
          x: 10.0,
          y: 10.0,
          dbh: 100.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        },
        {
          treeTag: 'BATCHCONFLICT01', // Same tree tag
          stemTag: 'S002', // Different stem
          speciesCode: species2Code, // Different species - CONFLICT!
          quadratName,
          x: 10.0,
          y: 10.5,
          dbh: 80.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      await runBulkIngestion(connection, fileID, batchID);

      // Check for ValidationID 21 error (same-batch species conflict)
      const errors = await getValidationErrors(connection, { validationID: 21 });

      // ASSERTION: Same tree with different species in same batch should trigger ValidationID 21
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].ValidationErrorID).toBe(21);
    });
  });

  describe('Invalid Species Code (ValidationID: 3)', () => {
    /**
     * Scenario: Measurement uses a species code that doesn't exist in the species table.
     * Expected: Record is ingested but flagged with ValidationID 3
     *
     * NOTE: This may be handled as a hard failure during ingestion (rejected to coremeasurements with StemGUID IS NULL)
     * rather than a soft validation, depending on stored procedure implementation.
     */
    it('should flag non-existent species code', async () => {
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!quadratName) {
        throw new Error('Test setup failed: missing quadrat data');
      }

      // Insert measurement with non-existent species code
      const { fileID, batchID } = await insertTestMeasurements(connection, testData, [
        {
          treeTag: 'BADSPECIES01',
          stemTag: 'S001',
          speciesCode: 'DOESNOTEXIST999', // Invalid species code
          quadratName,
          x: 15.0,
          y: 15.0,
          dbh: 100.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      await runBulkIngestion(connection, fileID, batchID);

      // Check for either: ValidationID 3 error OR hard failure
      const errors = await getValidationErrors(connection, { validationID: 3 });
      const failed = await getFailedMeasurements(connection, { fileID });

      // ASSERTION: Invalid species should be flagged (soft) or rejected (hard)
      const wasHandled = errors.length > 0 || failed.length > 0;
      expect(wasHandled).toBe(true);

      // If it was a soft error, verify the ValidationID
      if (errors.length > 0) {
        expect(errors[0].ValidationErrorID).toBe(3);
      }
      // If it was a hard failure, verify failure reason mentions species
      if (failed.length > 0) {
        expect(failed[0].FailureReasons?.toLowerCase()).toContain('species');
      }
    });
  });
});

describe('Tree State Categorization Tests', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let census1: CensusInfo;
  let census2: CensusInfo;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;

    const scenario = await setupTwoCensusScenario(connection, testData);
    census1 = scenario.census1;
    census2 = scenario.census2;
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData, { preserveCensusCount: 2 });
  });

  describe('Old Tree Detection', () => {
    /**
     * Scenario: Tree+stem exists in census 1, same tree+stem uploaded in census 2.
     * Expected: treestemstate = 'old tree'
     */
    it('should classify as old tree when tree+stem exists in previous census', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Census 1: Insert tree OLDTREE01 with stem S001
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'OLDTREE01',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 5.0,
          y: 5.0,
          dbh: 100.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      // Census 2: Same tree+stem via bulk ingestion
      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'OLDTREE01',
            stemTag: 'S001',
            speciesCode,
            quadratName,
            x: 5.0,
            y: 5.0,
            dbh: 110.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          }
        ],
        { censusID: census2.censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);
      expect(result.batch_failed, `Unexpected failure: ${result.message}`).toBe(false);

      const treeState = await getTreeState(connection, batchID, 'OLDTREE01');
      expect(treeState).toBe('old tree');
    });
  });

  describe('Multi Stem Detection', () => {
    /**
     * Scenario: Tree exists in census 1 with stem S001, uploaded in census 2 with new stem S002.
     * Expected: treestemstate = 'multi stem'
     */
    it('should classify as multi stem when tree exists but stem is new', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Census 1: Tree with stem S001
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'MULTISTEM01',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 5.0,
          y: 5.0,
          dbh: 100.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      // Census 2: Same tree, NEW stem S002 via bulk ingestion
      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'MULTISTEM01',
            stemTag: 'S002', // Different stem tag
            speciesCode,
            quadratName,
            x: 5.5,
            y: 5.5,
            dbh: 80.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          }
        ],
        { censusID: census2.censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);
      expect(result.batch_failed, `Unexpected failure: ${result.message}`).toBe(false);

      const treeState = await getTreeState(connection, batchID, 'MULTISTEM01');
      expect(treeState).toBe('multi stem');
    });
  });

  describe('New Recruit Detection', () => {
    /**
     * Scenario: Tree not in any prior census, uploaded fresh.
     * Expected: treestemstate = 'new recruit'
     */
    it('should classify as new recruit when tree has no prior census history', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Census 2 only: New tree, no census 1 history
      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'NEWRECRUIT01',
            stemTag: 'S001',
            speciesCode,
            quadratName,
            x: 10.0,
            y: 10.0,
            dbh: 50.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          }
        ],
        { censusID: census2.censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);
      expect(result.batch_failed, `Unexpected failure: ${result.message}`).toBe(false);

      const treeState = await getTreeState(connection, batchID, 'NEWRECRUIT01');
      expect(treeState).toBe('new recruit');
    });
  });

  describe('Mixed Batch Categorization', () => {
    /**
     * Scenario: One batch contains an old tree, a multi stem, and a new recruit.
     * Expected: Each gets its correct treestemstate.
     */
    it('should correctly categorize all three types in a single batch', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Census 1: Set up old tree (tree+stem) and multi stem tree (tree only, different stem)
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'MIXOLD01',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 1.0,
          y: 1.0,
          dbh: 100.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        },
        {
          treeTag: 'MIXMULTI01',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 2.0,
          y: 2.0,
          dbh: 90.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      // Census 2: old tree (same stem), multi stem (new stem), new recruit (no history)
      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'MIXOLD01',
            stemTag: 'S001', // Same stem as census 1
            speciesCode,
            quadratName,
            x: 1.0,
            y: 1.0,
            dbh: 110.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          },
          {
            treeTag: 'MIXMULTI01',
            stemTag: 'S002', // NEW stem for existing tree
            speciesCode,
            quadratName,
            x: 2.5,
            y: 2.5,
            dbh: 60.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          },
          {
            treeTag: 'MIXNEW01',
            stemTag: 'S001', // Brand new tree
            speciesCode,
            quadratName,
            x: 3.0,
            y: 3.0,
            dbh: 40.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          }
        ],
        { censusID: census2.censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);
      expect(result.batch_failed, `Unexpected failure: ${result.message}`).toBe(false);

      const stateMap = await getTreeStatesForBatch(connection, batchID);

      expect(stateMap.get('MIXOLD01')).toBe('old tree');
      expect(stateMap.get('MIXMULTI01')).toBe('multi stem');
      expect(stateMap.get('MIXNEW01')).toBe('new recruit');
    });
  });

  describe('First Census (No Previous)', () => {
    /**
     * Scenario: Ingesting into census 1 (no previous census exists).
     * Expected: All rows should be 'new recruit'.
     */
    it('should classify all rows as new recruit when no previous census exists', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Ingest into census 1 (the first census, no previous)
      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'FIRSTCENSUS01',
            stemTag: 'S001',
            speciesCode,
            quadratName,
            x: 5.0,
            y: 5.0,
            dbh: 80.0,
            hom: 1.3,
            date: '2024-06-15',
            codes: 'A'
          },
          {
            treeTag: 'FIRSTCENSUS02',
            stemTag: 'S001',
            speciesCode,
            quadratName,
            x: 6.0,
            y: 6.0,
            dbh: 70.0,
            hom: 1.3,
            date: '2024-06-15',
            codes: 'A'
          }
        ],
        { censusID: census1.censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);
      expect(result.batch_failed, `Unexpected failure: ${result.message}`).toBe(false);

      const stateMap = await getTreeStatesForBatch(connection, batchID);

      expect(stateMap.get('FIRSTCENSUS01')).toBe('new recruit');
      expect(stateMap.get('FIRSTCENSUS02')).toBe('new recruit');
    });
  });

  describe('StemCrossID Inheritance', () => {
    /**
     * Scenario: Stem in census 1 has a StemCrossID. Census 2 stem for same tree+stem
     * should inherit the StemCrossID from census 1.
     */
    it('should inherit StemCrossID from previous census stem', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Census 1: Insert tree and set its StemCrossID manually
      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'CROSSID01',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 5.0,
          y: 5.0,
          dbh: 100.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      // Set StemCrossID on the census 1 stem (simulating it being set from an even earlier census)
      const [stems1] = await connection.query<RowDataPacket[]>(
        `SELECT s.StemGUID FROM stems s
         INNER JOIN trees t ON t.TreeID = s.TreeID AND t.CensusID = s.CensusID
         WHERE t.TreeTag = 'CROSSID01' AND s.CensusID = ?`,
        [census1.censusID]
      );
      expect(stems1.length).toBeGreaterThan(0);
      const census1StemGUID = stems1[0].StemGUID;

      await connection.query('UPDATE stems SET StemCrossID = ? WHERE StemGUID = ?', [census1StemGUID, census1StemGUID]);

      // Census 2: Same tree+stem via bulk ingestion
      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'CROSSID01',
            stemTag: 'S001',
            speciesCode,
            quadratName,
            x: 5.0,
            y: 5.0,
            dbh: 110.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          }
        ],
        { censusID: census2.censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);
      expect(result.batch_failed, `Unexpected failure: ${result.message}`).toBe(false);

      // Verify census 2 stem inherited StemCrossID from census 1
      const [stems2] = await connection.query<RowDataPacket[]>(
        `SELECT s.StemGUID, s.StemCrossID FROM stems s
         INNER JOIN trees t ON t.TreeID = s.TreeID AND t.CensusID = s.CensusID
         WHERE t.TreeTag = 'CROSSID01' AND s.CensusID = ?`,
        [census2.censusID]
      );
      expect(stems2.length).toBeGreaterThan(0);

      // Census 2 stem's StemCrossID should match census 1 stem's StemCrossID
      expect(stems2[0].StemCrossID).toBe(census1StemGUID);
    });

    it('should only update StemCrossID for stems resolved in the current batch', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'BATCHSCOPED01',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 7.0,
          y: 7.0,
          dbh: 100.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      const [previousStemRows] = await connection.query<RowDataPacket[]>(
        `SELECT s.StemGUID
         FROM stems s
         INNER JOIN trees t ON t.TreeID = s.TreeID AND t.CensusID = s.CensusID
         WHERE t.TreeTag = 'BATCHSCOPED01' AND s.CensusID = ?`,
        [census1.censusID]
      );
      expect(previousStemRows.length).toBeGreaterThan(0);
      const previousStemGUID = previousStemRows[0].StemGUID;

      await connection.query('UPDATE stems SET StemCrossID = ? WHERE StemGUID = ?', [previousStemGUID, previousStemGUID]);

      await insertDirectMeasurements(connection, testData, census2.censusID, [
        {
          treeTag: 'UNRELATEDCURRENT01',
          stemTag: 'S009',
          speciesCode,
          quadratName,
          x: 9.0,
          y: 9.0,
          dbh: 60.0,
          hom: 1.3,
          date: '2025-06-15',
          codes: 'A'
        }
      ]);

      const [unrelatedBeforeRows] = await connection.query<RowDataPacket[]>(
        `SELECT s.StemGUID, s.StemCrossID
         FROM stems s
         INNER JOIN trees t ON t.TreeID = s.TreeID AND t.CensusID = s.CensusID
         WHERE t.TreeTag = 'UNRELATEDCURRENT01' AND s.CensusID = ?`,
        [census2.censusID]
      );
      expect(unrelatedBeforeRows.length).toBeGreaterThan(0);
      expect(unrelatedBeforeRows[0].StemCrossID).toBeNull();

      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'BATCHSCOPED01',
            stemTag: 'S001',
            speciesCode,
            quadratName,
            x: 7.0,
            y: 7.0,
            dbh: 110.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          }
        ],
        { censusID: census2.censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);
      expect(result.batch_failed, `Unexpected failure: ${result.message}`).toBe(false);

      const [batchStemRows] = await connection.query<RowDataPacket[]>(
        `SELECT s.StemGUID, s.StemCrossID
         FROM stems s
         INNER JOIN trees t ON t.TreeID = s.TreeID AND t.CensusID = s.CensusID
         WHERE t.TreeTag = 'BATCHSCOPED01' AND s.CensusID = ?`,
        [census2.censusID]
      );
      expect(batchStemRows.length).toBeGreaterThan(0);
      expect(batchStemRows[0].StemCrossID).toBe(previousStemGUID);

      const [unrelatedAfterRows] = await connection.query<RowDataPacket[]>(
        `SELECT s.StemGUID, s.StemCrossID
         FROM stems s
         INNER JOIN trees t ON t.TreeID = s.TreeID AND t.CensusID = s.CensusID
         WHERE t.TreeTag = 'UNRELATEDCURRENT01' AND s.CensusID = ?`,
        [census2.censusID]
      );
      expect(unrelatedAfterRows.length).toBeGreaterThan(0);
      expect(unrelatedAfterRows[0].StemCrossID).toBeNull();
    });
  });

  describe('Ambiguous Previous Census Matches', () => {
    it('should fail unresolved when the previous census has multiple active trees for the same TreeTag', async () => {
      const species1Code = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const species2Code = testData.species[1]?.SpeciesCode || testData.species[1]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!species1Code || !species2Code || !quadratName) {
        throw new Error('Test setup failed: need at least 2 species and 1 quadrat');
      }

      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'AMBIGTREE01',
          stemTag: 'S001',
          speciesCode: species1Code,
          quadratName,
          x: 4.0,
          y: 4.0,
          dbh: 90.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        },
        {
          treeTag: 'AMBIGTREE01',
          stemTag: 'S002',
          speciesCode: species2Code,
          quadratName,
          x: 4.5,
          y: 4.5,
          dbh: 80.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'AMBIGTREE01',
            stemTag: 'S003',
            speciesCode: species1Code,
            quadratName,
            x: 4.8,
            y: 4.8,
            dbh: 75.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          }
        ],
        { censusID: census2.censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);
      expect(result.batch_failed, `Unexpected batch failure: ${result.message}`).toBe(false);

      const failed = await getFailedMeasurements(connection, { fileID, tag: 'AMBIGTREE01' });
      expect(failed.length).toBeGreaterThan(0);
      expect(failed[0].FailureReasons).toContain('Ambiguous previous census match');

      const [alerts] = await connection.query<RowDataPacket[]>(
        `SELECT type FROM uploadintegrityalerts
         WHERE fileID = ? AND batchID = ? AND type = 'PREV_CENSUS_AMBIGUITY'`,
        [fileID, batchID]
      );
      expect(alerts.length).toBeGreaterThan(0);

      const treeState = await getTreeState(connection, batchID, 'AMBIGTREE01');
      expect(treeState).toBeNull();
    });

    it('should fail unresolved when the previous census has multiple active stems for the same TreeTag and StemTag', async () => {
      const species1Code = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const species2Code = testData.species[1]?.SpeciesCode || testData.species[1]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!species1Code || !species2Code || !quadratName) {
        throw new Error('Test setup failed: need at least 2 species and 1 quadrat');
      }

      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'AMBIGSTEM01',
          stemTag: 'S001',
          speciesCode: species1Code,
          quadratName,
          x: 6.0,
          y: 6.0,
          dbh: 95.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        },
        {
          treeTag: 'AMBIGSTEM01',
          stemTag: 'S001',
          speciesCode: species2Code,
          quadratName,
          x: 6.4,
          y: 6.4,
          dbh: 85.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'AMBIGSTEM01',
            stemTag: 'S001',
            speciesCode: species1Code,
            quadratName,
            x: 6.1,
            y: 6.1,
            dbh: 100.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          }
        ],
        { censusID: census2.censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);
      expect(result.batch_failed, `Unexpected batch failure: ${result.message}`).toBe(false);

      const failed = await getFailedMeasurements(connection, { fileID, tag: 'AMBIGSTEM01' });
      expect(failed.length).toBeGreaterThan(0);
      expect(failed[0].FailureReasons).toContain('Ambiguous previous census match');

      const treeState = await getTreeState(connection, batchID, 'AMBIGSTEM01');
      expect(treeState).toBeNull();
    });

    it('should ingest clean rows and leave ambiguous rows unresolved within the same batch', async () => {
      const species1Code = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const species2Code = testData.species[1]?.SpeciesCode || testData.species[1]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!species1Code || !species2Code || !quadratName) {
        throw new Error('Test setup failed: need at least 2 species and 1 quadrat');
      }

      await insertDirectMeasurements(connection, testData, census1.censusID, [
        {
          treeTag: 'MIXAMBIG01',
          stemTag: 'S001',
          speciesCode: species1Code,
          quadratName,
          x: 8.0,
          y: 8.0,
          dbh: 100.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        },
        {
          treeTag: 'MIXAMBIG01',
          stemTag: 'S002',
          speciesCode: species2Code,
          quadratName,
          x: 8.4,
          y: 8.4,
          dbh: 85.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        },
        {
          treeTag: 'MIXCLEAN01',
          stemTag: 'S001',
          speciesCode: species1Code,
          quadratName,
          x: 9.0,
          y: 9.0,
          dbh: 110.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'MIXAMBIG01',
            stemTag: 'S003',
            speciesCode: species1Code,
            quadratName,
            x: 8.8,
            y: 8.8,
            dbh: 70.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          },
          {
            treeTag: 'MIXCLEAN01',
            stemTag: 'S001',
            speciesCode: species1Code,
            quadratName,
            x: 9.0,
            y: 9.0,
            dbh: 115.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          }
        ],
        { censusID: census2.censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);
      expect(result.batch_failed, `Unexpected batch failure: ${result.message}`).toBe(false);

      const failed = await getFailedMeasurements(connection, { fileID, tag: 'MIXAMBIG01' });
      expect(failed.length).toBeGreaterThan(0);
      expect(failed[0].FailureReasons).toContain('Ambiguous previous census match');

      const stateMap = await getTreeStatesForBatch(connection, batchID);
      expect(stateMap.get('MIXAMBIG01')).toBeUndefined();
      expect(stateMap.get('MIXCLEAN01')).toBe('old tree');
    });
  });
});
