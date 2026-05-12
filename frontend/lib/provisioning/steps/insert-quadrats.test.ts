import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { insertQuadratsStep } from './insert-quadrats';
import { createSchemaStep, initTablesStep } from './sql-steps';
import { insertPlotStep } from './catalog-and-rows';
import type { StepContext, ProvisioningInput, QuadratCsvRow } from '../types';

function makeInput(quadrats: ProvisioningInput['quadrats']): ProvisioningInput {
  return {
    site: {
      siteName: 'QuadTest',
      schemaName: '',
      sqDimX: 5,
      sqDimY: 5,
      defaultUOMDBH: 'mm',
      defaultUOMHOM: 'm',
      doubleDataEntry: false,
      location: 'QuadLocation',
      country: 'QuadCountry'
    },
    plot: {
      plotName: 'P',
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
    quadrats
  };
}

describe('insertQuadratsStep', () => {
  const SCHEMA_NAME = `forestgeo_quadrats_test_${process.pid}`;
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

    const input = makeInput({
      mode: 'grid',
      quadratSizeX: 20,
      quadratSizeY: 20,
      namingPattern: 'sequential'
    });
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

    await createSchemaStep.run(ctx);
    await initTablesStep.run(ctx);
    await insertPlotStep.run(ctx);
  });

  afterAll(async () => {
    await catalogPool.query(`DROP DATABASE IF EXISTS \`${SCHEMA_NAME}\``);
    if (ctx.sitePool) await ctx.sitePool.end();
    await catalogPool.end();
  });

  it('grid mode: alreadyDone false → run → 25 rows → alreadyDone true', async () => {
    expect(await insertQuadratsStep.alreadyDone(ctx)).toBe(false);
    await insertQuadratsStep.run(ctx);
    expect(await insertQuadratsStep.alreadyDone(ctx)).toBe(true);

    const [rows]: any = await ctx.sitePool!.query(`SELECT COUNT(*) AS c FROM \`${SCHEMA_NAME}\`.quadrats WHERE PlotID = ?`, [ctx.state.plotId]);
    expect(Number(rows[0]?.c ?? rows[0]?.C)).toBe(25);
  });

  it('partial state: delete-and-reinsert recovers', async () => {
    // Delete some quadrats to simulate partial insert
    await ctx.sitePool!.query(`DELETE FROM \`${SCHEMA_NAME}\`.quadrats WHERE PlotID = ? LIMIT 5`, [ctx.state.plotId]);
    expect(await insertQuadratsStep.alreadyDone(ctx)).toBe(false);
    await insertQuadratsStep.run(ctx);
    expect(await insertQuadratsStep.alreadyDone(ctx)).toBe(true);
  });

  it('csv mode: inserts exactly the supplied rows', async () => {
    const csvRows: QuadratCsvRow[] = [
      { quadratName: 'A', startX: 0, startY: 0, dimensionX: 50, dimensionY: 50 },
      { quadratName: 'B', startX: 50, startY: 50, dimensionX: 50, dimensionY: 50 }
    ];
    const csvCtx: StepContext = {
      ...ctx,
      input: makeInput({ mode: 'csv', rows: csvRows })
    };
    csvCtx.input.site.schemaName = SCHEMA_NAME;
    csvCtx.state = { plotId: ctx.state.plotId };

    expect(await insertQuadratsStep.alreadyDone(csvCtx)).toBe(false);
    await insertQuadratsStep.run(csvCtx);
    expect(await insertQuadratsStep.alreadyDone(csvCtx)).toBe(true);

    const [rows]: any = await ctx.sitePool!.query(`SELECT QuadratName FROM \`${SCHEMA_NAME}\`.quadrats WHERE PlotID = ? ORDER BY QuadratName`, [
      ctx.state.plotId
    ]);
    const names = rows.map((r: any) => r.QuadratName ?? r.quadratname);
    expect(names).toEqual(['A', 'B']);
  });
});
