/**
 * Integration tests for the schema-version stamping in provisioning steps.
 *
 * Exercises `alreadyDone` of the three SQL-deploying steps against a real
 * docker-compose MySQL. Verifies they return `false` when the `_provisioning_meta`
 * table is absent, when its `<column>DeployedAt` is NULL, when the
 * `SchemaVersion` row is stale, or when expected objects (tables/procs/validations)
 * are missing. Also verifies `run` writes the per-column timestamp and that the
 * subsequent `alreadyDone` call returns `true`.
 *
 * Tests reuse the catalog pool as the "site pool" — every statement is
 * schema-qualified, so the default-schema mismatch is irrelevant.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { createTestPool, TEST_SCHEMA_PREFIX } from './_shared';

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { initTablesStep, deployProceduresStep, seedValidationsStep } from '@/lib/provisioning/steps/sql-steps';
import type { StepContext, ProvisioningInput } from '@/lib/provisioning/types';

const TEST_SCHEMA = TEST_SCHEMA_PREFIX + 'meta';
const CURRENT_SCHEMA_VERSION = '2026-05-13';
const STALE_SCHEMA_VERSION = '2020-01-01';
const META_TABLE = '_provisioning_meta';
// Mirrors lib/provisioning/steps/sql-steps.ts:EXPECTED_VALIDATION_COUNT.
// Reflects the actual number of validation INSERTs in corequeries.sql.
const EXPECTED_VALIDATION_COUNT = 16;

const REQUIRED_TABLES_FOR_ALREADY_DONE = ['plots', 'census', 'quadrats', 'coremeasurements', 'measurement_errors', 'uploadmetrics', 'validation_runs'] as const;
const REQUIRED_VIEW_FOR_ALREADY_DONE = 'uploaddatalossreport';

describe('schema-version stamping (alreadyDone)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
  });

  beforeEach(async () => {
    await pool.query(`DROP DATABASE IF EXISTS \`${TEST_SCHEMA}\``);
    await pool.query(`CREATE DATABASE \`${TEST_SCHEMA}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  });

  afterAll(async () => {
    await pool.query(`DROP DATABASE IF EXISTS \`${TEST_SCHEMA}\``);
    await pool.end();
  });

  function buildCtx(): StepContext {
    return {
      runId: 0,
      schemaName: TEST_SCHEMA,
      input: {} as ProvisioningInput,
      catalogPool: pool,
      sitePool: pool,
      state: {},
      logger: { info: () => {}, error: () => {} }
    };
  }

  async function createMetaTable(): Promise<void> {
    await pool.query(`
      CREATE TABLE \`${TEST_SCHEMA}\`.\`${META_TABLE}\` (
        SchemaVersion VARCHAR(32) NOT NULL PRIMARY KEY,
        TablesDeployedAt DATETIME NULL,
        ProceduresDeployedAt DATETIME NULL,
        ValidationsDeployedAt DATETIME NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  async function insertMetaRow(
    version: string,
    columns: Partial<{ TablesDeployedAt: boolean; ProceduresDeployedAt: boolean; ValidationsDeployedAt: boolean }> = {}
  ): Promise<void> {
    const cols = ['SchemaVersion'];
    const placeholders = ['?'];
    const values: any[] = [version];
    if (columns.TablesDeployedAt) {
      cols.push('TablesDeployedAt');
      placeholders.push('NOW()');
    }
    if (columns.ProceduresDeployedAt) {
      cols.push('ProceduresDeployedAt');
      placeholders.push('NOW()');
    }
    if (columns.ValidationsDeployedAt) {
      cols.push('ValidationsDeployedAt');
      placeholders.push('NOW()');
    }
    await pool.query(`INSERT INTO \`${TEST_SCHEMA}\`.\`${META_TABLE}\` (${cols.join(',')}) VALUES (${placeholders.join(',')})`, values);
  }

  async function createAllRequiredSchemaObjects(): Promise<void> {
    for (const table of REQUIRED_TABLES_FOR_ALREADY_DONE) {
      await pool.query(`CREATE TABLE \`${TEST_SCHEMA}\`.\`${table}\` (id INT PRIMARY KEY)`);
    }
    // hasRequiredSchemaObjects also checks for the uploaddatalossreport view.
    await pool.query(`CREATE OR REPLACE VIEW \`${TEST_SCHEMA}\`.\`${REQUIRED_VIEW_FOR_ALREADY_DONE}\` AS SELECT 1 AS x`);
  }

  describe('initTablesStep.alreadyDone', () => {
    it('returns false on a brand-new schema (no meta table)', async () => {
      expect(await initTablesStep.alreadyDone(buildCtx())).toBe(false);
    });

    it('returns false when meta table exists but no row for current version', async () => {
      await createMetaTable();
      expect(await initTablesStep.alreadyDone(buildCtx())).toBe(false);
    });

    it('returns false when current-version row exists but TablesDeployedAt is null', async () => {
      await createMetaTable();
      await insertMetaRow(CURRENT_SCHEMA_VERSION);
      expect(await initTablesStep.alreadyDone(buildCtx())).toBe(false);
    });

    it('returns false when SchemaVersion is stale (mismatch)', async () => {
      await createMetaTable();
      await insertMetaRow(STALE_SCHEMA_VERSION, { TablesDeployedAt: true });
      await createAllRequiredSchemaObjects();
      expect(await initTablesStep.alreadyDone(buildCtx())).toBe(false);
    });

    it('returns false when meta is stamped but required tables are missing', async () => {
      await createMetaTable();
      await insertMetaRow(CURRENT_SCHEMA_VERSION, { TablesDeployedAt: true });
      expect(await initTablesStep.alreadyDone(buildCtx())).toBe(false);
    });

    it('returns true when meta has current version + timestamp AND all required objects exist', async () => {
      await createMetaTable();
      await insertMetaRow(CURRENT_SCHEMA_VERSION, { TablesDeployedAt: true });
      await createAllRequiredSchemaObjects();
      expect(await initTablesStep.alreadyDone(buildCtx())).toBe(true);
    });
  });

  describe('deployProceduresStep.alreadyDone', () => {
    it('returns false when sitePool is null', async () => {
      const ctx = buildCtx();
      ctx.sitePool = null;
      expect(await deployProceduresStep.alreadyDone(ctx)).toBe(false);
    });

    it('returns false when meta table is missing', async () => {
      expect(await deployProceduresStep.alreadyDone(buildCtx())).toBe(false);
    });

    it('returns false when ProceduresDeployedAt is null', async () => {
      await createMetaTable();
      await insertMetaRow(CURRENT_SCHEMA_VERSION, { TablesDeployedAt: true });
      expect(await deployProceduresStep.alreadyDone(buildCtx())).toBe(false);
    });

    it('returns false when meta is stamped but only one of N expected procedures exists', async () => {
      await createMetaTable();
      await insertMetaRow(CURRENT_SCHEMA_VERSION, { ProceduresDeployedAt: true });
      // Create exactly one procedure — not all required ones.
      await pool.query(`CREATE PROCEDURE \`${TEST_SCHEMA}\`.bulkingestionprocess() BEGIN SELECT 1; END`);
      expect(await deployProceduresStep.alreadyDone(buildCtx())).toBe(false);
    });

    it('returns true when meta is stamped AND all REQUIRED_PROCEDURES exist', async () => {
      await createMetaTable();
      await insertMetaRow(CURRENT_SCHEMA_VERSION, { ProceduresDeployedAt: true });
      // Create all 10 required procedures (case-insensitive names).
      const procedures = [
        'bulkingestionprocess',
        'bulkingestioncollapser',
        'clearcensusfull',
        'clearcensusmsmts',
        'RefreshMeasurementsSummary',
        'RefreshViewFullTable',
        'RunSharedDBHChangeValidations',
        'RunSharedCrossCensusLocationValidations',
        'reinsertdefaultvalidations',
        'reinsertdefaultpostvalidations'
      ];
      for (const proc of procedures) {
        await pool.query(`CREATE PROCEDURE \`${TEST_SCHEMA}\`.\`${proc}\`() BEGIN SELECT 1; END`);
      }
      expect(await deployProceduresStep.alreadyDone(buildCtx())).toBe(true);
    });
  });

  describe('seedValidationsStep.alreadyDone', () => {
    it('returns false when sitePool is null', async () => {
      const ctx = buildCtx();
      ctx.sitePool = null;
      expect(await seedValidationsStep.alreadyDone(ctx)).toBe(false);
    });

    it('returns false when meta is missing', async () => {
      expect(await seedValidationsStep.alreadyDone(buildCtx())).toBe(false);
    });

    it('returns false when ValidationsDeployedAt is null', async () => {
      await createMetaTable();
      await insertMetaRow(CURRENT_SCHEMA_VERSION, { TablesDeployedAt: true });
      expect(await seedValidationsStep.alreadyDone(buildCtx())).toBe(false);
    });

    it('returns false when meta is stamped but sitespecificvalidations does not exist', async () => {
      await createMetaTable();
      await insertMetaRow(CURRENT_SCHEMA_VERSION, { ValidationsDeployedAt: true });
      expect(await seedValidationsStep.alreadyDone(buildCtx())).toBe(false);
    });

    it('returns false when meta is stamped but count < EXPECTED_VALIDATION_COUNT', async () => {
      await createMetaTable();
      await insertMetaRow(CURRENT_SCHEMA_VERSION, { ValidationsDeployedAt: true });
      await pool.query(`CREATE TABLE \`${TEST_SCHEMA}\`.sitespecificvalidations (ValidationID INT PRIMARY KEY)`);
      // Insert one row — far less than the EXPECTED_VALIDATION_COUNT.
      await pool.query(`INSERT INTO \`${TEST_SCHEMA}\`.sitespecificvalidations (ValidationID) VALUES (1)`);
      expect(await seedValidationsStep.alreadyDone(buildCtx())).toBe(false);
    });

    it('returns true when meta is stamped AND row count >= EXPECTED_VALIDATION_COUNT', async () => {
      await createMetaTable();
      await insertMetaRow(CURRENT_SCHEMA_VERSION, { ValidationsDeployedAt: true });
      await pool.query(`CREATE TABLE \`${TEST_SCHEMA}\`.sitespecificvalidations (ValidationID INT PRIMARY KEY)`);
      const values = Array.from({ length: EXPECTED_VALIDATION_COUNT }, (_, i) => `(${i + 1})`).join(',');
      await pool.query(`INSERT INTO \`${TEST_SCHEMA}\`.sitespecificvalidations (ValidationID) VALUES ${values}`);
      expect(await seedValidationsStep.alreadyDone(buildCtx())).toBe(true);
    });
  });

  describe('run() writes per-column timestamps', () => {
    it('initTablesStep.run stamps TablesDeployedAt and subsequent alreadyDone returns true', async () => {
      const ctx = buildCtx();
      await initTablesStep.run(ctx);
      const [rows]: any = await pool.query(`SELECT SchemaVersion, TablesDeployedAt FROM \`${TEST_SCHEMA}\`.\`${META_TABLE}\``);
      expect(rows).toHaveLength(1);
      expect(rows[0].SchemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(rows[0].TablesDeployedAt).not.toBeNull();
      // alreadyDone should now be true because tablestructures.sql created all required objects.
      expect(await initTablesStep.alreadyDone(ctx)).toBe(true);
    });

    it('deployProceduresStep.run stamps ProceduresDeployedAt', async () => {
      const ctx = buildCtx();
      // Need tables first so procedures can compile against them.
      await initTablesStep.run(ctx);
      await deployProceduresStep.run(ctx);
      const [rows]: any = await pool.query(`SELECT ProceduresDeployedAt FROM \`${TEST_SCHEMA}\`.\`${META_TABLE}\` WHERE SchemaVersion = ?`, [
        CURRENT_SCHEMA_VERSION
      ]);
      expect(rows[0].ProceduresDeployedAt).not.toBeNull();
      expect(await deployProceduresStep.alreadyDone(ctx)).toBe(true);
    });

    it('seedValidationsStep.run stamps ValidationsDeployedAt', async () => {
      const ctx = buildCtx();
      await initTablesStep.run(ctx);
      await deployProceduresStep.run(ctx);
      await seedValidationsStep.run(ctx);
      const [rows]: any = await pool.query(`SELECT ValidationsDeployedAt FROM \`${TEST_SCHEMA}\`.\`${META_TABLE}\` WHERE SchemaVersion = ?`, [
        CURRENT_SCHEMA_VERSION
      ]);
      expect(rows[0].ValidationsDeployedAt).not.toBeNull();
      expect(await seedValidationsStep.alreadyDone(ctx)).toBe(true);
    });
  });
});
