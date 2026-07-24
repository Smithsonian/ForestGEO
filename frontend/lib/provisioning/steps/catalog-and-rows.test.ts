import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { insertCatalogRowStep, insertPlotStep, insertCensusStep } from './catalog-and-rows';
import { createSchemaStep, initTablesStep } from './sql-steps';
import type { StepContext, ProvisioningInput } from '../types';

function makeInput(): ProvisioningInput {
  return {
    site: {
      siteName: 'CatTest',
      schemaName: '', // filled in below
      sqDimX: 5,
      sqDimY: 5,
      defaultUOMDBH: 'mm',
      defaultUOMHOM: 'm',
      doubleDataEntry: false,
      location: 'CatTest Town',
      country: 'CatLand'
    },
    plot: {
      plotName: 'MainPlot',
      dimensionX: 100,
      dimensionY: 100,
      area: 10000,
      globalX: 0,
      globalY: 0,
      globalZ: 0,
      plotShape: 'square',
      description: 'Test plot',
      defaultDimensionUnits: 'm',
      defaultCoordinateUnits: 'm',
      defaultAreaUnits: 'm2',
      defaultDBHUnits: 'mm',
      defaultHOMUnits: 'm'
    },
    quadrats: { mode: 'grid', quadratSizeX: 20, quadratSizeY: 20, namingPattern: 'sequential' }
  };
}

describe('catalog + plot + census steps', () => {
  const SCHEMA_NAME = `forestgeo_catrows_test_${process.pid}`;
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

    // Ensure catalog schema and sites table exist (may already be there from other test runs)
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

    // Remove any leftover catalog.sites row from a previous aborted run for this schema
    await catalogPool.query(`DELETE FROM catalog.sites WHERE SchemaName = ?`, [SCHEMA_NAME]);

    const input = makeInput();
    input.site.schemaName = SCHEMA_NAME;
    ctx = {
      runId: 0,
      schemaName: SCHEMA_NAME,
      input,
      catalogPool,
      sitePool: null,
      state: {},
      logger: { info: () => {}, error: () => {} }
    };

    // Initialize the schema and core tables using the Task-5 steps
    await createSchemaStep.run(ctx);
    await initTablesStep.run(ctx);
  });

  afterAll(async () => {
    await catalogPool.query(`DELETE FROM catalog.sites WHERE SchemaName = ?`, [SCHEMA_NAME]);
    await catalogPool.query(`DROP DATABASE IF EXISTS \`${SCHEMA_NAME}\``);
    if (ctx.sitePool) await ctx.sitePool.end();
    await catalogPool.end();
  });

  it('insert_catalog_row: alreadyDone returns false before insertion', async () => {
    expect(await insertCatalogRowStep.alreadyDone(ctx)).toBe(false);
  });

  it('insert_catalog_row: run inserts row and writes state.siteId', async () => {
    await insertCatalogRowStep.run(ctx);
    expect(ctx.state.siteId).toBeGreaterThan(0);
  });

  it('insert_catalog_row: alreadyDone returns true after insertion', async () => {
    expect(await insertCatalogRowStep.alreadyDone(ctx)).toBe(true);
  });

  it('insert_catalog_row idempotent: alreadyDone on fresh state reloads siteId', async () => {
    const freshState: Record<string, unknown> = {};
    const ctxFresh: StepContext = { ...ctx, state: freshState };
    expect(await insertCatalogRowStep.alreadyDone(ctxFresh)).toBe(true);
    expect(ctxFresh.state.siteId).toBeGreaterThan(0);
  });

  it('insert_plot: alreadyDone returns false before insertion', async () => {
    expect(await insertPlotStep.alreadyDone(ctx)).toBe(false);
  });

  it('insert_plot: run inserts row and writes state.plotId', async () => {
    await insertPlotStep.run(ctx);
    expect(ctx.state.plotId).toBeGreaterThan(0);
  });

  it('insert_plot: alreadyDone returns true after insertion', async () => {
    expect(await insertPlotStep.alreadyDone(ctx)).toBe(true);
  });

  it('insert_plot idempotent: alreadyDone on fresh state reloads plotId', async () => {
    const freshState: Record<string, unknown> = {};
    const ctxFresh: StepContext = { ...ctx, state: freshState };
    expect(await insertPlotStep.alreadyDone(ctxFresh)).toBe(true);
    expect(ctxFresh.state.plotId).toBeGreaterThan(0);
  });

  it('insert_census: alreadyDone returns false before insertion', async () => {
    expect(await insertCensusStep.alreadyDone(ctx)).toBe(false);
  });

  it('insert_census: run inserts row with PlotCensusNumber=1 and writes state.censusId', async () => {
    await insertCensusStep.run(ctx);
    expect(ctx.state.censusId).toBeGreaterThan(0);

    // Verify the DB row has PlotCensusNumber = 1 and correct PlotID
    const [rows]: any = await ctx.sitePool!.query(`SELECT PlotID, PlotCensusNumber, IsActive FROM \`${SCHEMA_NAME}\`.census WHERE CensusID = ?`, [
      ctx.state.censusId
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].PlotID).toBe(ctx.state.plotId);
    expect(rows[0].PlotCensusNumber).toBe(1);
    expect(rows[0].IsActive).toBe(1);
  });

  it('insert_census: alreadyDone returns true after insertion', async () => {
    expect(await insertCensusStep.alreadyDone(ctx)).toBe(true);
  });

  it('insert_census idempotent: alreadyDone on state with only plotId reloads censusId', async () => {
    const partialState: Record<string, unknown> = { plotId: ctx.state.plotId };
    const ctxFresh: StepContext = { ...ctx, state: partialState };
    expect(await insertCensusStep.alreadyDone(ctxFresh)).toBe(true);
    expect(ctxFresh.state.censusId).toBeGreaterThan(0);
  });

  it('end-to-end: catalog/plot/census triple is consistent', async () => {
    // Verify catalog row references the correct schema
    const [siteRows]: any = await catalogPool.query(`SELECT SiteName, SchemaName FROM catalog.sites WHERE SiteID = ?`, [ctx.state.siteId]);
    expect(siteRows).toHaveLength(1);
    expect(siteRows[0].SchemaName).toBe(SCHEMA_NAME);
    expect(siteRows[0].SiteName).toBe('CatTest');

    // Verify census links back to plot
    const [censusRows]: any = await ctx.sitePool!.query(
      `SELECT c.PlotID, c.PlotCensusNumber, p.PlotName
       FROM \`${SCHEMA_NAME}\`.census c
       JOIN \`${SCHEMA_NAME}\`.plots p ON p.PlotID = c.PlotID
       WHERE c.CensusID = ?`,
      [ctx.state.censusId]
    );
    expect(censusRows).toHaveLength(1);
    expect(censusRows[0].PlotName).toBe('MainPlot');
    expect(censusRows[0].PlotCensusNumber).toBe(1);
  });
});
