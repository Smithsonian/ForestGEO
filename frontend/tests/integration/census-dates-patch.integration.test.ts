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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ConnectionManager from '@/lib/db/connectionmanager';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestDatabaseConfig } from '../setup/local-db-setup';
import { HTTPResponses } from '@/config/macros';
import { CENSUS_END_BEFORE_START_MESSAGE, CENSUS_INVALID_DATE_MESSAGE, CENSUS_START_DATE_REQUIRED_MESSAGE, type CensusDates } from '@/config/censuswindow';
import { buildCensusDatesPatchBody } from '@/lib/db/definitions/timekeeping';
import type { Connection, RowDataPacket } from 'mysql2/promise';

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
