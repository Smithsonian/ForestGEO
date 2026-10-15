/**
 * batchedupload route — Invalid-Rows Persistence Integration Test
 *
 * Exercises the REAL POST handler
 * (app/api/batchedupload/[schema]/[[...slugs]]/route.ts) against a real local
 * MySQL instance. Only @/auth (the session) and @/lib/contextvalidation (forced
 * to its URL-fallback branch, so no Next.js cookie/request context is needed)
 * are mocked — authenticatedSessionIdentity, recordFailedMeasurementRows, and
 * recordAuditedIngestionFailureRows all run for real and persist/audit against
 * the genuine schema.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/batchedupload-route-invalid-rows.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

// ---------------------------------------------------------------------------
// Safety guard — setupTestDatabase DROPs/CREATEs its schema; never run remote.
// ---------------------------------------------------------------------------

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';

if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(
    `[batchedupload-route-invalid-rows] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops and recreates its test schema and must only run against a local test database.`
  );
}

// ---------------------------------------------------------------------------
// Shared state bridge — hoisted so the ConnectionManager mock closure can read
// the live test connection after beforeAll wires it up.
// ---------------------------------------------------------------------------

const TRANSACTION_ID_PREFIX = 'batchedupload-route-tx-';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0,
  /**
   * Lock names GET_LOCK-acquired by each active transactionID — mirrors
   * ConnectionManager's real `transactionMeta.resourceLocks` (lib/db/connectionmanager.ts:703-788):
   * re-acquiring a name already held by the SAME transaction is a no-op, and
   * every tracked name is RELEASE_LOCK'd exactly once when that transaction
   * commits or rolls back.
   */
  transactionLocks: new Map<string, Set<string>>(),
  /** Every lock name ever requested — read by each test's afterEach leak check. */
  lockNamesSeen: new Set<string>()
}));

/** RELEASE_LOCKs and untracks every lock name `transactionID` holds — the mock's cleanupApplicationLocks equivalent. */
async function releaseLocksForTransaction(transactionID: string): Promise<void> {
  const heldLocks = sharedState.transactionLocks.get(transactionID);
  sharedState.transactionLocks.delete(transactionID);
  if (!heldLocks || heldLocks.size === 0 || !sharedState.connection) return;
  for (const lockName of heldLocks) {
    await sharedState.connection.query('SELECT RELEASE_LOCK(?) as released', [lockName]);
  }
}

// ConnectionManager mock: mirrors the real per-transaction lock lifecycle in
// lib/db/connectionmanager.ts:703-788 (re-acquire-within-transaction is a
// no-op; one RELEASE_LOCK per held name, fired in commit/rollback's `finally`
// so it runs even when they throw).
vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      const [rows] = await sharedState.connection.query(query, (params as unknown[]) ?? []);
      return rows;
    },
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (sharedState.activeTransactionID) throw new Error('ConnectionManager mock: transaction already active');
      await sharedState.connection.beginTransaction();
      sharedState.transactionCounter += 1;
      const id = `${TRANSACTION_ID_PREFIX}${sharedState.transactionCounter}`;
      sharedState.activeTransactionID = id;
      sharedState.transactionLocks.set(id, new Set());
      return id;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: commit transactionID mismatch');
      try {
        await sharedState.connection.commit();
      } finally {
        await releaseLocksForTransaction(transactionID);
        sharedState.activeTransactionID = null;
      }
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: rollback transactionID mismatch');
      try {
        await sharedState.connection.rollback();
      } finally {
        await releaseLocksForTransaction(transactionID);
        sharedState.activeTransactionID = null;
      }
    },
    // Real MySQL GET_LOCK/RELEASE_LOCK — recordAuditedIngestionFailureRows serializes
    // its bounded before-snapshot per (schema, batchID) with this. Faithful to
    // lib/db/connectionmanager.ts:703-788: a transaction that already holds
    // `lockName` gets a no-op true, never a second real GET_LOCK call.
    acquireApplicationLock: async (lockName: string, transactionID: string, timeoutMs: number) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      sharedState.lockNamesSeen.add(lockName);
      const heldByThisTransaction = sharedState.transactionLocks.get(transactionID);
      if (heldByThisTransaction?.has(lockName)) return true;

      const [rows] = await sharedState.connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, ?) as acquired', [lockName, Math.ceil(timeoutMs / 1000)]);
      const acquired = (rows as RowDataPacket[])[0]?.acquired === 1;
      if (acquired && heldByThisTransaction) heldByThisTransaction.add(lockName);
      return acquired;
    },
    releaseApplicationLock: async (lockName: string, transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      await sharedState.connection.query('SELECT RELEASE_LOCK(?) as released', [lockName]);
      sharedState.transactionLocks.get(transactionID)?.delete(lockName);
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock('@/auth', () => ({ auth: authMock }));

// Force the route's URL-fallback branch: validateContextualValues always
// reports failure, so the route authenticates + authorizes from the URL slugs
// instead of cookies/Next-request context, which this test harness has none of.
// Deliberately a PLAIN function, not vi.fn(): the project's vitest.integration.config.mts
// runs mockReset/clearMocks/restoreMocks before every test, which would wipe a
// mockResolvedValue set once here at vi.mock() factory evaluation time.
vi.mock('@/lib/contextvalidation', () => ({
  validateContextualValues: async () => ({
    success: false,
    response: new Response(JSON.stringify({ message: 'forced fallback for integration test' }), { status: 400 })
  })
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: (msg: string) => console.log(`[ailogger.info] ${msg}`),
    warn: (msg: string) => console.log(`[ailogger.warn] ${msg}`),
    error: (msg: string) => console.log(`[ailogger.error] ${msg}`)
  }
}));

import { POST } from '@/app/api/batchedupload/[schema]/[[...slugs]]/route';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const SESSION_USER_EMAIL = 'batchedupload-route-tester@example.com';
const SPOOFED_CHANGED_BY = 'attacker@example.com';

function makeRequest(body: unknown, fileID?: string) {
  const url = fileID ? `http://localhost/api?fileID=${encodeURIComponent(fileID)}` : 'http://localhost/api';
  const req = new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
  }) as any;
  req.nextUrl = new URL(url);
  return req;
}

function makeParams(schema: string, plotID: number, censusID: number) {
  return { params: Promise.resolve({ schema, slugs: [String(plotID), String(censusID)] }) } as any;
}

describe('batchedupload route — real persistence of invalid rows', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let schema: string;
  let plotID: number;
  let censusID: number;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    schema = setup.config.database;
    plotID = testData.plots[0].plotID;
    censusID = testData.census[0].censusID;
    sharedState.connection = connection;
    console.log(`[setup] schema=${schema} plotID=${plotID} censusID=${censusID}`);
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    if (sharedState.activeTransactionID) {
      const staleTransactionID = sharedState.activeTransactionID;
      await connection.rollback();
      await releaseLocksForTransaction(staleTransactionID);
      sharedState.activeTransactionID = null;
    }
    sharedState.lockNamesSeen = new Set();
    authMock.mockResolvedValue({
      user: { email: SESSION_USER_EMAIL, userStatus: 'field crew', sites: [{ schemaName: schema }] }
    });
    await connection.query(`DELETE FROM \`${schema}\`.coremeasurements WHERE UploadFileID = ? AND StemGUID IS NULL`, ['batchedupload-route-fixture.csv']);
  });

  // Faithfulness check (lib/db/connectionmanager.ts:703-788): every application
  // lock this test's route call acquired must have been released exactly once
  // via the real commit/rollback cleanup path above.
  afterEach(async () => {
    expect(sharedState.transactionLocks.size, 'no transaction should still be tracking held application locks after a test').toBe(0);
    for (const lockName of sharedState.lockNamesSeen) {
      const [rows] = await connection.query<RowDataPacket[]>('SELECT IS_USED_LOCK(?) AS owner', [lockName]);
      console.log(`[afterEach] IS_USED_LOCK(${lockName}) = ${JSON.stringify(rows[0]?.owner)}`);
      expect(rows[0]?.owner, `application lock "${lockName}" must not remain held after the test`).toBeNull();
    }
  });

  async function fetchPersistedRow(fileID: string, rawTreeTag: string): Promise<RowDataPacket | null> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID, StemGUID, UploadFileID, UploadBatchID, CensusID, RawTreeTag, Description
       FROM \`${schema}\`.coremeasurements
       WHERE UploadFileID = ? AND RawTreeTag = ? AND StemGUID IS NULL
       LIMIT 1`,
      [fileID, rawTreeTag]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  async function fetchMeasurementErrors(measurementID: number): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT mel.MeasurementID, me.ErrorCode
       FROM \`${schema}\`.measurement_error_log mel
       JOIN \`${schema}\`.measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE mel.MeasurementID = ?`,
      [measurementID]
    );
    return rows;
  }

  async function fetchChangelogRows(coreMeasurementID: number): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT Operation, ChangedBy, PlotID, CensusID
       FROM \`${schema}\`.unifiedchangelog
       WHERE TableName = 'coremeasurements' AND RecordID = ?
       ORDER BY ChangeID`,
      [String(coreMeasurementID)]
    );
    return rows;
  }

  it('persists a failed row, its error-log links, and a unifiedchangelog INSERT attributed to the session identity — never a spoofed body field', async () => {
    const fileID = 'batchedupload-route-fixture.csv';
    const payload = [
      {
        tag: 'RT0100',
        stemTag: 'S01',
        spCode: 'ACERRU',
        quadrat: 'Q01',
        failureReasons: 'Missing required fields: quadrat',
        comments: 'route integration note',
        // Spoofed actor field — the route must never read this; the persisted
        // ChangedBy must be the authenticated session's identity instead.
        changedBy: SPOOFED_CHANGED_BY
      }
    ];

    const req = makeRequest(payload, fileID);
    const res = await POST(req, makeParams(schema, plotID, censusID));
    const body = await res.json();
    console.log(`[route-invalid-rows] response status=${res.status} body=${JSON.stringify(body)}`);
    expect(res.status).toBe(200);
    expect(body.rowCount).toBe(1);

    const persisted = await fetchPersistedRow(fileID, 'RT0100');
    console.log(`[route-invalid-rows] persisted row: ${JSON.stringify(persisted)}`);
    expect(persisted, 'the route must have written a real coremeasurements row with StemGUID NULL').not.toBeNull();
    expect(persisted!.CensusID).toBe(censusID);
    expect(persisted!.Description).toBe('Missing required fields: quadrat');

    const errorLinks = await fetchMeasurementErrors(persisted!.CoreMeasurementID);
    console.log(`[route-invalid-rows] error links: ${JSON.stringify(errorLinks)}`);
    expect(errorLinks.length, 'the real failure must have been classified and linked via measurement_error_log').toBeGreaterThan(0);

    const auditRows = await fetchChangelogRows(persisted!.CoreMeasurementID);
    console.log(`[route-invalid-rows] audit rows: ${JSON.stringify(auditRows)}`);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].Operation).toBe('INSERT');
    expect(auditRows[0].PlotID).toBe(plotID);
    expect(auditRows[0].CensusID).toBe(censusID);
    // The whole point of this suite: ChangedBy must be the normalized session
    // identity, never the row's own spoofed `changedBy` field.
    expect(auditRows[0].ChangedBy).toBe(SESSION_USER_EMAIL);
    expect(auditRows[0].ChangedBy).not.toBe(SPOOFED_CHANGED_BY);
  });
});
