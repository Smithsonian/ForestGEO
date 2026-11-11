/**
 * #525 item 10 / #508: on a first census every measured stem is a new recruit, so
 * the New Recruits tile must equal Total Stems. Calls both dashboard-metrics route
 * handlers against real SQL. Run it alone:
 *   cd frontend && npm run test:integration -- dashboardmetrics-routes
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Connection } from 'mysql2/promise';
import {
  createAdditionalCensus,
  insertDirectMeasurements,
  setupTestDatabase,
  teardownTestDatabase,
  type DirectMeasurement,
  type TestData
} from '../setup/local-db-setup';
import { HTTPResponses } from '@/config/macros';

const STEM_TAG = 'S001';
const FIRST_CENSUS_ACTIVE_TREE_TAGS = ['DMR_FIRST_A', 'DMR_FIRST_B', 'DMR_FIRST_C'] as const;
const FIRST_CENSUS_INACTIVE_TREE_TAG = 'DMR_FIRST_INACTIVE';
/** Every measured stem counts as a stem; the inactive tree's stem is still measured. */
const FIRST_CENSUS_MEASURED_STEMS = FIRST_CENSUS_ACTIVE_TREE_TAGS.length + 1;
const SECOND_CENSUS_PLOT_CENSUS_NUMBER = 2;
const SECOND_CENSUS_RETURNING_TREE_TAG = FIRST_CENSUS_ACTIVE_TREE_TAGS[0];
const SECOND_CENSUS_RECRUIT_TREE_TAG = 'DMR_SECOND_RECRUIT';
const SECOND_CENSUS_EXPECTED_NEW_RECRUITS = 1;
const SECOND_CENSUS_EXPECTED_OLD_STEMS = 1;
const FIRST_CENSUS_MEASUREMENT_DATE = '2024-06-15';
const SECOND_CENSUS_START_DATE = '2029-01-01';
const SECOND_CENSUS_END_DATE = '2029-12-31';
const SECOND_CENSUS_MEASUREMENT_DATE = '2029-06-15';
const SEED_DBH = 100;
const SEED_HOM = 1.3;
const LEGACY_PLOT_NAME_QUERY = 'Integration Plot';
const SETUP_TIMEOUT_MS = 120000;

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  authenticatedUser: { email: 'dashboard-metrics-runner@forestgeo.test', userStatus: 'global', sites: [] }
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: sharedState.authenticatedUser }))
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[]) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      const [rows] = await sharedState.connection.query(query, params as any[]);
      return rows;
    },
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});

// No cookies: the legacy route then takes its URL-parameter path.
vi.mock('@/app/actions/cookiemanager', () => ({ getCookie: vi.fn(async () => undefined) }));

vi.mock('@/ailogger', () => ({ default: { info: () => undefined, warn: () => undefined, error: () => undefined } }));

describe('dashboard metrics routes: first-census New Recruits equals Total Stems (#525 item 10, #508)', () => {
  let connection: Connection;
  let testData: TestData;
  let schema: string;
  let plotID: number;
  let firstCensusID: number;
  let secondCensusID: number;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    schema = setup.config.database;
    sharedState.connection = connection;
    plotID = testData.plots[0].plotID;
    firstCensusID = testData.census[0].censusID;

    const speciesCode = testData.species[0]?.SpeciesCode ?? testData.species[0]?.Mnemonic;
    const quadratName = testData.quadrats[0]?.QuadratName ?? testData.quadrats[0]?.Quadrat;
    if (!speciesCode || !quadratName) throw new Error('Test setup failed: seedSampleData did not provide a species or quadrat to measure against');
    const measurementFor = (treeTag: string, date: string, coordinate: number): DirectMeasurement => ({
      treeTag,
      stemTag: STEM_TAG,
      speciesCode,
      quadratName,
      x: coordinate,
      y: coordinate,
      dbh: SEED_DBH,
      hom: SEED_HOM,
      date
    });

    await insertDirectMeasurements(
      connection,
      testData,
      firstCensusID,
      [...FIRST_CENSUS_ACTIVE_TREE_TAGS, FIRST_CENSUS_INACTIVE_TREE_TAG].map((treeTag, index) =>
        measurementFor(treeTag, FIRST_CENSUS_MEASUREMENT_DATE, index + 1)
      )
    );
    await connection.query('UPDATE trees SET IsActive = 0 WHERE TreeTag = ? AND CensusID = ?', [FIRST_CENSUS_INACTIVE_TREE_TAG, firstCensusID]);

    const secondCensus = await createAdditionalCensus(connection, testData, {
      plotCensusNumber: SECOND_CENSUS_PLOT_CENSUS_NUMBER,
      startDate: SECOND_CENSUS_START_DATE,
      endDate: SECOND_CENSUS_END_DATE
    });
    secondCensusID = secondCensus.censusID;
    await insertDirectMeasurements(connection, testData, secondCensusID, [
      measurementFor(SECOND_CENSUS_RETURNING_TREE_TAG, SECOND_CENSUS_MEASUREMENT_DATE, 11),
      measurementFor(SECOND_CENSUS_RECRUIT_TREE_TAG, SECOND_CENSUS_MEASUREMENT_DATE, 12)
    ]);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, { database: schema });
  });

  async function getAggregateMetrics(censusID: number) {
    const { GET } = await import('@/app/api/dashboardmetrics/all/[schema]/[plotID]/[censusID]/route');
    const response = await GET(new NextRequest(`http://localhost/api/dashboardmetrics/all/${schema}/${plotID}/${censusID}`), {
      params: Promise.resolve({ schema, plotID: String(plotID), censusID: String(censusID) })
    });
    const body = await response.json();
    console.log(`[#525 item 10] aggregate census ${censusID}: HTTP ${response.status} ${JSON.stringify(body)}`);
    expect(response.status, JSON.stringify(body)).toBe(HTTPResponses.OK);
    return body;
  }

  async function getLegacyMetric(metric: 'CountStems' | 'StemTypes', censusID: number) {
    const { GET } = await import('@/app/api/dashboardmetrics/[metric]/[schema]/[plotIDParam]/[censusIDParam]/route');
    const url = `http://localhost/api/dashboardmetrics/${metric}/${schema}/${plotID}/${censusID}?plot=${encodeURIComponent(LEGACY_PLOT_NAME_QUERY)}`;
    const response = await GET(new NextRequest(url), {
      params: Promise.resolve({ metric, schema, plotIDParam: String(plotID), censusIDParam: String(censusID) })
    });
    const body = await response.json();
    console.log(`[#525 item 10] legacy ${metric} census ${censusID}: HTTP ${response.status} ${JSON.stringify(body)}`);
    expect(response.status, JSON.stringify(body)).toBe(HTTPResponses.OK);
    return body;
  }

  it('reports New Recruits equal to Total Stems on a first census from the aggregate route', async () => {
    const metrics = await getAggregateMetrics(firstCensusID);

    expect(metrics.stemTypes.isFirstCensus).toBe(true);
    expect(Number(metrics.countStems.CountStems)).toBe(FIRST_CENSUS_MEASURED_STEMS);
    expect(Number(metrics.stemTypes.CountNewRecruits)).toBe(FIRST_CENSUS_MEASURED_STEMS);
  });

  it('reports New Recruits equal to Total Stems on a first census from the legacy CountStems and StemTypes routes', async () => {
    const countStems = await getLegacyMetric('CountStems', firstCensusID);
    const stemTypes = await getLegacyMetric('StemTypes', firstCensusID);

    expect(Number(countStems.CountStems)).toBe(FIRST_CENSUS_MEASURED_STEMS);
    expect(stemTypes.isFirstCensus).toBe(true);
    expect(Number(stemTypes.CountNewRecruits)).toBe(FIRST_CENSUS_MEASURED_STEMS);
  });

  it('leaves the subsequent-census comparison unchanged in both routes (control)', async () => {
    const aggregate = await getAggregateMetrics(secondCensusID);
    const legacy = await getLegacyMetric('StemTypes', secondCensusID);

    expect(aggregate.stemTypes.isFirstCensus).toBe(false);
    expect(Number(aggregate.stemTypes.CountNewRecruits)).toBe(SECOND_CENSUS_EXPECTED_NEW_RECRUITS);
    expect(Number(aggregate.stemTypes.CountOldStems)).toBe(SECOND_CENSUS_EXPECTED_OLD_STEMS);
    expect(legacy.isFirstCensus).toBe(false);
    expect(Number(legacy.CountNewRecruits)).toBe(SECOND_CENSUS_EXPECTED_NEW_RECRUITS);
    expect(Number(legacy.CountOldStems)).toBe(SECOND_CENSUS_EXPECTED_OLD_STEMS);
  });
});
