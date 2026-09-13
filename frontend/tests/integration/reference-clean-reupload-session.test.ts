/**
 * Reference-table CLEAN_REUPLOAD across an upload session — Integration Tests
 *
 * The defect (#472): a CLEAN_REUPLOAD of species/attributes/personnel deletes the
 * whole active table before writing the incoming rows, and the upload route
 * issues ONE request per file. Every request after the first therefore deleted
 * the rows the previous one had just committed — silently, with a success
 * message and no error. The client-side fix (parse each reference file as a
 * single chunk) bounded the loss to one request per FILE; it did not remove it,
 * because reference uploads accept several files.
 *
 * These tests pin the writer-level contract that actually closes it: within one
 * upload session the reference table is replaced EXACTLY ONCE, no matter how
 * many requests the session issues, and a new session replaces again.
 *
 * They are written to fail against the pre-fix writers: case 1 of each form
 * returns only the last file's rows when the delete is not session-scoped.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/reference-clean-reupload-session.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';
import { UploadMode } from '@/config/uploadmodes';
import type { FileRow } from '@/config/macros/formdetails';

// ---------------------------------------------------------------------------
// Safety guard — setupTestDatabase DROPs/CREATEs its schema; never run remote.
// ---------------------------------------------------------------------------

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';

if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(
    `[reference-clean-reupload] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops and recreates its test schema and must only run against a local test database.`
  );
}

const TRANSACTION_ID_PREFIX = 'reference-clean-reupload-tx-';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0,
  /** Every statement the writers issued, so "did this request delete?" is directly observable. */
  statements: [] as string[],
  /** Named locks taken inside the active transaction; released when it ends, as ConnectionManager does. */
  heldLockNames: [] as string[],
  /** Runs after each writer statement, so a test can act from another connection mid-request. */
  statementObserver: null as ((statement: string) => Promise<void>) | null
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      sharedState.statements.push(query);
      const [rows] = await sharedState.connection.query(query, (params as unknown[]) ?? []);
      if (sharedState.statementObserver) await sharedState.statementObserver(query);
      return rows;
    },
    acquireApplicationLock: async (lockName: string, transactionID: string, timeoutMs: number) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: lock transactionID mismatch');
      const [rows] = await sharedState.connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, ?) AS acquired', [lockName, Math.ceil(timeoutMs / 1000)]);
      const acquired = rows[0].acquired === 1;
      if (acquired) sharedState.heldLockNames.push(lockName);
      return acquired;
    },
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (sharedState.activeTransactionID) throw new Error('ConnectionManager mock: transaction already active');
      // ConnectionManager.beginTransaction runs every transaction at READ COMMITTED; the
      // replacement claim depends on it to see a marker committed while it waited.
      await sharedState.connection.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await sharedState.connection.beginTransaction();
      sharedState.transactionCounter += 1;
      sharedState.activeTransactionID = `${TRANSACTION_ID_PREFIX}${sharedState.transactionCounter}`;
      return sharedState.activeTransactionID;
    },
    commitTransaction: async (transactionID: string) => {
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: commit transactionID mismatch');
      await sharedState.connection!.commit();
      await releaseHeldLocks();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: rollback transactionID mismatch');
      await sharedState.connection!.rollback();
      await releaseHeldLocks();
      sharedState.activeTransactionID = null;
    }
  };
  async function releaseHeldLocks(): Promise<void> {
    for (const lockName of sharedState.heldLockNames.splice(0)) {
      await sharedState.connection!.query('SELECT RELEASE_LOCK(?)', [lockName]);
    }
  }
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({
  default: {
    info: (msg: string) => console.log(`[ailogger.info] ${msg}`),
    warn: (msg: string) => console.log(`[ailogger.warn] ${msg}`),
    error: (msg: string) => console.log(`[ailogger.error] ${msg}`)
  }
}));

import ConnectionManager from '@/lib/db/connectionmanager';
import { upsertAttributeRows, upsertPersonnelRows, upsertSpeciesRows } from '@/lib/uploads/reference-data-writers';
import { ensureUploadSessionsTable } from '@/config/uploadsessiontracker';
import {
  buildReferenceReplacementLockName,
  REFERENCE_REPLACEMENT_MARKER_COLUMN,
  resetUploadSessionReplacementMarkerCacheForTests
} from '@/lib/uploads/upload-session-replacement-marker';

// ---------------------------------------------------------------------------
// Fixture vocabulary — one upload session, two files, as the route issues them.
// ---------------------------------------------------------------------------

const SESSION_ONE = 'reference-session-one';
const SESSION_TWO = 'reference-session-two';
const SESSION_USER = 'reference-clean-reupload-test@forestgeo.test';

const FILE_A_CODES = ['FILEA01', 'FILEA02', 'FILEA03'];
const FILE_B_CODES = ['FILEB01', 'FILEB02'];
const LATER_SESSION_CODES = ['LATER01'];

/** Rows the table already holds when the session's first request arrives. */
const PREEXISTING_CODES = ['STALE01', 'STALE02'];

const ATTRIBUTE_STATUS = 'alive';

/** innodb_lock_wait_timeout floor: a heartbeat that waits this long on the session row was blocked. */
const HEARTBEAT_LOCK_WAIT_TIMEOUT_SECONDS = 1;
/** Long enough for a request that is NOT waiting on the lock to have finished outright. */
const OVERLAPPING_REQUEST_SETTLE_MS = 750;
const HEARTBEAT_WRITTEN = 'heartbeat-written';

// Tables the writers own, emptied between cases in dependency order so no
// FOREIGN_KEY_CHECKS override is needed (species cascades into trees, and the
// species writer refuses a clean re-upload while any tree references a species).
const RESET_TABLES_IN_ORDER = [
  'measurementssummary',
  'coremeasurements',
  'stems',
  'trees',
  'specieslimits',
  'species',
  'genus',
  'family',
  'attributes',
  'censusactivepersonnel',
  'personnel',
  'roles',
  'upload_sessions'
];

function speciesRow(code: string): FileRow {
  return { spcode: code, family: 'Fabaceae', genus: 'Inga', species: `species-${code.toLowerCase()}`, authority: 'Testus' };
}

function attributeRow(code: string): FileRow {
  return { code, description: `description for ${code}`, status: ATTRIBUTE_STATUS };
}

function personnelRow(code: string): FileRow {
  return { firstname: code, lastname: 'Fieldworker', role: 'field crew', roledescription: 'seeded by the reference upload test' };
}

describe('reference-table CLEAN_REUPLOAD is scoped to the upload session (#472)', () => {
  let connection: Connection;
  /** A second session standing in for another request or the heartbeat endpoint. */
  let peerConnection: Connection;
  let config: TestDatabaseConfig;
  let testData: TestData;
  let schema: string;
  let censusID: number;
  let plotID: number;

  const connectionManager = ConnectionManager.getInstance();

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    config = setup.config;
    testData = setup.testData;
    schema = setup.config.database;
    plotID = testData.plots[0].plotID;
    censusID = testData.census[0].censusID;
    sharedState.connection = connection;
    peerConnection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database
    });

    // The replacement marker lives on upload_sessions, which the app creates on
    // demand. Using the production DDL also proves ensureUploadSessionsTable
    // declares the reference marker column, not only tablestructures.sql.
    await ensureUploadSessionsTable(schema);
    console.log(`[setup] schema=${schema} plotID=${plotID} censusID=${censusID}`);
  }, 90000);

  afterAll(async () => {
    await peerConnection?.end();
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    if (sharedState.activeTransactionID) {
      await connection.rollback();
      sharedState.activeTransactionID = null;
    }
    for (const table of RESET_TABLES_IN_ORDER) {
      await connection.query(`DELETE FROM ${table}`);
    }
    sharedState.statements = [];
    sharedState.statementObserver = null;
    resetUploadSessionReplacementMarkerCacheForTests();
    console.log(`[beforeEach] cleared ${RESET_TABLES_IN_ORDER.join(', ')}`);
  });

  /** Inserts the session row the marker is written to, exactly as the upload route would. */
  async function seedUploadSession(sessionID: string): Promise<void> {
    await connection.query(
      `INSERT INTO upload_sessions (session_id, schema_name, plot_id, census_id, user_id, state)
       VALUES (?, ?, ?, ?, ?, 'uploading')`,
      [sessionID, schema, plotID, censusID, SESSION_USER]
    );
  }

  /** Ends a session the way a finished upload does; the active-scope unique index
   *  allows only one live session per (schema, plot, census). */
  async function completeUploadSession(sessionID: string): Promise<void> {
    await connection.query(`UPDATE upload_sessions SET state = 'completed' WHERE session_id = ?`, [sessionID]);
  }

  async function referenceReplacementMarker(sessionID: string): Promise<string | null> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT ${REFERENCE_REPLACEMENT_MARKER_COLUMN} AS marker FROM upload_sessions WHERE session_id = ?`,
      [sessionID]
    );
    return rows.length === 0 || rows[0].marker === null ? null : String(rows[0].marker);
  }

  /** One upload request: its own transaction, committed, as the route does per file. */
  async function uploadFile(
    writer: (transactionID: string) => Promise<{ insertedCount: number; updatedCount: number; skippedCount: number }>
  ): Promise<{ insertedCount: number; updatedCount: number; skippedCount: number }> {
    const transactionID = await connectionManager.beginTransaction();
    try {
      const result = await writer(transactionID);
      await connectionManager.commitTransaction(transactionID);
      return result;
    } catch (error) {
      await connectionManager.rollbackTransaction(transactionID);
      throw error;
    }
  }

  function loggableStatements(): string {
    return sharedState.statements.map(statement => statement.replace(/\s+/g, ' ').trim()).join(' | ');
  }

  /** Counts only the table-scoped `DELETE FROM <schema>.<table>` resets, not the joined
   *  orphan cleanup that names the same table in its FROM ... LEFT JOIN clause. */
  function deleteStatementCount(tableName: string): number {
    return sharedState.statements.filter(statement => new RegExp(`^\\s*DELETE FROM \`?[^\`\\s]*\`?\\.${tableName}\\b`, 'i').test(statement)).length;
  }

  async function activeSpeciesCodes(): Promise<string[]> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT SpeciesCode FROM species WHERE IsActive = 1 ORDER BY SpeciesCode`);
    return rows.map(row => String(row.SpeciesCode));
  }

  async function activeAttributeCodes(): Promise<string[]> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT Code FROM attributes WHERE IsActive = 1 ORDER BY Code`);
    return rows.map(row => String(row.Code));
  }

  async function censusPersonnelFirstNames(): Promise<string[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT p.FirstName
         FROM personnel p
         JOIN censusactivepersonnel cap ON cap.PersonnelID = p.PersonnelID
        WHERE cap.CensusID = ? AND p.IsActive = 1
        ORDER BY p.FirstName`,
      [censusID]
    );
    return rows.map(row => String(row.FirstName));
  }

  describe('species', () => {
    const uploadSpecies = (codes: string[], uploadSessionID: string | null, uploadMode = UploadMode.CLEAN_REUPLOAD) =>
      uploadFile(transactionID => upsertSpeciesRows(connectionManager, schema, codes.map(speciesRow), uploadMode, uploadSessionID, transactionID));

    it('keeps every file of one session: the second file must not delete the first file rows', async () => {
      await seedUploadSession(SESSION_ONE);
      await uploadSpecies(PREEXISTING_CODES, null, UploadMode.REVISIONS);
      expect(await activeSpeciesCodes()).toEqual([...PREEXISTING_CODES].sort());

      await uploadSpecies(FILE_A_CODES, SESSION_ONE);
      expect(await activeSpeciesCodes()).toEqual([...FILE_A_CODES].sort());

      await uploadSpecies(FILE_B_CODES, SESSION_ONE);

      // The pre-fix writer answers with FILE_B_CODES only — that is #472.
      expect(await activeSpeciesCodes()).toEqual([...FILE_A_CODES, ...FILE_B_CODES].sort());
      expect(deleteStatementCount('species')).toBe(1);
    });

    it('records the marker on the request that replaced, and leaves it unchanged afterwards', async () => {
      await seedUploadSession(SESSION_ONE);
      expect(await referenceReplacementMarker(SESSION_ONE)).toBeNull();

      await uploadSpecies(FILE_A_CODES, SESSION_ONE);
      const markerAfterFirstFile = await referenceReplacementMarker(SESSION_ONE);
      expect(markerAfterFirstFile).not.toBeNull();

      await uploadSpecies(FILE_B_CODES, SESSION_ONE);
      expect(await referenceReplacementMarker(SESSION_ONE)).toBe(markerAfterFirstFile);
    });

    it('replaces again for a genuinely new upload session', async () => {
      await seedUploadSession(SESSION_ONE);
      await uploadSpecies(FILE_A_CODES, SESSION_ONE);
      await completeUploadSession(SESSION_ONE);

      await seedUploadSession(SESSION_TWO);
      await uploadSpecies(LATER_SESSION_CODES, SESSION_TWO);

      expect(await activeSpeciesCodes()).toEqual([...LATER_SESSION_CODES].sort());
      expect(deleteStatementCount('species')).toBe(2);
    });

    it('is idempotent when a timed-out request is retried inside the same session', async () => {
      await seedUploadSession(SESSION_ONE);
      await uploadSpecies(FILE_A_CODES, SESSION_ONE);

      // The client retries on timeout with the identical body; the unique key on
      // (SpeciesCode, IsActive) would reject a blind re-insert.
      const retry = await uploadSpecies(FILE_A_CODES, SESSION_ONE);

      expect(retry.updatedCount).toBe(FILE_A_CODES.length);
      expect(retry.insertedCount).toBe(0);
      expect(await activeSpeciesCodes()).toEqual([...FILE_A_CODES].sort());
    });

    it('still replaces on every request when the upload carries no session to scope it to', async () => {
      await uploadSpecies(FILE_A_CODES, null);
      await uploadSpecies(FILE_B_CODES, null);

      expect(await activeSpeciesCodes()).toEqual([...FILE_B_CODES].sort());
      expect(deleteStatementCount('species')).toBe(2);
    });

    it('leaves a revisions upload additive, with no delete at all', async () => {
      await seedUploadSession(SESSION_ONE);
      await uploadSpecies(FILE_A_CODES, SESSION_ONE, UploadMode.REVISIONS);
      await uploadSpecies(FILE_B_CODES, SESSION_ONE, UploadMode.REVISIONS);

      expect(await activeSpeciesCodes()).toEqual([...FILE_A_CODES, ...FILE_B_CODES].sort());
      expect(deleteStatementCount('species')).toBe(0);
      expect(await referenceReplacementMarker(SESSION_ONE)).toBeNull();
    });
  });

  describe('attributes', () => {
    const uploadAttributes = (codes: string[], uploadSessionID: string | null, uploadMode = UploadMode.CLEAN_REUPLOAD) =>
      uploadFile(transactionID => upsertAttributeRows(connectionManager, schema, codes.map(attributeRow), uploadMode, uploadSessionID, transactionID));

    it('keeps every file of one session: the second file must not delete the first file rows', async () => {
      await seedUploadSession(SESSION_ONE);
      await uploadAttributes(FILE_A_CODES, SESSION_ONE);
      expect(await activeAttributeCodes()).toEqual([...FILE_A_CODES].sort());

      await uploadAttributes(FILE_B_CODES, SESSION_ONE);

      expect(await activeAttributeCodes()).toEqual([...FILE_A_CODES, ...FILE_B_CODES].sort());
      expect(deleteStatementCount('attributes')).toBe(1);
    });

    it('replaces again for a genuinely new upload session', async () => {
      await seedUploadSession(SESSION_ONE);
      await uploadAttributes(FILE_A_CODES, SESSION_ONE);
      await completeUploadSession(SESSION_ONE);

      await seedUploadSession(SESSION_TWO);
      await uploadAttributes(LATER_SESSION_CODES, SESSION_TWO);

      expect(await activeAttributeCodes()).toEqual([...LATER_SESSION_CODES].sort());
    });

    it('is idempotent when a timed-out request is retried inside the same session', async () => {
      await seedUploadSession(SESSION_ONE);
      await uploadAttributes(FILE_A_CODES, SESSION_ONE);

      const retry = await uploadAttributes(FILE_A_CODES, SESSION_ONE);

      expect(retry.updatedCount).toBe(FILE_A_CODES.length);
      expect(retry.insertedCount).toBe(0);
      expect(await activeAttributeCodes()).toEqual([...FILE_A_CODES].sort());
    });

    it('serializes an overlapping retry: the request that waited reads the committed marker and does not delete again', async () => {
      await seedUploadSession(SESSION_ONE);

      // The first request, still in flight on another connection: it holds the session's
      // replacement lock, has replaced the table with file A and recorded the marker, but
      // has not committed yet — the moment a client that timed out sends its retry.
      await peerConnection.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await peerConnection.beginTransaction();
      const [lockRows] = await peerConnection.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS acquired', [
        buildReferenceReplacementLockName(schema, SESSION_ONE)
      ]);
      expect(lockRows[0].acquired, 'the in-flight request must hold the lock for this case to mean anything').toBe(1);
      for (const code of FILE_A_CODES) {
        await peerConnection.query(`INSERT INTO attributes (Code, Description, Status, IsActive) VALUES (?, ?, ?, 1)`, [
          code,
          `in-flight ${code}`,
          ATTRIBUTE_STATUS
        ]);
      }
      await peerConnection.query(`UPDATE upload_sessions SET ${REFERENCE_REPLACEMENT_MARKER_COLUMN} = CURRENT_TIMESTAMP WHERE session_id = ?`, [SESSION_ONE]);

      let retrySettled = false;
      const retry = uploadAttributes(FILE_A_CODES, SESSION_ONE).finally(() => {
        retrySettled = true;
      });
      await new Promise(resolve => setTimeout(resolve, OVERLAPPING_REQUEST_SETTLE_MS));
      console.log(`[overlap] retry settled before the in-flight request committed: ${retrySettled}; statements so far: ${loggableStatements()}`);
      expect(retrySettled, 'the retry must wait for the in-flight request of its own session').toBe(false);

      await peerConnection.commit();
      await peerConnection.query('SELECT RELEASE_LOCK(?)', [buildReferenceReplacementLockName(schema, SESSION_ONE)]);
      const retryResult = await retry;
      console.log(`[overlap] retry result ${JSON.stringify(retryResult)}; statements: ${loggableStatements()}`);

      expect(deleteStatementCount('attributes'), 'the retry must not run the reset a second time').toBe(0);
      expect(retryResult).toEqual({ insertedCount: 0, updatedCount: FILE_A_CODES.length, skippedCount: 0 });
      expect(await activeAttributeCodes()).toEqual([...FILE_A_CODES].sort());
    });

    it('does not lock the session row while the rows are written, so a heartbeat mid-upload goes through', async () => {
      await seedUploadSession(SESSION_ONE);
      await peerConnection.query('SET SESSION innodb_lock_wait_timeout = ?', [HEARTBEAT_LOCK_WAIT_TIMEOUT_SECONDS]);

      const heartbeatOutcomes: string[] = [];
      sharedState.statementObserver = async statement => {
        if (!/^\s*INSERT INTO \S+\.attributes\b/i.test(statement)) return;
        try {
          await peerConnection.query('UPDATE upload_sessions SET last_heartbeat = CURRENT_TIMESTAMP WHERE session_id = ?', [SESSION_ONE]);
          heartbeatOutcomes.push(HEARTBEAT_WRITTEN);
        } catch (error: unknown) {
          heartbeatOutcomes.push(`heartbeat-blocked: ${(error as { code?: string }).code ?? String(error)}`);
        }
      };

      await uploadAttributes(FILE_A_CODES, SESSION_ONE);
      console.log(`[heartbeat] outcomes after each attribute insert: ${heartbeatOutcomes.join(', ')}`);

      expect(heartbeatOutcomes).toEqual(FILE_A_CODES.map(() => HEARTBEAT_WRITTEN));
      expect(await referenceReplacementMarker(SESSION_ONE), 'the marker must still be recorded, after the rows').not.toBeNull();
    });
  });

  describe('personnel', () => {
    const uploadPersonnel = (codes: string[], uploadSessionID: string | null, uploadMode = UploadMode.CLEAN_REUPLOAD) =>
      uploadFile(transactionID =>
        upsertPersonnelRows(connectionManager, schema, censusID, codes.map(personnelRow), uploadMode, uploadSessionID, transactionID)
      );

    it('keeps every file of one session: the second file must not unlink the first file roster', async () => {
      await seedUploadSession(SESSION_ONE);
      await uploadPersonnel(FILE_A_CODES, SESSION_ONE);
      expect(await censusPersonnelFirstNames()).toEqual([...FILE_A_CODES].sort());

      await uploadPersonnel(FILE_B_CODES, SESSION_ONE);

      expect(await censusPersonnelFirstNames()).toEqual([...FILE_A_CODES, ...FILE_B_CODES].sort());
      expect(deleteStatementCount('censusactivepersonnel')).toBe(1);
    });

    it('replaces again for a genuinely new upload session', async () => {
      await seedUploadSession(SESSION_ONE);
      await uploadPersonnel(FILE_A_CODES, SESSION_ONE);
      await completeUploadSession(SESSION_ONE);

      await seedUploadSession(SESSION_TWO);
      await uploadPersonnel(LATER_SESSION_CODES, SESSION_TWO);

      expect(await censusPersonnelFirstNames()).toEqual([...LATER_SESSION_CODES].sort());
    });

    it('is idempotent when a timed-out request is retried inside the same session', async () => {
      await seedUploadSession(SESSION_ONE);
      await uploadPersonnel(FILE_A_CODES, SESSION_ONE);

      const retry = await uploadPersonnel(FILE_A_CODES, SESSION_ONE);

      expect(retry.updatedCount).toBe(FILE_A_CODES.length);
      expect(retry.insertedCount).toBe(0);
      expect(await censusPersonnelFirstNames()).toEqual([...FILE_A_CODES].sort());
    });
  });
});
