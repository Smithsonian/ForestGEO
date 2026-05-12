import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { validateInputsStep } from './validate-inputs';
import type { StepContext, ProvisioningInput } from '../types';

const CATALOG_SCHEMA = 'catalog';

function makeInput(overrides: Partial<ProvisioningInput> = {}): ProvisioningInput {
  return {
    site: {
      siteName: 'Rabi',
      schemaName: 'forestgeo_rabi_validinputs_test',
      sqDimX: 5,
      sqDimY: 5,
      defaultUOMDBH: 'mm',
      defaultUOMHOM: 'm',
      doubleDataEntry: false,
      location: 'Rabi',
      country: 'Gabon'
    },
    plot: {
      plotName: 'Main',
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
    quadrats: { mode: 'grid', quadratSizeX: 20, quadratSizeY: 20, namingPattern: 'sequential' },
    ...overrides
  };
}

function makeCtx(input: ProvisioningInput, pool: any): StepContext {
  return {
    runId: 1,
    schemaName: input.site.schemaName,
    input,
    catalogPool: pool,
    sitePool: null,
    state: {},
    logger: { info: () => {}, error: () => {} }
  };
}

describe('validateInputsStep', () => {
  let pool: mysql.Pool;

  beforeAll(async () => {
    pool = mysql.createPool({
      host: process.env.TEST_DB_HOST || 'localhost',
      port: Number(process.env.TEST_DB_PORT || 3306),
      user: process.env.TEST_DB_USER || 'root',
      password: process.env.TEST_DB_PASSWORD || 'testpassword',
      multipleStatements: false,
      connectionLimit: 5
    });
    // Ensure catalog schema and sites table exist (shared schema; create-if-missing for safety)
    await pool.query(`CREATE DATABASE IF NOT EXISTS ${CATALOG_SCHEMA} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${CATALOG_SCHEMA}.sites (
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
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM ${CATALOG_SCHEMA}.sites WHERE SchemaName LIKE 'forestgeo_%_validinputs_test'`);
    await pool.end();
  });

  it('accepts a valid happy-path input', async () => {
    const ctx = makeCtx(makeInput(), pool);
    await expect(validateInputsStep.run(ctx)).resolves.toBeUndefined();
  });

  it('rejects invalid schema name', async () => {
    const ctx = makeCtx(
      makeInput({
        site: { ...makeInput().site, schemaName: 'badschema' }
      }),
      pool
    );
    await expect(validateInputsStep.run(ctx)).rejects.toThrow(/must match/);
  });

  it('rejects when catalog.sites already has the schema', async () => {
    const dupSchemaName = 'forestgeo_existing_validinputs_test';
    await pool.query(
      `INSERT INTO ${CATALOG_SCHEMA}.sites (SiteName, SchemaName, SQDimX, SQDimY, DefaultUOMDBH, DefaultUOMHOM, DoubleDataEntry)
       VALUES ('Existing', ?, 5, 5, 'mm', 'm', 0)`,
      [dupSchemaName]
    );
    try {
      const ctx = makeCtx(
        makeInput({
          site: { ...makeInput().site, schemaName: dupSchemaName }
        }),
        pool
      );
      await expect(validateInputsStep.run(ctx)).rejects.toThrow(/already references/);
    } finally {
      await pool.query(`DELETE FROM ${CATALOG_SCHEMA}.sites WHERE SchemaName = ?`, [dupSchemaName]);
    }
  });

  it('rejects when schema exists in MySQL but not catalog', async () => {
    const orphanSchema = 'forestgeo_orphan_validinputs_test';
    await pool.query(`CREATE DATABASE IF NOT EXISTS ${orphanSchema}`);
    try {
      const ctx = makeCtx(
        makeInput({
          site: { ...makeInput().site, schemaName: orphanSchema }
        }),
        pool
      );
      await expect(validateInputsStep.run(ctx)).rejects.toThrow(/already exists in MySQL/);
    } finally {
      await pool.query(`DROP DATABASE IF EXISTS ${orphanSchema}`);
    }
  });

  it('rejects non-divisible grid in X', async () => {
    const ctx = makeCtx(
      makeInput({
        plot: { ...makeInput().plot, dimensionX: 105 }
      }),
      pool
    );
    await expect(validateInputsStep.run(ctx)).rejects.toThrow(/dimensionX.*not divisible/);
  });

  it('rejects non-divisible grid in Y', async () => {
    const ctx = makeCtx(
      makeInput({
        plot: { ...makeInput().plot, dimensionY: 105 }
      }),
      pool
    );
    await expect(validateInputsStep.run(ctx)).rejects.toThrow(/dimensionY.*not divisible/);
  });

  it('rejects overlapping CSV rows', async () => {
    const ctx = makeCtx(
      makeInput({
        quadrats: {
          mode: 'csv',
          rows: [
            { quadratName: 'A', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 },
            { quadratName: 'B', startX: 10, startY: 10, dimensionX: 20, dimensionY: 20 }
          ]
        }
      }),
      pool
    );
    await expect(validateInputsStep.run(ctx)).rejects.toThrow(/overlap/);
  });

  it('rejects out-of-bounds CSV rows (X)', async () => {
    const ctx = makeCtx(
      makeInput({
        quadrats: {
          mode: 'csv',
          rows: [{ quadratName: 'A', startX: 90, startY: 0, dimensionX: 20, dimensionY: 20 }]
        }
      }),
      pool
    );
    await expect(validateInputsStep.run(ctx)).rejects.toThrow(/extends past plot dimensionX/);
  });

  it('rejects out-of-bounds CSV rows (Y)', async () => {
    const ctx = makeCtx(
      makeInput({
        quadrats: {
          mode: 'csv',
          rows: [{ quadratName: 'A', startX: 0, startY: 90, dimensionX: 20, dimensionY: 20 }]
        }
      }),
      pool
    );
    await expect(validateInputsStep.run(ctx)).rejects.toThrow(/extends past plot dimensionY/);
  });

  it('rejects negative start coordinates', async () => {
    const ctx = makeCtx(
      makeInput({
        quadrats: {
          mode: 'csv',
          rows: [{ quadratName: 'A', startX: -5, startY: 0, dimensionX: 20, dimensionY: 20 }]
        }
      }),
      pool
    );
    await expect(validateInputsStep.run(ctx)).rejects.toThrow(/negative start/);
  });

  it('accepts valid CSV rows that tile the plot', async () => {
    const ctx = makeCtx(
      makeInput({
        quadrats: {
          mode: 'csv',
          rows: [
            { quadratName: 'A', startX: 0, startY: 0, dimensionX: 50, dimensionY: 100 },
            { quadratName: 'B', startX: 50, startY: 0, dimensionX: 50, dimensionY: 100 }
          ]
        }
      }),
      pool
    );
    await expect(validateInputsStep.run(ctx)).resolves.toBeUndefined();
  });

  it('alreadyDone always returns false', async () => {
    const ctx = makeCtx(makeInput(), pool);
    expect(await validateInputsStep.alreadyDone(ctx)).toBe(false);
  });
});
