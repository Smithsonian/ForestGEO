/**
 * ArcGIS resumable commit (#561) — the cleanup paths racing a commit, on the REAL ConnectionManager.
 *
 * AI11: the abandoned-session sweep (`cleanupOrphanedData`) cannot take rows a takeover now owns. (a) the caller listed
 *   the session before a takeover flipped it to `failed`: the sweep must leave it `failed` and move nothing; the
 *   positive control (no takeover) shows the same call does move the rows and write `cleaned_up`. (b) the sweep holds
 *   the session row first: the takeover waits on it, and F0 then deletes the failure rows the sweep wrote.
 * AI18: `/api/cleanup`'s orphan step. During F, with the upload session row locked by F, the orphan DELETE waits or
 *   settles but never takes an active row; and a finder list that went stale across a takeover cannot delete the
 *   takeover's rows.
 * AI20: the OLD sweep's statement sequence, replayed. A move that lands on the takeover's rows before finalize's counts
 *   is caught by finalize, and the retry rebuilds. That is the whole claim: recovery for moves BEFORE F's counts only
 *   (N4); a move after the counts is not covered by this test and is prevented by the sweep's lock instead (AI11).
 *
 * Nothing here mocks '@/lib/db/connectionmanager'. Import sessions are seeded through the product function BEFORE the
 * barrier harness is installed; plain-SQL seeds use the separate setup connection.
 *
 * Prerequisites: docker compose up -d mysql
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { createAdditionalCensus, setupTestDatabase, teardownTestDatabase, type TestDatabaseConfig, type TestData } from '../setup/local-db-setup';
import { ARCGIS_COMMIT_STATEMENT } from '../setup/arcgis-commit-statement-patterns';
import {
  BARRIER_DEADLINE_MS,
  BARRIER_TEST_TIMEOUT_MS,
  installBarrierHarness,
  runBarrierScenario,
  waitForLockWait,
  withinDeadline,
  type BarrierHarness,
  type LockWait
} from '../setup/arcgis-commit-barrier-harness';
import {
  ARCGIS_TEST_USER,
  countCensusRowsOutsideFamily,
  countFamilyFailureRows,
  countStagedFamilyRows,
  deleteAuditRows,
  readImportRow,
  seedArcgisImport,
  seedPriorCensusRows,
  setUploadSessionState,
  startActiveUploadSession,
  type ArcgisImportScope,
  type SeededArcgisImport
} from '../setup/arcgis-commit-fixtures';
import { TEST_UPLOAD_SESSION_USER } from '../setup/upload-session-fixtures';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];
const RESOLVED_HOSTS = [process.env.AZURE_SQL_SERVER, process.env.TEST_DB_HOST || 'localhost'];
for (const host of RESOLVED_HOSTS) {
  if (!host || !LOCAL_HOSTS.includes(host)) {
    throw new Error(`REFUSING TO RUN: host '${host}' is not local. This suite deletes rows.`);
  }
}

vi.mock('@/ailogger', () => ({ default: { info: () => undefined, warn: () => undefined, error: () => undefined } }));

import ConnectionManager from '@/lib/db/connectionmanager';
import { ARCGIS_STAGING_WINDOW_ROWS, commitArcgisImport } from '@/lib/uploads/arcgis-commit';
import { ArcgisCommitVerificationError } from '@/lib/uploads/arcgis-commit-finalize';
import { ARCGIS_IMPORT_SESSION_STATE } from '@/lib/arcgis/import-session';
import { UploadMode } from '@/config/uploadmodes';
import {
  abandonActiveSession,
  cleanupOrphanedData,
  findAbandonedSessionsNeedingCleanup,
  getSession,
  SESSION_TIMEOUTS,
  UploadSessionState,
  type UploadSession
} from '@/config/uploadsessiontracker';
import { ensureTemporaryMeasurementsSourceFormatColumn } from '@/lib/ingestion/temporary-measurements';
import { CENSUS_REPLACEMENT_MARKER_COLUMN, ensureUploadSessionReplacementMarkerColumn } from '@/lib/uploads/upload-session-replacement-marker';
import { deleteOrphanedTemporaryMeasurements, findOrphanedTemporaryMeasurements } from '@/lib/uploads/orphaned-staging-cleanup';
import { moveTemporaryBatchToFailedMeasurements } from '@/lib/batchfailuretransfer';

const SETUP_TIMEOUT_MS = 120_000;
const CONTROL_CENSUS_NUMBER = 93;
const CONTROL_CENSUS_START = '2021-01-01';
const CONTROL_CENSUS_END = '2021-12-31';
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

const LARGE_IMPORT_ROW_COUNT = 2 * ARCGIS_STAGING_WINDOW_ROWS + 7;
const ROWS_STAGED_BY_FIRST_WINDOW = ARCGIS_STAGING_WINDOW_ROWS;
const SMALL_IMPORT_ROW_COUNT = 12;
const ORPHAN_ROWS = 4;
const ABANDONED_AGE_MARGIN_SECONDS = 60;
const ORPHAN_BATCH_ID = 'orphan-batch-561';
const ORPHAN_SOURCE_FORMAT = 'csv';
const WORKER_JOB_FILE_ID = 'async-job-561';
const NO_ROWS = 0;
const INTERRUPTED_UPLOAD_FAILURE_KIND = 'interrupted_upload';
const PRIOR_CENSUS_ROW_COUNT = 6;
const CSV_ROW_COUNT = 5;
const CSV_BATCH_ID = 'csvbatch-m1';
const ROUTE_CANCEL_MESSAGE = 'Session cancelled by user';
const OLD_SWEEP_REASON = 'Upload session cleaned up after abandonment (old sweep replay)';
const INJECTED_STAGING_FAILURE_MESSAGE = 'injected failure while staging window 2 (#561 cleanup races)';

const AI11A = { FILE: 'ai11a.xlsx', TAG_PREFIX: 'ai11a-', SESSION_FIRST: 'ai11a-first', SESSION_TAKEOVER: 'ai11a-takeover' } as const;
const AI11A_CONTROL = { FILE: 'ai11a-ctl.xlsx', TAG_PREFIX: 'ai11c-', SESSION_FIRST: 'ai11c-first' } as const;
const AI11B = { FILE: 'ai11b.xlsx', TAG_PREFIX: 'ai11b-', SESSION_FIRST: 'ai11b-first', SESSION_TAKEOVER: 'ai11b-takeover' } as const;
const M1_ARCGIS = { FILE: 'm1.xlsx', TAG_PREFIX: 'm1-', SESSION_FIRST: 'm1-first', SESSION_RETRY: 'm1-retry' } as const;
const M1_CSV = { FILE: 'm1-csv.csv', SESSION: 'm1-csv-session' } as const;
const L1_SESSIONS = { FAILED: 'l1-failed', ACTIVE: 'l1-active' } as const;
const AI18_DURING_F = {
  FILE: 'ai18f.xlsx',
  TAG_PREFIX: 'ai18f-',
  IMPORT_SESSION: 'ai18f-import-session',
  OLD_FAILED_SESSION: 'ai18f-old-failed-session'
} as const;
const AI18_STALE_LIST = { FILE: 'ai18s.xlsx', TAG_PREFIX: 'ai18s-', SESSION_FIRST: 'ai18s-first', SESSION_TAKEOVER: 'ai18s-takeover' } as const;
const AI20 = {
  FILE: 'ai20.xlsx',
  TAG_PREFIX: 'ai20-',
  SESSION_FIRST: 'ai20-first',
  SESSION_TAKEOVER: 'ai20-takeover',
  SESSION_RETRY: 'ai20-retry'
} as const;

class InjectedStagingFailure extends Error {
  constructor() {
    super(INJECTED_STAGING_FAILURE_MESSAGE);
    this.name = 'InjectedStagingFailure';
  }
}

type OrphanStepPath = 'lock_wait' | 'settled';

function isCursorAdvanceTo(statement: { sql: string; params: unknown[] }, toRowIndex: number): boolean {
  return ARCGIS_COMMIT_STATEMENT.CURSOR_CAS.test(statement.sql) && statement.params[0] === toRowIndex;
}

describe('ArcGIS resumable commit against the cleanup paths, on the real ConnectionManager (#561)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;
  let scope: ArcgisImportScope;
  let otherCensusScope: ArcgisImportScope;
  let realManager: ConnectionManager;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    realManager = ConnectionManager.getInstance();
    const otherCensus = await createAdditionalCensus(connection, testData, {
      plotCensusNumber: CONTROL_CENSUS_NUMBER,
      startDate: CONTROL_CENSUS_START,
      endDate: CONTROL_CENSUS_END
    });
    const base = {
      schema: config.database,
      plotID: testData.plots[0].plotID,
      speciesCode: testData.species[0].SpeciesCode,
      quadratName: testData.quadrats[0].QuadratName
    };
    scope = { ...base, censusID: testData.census[0].censusID };
    otherCensusScope = { ...base, censusID: otherCensus.censusID };
    await ensureTemporaryMeasurementsSourceFormatColumn(realManager, scope.schema);
    await ensureUploadSessionReplacementMarkerColumn(realManager, scope.schema, CENSUS_REPLACEMENT_MARKER_COLUMN);
    console.log(`[cleanup-races setup] schema=${scope.schema} plot=${scope.plotID} census=${scope.censusID} otherCensus=${otherCensusScope.censusID}`);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await realManager.closeConnection();
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await connection.query('SELECT RELEASE_ALL_LOCKS()');
    for (const table of SUITE_TABLES) await connection.query(`DELETE FROM ${table}`);
  });

  function commitImport(seeded: SeededArcgisImport, uploadSessionID: string) {
    return commitArcgisImport(realManager, {
      schema: scope.schema,
      plotID: scope.plotID,
      censusID: scope.censusID,
      importSessionId: seeded.importSessionId,
      fileName: seeded.fileName,
      uploadMode: UploadMode.REVISIONS,
      userId: ARCGIS_TEST_USER,
      uploadSessionID
    });
  }

  async function startSessionWithFileId(sessionID: string, fileID: string | null): Promise<void> {
    await startActiveUploadSession(connection, scope, sessionID);
    await connection.query(`UPDATE upload_sessions SET file_id = ? WHERE session_id = ?`, [fileID ?? sessionID, sessionID]);
  }

  async function abandonLongAgo(sessionID: string): Promise<void> {
    const ageSeconds = Math.floor(SESSION_TIMEOUTS.CLEANUP_GRACE_PERIOD / 1000) + ABANDONED_AGE_MARGIN_SECONDS;
    await connection.query(`UPDATE upload_sessions SET state = ?, updated_at = DATE_SUB(NOW(), INTERVAL ? SECOND) WHERE session_id = ?`, [
      UploadSessionState.ABANDONED,
      ageSeconds,
      sessionID
    ]);
  }

  async function insertFailedSession(sessionID: string): Promise<void> {
    await connection.query(`INSERT INTO upload_sessions (session_id, schema_name, plot_id, census_id, user_id, state, file_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      sessionID,
      scope.schema,
      scope.plotID,
      scope.censusID,
      TEST_UPLOAD_SESSION_USER,
      UploadSessionState.FAILED,
      sessionID
    ]);
  }

  async function readSessionState(sessionID: string): Promise<string> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT state FROM upload_sessions WHERE session_id = ?`, [sessionID]);
    if (rows.length !== 1) throw new Error(`expected exactly one upload_sessions row for ${sessionID}, found ${rows.length}`);
    return String(rows[0].state);
  }

  async function seedOrphanRows(importScope: ArcgisImportScope, fileName: string, sessionID: string, rowCount: number): Promise<void> {
    for (let ordinal = 0; ordinal < rowCount; ordinal += 1) {
      await connection.query(
        `INSERT INTO temporarymeasurements (FileID, BatchID, SessionID, SourceFormat, PlotID, CensusID, TreeTag) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [fileName, ORPHAN_BATCH_ID, sessionID, ORPHAN_SOURCE_FORMAT, importScope.plotID, importScope.censusID, `orphan-${ordinal}`]
      );
    }
  }

  async function countStagedRowsOfSession(sessionID: string): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM temporarymeasurements WHERE SessionID = ?`, [sessionID]);
    return Number(rows[0].total);
  }

  async function countStagedRowsOfFile(fileName: string): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ?`, [fileName]);
    return Number(rows[0].total);
  }

  async function listAbandonedSession(sessionID: string): Promise<UploadSession> {
    const listed = await findAbandonedSessionsNeedingCleanup(scope.schema);
    console.log(`[sweep listing] abandoned sessions needing cleanup: ${listed.map(session => session.sessionId).join(', ') || '(none)'}`);
    const session = listed.find(candidate => candidate.sessionId === sessionID);
    if (!session) throw new Error(`findAbandonedSessionsNeedingCleanup did not list ${sessionID}`);
    return session;
  }

  /** Attempt 1: stages window 1 durably, then window 2's insert fails, leaving the import `committing` with 5,000 staged rows. */
  async function failFirstAttemptAfterWindowOne(harness: BarrierHarness, seeded: SeededArcgisImport, uploadSessionID: string): Promise<void> {
    harness.injectFailure({
      pattern: ARCGIS_COMMIT_STATEMENT.STAGING_INSERT,
      when: () => harness.countMatches(ARCGIS_COMMIT_STATEMENT.CURSOR_CAS) === 1,
      error: new InjectedStagingFailure()
    });
    await expect(commitImport(seeded, uploadSessionID)).rejects.toBeInstanceOf(InjectedStagingFailure);
    const stagedAfterFailure = await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID);
    const importRow = await readImportRow(connection, seeded.importSessionId);
    console.log(
      `[attempt 1 under ${uploadSessionID}] failed in window 2: staged=${stagedAfterFailure} cursor=${importRow.staging_next_row_index} state=${importRow.state}`
    );
    expect(stagedAfterFailure).toBe(ROWS_STAGED_BY_FIRST_WINDOW);
    expect(importRow.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTING);
  }

  it(
    'AI11(a): a sweep listed before a takeover leaves the session `failed` and moves nothing; without the takeover the same call moves the rows and writes `cleaned_up`',
    async () => {
      await startSessionWithFileId(AI11A.SESSION_FIRST, AI11A.SESSION_FIRST);
      const seeded = await seedArcgisImport(scope, AI11A.FILE, LARGE_IMPORT_ROW_COUNT, AI11A.TAG_PREFIX);
      const harness = installBarrierHarness(realManager);
      await runBarrierScenario(harness, async () => {
        await failFirstAttemptAfterWindowOne(harness, seeded, AI11A.SESSION_FIRST);
        await abandonLongAgo(AI11A.SESSION_FIRST);
        const listedSession = await listAbandonedSession(AI11A.SESSION_FIRST);

        await startSessionWithFileId(AI11A.SESSION_TAKEOVER, AI11A.SESSION_TAKEOVER);
        const takeoverResult = await withinDeadline(
          commitImport(seeded, AI11A.SESSION_TAKEOVER),
          'takeover under the second session',
          harness.renderStatementLog
        );
        const firstStateAfterTakeover = await readSessionState(AI11A.SESSION_FIRST);
        console.log(`[AI11a] takeover result=${JSON.stringify(takeoverResult)}; first session now reads ${firstStateAfterTakeover}`);
        expect(takeoverResult.alreadyCommitted).toBe(false);
        expect(firstStateAfterTakeover, 'the takeover flips the abandoned predecessor').toBe(UploadSessionState.FAILED);

        const sweep = await cleanupOrphanedData(scope.schema, listedSession);
        const firstStateAfterSweep = await readSessionState(AI11A.SESSION_FIRST);
        const stagedAfterSweep = await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID);
        const failureRowsAfterSweep = await countFamilyFailureRows(connection, seeded.fileName, seeded.batchID, scope.censusID);
        console.log(
          `[AI11a] stale sweep result=${JSON.stringify(sweep)}; first session reads ${firstStateAfterSweep}; staged=${stagedAfterSweep} familyFailureRows=${failureRowsAfterSweep}`
        );
        expect(sweep).toEqual({ temporaryDeleted: NO_ROWS, failedDeleted: NO_ROWS });
        expect(firstStateAfterSweep, 'the sweep must not overwrite a session a takeover failed').toBe(UploadSessionState.FAILED);
        expect(stagedAfterSweep).toBe(LARGE_IMPORT_ROW_COUNT);
        expect(failureRowsAfterSweep).toBe(NO_ROWS);
      });
    },
    BARRIER_TEST_TIMEOUT_MS
  );

  it(
    'AI11(a) positive control: with no takeover the sweep deletes the first attempt’s staged ArcGIS rows (no failure rows) and writes `cleaned_up`',
    async () => {
      await startSessionWithFileId(AI11A_CONTROL.SESSION_FIRST, AI11A_CONTROL.SESSION_FIRST);
      const seeded = await seedArcgisImport(scope, AI11A_CONTROL.FILE, LARGE_IMPORT_ROW_COUNT, AI11A_CONTROL.TAG_PREFIX);
      const harness = installBarrierHarness(realManager);
      await runBarrierScenario(harness, async () => {
        await failFirstAttemptAfterWindowOne(harness, seeded, AI11A_CONTROL.SESSION_FIRST);
        await abandonLongAgo(AI11A_CONTROL.SESSION_FIRST);
        const listedSession = await listAbandonedSession(AI11A_CONTROL.SESSION_FIRST);

        const sweep = await cleanupOrphanedData(scope.schema, listedSession);
        const firstStateAfterSweep = await readSessionState(AI11A_CONTROL.SESSION_FIRST);
        const stagedAfterSweep = await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID);
        const failureRowsAfterSweep = await countFamilyFailureRows(connection, seeded.fileName, seeded.batchID, scope.censusID);
        console.log(
          `[AI11a control] sweep result=${JSON.stringify(sweep)}; first session reads ${firstStateAfterSweep}; staged=${stagedAfterSweep} familyFailureRows=${failureRowsAfterSweep}`
        );
        expect(sweep).toEqual({ temporaryDeleted: ROWS_STAGED_BY_FIRST_WINDOW, failedDeleted: NO_ROWS });
        expect(firstStateAfterSweep).toBe(UploadSessionState.CLEANED_UP);
        expect(stagedAfterSweep).toBe(NO_ROWS);
        expect(failureRowsAfterSweep).toBe(NO_ROWS);
      });
    },
    BARRIER_TEST_TIMEOUT_MS
  );

  it(
    'AI11(b): a sweep that locks the session row first makes the takeover wait; the sweep deletes its staged rows and writes `cleaned_up`, and the takeover then stages the whole import',
    async () => {
      await startSessionWithFileId(AI11B.SESSION_FIRST, AI11B.SESSION_FIRST);
      const seeded = await seedArcgisImport(scope, AI11B.FILE, LARGE_IMPORT_ROW_COUNT, AI11B.TAG_PREFIX);
      const harness = installBarrierHarness(realManager);
      await runBarrierScenario(harness, async () => {
        await failFirstAttemptAfterWindowOne(harness, seeded, AI11B.SESSION_FIRST);
        await abandonLongAgo(AI11B.SESSION_FIRST);
        const listedSession = await listAbandonedSession(AI11B.SESSION_FIRST);
        await startSessionWithFileId(AI11B.SESSION_TAKEOVER, AI11B.SESSION_TAKEOVER);

        let takeoverStarted = false;
        const sweepHoldingSessionLock = harness.placeBarrier({
          pattern: ARCGIS_COMMIT_STATEMENT.UPLOAD_SESSION_STATE_LOCK,
          placement: 'after',
          when: () => !takeoverStarted
        });
        const sweep = harness.track(cleanupOrphanedData(scope.schema, listedSession));
        await withinDeadline(sweepHoldingSessionLock.reached, 'sweep holding the first session row', harness.renderStatementLog);
        console.log('[AI11b] sweep parked after locking the first upload session row');

        takeoverStarted = true;
        const takeover = harness.track(commitImport(seeded, AI11B.SESSION_TAKEOVER));
        const lockWait: LockWait = await waitForLockWait(connection, scope.schema, 'upload_sessions', `%${AI11B.SESSION_FIRST}%`, harness.renderStatementLog);
        console.log(`[AI11b] takeover is in LOCK WAIT on ${AI11B.SESSION_FIRST}: thread ${lockWait.threadId} ${lockWait.queryHead}`);
        expect(await readSessionState(AI11B.SESSION_FIRST), 'the sweep has not yet written anything').toBe(UploadSessionState.ABANDONED);

        sweepHoldingSessionLock.release();
        const sweepResult = await withinDeadline(sweep, 'sweep to finish', harness.renderStatementLog);
        const takeoverResult = await withinDeadline(takeover, 'takeover to finish', harness.renderStatementLog);
        console.log(`[AI11b] sweep=${JSON.stringify(sweepResult)} takeover=${JSON.stringify(takeoverResult)}`);
        expect(sweepResult).toEqual({ temporaryDeleted: ROWS_STAGED_BY_FIRST_WINDOW, failedDeleted: NO_ROWS });
        expect(takeoverResult).toEqual({ rowCount: LARGE_IMPORT_ROW_COUNT, fileName: seeded.fileName, alreadyCommitted: false, batchID: seeded.batchID });

        const firstStateAfter = await readSessionState(AI11B.SESSION_FIRST);
        const deleteAudit = await deleteAuditRows(connection, scope.censusID);
        const staged = await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID);
        const failureRows = await countFamilyFailureRows(connection, seeded.fileName, seeded.batchID, scope.censusID);
        console.log(`[AI11b] first session=${firstStateAfter} deleteAudit=${JSON.stringify(deleteAudit)} staged=${staged} familyFailureRows=${failureRows}`);
        expect(firstStateAfter, 'the sweep wrote cleaned_up first; the takeover found nothing abandoned to flip').toBe(UploadSessionState.CLEANED_UP);
        expect(deleteAudit, 'the sweep wrote no failure rows, so F0 has nothing to delete or audit').toEqual({ total: NO_ROWS, distinctRecordIDs: NO_ROWS });
        expect(staged).toBe(LARGE_IMPORT_ROW_COUNT);
        expect(failureRows).toBe(NO_ROWS);
        expect((await readImportRow(connection, seeded.importSessionId)).state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
      });
    },
    BARRIER_TEST_TIMEOUT_MS
  );

  async function observeOrphanStepPath(deletion: Promise<number>, harness: BarrierHarness): Promise<{ path: OrphanStepPath; lockWait?: LockWait }> {
    const waiter = waitForLockWait(connection, scope.schema, 'upload_sessions', `%${AI18_DURING_F.IMPORT_SESSION}%`, harness.renderStatementLog).then(
      lockWait => ({ path: 'lock_wait' as const, lockWait })
    );
    const settledEarly = deletion.then(() => ({ path: 'settled' as const }));
    // If the DELETE settles first, the poll keeps running until its own deadline; its rejection is expected and ignored.
    waiter.catch(() => undefined);
    return withinDeadline(
      Promise.race([waiter, settledEarly]),
      `orphan DELETE to wait on or release ${AI18_DURING_F.IMPORT_SESSION}`,
      harness.renderStatementLog
    );
  }

  it(
    'AI18 during F: the orphan DELETE started while F holds the upload session row resolves once F commits, removing exactly the orphans and none of the import’s rows',
    async () => {
      await startSessionWithFileId(AI18_DURING_F.IMPORT_SESSION, WORKER_JOB_FILE_ID);
      await insertFailedSession(AI18_DURING_F.OLD_FAILED_SESSION);
      const seeded = await seedArcgisImport(scope, AI18_DURING_F.FILE, SMALL_IMPORT_ROW_COUNT, AI18_DURING_F.TAG_PREFIX);
      const harness = installBarrierHarness(realManager);
      await runBarrierScenario(harness, async () => {
        const finalizeHoldingLocks = harness.placeBarrier({ pattern: ARCGIS_COMMIT_STATEMENT.STAGED_FAMILY_COUNT, placement: 'after' });
        const commit = harness.track(commitImport(seeded, AI18_DURING_F.IMPORT_SESSION));
        await withinDeadline(finalizeHoldingLocks.reached, 'F holding the import row and the upload session row', harness.renderStatementLog);
        console.log(`[AI18 during F] F parked after its staged-row count; ${SMALL_IMPORT_ROW_COUNT} rows staged under ${AI18_DURING_F.IMPORT_SESSION}`);

        await seedOrphanRows(scope, seeded.fileName, AI18_DURING_F.OLD_FAILED_SESSION, ORPHAN_ROWS);
        const listed = await findOrphanedTemporaryMeasurements(realManager, scope.schema);
        console.log(`[AI18 during F] finder lists ${JSON.stringify(listed)}`);
        expect(listed, 'only the failed session’s rows are orphans; the active import’s rows are owned by its SessionID').toEqual([
          { fileId: seeded.fileName, rowCount: ORPHAN_ROWS }
        ]);

        const deletion = harness.track(
          deleteOrphanedTemporaryMeasurements(
            realManager,
            scope.schema,
            listed.map(file => file.fileId)
          )
        );
        const observed = await observeOrphanStepPath(deletion, harness);
        console.log(
          `[AI18 during F] orphan DELETE path=${observed.path}${observed.lockWait ? ` thread=${observed.lockWait.threadId} ${observed.lockWait.queryHead}` : ''} (deadline ${BARRIER_DEADLINE_MS} ms)`
        );

        finalizeHoldingLocks.release();
        const commitResult = await withinDeadline(commit, 'F to commit', harness.renderStatementLog);
        const deletedRows = await withinDeadline(deletion, 'orphan DELETE to resolve after F committed', harness.renderStatementLog);
        console.log(`[AI18 during F] commit=${JSON.stringify(commitResult)} deletedRows=${deletedRows}`);
        expect(commitResult).toEqual({ rowCount: SMALL_IMPORT_ROW_COUNT, fileName: seeded.fileName, alreadyCommitted: false, batchID: seeded.batchID });
        expect(deletedRows).toBe(ORPHAN_ROWS);

        const importRow = await readImportRow(connection, seeded.importSessionId);
        const orphansLeft = await countStagedRowsOfSession(AI18_DURING_F.OLD_FAILED_SESSION);
        const importRowsStaged = await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID);
        console.log(`[AI18 during F] orphansLeft=${orphansLeft} importRowsStaged=${importRowsStaged} committed_row_count=${importRow.committed_row_count}`);
        expect(orphansLeft).toBe(NO_ROWS);
        expect(importRowsStaged).toBe(Number(importRow.committed_row_count));
        expect(importRowsStaged).toBe(SMALL_IMPORT_ROW_COUNT);

        const listedAgain = await findOrphanedTemporaryMeasurements(realManager, scope.schema);
        const deletedAgain = await deleteOrphanedTemporaryMeasurements(realManager, scope.schema, [seeded.fileName]);
        console.log(`[AI18 during F] second orphan step: finder=${JSON.stringify(listedAgain)} deleted=${deletedAgain}`);
        expect(listedAgain).toEqual([]);
        expect(deletedAgain).toBe(NO_ROWS);
        expect(await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID)).toBe(SMALL_IMPORT_ROW_COUNT);

        await setUploadSessionState(connection, AI18_DURING_F.IMPORT_SESSION, UploadSessionState.FAILED);
        const listedWhenFailed = await findOrphanedTemporaryMeasurements(realManager, scope.schema);
        const deletedWhenFailed = await deleteOrphanedTemporaryMeasurements(realManager, scope.schema, [seeded.fileName]);
        console.log(`[AI18 during F control] session failed: finder=${JSON.stringify(listedWhenFailed)} deleted=${deletedWhenFailed}`);
        expect(listedWhenFailed).toEqual([{ fileId: seeded.fileName, rowCount: SMALL_IMPORT_ROW_COUNT }]);
        expect(deletedWhenFailed, 'positive control: once the session is failed the same step deletes the import’s rows').toBe(SMALL_IMPORT_ROW_COUNT);
        expect(await countStagedRowsOfFile(seeded.fileName)).toBe(NO_ROWS);
      });
    },
    BARRIER_TEST_TIMEOUT_MS
  );

  it(
    'AI18 (stale finder list): a list made before a takeover cannot delete the takeover’s rows; the DELETE removes only the failed session’s remaining rows',
    async () => {
      await startSessionWithFileId(AI18_STALE_LIST.SESSION_FIRST, AI18_STALE_LIST.SESSION_FIRST);
      const seeded = await seedArcgisImport(scope, AI18_STALE_LIST.FILE, LARGE_IMPORT_ROW_COUNT, AI18_STALE_LIST.TAG_PREFIX);
      const harness = installBarrierHarness(realManager);
      await runBarrierScenario(harness, async () => {
        await failFirstAttemptAfterWindowOne(harness, seeded, AI18_STALE_LIST.SESSION_FIRST);
        await abandonLongAgo(AI18_STALE_LIST.SESSION_FIRST);
        await seedOrphanRows(otherCensusScope, seeded.fileName, AI18_STALE_LIST.SESSION_FIRST, ORPHAN_ROWS);

        const staleList = await findOrphanedTemporaryMeasurements(realManager, scope.schema);
        console.log(`[AI18 stale list] finder before the takeover: ${JSON.stringify(staleList)}`);
        expect(staleList).toEqual([{ fileId: seeded.fileName, rowCount: ROWS_STAGED_BY_FIRST_WINDOW + ORPHAN_ROWS }]);

        await startSessionWithFileId(AI18_STALE_LIST.SESSION_TAKEOVER, AI18_STALE_LIST.SESSION_TAKEOVER);
        const takeoverResult = await withinDeadline(
          commitImport(seeded, AI18_STALE_LIST.SESSION_TAKEOVER),
          'takeover under the second session',
          harness.renderStatementLog
        );
        expect(takeoverResult.alreadyCommitted).toBe(false);
        const takeoverRowsBefore = await countStagedRowsOfSession(AI18_STALE_LIST.SESSION_TAKEOVER);
        console.log(`[AI18 stale list] takeover staged ${takeoverRowsBefore} rows; running the DELETE with the stale list`);
        expect(takeoverRowsBefore).toBe(LARGE_IMPORT_ROW_COUNT);

        const deletedRows = await deleteOrphanedTemporaryMeasurements(
          realManager,
          scope.schema,
          staleList.map(file => file.fileId)
        );
        const takeoverRowsAfter = await countStagedRowsOfSession(AI18_STALE_LIST.SESSION_TAKEOVER);
        const failedSessionRowsAfter = await countStagedRowsOfSession(AI18_STALE_LIST.SESSION_FIRST);
        console.log(`[AI18 stale list] deleted=${deletedRows} takeoverRowsAfter=${takeoverRowsAfter} failedSessionRowsAfter=${failedSessionRowsAfter}`);
        expect(deletedRows, 'only the failed session’s rows in the other census were still orphans').toBe(ORPHAN_ROWS);
        expect(takeoverRowsAfter).toBe(LARGE_IMPORT_ROW_COUNT);
        expect(failedSessionRowsAfter).toBe(NO_ROWS);
        expect(await countCensusRowsOutsideFamily(connection, scope.censusID, seeded.batchID)).toBe(NO_ROWS);
      });
    },
    BARRIER_TEST_TIMEOUT_MS
  );

  async function seedStagedRows(importScope: ArcgisImportScope, fileName: string, batchID: string, sessionID: string, rowCount: number): Promise<void> {
    for (let ordinal = 0; ordinal < rowCount; ordinal += 1) {
      await connection.query(
        `INSERT INTO temporarymeasurements (FileID, BatchID, SessionID, SourceFormat, PlotID, CensusID, TreeTag) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [fileName, batchID, sessionID, ORPHAN_SOURCE_FORMAT, importScope.plotID, importScope.censusID, `${batchID}-${ordinal}`]
      );
    }
  }

  async function countCensusRows(censusID: number): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM coremeasurements WHERE CensusID = ?`, [censusID]);
    return Number(rows[0].total);
  }

  async function sweepAsTheDeleteRouteDoes(sessionID: string): Promise<{ abandoned: boolean; sweep: { temporaryDeleted: number; failedDeleted: number } }> {
    const abandoned = await abandonActiveSession(scope.schema, sessionID, ROUTE_CANCEL_MESSAGE);
    const uploadSession = await getSession(scope.schema, sessionID);
    if (!uploadSession) throw new Error(`upload session ${sessionID} vanished after the DELETE route abandoned it`);
    const sweep = await cleanupOrphanedData(scope.schema, uploadSession);
    return { abandoned, sweep };
  }

  it(
    'M1: the DELETE route’s sweep after a failed sync commit deletes the staged ArcGIS rows and leaves the census unchanged, the import `committing`, and a retry completes cleanly',
    async () => {
      await seedPriorCensusRows(connection, scope, PRIOR_CENSUS_ROW_COUNT);
      const censusRowsBefore = await countCensusRows(scope.censusID);
      expect(censusRowsBefore).toBe(PRIOR_CENSUS_ROW_COUNT);
      await startSessionWithFileId(M1_ARCGIS.SESSION_FIRST, M1_ARCGIS.SESSION_FIRST);
      const seeded = await seedArcgisImport(scope, M1_ARCGIS.FILE, LARGE_IMPORT_ROW_COUNT, M1_ARCGIS.TAG_PREFIX);
      const harness = installBarrierHarness(realManager);
      await runBarrierScenario(harness, async () => {
        await failFirstAttemptAfterWindowOne(harness, seeded, M1_ARCGIS.SESSION_FIRST);

        const { abandoned, sweep } = await sweepAsTheDeleteRouteDoes(M1_ARCGIS.SESSION_FIRST);

        const censusRowsAfter = await countCensusRows(scope.censusID);
        const familyFailureRows = await countFamilyFailureRows(connection, seeded.fileName, seeded.batchID, scope.censusID);
        const stagedForSession = await countStagedRowsOfSession(M1_ARCGIS.SESSION_FIRST);
        const importRow = await readImportRow(connection, seeded.importSessionId);
        const sessionState = await readSessionState(M1_ARCGIS.SESSION_FIRST);
        console.log(
          `[M1] abandoned=${abandoned} sweep=${JSON.stringify(sweep)} censusRows ${censusRowsBefore}->${censusRowsAfter} familyFailureRows=${familyFailureRows} ` +
            `stagedForSession=${stagedForSession} import state=${importRow.state} session=${sessionState}`
        );
        expect(abandoned).toBe(true);
        expect(sweep).toEqual({ temporaryDeleted: ROWS_STAGED_BY_FIRST_WINDOW, failedDeleted: NO_ROWS });
        expect(familyFailureRows, 'no spurious interrupted_upload failure rows for the import’s family').toBe(NO_ROWS);
        expect(censusRowsAfter, 'the census is exactly what it was before the commit').toBe(censusRowsBefore);
        expect(stagedForSession).toBe(NO_ROWS);
        expect(importRow.state, 'the import stays committing: its durable source restages on the next commit').toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTING);
        expect(sessionState).toBe(UploadSessionState.CLEANED_UP);

        await startSessionWithFileId(M1_ARCGIS.SESSION_RETRY, M1_ARCGIS.SESSION_RETRY);
        const retryResult = await withinDeadline(commitImport(seeded, M1_ARCGIS.SESSION_RETRY), 'retry after the sweep', harness.renderStatementLog);
        const stagedAfterRetry = await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID);
        console.log(`[M1] retry=${JSON.stringify(retryResult)} staged=${stagedAfterRetry}`);
        expect(retryResult).toEqual({ rowCount: LARGE_IMPORT_ROW_COUNT, fileName: seeded.fileName, alreadyCommitted: false, batchID: seeded.batchID });
        expect(stagedAfterRetry).toBe(LARGE_IMPORT_ROW_COUNT);
        expect(await countFamilyFailureRows(connection, seeded.fileName, seeded.batchID, scope.censusID)).toBe(NO_ROWS);
        expect((await readImportRow(connection, seeded.importSessionId)).state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
      });
    },
    BARRIER_TEST_TIMEOUT_MS
  );

  it(
    'M1 control: the same sweep still moves a CSV session’s staged rows into interrupted_upload failures',
    async () => {
      await startSessionWithFileId(M1_CSV.SESSION, M1_CSV.FILE);
      await seedStagedRows(scope, M1_CSV.FILE, CSV_BATCH_ID, M1_CSV.SESSION, CSV_ROW_COUNT);

      const { sweep } = await sweepAsTheDeleteRouteDoes(M1_CSV.SESSION);

      const staged = await countStagedRowsOfSession(M1_CSV.SESSION);
      const movedFailureRows = await countFamilyFailureRows(connection, M1_CSV.FILE, CSV_BATCH_ID, scope.censusID);
      console.log(`[M1 control] sweep=${JSON.stringify(sweep)} staged=${staged} movedFailureRows=${movedFailureRows}`);
      expect(sweep).toEqual({ temporaryDeleted: CSV_ROW_COUNT, failedDeleted: CSV_ROW_COUNT });
      expect(staged).toBe(NO_ROWS);
      expect(movedFailureRows).toBe(CSV_ROW_COUNT);
      expect(await readSessionState(M1_CSV.SESSION)).toBe(UploadSessionState.CLEANED_UP);
    },
    BARRIER_TEST_TIMEOUT_MS
  );

  it('L1: the DELETE route’s abandon leaves a `failed` session `failed` and abandons an active one', async () => {
    await insertFailedSession(L1_SESSIONS.FAILED);
    const failedPredecessorAbandoned = await abandonActiveSession(scope.schema, L1_SESSIONS.FAILED, ROUTE_CANCEL_MESSAGE);
    await startSessionWithFileId(L1_SESSIONS.ACTIVE, L1_SESSIONS.ACTIVE);
    const activeAbandoned = await abandonActiveSession(scope.schema, L1_SESSIONS.ACTIVE, ROUTE_CANCEL_MESSAGE);
    const failedState = await readSessionState(L1_SESSIONS.FAILED);
    const activeState = await readSessionState(L1_SESSIONS.ACTIVE);
    console.log(
      `[L1] failed predecessor: abandoned=${failedPredecessorAbandoned} state=${failedState}; active: abandoned=${activeAbandoned} state=${activeState}`
    );
    expect(failedPredecessorAbandoned).toBe(false);
    expect(failedState).toBe(UploadSessionState.FAILED);
    expect(activeAbandoned).toBe(true);
    expect(activeState).toBe(UploadSessionState.ABANDONED);
  });

  async function replayOldSweepPairSelect(sessionID: string): Promise<Array<{ fileId: string; batchId: string }>> {
    const pairs = await realManager.executeQuery(
      `SELECT DISTINCT FileID, BatchID FROM ${scope.schema}.temporarymeasurements WHERE SessionID = ? ORDER BY FileID, BatchID`,
      [sessionID]
    );
    return (pairs as Array<{ FileID: string; BatchID: string }>).map(pair => ({ fileId: pair.FileID, batchId: pair.BatchID }));
  }

  async function replayOldSweepMoves(pairs: Array<{ fileId: string; batchId: string }>): Promise<number> {
    return realManager.withTransaction(async tx => {
      let movedRows = 0;
      for (const { fileId, batchId } of pairs) {
        movedRows += await moveTemporaryBatchToFailedMeasurements(
          realManager,
          scope.schema,
          fileId,
          batchId,
          OLD_SWEEP_REASON,
          INTERRUPTED_UPLOAD_FAILURE_KIND,
          tx.id
        );
      }
      return movedRows;
    });
  }

  it(
    'AI20: an old-sweep move that lands on the takeover’s rows before finalize’s counts is caught at finalize, and the retry rebuilds (recovery for moves before F’s counts only)',
    async () => {
      await startSessionWithFileId(AI20.SESSION_FIRST, AI20.SESSION_FIRST);
      const seeded = await seedArcgisImport(scope, AI20.FILE, LARGE_IMPORT_ROW_COUNT, AI20.TAG_PREFIX);
      const harness = installBarrierHarness(realManager);
      await runBarrierScenario(harness, async () => {
        await failFirstAttemptAfterWindowOne(harness, seeded, AI20.SESSION_FIRST);
        await abandonLongAgo(AI20.SESSION_FIRST);

        const pairsSelectedWithoutLock = await replayOldSweepPairSelect(AI20.SESSION_FIRST);
        console.log(`[AI20] old sweep selected ${JSON.stringify(pairsSelectedWithoutLock)} for ${AI20.SESSION_FIRST} with no session lock, then paused`);
        expect(pairsSelectedWithoutLock.length).toBeGreaterThan(0);

        await startSessionWithFileId(AI20.SESSION_TAKEOVER, AI20.SESSION_TAKEOVER);
        const takeoverParkedBeforeFinalize = harness.placeBarrier({
          pattern: ARCGIS_COMMIT_STATEMENT.IMPORT_ROW_UNIT_LOCK,
          placement: 'before',
          when: () => harness.recordedStatements.some(statement => isCursorAdvanceTo(statement, seeded.rowCount))
        });
        const takeover = harness.track(commitImport(seeded, AI20.SESSION_TAKEOVER));
        await withinDeadline(takeoverParkedBeforeFinalize.reached, 'takeover parked before F', harness.renderStatementLog);
        const stagedByTakeover = await countStagedRowsOfSession(AI20.SESSION_TAKEOVER);
        console.log(`[AI20] takeover parked before F with ${stagedByTakeover} rows staged under ${AI20.SESSION_TAKEOVER}`);
        expect(stagedByTakeover).toBe(LARGE_IMPORT_ROW_COUNT);

        const movedRows = await replayOldSweepMoves(pairsSelectedWithoutLock);
        const stagedAfterMove = await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID);
        console.log(`[AI20] old sweep resumed and moved ${movedRows} rows of the takeover; staged now ${stagedAfterMove}`);
        expect(movedRows, 'the replayed sweep takes the takeover’s rows, not only its own').toBeGreaterThan(0);
        expect(stagedAfterMove).toBe(LARGE_IMPORT_ROW_COUNT - movedRows);

        takeoverParkedBeforeFinalize.release();
        const takeoverOutcome = await withinDeadline(
          Promise.allSettled([takeover]).then(([settled]) => settled),
          'takeover to settle at F',
          harness.renderStatementLog
        );
        console.log(`[AI20] takeover outcome: ${takeoverOutcome.status} ${takeoverOutcome.status === 'rejected' ? String(takeoverOutcome.reason) : ''}`);
        expect(takeoverOutcome.status).toBe('rejected');
        if (takeoverOutcome.status !== 'rejected') return;
        expect(takeoverOutcome.reason).toBeInstanceOf(ArcgisCommitVerificationError);
        expect((takeoverOutcome.reason as ArcgisCommitVerificationError).detail).toEqual({
          importSessionId: seeded.importSessionId,
          expectedStagedRows: LARGE_IMPORT_ROW_COUNT,
          foundStagedRows: LARGE_IMPORT_ROW_COUNT - movedRows,
          expectedFailureRows: NO_ROWS,
          foundFailureRows: movedRows
        });
        const importRowAfterCatch = await readImportRow(connection, seeded.importSessionId);
        console.log(`[AI20] after F refused: import state=${importRowAfterCatch.state}`);
        expect(importRowAfterCatch.state, 'F wrote nothing: the import is still committing').toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTING);

        await startSessionWithFileId(AI20.SESSION_RETRY, AI20.SESSION_RETRY);
        const retryResult = await withinDeadline(commitImport(seeded, AI20.SESSION_RETRY), 'retry under a third session', harness.renderStatementLog);
        const staged = await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID);
        const failureRows = await countFamilyFailureRows(connection, seeded.fileName, seeded.batchID, scope.censusID);
        console.log(`[AI20] retry=${JSON.stringify(retryResult)} staged=${staged} familyFailureRows=${failureRows}`);
        expect(retryResult).toEqual({ rowCount: LARGE_IMPORT_ROW_COUNT, fileName: seeded.fileName, alreadyCommitted: false, batchID: seeded.batchID });
        expect(staged).toBe(LARGE_IMPORT_ROW_COUNT);
        expect(failureRows).toBe(NO_ROWS);
        expect((await readImportRow(connection, seeded.importSessionId)).state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
      });
    },
    BARRIER_TEST_TIMEOUT_MS
  );
});
