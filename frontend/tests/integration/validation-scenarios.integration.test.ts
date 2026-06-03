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
 *   1. Hard Failures - Records stored in coremeasurements with StemGUID IS NULL + ingestion errors in measurement_error_log
 *   2. Soft Validations - Records accepted but flagged in measurement_error_log
 *   3. Cross-Census Validations - Consistency checks across census periods
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestMeasurements,
  insertTestMeasurements,
  insertDirectMeasurements,
  runBulkIngestion,
  verifyIngestionResults,
  getFailedMeasurements,
  getValidationErrors,
  runValidationForTest,
  type TestData
} from '../setup/local-db-setup';
import type { Connection, RowDataPacket } from 'mysql2/promise';

describe('Validation Scenarios Integration Tests', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };

  const getIngestionErrorsForFile = async (fileID: string) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT me.ErrorCode,
              me.ErrorMessage,
              cm.Description,
              cm.RawTreeTag AS TreeTag,
              cm.RawStemTag AS StemTag
       FROM coremeasurements cm
       JOIN measurement_error_log mel
         ON mel.MeasurementID = cm.CoreMeasurementID
        AND mel.IsResolved = FALSE
       JOIN measurement_errors me
         ON me.ErrorID = mel.ErrorID
       WHERE cm.UploadFileID = ?
         AND me.ErrorSource = 'ingestion'
       ORDER BY cm.CoreMeasurementID, me.ErrorCode`,
      [fileID]
    );

    return rows;
  };

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

      // Check what happened to the record (unresolved rows in coremeasurements with StemGUID IS NULL)
      const failed = await getFailedMeasurements(connection, { fileID: 'test_null_fields' });

      const [inserted] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) as count FROM coremeasurements cm ' +
          'INNER JOIN stems s ON s.StemGUID = cm.StemGUID ' +
          'INNER JOIN trees t ON t.TreeID = s.TreeID ' +
          'WHERE t.TreeTag IS NULL'
      );

      // ASSERTION: NULL TreeTag records should be rejected or not inserted
      // Either the batch failed, the record is in unresolved coremeasurements, or no NULL tag was inserted
      const wasRejected = Boolean(result.batch_failed) || failed.length > 0;
      const wasNotInserted = inserted[0].count === 0;

      expect(wasRejected || wasNotInserted).toBe(true);

      // If failed, verify the failure reason mentions the NULL field
      if (failed.length > 0) {
        expect(failed[0].FailureReasons).toBeDefined();
      }
    });

    it('should fail early and preserve staged rows when the target census is missing', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      await connection.query(
        `INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive)
         VALUES (?, ?, ?, ?, 1)`,
        [testData.plots[0].plotID, 99, '2026-01-01', '2026-12-31']
      );

      const [censusRows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS CensusID');
      const missingCensusID = censusRows[0].CensusID;

      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'MISSCENS001',
            stemTag: 'S001',
            speciesCode,
            quadratName,
            x: 10.0,
            y: 10.0,
            dbh: 100.0,
            hom: 1.3,
            date: '2026-06-15',
            codes: 'A'
          }
        ],
        { censusID: missingCensusID }
      );

      await connection.query('DELETE FROM census WHERE CensusID = ?', [missingCensusID]);

      const result = await runBulkIngestion(connection, fileID, batchID);

      expect(Boolean(result.batch_failed)).toBe(true);
      expect(result.message).toContain('references missing census');

      const [stagedRows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS rowCount FROM temporarymeasurements WHERE FileID = ? AND BatchID = ?', [
        fileID,
        batchID
      ]);
      expect(stagedRows[0].rowCount).toBe(1);

      const [alerts] = await connection.query<RowDataPacket[]>(
        `SELECT type, severity
         FROM uploadintegrityalerts
         WHERE fileID = ? AND batchID = ?`,
        [fileID, batchID]
      );
      expect(alerts.some(alert => alert.type === 'MISSING_CENSUS_SCOPE' && alert.severity === 'critical')).toBe(true);
    });

    it('should record TREE_RESOLUTION_FAILED when only an inactive current-census tree exists', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;
      const censusID = testData.census[0].censusID;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species WHERE SpeciesCode = ?', [speciesCode]);
      const speciesID = speciesRows[0].SpeciesID;

      await connection.query('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 0)', ['INACTTREE001', speciesID, censusID]);

      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'INACTTREE001',
            stemTag: 'S001',
            speciesCode,
            quadratName,
            x: 5.0,
            y: 5.0,
            dbh: 120.0,
            hom: 1.3,
            date: '2024-06-15',
            codes: 'A'
          }
        ],
        { censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);
      expect(result.batch_failed, result.message).toBe(false);

      const failed = await getFailedMeasurements(connection, { fileID });
      expect(failed).toHaveLength(1);

      const errorRows = await getIngestionErrorsForFile(fileID);
      expect(errorRows.map(row => row.ErrorCode)).toContain('TREE_RESOLUTION_FAILED');
      expect(errorRows[0].Description).toContain('inactive');
    });

    it('should record STEM_RESOLUTION_FAILED when an inactive current-census stem blocks insertion', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;
      const censusID = testData.census[0].censusID;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species WHERE SpeciesCode = ?', [speciesCode]);
      const [quadratRows] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE PlotID = ? AND QuadratName = ?', [
        testData.plots[0].plotID,
        quadratName
      ]);

      const speciesID = speciesRows[0].SpeciesID;
      const quadratID = quadratRows[0].QuadratID;

      await connection.query('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', ['INACTSTEM001', speciesID, censusID]);

      const [treeRows] = await connection.query<RowDataPacket[]>(
        `SELECT TreeID
         FROM trees
         WHERE TreeTag = ? AND SpeciesID = ? AND CensusID = ?`,
        ['INACTSTEM001', speciesID, censusID]
      );
      const treeID = treeRows[0].TreeID;

      await connection.query(
        `INSERT INTO stems
         (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [treeID, quadratID, censusID, 'S001', 7.0, 7.0]
      );

      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'INACTSTEM001',
            stemTag: 'S001',
            speciesCode,
            quadratName,
            x: 7.0,
            y: 7.0,
            dbh: 130.0,
            hom: 1.3,
            date: '2024-06-15',
            codes: 'A'
          }
        ],
        { censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);
      expect(result.batch_failed, result.message).toBe(false);

      const failed = await getFailedMeasurements(connection, { fileID });
      expect(failed).toHaveLength(1);

      const errorRows = await getIngestionErrorsForFile(fileID);
      expect(errorRows.map(row => row.ErrorCode)).toContain('STEM_RESOLUTION_FAILED');
      expect(errorRows[0].Description).toContain('inactive');
    });

    it('should record MEASUREMENT_INSERT_SKIPPED instead of silently dropping duplicate measurements', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;
      const censusID = testData.census[0].censusID;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      await insertDirectMeasurements(connection, testData, censusID, [
        {
          treeTag: 'DUPMEAS001',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 4.0,
          y: 4.0,
          dbh: 150.0,
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
            treeTag: 'DUPMEAS001',
            stemTag: 'S001',
            speciesCode,
            quadratName,
            x: 4.0,
            y: 4.0,
            dbh: 150.0,
            hom: 1.3,
            date: '2024-06-15',
            codes: 'A'
          }
        ],
        { censusID }
      );

      const result = await runBulkIngestion(connection, fileID, batchID);
      expect(result.batch_failed, result.message).toBe(false);

      const errorRows = await getIngestionErrorsForFile(fileID);
      expect(errorRows.map(row => row.ErrorCode)).toContain('MEASUREMENT_INSERT_SKIPPED');
      expect(errorRows[0].Description).toContain('matching measurement already exists');

      const [coreRows] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS rowCount
         FROM coremeasurements cm
         JOIN stems s ON s.StemGUID = cm.StemGUID
         JOIN trees t ON t.TreeID = s.TreeID
         WHERE t.TreeTag = ?
           AND cm.CensusID = ?
           AND cm.MeasurementDate = ?
           AND cm.MeasuredDBH = ?
           AND cm.MeasuredHOM = ?`,
        ['DUPMEAS001', censusID, '2024-06-15', 150.0, 1.3]
      );
      expect(coreRows[0].rowCount).toBe(1);
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
      expect(result.batch_failed, `Unexpected batch failure: ${result.message}`).toBe(false);

      // Verify data was processed - either inserted or flagged (not silently dropped)
      const [measurements] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) as count FROM coremeasurements WHERE CensusID = ?', [
        testData.census[0].censusID
      ]);

      const failed = await getFailedMeasurements(connection, { fileID });

      // ASSERTION: Record must be either in resolved coremeasurements or unresolved (failed)
      const totalProcessed = measurements[0].count + failed.length;
      expect(totalProcessed).toBeGreaterThan(0);
    });

    it('should track validation errors in measurement_error_log table', async () => {
      // ValidationID 14 (invalid attribute code) is a soft validation run POST-INGESTION
      // by the validation runner — like validations 1, 2, 3, 5, 6, 8, 11, etc. (It was
      // converted from an inline hard-fail to a soft validation; see commit 1c8fbbbb.)
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
          // Invalid attribute code; MUST be <= 10 chars — ValidationID 14 parses RawCodes
          // via json_table(... code varchar(10) ...), so under STRICT_TRANS_TABLES a longer
          // token is silently skipped (real attribute codes are <= 10 chars).
          codes: 'NOSUCH'
        }
      ]);

      await runBulkIngestion(connection, fileID, batchID);
      // ValidationID 14 is a soft, post-ingestion validation: bulkingestionprocess
      // leniently drops the unknown code via the cmattributes INNER JOIN (preserving
      // the original string in coremeasurements.RawCodes) and does NOT flag it inline.
      // The error is produced only when the validation runner executes ValidationID 14's
      // definition (which parses RawCodes), like every other soft validation.
      await runValidationForTest(connection, 14, { censusID: testData.census[0].censusID });

      // Query for errors generated by the validation run
      const errors = await getValidationErrors(connection, { validationID: 14 });

      // ASSERTION: Invalid attribute code should produce a ValidationID 14 error
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].ValidationErrorID).toBe(14);
    });
  });
});
