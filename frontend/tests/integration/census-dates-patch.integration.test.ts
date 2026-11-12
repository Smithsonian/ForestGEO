/**
 * Edit census dates: the production fixeddata PATCH route against real local MySQL.
 *
 * The request body comes from the same buildCensusDatesPatchBody the dashboard sends, and the
 * write runs through the real withRouteAuthz wrapper -> coreapifunctions::PATCH -> GenericMapper
 * -> UPDATE -> unifiedchangelog. Reads go straight to the table with DATE_FORMAT so a one-day
 * timezone shift on either date shows up as a string mismatch.
 *
 * SAFETY: hard-fails before any write if the ConnectionManager pool host is not local.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ConnectionManager from '@/lib/db/connectionmanager';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestDatabaseConfig } from '../setup/local-db-setup';
import { HTTPResponses } from '@/config/macros';
import {
  CENSUS_END_BEFORE_START_MESSAGE,
  CENSUS_INVALID_DATE_MESSAGE,
  CENSUS_START_DATE_REQUIRED_MESSAGE,
  type CensusDates,
  formatCensusOverlapMessage
} from '@/config/censuswindow';
import { buildCensusDatesPatchBody } from '@/lib/db/definitions/timekeeping';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/app/actions/cookiemanager', () => ({
  getCookie: vi.fn(),
  getCookieOrDefault: vi.fn(),
  submitCookie: vi.fn(),
  deleteCookie: vi.fn()
}));

import { auth } from '@/auth';
import { getCookie } from '@/app/actions/cookiemanager';
import { PATCH } from '@/app/api/fixeddata/[dataType]/[[...slugs]]/route';
import { NextRequest } from 'next/server';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;
const CENSUS_DATA_TYPE = 'census';
const CENSUS_GRID_ID = 'censusID';
const CENSUS_TABLE_NAME = 'census';
const CHANGELOG_UPDATE_OPERATION = 'UPDATE';
const TEST_USER_EMAIL = 'census-dates-patch@forestgeo.test';
const SEEDED_PLOT_CENSUS_NUMBER = 1;
// local-db-setup seeds census 1 with this window.
const SEED_START_DATE = '2024-01-01';
const SEED_END_DATE = '2024-12-31';
const EDITED_DATES: CensusDates = { startDate: '2024-02-01', endDate: '2025-01-31' };
const OPEN_ENDED_DATES: CensusDates = { startDate: '2024-03-15', endDate: null };
const REVERSED_DATES: CensusDates = { startDate: '2024-06-01', endDate: '2024-05-31' };
const INSIDE_NARROWED_WINDOW_DAY = '2024-06-15';
const OUTSIDE_NARROWED_WINDOW_DAY = '2024-01-10';
const NARROWED_DATES: CensusDates = { startDate: '2024-02-01', endDate: '2024-12-31' };
const OTHER_CENSUS_NUMBER = 99;
const NEIGHBOUR_CENSUS_NUMBER = 98;
const NEIGHBOUR_CENSUS_DATES: CensusDates = { startDate: '2025-06-01', endDate: '2025-12-31' };
const DATES_ENDING_ON_NEIGHBOUR_START: CensusDates = { startDate: SEED_START_DATE, endDate: NEIGHBOUR_CENSUS_DATES.startDate };
const DATES_ENDING_BEFORE_NEIGHBOUR_START: CensusDates = { startDate: SEED_START_DATE, endDate: '2025-05-31' };
const OTHER_CENSUS_DATES: CensusDates = { startDate: '2030-01-01', endDate: '2030-12-31' };
const LINKED_TREE_TAG = 'CDP-TREE-1';
const LINKED_STEM_TAG = '1';
const VALIDATED = 1;
const NOT_VALIDATED = 0;
const ACTIVE = 1;
const INACTIVE = 0;

interface CensusRowSnapshot extends RowDataPacket {
  CensusID: number;
  PlotID: number;
  PlotCensusNumber: number;
  Description: string | null;
  IsActive: number;
  StartDay: string | null;
  EndDay: string | null;
}

interface ChangelogRow extends RowDataPacket {
  RecordID: string;
  Operation: string;
}

let setupConnection: Connection | null = null;
let config: TestDatabaseConfig;
let schema: string;
let censusID: number;

const connectionManager = ConnectionManager.getInstance();

function memberSession() {
  return {
    user: {
      email: TEST_USER_EMAIL,
      userStatus: 'global',
      sites: [{ schemaName: schema }],
      allsites: [{ schemaName: schema }]
    }
  };
}

async function patchCensusDates(dates: CensusDates): Promise<Response> {
  return patchCensusBody(buildCensusDatesPatchBody(censusID, dates));
}

async function patchCensusBody(body: unknown): Promise<Response> {
  const slugs = [schema, CENSUS_GRID_ID];
  const request = new NextRequest(`http://localhost/api/fixeddata/${CENSUS_DATA_TYPE}/${slugs.join('/')}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return PATCH(request, { params: Promise.resolve({ dataType: CENSUS_DATA_TYPE, slugs }) });
}

async function readCensusRow(): Promise<CensusRowSnapshot> {
  const [rows] = await setupConnection!.query<CensusRowSnapshot[]>(
    `SELECT CensusID, PlotID, PlotCensusNumber, Description, IsActive,
            DATE_FORMAT(StartDate, '%Y-%m-%d') AS StartDay,
            DATE_FORMAT(EndDate, '%Y-%m-%d') AS EndDay
       FROM \`${schema}\`.census WHERE CensusID = ?`,
    [censusID]
  );
  return rows[0];
}

async function readCensusChangelog(): Promise<ChangelogRow[]> {
  const [rows] = await setupConnection!.query<ChangelogRow[]>(
    `SELECT RecordID, Operation FROM \`${schema}\`.unifiedchangelog WHERE TableName = ? ORDER BY ChangeID`,
    [CENSUS_TABLE_NAME]
  );
  return rows;
}

interface ValidationStateRow extends RowDataPacket {
  CoreMeasurementID: number;
  IsValidated: number | null;
}

interface MeasurementSeed {
  censusID: number;
  stemGUID: number | null;
  day: string;
  isValidated: number | null;
  isActive: number;
}

interface LinkedStem {
  treeID: number;
  stemGUID: number;
}

async function insertLinkedStem(): Promise<LinkedStem> {
  const [tree] = await setupConnection!.query<ResultSetHeader>(
    `INSERT INTO \`${schema}\`.trees (TreeTag, SpeciesID, CensusID, IsActive)
     SELECT ?, MIN(SpeciesID), ?, 1 FROM \`${schema}\`.species`,
    [LINKED_TREE_TAG, censusID]
  );
  const [stem] = await setupConnection!.query<ResultSetHeader>(
    `INSERT INTO \`${schema}\`.stems (TreeID, QuadratID, CensusID, StemTag, IsActive)
     SELECT ?, MIN(QuadratID), ?, ?, 1 FROM \`${schema}\`.quadrats`,
    [tree.insertId, censusID, LINKED_STEM_TAG]
  );
  return { treeID: tree.insertId, stemGUID: stem.insertId };
}

async function deleteLinkedStem(stem: LinkedStem): Promise<void> {
  await setupConnection!.query(`DELETE FROM \`${schema}\`.stems WHERE StemGUID = ?`, [stem.stemGUID]);
  await setupConnection!.query(`DELETE FROM \`${schema}\`.trees WHERE TreeID = ?`, [stem.treeID]);
}

async function insertMeasurement(seed: MeasurementSeed): Promise<number> {
  const [result] = await setupConnection!.query<ResultSetHeader>(
    `INSERT INTO \`${schema}\`.coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, IsActive) VALUES (?, ?, ?, ?, ?)`,
    [seed.censusID, seed.stemGUID, seed.isValidated, seed.day, seed.isActive]
  );
  return result.insertId;
}

async function insertCensusInSeededPlot(plotCensusNumber: number, dates: CensusDates): Promise<number> {
  const [result] = await setupConnection!.query<ResultSetHeader>(
    `INSERT INTO \`${schema}\`.census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive)
     SELECT PlotID, ?, ?, ?, 1 FROM \`${schema}\`.census WHERE CensusID = ?`,
    [plotCensusNumber, dates.startDate, dates.endDate, censusID]
  );
  return result.insertId;
}

async function deleteCensus(censusIDToDelete: number): Promise<void> {
  await setupConnection!.query(`DELETE FROM \`${schema}\`.coremeasurements WHERE CensusID = ?`, [censusIDToDelete]);
  await setupConnection!.query(`DELETE FROM \`${schema}\`.census WHERE CensusID = ?`, [censusIDToDelete]);
}

async function readValidationStates(ids: number[]): Promise<Map<number, number | null>> {
  const [rows] = await setupConnection!.query<ValidationStateRow[]>(
    `SELECT CoreMeasurementID, CAST(IsValidated AS SIGNED) AS IsValidated FROM \`${schema}\`.coremeasurements WHERE CoreMeasurementID IN (?)`,
    [ids]
  );
  return new Map(rows.map(row => [row.CoreMeasurementID, row.IsValidated]));
}

function describeRow(row: CensusRowSnapshot): string {
  return `CensusID=${row.CensusID} PlotID=${row.PlotID} PCN=${row.PlotCensusNumber} Start=${row.StartDay} End=${row.EndDay} IsActive=${row.IsActive} Description=${row.Description}`;
}

beforeAll(async () => {
  const host = process.env.AZURE_SQL_SERVER;
  // eslint-disable-next-line no-console
  console.log(`[census-dates-patch] resolved ConnectionManager host = '${host}', process TZ = '${Intl.DateTimeFormat().resolvedOptions().timeZone}'`);
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid writing to a real database.`);
  }

  const setup = await setupTestDatabase(DEFAULT_TEST_CONFIG);
  setupConnection = setup.connection;
  config = setup.config;
  schema = config.database;

  const [rows] = await setupConnection.query<RowDataPacket[]>(
    `SELECT CensusID FROM \`${schema}\`.census WHERE PlotCensusNumber = ? ORDER BY CensusID LIMIT 1`,
    [SEEDED_PLOT_CENSUS_NUMBER]
  );
  censusID = rows[0].CensusID;
}, 90000);

beforeEach(async () => {
  vi.mocked(auth).mockResolvedValue(memberSession() as any);
  vi.mocked(getCookie).mockResolvedValue(String(censusID));
  await setupConnection!.query(`UPDATE \`${schema}\`.census SET StartDate = ?, EndDate = ? WHERE CensusID = ?`, [SEED_START_DATE, SEED_END_DATE, censusID]);
  await setupConnection!.query(`DELETE FROM \`${schema}\`.unifiedchangelog WHERE TableName = ?`, [CENSUS_TABLE_NAME]);
});

afterAll(async () => {
  await connectionManager.closeConnection();
  await teardownTestDatabase(setupConnection, config);
});

describe('Edit census dates via the production fixeddata PATCH route', () => {
  it('persists the exact calendar days, touches no other column, and records one changelog UPDATE', async () => {
    const before = await readCensusRow();
    // eslint-disable-next-line no-console
    console.log(`[census-dates-patch] before: ${describeRow(before)}`);

    const response = await patchCensusDates(EDITED_DATES);
    const body = await response.json();
    // eslint-disable-next-line no-console
    console.log(`[census-dates-patch] PATCH ${JSON.stringify(EDITED_DATES)} -> ${response.status} ${JSON.stringify(body)}`);
    expect(response.status, 'census date PATCH should succeed').toBe(HTTPResponses.OK);
    expect(body.changed, 'a real date change must be reported as changed').toBe(true);

    const after = await readCensusRow();
    // eslint-disable-next-line no-console
    console.log(`[census-dates-patch] after: ${describeRow(after)}`);
    expect(after.StartDay).toBe(EDITED_DATES.startDate);
    expect(after.EndDay).toBe(EDITED_DATES.endDate);
    expect({ PlotID: after.PlotID, PlotCensusNumber: after.PlotCensusNumber, Description: after.Description, IsActive: after.IsActive }).toEqual({
      PlotID: before.PlotID,
      PlotCensusNumber: before.PlotCensusNumber,
      Description: before.Description,
      IsActive: before.IsActive
    });

    const changelog = await readCensusChangelog();
    // eslint-disable-next-line no-console
    console.log(`[census-dates-patch] census changelog rows: ${JSON.stringify(changelog)}`);
    expect(changelog).toHaveLength(1);
    expect(changelog[0].Operation).toBe(CHANGELOG_UPDATE_OPERATION);
    expect(changelog[0].RecordID).toBe(String(censusID));
  });

  it('clears the end date when the edit leaves it blank', async () => {
    const response = await patchCensusDates(OPEN_ENDED_DATES);
    expect(response.status, 'open-ended census PATCH should succeed').toBe(HTTPResponses.OK);

    const after = await readCensusRow();
    // eslint-disable-next-line no-console
    console.log(`[census-dates-patch] open-ended after: ${describeRow(after)}`);
    expect(after.StartDay).toBe(OPEN_ENDED_DATES.startDate);
    expect(after.EndDay).toBeNull();
  });

  it('refuses an end date before the start date with a 400 and changes nothing', async () => {
    const response = await patchCensusDates(REVERSED_DATES);
    const body = await response.json();
    // eslint-disable-next-line no-console
    console.log(`[census-dates-patch] reversed PATCH -> ${response.status} ${JSON.stringify(body)}`);
    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(body.error).toBe(CENSUS_END_BEFORE_START_MESSAGE);

    const after = await readCensusRow();
    expect(after.StartDay).toBe(SEED_START_DATE);
    expect(after.EndDay).toBe(SEED_END_DATE);
    expect(await readCensusChangelog()).toHaveLength(0);
  });

  it('refuses dates that overlap another census number in the plot with a 400 and changes nothing', async () => {
    const neighbourCensusID = await insertCensusInSeededPlot(NEIGHBOUR_CENSUS_NUMBER, NEIGHBOUR_CENSUS_DATES);
    try {
      const response = await patchCensusDates(DATES_ENDING_ON_NEIGHBOUR_START);
      const body = await response.json();
      const row = await readCensusRow();
      // eslint-disable-next-line no-console
      console.log(`[census-dates-patch] overlap PATCH -> ${response.status} ${JSON.stringify(body)}; row now ${describeRow(row)}`);
      expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
      expect(body.error).toBe(formatCensusOverlapMessage(NEIGHBOUR_CENSUS_NUMBER));
      expect(row.StartDay).toBe(SEED_START_DATE);
      expect(row.EndDay).toBe(SEED_END_DATE);
      expect(await readCensusChangelog()).toHaveLength(0);
    } finally {
      await deleteCensus(neighbourCensusID);
    }
  });

  it('accepts dates that end the day before another census in the plot starts', async () => {
    const neighbourCensusID = await insertCensusInSeededPlot(NEIGHBOUR_CENSUS_NUMBER, NEIGHBOUR_CENSUS_DATES);
    try {
      const response = await patchCensusDates(DATES_ENDING_BEFORE_NEIGHBOUR_START);
      const row = await readCensusRow();
      // eslint-disable-next-line no-console
      console.log(`[census-dates-patch] adjacent PATCH -> ${response.status}; row now ${describeRow(row)}`);
      expect(response.status).toBe(HTTPResponses.OK);
      expect(row.EndDay).toBe(DATES_ENDING_BEFORE_NEIGHBOUR_START.endDate);
    } finally {
      await deleteCensus(neighbourCensusID);
    }
  });

  it.each([
    { startDate: '20240601', endDate: '20240531' },
    { startDate: '2024-6-1', endDate: '2024-5-31' },
    { startDate: 20240601, endDate: 20240531 },
    { startDate: '2024-02-30', endDate: null },
    { startDate: '2024-06-01T00:00:00.000Z', endDate: null },
    { startDate: '0999-12-31', endDate: null },
    { startDate: '10000-01-01', endDate: null },
    { startDate: '2024-06-01', endDate: '20240531' },
    { startDate: '2024-06-01', endDate: false },
    { startDate: '2024-06-01', endDate: { year: 2024, month: 7, day: 1 } },
    { startDate: '2024-06-01', endDate: '' }
  ])('rejects invalid date input without changing the row or audit: %j', async dates => {
    const before = await readCensusRow();
    const response = await patchCensusBody({ oldRow: { censusID }, newRow: { censusID, ...dates } });

    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect((await response.json()).error).toBe(CENSUS_INVALID_DATE_MESSAGE);
    expect(await readCensusRow()).toEqual(before);
    expect(await readCensusChangelog()).toHaveLength(0);
  });

  it.each([null, ''])('rejects an explicitly cleared start date (%j)', async startDate => {
    const before = await readCensusRow();
    const response = await patchCensusBody({ oldRow: { censusID }, newRow: { censusID, startDate, endDate: null } });

    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect((await response.json()).error).toBe(CENSUS_START_DATE_REQUIRED_MESSAGE);
    expect(await readCensusRow()).toEqual(before);
    expect(await readCensusChangelog()).toHaveLength(0);
  });

  it.each([
    { changes: { startDate: '2024-02-29' }, start: '2024-02-29', end: SEED_END_DATE },
    { changes: { endDate: '2025-01-01' }, start: SEED_START_DATE, end: '2025-01-01' }
  ])('preserves the untouched calendar day on a partial PATCH: $changes', async ({ changes, start, end }) => {
    const response = await patchCensusBody({ oldRow: { censusID }, newRow: { censusID, ...changes } });

    expect(response.status).toBe(HTTPResponses.OK);
    const after = await readCensusRow();
    expect(after.StartDay).toBe(start);
    expect(after.EndDay).toBe(end);
    expect(await readCensusChangelog()).toHaveLength(1);
  });

  it.each([{ startDate: '2025-01-01' }, { endDate: '2023-12-31' }])('compares a partial date edit against the persisted other date: %j', async changes => {
    const before = await readCensusRow();
    const response = await patchCensusBody({ oldRow: { censusID }, newRow: { censusID, ...changes } });

    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect((await response.json()).error).toBe(CENSUS_END_BEFORE_START_MESSAGE);
    expect(await readCensusRow()).toEqual(before);
    expect(await readCensusChangelog()).toHaveLength(0);
  });
});

describe('Narrowing the census window re-opens validation for rows it now excludes', () => {
  const insertedMeasurementIDs: number[] = [];
  let linkedStem: LinkedStem;
  let stemGUID: number;

  beforeAll(async () => {
    linkedStem = await insertLinkedStem();
    stemGUID = linkedStem.stemGUID;
  });

  afterAll(async () => {
    await deleteLinkedStem(linkedStem);
  });

  afterEach(async () => {
    if (insertedMeasurementIDs.length) {
      await setupConnection!.query(`DELETE FROM \`${schema}\`.coremeasurements WHERE CoreMeasurementID IN (?)`, [insertedMeasurementIDs]);
    }
    insertedMeasurementIDs.length = 0;
  });

  it('resets only validated, linked, active rows of this census that fall outside the new window', async () => {
    const otherCensusID = await insertCensusInSeededPlot(OTHER_CENSUS_NUMBER, OTHER_CENSUS_DATES);
    try {
      const outsideValidated = await insertMeasurement({ censusID, stemGUID, day: OUTSIDE_NARROWED_WINDOW_DAY, isValidated: VALIDATED, isActive: ACTIVE });
      const insideValidated = await insertMeasurement({ censusID, stemGUID, day: INSIDE_NARROWED_WINDOW_DAY, isValidated: VALIDATED, isActive: ACTIVE });
      const outsideFailedRow = await insertMeasurement({
        censusID,
        stemGUID: null,
        day: OUTSIDE_NARROWED_WINDOW_DAY,
        isValidated: NOT_VALIDATED,
        isActive: ACTIVE
      });
      const outsideInactive = await insertMeasurement({ censusID, stemGUID, day: OUTSIDE_NARROWED_WINDOW_DAY, isValidated: VALIDATED, isActive: INACTIVE });
      const outsideOtherCensus = await insertMeasurement({
        censusID: otherCensusID,
        stemGUID,
        day: OUTSIDE_NARROWED_WINDOW_DAY,
        isValidated: VALIDATED,
        isActive: ACTIVE
      });
      insertedMeasurementIDs.push(outsideValidated, insideValidated, outsideFailedRow, outsideInactive, outsideOtherCensus);

      const response = await patchCensusDates(NARROWED_DATES);
      const states = await readValidationStates(insertedMeasurementIDs);
      // eslint-disable-next-line no-console
      console.log(`[census-dates-patch] narrowed to ${JSON.stringify(NARROWED_DATES)}; IsValidated by row: ${JSON.stringify([...states])}`);

      expect(response.status).toBe(HTTPResponses.OK);
      expect(states.get(outsideValidated), 'validated row now before the start must be re-opened').toBeNull();
      expect(states.get(insideValidated), 'row still inside the window keeps its verdict').toBe(VALIDATED);
      expect(states.get(outsideFailedRow), 'failed rows are not validation candidates').toBe(NOT_VALIDATED);
      expect(states.get(outsideInactive), 'inactive rows are ignored').toBe(VALIDATED);
      expect(states.get(outsideOtherCensus), 'another census is untouched').toBe(VALIDATED);
    } finally {
      await deleteCensus(otherCensusID);
    }
  });

  it('resets nothing when the PATCH is refused', async () => {
    const outsideValidated = await insertMeasurement({ censusID, stemGUID, day: OUTSIDE_NARROWED_WINDOW_DAY, isValidated: VALIDATED, isActive: ACTIVE });
    insertedMeasurementIDs.push(outsideValidated);

    const response = await patchCensusDates(REVERSED_DATES);
    const states = await readValidationStates(insertedMeasurementIDs);
    // eslint-disable-next-line no-console
    console.log(`[census-dates-patch] refused PATCH status=${response.status}; IsValidated=${states.get(outsideValidated)}`);

    expect(response.status).toBe(HTTPResponses.INVALID_REQUEST);
    expect(states.get(outsideValidated)).toBe(VALIDATED);
  });
});
