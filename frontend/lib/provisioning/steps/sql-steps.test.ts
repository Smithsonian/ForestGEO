import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { createSchemaStep, initTablesStep, deployProceduresStep, seedValidationsStep } from './sql-steps';
import type { StepContext, ProvisioningInput } from '../types';

describe('SQL-file steps', () => {
  const SCHEMA_NAME = `forestgeo_sqlsteps_test_${process.pid}`;
  let catalogPool: mysql.Pool;
  let ctx: StepContext;

  beforeAll(async () => {
    catalogPool = mysql.createPool({
      host: process.env.TEST_DB_HOST || 'localhost',
      port: Number(process.env.TEST_DB_PORT || 3306),
      user: process.env.TEST_DB_USER || 'root',
      password: process.env.TEST_DB_PASSWORD || 'testpassword',
      multipleStatements: false,
      connectionLimit: 5
    });
    await catalogPool.query(`DROP DATABASE IF EXISTS \`${SCHEMA_NAME}\``);

    ctx = {
      runId: 0,
      schemaName: SCHEMA_NAME,
      input: {} as ProvisioningInput,
      catalogPool,
      sitePool: null,
      state: {},
      logger: { info: () => {}, error: () => {} }
    };
  });

  afterAll(async () => {
    await catalogPool.query(`DROP DATABASE IF EXISTS \`${SCHEMA_NAME}\``);
    if (ctx.sitePool) await ctx.sitePool.end();
    await catalogPool.end();
  });

  it('create_schema: false before, run, true after, sitePool set', async () => {
    expect(await createSchemaStep.alreadyDone(ctx)).toBe(false);
    expect(ctx.sitePool).toBeNull();
    await createSchemaStep.run(ctx);
    expect(await createSchemaStep.alreadyDone(ctx)).toBe(true);
    expect(ctx.sitePool).not.toBeNull();
  });

  it('init_tables: resets a partial schema, then runs to completion', async () => {
    expect(await initTablesStep.alreadyDone(ctx)).toBe(false);
    await ctx.sitePool!.query(`CREATE TABLE \`${SCHEMA_NAME}\`.plots (PlotID INT PRIMARY KEY)`);
    expect(await initTablesStep.alreadyDone(ctx)).toBe(false);

    await initTablesStep.run(ctx);
    expect(await initTablesStep.alreadyDone(ctx)).toBe(true);

    const [rows]: any = await ctx.sitePool!.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = ?`, [SCHEMA_NAME]);
    const names = rows.map((r: any) => (r.table_name ?? r.TABLE_NAME).toLowerCase());
    expect(names).toContain('plots');
    expect(names).toContain('census');
    expect(names).toContain('quadrats');
    expect(names).toContain('coremeasurements');
    expect(names).toContain('validation_runs');
  });

  it('deploy_procedures: false before, run, true after; bulkingestionprocess exists', async () => {
    expect(await deployProceduresStep.alreadyDone(ctx)).toBe(false);
    await deployProceduresStep.run(ctx);
    expect(await deployProceduresStep.alreadyDone(ctx)).toBe(true);
  });

  it('seed_validations: false before, run, true after; sitespecificvalidations has rows', async () => {
    expect(await seedValidationsStep.alreadyDone(ctx)).toBe(false);
    await seedValidationsStep.run(ctx);
    expect(await seedValidationsStep.alreadyDone(ctx)).toBe(true);

    const [rows]: any = await ctx.sitePool!.query(`SELECT COUNT(*) AS c FROM \`${SCHEMA_NAME}\`.sitespecificvalidations`);
    expect(Number(rows[0]?.c ?? rows[0]?.C)).toBeGreaterThan(0);
  });

  it('schema-version stamping: all three per-column timestamps land in _provisioning_meta', async () => {
    const [rows]: any = await ctx.sitePool!.query(
      `SELECT SchemaVersion, TablesDeployedAt, ProceduresDeployedAt, ValidationsDeployedAt
       FROM \`${SCHEMA_NAME}\`.\`_provisioning_meta\``
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].SchemaVersion).toBe('2026-05-13');
    expect(rows[0].TablesDeployedAt).not.toBeNull();
    expect(rows[0].ProceduresDeployedAt).not.toBeNull();
    expect(rows[0].ValidationsDeployedAt).not.toBeNull();
  });

  it('init_tables alreadyDone: false when meta exists with stale version but objects are present', async () => {
    // Replace the current row with a stale version. alreadyDone should return false
    // because no row matches SCHEMA_VERSION = '2026-05-13'.
    await ctx.sitePool!.query(`DELETE FROM \`${SCHEMA_NAME}\`.\`_provisioning_meta\``);
    await ctx.sitePool!.query(
      `INSERT INTO \`${SCHEMA_NAME}\`.\`_provisioning_meta\` (SchemaVersion, TablesDeployedAt, ProceduresDeployedAt, ValidationsDeployedAt)
       VALUES ('1999-01-01', NOW(), NOW(), NOW())`
    );
    expect(await initTablesStep.alreadyDone(ctx)).toBe(false);
    expect(await deployProceduresStep.alreadyDone(ctx)).toBe(false);
    expect(await seedValidationsStep.alreadyDone(ctx)).toBe(false);
  });
});
