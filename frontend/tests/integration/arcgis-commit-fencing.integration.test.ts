/**
 * ArcGIS resumable commit (#561) — upload-session fencing under real concurrency, on the REAL ConnectionManager.
 *
 * AI8 (overlap): two imports under one upload session cannot commit at once; the second claim waits on the
 *   session row while the first holds it, then reads the first as `committing` and is refused with 409.
 * AI10: an attempt parked before a census-replacement window whose upload session is then abandoned deletes nothing.
 * AI17(a): two imports of one file name in two censuses, sent the same caller batch, each commit under its own
 *   derived batch family.
 *
 * Nothing in this file mocks '@/lib/db/connectionmanager'. Import sessions are seeded through the product function
 * BEFORE the barrier harness is installed; plain-SQL seeds and state changes use the separate setup connection.
 *
 * Prerequisites: docker compose up -d mysql
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { createAdditionalCensus, setupTestDatabase, teardownTestDatabase, type TestDatabaseConfig, type TestData } from '../setup/local-db-setup';
import { ARCGIS_COMMIT_STATEMENT, WRITE_STATEMENT } from '../setup/arcgis-commit-statement-patterns';
import { CENSUS_REPLACEMENT_STATEMENT } from '../setup/census-replacement-statement-patterns';
import {
  BARRIER_TEST_TIMEOUT_MS,
  installBarrierHarness,
  runBarrierScenario,
  waitForLockWait,
  withinDeadline,
  type BarrierHarness
} from '../setup/arcgis-commit-barrier-harness';
import {
  ARCGIS_TEST_USER,
  countCensusRowsOutsideFamily,
  countStagedFamilyRows,
  dropStagingTupleWithTreeTag,
  readImportRow,
  seedArcgisImport,
  seedPriorCensusRows,
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
import { commitArcgisImport, type CommitArcgisImportParams } from '@/lib/uploads/arcgis-commit';
import { ARCGIS_IMPORT_SESSION_STATE, ArcgisImportSessionError } from '@/lib/arcgis/import-session';
import { UploadSessionOwnershipError, UploadSessionState } from '@/config/uploadsessiontracker';
import { UploadMode } from '@/config/uploadmodes';
import { HTTPResponses } from '@/config/macros';
import { ensureTemporaryMeasurementsSourceFormatColumn } from '@/lib/ingestion/temporary-measurements';
import { CENSUS_REPLACEMENT_MARKER_COLUMN, ensureUploadSessionReplacementMarkerColumn } from '@/lib/uploads/upload-session-replacement-marker';
import { deriveArcgisCommitBatchID, familyRootOf } from '@/lib/uploads/batch-family';

const SETUP_TIMEOUT_MS = 120_000;
const CONTROL_CENSUS_NUMBER = 93;
const CONTROL_CENSUS_START = '2021-01-01';
const CONTROL_CENSUS_END = '2021-12-31';
const SECOND_USER = 'arcgis-commit-second@example.com';
const SECOND_PRIOR_BATCH = 'prior-b561-ctl';
const DROPPED_ROW_COUNT = 1;
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

const AI8 = {
  UPLOAD_SESSION: 'ai8-upload-session',
  FIRST_FILE: 'ai8-first.xlsx',
  FIRST_TAG_PREFIX: 'ai8a-',
  FIRST_ROW_COUNT: 12,
  SECOND_FILE: 'ai8-second.xlsx',
  SECOND_TAG_PREFIX: 'ai8b-',
  SECOND_ROW_COUNT: 8,
  PRIOR_ROW_COUNT: 30,
  GUARDS_BEFORE_FINALIZE: 4
} as const;

const AI10 = {
  UPLOAD_SESSION: 'ai10-upload-session',
  FILE: 'ai10.xlsx',
  TAG_PREFIX: 'ai10-',
  ROW_COUNT: 12,
  PRIOR_ROW_COUNT: 25,
  GUARDS_BEFORE_REPLACEMENT_WINDOW: 4
} as const;

const AI17 = {
  FIRST_UPLOAD_SESSION: 'ai17-upload-session-first',
  SECOND_UPLOAD_SESSION: 'ai17-upload-session-second',
  FILE: 'ai17.xlsx',
  FIRST_TAG_PREFIX: 'ai17a-',
  SECOND_TAG_PREFIX: 'ai17b-',
  ROW_COUNT: 6,
  PRIOR_ROW_COUNT: 5,
  SHARED_CALLER_BATCH: 'caller-batch-x',
  DROPPED_ROW_ORDINAL: 0
} as const;

function isCursorAdvanceTo(statement: { sql: string; params: unknown[] }, toRowIndex: number): boolean {
  return ARCGIS_COMMIT_STATEMENT.CURSOR_CAS.test(statement.sql) && statement.params[0] === toRowIndex;
}

describe('ArcGIS resumable commit fencing on the real ConnectionManager (#561)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;
  let scope: ArcgisImportScope;
  let controlScope: ArcgisImportScope;
  let realManager: ConnectionManager;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    realManager = ConnectionManager.getInstance();
    const controlCensus = await createAdditionalCensus(connection, testData, {
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
    controlScope = { ...base, censusID: controlCensus.censusID };
    await ensureTemporaryMeasurementsSourceFormatColumn(realManager, scope.schema);
    await ensureUploadSessionReplacementMarkerColumn(realManager, scope.schema, CENSUS_REPLACEMENT_MARKER_COLUMN);
    console.log(`[fencing setup] schema=${scope.schema} plot=${scope.plotID} census=${scope.censusID} controlCensus=${controlScope.censusID}`);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await realManager.closeConnection();
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await connection.query('SELECT RELEASE_ALL_LOCKS()');
    for (const table of SUITE_TABLES) await connection.query(`DELETE FROM ${table}`);
  });

  function commitParams(
    importScope: ArcgisImportScope,
    seeded: SeededArcgisImport,
    uploadMode: UploadMode,
    uploadSessionID: string,
    userId: string,
    batchID?: string
  ): CommitArcgisImportParams {
    return {
      schema: importScope.schema,
      plotID: importScope.plotID,
      censusID: importScope.censusID,
      importSessionId: seeded.importSessionId,
      fileName: seeded.fileName,
      batchID,
      uploadMode,
      userId,
      uploadSessionID
    };
  }

  async function settle<T>(promise: Promise<T>, label: string, harness: BarrierHarness): Promise<PromiseSettledResult<T>> {
    const [settled] = await withinDeadline(Promise.allSettled([promise]), label, harness.renderStatementLog);
    return settled;
  }

  async function describeImportRow(label: string, seeded: SeededArcgisImport): Promise<Record<string, unknown>> {
    const row = await readImportRow(connection, seeded.importSessionId);
    const snapshot = {
      state: row.state,
      stagingNextRowIndex: Number(row.staging_next_row_index),
      committedRowCount: Number(row.committed_row_count ?? 0),
      commitAttemptId: row.commit_attempt_id,
      committedBatchId: row.committed_batch_id,
      committedUploadSessionId: row.committed_upload_session_id,
      marker: row.census_replacement_completed_at
    };
    console.log(`[${label}] import ${seeded.importSessionId}: ${JSON.stringify(snapshot)}`);
    return snapshot;
  }

  it(
    'AI8 overlap: a second import under the same upload session waits on the session row while the first holds it, then is refused 409; the first finishes untouched and the second then commits',
    async () => {
      await seedPriorCensusRows(connection, scope, AI8.PRIOR_ROW_COUNT);
      await startActiveUploadSession(connection, scope, AI8.UPLOAD_SESSION);
      const first = await seedArcgisImport(scope, AI8.FIRST_FILE, AI8.FIRST_ROW_COUNT, AI8.FIRST_TAG_PREFIX, ARCGIS_TEST_USER);
      const second = await seedArcgisImport(scope, AI8.SECOND_FILE, AI8.SECOND_ROW_COUNT, AI8.SECOND_TAG_PREFIX, SECOND_USER);
      console.log(`[AI8 seed] firstBatch=${first.batchID} secondBatch=${second.batchID} session=${AI8.UPLOAD_SESSION}`);

      const harness = installBarrierHarness(realManager);
      await runBarrierScenario(harness, async () => {
        const heldInsideFirstStagingWindow = harness.placeBarrier({
          pattern: CENSUS_REPLACEMENT_STATEMENT.SESSION_LOCK,
          placement: 'after',
          when: () =>
            harness.countMatches(ARCGIS_COMMIT_STATEMENT.STAGED_CLEAR_DELETE) >= 1 && harness.countMatches(ARCGIS_COMMIT_STATEMENT.FAMILY_ID_SELECT) >= 1
        });
        const heldBeforeFirstFinalize = harness.placeBarrier({
          pattern: ARCGIS_COMMIT_STATEMENT.IMPORT_ROW_UNIT_LOCK,
          placement: 'before',
          when: () => harness.recordedStatements.some(statement => isCursorAdvanceTo(statement, first.rowCount))
        });

        const firstCommit = harness.track(
          commitArcgisImport(realManager, commitParams(scope, first, UploadMode.REVISIONS, AI8.UPLOAD_SESSION, ARCGIS_TEST_USER))
        );
        await withinDeadline(
          heldInsideFirstStagingWindow.reached,
          'first import holding the upload session inside its staging window',
          harness.renderStatementLog
        );
        console.log('[AI8] first import parked after locking the upload session in staging window 1');

        const secondClaim = harness.track(commitArcgisImport(realManager, commitParams(scope, second, UploadMode.REVISIONS, AI8.UPLOAD_SESSION, SECOND_USER)));
        const lockWait = await waitForLockWait(connection, scope.schema, 'upload_sessions', `%${AI8.UPLOAD_SESSION}%`, harness.renderStatementLog);
        console.log(`[AI8] second import's claim is in LOCK WAIT on upload session ${AI8.UPLOAD_SESSION}: thread ${lockWait.threadId} ${lockWait.queryHead}`);

        heldInsideFirstStagingWindow.release();
        await withinDeadline(heldBeforeFirstFinalize.reached, 'first import reaching the guard of its finalize unit', harness.renderStatementLog);
        const guardsIssued = harness.countMatches(ARCGIS_COMMIT_STATEMENT.IMPORT_ROW_UNIT_LOCK);
        console.log(`[AI8] first import parked before the guard of unit ${guardsIssued} (finalize); its staging window committed`);
        expect(guardsIssued, 'clear staged, clear family, one staging window, then finalize').toBe(AI8.GUARDS_BEFORE_FINALIZE);

        const secondOutcome = await settle(secondClaim, 'second import claim to be refused', harness);
        console.log(`[AI8] second import outcome: ${secondOutcome.status} ${secondOutcome.status === 'rejected' ? String(secondOutcome.reason) : ''}`);
        expect(secondOutcome.status).toBe('rejected');
        if (secondOutcome.status !== 'rejected') return;
        expect(secondOutcome.reason).toBeInstanceOf(ArcgisImportSessionError);
        expect((secondOutcome.reason as ArcgisImportSessionError).status).toBe(HTTPResponses.CONFLICT);
        expect((secondOutcome.reason as ArcgisImportSessionError).message).toContain(first.importSessionId);

        const firstRow = await describeImportRow('AI8 first, parked', first);
        const secondRow = await describeImportRow('AI8 second, refused', second);
        const firstStagedWhileParked = await countStagedFamilyRows(connection, first.fileName, first.batchID);
        const secondStagedWhileParked = await countStagedFamilyRows(connection, second.fileName, second.batchID);
        const priorRowsWhileParked = await countCensusRowsOutsideFamily(connection, scope.censusID, first.batchID);
        console.log(
          `[AI8] while parked: firstStaged=${firstStagedWhileParked} secondStaged=${secondStagedWhileParked} priorCensusRows=${priorRowsWhileParked}`
        );
        expect(firstRow.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTING);
        expect(firstRow.stagingNextRowIndex).toBe(first.rowCount);
        expect(firstStagedWhileParked).toBe(first.rowCount);
        expect(secondRow.state).toBe(ARCGIS_IMPORT_SESSION_STATE.PREFLIGHT);
        expect(secondRow.commitAttemptId).toBeNull();
        expect(secondRow.committedBatchId).toBeNull();
        expect(secondStagedWhileParked).toBe(0);
        expect(priorRowsWhileParked, 'the refused claim must leave the census alone').toBe(AI8.PRIOR_ROW_COUNT);

        heldBeforeFirstFinalize.release();
        const firstResult = await withinDeadline(firstCommit, 'first import to finish', harness.renderStatementLog);
        console.log(`[AI8] first import result: ${JSON.stringify(firstResult)}`);
        expect(firstResult).toEqual({ rowCount: first.rowCount, fileName: first.fileName, alreadyCommitted: false, batchID: first.batchID });

        const secondResult = await withinDeadline(
          harness.track(commitArcgisImport(realManager, commitParams(scope, second, UploadMode.REVISIONS, AI8.UPLOAD_SESSION, SECOND_USER))),
          'second import to commit once the first has finished',
          harness.renderStatementLog
        );
        console.log(`[AI8] second import result after the first finished: ${JSON.stringify(secondResult)}`);
        expect(secondResult).toEqual({ rowCount: second.rowCount, fileName: second.fileName, alreadyCommitted: false, batchID: second.batchID });

        expect((await describeImportRow('AI8 first, done', first)).state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
        expect((await describeImportRow('AI8 second, done', second)).state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
        expect(await countStagedFamilyRows(connection, first.fileName, first.batchID)).toBe(first.rowCount);
        expect(await countStagedFamilyRows(connection, second.fileName, second.batchID)).toBe(second.rowCount);
      });
    },
    BARRIER_TEST_TIMEOUT_MS
  );

  it(
    'AI10: an attempt parked before its first census-replacement window deletes nothing once its upload session is abandoned',
    async () => {
      await seedPriorCensusRows(connection, scope, AI10.PRIOR_ROW_COUNT);
      await startActiveUploadSession(connection, scope, AI10.UPLOAD_SESSION);
      const seeded = await seedArcgisImport(scope, AI10.FILE, AI10.ROW_COUNT, AI10.TAG_PREFIX);
      console.log(`[AI10 seed] import=${seeded.importSessionId} batch=${seeded.batchID} priorRows=${AI10.PRIOR_ROW_COUNT}`);

      const harness = installBarrierHarness(realManager);
      await runBarrierScenario(harness, async () => {
        const heldBeforeFirstReplacementGuard = harness.placeBarrier({
          pattern: ARCGIS_COMMIT_STATEMENT.IMPORT_ROW_UNIT_LOCK,
          placement: 'before',
          when: () => harness.recordedStatements.some(statement => isCursorAdvanceTo(statement, seeded.rowCount))
        });
        const commit = harness.track(
          commitArcgisImport(realManager, commitParams(scope, seeded, UploadMode.CLEAN_REUPLOAD, AI10.UPLOAD_SESSION, ARCGIS_TEST_USER))
        );
        await withinDeadline(heldBeforeFirstReplacementGuard.reached, 'attempt reaching the guard of its first replacement window', harness.renderStatementLog);

        const guardsIssued = harness.countMatches(ARCGIS_COMMIT_STATEMENT.IMPORT_ROW_UNIT_LOCK);
        const statementsAtBarrier = harness.recordedStatements.length;
        const deletesBeforeBarrier = harness.countMatches(CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_DELETE);
        console.log(`[AI10] parked before guard ${guardsIssued}; statements so far=${statementsAtBarrier}; census deletes so far=${deletesBeforeBarrier}`);
        expect(guardsIssued, 'clear staged, clear family, one staging window, then the first replacement window').toBe(AI10.GUARDS_BEFORE_REPLACEMENT_WINDOW);
        expect(deletesBeforeBarrier, 'the replacement must not have deleted anything yet').toBe(0);

        await setUploadSessionState(connection, AI10.UPLOAD_SESSION, UploadSessionState.ABANDONED);
        heldBeforeFirstReplacementGuard.release();

        const outcome = await settle(commit, 'attempt to be refused after its upload session was abandoned', harness);
        console.log(
          `[AI10] outcome: ${outcome.status} ${outcome.status === 'rejected' ? `${(outcome.reason as Error).name}: ${(outcome.reason as Error).message}` : ''}`
        );
        expect(outcome.status).toBe('rejected');
        if (outcome.status !== 'rejected') return;
        expect(outcome.reason).toBeInstanceOf(UploadSessionOwnershipError);

        const statementsAfterBarrier = harness.recordedStatements.slice(statementsAtBarrier - 1);
        const censusDeletesAfterBarrier = statementsAfterBarrier.filter(statement => CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_DELETE.test(statement.sql));
        const writesAfterBarrier = statementsAfterBarrier.filter(statement => WRITE_STATEMENT.test(statement.sql));
        console.log(
          `[AI10] after the barrier: ${statementsAfterBarrier.length} statements, ${censusDeletesAfterBarrier.length} census deletes, ${writesAfterBarrier.length} writes`
        );
        expect(censusDeletesAfterBarrier, 'no coremeasurements delete may follow the refusal').toHaveLength(0);
        expect(writesAfterBarrier, 'a refused unit writes nothing').toHaveLength(0);

        const priorRowsLeft = await countCensusRowsOutsideFamily(connection, scope.censusID, seeded.batchID);
        const importRow = await describeImportRow('AI10 after refusal', seeded);
        expect(priorRowsLeft).toBe(AI10.PRIOR_ROW_COUNT);
        expect(importRow.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTING);
        expect(importRow.marker).toBeNull();
        expect(await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID)).toBe(seeded.rowCount);
      });
    },
    BARRIER_TEST_TIMEOUT_MS
  );

  it(
    'AI17(a): two imports of one file name in two censuses, sent the same caller batch, claim and commit under their own derived batch families',
    async () => {
      await seedPriorCensusRows(connection, scope, AI17.PRIOR_ROW_COUNT);
      await seedPriorCensusRows(connection, controlScope, AI17.PRIOR_ROW_COUNT, SECOND_PRIOR_BATCH);
      await startActiveUploadSession(connection, scope, AI17.FIRST_UPLOAD_SESSION);
      await startActiveUploadSession(connection, controlScope, AI17.SECOND_UPLOAD_SESSION);
      const first = await seedArcgisImport(scope, AI17.FILE, AI17.ROW_COUNT, AI17.FIRST_TAG_PREFIX);
      const second = await seedArcgisImport(controlScope, AI17.FILE, AI17.ROW_COUNT, AI17.SECOND_TAG_PREFIX);
      console.log(
        `[AI17 seed] callerBatch=${AI17.SHARED_CALLER_BATCH} firstDerived=${first.batchID} (census ${scope.censusID}) secondDerived=${second.batchID} (census ${controlScope.censusID})`
      );
      expect(first.batchID).not.toBe(second.batchID);
      expect(first.batchID).toBe(deriveArcgisCommitBatchID(first.importSessionId));

      const droppedFirstTag = `${AI17.FIRST_TAG_PREFIX}${AI17.DROPPED_ROW_ORDINAL}`;
      const droppedSecondTag = `${AI17.SECOND_TAG_PREFIX}${AI17.DROPPED_ROW_ORDINAL}`;
      const harness = installBarrierHarness(realManager);
      harness.rewriteStatements(
        statement =>
          dropStagingTupleWithTreeTag(statement.sql, statement.params, droppedFirstTag) ??
          dropStagingTupleWithTreeTag(statement.sql, statement.params, droppedSecondTag)
      );
      await runBarrierScenario(harness, async () => {
        const heldFirstClaim = harness.placeBarrier({
          pattern: ARCGIS_COMMIT_STATEMENT.CLAIM_UPDATE,
          placement: 'before',
          when: statement => statement.params.includes(first.importSessionId)
        });
        const heldSecondClaim = harness.placeBarrier({
          pattern: ARCGIS_COMMIT_STATEMENT.CLAIM_UPDATE,
          placement: 'before',
          when: statement => statement.params.includes(second.importSessionId)
        });

        const firstCommit = harness.track(
          commitArcgisImport(
            realManager,
            commitParams(scope, first, UploadMode.CLEAN_REUPLOAD, AI17.FIRST_UPLOAD_SESSION, ARCGIS_TEST_USER, AI17.SHARED_CALLER_BATCH)
          )
        );
        const secondCommit = harness.track(
          commitArcgisImport(
            realManager,
            commitParams(controlScope, second, UploadMode.CLEAN_REUPLOAD, AI17.SECOND_UPLOAD_SESSION, ARCGIS_TEST_USER, AI17.SHARED_CALLER_BATCH)
          )
        );
        await withinDeadline(
          Promise.all([heldFirstClaim.reached, heldSecondClaim.reached]),
          'both claims reaching their CLAIM_UPDATE',
          harness.renderStatementLog
        );
        const firstBeforeClaim = await describeImportRow('AI17 first, before its claim write', first);
        const secondBeforeClaim = await describeImportRow('AI17 second, before its claim write', second);
        expect(firstBeforeClaim.state).toBe(ARCGIS_IMPORT_SESSION_STATE.PREFLIGHT);
        expect(secondBeforeClaim.state).toBe(ARCGIS_IMPORT_SESSION_STATE.PREFLIGHT);

        heldFirstClaim.release();
        heldSecondClaim.release();
        const firstResult = await withinDeadline(firstCommit, 'first import to commit', harness.renderStatementLog);
        const secondResult = await withinDeadline(secondCommit, 'second import to commit', harness.renderStatementLog);
        console.log(`[AI17] results: first=${JSON.stringify(firstResult)} second=${JSON.stringify(secondResult)}`);
        expect(firstResult.batchID).toBe(first.batchID);
        expect(secondResult.batchID).toBe(second.batchID);

        const firstRow = await describeImportRow('AI17 first, done', first);
        const secondRow = await describeImportRow('AI17 second, done', second);
        expect(firstRow.committedBatchId).toBe(first.batchID);
        expect(secondRow.committedBatchId).toBe(second.batchID);
        expect(firstRow.committedBatchId).not.toBe(AI17.SHARED_CALLER_BATCH);
        expect(secondRow.committedBatchId).not.toBe(AI17.SHARED_CALLER_BATCH);
        expect(firstRow.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
        expect(secondRow.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);

        const [stagedRows] = await connection.query<RowDataPacket[]>(
          `SELECT DISTINCT CensusID, BatchID FROM temporarymeasurements WHERE FileID = ? ORDER BY CensusID`,
          [AI17.FILE]
        );
        const [failureRows] = await connection.query<RowDataPacket[]>(
          `SELECT CensusID, UploadBatchID FROM coremeasurements WHERE UploadFileID = ? ORDER BY CensusID`,
          [AI17.FILE]
        );
        const stagedFamiliesByCensus = stagedRows.map(row => `${row.CensusID}:${familyRootOf(row.BatchID)}`);
        const failureFamiliesByCensus = failureRows.map(row => `${row.CensusID}:${row.UploadBatchID}`);
        console.log(`[AI17] staged families by census: ${[...new Set(stagedFamiliesByCensus)].join(', ')}`);
        console.log(`[AI17] failure rows by census: ${failureFamiliesByCensus.join(', ')}`);
        expect([...new Set(stagedFamiliesByCensus)]).toEqual([`${scope.censusID}:${first.batchID}`, `${controlScope.censusID}:${second.batchID}`]);
        expect(failureFamiliesByCensus, 'each census holds exactly the one row dropped from its own import').toEqual([
          `${scope.censusID}:${first.batchID}`,
          `${controlScope.censusID}:${second.batchID}`
        ]);
        expect(await countStagedFamilyRows(connection, AI17.FILE, first.batchID)).toBe(AI17.ROW_COUNT - DROPPED_ROW_COUNT);
        expect(await countStagedFamilyRows(connection, AI17.FILE, second.batchID)).toBe(AI17.ROW_COUNT - DROPPED_ROW_COUNT);
        expect(await countCensusRowsOutsideFamily(connection, scope.censusID, first.batchID), 'the first census replaced its prior rows').toBe(0);
        expect(await countCensusRowsOutsideFamily(connection, controlScope.censusID, second.batchID), 'the second census replaced its prior rows').toBe(0);
      });
    },
    BARRIER_TEST_TIMEOUT_MS
  );
});
