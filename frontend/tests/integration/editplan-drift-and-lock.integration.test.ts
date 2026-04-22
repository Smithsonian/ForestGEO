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

// Auth freshness re-check (#11) depends on process.env.AUTH_FUNCTIONS_POLL_URL
// and a reachable identity endpoint, neither of which the integration harness
// provides. Replace createFreshAuthorizationCheck with a no-op so these tests
// exercise the apply flow under a valid, non-expiring session. Other exports
// from the module (assertSessionMayEdit, PendingUserEditForbiddenError,
// SessionExpiredError) are preserved via importActual.
vi.mock('@/config/editplan/authorization', async () => {
  const actual = await vi.importActual<typeof import('@/config/editplan/authorization')>(
    '@/config/editplan/authorization'
  );
  return {
    ...actual,
    createFreshAuthorizationCheck: () => async () => {
      /* always-fresh in tests */
    }
  };
});

// Imports must follow vi.mock so the mocked modules are wired in.
import { POST as previewPOST } from '@/app/api/edits/preview/route';
import { POST as applyPOST } from '@/app/api/edits/apply/route';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';
import ConnectionManager from '@/config/connectionmanager';
import { writeMeasurementsSummary } from '@/config/editplan/writers/measurementssummary';
import type { EditPlan } from '@/config/editplan/types';

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

  // Concurrent edits — two users preview the same row at the same time. User A
  // applies first and commits. User B's plan hash was identical to A's (same
  // inputs → same deterministic hash), but A's commit has now drifted the row,
  // so B's apply must return 409 with a freshPlan whose from-value reflects A's
  // committed change. This is the apply-layer contract that protects users from
  // silently overwriting each other — the existing drift-detection test covers
  // out-of-band SQL writes; this one proves the same contract holds when the
  // drift came from a legitimate concurrent apply through the same route.
  describe('concurrent edit drift', () => {
    it('returns 409 for the second caller and freshPlan reflects the first caller\'s committed change', async () => {
      const USER_A_DBH = 42.0;
      const USER_B_DBH = 55.0;

      // Preview A and Preview B use identical inputs so their planHash must match
      // bit-for-bit; the deterministic hash is what makes this whole coordination
      // contract work.
      const previewARes = await previewPOST(
        buildPreviewRequest({
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          dataType: 'measurementssummary',
          targetID: fixture.coreMeasurementID,
          newRow: { MeasuredDBH: USER_A_DBH }
        })
      );
      expect(previewARes.status).toBe(200);
      const planA = (await previewARes.json()) as { planHash: string };

      const previewBRes = await previewPOST(
        buildPreviewRequest({
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          dataType: 'measurementssummary',
          targetID: fixture.coreMeasurementID,
          newRow: { MeasuredDBH: USER_B_DBH }
        })
      );
      expect(previewBRes.status).toBe(200);
      const planB = (await previewBRes.json()) as { planHash: string };
      // Different target values → different hashes (sanity: we're not
      // accidentally asserting two apply-same-value previews).
      expect(planB.planHash).not.toBe(planA.planHash);

      // User A applies successfully.
      const applyARes = await applyPOST(
        buildApplyRequest({
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          dataType: 'measurementssummary',
          targetID: fixture.coreMeasurementID,
          newRow: { MeasuredDBH: USER_A_DBH },
          planHash: planA.planHash
        })
      );
      expect(applyARes.status).toBe(200);

      // User B applies with a plan that was built against the pre-A state.
      // The apply route re-analyzes inside the transaction and sees A's commit
      // as the new from-value, so the hash no longer matches and B gets 409.
      const applyBRes = await applyPOST(
        buildApplyRequest({
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          dataType: 'measurementssummary',
          targetID: fixture.coreMeasurementID,
          newRow: { MeasuredDBH: USER_B_DBH },
          planHash: planB.planHash
        })
      );
      expect(applyBRes.status).toBe(409);

      const body = (await applyBRes.json()) as {
        error: string;
        freshPlan: {
          planHash: string;
          fieldChanges: Array<{ field: string; from: unknown; to: unknown }>;
        };
      };
      expect(body.error).toBe('plan hash mismatch');
      expect(body.freshPlan.planHash).toHaveLength(64);
      expect(body.freshPlan.planHash).not.toBe(planB.planHash);

      // freshPlan's from-value must reflect A's committed change so the UI can
      // show User B what they actually collided with — not the row's value at
      // preview time.
      const dbhChange = body.freshPlan.fieldChanges.find(c => c.field === 'MeasuredDBH');
      expect(dbhChange).toBeTruthy();
      expect(Number(dbhChange!.from)).toBeCloseTo(USER_A_DBH, 2);
      expect(Number(dbhChange!.to)).toBeCloseTo(USER_B_DBH, 2);

      // Database still carries A's value, not B's. B's rejected apply did not
      // half-write the row.
      const [rowsAfter] = await connection.query<RowDataPacket[]>(
        `SELECT MeasuredDBH FROM coremeasurements WHERE CoreMeasurementID = ?`,
        [fixture.coreMeasurementID]
      );
      expect(Number(rowsAfter[0].MeasuredDBH)).toBeCloseTo(USER_A_DBH, 2);

      // Exactly one ledger entry for this target — A's. B's rejected apply
      // wrote nothing to the ledger.
      const [ledgerRows] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM edit_operations WHERE TargetID = ?`,
        [fixture.coreMeasurementID]
      );
      expect(Number(ledgerRows[0].cnt)).toBe(1);
    });
  });

  // TOCTOU — between preview and apply the world changed in a way the hash can't
  // detect because the row that went stale isn't on the target table the hash
  // covers. The apply path re-analyzes inside its transaction, so the drift MUST
  // surface there as a clean HTTP status rather than a silent half-write.
  describe('TOCTOU between preview and apply', () => {
    it('returns 404 when the target measurement is soft-deleted between preview and apply', async () => {
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

      // Soft-delete between preview and apply. The analyzer's loadCurrentRow
      // filters by cm.IsActive = 1, so the next analysis will miss it.
      await connection.query(
        `UPDATE coremeasurements SET IsActive = 0 WHERE CoreMeasurementID = ?`,
        [fixture.coreMeasurementID]
      );

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
      expect(applyRes.status).toBe(404);
      const body = (await applyRes.json()) as { error: string };
      expect(body.error).toBe('target not found');

      // Row still carries its pre-apply DBH — no half-write.
      const [rowsAfter] = await connection.query<RowDataPacket[]>(
        `SELECT MeasuredDBH, IsActive FROM coremeasurements WHERE CoreMeasurementID = ?`,
        [fixture.coreMeasurementID]
      );
      expect(Number(rowsAfter[0].MeasuredDBH)).toBeCloseTo(INITIAL_DBH, 2);
      expect(Number(rowsAfter[0].IsActive)).toBe(0);
    });

    it('returns 422 when the target species is deactivated between preview and apply of a SpeciesCode change', async () => {
      // Seed a second species so we can redirect to it.
      const OTHER_SPECIES_CODE = 'QUERCO';
      const [otherSpeciesRows] = await connection.query<RowDataPacket[]>(
        'SELECT SpeciesID FROM species WHERE SpeciesCode = ?',
        [OTHER_SPECIES_CODE]
      );
      expect(otherSpeciesRows.length).toBe(1);

      const previewRes = await previewPOST(
        buildPreviewRequest({
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          dataType: 'measurementssummary',
          targetID: fixture.coreMeasurementID,
          newRow: { SpeciesCode: OTHER_SPECIES_CODE }
        })
      );
      expect(previewRes.status).toBe(200);
      const plan = (await previewRes.json()) as { planHash: string };

      // Deactivate the target species after preview. resolveSpeciesByCode only
      // matches IsActive=1 rows, so the apply-time re-analysis will fail to
      // resolve QUERCO.
      await connection.query('UPDATE species SET IsActive = 0 WHERE SpeciesCode = ?', [OTHER_SPECIES_CODE]);

      try {
        const applyRes = await applyPOST(
          buildApplyRequest({
            schema: config.database,
            plotID: fixture.plotID,
            censusID: fixture.censusID,
            dataType: 'measurementssummary',
            targetID: fixture.coreMeasurementID,
            newRow: { SpeciesCode: OTHER_SPECIES_CODE },
            planHash: plan.planHash
          })
        );
        expect(applyRes.status).toBe(422);
        const body = (await applyRes.json()) as { error: string; code?: string };
        expect(body.error).toBe('species not found');
        expect(body.code).toBe(OTHER_SPECIES_CODE);

        // Row is still linked to the original species.
        const [rowsAfter] = await connection.query<RowDataPacket[]>(
          `SELECT t.SpeciesID
           FROM coremeasurements cm
           JOIN stems s ON s.StemGUID = cm.StemGUID
           JOIN trees t ON t.TreeID = s.TreeID
           WHERE cm.CoreMeasurementID = ?`,
          [fixture.coreMeasurementID]
        );
        expect(rowsAfter[0].SpeciesID).toBe(fixture.speciesID);
      } finally {
        await connection.query('UPDATE species SET IsActive = 1 WHERE SpeciesCode = ?', [OTHER_SPECIES_CODE]);
      }
    });
  });

  // Bulk rollback granularity — the revision-apply route runs every matched row
  // through the measurementssummary writer inside ONE outer transaction. If a
  // later row's writer throws, the caller rolls back the outer transaction and
  // rows 1..N-1 must not remain durable. This test drives the writer directly
  // (bypassing applyEditInTransaction's ensureEditOperationsTable DDL call,
  // which MySQL treats as an implicit commit and would mask the rollback). The
  // route-level happy path is already covered in revision-upload.integration.test.ts.
  describe('mid-bulk rollback granularity', () => {
    it('rolls back the first row writer when the second row writer throws inside the same outer transaction', async () => {
      // Seed a second measurement in the same scope so the bulk loop has two
      // addressable rows.
      const SECOND_TREE_TAG = 'DLT002';
      const SECOND_STEM_TAG = 'DLS2';
      const SECOND_INITIAL_DBH = 7.77;
      const FIRST_NEW_DBH = 55.5;
      const SECOND_NEW_DBH = 77.7;

      const [secondTreeRes] = await connection.query<ResultSetHeader>(
        `INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)`,
        [SECOND_TREE_TAG, fixture.speciesID, fixture.censusID]
      );
      const secondTreeID = secondTreeRes.insertId;

      const [secondStemRes] = await connection.query<ResultSetHeader>(
        `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
         VALUES (?, ?, ?, ?, 1, 1, 1)`,
        [secondTreeID, fixture.quadratID, fixture.censusID, SECOND_STEM_TAG]
      );
      const secondStemGUID = secondStemRes.insertId;

      const [secondCmRes] = await connection.query<ResultSetHeader>(
        `INSERT INTO coremeasurements
           (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
            RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY,
            IsValidated, IsActive)
         VALUES (?, ?, ?, 1.2, '2024-06-15', ?, ?, ?, ?, 1, 1, 1, 1)`,
        [
          secondStemGUID,
          fixture.censusID,
          SECOND_INITIAL_DBH,
          SECOND_TREE_TAG,
          SECOND_STEM_TAG,
          SPECIES_CODE,
          QUADRAT_NAME
        ]
      );
      const secondCoreMeasurementID = secondCmRes.insertId;

      // Deactivate species out-of-band AFTER seeding so the writer's internal
      // species-code safety net (`Species not found`) fires on row 2 without
      // affecting the plan-build phase for row 1. We restore IsActive in the
      // finally block so downstream tests see the seeded fixture.
      await connection.query('UPDATE species SET IsActive = 0 WHERE SpeciesID = ?', [fixture.speciesID]);

      const cm = ConnectionManager.getInstance();
      const txID = await cm.beginTransaction();
      try {
        const acquired = await cm.acquireApplicationLock(
          buildMeasurementScopeLockName(config.database, fixture.plotID, fixture.censusID),
          txID,
          MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS
        );
        expect(acquired).toBe(true);

        // Row 1 plan: DBH-only — does not touch species/tree/stem paths so it
        // writes cleanly even with the seed species deactivated.
        const row1Plan: EditPlan = {
          dataType: 'measurementssummary',
          targetID: fixture.coreMeasurementID,
          fieldChanges: [{ field: 'MeasuredDBH', from: INITIAL_DBH, to: FIRST_NEW_DBH }],
          effects: [],
          maxSeverity: 'info',
          planHash: 'bulk-rollback-row1-hash',
          generatedAt: new Date().toISOString()
        };

        await writeMeasurementsSummary(
          cm,
          {
            dataType: 'measurementssummary',
            schema: config.database,
            plotID: fixture.plotID,
            censusID: fixture.censusID,
            targetID: fixture.coreMeasurementID,
            newRow: { MeasuredDBH: FIRST_NEW_DBH },
            expectedPlanHash: null,
            refreshViews: false,
            createdBy: AUTH_USER_EMAIL,
            transactionID: txID
          },
          row1Plan,
          txID
        );

        // Row 2 plan: includes SpeciesCode change. The writer hits its species
        // lookup inside the transaction, finds the seed species inactive, and
        // throws `Species not found` — simulating a mid-bulk writer failure.
        const row2Plan: EditPlan = {
          dataType: 'measurementssummary',
          targetID: secondCoreMeasurementID,
          fieldChanges: [
            { field: 'MeasuredDBH', from: SECOND_INITIAL_DBH, to: SECOND_NEW_DBH },
            { field: 'SpeciesCode', from: SPECIES_CODE, to: SPECIES_CODE }
          ],
          effects: [],
          maxSeverity: 'info',
          planHash: 'bulk-rollback-row2-hash',
          generatedAt: new Date().toISOString()
        };

        await expect(
          writeMeasurementsSummary(
            cm,
            {
              dataType: 'measurementssummary',
              schema: config.database,
              plotID: fixture.plotID,
              censusID: fixture.censusID,
              targetID: secondCoreMeasurementID,
              newRow: { MeasuredDBH: SECOND_NEW_DBH, SpeciesCode: SPECIES_CODE },
              expectedPlanHash: null,
              refreshViews: false,
              createdBy: AUTH_USER_EMAIL,
              transactionID: txID
            },
            row2Plan,
            txID
          )
        ).rejects.toThrow(/Species not found/);

        await cm.rollbackTransaction(txID);
      } catch (err) {
        await cm.rollbackTransaction(txID).catch(() => {});
        throw err;
      } finally {
        await connection.query('UPDATE species SET IsActive = 1 WHERE SpeciesID = ?', [fixture.speciesID]);
      }

      // Row 1 must be back at its pre-transaction value — the rollback has to
      // wipe the earlier writer's UPDATE even though that writer completed
      // successfully in isolation.
      const [row1After] = await connection.query<RowDataPacket[]>(
        `SELECT MeasuredDBH FROM coremeasurements WHERE CoreMeasurementID = ?`,
        [fixture.coreMeasurementID]
      );
      expect(Number(row1After[0].MeasuredDBH)).toBeCloseTo(INITIAL_DBH, 2);

      const [row2After] = await connection.query<RowDataPacket[]>(
        `SELECT MeasuredDBH FROM coremeasurements WHERE CoreMeasurementID = ?`,
        [secondCoreMeasurementID]
      );
      expect(Number(row2After[0].MeasuredDBH)).toBeCloseTo(SECOND_INITIAL_DBH, 2);
    });
  });

  // View refresh — when a single-row edit moves a measurement to a different
  // stem, the derived measurementssummary table must end up pointing at the
  // new StemGUID and StemTag. Prior gap: the happy-path writer tests did not
  // assert that the view reflected stem moves, only that the write itself
  // succeeded.
  describe('view refresh after stem move', () => {
    it('rewrites measurementssummary to point at the new stem after a StemTag change', async () => {
      const NEW_STEM_TAG = 'DLS9';

      const previewRes = await previewPOST(
        buildPreviewRequest({
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          dataType: 'measurementssummary',
          targetID: fixture.coreMeasurementID,
          newRow: { StemTag: NEW_STEM_TAG }
        })
      );
      expect(previewRes.status).toBe(200);
      const plan = (await previewRes.json()) as {
        planHash: string;
        maxSeverity: string;
      };
      // The single-stem fixture would orphan the source stem on move — plan
      // should reach destructive severity but still be applyable given the
      // confirmed hash.
      expect(plan.maxSeverity).toBe('destructive');

      const applyRes = await applyPOST(
        buildApplyRequest({
          schema: config.database,
          plotID: fixture.plotID,
          censusID: fixture.censusID,
          dataType: 'measurementssummary',
          targetID: fixture.coreMeasurementID,
          newRow: { StemTag: NEW_STEM_TAG },
          planHash: plan.planHash
        })
      );
      expect(applyRes.status).toBe(200);

      // coremeasurements.StemGUID now points at the new stem row.
      const [cmRows] = await connection.query<RowDataPacket[]>(
        `SELECT StemGUID FROM coremeasurements WHERE CoreMeasurementID = ?`,
        [fixture.coreMeasurementID]
      );
      const newStemGUID = cmRows[0].StemGUID as number;
      expect(newStemGUID).not.toBe(fixture.stemGUID);

      // And the refreshed measurementssummary view row reflects the new stem
      // identity — this is the regression we want to guard against.
      const [viewRows] = await connection.query<RowDataPacket[]>(
        `SELECT StemGUID, StemTag FROM measurementssummary WHERE CoreMeasurementID = ?`,
        [fixture.coreMeasurementID]
      );
      expect(viewRows.length).toBe(1);
      expect(viewRows[0].StemGUID).toBe(newStemGUID);
      expect(viewRows[0].StemTag).toBe(NEW_STEM_TAG);
    });
  });
});
