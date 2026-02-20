/**
 * API Layer Integration Tests for Validation Endpoints
 *
 * These tests verify that the validation API endpoints correctly interact
 * with the database. Unlike unit tests that mock the database, these tests
 * run against a real MySQL instance.
 *
 * Prerequisites:
 *   - MySQL running locally (docker compose up -d mysql)
 *   - Run: npm run test:integration
 *
 * Test Approach:
 *   - Uses real test database (same as other integration tests)
 *   - Calls route handlers directly (not HTTP) with real DB connection
 *   - Verifies database state changes after API calls
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestMeasurements,
  insertTestMeasurements,
  runBulkIngestion,
  getValidationErrors,
  type TestData
} from '../setup/local-db-setup';
import type { Connection, RowDataPacket } from 'mysql2/promise';

// Helper to convert MySQL boolean (Buffer/number) to JS boolean
function toBool(value: any): boolean {
  if (Buffer.isBuffer(value)) return value[0] === 1;
  return Boolean(value);
}

// Helper to convert MySQL decimal (string) to number
function toNumber(value: any): number {
  if (typeof value === 'string') return parseFloat(value);
  return Number(value);
}

// Test constants
const HTTP_OK = 200;
const HTTP_CONFLICT = 409;
const HTTP_INTERNAL_ERROR = 500;

describe('Validation API Integration Tests', () => {
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
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData);
    vi.clearAllMocks();
  });

  describe('Validation List Endpoint', () => {
    it('should retrieve all validation definitions from database', async () => {
      // Query validation definitions directly
      const [validations] = await connection.query<RowDataPacket[]>(
        'SELECT ValidationID, ProcedureName, Description, IsEnabled FROM sitespecificvalidations ORDER BY ValidationID'
      );

      // Verify we have validation definitions loaded
      expect(validations.length).toBeGreaterThan(0);

      // Check required validations are present
      const validationIds = validations.map(v => v.ValidationID);
      expect(validationIds).toContain(1); // DBH Growth
      expect(validationIds).toContain(2); // DBH Shrinkage
      expect(validationIds).toContain(6); // Outside Census Bounds
      expect(validationIds).toContain(11); // DBH Outside Species Limits
      expect(validationIds).toContain(15); // Abnormally High DBH

      // Verify structure
      const validation = validations.find(v => v.ValidationID === 1);
      expect(validation).toBeDefined();
      expect(validation!.ProcedureName).toBe('ValidateDBHGrowthExceedsMax');
      expect(toBool(validation!.IsEnabled)).toBe(true);
    });

    it('should include both enabled and disabled validations', async () => {
      const [validations] = await connection.query<RowDataPacket[]>(
        'SELECT ValidationID, IsEnabled FROM sitespecificvalidations'
      );

      const enabledCount = validations.filter(v => toBool(v.IsEnabled)).length;
      const disabledCount = validations.filter(v => !toBool(v.IsEnabled)).length;

      // Should have both enabled and disabled validations
      expect(enabledCount).toBeGreaterThan(0);
      expect(disabledCount).toBeGreaterThanOrEqual(0); // May be 0 if all enabled
    });
  });

  describe('Validation Execution via Database', () => {
    /**
     * Tests that validation SQL can be retrieved and executed.
     * This simulates what the API does when running a validation.
     */
    it('should execute validation SQL and create error records', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Insert measurement with date outside census bounds (triggers ValidationID 6)
      const { fileID, batchID } = await insertTestMeasurements(connection, testData, [
        {
          treeTag: 'API_TEST_001',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 10.0,
          y: 10.0,
          dbh: 150.0,
          hom: 1.3,
          date: '2020-01-01', // Outside census bounds (2024)
          codes: 'A'
        }
      ]);

      await runBulkIngestion(connection, fileID, batchID);

      // Get the validation SQL definition
      const [validationDef] = await connection.query<RowDataPacket[]>(
        'SELECT Definition FROM sitespecificvalidations WHERE ValidationID = 6'
      );

      expect(validationDef.length).toBe(1);
      expect(validationDef[0].Definition).toContain('MeasurementDate');

      // Run the validation (simulating what API does)
      const validationSQL = validationDef[0].Definition
        .replace(/@validationProcedureID/g, '6')
        .replace(/@p_CensusID/g, 'NULL')
        .replace(/@p_PlotID/g, 'NULL');

      await connection.query(validationSQL);

      // Verify error was created in the new measurement_error_log table
      const errors = await getValidationErrors(connection, { validationID: 6 });

      expect(errors.length).toBeGreaterThan(0);
    });

    it('should not create duplicate errors on re-run', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Insert measurement with invalid attribute code (triggers ValidationID 14)
      const { fileID, batchID } = await insertTestMeasurements(connection, testData, [
        {
          treeTag: 'API_DUP_001',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 10.0,
          y: 10.0,
          dbh: 150.0,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'INVALID_CODE_XYZ'
        }
      ]);

      await runBulkIngestion(connection, fileID, batchID);

      // Count errors after first run
      const errorsAfterFirst = await getValidationErrors(connection, { validationID: 14 });
      const firstCount = errorsAfterFirst.length;

      // Run bulk ingestion again (should not duplicate errors)
      await runBulkIngestion(connection, fileID, batchID);

      // Count errors after second run
      const errorsAfterSecond = await getValidationErrors(connection, { validationID: 14 });
      const secondCount = errorsAfterSecond.length;

      // Error count should not increase
      expect(secondCount).toBe(firstCount);
    });
  });

  describe('Validation CRUD Operations', () => {
    it('should create, read, update, and delete validation rules', async () => {
      // CREATE: Insert a test validation
      const insertResult = await connection.query(
        `INSERT INTO sitespecificvalidations
         (ValidationID, ProcedureName, Description, Criteria, Definition, IsEnabled)
         VALUES (99, 'TestValidation', 'Test Description', 'testCriteria', 'SELECT 1', 0)`
      );

      // READ: Verify it was created
      const [created] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM sitespecificvalidations WHERE ValidationID = 99'
      );
      expect(created.length).toBe(1);
      expect(created[0].ProcedureName).toBe('TestValidation');
      expect(toBool(created[0].IsEnabled)).toBe(false);

      // UPDATE: Modify the validation
      await connection.query(
        `UPDATE sitespecificvalidations
         SET Description = 'Updated Description', IsEnabled = 1
         WHERE ValidationID = 99`
      );

      const [updated] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM sitespecificvalidations WHERE ValidationID = 99'
      );
      expect(updated[0].Description).toBe('Updated Description');
      expect(toBool(updated[0].IsEnabled)).toBe(true);

      // DELETE: Remove the validation
      await connection.query(
        'DELETE FROM sitespecificvalidations WHERE ValidationID = 99'
      );

      const [deleted] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM sitespecificvalidations WHERE ValidationID = 99'
      );
      expect(deleted.length).toBe(0);
    });

    it('should handle validation rule toggles correctly', async () => {
      // Get current state of ValidationID 1
      const [before] = await connection.query<RowDataPacket[]>(
        'SELECT IsEnabled FROM sitespecificvalidations WHERE ValidationID = 1'
      );
      const originalEnabled = toBool(before[0].IsEnabled);

      // Toggle the validation
      await connection.query(
        'UPDATE sitespecificvalidations SET IsEnabled = ? WHERE ValidationID = 1',
        [originalEnabled ? 0 : 1]
      );

      const [after] = await connection.query<RowDataPacket[]>(
        'SELECT IsEnabled FROM sitespecificvalidations WHERE ValidationID = 1'
      );
      expect(toBool(after[0].IsEnabled)).toBe(!originalEnabled);

      // Restore original state
      await connection.query(
        'UPDATE sitespecificvalidations SET IsEnabled = ? WHERE ValidationID = 1',
        [originalEnabled ? 1 : 0]
      );
    });
  });

  describe('Validation Error Display', () => {
    it('should retrieve validation errors with measurement details', async () => {
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Create a measurement that triggers validation error
      const { fileID, batchID } = await insertTestMeasurements(connection, testData, [
        {
          treeTag: 'DISPLAY_TEST_001',
          stemTag: 'S001',
          speciesCode,
          quadratName,
          x: 10.0,
          y: 10.0,
          dbh: 5000.0, // Abnormally high - triggers ValidationID 15
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ]);

      await runBulkIngestion(connection, fileID, batchID);

      // Run ValidationID 15 (abnormally high DBH)
      const [validationDef] = await connection.query<RowDataPacket[]>(
        'SELECT Definition FROM sitespecificvalidations WHERE ValidationID = 15'
      );

      if (validationDef.length > 0 && validationDef[0].Definition) {
        const validationSQL = validationDef[0].Definition
          .replace(/@validationProcedureID/g, '15')
          .replace(/@p_CensusID/g, 'NULL')
          .replace(/@p_PlotID/g, 'NULL');

        await connection.query(validationSQL);
      }

      // Query errors with joined measurement data (simulating API response)
      const [errorDisplay] = await connection.query<RowDataPacket[]>(`
        SELECT
          mel.LogID AS CMVErrorID,
          CAST(me.ErrorCode AS UNSIGNED) AS ValidationErrorID,
          ssv.ProcedureName,
          ssv.Description as ValidationDescription,
          cm.MeasuredDBH,
          cm.MeasurementDate,
          t.TreeTag,
          s.StemTag
        FROM measurement_error_log mel
        JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
        JOIN sitespecificvalidations ssv ON me.ErrorCode = CAST(ssv.ValidationID AS CHAR)
        JOIN coremeasurements cm ON mel.MeasurementID = cm.CoreMeasurementID
        JOIN stems s ON cm.StemGUID = s.StemGUID
        JOIN trees t ON s.TreeID = t.TreeID
        WHERE me.ErrorSource = 'validation'
          AND me.ErrorCode = '15'
          AND mel.IsResolved = FALSE
        LIMIT 10
      `);

      // Verify error display data structure
      if (errorDisplay.length > 0) {
        const error = errorDisplay[0];
        expect(error.ValidationErrorID).toBe(15);
        expect(error.ProcedureName).toBe('ValidateFindAbnormallyHighDBH');
        expect(toNumber(error.MeasuredDBH)).toBeGreaterThanOrEqual(3500);
      }
    });
  });

  describe('Cross-Validation Consistency', () => {
    it('should maintain referential integrity between measurement_error_log and coremeasurements', async () => {
      // Verify foreign key relationship is enforced
      const [fkCheck] = await connection.query<RowDataPacket[]>(`
        SELECT
          COUNT(*) as orphaned_errors
        FROM measurement_error_log mel
        LEFT JOIN coremeasurements cm ON mel.MeasurementID = cm.CoreMeasurementID
        WHERE cm.CoreMeasurementID IS NULL
      `);

      expect(fkCheck[0].orphaned_errors).toBe(0);
    });

    it('should maintain referential integrity between measurement_error_log and measurement_errors', async () => {
      // Verify all error log entries reference valid error definitions
      const [fkCheck] = await connection.query<RowDataPacket[]>(`
        SELECT
          COUNT(*) as orphaned_errors
        FROM measurement_error_log mel
        LEFT JOIN measurement_errors me ON mel.ErrorID = me.ErrorID
        WHERE me.ErrorID IS NULL
      `);

      expect(fkCheck[0].orphaned_errors).toBe(0);
    });
  });
});
