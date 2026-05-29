import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { createSchemaStep, initTablesStep, deployProceduresStep, seedValidationsStep } from './sql-steps';
import { insertCatalogRowStep, insertPlotStep, insertCensusStep } from './catalog-and-rows';
import { insertQuadratsStep } from './insert-quadrats';
import { verifyStep } from './verify';
import { STEPS } from './index';
import type { StepContext, ProvisioningInput } from '../types';

function makeInput(schemaName: string): ProvisioningInput {
  return {
    site: {
      siteName: 'VerifyTest',
      schemaName,
      sqDimX: 5,
      sqDimY: 5,
      defaultUOMDBH: 'mm',
      defaultUOMHOM: 'm',
      doubleDataEntry: false,
      location: 'VL',
      country: 'VC'
    },
    plot: {
      plotName: 'VerifyPlot',
      dimensionX: 100,
      dimensionY: 100,
      area: 10000,
      globalX: 0,
      globalY: 0,
      globalZ: 0,
      plotShape: 'square',
      description: '',
      defaultDimensionUnits: 'm',
      defaultCoordinateUnits: 'm',
      defaultAreaUnits: 'm2',
      defaultDBHUnits: 'mm',
      defaultHOMUnits: 'm'
    },
    quadrats: { mode: 'grid', quadratSizeX: 20, quadratSizeY: 20, namingPattern: 'sequential' }
  };
}

describe('verifyStep', () => {
  const SCHEMA_NAME = `forestgeo_verify_test_${process.pid}`;
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

    // Ensure catalog schema and sites table exist (shared with other step tests)
    await catalogPool.query(`CREATE DATABASE IF NOT EXISTS catalog CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await catalogPool.query(`
      CREATE TABLE IF NOT EXISTS catalog.sites (
        SiteID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        SiteName VARCHAR(255) NOT NULL,
        SchemaName VARCHAR(255) NOT NULL,
        SQDimX INT NOT NULL,
        SQDimY INT NOT NULL,
        DefaultUOMDBH VARCHAR(16) NOT NULL,
        DefaultUOMHOM VARCHAR(16) NOT NULL,
        DoubleDataEntry TINYINT(1) NOT NULL DEFAULT 0
      ) ENGINE=InnoDB
    `);

    // Remove any leftover catalog row from a previous aborted run
    await catalogPool.query(`DELETE FROM catalog.sites WHERE SchemaName = ?`, [SCHEMA_NAME]);

    ctx = {
      runId: 0,
      schemaName: SCHEMA_NAME,
      input: makeInput(SCHEMA_NAME),
      catalogPool,
      sitePool: null,
      state: {},
      logger: { info: () => {}, error: () => {} }
    };

    // Run all preceding steps in order to set up a complete site
    await createSchemaStep.run(ctx);
    await initTablesStep.run(ctx);
    await deployProceduresStep.run(ctx);
    await seedValidationsStep.run(ctx);
    await insertCatalogRowStep.run(ctx);
    await insertPlotStep.run(ctx);
    await insertCensusStep.run(ctx);
    await insertQuadratsStep.run(ctx);
  }, 60_000);

  afterAll(async () => {
    await catalogPool.query(`DELETE FROM catalog.sites WHERE SchemaName = ?`, [SCHEMA_NAME]);
    await catalogPool.query(`DROP DATABASE IF EXISTS \`${SCHEMA_NAME}\``);
    if (ctx.sitePool) await ctx.sitePool.end();
    await catalogPool.end();
  });

  it('alreadyDone returns false (always re-runs)', async () => {
    expect(await verifyStep.alreadyDone(ctx)).toBe(false);
  });

  it('verify resolves when site, plot, census, and quadrats all present', async () => {
    await expect(verifyStep.run(ctx)).resolves.toBeUndefined();
  });

  it('verify throws when catalog row missing', async () => {
    // Temporarily remove catalog row
    await catalogPool.query(`DELETE FROM catalog.sites WHERE SchemaName = ?`, [SCHEMA_NAME]);
    try {
      await expect(verifyStep.run(ctx)).rejects.toThrow(/catalog row/);
    } finally {
      // Restore catalog row so subsequent tests can pass
      await catalogPool.query(
        `INSERT INTO catalog.sites (SiteName, SchemaName, SQDimX, SQDimY, DefaultUOMDBH, DefaultUOMHOM, DoubleDataEntry)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['VerifyTest', SCHEMA_NAME, 5, 5, 'mm', 'm', 0]
      );
    }
  });

  it('STEPS exports 10 steps in canonical order', () => {
    expect(STEPS).toHaveLength(10);
    expect(STEPS.map(s => s.key)).toEqual([
      'validate_inputs',
      'create_schema',
      'init_tables',
      'deploy_procedures',
      'seed_validations',
      'insert_catalog_row',
      'insert_plot',
      'insert_census',
      'insert_quadrats',
      'verify'
    ]);
  });

  it('STEPS does NOT include apply_migrations', () => {
    expect(STEPS.map(s => s.key)).not.toContain('apply_migrations');
  });
});
