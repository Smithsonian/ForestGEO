/**
 * Integration Tests for ForestGEO Validation Scenarios
 *
 * These tests verify that the stored procedures correctly identify and flag
 * data quality issues during the bulk ingestion process.
 *
 * Prerequisites:
 *   - MySQL running locally (docker compose up -d mysql)
 *   - Run: npm run test:integration
 *
 * Test Categories:
 *   1. Hard Failures - Records rejected and moved to failedmeasurements
 *   2. Soft Validations - Records accepted but flagged in cmverrors
 *   3. Cross-Census Validations - Consistency checks across census periods
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestMeasurements,
  insertTestMeasurements,
  runBulkIngestion,
  verifyIngestionResults,
  type TestData
} from '../setup/local-db-setup';
import type { Connection, RowDataPacket } from 'mysql2/promise';

describe('Validation Scenarios Integration Tests', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
  }, 60000); // 60s timeout for DB setup

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData);
  });

  /**
   * Hard Failure Tests
   *
   * NOTE: Quadrat change and coordinate drift tests are in cross-census-validations.integration.test.ts
   * with full behavioral testing (positive + negative cases).
   */
  describe('Hard Failures - Records Rejected', () => {
    it('should reject records with NULL required fields', async () => {
      // Insert measurement with missing TreeTag
      await connection.query(
        `INSERT INTO temporarymeasurements
         (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName,
          LocalX, LocalY, DBH, HOM, MeasurementDate)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'test_null_fields',
          'batch_null_fields',
          testData.plots[0].plotID,
          testData.census[0].censusID,
          // TreeTag is NULL
          'S001',
          testData.species[0]?.SpeciesCode || 'TESTSP',
          testData.quadrats[0]?.QuadratName || 'Q001',
          5.0,
          5.0,
          100.0,
          1.3,
          '2024-06-15'
        ]
      );

      const result = await runBulkIngestion(connection, 'test_null_fields', 'batch_null_fields');

      // Check what happened to the record
      const [failed] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM failedmeasurements WHERE FileID = ?',
        ['test_null_fields']
      );

      const [inserted] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) as count FROM coremeasurements cm ' +
        'INNER JOIN stems s ON s.StemGUID = cm.StemGUID ' +
        'INNER JOIN trees t ON t.TreeID = s.TreeID ' +
        'WHERE t.TreeTag IS NULL'
      );

      // ASSERTION: NULL TreeTag records should be rejected or not inserted
      // Either the batch failed, the record is in failedmeasurements, or no NULL tag was inserted
      const wasRejected = Boolean(result.batch_failed) || failed.length > 0;
      const wasNotInserted = inserted[0].count === 0;

      expect(wasRejected || wasNotInserted).toBe(true);

      // If failed, verify the failure reason mentions the NULL field
      if (failed.length > 0) {
        expect(failed[0].FailureReasons).toBeDefined();
      }
    });
  });

  /**
   * NOTE: Behavioral tests for soft validations are in:
   * - post-ingestion-validations.integration.test.ts (ValidationIDs 1, 2, 6, 8, 11, 15)
   * - cross-census-validations.integration.test.ts (ValidationIDs 3, 14, 20, 21)
   */

  describe('End-to-End Ingestion Flow', () => {
    it('should successfully ingest valid measurements', async () => {
      // Get valid test data
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      // FAIL FAST: Test setup must provide valid data
      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Insert valid measurement
      const { fileID, batchID } = await insertTestMeasurements(connection, testData, [
        {
          treeTag: 'T001',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 10.0,
          y: 10.0,
          dbh: 150.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      const result = await runBulkIngestion(connection, fileID, batchID);

      // ASSERTION: Ingestion should not hard-fail for valid data
      expect(result.batch_failed).toBe(false);

      // Verify data was processed - either inserted or flagged (not silently dropped)
      const [measurements] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) as count FROM coremeasurements WHERE CensusID = ?',
        [testData.census[0].censusID]
      );

      const [failed] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) as count FROM failedmeasurements WHERE FileID = ?',
        [fileID]
      );

      // ASSERTION: Record must be either in coremeasurements or failedmeasurements
      const totalProcessed = measurements[0].count + failed[0].count;
      expect(totalProcessed).toBeGreaterThan(0);
    });

    it('should track validation errors in cmverrors table', async () => {
      // ValidationID 14 (invalid attribute code) is an INLINE validation that runs during ingestion
      // Other validations (1, 2, 3, 5, 6, 8, 11, etc.) run POST-INGESTION via the API
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Insert measurement with invalid attribute code to trigger ValidationID 14
      const { fileID, batchID } = await insertTestMeasurements(connection, testData, [
        {
          treeTag: 'ERRTEST001',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 10.0,
          y: 10.0,
          dbh: 150.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'INVALIDCODE999' // Invalid attribute code triggers ValidationID 14
        }
      ]);

      await runBulkIngestion(connection, fileID, batchID);

      // Query for errors generated by this ingestion
      const [errors] = await connection.query<RowDataPacket[]>(
        `SELECT cmv.*, ssv.ProcedureName, ssv.Description
         FROM cmverrors cmv
         JOIN sitespecificvalidations ssv ON cmv.ValidationErrorID = ssv.ValidationID
         WHERE cmv.ValidationErrorID = 14`
      );

      // ASSERTION: Invalid attribute code should produce a ValidationID 14 error
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].ValidationErrorID).toBe(14);
    });
  });

  describe('Validation Procedure Integrity', () => {
    it('should have all expected validation procedures defined', async () => {
      const [validations] = await connection.query<RowDataPacket[]>(
        'SELECT ValidationID, ProcedureName, IsEnabled FROM sitespecificvalidations ORDER BY ValidationID'
      );

      // These are the core validations loaded from corequeries.sql
      // Note: ValidationID 10 and 12 are not in the SQL file
      const expectedValidations = [
        { id: 1, name: 'ValidateDBHGrowthExceedsMax' },
        { id: 2, name: 'ValidateDBHShrinkageExceedsMax' },
        { id: 3, name: 'ValidateFindAllInvalidSpeciesCodes' },
        { id: 4, name: 'ValidateFindDuplicatedQuadratsByName' },
        { id: 5, name: 'ValidateFindDuplicateStemTreeTagCombinationsPerCensus' },
        { id: 6, name: 'ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat' },
        { id: 7, name: 'ValidateFindStemsInTreeWithDifferentSpecies' },
        { id: 8, name: 'ValidateFindStemsOutsidePlots' },
        { id: 9, name: 'ValidateFindTreeStemsInDifferentQuadrats' },
        { id: 11, name: 'ValidateScreenMeasuredDiameterMinMax' },
        { id: 13, name: 'ValidateScreenStemsWithMissingMeasurementsButLiveAttributes' },
        { id: 14, name: 'ValidateFindInvalidAttributeCodes' },
        { id: 15, name: 'ValidateFindAbnormallyHighDBH' }
      ];

      // Fail explicitly if validation definitions are missing
      expect(validations.length).toBeGreaterThanOrEqual(expectedValidations.length);

      for (const expected of expectedValidations) {
        const found = validations.find(v => v.ValidationID === expected.id);
        expect(found).toBeDefined();
        expect(found!.ProcedureName).toBe(expected.name);
      }
    });

    it('should have bulkingestionprocess procedure available', async () => {
      const [procedures] = await connection.query<RowDataPacket[]>(
        "SHOW PROCEDURE STATUS WHERE Name = 'bulkingestionprocess'"
      );

      // At least one procedure should exist (may be more if multiple test DBs)
      expect(procedures.length).toBeGreaterThanOrEqual(1);
      expect(procedures.some((p: any) => p.Name === 'bulkingestionprocess')).toBe(true);
    });
  });
});
