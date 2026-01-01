/**
 * Cross-Census Validation Integration Tests
 *
 * This file tests HARD FAILURES and INLINE validations that run during bulkingestionprocess.
 *
 * Hard Failures (reject records):
 * - Quadrat change between censuses (trees can't move)
 * - Coordinate drift >10m within same quadrat
 *
 * Inline Validations (accept but flag in cmverrors):
 * - ValidationID 14: Invalid attribute code
 *
 * NOTE: Most cross-census validations (ValidationID 1, 2, 20, 21) run POST-INGESTION via the API layer.
 * Tests for these are in: tests/integration/post-ingestion-validations.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestDatabase,
  teardownTestDatabase,
  insertTestMeasurements,
  insertDirectMeasurements,
  runBulkIngestion,
  getValidationErrors,
  getFailedMeasurements,
  seedStatusAttributes,
  type TestData
} from '../setup/local-db-setup';
import type { Connection, RowDataPacket } from 'mysql2/promise';

describe('Hard Failure Validation Tests', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config as any);
  });

  beforeEach(async () => {
    await connection.query('DELETE FROM cmverrors');
    await connection.query('DELETE FROM cmattributes');
    await connection.query('DELETE FROM coremeasurements');
    await connection.query('DELETE FROM stems');
    await connection.query('DELETE FROM trees');
    await connection.query('DELETE FROM failedmeasurements');
    await connection.query('DELETE FROM temporarymeasurements');
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

      // Create second census
      const [censusRows] = await connection.query<RowDataPacket[]>(
        'SELECT MAX(PlotCensusNumber) as maxNum FROM census WHERE PlotID = ?',
        [testData.plots[0].plotID]
      );
      const nextCensusNum = (censusRows[0].maxNum || 0) + 1;

      await connection.query(
        `INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive)
         VALUES (?, ?, '2025-01-01', '2025-12-31', 1)`,
        [testData.plots[0].plotID, nextCensusNum]
      );

      const [newCensusRows] = await connection.query<RowDataPacket[]>(
        'SELECT CensusID FROM census WHERE PlotID = ? AND PlotCensusNumber = ?',
        [testData.plots[0].plotID, nextCensusNum]
      );
      const census2ID = newCensusRows[0].CensusID;

      // Census 1: Tree in quadrat1
      await insertDirectMeasurements(connection, testData, testData.census[0].censusID, [
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
        { censusID: census2ID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);

      // Check uploadintegrityalerts for validation failure
      const [alerts] = await connection.query<RowDataPacket[]>(
        'SELECT type, message, severity FROM uploadintegrityalerts WHERE fileID = ?',
        [fileID]
      );

      // Check failedmeasurements for failure details
      const [failedDetails] = await connection.query<RowDataPacket[]>(
        'SELECT Tag, StemTag, Quadrat, FailureReasons FROM failedmeasurements WHERE FileID = ?',
        [fileID]
      );

      // The stored procedure puts cross-census validation failures in failedmeasurements
      // and continues processing (batch_failed is false, but records are marked as failed)
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

      // Create second census
      const [censusRows] = await connection.query<RowDataPacket[]>(
        'SELECT MAX(PlotCensusNumber) as maxNum FROM census WHERE PlotID = ?',
        [testData.plots[0].plotID]
      );
      const nextCensusNum = (censusRows[0].maxNum || 0) + 1;

      await connection.query(
        `INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive)
         VALUES (?, ?, '2025-01-01', '2025-12-31', 1)`,
        [testData.plots[0].plotID, nextCensusNum]
      );

      const [newCensusRows] = await connection.query<RowDataPacket[]>(
        'SELECT CensusID FROM census WHERE PlotID = ? AND PlotCensusNumber = ?',
        [testData.plots[0].plotID, nextCensusNum]
      );
      const census2ID = newCensusRows[0].CensusID;

      // Census 1: Tree in quadratName
      await insertDirectMeasurements(connection, testData, testData.census[0].censusID, [
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
        { censusID: census2ID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);

      // Check that NO quadrat mismatch failure was recorded
      const [failedDetails] = await connection.query<RowDataPacket[]>(
        'SELECT Tag, FailureReasons FROM failedmeasurements WHERE FileID = ? AND FailureReasons LIKE ?',
        [fileID, '%Quadrat mismatch%']
      );

      // Should NOT have any quadrat mismatch failures
      expect(failedDetails.length).toBe(0);

      // ASSERTION: Record should not hard-fail for valid same-quadrat data
      expect(result.batch_failed).toBe(false);
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

      // Create second census
      const [censusRows] = await connection.query<RowDataPacket[]>(
        'SELECT MAX(PlotCensusNumber) as maxNum FROM census WHERE PlotID = ?',
        [testData.plots[0].plotID]
      );
      const nextCensusNum = (censusRows[0].maxNum || 0) + 1;

      await connection.query(
        `INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive)
         VALUES (?, ?, '2025-01-01', '2025-12-31', 1)`,
        [testData.plots[0].plotID, nextCensusNum]
      );

      const [newCensusRows] = await connection.query<RowDataPacket[]>(
        'SELECT CensusID FROM census WHERE PlotID = ? AND PlotCensusNumber = ?',
        [testData.plots[0].plotID, nextCensusNum]
      );
      const census2ID = newCensusRows[0].CensusID;

      // Census 1: Stem at position (5, 5)
      await insertDirectMeasurements(connection, testData, testData.census[0].censusID, [
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
        { censusID: census2ID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);

      // Check failed measurements for drift detection
      const failed = await getFailedMeasurements(connection, { fileID });

      // Check upload alerts
      const [alerts] = await connection.query<RowDataPacket[]>(
        'SELECT type, message FROM uploadintegrityalerts WHERE fileID = ?',
        [fileID]
      );

      // The stored procedure puts cross-census validation failures in failedmeasurements
      // and continues processing (batch_failed is false, but records are marked as failed)
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

      // Create second census
      const [censusRows] = await connection.query<RowDataPacket[]>(
        'SELECT MAX(PlotCensusNumber) as maxNum FROM census WHERE PlotID = ?',
        [testData.plots[0].plotID]
      );
      const nextCensusNum = (censusRows[0].maxNum || 0) + 1;

      await connection.query(
        `INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive)
         VALUES (?, ?, '2025-01-01', '2025-12-31', 1)`,
        [testData.plots[0].plotID, nextCensusNum]
      );

      const [newCensusRows] = await connection.query<RowDataPacket[]>(
        'SELECT CensusID FROM census WHERE PlotID = ? AND PlotCensusNumber = ?',
        [testData.plots[0].plotID, nextCensusNum]
      );
      const census2ID = newCensusRows[0].CensusID;

      // Census 1: Stem at position (5, 5)
      await insertDirectMeasurements(connection, testData, testData.census[0].censusID, [
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
            y: 8.0,  // 3m difference - total drift ~5.83m (within 10m)
            dbh: 105.0,
            hom: 1.3,
            date: '2025-06-15',
            codes: 'A'
          }
        ],
        { censusID: census2ID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);

      // Check that NO coordinate drift failure was recorded
      const [failedDetails] = await connection.query<RowDataPacket[]>(
        'SELECT Tag, FailureReasons FROM failedmeasurements WHERE FileID = ? AND FailureReasons LIKE ?',
        [fileID, '%Coordinate drift%']
      );

      // Should NOT have any coordinate drift failures
      expect(failedDetails.length).toBe(0);

      // ASSERTION: Record should not hard-fail for valid small-drift data
      expect(result.batch_failed).toBe(false);
    });
  });
});

describe('Inline Validation Data Tests', () => {
  /**
   * NOTE: Most soft validations (3, 5, 11) run POST-INGESTION via the API layer.
   * Tests for these are in: tests/integration/post-ingestion-validations.integration.test.ts
   *
   * Only ValidationID 14 (Invalid Attribute Code) runs INLINE during bulkingestionprocess.
   */
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config as any);
  });

  beforeEach(async () => {
    await connection.query('DELETE FROM cmverrors');
    await connection.query('DELETE FROM cmattributes');
    await connection.query('DELETE FROM coremeasurements');
    await connection.query('DELETE FROM stems');
    await connection.query('DELETE FROM trees');
    await connection.query('DELETE FROM failedmeasurements');
    await connection.query('DELETE FROM temporarymeasurements');
  });

  describe('Invalid Attribute Code (ValidationID: 14)', () => {
    it('should flag non-existent attribute code', async () => {
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
          codes: 'INVALIDCODE999' // Invalid attribute code
        }
      ]);

      const result = await runBulkIngestion(connection, fileID, batchID);

      // Check for ValidationID 14 error (invalid attribute code)
      const errors = await getValidationErrors(connection, { validationID: 14 });

      // ASSERTION: Non-existent attribute code should trigger ValidationID 14
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].ValidationErrorID).toBe(14);
    });
  });
});
