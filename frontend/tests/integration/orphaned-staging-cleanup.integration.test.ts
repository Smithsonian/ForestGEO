/**
 * /api/cleanup orphaned staged-row ownership (#561 N2): AI19 regression and AI18's static variants.
 *
 * A staged row is owned while its SessionID is an active upload session or its FileID is an active session's file_id.
 * Each test seeds upload_sessions + temporarymeasurements with plain SQL, runs the finder then the DELETE exactly as
 * the route does, and logs the surviving rows per (FileID, SessionID).
 *
 * Prerequisites: docker compose up -d mysql
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestDatabaseConfig } from '../setup/local-db-setup';

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(`[orphaned-staging-cleanup] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not local. This suite deletes staged rows.`);
}

const sharedState = vi.hoisted(() => ({
  connection: null as import('mysql2/promise').Connection | null,
  counter: 0
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (sql: string, params?: unknown[], _transactionID?: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      const [rows] = await sharedState.connection.query(sql, params ?? []);
      return rows;
    },
    withTransaction: async <T>(fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown>; readonly id: string }) => Promise<T>): Promise<T> => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      await sharedState.connection.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await sharedState.connection.beginTransaction();
      sharedState.counter += 1;
      const id = `orphan-cleanup-tx-${sharedState.counter}`;
      try {
        const result = await fn({ id, query: (sql: string, params?: unknown[]) => manager.executeQuery(sql, params, id) });
        await sharedState.connection.commit();
        return result;
      } catch (error) {
        await sharedState.connection.rollback();
        throw error;
      }
    }
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import ConnectionManager from '@/lib/db/connectionmanager';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import { ensureUploadSessionsTable, UploadSessionState } from '@/config/uploadsessiontracker';
import { deleteOrphanedTemporaryMeasurements, findOrphanedTemporaryMeasurements } from '@/lib/uploads/orphaned-staging-cleanup';

const SESSION_USER = 'integration-test@forestgeo.test';
const STAGED_PLOT_ID = 1;
const STAGED_BATCH_ID = 'batch-0001';
const SOURCE_FORMAT = 'csv';

const COMPLETED_SESSION = 'S_done';
const SYNC_SESSION = 'S_sync';
const WORKER_SESSION = 'S_w';
const OLD_FAILED_SESSION = 'S_old';
const CSV_WORKER_SESSION = 'S_csv';
const LEGACY_SESSION = 'S_legacy';

const OLD_FILE = 'old.csv';
const SYNC_FILE = 'sync.csv';
const ARCGIS_FILE = 'arcgis.xlsx';
const SHARED_FILE = 'shared.xlsx';
const LEGACY_FILE = 'legacy.csv';
const CSV_WORKER_STAGED_FILE = 'plot.csv';
const WORKER_JOB_FILE_ID = 'async-job-77';
const CSV_WORKER_JOB_FILE_ID = 'async-job-78';

interface StagedRowCount {
  FileID: string | null;
  SessionID: string | null;
  rows: number;
}

describe('orphaned staged-row ownership against a real upload_sessions table (#561 N2)', () => {
  let connection: Connection;
  let config: TestDatabaseConfig;
  let schema: string;
  let activeScopeCounter = 0;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    config = setup.config;
    schema = setup.config.database;
    sharedState.connection = connection;
    await ensureUploadSessionsTable(schema);
  });

  afterAll(async () => {
    sharedState.connection = null;
    try {
      await getPoolMonitorInstance().closeAllConnections();
    } finally {
      await teardownTestDatabase(connection, config);
    }
  });

  beforeEach(async () => {
    await connection.query('DELETE FROM temporarymeasurements');
    await connection.query('DELETE FROM upload_sessions');
  });

  async function seedSession(sessionID: string, state: UploadSessionState, fileID: string | null): Promise<void> {
    activeScopeCounter += 1;
    await connection.query(`INSERT INTO upload_sessions (session_id, schema_name, plot_id, census_id, user_id, state, file_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      sessionID,
      schema,
      STAGED_PLOT_ID,
      activeScopeCounter,
      SESSION_USER,
      state,
      fileID
    ]);
  }

  async function setSessionState(sessionID: string, state: UploadSessionState): Promise<void> {
    await connection.query(`UPDATE upload_sessions SET state = ? WHERE session_id = ?`, [state, sessionID]);
  }

  async function seedStagedRows(fileID: string, sessionID: string | null, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await connection.query(`INSERT INTO temporarymeasurements (FileID, BatchID, SessionID, SourceFormat, PlotID, CensusID) VALUES (?, ?, ?, ?, ?, ?)`, [
        fileID,
        STAGED_BATCH_ID,
        sessionID,
        SOURCE_FORMAT,
        STAGED_PLOT_ID,
        1
      ]);
    }
  }

  async function survivingRows(): Promise<StagedRowCount[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT FileID, SessionID, COUNT(*) AS rowCount FROM temporarymeasurements GROUP BY FileID, SessionID ORDER BY FileID, SessionID`
    );
    return rows.map(row => ({ FileID: row.FileID, SessionID: row.SessionID, rows: Number(row.rowCount) }));
  }

  async function runCleanup(label: string): Promise<{ found: Awaited<ReturnType<typeof findOrphanedTemporaryMeasurements>>; deleted: number }> {
    const manager = ConnectionManager.getInstance();
    const found = await findOrphanedTemporaryMeasurements(manager, schema);
    const deleted = await deleteOrphanedTemporaryMeasurements(
      manager,
      schema,
      found.map(file => file.fileId)
    );
    console.log(`[${label}] found=${JSON.stringify(found)} deleted=${deleted}`);
    console.table(await survivingRows());
    return { found, deleted };
  }

  it('AI19: deletes rows whose session is not active and whose FileID matches no active file_id; a sync upload survives', async () => {
    const completedRows = 4;
    const syncRows = 3;
    await seedSession(COMPLETED_SESSION, UploadSessionState.COMPLETED, OLD_FILE);
    await seedStagedRows(OLD_FILE, COMPLETED_SESSION, completedRows);
    await seedSession(SYNC_SESSION, UploadSessionState.UPLOADING, SYNC_FILE);
    await seedStagedRows(SYNC_FILE, SYNC_SESSION, syncRows);

    const { found, deleted } = await runCleanup('AI19');

    expect(found).toEqual([{ fileId: OLD_FILE, rowCount: completedRows }]);
    expect(deleted).toBe(completedRows);
    expect(await survivingRows()).toEqual([{ FileID: SYNC_FILE, SessionID: SYNC_SESSION, rows: syncRows }]);
  });

  it('AI18: rows of an active worker session (file_id = async-job-<id>) survive; failing that session deletes them', async () => {
    const workerRows = 5;
    await seedSession(WORKER_SESSION, UploadSessionState.UPLOADING, WORKER_JOB_FILE_ID);
    await seedStagedRows(ARCGIS_FILE, WORKER_SESSION, workerRows);

    const whileActive = await runCleanup('AI18 worker active');
    expect(whileActive.found).toEqual([]);
    expect(whileActive.deleted).toBe(0);
    expect(await survivingRows()).toEqual([{ FileID: ARCGIS_FILE, SessionID: WORKER_SESSION, rows: workerRows }]);

    await setSessionState(WORKER_SESSION, UploadSessionState.FAILED);
    const afterFailure = await runCleanup('AI18 worker failed (positive control)');
    expect(afterFailure.found).toEqual([{ fileId: ARCGIS_FILE, rowCount: workerRows }]);
    expect(afterFailure.deleted).toBe(workerRows);
    expect(await survivingRows()).toEqual([]);
  });

  it('AI18: a FileID holding an active session’s rows and a failed session’s rows loses exactly the failed session’s rows', async () => {
    const activeRows = 2;
    const failedRows = 3;
    await seedSession(WORKER_SESSION, UploadSessionState.UPLOADING, WORKER_JOB_FILE_ID);
    await seedSession(OLD_FAILED_SESSION, UploadSessionState.FAILED, SHARED_FILE);
    await seedStagedRows(SHARED_FILE, WORKER_SESSION, activeRows);
    await seedStagedRows(SHARED_FILE, OLD_FAILED_SESSION, failedRows);

    const { found, deleted } = await runCleanup('AI18 mixed file name');

    expect(found).toEqual([{ fileId: SHARED_FILE, rowCount: failedRows }]);
    expect(deleted).toBe(failedRows);
    expect(await survivingRows()).toEqual([{ FileID: SHARED_FILE, SessionID: WORKER_SESSION, rows: activeRows }]);
  });

  it('AI18: NULL-SessionID rows survive while an active session owns their FileID, and are deleted once it completes', async () => {
    const legacyRows = 2;
    await seedSession(LEGACY_SESSION, UploadSessionState.UPLOADING, LEGACY_FILE);
    await seedStagedRows(LEGACY_FILE, null, legacyRows);

    const whileOwned = await runCleanup('AI18 NULL SessionID owned');
    expect(whileOwned.found).toEqual([]);
    expect(whileOwned.deleted).toBe(0);
    expect(await survivingRows()).toEqual([{ FileID: LEGACY_FILE, SessionID: null, rows: legacyRows }]);

    await setSessionState(LEGACY_SESSION, UploadSessionState.COMPLETED);
    const afterCompletion = await runCleanup('AI18 NULL SessionID unowned');
    expect(afterCompletion.found).toEqual([{ fileId: LEGACY_FILE, rowCount: legacyRows }]);
    expect(afterCompletion.deleted).toBe(legacyRows);
    expect(await survivingRows()).toEqual([]);
  });

  it('AI18: a CSV worker job’s staged chunk survives (the worker stamps its SessionID)', async () => {
    const chunkRows = 6;
    await seedSession(CSV_WORKER_SESSION, UploadSessionState.UPLOADING, CSV_WORKER_JOB_FILE_ID);
    await seedStagedRows(CSV_WORKER_STAGED_FILE, CSV_WORKER_SESSION, chunkRows);

    const { found, deleted } = await runCleanup('AI18 CSV worker staging');

    expect(found).toEqual([]);
    expect(deleted).toBe(0);
    expect(await survivingRows()).toEqual([{ FileID: CSV_WORKER_STAGED_FILE, SessionID: CSV_WORKER_SESSION, rows: chunkRows }]);
  });

  it('the DELETE re-checks ownership itself: a file listed as orphaned that gains an owner before the DELETE survives', async () => {
    const stagedRows = 4;
    await seedSession(OLD_FAILED_SESSION, UploadSessionState.FAILED, OLD_FILE);
    await seedStagedRows(OLD_FILE, OLD_FAILED_SESSION, stagedRows);
    const manager = ConnectionManager.getInstance();
    const found = await findOrphanedTemporaryMeasurements(manager, schema);
    expect(found).toEqual([{ fileId: OLD_FILE, rowCount: stagedRows }]);

    await setSessionState(OLD_FAILED_SESSION, UploadSessionState.UPLOADING);
    const deleted = await deleteOrphanedTemporaryMeasurements(
      manager,
      schema,
      found.map(file => file.fileId)
    );
    console.log(`[AI18 late owner] deleted=${deleted}`);
    console.table(await survivingRows());

    expect(deleted).toBe(0);
    expect(await survivingRows()).toEqual([{ FileID: OLD_FILE, SessionID: OLD_FAILED_SESSION, rows: stagedRows }]);
  });
});
