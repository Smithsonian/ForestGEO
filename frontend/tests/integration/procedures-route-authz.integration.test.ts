import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
const UNKNOWN_VALIDATION_ID = 999999;
const INJECTED_DROP = 'DROP TABLE coremeasurements; --';
const VALIDATION_TYPE = 'ValidateScreenMeasurements';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null
}));

// Default session is a 'global' admin so the route's auth() gate and
// assertSchemaAccess pass; individual tests override with mockResolvedValueOnce
// to exercise the non-admin denial path. Mocking @/auth also keeps the real
// next-auth module (whose lib/env.js imports the extensionless `next/server`
// subpath) from being loaded by Node's native ESM resolver, which cannot resolve it.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

// Route the route's ConnectionManager.executeQuery at the shared test connection
// so authorized requests execute against the real isolated test schema.
vi.mock('@/config/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[]) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      const [rows] = await sharedState.connection.query(query, params as any[]);
      return rows;
    }
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

async function coremeasurementsTableExists(connection: Connection, schema: string): Promise<boolean> {
  const [rows] = await connection.query('SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = ? AND table_name = ?', [
    schema,
    'coremeasurements'
  ]);
  return (rows as Array<{ cnt: number }>)[0].cnt > 0;
}

describe('POST /api/validations/procedures/[validationType] authz + server-owned definition', () => {
  let connection: Connection;
  let testData: TestData;
  let schema: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    schema = setup.config.database;
    sharedState.connection = connection;
  });

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection);
  });

  it('rejects an unknown validationProcedureID with 400 and never executes the injected cursorQuery', async () => {
    // Sanity: table exists before the request so the post-condition is meaningful.
    expect(await coremeasurementsTableExists(connection, schema)).toBe(true);

    const { POST } = await import('@/app/api/validations/procedures/[validationType]/route');
    const req = new NextRequest(`http://localhost/api/validations/procedures/${VALIDATION_TYPE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema,
        validationProcedureID: UNKNOWN_VALIDATION_ID,
        // A pre-remediation route trusted and executed this body value. It must now be ignored.
        cursorQuery: INJECTED_DROP,
        p_CensusID: testData.census[0].censusID,
        p_PlotID: testData.plots[0].plotID
      })
    });

    const res = await POST(req, { params: Promise.resolve({ validationType: VALIDATION_TYPE }) });

    expect(res.status).toBe(HTTP_BAD_REQUEST);
    // The injected DROP must not have run: coremeasurements must still exist.
    expect(await coremeasurementsTableExists(connection, schema)).toBe(true);
  });

  it('denies a schema outside the user site scope with 403 without loading any definition', async () => {
    const { auth } = await import('@/auth');
    vi.mocked(auth).mockResolvedValueOnce({
      user: { email: 'attacker@forestgeo.test', userStatus: 'field crew', sites: [{ schemaName: 'forestgeo_panama' }] }
    } as any);

    const { POST } = await import('@/app/api/validations/procedures/[validationType]/route');
    const req = new NextRequest(`http://localhost/api/validations/procedures/${VALIDATION_TYPE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema,
        validationProcedureID: UNKNOWN_VALIDATION_ID,
        cursorQuery: INJECTED_DROP,
        p_CensusID: testData.census[0].censusID,
        p_PlotID: testData.plots[0].plotID
      })
    });

    const res = await POST(req, { params: Promise.resolve({ validationType: VALIDATION_TYPE }) });
    expect(res.status).toBe(HTTP_FORBIDDEN);
    expect(await coremeasurementsTableExists(connection, schema)).toBe(true);
  });

  it('runs a seeded enabled validation Definition for an authorized request (200 stream)', async () => {
    // Pull a real enabled validation seeded by setupTestDatabase and drive it end-to-end.
    const [rows] = await connection.query(`SELECT ValidationID, ProcedureName FROM ${schema}.sitespecificvalidations WHERE IsEnabled = 1 LIMIT 1`);
    const seeded = (rows as Array<{ ValidationID: number; ProcedureName: string }>)[0];
    expect(seeded).toBeTruthy();

    const { POST } = await import('@/app/api/validations/procedures/[validationType]/route');
    const req = new NextRequest(`http://localhost/api/validations/procedures/${seeded.ProcedureName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema,
        validationProcedureID: seeded.ValidationID,
        p_CensusID: testData.census[0].censusID,
        p_PlotID: testData.plots[0].plotID
      })
    });

    const res = await POST(req, { params: Promise.resolve({ validationType: seeded.ProcedureName }) });
    expect(res.status).toBe(HTTP_OK);
    // Drain the stream so the underlying validation transaction completes.
    await res.text();
    expect(await coremeasurementsTableExists(connection, schema)).toBe(true);
  });

  it('rejects a valid validationProcedureID when the path procedure name does not match the DB-owned row', async () => {
    const [rows] = await connection.query(`SELECT ValidationID, ProcedureName FROM ${schema}.sitespecificvalidations WHERE IsEnabled = 1 LIMIT 1`);
    const seeded = (rows as Array<{ ValidationID: number; ProcedureName: string }>)[0];
    expect(seeded).toBeTruthy();

    const mismatchedProcedureName = `${seeded.ProcedureName}_Mismatch`;
    const { POST } = await import('@/app/api/validations/procedures/[validationType]/route');
    const req = new NextRequest(`http://localhost/api/validations/procedures/${mismatchedProcedureName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema,
        validationProcedureID: seeded.ValidationID,
        p_CensusID: testData.census[0].censusID,
        p_PlotID: testData.plots[0].plotID
      })
    });

    const res = await POST(req, { params: Promise.resolve({ validationType: mismatchedProcedureName }) });
    expect(res.status).toBe(HTTP_BAD_REQUEST);
    expect((await res.json()).code).toBe('VALIDATION_PROCEDURE_MISMATCH');
    expect(await coremeasurementsTableExists(connection, schema)).toBe(true);
  });

  it('ignores an injected cursorQuery even for a VALID enabled validationProcedureID (regression guard)', async () => {
    // Regression guard for the successful path: a valid, enabled ID reaches runValidation.
    // If someone rewires runValidation back to the client body, this DROP would execute.
    // Because the server loads Definition instead, the DROP must never run.
    const [rows] = await connection.query(`SELECT ValidationID, ProcedureName FROM ${schema}.sitespecificvalidations WHERE IsEnabled = 1 LIMIT 1`);
    const seeded = (rows as Array<{ ValidationID: number; ProcedureName: string }>)[0];
    expect(seeded).toBeTruthy();

    const { POST } = await import('@/app/api/validations/procedures/[validationType]/route');
    const req = new NextRequest(`http://localhost/api/validations/procedures/${seeded.ProcedureName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema,
        validationProcedureID: seeded.ValidationID,
        // Injected client SQL: must be ignored on the successful (valid-ID) path.
        cursorQuery: INJECTED_DROP,
        p_CensusID: testData.census[0].censusID,
        p_PlotID: testData.plots[0].plotID
      })
    });

    const res = await POST(req, { params: Promise.resolve({ validationType: seeded.ProcedureName }) });
    // Drain the stream so any validation transaction completes before we assert.
    await res.text();
    // The assertion that matters: the injected DROP did NOT run, proving the server
    // executed the server-owned Definition rather than the client body.
    expect(await coremeasurementsTableExists(connection, schema)).toBe(true);
  });
});
