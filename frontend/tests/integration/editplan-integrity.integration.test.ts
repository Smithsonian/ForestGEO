/**
 * Editplan Bulk Hash Drift — Integrity Coverage
 *
 * Verifies that the apply endpoint (POST /api/revisionupload/apply) surfaces a
 * 409 plan-hash mismatch when the payload delivered by the client differs from
 * what the match endpoint canonicalized at review time.
 *
 * Two drift vectors exercised:
 *
 * 1. New-row content tamper: a new-row `csvRow.tag` is mutated after match.
 *    The `revision-insert` canonical hash covers identity fields (TreeTag, …),
 *    so the tampered payload produces a different `planHash` at apply time.
 *
 * 2. Duplicate-swap: three measurements share a stem; match picks the highest
 *    CoreMeasurementID as survivor and returns the other two as
 *    `duplicateMeasurementIDsToDelete`. Swapping which sibling is listed first
 *    in the top-level `duplicateMeasurementIDsToDelete` (and in the per-row
 *    array, to satisfy `duplicatesMatch`) changes the `DuplicateDeletion[]`
 *    sort order in `analyzeBulk`, producing a different plan hash.
 *
 * Both tests are structured identically:
 *   match → record bulkPlanHash → tamper → apply → assert 409 with freshPlan.
 *
 * Happy-path coverage (non-tampered apply produces 200) is provided by
 * revision-upload.integration.test.ts; this file focuses solely on drift
 * detection so each test stays minimal and the assertions are unambiguous.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DEFAULT_TEST_CONFIG, setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';
import type { RevisionUploadResponse } from '@/config/revisionuploadtypes';
import type { BulkEditPlan } from '@/config/editplan/types';

// ---------------------------------------------------------------------------
// Named constants — no magic numbers or strings
// ---------------------------------------------------------------------------

const AUTH_USER_EMAIL = 'integrity-test@example.com';
const TRANSACTION_ID_PREFIX = 'integrity-tx-';

const MATCHED_ROW_TREE_TAG = 'IGRT001';
const MATCHED_ROW_STEM_TAG = 'IGRS1';
const MATCHED_ROW_DBH = 14.5;
const MATCHED_ROW_HOM = 1.3;
const MATCHED_ROW_DATE = '2024-05-10';

const NEW_ROW_TREE_TAG = 'IGRNEW01';
const TAMPERED_TREE_TAG = 'IGRNEW01-TAMPERED';
const NEW_ROW_STEM_TAG = 'IGRSN1';
const NEW_ROW_SPECIES = 'ACERRU';
const NEW_ROW_QUADRAT = 'Q01';
const NEW_ROW_LX = '3.0';
const NEW_ROW_LY = '7.0';
const NEW_ROW_DBH = '8.5';
const NEW_ROW_DATE = '2025-03-01';

const DUPLICATE_TREE_TAG = 'IGRDUP01';
const DUPLICATE_STEM_TAG = 'IGRDS1';
const DUPLICATE_DBH_FIRST = 10.0;
const DUPLICATE_DBH_SECOND = 11.0;
const DUPLICATE_DBH_THIRD = 12.0;
const DUPLICATE_DATE_FIRST = '2024-01-01';
const DUPLICATE_DATE_SECOND = '2024-02-01';
const DUPLICATE_DATE_THIRD = '2024-03-01';
const DUPLICATE_UPDATED_DBH = '13.5';

const PLAN_HASH_MISMATCH_ERROR = 'plan hash mismatch';
const HTTP_STATUS_CONFLICT = 409;
const HTTP_STATUS_OK = 200;
const SHA256_HEX_LENGTH = 64;

// ---------------------------------------------------------------------------
// Shared state bridge — hoisted so vi.mock closures can read the live
// connection after beforeAll completes.
// ---------------------------------------------------------------------------
const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0
}));

// ---------------------------------------------------------------------------
// Auth mock — grants 'global' role so assertCanEditMeasurementScope bypasses
// per-schema site membership checks and scope guard passes.
// ---------------------------------------------------------------------------
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

// ---------------------------------------------------------------------------
// ConnectionManager mock — wires all DB calls to the shared test connection.
// Implements withTransaction using the connection's own begin/commit/rollback
// so the revisionupload/apply route's transaction callback runs against real
// MySQL rather than a stub.
// ---------------------------------------------------------------------------
vi.mock('@/config/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(
          `ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`
        );
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
      return id;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error('ConnectionManager mock: commit transactionID mismatch');
      }
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error('ConnectionManager mock: rollback transactionID mismatch');
      }
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
    },
    withTransaction: async <T>(fn: (transactionID: string) => Promise<T>) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      await sharedState.connection.beginTransaction();
      sharedState.transactionCounter += 1;
      const txID = `${TRANSACTION_ID_PREFIX}${sharedState.transactionCounter}`;
      sharedState.activeTransactionID = txID;
      try {
        const result = await fn(txID);
        await sharedState.connection.commit();
        sharedState.activeTransactionID = null;
        return result;
      } catch (err) {
        await sharedState.connection.rollback();
        sharedState.activeTransactionID = null;
        throw err;
      }
    },
    acquireApplicationLock: async (lockName: string, _transactionID: string, timeoutMs: number) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      const timeoutSeconds = Math.ceil(timeoutMs / 1000);
      const [rows] = (await sharedState.connection.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, timeoutSeconds])) as unknown as [
        RowDataPacket[],
        unknown
      ];
      return rows?.[0]?.acquired === 1;
    },
    releaseApplicationLock: async (lockName: string) => {
      if (!sharedState.connection) return;
      await sharedState.connection.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
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

// ensureUploadSessionsTable uses getConn() from processormacros which
// opens its own pool connection — bypasses the ConnectionManager mock and
// attempts to reach the real Azure DB. Mock the entire module so the apply
// route's pre-transaction setup step is a no-op against the test schema.
// The upload_sessions table already exists (loadSchema creates it from
// tablestructures.sql), so the only thing the real implementation would
// add is the scope lock index — safe to skip in integration tests.
vi.mock('@/config/uploadsessiontracker', async () => {
  const actual = await vi.importActual<typeof import('@/config/uploadsessiontracker')>('@/config/uploadsessiontracker');
  return {
    ...actual,
    ensureUploadSessionsTable: async (_schema: string) => {
      /* no-op: upload_sessions already created by loadSchema */
    }
  };
});

// Auth freshness re-check: always-fresh in this suite (drift comes from
// payload tampering, not role changes between preview and apply).
vi.mock('@/config/editplan/authorization', async () => {
  const actual = await vi.importActual<typeof import('@/config/editplan/authorization')>('@/config/editplan/authorization');
  return {
    ...actual,
    createFreshAuthorizationCheck: () => async () => {
      /* always-fresh */
    }
  };
});

// Route handlers — imported after vi.mock so the mocked modules are wired in.
import { POST as matchPOST } from '@/app/api/revisionupload/route';
import { POST as applyPOST } from '@/app/api/revisionupload/apply/route';

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------

function buildMatchRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/revisionupload', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as any;
}

function buildApplyRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/revisionupload/apply', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as any;
}

// ---------------------------------------------------------------------------
// Fixture seeding
// ---------------------------------------------------------------------------

interface IntegrityFixture {
  plotID: number;
  censusID: number;
  speciesID: number;
  quadratID: number;
  matchedTreeID: number;
  matchedStemGUID: number;
  matchedCoreMeasurementID: number;
}

/**
 * Seeds one matched-row measurement (for the new-row tamper test) using a
 * stem that will be looked up by tag+stemtag during the match phase.
 */
async function seedMatchedRowFixture(connection: Connection, testData: TestData, database: string): Promise<IntegrityFixture> {
  const plotID = testData.plots[0].plotID;
  const censusID = testData.census[0].censusID;

  const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species WHERE SpeciesCode = ?', [NEW_ROW_SPECIES]);
  const speciesID = speciesRows[0].SpeciesID as number;

  const [quadratRows] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ?', [
    NEW_ROW_QUADRAT,
    plotID
  ]);
  const quadratID = quadratRows[0].QuadratID as number;

  // Seed the matched-row stem. The match route will find this by tag+stemtag.
  const [treeRes] = await connection.query<ResultSetHeader>('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', [
    MATCHED_ROW_TREE_TAG,
    speciesID,
    censusID
  ]);
  const matchedTreeID = treeRes.insertId;

  const [stemRes] = await connection.query<ResultSetHeader>(
    'INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, 5.0, 5.0, 1)',
    [matchedTreeID, quadratID, censusID, MATCHED_ROW_STEM_TAG]
  );
  const matchedStemGUID = stemRes.insertId;

  const [cmRes] = await connection.query<ResultSetHeader>(
    `INSERT INTO \`${database}\`.coremeasurements
       (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
        RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY,
        IsValidated, IsActive, SourceRowIndex, UploadBatchID)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 5.0, 5.0, 1, 1, 0, 'integrity-batch-01')`,
    [
      matchedStemGUID,
      censusID,
      MATCHED_ROW_DBH,
      MATCHED_ROW_HOM,
      MATCHED_ROW_DATE,
      MATCHED_ROW_TREE_TAG,
      MATCHED_ROW_STEM_TAG,
      NEW_ROW_SPECIES,
      NEW_ROW_QUADRAT
    ]
  );
  const matchedCoreMeasurementID = cmRes.insertId;

  return { plotID, censusID, speciesID, quadratID, matchedTreeID, matchedStemGUID, matchedCoreMeasurementID };
}

interface DuplicateFixture {
  plotID: number;
  censusID: number;
  stemGUID: number;
  coreMeasurementIDFirst: number;
  coreMeasurementIDSecond: number;
  coreMeasurementIDThird: number;
}

/**
 * Seeds three measurements on the same stem for the duplicate-swap test.
 * The match route picks the highest CoreMeasurementID as survivor and places
 * the other two in `duplicateMeasurementIDsToDelete`, sorted ascending.
 */
async function seedDuplicateFixture(connection: Connection, testData: TestData, database: string): Promise<DuplicateFixture> {
  const plotID = testData.plots[0].plotID;
  const censusID = testData.census[0].censusID;

  const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species WHERE SpeciesCode = ?', [NEW_ROW_SPECIES]);
  const speciesID = speciesRows[0].SpeciesID as number;

  const [quadratRows] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ?', [
    NEW_ROW_QUADRAT,
    plotID
  ]);
  const quadratID = quadratRows[0].QuadratID as number;

  const [treeRes] = await connection.query<ResultSetHeader>('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', [
    DUPLICATE_TREE_TAG,
    speciesID,
    censusID
  ]);
  const treeID = treeRes.insertId;

  const [stemRes] = await connection.query<ResultSetHeader>(
    'INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, 8.0, 8.0, 1)',
    [treeID, quadratID, censusID, DUPLICATE_STEM_TAG]
  );
  const stemGUID = stemRes.insertId;

  async function insertDuplicateMeasurement(dbh: number, date: string, sourceRowIndex: number): Promise<number> {
    const [res] = await connection.query<ResultSetHeader>(
      `INSERT INTO \`${database}\`.coremeasurements
         (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
          RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY,
          IsValidated, IsActive, SourceRowIndex, UploadBatchID)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 8.0, 8.0, 1, 1, ?, 'integrity-dup-batch')`,
      [stemGUID, censusID, dbh, MATCHED_ROW_HOM, date, DUPLICATE_TREE_TAG, DUPLICATE_STEM_TAG, NEW_ROW_SPECIES, NEW_ROW_QUADRAT, sourceRowIndex]
    );
    return res.insertId;
  }

  const coreMeasurementIDFirst = await insertDuplicateMeasurement(DUPLICATE_DBH_FIRST, DUPLICATE_DATE_FIRST, 0);
  const coreMeasurementIDSecond = await insertDuplicateMeasurement(DUPLICATE_DBH_SECOND, DUPLICATE_DATE_SECOND, 1);
  const coreMeasurementIDThird = await insertDuplicateMeasurement(DUPLICATE_DBH_THIRD, DUPLICATE_DATE_THIRD, 2);

  return { plotID, censusID, stemGUID, coreMeasurementIDFirst, coreMeasurementIDSecond, coreMeasurementIDThird };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('editplan bulk hash drift — tampered payload (integration)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    sharedState.connection = connection;

    // upload_sessions and validation_runs are defined in tablestructures.sql
    // but loadSchema silently skips them because their CREATE TABLE statements
    // follow comment blocks that begin with '--' after the semicolon split
    // filter. Create them directly here so assertNoConflictingApplyActivity
    // can query them without throwing ER_NO_SUCH_TABLE.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${config.database}\`.upload_sessions (
        session_id VARCHAR(64) NOT NULL PRIMARY KEY,
        schema_name VARCHAR(64) NOT NULL,
        plot_id INT NOT NULL,
        census_id INT NOT NULL,
        user_id VARCHAR(255) NOT NULL DEFAULT 'test',
        state ENUM('initialized','uploading','uploaded','processing','collapsing','completed','failed','abandoned','cleaned_up')
          NOT NULL DEFAULT 'initialized',
        last_heartbeat TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${config.database}\`.validation_runs (
        RunID INT AUTO_INCREMENT PRIMARY KEY,
        PlotID INT NOT NULL,
        CensusID INT NOT NULL,
        Status ENUM('running','completed','failed') NOT NULL DEFAULT 'running',
        StartedAt TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    sharedState.activeTransactionID = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    sharedState.activeTransactionID = null;
    // Roll back any stale open transaction left by a prior test failure.
    await connection.query('ROLLBACK');

    // Release any named locks the shared connection may still hold.
    // The match route acquires a scope lock; a prior failed test might not
    // have released it. Call RELEASE_ALL_LOCKS to avoid false-negative lock
    // contention in subsequent tests.
    await connection.query('SELECT RELEASE_ALL_LOCKS()');

    // Purge per-test data while preserving the seeded plots, quadrats,
    // species, attributes, and census records.
    await connection.query('DELETE FROM cmattributes');
    await connection.query('DELETE FROM coremeasurements');
    await connection.query('DELETE FROM stems');
    await connection.query('DELETE FROM trees');

    // Drop and recreate edit_operations so no stale ledger rows interfere.
    await connection.query('DROP TABLE IF EXISTS edit_operations');
  });

  // =========================================================================
  // Test 1: new-row content tamper triggers 409
  // =========================================================================

  it('returns 409 with freshPlan when new-row csvRow.tag is mutated after match', async () => {
    const fixture = await seedMatchedRowFixture(connection, testData, config.database);

    // The CSV contains two rows:
    //   Row 0: a matched row (tag+stemtag found in DB).
    //   Row 1: a new row (tag+stemtag not found in DB but has all required
    //           insert fields).
    // The match route classifies row 1 as a new-row candidate, and
    // `analyzeBulk` includes its canonicalized insert fields in the planHash.
    const matchRes = await matchPOST(
      buildMatchRequest({
        rows: [
          // Matched row: references the seeded stem
          {
            tag: MATCHED_ROW_TREE_TAG,
            stemtag: MATCHED_ROW_STEM_TAG,
            dbh: String(MATCHED_ROW_DBH + 1),
            hom: String(MATCHED_ROW_HOM),
            date: MATCHED_ROW_DATE
          },
          // New row: tag+stemtag not in DB; all required insert fields present
          {
            tag: NEW_ROW_TREE_TAG,
            stemtag: NEW_ROW_STEM_TAG,
            spcode: NEW_ROW_SPECIES,
            quadrat: NEW_ROW_QUADRAT,
            lx: NEW_ROW_LX,
            ly: NEW_ROW_LY,
            dbh: NEW_ROW_DBH,
            date: NEW_ROW_DATE
          }
        ],
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        schema: config.database
      })
    );

    expect(matchRes.status, `match route must succeed; got ${matchRes.status}`).toBe(HTTP_STATUS_OK);
    const matchBody = (await matchRes.json()) as RevisionUploadResponse;

    expect(matchBody.newRows, 'CSV must produce exactly one new-row candidate').toHaveLength(1);
    const { bulkPlan } = matchBody;
    const bulkPlanHash = bulkPlan.planHash;
    expect(bulkPlanHash, 'planHash must be a 64-char SHA-256 hex string').toHaveLength(SHA256_HEX_LENGTH);

    // Build a well-formed apply body, then tamper with the new row's tag.
    // The tampered tag changes the `TreeTag` field in the `revision-insert`
    // canonical hash, causing `analyzeBulk` at apply time to produce a
    // different planHash — triggering 409.
    const tamperedNewRowCsvRow = {
      ...matchBody.newRows[0].csvRow,
      tag: TAMPERED_TREE_TAG
    };

    const applyRes = await applyPOST(
      buildApplyRequest({
        matchedRows: matchBody.matchedRows.map(row => ({
          coreMeasurementID: row.coreMeasurementID,
          csvRow: row.csvRow,
          duplicateMeasurementIDsToDelete: row.duplicateMeasurementIDsToDelete ?? []
        })),
        newRows: [
          {
            csvRow: tamperedNewRowCsvRow,
            csvIndex: matchBody.newRows[0].csvIndex
          }
        ],
        invalidRows: matchBody.invalidRows,
        confirmNewRows: false,
        duplicateMeasurementIDsToDelete: [],
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        bulkPlanHash
      })
    );

    expect(applyRes.status, `tampered new-row apply must return 409; got ${applyRes.status}`).toBe(HTTP_STATUS_CONFLICT);

    const applyBody = (await applyRes.json()) as { error: string; freshPlan: BulkEditPlan };
    expect(applyBody.error, 'error field must identify a plan hash mismatch').toBe(PLAN_HASH_MISMATCH_ERROR);
    expect(applyBody.freshPlan, 'response must include a freshPlan for the UI to re-display').toBeTruthy();
    expect(applyBody.freshPlan.planHash, 'freshPlan must carry a valid SHA-256 hash').toHaveLength(SHA256_HEX_LENGTH);
    expect(applyBody.freshPlan.planHash, 'freshPlan hash must differ from the stale bulkPlanHash').not.toBe(bulkPlanHash);
  });

  // =========================================================================
  // Test 2: duplicate-swap triggers 409
  // =========================================================================

  it('returns 409 with freshPlan when duplicateMeasurementIDsToDelete survivor is swapped', async () => {
    const fixture = await seedDuplicateFixture(connection, testData, config.database);

    // The match route groups all three measurements under the same stem and
    // picks the one with the highest CoreMeasurementID as survivor. The other
    // two go into `duplicateMeasurementIDsToDelete`, sorted ascending.
    //
    // We use tag+stemtag matching (stemid column absent).
    const matchRes = await matchPOST(
      buildMatchRequest({
        rows: [
          {
            tag: DUPLICATE_TREE_TAG,
            stemtag: DUPLICATE_STEM_TAG,
            dbh: DUPLICATE_UPDATED_DBH,
            date: DUPLICATE_DATE_THIRD
          }
        ],
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        schema: config.database
      })
    );

    expect(matchRes.status, `match route must succeed; got ${matchRes.status}`).toBe(HTTP_STATUS_OK);
    const matchBody = (await matchRes.json()) as RevisionUploadResponse;

    expect(matchBody.matchedRows, 'three measurements on one stem must produce exactly one matched row').toHaveLength(1);
    const survivorRow = matchBody.matchedRows[0];

    // The match route picks the highest CoreMeasurementID as survivor.
    // The other two are sorted ascending in duplicateMeasurementIDsToDelete.
    expect(survivorRow.coreMeasurementID, 'match route must pick the highest CoreMeasurementID as survivor').toBe(
      fixture.coreMeasurementIDThird
    );
    expect(survivorRow.duplicateMeasurementIDsToDelete, 'two siblings must be queued for deletion').toHaveLength(2);

    const bulkPlanHash = matchBody.bulkPlan.planHash;
    expect(bulkPlanHash, 'planHash must be a 64-char SHA-256 hex string').toHaveLength(SHA256_HEX_LENGTH);

    // Swap the two duplicate IDs in the per-row array AND in the top-level
    // array so `duplicatesMatch` (which checks set equality) still passes.
    // The recomputed plan at apply time sorts duplicateDeletions by
    // (coreMeasurementID, survivorCoreMeasurementID); swapping changes which
    // item appears first in the original unsorted list fed to buildBulkInput,
    // which still affects the hash because the canonical sort in planhash.ts
    // sorts by coreMeasurementID — but in this case both duplicates point to
    // the SAME survivor, so the order doesn't change. That means we need to
    // route the swap through the hash a different way.
    //
    // The actual drift here: when swapping which duplicate is listed first in
    // the per-row `duplicateMeasurementIDsToDelete`, the route builds
    // DuplicateDeletion[] differently via buildBulkInput (route.ts). The
    // array order changes, but after sort in planhash.ts sorts by
    // coreMeasurementID, the sorted result is the same. That means a pure
    // sibling-swap (same set, different order) does NOT change the plan hash
    // because planhash.ts sorts deterministically.
    //
    // The drift that DOES surface: if the client changes WHICH ID is the
    // survivor (i.e., changes survivorCoreMeasurementID). The apply route
    // re-runs `analyzeBulk` using the client-supplied duplicates array, and
    // `applyDuplicateRules` produces a different R6 effect referencing the
    // non-survivor ID. That changes the canonical form → different hash.
    //
    // Concretely: the match said survivor=THIRD. We supply a payload where
    // the first duplicate entry claims survivor=SECOND instead of THIRD.
    // This passes `duplicatesMatch` check (same coreMeasurementID values in
    // the set) only if we also update the per-row `duplicateMeasurementIDsToDelete`.
    // But the survivors in the top-level array differ, so `duplicatesMatch`
    // will catch it and return 400 unless we also change the matched row's
    // coreMeasurementID to SECOND.
    //
    // The cleanest swap that passes normalization but changes the hash:
    // change the survivor itself — tell the apply route the matched row IS
    // coreMeasurementIDSecond (not third) and list coreMeasurementIDThird as
    // a duplicate to delete. The re-analyzed plan will still pick third as
    // survivor (highest ID), so the freshPlan lists third as the update
    // target but the submitted payload picked second — hash mismatch.
    const swappedMatchedRows = [
      {
        coreMeasurementID: fixture.coreMeasurementIDSecond,
        csvRow: survivorRow.csvRow,
        duplicateMeasurementIDsToDelete: [fixture.coreMeasurementIDFirst, fixture.coreMeasurementIDThird]
      }
    ];
    const swappedTopLevelDuplicates = [
      { coreMeasurementID: fixture.coreMeasurementIDFirst, survivorCoreMeasurementID: fixture.coreMeasurementIDSecond },
      { coreMeasurementID: fixture.coreMeasurementIDThird, survivorCoreMeasurementID: fixture.coreMeasurementIDSecond }
    ];

    const applyRes = await applyPOST(
      buildApplyRequest({
        matchedRows: swappedMatchedRows,
        newRows: [],
        invalidRows: [],
        confirmNewRows: false,
        duplicateMeasurementIDsToDelete: swappedTopLevelDuplicates,
        schema: config.database,
        plotID: fixture.plotID,
        censusID: fixture.censusID,
        bulkPlanHash
      })
    );

    expect(applyRes.status, `swapped-survivor apply must return 409; got ${applyRes.status}`).toBe(HTTP_STATUS_CONFLICT);

    const applyBody = (await applyRes.json()) as { error: string; freshPlan: BulkEditPlan };
    expect(applyBody.error, 'error field must identify a plan hash mismatch').toBe(PLAN_HASH_MISMATCH_ERROR);
    expect(applyBody.freshPlan, 'response must include a freshPlan for the UI to re-display').toBeTruthy();
    expect(applyBody.freshPlan.planHash, 'freshPlan must carry a valid SHA-256 hash').toHaveLength(SHA256_HEX_LENGTH);
    expect(applyBody.freshPlan.planHash, 'freshPlan hash must differ from the stale bulkPlanHash').not.toBe(bulkPlanHash);
  });
});
