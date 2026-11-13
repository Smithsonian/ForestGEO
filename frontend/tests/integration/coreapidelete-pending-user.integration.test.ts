/**
 * D6: pending site members must not delete through the generic CRUD DELETE, on either route that re-exports it.
 * Real ConnectionManager against local MySQL; only @/auth is mocked. SAFETY: refuses to run against a non-local host.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import ConnectionManager from '@/lib/db/connectionmanager';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import { HTTPResponses } from '@/config/macros';
import { refreshMeasurementViewsForScope } from '@/lib/measurementviewrefresh';
import { insertDirectMeasurements, setupTestDatabase, teardownTestDatabase, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;
const PROBE_ATTRIBUTE_CODE = 'D6PROBE';
const MEASUREMENT_ATTRIBUTE_CODE = 'A';
const ROW_PRESENT = 1;
const ROW_GONE = 0;

const session = vi.hoisted(() => ({ current: null as null | { user: Record<string, unknown> } }));
vi.mock('@/auth', () => ({ auth: async () => session.current }));
vi.mock('@/ailogger', () => ({ default: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } }));

const connectionManager = ConnectionManager.getInstance();
let setupConnection: Connection;
let config: TestDatabaseConfig;
let testData: TestData;
let schema: string;
let measurementID: number;
let connectionManagerPoolOpened = false;

function member(userStatus: string) {
  return { user: { email: `d6-${userStatus.replace(/\s/g, '-')}@forestgeo.test`, userStatus, sites: [{ schemaName: schema }] } };
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const [rows] = await setupConnection.query<RowDataPacket[]>(sql, params);
  return Number(rows[0].total);
}

async function measurementState() {
  const state = {
    coremeasurements: await count('SELECT COUNT(*) AS total FROM coremeasurements WHERE CoreMeasurementID = ?', [measurementID]),
    measurementssummary: await count('SELECT COUNT(*) AS total FROM measurementssummary WHERE CoreMeasurementID = ?', [measurementID]),
    cmattributes: await count('SELECT COUNT(*) AS total FROM cmattributes WHERE CoreMeasurementID = ?', [measurementID])
  };
  console.log('[D6 integration] measurement', measurementID, JSON.stringify(state));
  return state;
}

async function attributeCount(): Promise<number> {
  const total = await count('SELECT COUNT(*) AS total FROM attributes WHERE Code = ?', [PROBE_ATTRIBUTE_CODE]);
  console.log('[D6 integration] attribute probe rows', total);
  return total;
}

async function callDelete(routeModule: 'fixeddata' | 'fixeddatafilter', dataType: string, idField: string, newRow: Record<string, unknown>) {
  const { DELETE } = await import(`@/app/api/${routeModule}/[dataType]/[[...slugs]]/route`);
  const response = await DELETE(
    new Request(`http://localhost/api/${routeModule}`, {
      method: 'DELETE',
      body: JSON.stringify({ newRow }),
      headers: { 'content-type': 'application/json' }
    }) as never,
    { params: Promise.resolve({ dataType, slugs: [schema, idField] }) }
  );
  const json = await response.json().catch(() => null);
  console.log('[D6 integration] response', JSON.stringify({ routeModule, dataType, status: response.status, json }));
  return response.status;
}

beforeAll(async () => {
  const host = process.env.AZURE_SQL_SERVER;
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid writing to a real database.`);
  }
  const setup = await setupTestDatabase();
  setupConnection = setup.connection;
  config = setup.config;
  testData = setup.testData;
  schema = config.database;
  const plotID = testData.plots[0].plotID;
  const censusID = testData.census[0].censusID;
  await setupConnection.query("INSERT INTO attributes (Code, Description, Status, IsActive) VALUES (?, 'D6 probe', 'alive', 1)", [PROBE_ATTRIBUTE_CODE]);
  const { coreMeasurementIDs } = await insertDirectMeasurements(setupConnection, testData, censusID, [
    {
      treeTag: 'D6-TREE',
      stemTag: '1',
      speciesCode: testData.species[0].SpeciesCode,
      quadratName: testData.quadrats[0].QuadratName,
      x: 1,
      y: 1,
      dbh: 10,
      hom: 1.3,
      date: '2024-06-03',
      codes: MEASUREMENT_ATTRIBUTE_CODE
    }
  ]);
  measurementID = coreMeasurementIDs[0];
  connectionManagerPoolOpened = true;
  await refreshMeasurementViewsForScope(connectionManager, schema, plotID, censusID);
}, 120000);

afterAll(async () => {
  try {
    // ConnectionManager.closeConnection() is a no-op (lib/db/connectionmanager.ts:598); the pool belongs to the
    // pool-monitor singleton (same pattern as census-replacement-rehearsal.integration.test.ts:1736-1745). Calling
    // getPoolMonitorInstance() when nothing used the pool would create one, so close it only if this file opened it (as Task 25 does).
    if (connectionManagerPoolOpened) await getPoolMonitorInstance().closeAllConnections();
  } finally {
    await teardownTestDatabase(setupConnection, config);
  }
});

describe('coreApiDelete and pending members (D6)', () => {
  it('fixeddata DELETE: a pending member gets 403 and the attribute row is unchanged', async () => {
    session.current = member('pending');
    expect(await callDelete('fixeddata', 'attributes', 'code', { code: PROBE_ATTRIBUTE_CODE })).toBe(HTTPResponses.FORBIDDEN);
    expect(await attributeCount()).toBe(ROW_PRESENT);
  });

  it('fixeddatafilter DELETE: a pending member gets 403 and the measurement, its summary row and its codes are unchanged', async () => {
    session.current = member('pending');
    const before = await measurementState();
    expect(before.coremeasurements).toBe(ROW_PRESENT);
    expect(before.measurementssummary).toBe(ROW_PRESENT);
    expect(before.cmattributes).toBe(ROW_PRESENT);
    expect(await callDelete('fixeddatafilter', 'measurementssummary', 'coreMeasurementID', { coreMeasurementID: measurementID })).toBe(HTTPResponses.FORBIDDEN);
    expect(await measurementState()).toEqual(before);
  });

  it('fixeddata DELETE: a non-pending member still deletes the attribute row', async () => {
    session.current = member('field crew');
    expect(await callDelete('fixeddata', 'attributes', 'code', { code: PROBE_ATTRIBUTE_CODE })).toBe(HTTPResponses.OK);
    expect(await attributeCount()).toBe(ROW_GONE);
  });

  it('fixeddata DELETE: a non-pending member still deletes the measurement and its codes', async () => {
    session.current = member('field crew');
    expect(await callDelete('fixeddata', 'measurementssummary', 'coreMeasurementID', { coreMeasurementID: measurementID })).toBe(HTTPResponses.OK);
    // DELETE empties coremeasurements and cmattributes; the materialized measurementssummary row stays until the next scope refresh.
    const after = await measurementState();
    expect(after.coremeasurements).toBe(ROW_GONE);
    expect(after.cmattributes).toBe(ROW_GONE);
  });
});
