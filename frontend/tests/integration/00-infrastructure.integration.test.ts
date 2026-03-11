/**
 * Infrastructure Validation Tests
 *
 * These tests verify that the test infrastructure is correctly set up:
 * - Database connectivity
 * - Schema loaded correctly
 * - Stored procedures available
 * - Validation definitions present
 * - Sample data seeded
 *
 * This file is prefixed with "00-" to ensure it runs first.
 * If any of these tests fail, other integration tests cannot be trusted.
 *
 * NOTE: This consolidates infrastructure checks that were previously scattered
 * across multiple test files. Individual behavioral tests should NOT check
 * infrastructure - they should assume it works if these tests pass.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupTestDatabase,
  teardownTestDatabase,
  type TestData
} from '../setup/local-db-setup';
import type { Connection, RowDataPacket } from 'mysql2/promise';

function toBool(value: unknown): boolean {
  if (Buffer.isBuffer(value)) return value[0] === 1;
  return Boolean(value);
}

// Expected validation definitions from corequeries.sql plus inline validation metadata
const EXPECTED_VALIDATIONS = [
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
  { id: 12, name: 'ValidateScreenStemsWithMeasurementsButDeadAttributes' },
  { id: 13, name: 'ValidateScreenStemsWithMissingMeasurementsButLiveAttributes' },
  { id: 14, name: 'ValidateFindInvalidAttributeCodes' },
  { id: 15, name: 'ValidateFindAbnormallyHighDBH' },
  { id: 17, name: 'ValidateQuadratMismatchAcrossCensuses' },
  { id: 18, name: 'ValidateCoordinateDriftAcrossCensuses' },
  { id: 20, name: 'SpeciesMismatchCrossCensus' },
  { id: 21, name: 'SameBatchSpeciesConflict' }
] as const;

// Expected core tables that must exist
// Note: 'sites' table is not used in the current schema
const EXPECTED_TABLES = [
  'plots',
  'census',
  'quadrats',
  'species',
  'trees',
  'stems',
  'coremeasurements',
  'cmattributes',
  'measurement_error_log',
  'measurement_errors',
  'attributes',
  'temporarymeasurements',
  'sitespecificvalidations'
] as const;

// Expected stored procedures
const EXPECTED_PROCEDURES = ['bulkingestionprocess'] as const;

describe('Infrastructure Validation', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
  }, 90000); // Extended timeout for full setup

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  describe('Database Connectivity', () => {
    it('should have an active database connection', async () => {
      const [result] = await connection.query<RowDataPacket[]>('SELECT 1 as alive');
      expect(result[0].alive).toBe(1);
    });

    it('should be using the correct test database', async () => {
      const [result] = await connection.query<RowDataPacket[]>('SELECT DATABASE() as db');
      expect(result[0].db).toMatch(/^forestgeo_test_/);
    });
  });

  describe('Schema Integrity', () => {
    it('should have all required tables', async () => {
      const [tables] = await connection.query<RowDataPacket[]>('SHOW TABLES');
      const tableNames = tables.map(row => Object.values(row)[0] as string);

      const missingTables: string[] = [];
      for (const expected of EXPECTED_TABLES) {
        if (!tableNames.includes(expected)) {
          missingTables.push(expected);
        }
      }

      if (missingTables.length > 0) {
        throw new Error(`Missing tables: ${missingTables.join(', ')}`);
      }

      expect(tableNames.length).toBeGreaterThanOrEqual(EXPECTED_TABLES.length);
    });

    it('should have correct table structure for coremeasurements', async () => {
      const [columns] = await connection.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM coremeasurements"
      );
      const columnNames = columns.map(c => c.Field);

      const requiredColumns = [
        'CoreMeasurementID',
        'StemGUID',
        'CensusID',
        'MeasuredDBH',
        'MeasurementDate',
        'UploadFileID',
        'UploadBatchID',
        'RawTreeTag',
        'RawStemTag',
        'RawSpCode',
        'RawQuadrat',
        'RawX',
        'RawY',
        'RawCodes',
        'RawComments',
        'SourceRowIndex'
      ];

      for (const col of requiredColumns) {
        expect(columnNames).toContain(col);
      }
    });

    it('should not include legacy failed-row tables removed by the unified schema', async () => {
      const [tables] = await connection.query<RowDataPacket[]>('SHOW TABLES');
      const tableNames = tables.map(row => String(Object.values(row)[0]));

      expect(tableNames).not.toContain('failedmeasurements');
      expect(tableNames).not.toContain('cmverrors');
    });

    it('should have correct table structure for temporarymeasurements', async () => {
      const [columns] = await connection.query<RowDataPacket[]>(
        "SHOW COLUMNS FROM temporarymeasurements"
      );
      const columnNames = columns.map(c => c.Field);

      const requiredColumns = ['FileID', 'BatchID', 'PlotID', 'CensusID', 'TreeTag', 'StemTag', 'DBH'];

      for (const col of requiredColumns) {
        expect(columnNames).toContain(col);
      }
    });
  });

  describe('Stored Procedures', () => {
    it('should have bulkingestionprocess procedure available', async () => {
      const [procedures] = await connection.query<RowDataPacket[]>(
        `SELECT ROUTINE_NAME FROM information_schema.ROUTINES
         WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'`,
        [config.database]
      );

      const procedureNames = procedures.map(p => p.ROUTINE_NAME);

      for (const expected of EXPECTED_PROCEDURES) {
        expect(procedureNames).toContain(expected);
      }
    });

    it('should have bulkingestionprocess callable', async () => {
      // Just verify we can call it without error (with dummy data that won't match anything)
      const [result] = await connection.query<RowDataPacket[]>(
        "CALL bulkingestionprocess('nonexistent_file', 'nonexistent_batch')"
      );

      // The procedure should return something (even if empty)
      expect(result).toBeDefined();
    });

    it('should use the unified measurement error workflow inside bulkingestionprocess', async () => {
      const [rows] = await connection.query<RowDataPacket[]>('SHOW CREATE PROCEDURE bulkingestionprocess');
      expect(rows.length).toBe(1);

      const definition = String(rows[0]['Create Procedure'] || '');
      const normalizedDefinition = definition.toLowerCase();

      expect(normalizedDefinition).toContain('measurement_error_log');
      expect(normalizedDefinition).toContain('measurement_errors');
      expect(normalizedDefinition).toContain('uploadfileid');
      expect(normalizedDefinition).toContain('uploadbatchid');
      expect(normalizedDefinition).toContain('sourcerowindex');
      expect(normalizedDefinition).not.toContain('failedmeasurements');
      expect(normalizedDefinition).not.toContain('cmverrors');
    });
  });

  describe('Validation Definitions', () => {
    it('should have all expected validation procedures defined', async () => {
      const [validations] = await connection.query<RowDataPacket[]>(
        'SELECT ValidationID, ProcedureName, IsEnabled FROM sitespecificvalidations ORDER BY ValidationID'
      );

      expect(validations.length).toBeGreaterThanOrEqual(EXPECTED_VALIDATIONS.length);

      const missingValidations: string[] = [];
      const wrongNames: string[] = [];

      for (const expected of EXPECTED_VALIDATIONS) {
        const found = validations.find(v => v.ValidationID === expected.id);
        if (!found) {
          missingValidations.push(`ValidationID ${expected.id} (${expected.name})`);
        } else if (found.ProcedureName !== expected.name) {
          wrongNames.push(
            `ValidationID ${expected.id}: expected "${expected.name}", got "${found.ProcedureName}"`
          );
        }
      }

      if (missingValidations.length > 0) {
        throw new Error(`Missing validations: ${missingValidations.join(', ')}`);
      }

      if (wrongNames.length > 0) {
        throw new Error(`Wrong procedure names: ${wrongNames.join('; ')}`);
      }
    });

    it('should have non-empty Definition for API validations', async () => {
      // API validations (not inline) should have SQL in their Definition field
      const apiValidationIDs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 15, 17, 18];

      const [validations] = await connection.query<RowDataPacket[]>(
        `SELECT ValidationID, ProcedureName, Definition
         FROM sitespecificvalidations
         WHERE ValidationID IN (${apiValidationIDs.join(',')})`
      );

      const emptyDefinitions: string[] = [];

      for (const v of validations) {
        if (!v.Definition || v.Definition.trim().length === 0) {
          emptyDefinitions.push(`ValidationID ${v.ValidationID} (${v.ProcedureName})`);
        }
      }

      if (emptyDefinitions.length > 0) {
        throw new Error(`Validations with empty Definition: ${emptyDefinitions.join(', ')}`);
      }
    });

    it('should model inline validations as disabled rows with empty definitions', async () => {
      const [validations] = await connection.query<RowDataPacket[]>(
        `SELECT ValidationID, ProcedureName, Definition, IsEnabled
         FROM sitespecificvalidations
         WHERE ValidationID IN (20, 21)
         ORDER BY ValidationID`
      );

      expect(validations).toHaveLength(2);

      for (const validation of validations) {
        expect(validation.Definition ?? '').toBe('');
        expect(toBool(validation.IsEnabled)).toBe(false);
      }
    });
  });

  describe('Sample Data', () => {
    it('should have test species loaded', () => {
      expect(testData.species.length).toBeGreaterThan(0);
      expect(testData.species[0].SpeciesCode).toBeDefined();
    });

    it('should have test plots loaded', () => {
      expect(testData.plots.length).toBeGreaterThan(0);
      expect(testData.plots[0].plotID).toBeDefined();
    });

    it('should have test census loaded', () => {
      expect(testData.census.length).toBeGreaterThan(0);
      expect(testData.census[0].censusID).toBeDefined();
    });

    it('should have test quadrats loaded', () => {
      expect(testData.quadrats.length).toBeGreaterThan(0);
      expect(testData.quadrats[0].QuadratName).toBeDefined();
    });

    it('should have test attributes loaded', () => {
      expect(testData.attributes.length).toBeGreaterThan(0);
      expect(testData.attributes[0].code).toBeDefined();
    });

    it('should have species in database matching testData', async () => {
      const [dbSpecies] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) as count FROM species'
      );
      expect(dbSpecies[0].count).toBeGreaterThanOrEqual(testData.species.length);
    });

    it('should have attributes in database matching testData', async () => {
      const [dbAttrs] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) as count FROM attributes'
      );
      expect(dbAttrs[0].count).toBeGreaterThanOrEqual(testData.attributes.length);
    });
  });

  describe('Foreign Key Relationships', () => {
    it('should have census linked to plots', async () => {
      const [result] = await connection.query<RowDataPacket[]>(
        `SELECT c.CensusID, c.PlotID, p.PlotName
         FROM census c
         JOIN plots p ON c.PlotID = p.PlotID
         WHERE c.CensusID = ?`,
        [testData.census[0].censusID]
      );
      expect(result.length).toBe(1);
      expect(result[0].PlotID).toBe(testData.plots[0].plotID);
    });

    it('should have quadrats linked to plots', async () => {
      const [result] = await connection.query<RowDataPacket[]>(
        `SELECT q.QuadratID, q.PlotID
         FROM quadrats q
         WHERE q.PlotID = ?`,
        [testData.plots[0].plotID]
      );
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
