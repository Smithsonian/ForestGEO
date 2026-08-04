/**
 * Global plot coordinates: projected (UTM-scale) origins must survive provisioning
 * end to end (integration, real MySQL).
 *
 * Regression for provisioning run 5 (forestgeo_ldw, 2026-08-04): the admin entered
 * the plot origin as NAD83 / UTM zone 16N meters and insert_plot died with
 * "Out of range value for column 'GlobalY' at row 1" because plots.GlobalY was
 * DECIMAL(12,6) (ceiling 999,999.999999) — and viewfulltable's PlotGlobal* copies
 * were DECIMAL(10,6), too narrow for even a UTM easting.
 *
 * Two proofs:
 *  1. The 2026-08-04 manifest migrations, applied to a schema with the legacy
 *     narrow columns, widen all six to DECIMAL(15,6) and add GlobalCoordinatesEPSG.
 *     (The manifest-convergence test only checks object EXISTENCE, so the type
 *     change is asserted here or nowhere.)
 *  2. The real provisioning steps (tablestructures.sql → storedprocedures.sql →
 *     insert_plot → insert_census) accept the forestgeo_ldw values, and
 *     RefreshViewFullTable carries them into viewfulltable unclamped.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { createTestPool, TEST_SCHEMA_PREFIX } from './_shared';

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { createSchemaStep, initTablesStep, deployProceduresStep } from '@/lib/provisioning/steps/sql-steps';
import { insertPlotStep, insertCensusStep } from '@/lib/provisioning/steps/catalog-and-rows';
import type { StepContext, ProvisioningInput } from '@/lib/provisioning/types';

const MIGRATION_SCHEMA = TEST_SCHEMA_PREFIX + 'coordwiden';
const PROVISION_SCHEMA = TEST_SCHEMA_PREFIX + 'utmcoords';

const WIDEN_MIGRATION_PATH = path.join(process.cwd(), 'db/migrations/schema-contract-repair/2026-08-04-01-widen-plot-global-coordinates.sql');
const EPSG_MIGRATION_PATH = path.join(process.cwd(), 'db/migrations/schema-contract-repair/2026-08-04-02-add-plot-coordinate-epsg.sql');

const WIDENED_COLUMN_TYPE = 'decimal(15,6)';
const EPSG_COLUMN_TYPE = 'int unsigned';

// forestgeo_ldw's real origin: NAD83 / UTM zone 16N (EPSG:26916).
const UTM_EASTING = 567225;
const UTM_NORTHING = 4343000;
const ELEVATION_M = 224;
const NAD83_UTM_ZONE_16N_EPSG = 26916;

const LDW_LIKE_INPUT: ProvisioningInput = {
  site: {
    siteName: 'UTM Coordinate Site',
    schemaName: PROVISION_SCHEMA,
    sqDimX: 20,
    sqDimY: 20,
    defaultUOMDBH: 'mm',
    defaultUOMHOM: 'm',
    doubleDataEntry: false,
    location: 'Indiana',
    country: 'USA'
  },
  plot: {
    plotName: 'UTM Plot',
    dimensionX: 500,
    dimensionY: 500,
    area: 250000,
    globalX: UTM_EASTING,
    globalY: UTM_NORTHING,
    globalZ: ELEVATION_M,
    globalCoordinatesEPSG: NAD83_UTM_ZONE_16N_EPSG,
    plotShape: 'square',
    description: 'Origin entered as projected meters',
    defaultDimensionUnits: 'm',
    defaultCoordinateUnits: 'm',
    defaultAreaUnits: 'm2',
    defaultDBHUnits: 'mm',
    defaultHOMUnits: 'm'
  },
  quadrats: { mode: 'none' }
};

async function executeMigrationFile(connection: Connection, filePath: string): Promise<void> {
  // apply-schema-migrations executes each migration file whole over a
  // multipleStatements connection (`exec(source.contents)`); applying it the
  // same way keeps this a test of the file the runner will actually run.
  await connection.query(fs.readFileSync(filePath, 'utf-8'));
}

async function readColumnTypes(connection: Connection, schema: string, table: string, columns: string[]): Promise<Record<string, string>> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME IN (?)`,
    [schema, table, columns]
  );
  return Object.fromEntries(rows.map(row => [String(row.COLUMN_NAME), String(row.COLUMN_TYPE)]));
}

describe('widen-plot-global-coordinates migration on a legacy narrow schema', () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = await mysql.createConnection({
      host: process.env.TEST_DB_HOST || 'localhost',
      port: Number(process.env.TEST_DB_PORT || 3306),
      user: process.env.TEST_DB_USER || 'root',
      password: process.env.TEST_DB_PASSWORD || 'testpassword',
      // apply-schema-migrations runs each migration file whole; mirror that.
      multipleStatements: true
    });
    await connection.query(`DROP DATABASE IF EXISTS \`${MIGRATION_SCHEMA}\``);
    await connection.query(`CREATE DATABASE \`${MIGRATION_SCHEMA}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await connection.query(`USE \`${MIGRATION_SCHEMA}\``);
    // The pre-migration shapes exactly as live schemas held them.
    await connection.query(`
      CREATE TABLE plots (
        PlotID INT AUTO_INCREMENT PRIMARY KEY,
        GlobalX DECIMAL(12,6) NULL,
        GlobalY DECIMAL(12,6) NULL,
        GlobalZ DECIMAL(12,6) NULL
      )`);
    await connection.query(`
      CREATE TABLE viewfulltable (
        CoreMeasurementID INT AUTO_INCREMENT PRIMARY KEY,
        PlotGlobalX DECIMAL(10,6) NULL,
        PlotGlobalY DECIMAL(10,6) NULL,
        PlotGlobalZ DECIMAL(10,6) NULL
      )`);
  });

  afterAll(async () => {
    await connection.query(`DROP DATABASE IF EXISTS \`${MIGRATION_SCHEMA}\``);
    await connection.end();
  });

  it('widens all six columns to DECIMAL(15,6) and adds GlobalCoordinatesEPSG', async () => {
    await executeMigrationFile(connection, WIDEN_MIGRATION_PATH);
    await executeMigrationFile(connection, EPSG_MIGRATION_PATH);

    const plotTypes = await readColumnTypes(connection, MIGRATION_SCHEMA, 'plots', ['GlobalX', 'GlobalY', 'GlobalZ', 'GlobalCoordinatesEPSG']);
    expect(plotTypes).toEqual({
      GlobalX: WIDENED_COLUMN_TYPE,
      GlobalY: WIDENED_COLUMN_TYPE,
      GlobalZ: WIDENED_COLUMN_TYPE,
      GlobalCoordinatesEPSG: EPSG_COLUMN_TYPE
    });

    const vftTypes = await readColumnTypes(connection, MIGRATION_SCHEMA, 'viewfulltable', ['PlotGlobalX', 'PlotGlobalY', 'PlotGlobalZ']);
    expect(vftTypes).toEqual({
      PlotGlobalX: WIDENED_COLUMN_TYPE,
      PlotGlobalY: WIDENED_COLUMN_TYPE,
      PlotGlobalZ: WIDENED_COLUMN_TYPE
    });
  });

  it('is idempotent: a second application leaves the widened types in place', async () => {
    await executeMigrationFile(connection, WIDEN_MIGRATION_PATH);
    await executeMigrationFile(connection, EPSG_MIGRATION_PATH);
    const plotTypes = await readColumnTypes(connection, MIGRATION_SCHEMA, 'plots', ['GlobalX', 'GlobalY', 'GlobalZ']);
    expect(Object.values(plotTypes)).toEqual([WIDENED_COLUMN_TYPE, WIDENED_COLUMN_TYPE, WIDENED_COLUMN_TYPE]);
  });

  it('accepts a UTM northing that overflowed the old column', async () => {
    await connection.query(`INSERT INTO \`${MIGRATION_SCHEMA}\`.plots (GlobalX, GlobalY, GlobalZ) VALUES (?, ?, ?)`, [UTM_EASTING, UTM_NORTHING, ELEVATION_M]);
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT GlobalX, GlobalY, GlobalZ FROM \`${MIGRATION_SCHEMA}\`.plots`);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].GlobalY)).toBe(UTM_NORTHING);
  });
});

describe('provisioning a site whose origin is projected meters (forestgeo_ldw regression)', () => {
  let catalogPool: ReturnType<typeof createTestPool>;
  let ctx: StepContext;

  beforeAll(async () => {
    catalogPool = createTestPool();
    await catalogPool.query(`DROP DATABASE IF EXISTS \`${PROVISION_SCHEMA}\``);
    ctx = {
      runId: 0,
      schemaName: PROVISION_SCHEMA,
      input: LDW_LIKE_INPUT,
      catalogPool,
      sitePool: null,
      state: {},
      logger: { info: () => {}, error: () => {} }
    };
    await createSchemaStep.run(ctx);
    await initTablesStep.run(ctx);
    await deployProceduresStep.run(ctx);
  }, 120_000);

  afterAll(async () => {
    await catalogPool.query(`DROP DATABASE IF EXISTS \`${PROVISION_SCHEMA}\``);
    await ctx.sitePool?.end();
    await catalogPool.end();
  });

  it('insert_plot stores the UTM origin and its EPSG code exactly', async () => {
    await insertPlotStep.run(ctx);

    const [rows]: any = await catalogPool.query(`SELECT GlobalX, GlobalY, GlobalZ, GlobalCoordinatesEPSG FROM \`${PROVISION_SCHEMA}\`.plots WHERE PlotID = ?`, [
      ctx.state.plotId
    ]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].GlobalX)).toBe(UTM_EASTING);
    expect(Number(rows[0].GlobalY)).toBe(UTM_NORTHING);
    expect(Number(rows[0].GlobalZ)).toBe(ELEVATION_M);
    expect(rows[0].GlobalCoordinatesEPSG).toBe(NAD83_UTM_ZONE_16N_EPSG);
  });

  it('RefreshViewFullTable carries the projected origin into viewfulltable unclamped', async () => {
    await insertCensusStep.run(ctx);

    // A raw (StemGUID NULL) measurement is enough: RefreshViewFullTable reaches
    // plots through census.PlotID, so plot columns populate without a stem chain.
    await catalogPool.query(`INSERT INTO \`${PROVISION_SCHEMA}\`.coremeasurements (CensusID, MeasurementDate, MeasuredDBH) VALUES (?, '2026-01-15', 150)`, [
      ctx.state.censusId
    ]);
    await catalogPool.query(`CALL \`${PROVISION_SCHEMA}\`.RefreshViewFullTable()`);

    const [rows]: any = await catalogPool.query(`SELECT PlotGlobalX, PlotGlobalY, PlotGlobalZ FROM \`${PROVISION_SCHEMA}\`.viewfulltable`);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].PlotGlobalX)).toBe(UTM_EASTING);
    expect(Number(rows[0].PlotGlobalY)).toBe(UTM_NORTHING);
    expect(Number(rows[0].PlotGlobalZ)).toBe(ELEVATION_M);
  });
});
