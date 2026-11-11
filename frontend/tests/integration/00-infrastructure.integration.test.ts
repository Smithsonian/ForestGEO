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
import fs from 'fs';
import path from 'path';
import { setupTestDatabase, teardownTestDatabase, tableNamesDeclaredIn, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';
import { TEST_DB_DRIVER_TIMEZONE } from '../setup/test-db-connection';
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

// Canonical DDL path; integration tests run with cwd=frontend.
const CANONICAL_DDL_PATH = path.join(process.cwd(), 'db/sql', 'tablestructures.sql');

// Pins tableNamesDeclaredIn's derivation so the completeness check below can't
// shrink its own expected set if the derivation regresses.
const TABLES_A_STALE_SPLITTER_ONCE_DROPPED = ['upload_errors', 'upload_sessions', 'validation_runs'] as const;

// A fixed instant, not new Date(), so the offset a local-zone driver applies,
// and therefore the delta this test reports, is the same on every run.
const DATE_BINDING_PROBE_ISO = '2024-01-02T03:04:05.000Z';

describe('Infrastructure Validation', () => {
  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;

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

    it('runs against a MySQL server whose session clock is UTC', async () => {
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT @@session.time_zone AS sessionTimeZone,
                @@system_time_zone AS systemTimeZone,
                TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS serverOffsetSeconds`
      );
      const { sessionTimeZone, systemTimeZone, serverOffsetSeconds } = rows[0];
      const serverOffset = Number(serverOffsetSeconds);
      expect(
        serverOffset,
        `MySQL at ${config.host}:${config.port} runs NOW() ${serverOffset}s from UTC ` +
          `(session time_zone=${sessionTimeZone}, system_time_zone=${systemTimeZone}). ` +
          'The app and this harness both require a UTC server. Run `lsof -nP -iTCP:3306 -sTCP:LISTEN`: ' +
          'only the Docker proxy should own the port; a Homebrew or scratch mysqld runs in the host zone.'
      ).toBe(0);
    });

    it('binds and decodes timestamps as UTC on the harness connection', async () => {
      const [serverClock] = await connection.query<RowDataPacket[]>('SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS serverOffsetSeconds');
      const serverOffsetSeconds = Number(serverClock[0].serverOffsetSeconds);

      const fixedInstant = new Date(DATE_BINDING_PROBE_ISO);
      const [bound] = await connection.query<RowDataPacket[]>('SELECT UNIX_TIMESTAMP(?) * 1000 AS boundEpochMs', [fixedInstant]);
      const boundEpochMs = Number(bound[0].boundEpochMs);
      expect(
        boundEpochMs,
        `mysql2 encoded ${DATE_BINDING_PROBE_ISO} ${boundEpochMs - fixedInstant.getTime()}ms off the instant ` +
          `(runtime offset ${new Date().getTimezoneOffset()} min, server offset ${serverOffsetSeconds}s). ` +
          `DEFAULT_TEST_CONFIG.timezone must be '${TEST_DB_DRIVER_TIMEZONE}'; ` +
          'a non-zero server offset means the server-clock test above is the real failure, not the driver.'
      ).toBe(fixedInstant.getTime());

      const [clock] = await connection.query<RowDataPacket[]>('SELECT NOW() AS nowValue, UNIX_TIMESTAMP(NOW()) * 1000 AS nowEpochMs');
      const decodedNowMs = new Date(clock[0].nowValue).getTime();
      expect(
        decodedNowMs,
        `mysql2 decoded NOW() ${decodedNowMs - Number(clock[0].nowEpochMs)}ms off the server epoch; the harness connection is not decoding DATETIME as UTC`
      ).toBe(Number(clock[0].nowEpochMs));
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

    // Per-column structure for coremeasurements and temporarymeasurements (and the other
    // critical tables) is now asserted in full by schema-contract.integration.test.ts against
    // the canonical DDL. This file no longer maintains a second, partial hardcoded column list.

    it('should not include legacy failed-row tables removed by the unified schema', async () => {
      const [tables] = await connection.query<RowDataPacket[]>('SHOW TABLES');
      const tableNames = tables.map(row => String(Object.values(row)[0]));

      expect(tableNames).not.toContain('failedmeasurements');
      expect(tableNames).not.toContain('cmverrors');
    });

    it('should create every base table declared in the canonical DDL, including the ones a prior splitter bug dropped', async () => {
      const canonicalDdl = fs.readFileSync(CANONICAL_DDL_PATH, 'utf-8');
      const declaredTableNames = tableNamesDeclaredIn(canonicalDdl);

      // Pin the derivation itself: if tableNamesDeclaredIn regresses and starts
      // under-reporting tables, this fails loudly here instead of silently
      // shrinking the set the completeness check below compares against.
      for (const formerlyDroppedTable of TABLES_A_STALE_SPLITTER_ONCE_DROPPED) {
        expect(
          declaredTableNames.map(name => name.toLowerCase()),
          `tableNamesDeclaredIn(${CANONICAL_DDL_PATH}) no longer reports "${formerlyDroppedTable}"; ` +
            'the derivation itself has regressed, independent of loadSchema'
        ).toContain(formerlyDroppedTable);
      }

      const [tables] = await connection.query<RowDataPacket[]>(
        `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
      );
      const createdTableNames = new Set(tables.map(row => String(row.TABLE_NAME).toLowerCase()));

      const missingTables: string[] = [];
      for (const declared of declaredTableNames) {
        if (!createdTableNames.has(declared.toLowerCase())) {
          missingTables.push(declared);
        }
      }

      if (missingTables.length > 0) {
        throw new Error(
          `${CANONICAL_DDL_PATH} declares ${missingTables.length} table(s) that loadSchema did not create ` +
            `in the test database: ${missingTables.join(', ')}`
        );
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
      const [result] = await connection.query<RowDataPacket[]>("CALL bulkingestionprocess('nonexistent_file', 'nonexistent_batch')");

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
          wrongNames.push(`ValidationID ${expected.id}: expected "${expected.name}", got "${found.ProcedureName}"`);
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
      const [dbSpecies] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) as count FROM species');
      expect(dbSpecies[0].count).toBeGreaterThanOrEqual(testData.species.length);
    });

    it('should have attributes in database matching testData', async () => {
      const [dbAttrs] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) as count FROM attributes');
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
