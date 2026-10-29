/**
 * ArcGIS resumable commit (#561) — two attempts of ONE import, on the REAL ConnectionManager.
 *
 * AI9(a): attempt R1 is held before the guard of its second staging window while R2 claims the same import, clears
 *   R1's staged rows and is itself held before finalize. Releasing R1 makes it stop at its guard with
 *   ArcgisCommitSupersededError and write nothing; R2 then completes with exactly the import's rows staged.
 * AI9(a) stale-unit invocation (N5): once R2 has committed, a separate guard call carrying R1's attempt reports
 *   `commitCompleted` — the claim is only the guard's `committed` precedence, over both the attempt token and the
 *   (by then finished) upload session's liveness. No unit work runs after it.
 * AI9(b): R1 is held right after its guard locked the import row. R2's claim must wait on that row, win it once R1's
 *   window commits, and supersede R1 at its next unit, with no deadlock on either side.
 *
 * Nothing in this file mocks '@/lib/db/connectionmanager'. The import session is seeded through the product function
 * BEFORE the barrier harness is installed; plain-SQL seeds and state changes use the separate setup connection.
 *
 * Prerequisites: docker compose up -d mysql
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestDatabaseConfig, type TestData } from '../setup/local-db-setup';
import { ARCGIS_COMMIT_STATEMENT, WRITE_STATEMENT } from '../setup/arcgis-commit-statement-patterns';
import { CENSUS_REPLACEMENT_STATEMENT } from '../setup/census-replacement-statement-patterns';
import {
  BARRIER_TEST_TIMEOUT_MS,
  installBarrierHarness,
  runBarrierScenario,
  waitForLockWait,
  withinDeadline,
  type BarrierHarness,
  type RecordedStatement
} from '../setup/arcgis-commit-barrier-harness';
import {
  ARCGIS_TEST_USER,
  countStagedFamilyRows,
  fileUploadChangelogRows,
  readImportRow,
  seedArcgisImport,
  setUploadSessionState,
  startActiveUploadSession,
  type ArcgisImportScope,
  type SeededArcgisImport
} from '../setup/arcgis-commit-fixtures';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];
const RESOLVED_HOSTS = [process.env.AZURE_SQL_SERVER, process.env.TEST_DB_HOST || 'localhost'];
for (const host of RESOLVED_HOSTS) {
  if (!host || !LOCAL_HOSTS.includes(host)) {
    throw new Error(`REFUSING TO RUN: host '${host}' is not local. This suite deletes rows.`);
  }
}

vi.mock('@/ailogger', () => ({ default: { info: () => undefined, warn: () => undefined, error: () => undefined } }));

import ConnectionManager from '@/lib/db/connectionmanager';
import { ARCGIS_STAGING_WINDOW_ROWS, commitArcgisImport, type CommitArcgisImportParams } from '@/lib/uploads/arcgis-commit';
import {
  ARCGIS_IMPORT_SESSION_STATE,
  ArcgisCommitSupersededError,
  lockArcgisImportSessionForCommitUnit,
  type ArcgisCommitAttempt
} from '@/lib/arcgis/import-session';
import { UploadSessionState } from '@/config/uploadsessiontracker';
import { UploadMode } from '@/config/uploadmodes';
import { ensureTemporaryMeasurementsSourceFormatColumn } from '@/lib/ingestion/temporary-measurements';
import { CENSUS_REPLACEMENT_MARKER_COLUMN, ensureUploadSessionReplacementMarkerColumn } from '@/lib/uploads/upload-session-replacement-marker';

const SETUP_TIMEOUT_MS = 120_000;
const MYSQL_DEADLOCK_CODE = 'ER_LOCK_DEADLOCK';
const SUITE_TABLES = [
  'temporarymeasurements',
  'measurement_error_log',
  'coremeasurements',
  'uploadmetrics',
  'unifiedchangelog',
  'arcgis_import_sessions',
  'arcgis_import_rows',
  'upload_sessions'
];

const FULL_WINDOWS_BEFORE_TAIL = 2;
const TAIL_ROW_COUNT = 7;
const IMPORT_ROW_COUNT = ARCGIS_STAGING_WINDOW_ROWS * FULL_WINDOWS_BEFORE_TAIL + TAIL_ROW_COUNT;
const GUARDS_COMMITTED_BY_R1_BEFORE_PARKING = 1;
const FAMILY_SELECTS_ONCE_R2_HAS_CLEARED_ITS_FAMILY = 2;

const AI9A = {
  UPLOAD_SESSION: 'ai9a-upload-session',
  FILE: 'ai9a.xlsx',
  TAG_PREFIX: 'ai9a-'
} as const;

const AI9B = {
  UPLOAD_SESSION: 'ai9b-upload-session',
  FILE: 'ai9b.xlsx',
  TAG_PREFIX: 'ai9b-'
} as const;

type ImportRowSnapshot = {
  state: string;
  stagingNextRowIndex: number;
  committedRowCount: number;
  commitAttemptId: string | null;
  committedBatchId: string | null;
};

function isCursorAdvanceTo(statement: RecordedStatement, toRowIndex: number): boolean {
  return ARCGIS_COMMIT_STATEMENT.CURSOR_CAS.test(statement.sql) && statement.params[0] === toRowIndex;
}

function requireAttemptID(snapshot: ImportRowSnapshot, owner: string): string {
  if (snapshot.commitAttemptId === null) throw new Error(`${owner}: the import row carries no commit attempt id after the claim`);
  return snapshot.commitAttemptId;
}

describe('ArcGIS commit: two attempts of one import on the real ConnectionManager (#561)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;
  let scope: ArcgisImportScope;
  let realManager: ConnectionManager;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    realManager = ConnectionManager.getInstance();
    scope = {
      schema: config.database,
      plotID: testData.plots[0].plotID,
      censusID: testData.census[0].censusID,
      speciesCode: testData.species[0].SpeciesCode,
      quadratName: testData.quadrats[0].QuadratName
    };
    await ensureTemporaryMeasurementsSourceFormatColumn(realManager, scope.schema);
    await ensureUploadSessionReplacementMarkerColumn(realManager, scope.schema, CENSUS_REPLACEMENT_MARKER_COLUMN);
    console.log(`[attempt fencing setup] schema=${scope.schema} plot=${scope.plotID} census=${scope.censusID} importRows=${IMPORT_ROW_COUNT}`);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await realManager.closeConnection();
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await connection.query('SELECT RELEASE_ALL_LOCKS()');
    for (const table of SUITE_TABLES) await connection.query(`DELETE FROM ${table}`);
  });

  function commitRevisions(seeded: SeededArcgisImport, uploadSessionID: string) {
    const params: CommitArcgisImportParams = {
      schema: scope.schema,
      plotID: scope.plotID,
      censusID: scope.censusID,
      importSessionId: seeded.importSessionId,
      fileName: seeded.fileName,
      uploadMode: UploadMode.REVISIONS,
      userId: ARCGIS_TEST_USER,
      uploadSessionID
    };
    return commitArcgisImport(realManager, params);
  }

  async function settle<T>(promise: Promise<T>, label: string, harness: BarrierHarness): Promise<PromiseSettledResult<T>> {
    const [settled] = await withinDeadline(Promise.allSettled([promise]), label, harness.renderStatementLog);
    return settled;
  }

  async function describeImportRow(label: string, seeded: SeededArcgisImport): Promise<ImportRowSnapshot> {
    const row = await readImportRow(connection, seeded.importSessionId);
    const snapshot: ImportRowSnapshot = {
      state: row.state,
      stagingNextRowIndex: Number(row.staging_next_row_index),
      committedRowCount: Number(row.committed_row_count ?? 0),
      commitAttemptId: row.commit_attempt_id,
      committedBatchId: row.committed_batch_id
    };
    console.log(`[${label}] import ${seeded.importSessionId}: ${JSON.stringify(snapshot)}`);
    return snapshot;
  }

  function attemptOf(seeded: SeededArcgisImport, uploadSessionID: string, attemptID: string): ArcgisCommitAttempt {
    return {
      schema: scope.schema,
      importSessionId: seeded.importSessionId,
      plotID: scope.plotID,
      censusID: scope.censusID,
      batchID: seeded.batchID,
      uploadMode: UploadMode.REVISIONS,
      uploadSessionID,
      attemptID,
      changedBy: ARCGIS_TEST_USER
    };
  }

  /** Holds a restarted attempt after it has cleared the previous attempt's staged rows and its own family, before its first staging window. */
  function holdRestartedAttemptAfterCleanup(harness: BarrierHarness) {
    return harness.placeBarrier({
      pattern: ARCGIS_COMMIT_STATEMENT.IMPORT_ROW_UNIT_LOCK,
      placement: 'before',
      when: () => harness.countMatches(ARCGIS_COMMIT_STATEMENT.FAMILY_ID_SELECT) >= FAMILY_SELECTS_ONCE_R2_HAS_CLEARED_ITS_FAMILY
    });
  }

  it(
    'AI9(a): R2 supersedes R1 while R1 is parked before its second staging window; R1 then stops at its guard without writing, and R2 finishes with exactly the import rows',
    async () => {
      await startActiveUploadSession(connection, scope, AI9A.UPLOAD_SESSION);
      const seeded = await seedArcgisImport(scope, AI9A.FILE, IMPORT_ROW_COUNT, AI9A.TAG_PREFIX);
      console.log(`[AI9a seed] import=${seeded.importSessionId} batch=${seeded.batchID} rows=${IMPORT_ROW_COUNT} window=${ARCGIS_STAGING_WINDOW_ROWS}`);

      const harness = installBarrierHarness(realManager);
      await runBarrierScenario(harness, async () => {
        const r1HeldBeforeSecondWindowGuard = harness.placeBarrier({
          pattern: ARCGIS_COMMIT_STATEMENT.IMPORT_ROW_UNIT_LOCK,
          placement: 'before',
          when: () => harness.countMatches(ARCGIS_COMMIT_STATEMENT.CURSOR_CAS) === GUARDS_COMMITTED_BY_R1_BEFORE_PARKING
        });
        const r1Commit = harness.track(commitRevisions(seeded, AI9A.UPLOAD_SESSION));
        await withinDeadline(r1HeldBeforeSecondWindowGuard.reached, 'R1 reaching the guard of its second staging window', harness.renderStatementLog);

        const r1Row = await describeImportRow('AI9a R1 parked', seeded);
        const r1AttemptID = requireAttemptID(r1Row, 'R1');
        const stagedWhileR1Parked = await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID);
        console.log(`[AI9a] R1 attempt=${r1AttemptID}; staged rows while R1 is parked=${stagedWhileR1Parked}`);
        expect(r1Row.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTING);
        expect(r1Row.stagingNextRowIndex, 'R1 committed exactly its first window').toBe(ARCGIS_STAGING_WINDOW_ROWS);
        expect(stagedWhileR1Parked).toBe(ARCGIS_STAGING_WINDOW_ROWS);

        const r2HeldBeforeFirstWindow = holdRestartedAttemptAfterCleanup(harness);
        const r2HeldBeforeFinalizeGuard = harness.placeBarrier({
          pattern: ARCGIS_COMMIT_STATEMENT.IMPORT_ROW_UNIT_LOCK,
          placement: 'before',
          when: () => harness.recordedStatements.some(statement => isCursorAdvanceTo(statement, seeded.rowCount))
        });
        const r2Commit = harness.track(commitRevisions(seeded, AI9A.UPLOAD_SESSION));
        await withinDeadline(r2HeldBeforeFirstWindow.reached, 'R2 reaching its first staging window after clearing', harness.renderStatementLog);

        const r2Row = await describeImportRow('AI9a R2 after its claim and cleanup', seeded);
        const r2AttemptID = requireAttemptID(r2Row, 'R2');
        const stagedAfterR2Cleanup = await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID);
        console.log(`[AI9a] R2 attempt=${r2AttemptID}; staged rows after R2's clear windows=${stagedAfterR2Cleanup}`);
        expect(r2AttemptID, 'the claim must install a new attempt token').not.toBe(r1AttemptID);
        expect(r2Row.stagingNextRowIndex, 'the claim restarts the cursor').toBe(0);
        expect(stagedAfterR2Cleanup, "R2's clear windows removed all of R1's staged rows").toBe(0);

        r2HeldBeforeFirstWindow.release();
        await withinDeadline(r2HeldBeforeFinalizeGuard.reached, 'R2 reaching the guard of its finalize unit', harness.renderStatementLog);
        const stagedWhileR2Parked = await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID);
        const importRowWhileR2Parked = await describeImportRow('AI9a R2 parked before finalize', seeded);
        expect(stagedWhileR2Parked).toBe(IMPORT_ROW_COUNT);
        expect(importRowWhileR2Parked.state, 'R2 is mid-commit, so R1 must be superseded rather than see a committed import').toBe(
          ARCGIS_IMPORT_SESSION_STATE.COMMITTING
        );
        expect(importRowWhileR2Parked.commitAttemptId).toBe(r2AttemptID);

        const statementsBeforeR1Release = harness.recordedStatements.length;
        r1HeldBeforeSecondWindowGuard.release();
        const r1Outcome = await settle(r1Commit, 'R1 to be superseded', harness);
        console.log(`[AI9a] R1 outcome: ${r1Outcome.status} ${r1Outcome.status === 'rejected' ? String(r1Outcome.reason) : ''}`);
        expect(r1Outcome.status).toBe('rejected');
        if (r1Outcome.status !== 'rejected') return;
        expect(r1Outcome.reason).toBeInstanceOf(ArcgisCommitSupersededError);
        const superseded = r1Outcome.reason as ArcgisCommitSupersededError;
        expect(superseded.attemptID).toBe(r1AttemptID);
        expect(superseded.currentAttemptID).toBe(r2AttemptID);

        const statementsWhileR2Parked = harness.recordedStatements.slice(statementsBeforeR1Release);
        const r1Writes = statementsWhileR2Parked.filter(statement => WRITE_STATEMENT.test(statement.sql));
        console.log(
          `[AI9a] statements recorded between R1's release and R2's release (R2 is parked, so any would be R1's): ${statementsWhileR2Parked.length}, writes: ${r1Writes.length}`
        );
        for (const [kind, pattern] of Object.entries({
          STAGING_INSERT: ARCGIS_COMMIT_STATEMENT.STAGING_INSERT,
          CURSOR_CAS: ARCGIS_COMMIT_STATEMENT.CURSOR_CAS,
          STAGED_CLEAR_DELETE: ARCGIS_COMMIT_STATEMENT.STAGED_CLEAR_DELETE,
          FAMILY_ID_SELECT: ARCGIS_COMMIT_STATEMENT.FAMILY_ID_SELECT
        })) {
          expect(
            statementsWhileR2Parked.filter(statement => pattern.test(statement.sql)),
            `a superseded R1 must not issue ${kind}`
          ).toHaveLength(0);
        }
        expect(r1Writes, 'a superseded R1 writes nothing').toHaveLength(0);
        expect(await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID), "R1's refusal left R2's staged rows alone").toBe(IMPORT_ROW_COUNT);

        r2HeldBeforeFinalizeGuard.release();
        const r2Result = await withinDeadline(r2Commit, 'R2 to finish', harness.renderStatementLog);
        console.log(`[AI9a] R2 result: ${JSON.stringify(r2Result)}`);
        expect(r2Result).toEqual({ rowCount: IMPORT_ROW_COUNT, fileName: seeded.fileName, alreadyCommitted: false, batchID: seeded.batchID });

        const finalRow = await describeImportRow('AI9a done', seeded);
        const fileUploadRows = await fileUploadChangelogRows(connection, scope.censusID, seeded.fileName);
        console.log(`[AI9a] file_upload changelog rows: ${fileUploadRows.length}`);
        expect(finalRow.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
        expect(finalRow.committedBatchId).toBe(seeded.batchID);
        expect(finalRow.committedRowCount).toBe(IMPORT_ROW_COUNT);
        expect(await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID), 'exactly the import rows, none duplicated by R1').toBe(
          IMPORT_ROW_COUNT
        );
        expect(fileUploadRows, 'one file_upload changelog row for the one finished commit').toHaveLength(1);

        await setUploadSessionState(connection, AI9A.UPLOAD_SESSION, UploadSessionState.COMPLETED);
        const statementsBeforeStaleInvocation = harness.recordedStatements.length;
        const staleSnapshot = await realManager.withTransaction(tx =>
          lockArcgisImportSessionForCommitUnit(realManager, attemptOf(seeded, AI9A.UPLOAD_SESSION, r1AttemptID), tx.id)
        );
        const staleInvocationStatements = harness.recordedStatements.slice(statementsBeforeStaleInvocation);
        console.log(
          `[AI9a stale-unit invocation] R1 attempt ${r1AttemptID} against a committed import whose upload session is ${UploadSessionState.COMPLETED}: ${JSON.stringify(staleSnapshot)}; statements=${staleInvocationStatements.length}`
        );
        expect(staleSnapshot.commitCompleted, 'a committed import is reported before the attempt token and the session liveness are judged').toBe(true);
        expect(staleSnapshot.committedRowCount).toBe(IMPORT_ROW_COUNT);
        expect(
          staleInvocationStatements.filter(statement => CENSUS_REPLACEMENT_STATEMENT.SESSION_LOCK.test(statement.sql)),
          'the committed precedence returns before the upload-session liveness lock'
        ).toHaveLength(0);
        expect(staleInvocationStatements.filter(statement => WRITE_STATEMENT.test(statement.sql))).toHaveLength(0);
      });
    },
    BARRIER_TEST_TIMEOUT_MS
  );

  it(
    'AI9(b): R2 claims the import only after R1 releases the import-row lock it holds inside its second staging window, and then supersedes R1 without a deadlock',
    async () => {
      await startActiveUploadSession(connection, scope, AI9B.UPLOAD_SESSION);
      const seeded = await seedArcgisImport(scope, AI9B.FILE, IMPORT_ROW_COUNT, AI9B.TAG_PREFIX);
      console.log(`[AI9b seed] import=${seeded.importSessionId} batch=${seeded.batchID} rows=${IMPORT_ROW_COUNT} window=${ARCGIS_STAGING_WINDOW_ROWS}`);

      const harness = installBarrierHarness(realManager);
      await runBarrierScenario(harness, async () => {
        const r1HoldingImportRowInSecondWindow = harness.placeBarrier({
          pattern: ARCGIS_COMMIT_STATEMENT.IMPORT_ROW_UNIT_LOCK,
          placement: 'after',
          when: () => harness.countMatches(ARCGIS_COMMIT_STATEMENT.CURSOR_CAS) === GUARDS_COMMITTED_BY_R1_BEFORE_PARKING
        });
        const r1Commit = harness.track(commitRevisions(seeded, AI9B.UPLOAD_SESSION));
        await withinDeadline(
          r1HoldingImportRowInSecondWindow.reached,
          'R1 holding the import row inside its second staging window',
          harness.renderStatementLog
        );
        const r1Row = await describeImportRow('AI9b R1 parked holding the import row', seeded);
        const r1AttemptID = requireAttemptID(r1Row, 'R1');
        expect(r1Row.stagingNextRowIndex, 'R1 committed its first window and is inside the second').toBe(ARCGIS_STAGING_WINDOW_ROWS);

        const r2HeldBeforeFirstWindow = holdRestartedAttemptAfterCleanup(harness);
        const r2Commit = harness.track(commitRevisions(seeded, AI9B.UPLOAD_SESSION));
        const lockWait = await waitForLockWait(connection, scope.schema, 'arcgis_import_sessions', `%${seeded.importSessionId}%`, harness.renderStatementLog);
        console.log(`[AI9b] R2's claim is in LOCK WAIT on the import row: thread ${lockWait.threadId} ${lockWait.queryHead}`);
        expect(harness.countMatches(ARCGIS_COMMIT_STATEMENT.CLAIM_UPDATE), 'R2 must not have written its claim while R1 holds the row (R1 claim only)').toBe(1);
        expect((await describeImportRow('AI9b R2 waiting', seeded)).commitAttemptId, "R2's claim waits; the row is still R1's").toBe(r1AttemptID);

        r1HoldingImportRowInSecondWindow.release();
        await withinDeadline(r2HeldBeforeFirstWindow.reached, 'R2 reaching its first staging window after clearing', harness.renderStatementLog);

        const statementLog = harness.recordedStatements;
        const r1SecondWindowCommittedAt = statementLog.findIndex(statement => isCursorAdvanceTo(statement, ARCGIS_STAGING_WINDOW_ROWS * 2));
        const claimWriteIndexes = statementLog.flatMap((statement, index) => (ARCGIS_COMMIT_STATEMENT.CLAIM_UPDATE.test(statement.sql) ? [index] : []));
        console.log(`[AI9b] R1 window 2 cursor advance at statement #${r1SecondWindowCommittedAt}; claim writes at #${claimWriteIndexes.join(', #')}`);
        expect(r1SecondWindowCommittedAt, "R1's second window committed").toBeGreaterThanOrEqual(0);
        expect(claimWriteIndexes).toHaveLength(2);
        expect(claimWriteIndexes[1], "R2's claim wrote only after R1's window had committed").toBeGreaterThan(r1SecondWindowCommittedAt);

        const r2Row = await describeImportRow('AI9b R2 after its claim and cleanup', seeded);
        const r2AttemptID = requireAttemptID(r2Row, 'R2');
        const stagedAfterR2Cleanup = await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID);
        console.log(`[AI9b] R2 attempt=${r2AttemptID}; staged rows after R2's clear windows=${stagedAfterR2Cleanup}`);
        expect(r2AttemptID).not.toBe(r1AttemptID);
        expect(r2Row.stagingNextRowIndex).toBe(0);
        expect(stagedAfterR2Cleanup, "R2's clear windows removed both of R1's committed windows").toBe(0);

        r2HeldBeforeFirstWindow.release();
        const r1Outcome = await settle(r1Commit, "R1's next unit to be refused", harness);
        const r2Outcome = await settle(r2Commit, 'R2 to finish', harness);
        console.log(`[AI9b] R1 outcome: ${r1Outcome.status} ${r1Outcome.status === 'rejected' ? String(r1Outcome.reason) : ''}`);
        console.log(`[AI9b] R2 outcome: ${r2Outcome.status} ${r2Outcome.status === 'rejected' ? String(r2Outcome.reason) : ''}`);
        for (const outcome of [r1Outcome, r2Outcome]) {
          if (outcome.status === 'rejected') {
            expect((outcome.reason as { code?: string }).code, 'neither attempt may die in a deadlock').not.toBe(MYSQL_DEADLOCK_CODE);
          }
        }
        expect(r1Outcome.status).toBe('rejected');
        if (r1Outcome.status !== 'rejected') return;
        expect(r1Outcome.reason).toBeInstanceOf(ArcgisCommitSupersededError);
        expect((r1Outcome.reason as ArcgisCommitSupersededError).attemptID).toBe(r1AttemptID);
        expect((r1Outcome.reason as ArcgisCommitSupersededError).currentAttemptID).toBe(r2AttemptID);
        expect(r2Outcome.status).toBe('fulfilled');
        if (r2Outcome.status !== 'fulfilled') return;
        expect(r2Outcome.value).toEqual({ rowCount: IMPORT_ROW_COUNT, fileName: seeded.fileName, alreadyCommitted: false, batchID: seeded.batchID });

        const guardOnlyTransactions = new Map<string, string[]>();
        for (const statement of statementLog) {
          if (statement.transactionID === undefined) continue;
          guardOnlyTransactions.set(statement.transactionID, [...(guardOnlyTransactions.get(statement.transactionID) ?? []), statement.sql]);
        }
        const refusedUnits = [...guardOnlyTransactions.entries()].filter(
          ([, sqls]) => sqls.length === 1 && ARCGIS_COMMIT_STATEMENT.IMPORT_ROW_UNIT_LOCK.test(sqls[0])
        );
        console.log(`[AI9b] transactions that issued only a guard (a refused unit): ${refusedUnits.map(([id]) => id).join(', ')}`);
        expect(refusedUnits, "exactly one unit was refused at its guard: R1's next unit, which wrote nothing").toHaveLength(1);

        const finalRow = await describeImportRow('AI9b done', seeded);
        expect(finalRow.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
        expect(finalRow.commitAttemptId).toBe(r2AttemptID);
        expect(await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID), 'exactly the import rows, none duplicated by R1').toBe(
          IMPORT_ROW_COUNT
        );
      });
    },
    BARRIER_TEST_TIMEOUT_MS
  );
});
