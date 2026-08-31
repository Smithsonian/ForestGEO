/**
 * Integration tests for Task 13 (procedures-only deployment + gated
 * validation 19 activation) in scripts/deploy-validations-to-all-schemas.ts.
 *
 * Exercises deployProceduresOnly and activateValidation19 directly against a
 * real local MySQL schema — no mocked connection — since their entire
 * purpose is to prove real behavior against information_schema.ROUTINES,
 * sitespecificvalidations, and measurement_errors that a mock could not
 * meaningfully stand in for.
 *
 * Covered acceptance criteria (see docs/superpowers/plans/2026-08-26-plot-coordinate-ingest.md, Task 13):
 *   - deploy:procedures executes storedprocedures.sql only and never touches
 *     sitespecificvalidations (proven by a custom validation row + a toggled
 *     IsEnabled value both surviving a deployProceduresOnly run)
 *   - activate:validation19 enables validation 19 only where the helper
 *     procedure, the error code, and the exact (19, ValidatePlotCoordinateConsistency)
 *     identity all exist
 *   - activation refuses, with a named error, on a schema missing or
 *     conflicting with any dependency, and never leaves the row enabled
 *   - activation verifies persistence after the UPDATE
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/deploy-validations.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestDatabaseConfig } from '../setup/local-db-setup';
import { activateValidation19, deployProceduresOnly, parseStoredProceduresSQL, VALIDATION_19_CONTRACT } from '../../scripts/deploy-validations-to-all-schemas';

// ---------------------------------------------------------------------------
// Safety guard — setupTestDatabase DROPs/CREATEs its schema; never run remote.
// ---------------------------------------------------------------------------

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';

if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(
    `[deploy-validations] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops and recreates its test schema and must only run against a local test database.`
  );
}

const CUSTOM_VALIDATION_ID = 77;
const TOGGLED_VALIDATION_ID = 8;
const VALIDATION_19_HELPER = 'RunPlotCoordinateConsistencyValidation';
const VALIDATION_19_UNRELATED_PROCEDURE = 'RefreshViewFullTable';

describe('deploy-validations-to-all-schemas — integration', () => {
  let connection: Connection;
  let config: TestDatabaseConfig;
  let schema: string;
  let seededValidation19Enabled: boolean | null;
  let procedureStatements: string[];

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    config = setup.config;
    schema = config.database;

    const storedprocsRaw = fs.readFileSync(path.join(process.cwd(), 'db/sql', 'storedprocedures.sql'), 'utf8');
    procedureStatements = parseStoredProceduresSQL(storedprocsRaw);

    // Read the seeded state BEFORE beforeEach normalises it. setupTestDatabase has
    // just run loadSchema -> corequeries.sql -> storedprocedures.sql, so this is
    // exactly what a freshly provisioned schema ships with.
    const [seeded] = await connection.query<RowDataPacket[]>(`SELECT IsEnabled FROM sitespecificvalidations WHERE ValidationID = 19`);
    seededValidation19Enabled =
      seeded.length === 0
        ? null
        : seeded[0].IsEnabled === 1 || seeded[0].IsEnabled === true || (Buffer.isBuffer(seeded[0].IsEnabled) && seeded[0].IsEnabled[0] === 1);

    console.log(`[setup] schema=${schema} procedureStatements=${procedureStatements.length} seededValidation19Enabled=${seededValidation19Enabled}`);
  }, 120000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    // Normalise validation 19 to a known disabled baseline so the "activation
    // actually flips it" assertions below are meaningful. The fresh schema now
    // seeds it disabled too (see the seeded-default test), but this keeps each
    // test independent of what the previous one left behind.
    await connection.query(
      `INSERT INTO sitespecificvalidations
         (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled)
       VALUES (19, ?, ?, ?, ?, ?, FALSE)
       ON DUPLICATE KEY UPDATE
         ProcedureName = VALUES(ProcedureName),
         Description = VALUES(Description),
         Criteria = VALUES(Criteria),
         Definition = VALUES(Definition),
         ChangelogDefinition = VALUES(ChangelogDefinition),
         IsEnabled = FALSE`,
      [
        VALIDATION_19_CONTRACT.procedureName,
        VALIDATION_19_CONTRACT.description,
        VALIDATION_19_CONTRACT.criteria,
        VALIDATION_19_CONTRACT.definition,
        VALIDATION_19_CONTRACT.changelogDefinition
      ]
    );
    await connection.query(`UPDATE measurement_errors SET ErrorMessage = ? WHERE ErrorSource = 'validation' AND ErrorCode = '19'`, [
      VALIDATION_19_CONTRACT.errorMessage
    ]);
    await connection.query(`DELETE FROM sitespecificvalidations WHERE ValidationID = ${CUSTOM_VALIDATION_ID}`);
  });

  async function isEnabled(validationID: number): Promise<boolean | null> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT IsEnabled FROM sitespecificvalidations WHERE ValidationID = ?`, [validationID]);
    if (rows.length === 0) return null;
    const enabled = rows[0].IsEnabled;
    return enabled === 1 || enabled === true || (Buffer.isBuffer(enabled) && enabled[0] === 1);
  }

  // -------------------------------------------------------------------------
  // deployProceduresOnly
  // -------------------------------------------------------------------------

  describe('deployProceduresOnly', () => {
    it('preserves every custom validation row and every pre-existing IsEnabled value', async () => {
      await connection.query(
        `INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled)
         VALUES (?, 'CustomSiteRule', 'site-authored', 'x', 'SELECT 1;', '', TRUE)`,
        [CUSTOM_VALIDATION_ID]
      );
      await connection.query(`UPDATE sitespecificvalidations SET IsEnabled = FALSE WHERE ValidationID = ?`, [TOGGLED_VALIDATION_ID]);

      await deployProceduresOnly(connection, schema, procedureStatements);

      const [custom] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM sitespecificvalidations WHERE ValidationID = ?`, [
        CUSTOM_VALIDATION_ID
      ]);
      expect(Number(custom[0].n), 'a procedures-only deploy must not truncate validations').toBe(1);

      const toggled = await isEnabled(TOGGLED_VALIDATION_ID);
      expect(toggled, 'a site toggle set before the deploy must survive it').toBe(false);
    }, 60000);

    it('redeploys the full REQUIRED_PROCEDURES contract and leaves it verifiable via information_schema', async () => {
      await connection.query(`DROP PROCEDURE IF EXISTS ${VALIDATION_19_HELPER}`);
      const [before] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ?`,
        [schema, VALIDATION_19_HELPER]
      );
      expect(Number(before[0].n), 'setup must actually have dropped the helper').toBe(0);

      await deployProceduresOnly(connection, schema, procedureStatements);

      const [after] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS n FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ?`,
        [schema, VALIDATION_19_HELPER]
      );
      expect(Number(after[0].n), 'deployProceduresOnly must recreate a dropped required procedure').toBe(1);
    }, 60000);

    it('never reads or executes corequeries.sql (no truncate of sitespecificvalidations)', async () => {
      const [beforeCount] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM sitespecificvalidations`);
      const before = Number(beforeCount[0].n);
      expect(before, 'the fixture schema must already carry seeded validations').toBeGreaterThan(0);

      await deployProceduresOnly(connection, schema, procedureStatements);

      const [afterCount] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM sitespecificvalidations`);
      expect(Number(afterCount[0].n), 'sitespecificvalidations row count must be unchanged').toBe(before);
    }, 60000);
  });

  // -------------------------------------------------------------------------
  // activateValidation19
  // -------------------------------------------------------------------------

  describe('seeded default', () => {
    it('ships validation 19 DISABLED on a freshly provisioned schema', () => {
      // Regression guard. corequeries.sql is applied by
      // deploy-validations-to-all-schemas in its default legacy-full-reset mode,
      // which truncates and reseeds sitespecificvalidations on every schema. When
      // this seed said TRUE it enabled validation 19 across all 12 production
      // schemas on 2026-08-28, overriding the migration's disabled seed. Enabling
      // is meant to go through activateValidation19's gated path only.
      expect(seededValidation19Enabled, 'validation 19 row must exist on a fresh schema').not.toBeNull();
      expect(seededValidation19Enabled, 'a fresh schema must NOT ship validation 19 enabled').toBe(false);
    });
  });

  describe('activateValidation19', () => {
    it('enables validation 19 and verifies the row is enabled after UPDATE', async () => {
      expect(await isEnabled(19), 'beforeEach must start validation 19 disabled').toBe(false);

      await activateValidation19(connection, schema);

      expect(await isEnabled(19), 'activation must persist IsEnabled = TRUE').toBe(true);
    }, 60000);

    it('refuses to activate validation 19 without its helper procedure', async () => {
      await connection.query(`DROP PROCEDURE IF EXISTS ${VALIDATION_19_HELPER}`);

      await expect(activateValidation19(connection, schema)).rejects.toThrow(new RegExp(VALIDATION_19_HELPER));

      expect(await isEnabled(19), 'must stay disabled when the helper is missing').toBe(false);

      // restore for subsequent tests in this file
      await deployProceduresOnly(connection, schema, procedureStatements);
    }, 60000);

    it('refuses activation after any partial procedure deployment (unrelated procedure missing)', async () => {
      await connection.query(`DROP PROCEDURE IF EXISTS ${VALIDATION_19_UNRELATED_PROCEDURE}`);

      await expect(activateValidation19(connection, schema)).rejects.toThrow(new RegExp(VALIDATION_19_UNRELATED_PROCEDURE));

      expect(await isEnabled(19), 'activation requires the complete procedure contract, not just the plot-coordinate helper').toBe(false);

      // restore for subsequent tests in this file
      await deployProceduresOnly(connection, schema, procedureStatements);
    }, 60000);

    it('refuses activation when the validation 19 row is missing', async () => {
      await connection.query(`DELETE FROM sitespecificvalidations WHERE ValidationID = 19`);

      await expect(activateValidation19(connection, schema)).rejects.toThrow(/validation 19|identity/i);
    }, 60000);

    it('refuses activation when ValidationID 19 conflicts with a different procedure identity', async () => {
      await connection.query(`DELETE FROM sitespecificvalidations WHERE ValidationID = 19`);
      await connection.query(
        `INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled)
         VALUES (19, 'CustomSiteRule', 'custom', 'x', 'SELECT 1', '', FALSE)`
      );

      await expect(activateValidation19(connection, schema)).rejects.toThrow(/identity/i);

      expect(await isEnabled(19), 'a conflicting identity must never be flipped on').toBe(false);
    }, 60000);

    it('refuses activation when the identity matches but the executable definition is malformed', async () => {
      await connection.query(`UPDATE sitespecificvalidations SET Definition = 'SELECT 1;' WHERE ValidationID = 19`);

      await expect(activateValidation19(connection, schema)).rejects.toThrow(/repository contract/i);

      expect(await isEnabled(19), 'a malformed rule must never be enabled').toBe(false);
    }, 60000);

    it('refuses activation when the measurement_errors row for validation 19 is missing', async () => {
      await connection.query(`DELETE FROM measurement_errors WHERE ErrorSource = 'validation' AND ErrorCode = '19'`);

      await expect(activateValidation19(connection, schema)).rejects.toThrow(/measurement_errors|error/i);

      expect(await isEnabled(19)).toBe(false);

      // restore for subsequent tests in this file
      await connection.query(`INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
                               VALUES ('validation', '19', 'Validation ValidatePlotCoordinateConsistency')`);
    }, 60000);

    it('validates the schema name before issuing any SQL', async () => {
      await expect(activateValidation19(connection, 'forestgeo_test; DROP TABLE sitespecificvalidations; --')).rejects.toThrow(/invalid|unauthorized/i);
    }, 60000);
  });
});
