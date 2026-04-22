import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql from 'mysql2/promise';
import type { Connection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestData } from '../setup/local-db-setup';

// ---------------------------------------------------------------------------
// Shared state bridge — same hoisted pattern used by every editplan
// integration test. Lets the hoisted vi.mock adapter read the live connection
// and transaction state AFTER beforeAll completes.
//
// Unlike the writer tests, this file also needs a SECOND mysql2 connection
// (`lockHoldingConnection` below) that holds the scope lock on behalf of an
// imagined concurrent operation — the main connection must fail to acquire
// the same named lock via GET_LOCK. See the lock test below for details.
// ---------------------------------------------------------------------------
const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0
}));

const TEST_TRANSACTION_PREFIX = 'tx-';
const AUTH_USER_EMAIL = 'drift-lock-test@example.com';

// --- Auth mock: allows the route to pass scope checks --------------------
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      // 'global' bypasses per-schema site membership checks in scopeguard
      userStatus: 'global'
    }
  }))
}));

// --- ConnectionManager mock: drives the shared test connection ------------
// Important distinction from other editplan integration tests:
//   acquireApplicationLock EXECUTES a real GET_LOCK so a separately-held
//   lock on a different mysql2 connection will cause it to return false.
//   That's required for the 423 scope-lock test.
vi.mock('@/config/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
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
      sharedState.activeTransactionID = `${TEST_TRANSACTION_PREFIX}${sharedState.transactionCounter}`;
      return sharedState.activeTransactionID;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: commit transactionID mismatch`);
      }
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: rollback transactionID mismatch`);
      }
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined,
    acquireApplicationLock: async (lockName: string, _transactionID: string, timeoutMs: number) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      const timeoutSeconds = Math.ceil(timeoutMs / 1000);
      const [rows] = (await sharedState.connection.query('SELECT GET_LOCK(?, ?) AS acquired', [
        lockName,
        timeoutSeconds
      ])) as unknown as [RowDataPacket[], unknown];
      return rows?.[0]?.acquired === 1;
    },
    releaseApplicationLock: async (lockName: string) => {
      if (!sharedState.connection) return;
      await sharedState.connection.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
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

// Imports must follow vi.mock so the mocked modules are wired in.
import { POST as previewPOST } from '@/app/api/edits/preview/route';
import { POST as applyPOST } from '@/app/api/edits/apply/route';
import { buildMeasurementScopeLockName } from '@/config/measurementscopelock';

// ---------------------------------------------------------------------------
// Fixture constants — matched to seedSampleData defaults + short identifiers
// for varchar(10) StemTag and varchar-friendly TreeTag columns.
// ---------------------------------------------------------------------------
const SPECIES_CODE = 'ACERRU';
const QUADRAT_NAME = 'DLQA';
const TREE_TAG_VALID = 'DLT001';
const STEM_TAG_VALID = 'DLS1';
const INITIAL_DBH = 12.5;
const DRIFTED_DBH = 88.8;
const PREVIEW_ATTEMPT_DBH = 30.0;
const ATTR_CODE_ALIVE = 'A';

interface DriftLockFixture {
  plotID: number;
  censusID: number;
  speciesID: number;
  quadratID: number;
  treeID: number;
  stemGUID: number;
  coreMeasurementID: number;
}

async function seedDriftLockFixture(connection: Connection, testData: TestData): Promise<DriftLockFixture> {
  const plotID = testData.plots[0].plotID;
  const censusID = testData.census[0].censusID;

  const [speciesRows] = await connection.query<RowDataPacket[]>(
    'SELECT SpeciesID FROM species WHERE SpeciesCode = ?',
    [SPECIES_CODE]
  );
  const speciesID = speciesRows[0].SpeciesID as number;

  const [quadratRes] = await connection.query<ResultSetHeader>(
    `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive)
     VALUES (?, ?, 0, 0, 20, 20, 400, 'square', 1)`,
    [plotID, QUADRAT_NAME]
  );
  const quadratID = quadratRes.insertId;

  const [treeRes] = await connection.query<ResultSetHeader>(
    `INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)`,
    [TREE_TAG_VALID, speciesID, censusID]
  );
  const treeID = treeRes.insertId;

  const [stemRes] = await connection.query<ResultSetHeader>(
    `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
     VALUES (?, ?, ?, ?, 5.0, 5.0, 1)`,
    [treeID, quadratID, censusID, STEM_TAG_VALID]
  );
  const stemGUID = stemRes.insertId;

  const [cmRes] = await connection.query<ResultSetHeader>(
    `INSERT INTO coremeasurements
       (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
        RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY,
        RawCodes, IsValidated, IsActive)
     VALUES (?, ?, ?, 1.3, '2024-06-15', ?, ?, ?, ?, 5.0, 5.0, ?, 1, 1)`,
    [
      stemGUID,
      censusID,
      INITIAL_DBH,
      TREE_TAG_VALID,
      STEM_TAG_VALID,
      SPECIES_CODE,
      QUADRAT_NAME,
      ATTR_CODE_ALIVE
    ]
  );
  const coreMeasurementID = cmRes.insertId;

  await connection.query(
    `INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, ?)`,
    [coreMeasurementID, ATTR_CODE_ALIVE]
  );

  return { plotID, censusID, speciesID, quadratID, treeID, stemGUID, coreMeasurementID };
}

function buildPreviewRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/edits/preview', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as any;
}

function buildApplyRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/edits/apply', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as any;
}

describe('editplan drift + lock (integration)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    sharedState.connection = connection;
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    sharedState.activeTransactionID = null;
    await teardownTestDatabase(connection, config);
  });

  let fixture: DriftLockFixture;
  beforeEach(async () => {
    sharedState.activeTransactionID = null;
    // Defensive: ensure no stray transaction is left open on the shared
    // connection from a prior test. ROLLBACK is a no-op outside a txn.
    await connection.query('ROLLBACK');
    // Reset to a clean slate so edit_operations insert IDs, validation state,
    // and row contents are predictable per test.
    await connection.query('DELETE FROM cmattributes');
    await connection.query('DELETE FROM coremeasurements');
    await connection.query('DELETE FROM stems');
    await connection.query('DELETE FROM trees');
    await connection.query(`DELETE FROM quadrats WHERE QuadratName = ?`, [QUADRAT_NAME]);
    await connection.query('DROP TABLE IF EXISTS edit_operations');
    fixture = await seedDriftLockFixture(connection, testData);

    // Release any named lock the shared connection might still be holding
    // from a previous test's apply call. GET_LOCK is not released on commit,
    // and the mocked ConnectionManager's closeConnection is a no-op. If the
    // shared connection already held the scope lock, the next test's apply
    // would appear to succeed even when an outer session holds a conflicting
    // lock on that same name. RELEASE_LOCK is reference-counted per session;
    // call it until it returns 0 (lock not held).
    const prevLockName = buildMeasurementScopeLockName(
      config.database,
      fixture.plotID,
      fixture.censusID
    );
    for (let i = 0; i < 5; i += 1) {
      const [rows] = (await connection.query('SELECT RELEASE_LOCK(?) AS released', [
        prevLockName
      ])) as unknown as [RowDataPacket[], unknown];
      if (rows[0].released !== 1) break;
    }
  });

  describe('migration 54 idempotency on fresh schema', () => {
    it('applyEdit bootstraps edit_operations when the table is absent (ensureEditOperationsTable covers missing migration registration)', async () => {
      // The beforeEach dropped edit_operations; if applyEdit does not create it
      // via ensureEditOperationsTable, the INSERT will fail.
      const [preRows] = await connection.query<RowDataPacket[]>(
        `SHOW TABLES LIKE 'edit_operations'`
      );
      expect(preRows).toHaveLength(0);

      // 1) preview
      const previewRes = await previewPOST(
        buildPreviewRequest({
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          dataType: 'measurementssummary',
          targetID: fixture.coreMeasurementID,
          newRow: { MeasuredDBH: PREVIEW_ATTEMPT_DBH }
        })
      );
      expect(previewRes.status).toBe(200);
      const plan = (await previewRes.json()) as { planHash: string };
      expect(plan.planHash).toHaveLength(64);

      // 2) apply
      const applyRes = await applyPOST(
        buildApplyRequest({
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          dataType: 'measurementssummary',
          targetID: fixture.coreMeasurementID,
          newRow: { MeasuredDBH: PREVIEW_ATTEMPT_DBH },
          planHash: plan.planHash
        })
      );
      expect(applyRes.status).toBe(200);
      const applyBody = (await applyRes.json()) as {
        editOperationID: number | null;
        validationPending: boolean;
      };
      expect(applyBody.editOperationID).toBeGreaterThan(0);
      expect(applyBody.validationPending).toBe(true);

      const [postRows] = await connection.query<RowDataPacket[]>(
        `SHOW TABLES LIKE 'edit_operations'`
      );
      expect(postRows).toHaveLength(1);
    });
  });

  describe('drift detection', () => {
    it('returns 409 Conflict with a freshPlan when the target row changed between preview and apply', async () => {
      const previewRes = await previewPOST(
        buildPreviewRequest({
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          dataType: 'measurementssummary',
          targetID: fixture.coreMeasurementID,
          newRow: { MeasuredDBH: PREVIEW_ATTEMPT_DBH }
        })
      );
      expect(previewRes.status).toBe(200);
      const stalePlan = (await previewRes.json()) as { planHash: string; fieldChanges: unknown[] };
      expect(stalePlan.planHash).toHaveLength(64);

      // Out-of-band mutation simulates a concurrent editor committing first.
      // Must NOT use sharedState.connection-level transaction — we want it
      // visible to the apply path's own transaction when it re-analyzes.
      await connection.query(
        `UPDATE coremeasurements SET MeasuredDBH = ? WHERE CoreMeasurementID = ?`,
        [DRIFTED_DBH, fixture.coreMeasurementID]
      );

      const applyRes = await applyPOST(
        buildApplyRequest({
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          dataType: 'measurementssummary',
          targetID: fixture.coreMeasurementID,
          newRow: { MeasuredDBH: PREVIEW_ATTEMPT_DBH },
          planHash: stalePlan.planHash
        })
      );
      expect(applyRes.status).toBe(409);

      const body = (await applyRes.json()) as {
        error: string;
        freshPlan: { planHash: string; fieldChanges: Array<{ field: string; from: unknown; to: unknown }> };
      };
      expect(body.error).toBe('plan hash mismatch');
      expect(body.freshPlan).toBeTruthy();
      expect(body.freshPlan.planHash).toHaveLength(64);
      expect(body.freshPlan.planHash).not.toBe(stalePlan.planHash);

      // The freshPlan's MeasuredDBH from-value should reflect the drifted value,
      // not the stale pre-preview value, so the UI can show the operator the
      // real current state.
      const dbhChange = body.freshPlan.fieldChanges.find(c => c.field === 'MeasuredDBH');
      expect(dbhChange).toBeTruthy();
      expect(Number(dbhChange!.from)).toBeCloseTo(DRIFTED_DBH, 2);
      expect(Number(dbhChange!.to)).toBeCloseTo(PREVIEW_ATTEMPT_DBH, 2);

      // Assert the measurement was NOT updated by the rejected apply attempt.
      const [rowsAfter] = await connection.query<RowDataPacket[]>(
        `SELECT MeasuredDBH FROM coremeasurements WHERE CoreMeasurementID = ?`,
        [fixture.coreMeasurementID]
      );
      expect(Number(rowsAfter[0].MeasuredDBH)).toBeCloseTo(DRIFTED_DBH, 2);
    });
  });

  describe('scope lock held by another session', () => {
    // A separate mysql2 connection (NOT the shared test connection) acquires
    // the scope lock first. GET_LOCK is per-session, so the apply path — which
    // runs on the shared connection — cannot acquire the same named lock and
    // must fail fast (timeout 0 → return 0).
    let lockHolder: Connection | null = null;
    const LOCK_NAME_HOLDER: string[] = [];

    async function createLockHolder() {
      return mysql.createConnection({
        host: DEFAULT_TEST_CONFIG.host,
        user: DEFAULT_TEST_CONFIG.user,
        password: DEFAULT_TEST_CONFIG.password,
        port: DEFAULT_TEST_CONFIG.port,
        database: config.database,
        multipleStatements: false
      });
    }

    afterAll(async () => {
      if (lockHolder) {
        try {
          // Best-effort release for every lock we held.
          for (const name of LOCK_NAME_HOLDER) {
            await lockHolder.query('SELECT RELEASE_LOCK(?)', [name]);
          }
          await lockHolder.end();
        } catch {
          /* best-effort cleanup */
        }
        lockHolder = null;
      }
    });

    it('returns 423 Locked when the scope lock is held elsewhere, and succeeds after the lock is released', async () => {
      lockHolder = await createLockHolder();
      const lockName = buildMeasurementScopeLockName(
        config.database,
        fixture.plotID,
        fixture.censusID
      );
      LOCK_NAME_HOLDER.push(lockName);

      // Acquire the scope lock on the outer connection (timeout 10s just in
      // case another test somehow holds it; expected to be unheld).
      const [holderRows] = (await lockHolder.query('SELECT GET_LOCK(?, 10) AS acquired', [
        lockName
      ])) as unknown as [RowDataPacket[], unknown];
      expect(holderRows[0].acquired).toBe(1);

      // Run preview to get a valid plan hash (preview does NOT acquire the
      // scope lock — it only probes upload sessions / validation runs).
      const previewRes = await previewPOST(
        buildPreviewRequest({
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          dataType: 'measurementssummary',
          targetID: fixture.coreMeasurementID,
          newRow: { MeasuredDBH: PREVIEW_ATTEMPT_DBH }
        })
      );
      expect(previewRes.status).toBe(200);
      const plan = (await previewRes.json()) as { planHash: string };

      const applyBlockedRes = await applyPOST(
        buildApplyRequest({
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          dataType: 'measurementssummary',
          targetID: fixture.coreMeasurementID,
          newRow: { MeasuredDBH: PREVIEW_ATTEMPT_DBH },
          planHash: plan.planHash
        })
      );
      expect(applyBlockedRes.status).toBe(423);
      const blockedBody = (await applyBlockedRes.json()) as { error: string };
      expect(blockedBody.error).toBe('scope locked');

      // Apply should NOT have mutated the row while the lock was held.
      const [midRows] = await connection.query<RowDataPacket[]>(
        `SELECT MeasuredDBH FROM coremeasurements WHERE CoreMeasurementID = ?`,
        [fixture.coreMeasurementID]
      );
      expect(Number(midRows[0].MeasuredDBH)).toBeCloseTo(INITIAL_DBH, 2);

      // Release the lock and re-apply. Expect 200 this time.
      const [releaseRows] = (await lockHolder.query('SELECT RELEASE_LOCK(?) AS released', [
        lockName
      ])) as unknown as [RowDataPacket[], unknown];
      expect(releaseRows[0].released).toBe(1);
      LOCK_NAME_HOLDER.length = 0;

      // Re-preview (first preview hash is technically still fresh but for
      // realism we re-preview — the operator retries the flow).
      const previewAgainRes = await previewPOST(
        buildPreviewRequest({
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          dataType: 'measurementssummary',
          targetID: fixture.coreMeasurementID,
          newRow: { MeasuredDBH: PREVIEW_ATTEMPT_DBH }
        })
      );
      expect(previewAgainRes.status).toBe(200);
      const freshPlan = (await previewAgainRes.json()) as { planHash: string };

      const applyOkRes = await applyPOST(
        buildApplyRequest({
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          dataType: 'measurementssummary',
          targetID: fixture.coreMeasurementID,
          newRow: { MeasuredDBH: PREVIEW_ATTEMPT_DBH },
          planHash: freshPlan.planHash
        })
      );
      expect(applyOkRes.status).toBe(200);

      const [finalRows] = await connection.query<RowDataPacket[]>(
        `SELECT MeasuredDBH FROM coremeasurements WHERE CoreMeasurementID = ?`,
        [fixture.coreMeasurementID]
      );
      expect(Number(finalRows[0].MeasuredDBH)).toBeCloseTo(PREVIEW_ATTEMPT_DBH, 2);
    });
  });
});
