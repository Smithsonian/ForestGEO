/**
 * Start New Census (#522): the production fixeddata POST route against real local MySQL.
 *
 * Creating a census copies the previous census's active personnel inside the same transaction, through the real
 * withRouteAuthz wrapper -> coreapifunctions::POST -> census INSERT -> censusactivepersonnel INSERT ... SELECT ->
 * unifiedchangelog. Reads go straight to the tables.
 *
 * SAFETY: hard-fails before any write if the ConnectionManager pool host is not local.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ConnectionManager from '@/lib/db/connectionmanager';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestDatabaseConfig } from '../setup/local-db-setup';
import { HTTPResponses } from '@/config/macros';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/app/actions/cookiemanager', () => ({
  getCookie: vi.fn(),
  getCookieOrDefault: vi.fn(),
  submitCookie: vi.fn(),
  deleteCookie: vi.fn()
}));

import { auth } from '@/auth';
import { POST } from '@/app/api/fixeddata/[dataType]/[[...slugs]]/route';
import { NextRequest } from 'next/server';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;
const CENSUS_DATA_TYPE = 'census';
const CENSUS_GRID_ID = 'censusID';
const CENSUS_ACTIVE_PERSONNEL_TABLE = 'censusactivepersonnel';
const CHANGELOG_INSERT_OPERATION = 'INSERT';
const TEST_USER_EMAIL = 'census-create-rollover@forestgeo.test';
const SEEDED_PLOT_CENSUS_NUMBER = 1;
const SECOND_PLOT_CENSUS_NUMBER = 2;
const THIRD_PLOT_CENSUS_NUMBER = 3;
const NEW_CENSUS_START_DATE = '2026-01-01';
const SECOND_CENSUS_START_DATE = '2025-01-01';
const FIRST_CENSUS_PLOT_NAME = 'Rollover First Census Plot';
const ACTIVE = 1;
const RETIRED = 0;

interface PersonnelSeed {
  firstName: string;
  lastName: string;
  isActive: number;
}

const FIELD_LEAD: PersonnelSeed = { firstName: 'Rollover', lastName: 'FieldLead', isActive: ACTIVE };
const RETIRED_MEMBER: PersonnelSeed = { firstName: 'Rollover', lastName: 'Retired', isActive: RETIRED };
const NOT_ON_TEAM: PersonnelSeed = { firstName: 'Rollover', lastName: 'NotOnTeam', isActive: ACTIVE };
const SECOND_CENSUS_ONLY: PersonnelSeed = { firstName: 'Rollover', lastName: 'SecondCensusOnly', isActive: ACTIVE };

interface ActivePersonnelRow extends RowDataPacket {
  CAPID: number;
  PersonnelID: number;
  LastName: string;
}

interface ChangelogRow extends RowDataPacket {
  RecordID: string;
  Operation: string;
  CensusID: number | null;
}

let setupConnection: Connection | null = null;
let config: TestDatabaseConfig;
let schema: string;
let seededCensusID: number;
let seededPlotID: number;
const createdCensusIDs: number[] = [];
const createdPersonnelIDs: number[] = [];
const createdPlotIDs: number[] = [];

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

async function postNewCensus(
  plotID: number,
  plotCensusNumber: number,
  startDate: string
): Promise<{ status: number; newCensusID: number | undefined; body: unknown }> {
  const slugs = [schema, CENSUS_GRID_ID];
  const request = new NextRequest(`http://localhost/api/fixeddata/${CENSUS_DATA_TYPE}/${slugs.join('/')}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newRow: { censusID: 0, plotID, plotCensusNumber, startDate } })
  });
  const response = await POST(request, { params: Promise.resolve({ dataType: CENSUS_DATA_TYPE, slugs }) });
  const body = await response.json();
  const newCensusID: number | undefined = body?.createdIDs?.census;
  if (newCensusID) createdCensusIDs.push(newCensusID);
  // eslint-disable-next-line no-console
  console.log(`[#522] POST census plot=${plotID} PCN=${plotCensusNumber} -> ${response.status} ${JSON.stringify(body)}`);
  return { status: response.status, newCensusID, body };
}

async function insertPersonnel(seed: PersonnelSeed): Promise<number> {
  const [result] = await setupConnection!.query<ResultSetHeader>(`INSERT INTO \`${schema}\`.personnel (FirstName, LastName, IsActive) VALUES (?, ?, ?)`, [
    seed.firstName,
    seed.lastName,
    seed.isActive
  ]);
  createdPersonnelIDs.push(result.insertId);
  return result.insertId;
}

async function activateInCensus(personnelID: number, censusID: number): Promise<void> {
  await setupConnection!.query(`INSERT INTO \`${schema}\`.censusactivepersonnel (PersonnelID, CensusID) VALUES (?, ?)`, [personnelID, censusID]);
}

async function insertCensus(plotID: number, plotCensusNumber: number, startDate: string): Promise<number> {
  const [result] = await setupConnection!.query<ResultSetHeader>(
    `INSERT INTO \`${schema}\`.census (PlotID, PlotCensusNumber, StartDate, IsActive) VALUES (?, ?, ?, 1)`,
    [plotID, plotCensusNumber, startDate]
  );
  createdCensusIDs.push(result.insertId);
  return result.insertId;
}

async function readActivePersonnel(censusID: number): Promise<ActivePersonnelRow[]> {
  const [rows] = await setupConnection!.query<ActivePersonnelRow[]>(
    `SELECT cap.CAPID, cap.PersonnelID, p.LastName
       FROM \`${schema}\`.censusactivepersonnel cap
       JOIN \`${schema}\`.personnel p ON p.PersonnelID = cap.PersonnelID
      WHERE cap.CensusID = ?
      ORDER BY cap.CAPID`,
    [censusID]
  );
  // eslint-disable-next-line no-console
  console.log(`[#522] census ${censusID} active personnel: ${JSON.stringify(rows.map(row => row.LastName))}`);
  return rows;
}

async function readActivePersonnelChangelog(): Promise<ChangelogRow[]> {
  const [rows] = await setupConnection!.query<ChangelogRow[]>(
    `SELECT RecordID, Operation, CensusID FROM \`${schema}\`.unifiedchangelog WHERE TableName = ? ORDER BY ChangeID`,
    [CENSUS_ACTIVE_PERSONNEL_TABLE]
  );
  return rows;
}

beforeAll(async () => {
  const host = process.env.AZURE_SQL_SERVER;
  // eslint-disable-next-line no-console
  console.log(`[#522] resolved ConnectionManager host = '${host}'`);
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid writing to a real database.`);
  }

  const setup = await setupTestDatabase(DEFAULT_TEST_CONFIG);
  setupConnection = setup.connection;
  config = setup.config;
  schema = config.database;

  const [rows] = await setupConnection.query<RowDataPacket[]>(
    `SELECT CensusID, PlotID FROM \`${schema}\`.census WHERE PlotCensusNumber = ? ORDER BY CensusID LIMIT 1`,
    [SEEDED_PLOT_CENSUS_NUMBER]
  );
  seededCensusID = rows[0].CensusID;
  seededPlotID = rows[0].PlotID;
}, 90000);

beforeEach(async () => {
  vi.mocked(auth).mockResolvedValue(memberSession() as never);
  await setupConnection!.query(`DELETE FROM \`${schema}\`.unifiedchangelog WHERE TableName = ?`, [CENSUS_ACTIVE_PERSONNEL_TABLE]);
});

afterEach(async () => {
  for (const censusID of createdCensusIDs.splice(0)) {
    await setupConnection!.query(`DELETE FROM \`${schema}\`.census WHERE CensusID = ?`, [censusID]);
  }
  for (const personnelID of createdPersonnelIDs.splice(0)) {
    await setupConnection!.query(`DELETE FROM \`${schema}\`.personnel WHERE PersonnelID = ?`, [personnelID]);
  }
  for (const plotID of createdPlotIDs.splice(0)) {
    await setupConnection!.query(`DELETE FROM \`${schema}\`.plots WHERE PlotID = ?`, [plotID]);
  }
});

afterAll(async () => {
  await connectionManager.closeConnection();
  await teardownTestDatabase(setupConnection, config);
});

describe('Start New Census copies the previous census active personnel (#522)', () => {
  it('marks the previous census active personnel, except inactive ones, active in the new census and records one changelog INSERT each', async () => {
    const fieldLeadID = await insertPersonnel(FIELD_LEAD);
    const retiredID = await insertPersonnel(RETIRED_MEMBER);
    await insertPersonnel(NOT_ON_TEAM);
    await activateInCensus(fieldLeadID, seededCensusID);
    await activateInCensus(retiredID, seededCensusID);
    const previousBefore = await readActivePersonnel(seededCensusID);

    const { status, newCensusID } = await postNewCensus(seededPlotID, SECOND_PLOT_CENSUS_NUMBER, NEW_CENSUS_START_DATE);

    expect(status, 'census creation should succeed').toBe(HTTPResponses.OK);
    expect(newCensusID, 'the route returns the new CensusID').toBeGreaterThan(0);
    const copied = await readActivePersonnel(newCensusID!);
    expect(
      copied.map(row => row.PersonnelID),
      'only the active field lead carries over: inactive personnel and personnel not on the previous team do not'
    ).toEqual([fieldLeadID]);
    expect(await readActivePersonnel(seededCensusID), 'the previous census team is untouched').toEqual(previousBefore);

    const changelog = await readActivePersonnelChangelog();
    // eslint-disable-next-line no-console
    console.log(`[#522] censusactivepersonnel changelog: ${JSON.stringify(changelog)}`);
    expect(changelog.map(row => ({ RecordID: String(row.RecordID), Operation: row.Operation, CensusID: row.CensusID }))).toEqual([
      { RecordID: String(copied[0].CAPID), Operation: CHANGELOG_INSERT_OPERATION, CensusID: newCensusID }
    ]);
  });

  it('copies from the highest earlier census number, not from an older census', async () => {
    const fieldLeadID = await insertPersonnel(FIELD_LEAD);
    const secondCensusOnlyID = await insertPersonnel(SECOND_CENSUS_ONLY);
    await activateInCensus(fieldLeadID, seededCensusID);
    const secondCensusID = await insertCensus(seededPlotID, SECOND_PLOT_CENSUS_NUMBER, SECOND_CENSUS_START_DATE);
    await activateInCensus(secondCensusOnlyID, secondCensusID);

    const { status, newCensusID } = await postNewCensus(seededPlotID, THIRD_PLOT_CENSUS_NUMBER, NEW_CENSUS_START_DATE);

    expect(status).toBe(HTTPResponses.OK);
    expect(
      (await readActivePersonnel(newCensusID!)).map(row => row.PersonnelID),
      'census 3 inherits census 2, not census 1'
    ).toEqual([secondCensusOnlyID]);
  });

  it('creates the first census of a plot with no personnel to copy', async () => {
    const [plot] = await setupConnection!.query<ResultSetHeader>(`INSERT INTO \`${schema}\`.plots (PlotName) VALUES (?)`, [FIRST_CENSUS_PLOT_NAME]);
    createdPlotIDs.push(plot.insertId);

    const { status, newCensusID } = await postNewCensus(plot.insertId, SEEDED_PLOT_CENSUS_NUMBER, NEW_CENSUS_START_DATE);

    expect(status, 'a first census still succeeds').toBe(HTTPResponses.OK);
    expect(await readActivePersonnel(newCensusID!)).toEqual([]);
    expect(await readActivePersonnelChangelog()).toEqual([]);
  });

  it('does not copy another plot census team into the new census', async () => {
    const [plot] = await setupConnection!.query<ResultSetHeader>(`INSERT INTO \`${schema}\`.plots (PlotName) VALUES (?)`, [FIRST_CENSUS_PLOT_NAME]);
    createdPlotIDs.push(plot.insertId);
    const fieldLeadID = await insertPersonnel(FIELD_LEAD);
    await activateInCensus(fieldLeadID, seededCensusID);

    const { newCensusID } = await postNewCensus(plot.insertId, SECOND_PLOT_CENSUS_NUMBER, NEW_CENSUS_START_DATE);

    expect(await readActivePersonnel(newCensusID!), "the seeded plot's census 1 team stays in its own plot").toEqual([]);
  });
});
