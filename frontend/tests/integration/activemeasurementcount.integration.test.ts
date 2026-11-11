/**
 * buildActiveMeasurementCountQuery against real MySQL: inactive rows excluded, multi-census scope summed,
 * another plot's census excluded. Run: npx vitest run --config vitest.integration.config.mts tests/integration/activemeasurementcount.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase } from '../setup/local-db-setup';
import { buildActiveMeasurementCountQuery, readActiveMeasurementCount } from '@/lib/activemeasurementcount';

const CENSUS_A = 9101;
const CENSUS_B = 9102;
const OTHER_PLOT_ID = 9150;
const OTHER_PLOT_CENSUS = 9151;
const ACTIVE_IN_A = 3;
const INACTIVE_IN_A = 2;
const ACTIVE_IN_B = 4;
const ACTIVE_IN_OTHER_PLOT = 5;

describe('active-measurement count (shared builder)', () => {
  let connection: Connection;
  let schema: string;
  let plotID: number;

  async function insertMeasurements(censusID: number, count: number, isActive: boolean): Promise<void> {
    for (let index = 0; index < count; index++) {
      await connection.query('INSERT INTO coremeasurements (CensusID, IsActive, MeasurementDate) VALUES (?, ?, ?)', [censusID, isActive ? 1 : 0, '2024-06-01']);
    }
  }

  async function countFor(plot: number, censusIDs: number[]): Promise<number> {
    const query = buildActiveMeasurementCountQuery(schema, plot, censusIDs);
    const [rows] = await connection.query<RowDataPacket[]>(query.sql, query.params);
    const count = readActiveMeasurementCount(rows);
    console.log('[view-errors active count integration]', JSON.stringify({ plot, censusIDs, count }));
    return count;
  }

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    schema = setup.config.database;
    plotID = setup.testData.plots[0].plotID;
    await connection.query('INSERT INTO census (CensusID, PlotID, PlotCensusNumber) VALUES (?, ?, 91), (?, ?, 92)', [CENSUS_A, plotID, CENSUS_B, plotID]);
    await connection.query('INSERT INTO plots (PlotID, PlotName) VALUES (?, ?)', [OTHER_PLOT_ID, 'Other plot']);
    await connection.query('INSERT INTO census (CensusID, PlotID, PlotCensusNumber) VALUES (?, ?, 1)', [OTHER_PLOT_CENSUS, OTHER_PLOT_ID]);
    await insertMeasurements(CENSUS_A, ACTIVE_IN_A, true);
    await insertMeasurements(CENSUS_A, INACTIVE_IN_A, false);
    await insertMeasurements(CENSUS_B, ACTIVE_IN_B, true);
    await insertMeasurements(OTHER_PLOT_CENSUS, ACTIVE_IN_OTHER_PLOT, true);
  });

  afterAll(async () => {
    await teardownTestDatabase(connection);
  });

  it('excludes inactive rows', async () => {
    expect(await countFor(plotID, [CENSUS_A])).toBe(ACTIVE_IN_A);
  });

  it('sums every census of a multi-census plot census', async () => {
    expect(await countFor(plotID, [CENSUS_A, CENSUS_B])).toBe(ACTIVE_IN_A + ACTIVE_IN_B);
  });

  it("excludes another plot's census even when its ID is passed", async () => {
    expect(await countFor(plotID, [CENSUS_A, OTHER_PLOT_CENSUS])).toBe(ACTIVE_IN_A);
  });
});
