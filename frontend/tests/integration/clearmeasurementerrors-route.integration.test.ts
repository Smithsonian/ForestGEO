import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import mysql from 'mysql2/promise';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestDatabaseConfig } from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';
const TEST_TRANSACTION_ID_PREFIX = 'clear-route-transaction-';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0,
  failOnce: null as RegExp | null
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      if (sharedState.failOnce && sharedState.failOnce.test(query)) {
        sharedState.failOnce = null;
        throw new Error('injected failure');
      }
      const [rows] = await sharedState.connection.query(query, (params as unknown[]) ?? []);
      return rows;
    },
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (sharedState.activeTransactionID) throw new Error('ConnectionManager mock: transaction already active');
      await sharedState.connection.beginTransaction();
      sharedState.transactionCounter += 1;
      sharedState.activeTransactionID = `${TEST_TRANSACTION_ID_PREFIX}${sharedState.transactionCounter}`;
      return sharedState.activeTransactionID;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error('ConnectionManager mock: commit transactionID mismatch');
      }
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
      await sharedState.connection.query('SELECT RELEASE_ALL_LOCKS()');
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error('ConnectionManager mock: rollback transactionID mismatch');
      }
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
      await sharedState.connection.query('SELECT RELEASE_ALL_LOCKS()');
    },
    // Takes the real lock so the contention case is observable: an always-true double would hide it.
    acquireApplicationLock: async (lockName: string, _transactionID: string, timeoutMs: number) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      const [rows] = await sharedState.connection.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, Math.ceil(timeoutMs / 1000)]);
      return (rows as { acquired: number }[])[0]?.acquired === 1;
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined
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

// Imports must follow vi.mock so the mocked ConnectionManager is wired in.
import ConnectionManager from '@/lib/db/connectionmanager';
import { CLEAR_MEASUREMENT_ERRORS_CODES, DEFAULT_ERROR_EXPLORER_FILTERS } from '@/config/errorsexplorer';
import { buildMeasurementScopeLockName } from '@/config/measurementscopelock';
import { refreshMeasurementViewsForScope } from '@/lib/measurementviewrefresh';
import { queryErrorExplorer } from '@/app/api/errors/explorer/_shared';

const HTTP_OK = 200;
const HTTP_CONFLICT = 409;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_LOCKED = 423;
/** `IsValidated + 0` of the BIT column for a row that passed validation. */
const IS_VALIDATED_PASSED = 1;
const IS_VALIDATED_FAILED = 0;
const EXPLORER_PAGE_SIZE = 100;

const ERROR_SOURCE_VALIDATION = 'validation';
const ERROR_SOURCE_INGESTION = 'ingestion';
const VALIDATION_CODE_ONLY_VALIDATION_ERROR = '14';
const INGESTION_CODE_INVALID_SPECIES = 'INVALID_SPECIES';

const MEASUREMENT_DATE = '2024-06-01';
const STEM_BASE_GUID = 990_000;
const STEM_TAG = '1';
const SEED_OFFSETS = { fallback: 1, validation: 2, mixed: 3, atomic: 4, contended: 5, passed: 6 } as const;
const TREE_TAGS = {
  fallback: 'CLR-FALLBACK',
  validation: 'CLR-VALID',
  mixed: 'CLR-MIXED',
  failed: 'CLR-FAILED',
  atomic: 'CLR-ATOMIC',
  contended: 'CLR-LOCKED',
  passed: 'CLR-PASSED'
} as const;

interface SeededRows {
  fallback: number;
  validation: number;
  mixed: number;
  failed: number;
}

async function errorID(connection: Connection, source: string, code: string): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT ErrorID FROM measurement_errors WHERE ErrorSource = ? AND ErrorCode = ?', [source, code]);
  return Number(rows[0].ErrorID);
}

async function logError(connection: Connection, measurementID: number, source: string, code: string): Promise<void> {
  await connection.query('INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) VALUES (?, ?, 0)', [
    measurementID,
    await errorID(connection, source, code)
  ]);
}

async function seedLinkedRow(connection: Connection, censusID: number, quadratID: number, speciesID: number, treeTag: string, offset: number): Promise<number> {
  const stemGUID = STEM_BASE_GUID + offset;
  const [tree] = await connection.query<ResultSetHeader>('INSERT INTO trees (TreeTag, SpeciesID, CensusID) VALUES (?, ?, ?)', [treeTag, speciesID, censusID]);
  await connection.query('INSERT INTO stems (StemGUID, TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    stemGUID,
    tree.insertId,
    quadratID,
    censusID,
    STEM_TAG,
    offset,
    offset
  ]);
  const [measurement] = await connection.query<ResultSetHeader>(
    'INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, IsActive) VALUES (?, ?, FALSE, ?, ?, ?, 1)',
    [censusID, stemGUID, MEASUREMENT_DATE, 10 + offset, 1.3]
  );
  return measurement.insertId;
}

describe('POST /api/validations/clearmeasurementerrors against real MySQL', () => {
  let connection: Connection;
  let config: TestDatabaseConfig;
  let schema: string;
  let plotID: number;
  let censusID: number;
  let quadratID: number;
  let speciesID: number;
  let rows: SeededRows;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    config = setup.config;
    schema = setup.config.database;
    plotID = setup.testData.plots[0].plotID;
    censusID = setup.testData.census[0].censusID;
    sharedState.connection = connection;

    const [quadrats] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE PlotID = ? LIMIT 1', [plotID]);
    quadratID = Number(quadrats[0].QuadratID);
    const [species] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species LIMIT 1');
    speciesID = Number(species[0].SpeciesID);

    const fallback = await seedLinkedRow(connection, censusID, quadratID, speciesID, TREE_TAGS.fallback, SEED_OFFSETS.fallback);
    const validation = await seedLinkedRow(connection, censusID, quadratID, speciesID, TREE_TAGS.validation, SEED_OFFSETS.validation);
    const mixed = await seedLinkedRow(connection, censusID, quadratID, speciesID, TREE_TAGS.mixed, SEED_OFFSETS.mixed);
    const [failedInsert] = await connection.query<ResultSetHeader>(
      `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, IsActive, RawTreeTag) VALUES (?, NULL, FALSE, '${MEASUREMENT_DATE}', 1, ?)`,
      [censusID, TREE_TAGS.failed]
    );
    const failed = failedInsert.insertId;

    await logError(connection, validation, ERROR_SOURCE_VALIDATION, VALIDATION_CODE_ONLY_VALIDATION_ERROR);
    await logError(connection, mixed, ERROR_SOURCE_VALIDATION, VALIDATION_CODE_ONLY_VALIDATION_ERROR);
    await logError(connection, failed, ERROR_SOURCE_VALIDATION, VALIDATION_CODE_ONLY_VALIDATION_ERROR);
    await logError(connection, mixed, ERROR_SOURCE_INGESTION, INGESTION_CODE_INVALID_SPECIES);

    rows = { fallback, validation, mixed, failed };
    await refreshMeasurementViewsForScope(ConnectionManager.getInstance(), schema, plotID, censusID);
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    sharedState.activeTransactionID = null;
    sharedState.failOnce = null;
    await teardownTestDatabase(connection, config);
  });

  async function storedIsValidated(measurementID: number): Promise<unknown> {
    const [stored] = await connection.query<RowDataPacket[]>('SELECT IsValidated + 0 AS IsValidated FROM measurementssummary WHERE CoreMeasurementID = ?', [
      measurementID
    ]);
    return stored[0]?.IsValidated;
  }

  async function coreIsValidated(measurementID: number): Promise<RowDataPacket> {
    const [core] = await connection.query<RowDataPacket[]>('SELECT IsValidated + 0 AS IsValidated FROM coremeasurements WHERE CoreMeasurementID = ?', [
      measurementID
    ]);
    return core[0];
  }

  async function logCount(measurementID: number): Promise<number> {
    const [logs] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM measurement_error_log WHERE MeasurementID = ?', [measurementID]);
    return Number(logs[0].n);
  }

  async function errorSetIDs(): Promise<number[]> {
    const query = await queryErrorExplorer(ConnectionManager.getInstance(), {
      schema,
      plotID,
      censusID,
      censusIDs: [censusID],
      filters: DEFAULT_ERROR_EXPLORER_FILTERS,
      page: 0,
      pageSize: EXPLORER_PAGE_SIZE
    });
    const ids = query.rows.map(row => Number(row.coreMeasurementID));
    console.log('[view-errors clear rebuild]', JSON.stringify({ totalRows: query.totalRows, ids }));
    return ids;
  }

  async function clear(measurementID: number) {
    const { POST } = await import('@/app/api/validations/clearmeasurementerrors/route');
    return POST(
      new NextRequest('http://localhost/api/validations/clearmeasurementerrors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema, plotID, censusID, measurementID })
      }),
      { params: Promise.resolve({}) }
    );
  }

  it('sends a linked fallback row back to pending and rebuilds its stored summary (P2-9)', async () => {
    expect(await errorSetIDs()).toContain(rows.fallback);
    const response = await clear(rows.fallback);
    expect(response.status).toBe(HTTP_OK);
    expect(await response.json()).toEqual({ clearedErrorCount: 0 });
    expect(await storedIsValidated(rows.fallback), 'a route that skipped the rebuild would leave FALSE here').toBeNull();
    expect(await errorSetIDs()).not.toContain(rows.fallback);
  });

  it("deletes a linked row's only validation error and drops it from the error set", async () => {
    const response = await clear(rows.validation);
    expect(await response.json()).toEqual({ clearedErrorCount: 1 });
    expect(await storedIsValidated(rows.validation)).toBeNull();
    expect(await errorSetIDs()).not.toContain(rows.validation);
  });

  it('keeps an ingestion entry: the row stays in the error set', async () => {
    const response = await clear(rows.mixed);
    expect(await response.json()).toEqual({ clearedErrorCount: 1 });
    const [logs] = await connection.query<RowDataPacket[]>(
      'SELECT me.ErrorSource FROM measurement_error_log mel JOIN measurement_errors me ON me.ErrorID = mel.ErrorID WHERE mel.MeasurementID = ?',
      [rows.mixed]
    );
    expect(logs.map(log => log.ErrorSource)).toEqual([ERROR_SOURCE_INGESTION]);
    expect(await errorSetIDs()).toContain(rows.mixed);
  });

  it('refuses a failed row with 409 and changes nothing', async () => {
    const response = await clear(rows.failed);
    expect(response.status).toBe(HTTP_CONFLICT);
    expect(await logCount(rows.failed)).toBe(1);
  });

  it('refuses a row that already passed validation with 409 NOTHING_TO_CLEAR and leaves it passed (r3, R2)', async () => {
    const passedRow = await seedLinkedRow(connection, censusID, quadratID, speciesID, TREE_TAGS.passed, SEED_OFFSETS.passed);
    await connection.query('UPDATE coremeasurements SET IsValidated = TRUE WHERE CoreMeasurementID = ?', [passedRow]);
    await refreshMeasurementViewsForScope(ConnectionManager.getInstance(), schema, plotID, censusID);
    const response = await clear(passedRow);
    const body = await response.json();
    const core = await coreIsValidated(passedRow);
    const stored = await storedIsValidated(passedRow);
    console.log('[view-errors clear already passed]', response.status, JSON.stringify({ body, core, stored }));
    expect(response.status).toBe(HTTP_CONFLICT);
    expect(body.code).toBe(CLEAR_MEASUREMENT_ERRORS_CODES.nothingToClear);
    expect(Number(core.IsValidated), 'a passed row is never sent back to pending').toBe(IS_VALIDATED_PASSED);
    expect(Number(stored), 'the stored summary still says passed').toBe(IS_VALIDATED_PASSED);
  });

  it('leaves the log and IsValidated intact when the second statement fails', async () => {
    const freshRow = await seedLinkedRow(connection, censusID, quadratID, speciesID, TREE_TAGS.atomic, SEED_OFFSETS.atomic);
    await logError(connection, freshRow, ERROR_SOURCE_VALIDATION, VALIDATION_CODE_ONLY_VALIDATION_ERROR);
    sharedState.failOnce = /SET IsValidated = NULL/;
    const response = await clear(freshRow);
    expect(response.status).toBe(HTTP_INTERNAL_SERVER_ERROR);
    const logs = await logCount(freshRow);
    const core = await coreIsValidated(freshRow);
    console.log('[view-errors clear atomicity]', JSON.stringify({ logs, core }));
    expect(logs, 'the DELETE must have rolled back').toBe(1);
    expect(Number(core.IsValidated)).toBe(IS_VALIDATED_FAILED);
  });

  it('answers 423 and changes nothing while another session holds the measurement-scope lock (P2-1)', async () => {
    const contendedRow = await seedLinkedRow(connection, censusID, quadratID, speciesID, TREE_TAGS.contended, SEED_OFFSETS.contended);
    await logError(connection, contendedRow, ERROR_SOURCE_VALIDATION, VALIDATION_CODE_ONLY_VALIDATION_ERROR);
    await refreshMeasurementViewsForScope(ConnectionManager.getInstance(), schema, plotID, censusID);
    const lockName = buildMeasurementScopeLockName(schema, plotID, censusID);
    const holder = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database
    });
    try {
      const [held] = await holder.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
      expect(Number(held[0].acquired), 'the second session holds the scope lock').toBe(1);
      const response = await clear(contendedRow);
      const body = await response.json();
      const logs = await logCount(contendedRow);
      const core = await coreIsValidated(contendedRow);
      const stored = await storedIsValidated(contendedRow);
      console.log('[view-errors clear contention]', response.status, JSON.stringify({ body, logs, core, stored }));
      expect(response.status).toBe(HTTP_LOCKED);
      expect(body.code).toBe(CLEAR_MEASUREMENT_ERRORS_CODES.scopeBusy);
      expect(logs, 'the log entry is still there').toBe(1);
      expect(Number(core.IsValidated), 'IsValidated is unchanged').toBe(IS_VALIDATED_FAILED);
      expect(Number(stored), 'the stored summary is unchanged').toBe(IS_VALIDATED_FAILED);
    } finally {
      await holder.query('SELECT RELEASE_LOCK(?)', [lockName]);
      await holder.end();
    }
    const afterRelease = await clear(contendedRow);
    expect(afterRelease.status, 'the same clear succeeds once the lock is free').toBe(HTTP_OK);
  });
});
