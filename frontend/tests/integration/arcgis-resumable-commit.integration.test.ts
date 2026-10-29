/**
 * ArcGIS resumable commit (#561) — the reference sequence against real MySQL.
 *
 * AI1 runs one CLEAN_REUPLOAD commit of a 10,007-row import over a census holding 2,500 prior rows and proves the
 * spec's 14 separately committed transactions, one by one, by the transaction ids the single-connection manager
 * mock hands out, and the exact end state they leave behind.
 *
 * AI2-AI4 inject one failure each (after, inside and before the census replacement) and prove that a retry restarts
 * from the durable import rows and finishes with no double staging and no double audit.
 *
 * Prerequisites: docker compose up -d mysql
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { createAdditionalCensus, setupTestDatabase, teardownTestDatabase, type TestDatabaseConfig, type TestData } from '../setup/local-db-setup';
import type { SingleConnectionState } from '../setup/single-connection-manager-mock';
import { resetSingleConnectionState } from '../setup/single-connection-manager-mock';
import { ARCGIS_COMMIT_STATEMENT } from '../setup/arcgis-commit-statement-patterns';
import { CENSUS_REPLACEMENT_STATEMENT } from '../setup/census-replacement-statement-patterns';
import {
  ARCGIS_TEST_USER,
  countCensusRowsOutsideFamily,
  countFamilyFailureRows,
  countScopeMetrics,
  countStagedFamilyRows,
  deleteAuditRows,
  fileUploadChangelogRows,
  groupStatementsByTransaction,
  readImportRow,
  seedArcgisImport,
  seedPriorCensusRows,
  seedScopeMetrics,
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

const connectionState = vi.hoisted(
  () =>
    ({
      connection: null,
      activeTransactionID: null,
      transactionCounter: 0,
      statements: [],
      transactionOutcomes: new Map(),
      failOn: null,
      rewrite: null,
      parkedStarts: [],
      heldLocks: new Set()
    }) as import('../setup/single-connection-manager-mock').SingleConnectionState
);
vi.mock('@/lib/db/connectionmanager', async () =>
  (await import('../setup/single-connection-manager-mock')).buildSingleConnectionManagerModule(connectionState as SingleConnectionState)
);
const loggedInfo = vi.hoisted(() => vi.fn());
vi.mock('@/ailogger', () => ({ default: { info: loggedInfo, warn: () => undefined, error: () => undefined } }));

import ConnectionManager from '@/lib/db/connectionmanager';
import { ARCGIS_COMMIT_COMPLETED_EVENT, ARCGIS_STAGING_WINDOW_ROWS, commitArcgisImport } from '@/lib/uploads/arcgis-commit';
import { ARCGIS_IMPORT_SESSION_STATE } from '@/lib/arcgis/import-session';
import { UploadMode } from '@/config/uploadmodes';
import { UploadSessionState } from '@/config/uploadsessiontracker';
import { CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE } from '@/lib/ingestion/temporary-measurements';
import { buildFileUploadChangelogRecordID } from '@/lib/uploads/file-names';
import { buildSubBatchPattern, LIKE_ESCAPE_CLAUSE } from '@/lib/uploads/batch-family';

const PRIOR_ROW_COUNT = 2_500;
const PRIOR_METRIC_COUNT = 3;
const CONTROL_ROW_COUNT = 40;
const CONTROL_METRIC_COUNT = 2;
const CONTROL_BATCH = 'control-batch-561';
const CONTROL_CENSUS_NUMBER = 93;
const CONTROL_CENSUS_START = '2021-01-01';
const CONTROL_CENSUS_END = '2021-12-31';
const IMPORT_ROW_COUNT = 2 * ARCGIS_STAGING_WINDOW_ROWS + 7;
const UPLOAD_SESSION = 'ai1-upload-session';
const IMPORT_FILE = 'reference.xlsx';
const IMPORT_TAG_PREFIX = 'ai1-';
const INJECTED_FAILURE_MESSAGE = 'injected failure (#561 AI2-AI4)';
const FIRST_STATEMENT_ORDINAL = 1;
const SECOND_STATEMENT_ORDINAL = 2;
const FAILED_FIRST_ATTEMPT_SESSION = 'ai2-first-attempt-session';
const RETRY_UPLOAD_SESSION = 'ai2-retry-session';
const AI2_FILE = 'ai2-after-replacement.xlsx';
const AI2_TAG_PREFIX = 'ai2-';
const AI3_SESSION = 'ai3-upload-session';
const AI3_FILE = 'ai3-inside-replacement.xlsx';
const AI3_TAG_PREFIX = 'ai3-';
const AI4_SESSION = 'ai4-upload-session';
const AI4_FILE = 'ai4-before-replacement.xlsx';
const AI4_TAG_PREFIX = 'ai4-';
const AI4_SECOND_WINDOW_FIRST_TAG = `${AI4_TAG_PREFIX}${ARCGIS_STAGING_WINDOW_ROWS}`;
const WINDOWS_COMPLETED_BEFORE_AI4_FAILURE_ROWS = ARCGIS_STAGING_WINDOW_ROWS;
const AI3_ROWS_DELETED_BEFORE_FAILURE = CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE;
const SETUP_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 180_000;
const EXPECTED_MEASUREMENT_WINDOW_DELETES = [CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE, CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE, 500, 0];
const EXPECTED_STAGING_WINDOW_COUNT = Math.ceil(IMPORT_ROW_COUNT / ARCGIS_STAGING_WINDOW_ROWS);

const TRANSACTION_KIND = {
  CLAIM: 'claim',
  CLEAR_STAGED: 'clear_staged',
  CLEAR_FAMILY: 'clear_family',
  STAGING: 'staging',
  MEASUREMENT: 'measurement_window',
  LEGACY: 'legacy',
  METRICS: 'metrics',
  COMPLETION: 'completion',
  FINALIZE: 'finalize',
  UNKNOWN: 'unknown'
} as const;

const EXPECTED_SEQUENCE = [
  TRANSACTION_KIND.CLAIM,
  TRANSACTION_KIND.CLEAR_STAGED,
  TRANSACTION_KIND.CLEAR_FAMILY,
  ...Array(EXPECTED_STAGING_WINDOW_COUNT).fill(TRANSACTION_KIND.STAGING),
  ...EXPECTED_MEASUREMENT_WINDOW_DELETES.map(() => TRANSACTION_KIND.MEASUREMENT),
  TRANSACTION_KIND.LEGACY,
  TRANSACTION_KIND.METRICS,
  TRANSACTION_KIND.COMPLETION,
  TRANSACTION_KIND.FINALIZE
];

function classify(statements: string[]): string {
  if (statements.some(sql => ARCGIS_COMMIT_STATEMENT.CLAIM_UPDATE.test(sql))) return TRANSACTION_KIND.CLAIM;
  if (statements.some(sql => ARCGIS_COMMIT_STATEMENT.STAGED_CLEAR_DELETE.test(sql))) return TRANSACTION_KIND.CLEAR_STAGED;
  if (statements.some(sql => ARCGIS_COMMIT_STATEMENT.FAMILY_ID_SELECT.test(sql))) return TRANSACTION_KIND.CLEAR_FAMILY;
  if (statements.some(sql => ARCGIS_COMMIT_STATEMENT.CURSOR_CAS.test(sql))) return TRANSACTION_KIND.STAGING;
  if (statements.some(sql => CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_ID_SELECT.test(sql))) return TRANSACTION_KIND.MEASUREMENT;
  if (statements.some(sql => CENSUS_REPLACEMENT_STATEMENT.LEGACY_DELETE.test(sql))) return TRANSACTION_KIND.LEGACY;
  if (statements.some(sql => CENSUS_REPLACEMENT_STATEMENT.METRICS_DELETE.test(sql))) return TRANSACTION_KIND.METRICS;
  if (statements.some(sql => ARCGIS_COMMIT_STATEMENT.IMPORT_MARKER_UPDATE.test(sql))) return TRANSACTION_KIND.COMPLETION;
  if (statements.some(sql => ARCGIS_COMMIT_STATEMENT.FINALIZE_UPDATE.test(sql))) return TRANSACTION_KIND.FINALIZE;
  return TRANSACTION_KIND.UNKNOWN;
}

const SUITE_TABLES = [
  'temporarymeasurements',
  'measurement_error_log',
  'coremeasurements',
  'uploadmetrics',
  'unifiedchangelog',
  'arcgis_import_sessions',
  'upload_sessions'
];

describe('the resumable ArcGIS commit on MySQL (#561)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;
  let scope: ArcgisImportScope;
  let controlScope: ArcgisImportScope;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    connectionState.connection = connection;
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
    console.log(`[AI1 setup] schema=${config.database} plot=${scope.plotID} targetCensus=${scope.censusID} controlCensus=${controlScope.censusID}`);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    connectionState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    resetSingleConnectionState(connectionState);
    loggedInfo.mockClear();
    await connection.query('SELECT RELEASE_ALL_LOCKS()');
    for (const table of SUITE_TABLES) await connection.query(`DELETE FROM ${table}`);
  });

  it(
    'AI1: commits in claim, S0, F0, 3 staging windows, 4 replacement windows, legacy, metrics, completion and finalize transactions, each guarded, and leaves the exact end state',
    async () => {
      await seedPriorCensusRows(connection, scope, PRIOR_ROW_COUNT);
      await seedScopeMetrics(connection, scope, PRIOR_METRIC_COUNT);
      await seedPriorCensusRows(connection, controlScope, CONTROL_ROW_COUNT, CONTROL_BATCH);
      await seedScopeMetrics(connection, controlScope, CONTROL_METRIC_COUNT, CONTROL_BATCH);
      await startActiveUploadSession(connection, scope, UPLOAD_SESSION);
      const seeded = await seedArcgisImport(scope, IMPORT_FILE, IMPORT_ROW_COUNT, IMPORT_TAG_PREFIX);

      const seededCensusRows = await countCensusRowsOutsideFamily(connection, scope.censusID, seeded.batchID);
      const seededControlRows = await countCensusRowsOutsideFamily(connection, controlScope.censusID, seeded.batchID);
      const seededMetrics = await countScopeMetrics(connection, scope);
      console.log(
        `[AI1 seed] importSession=${seeded.importSessionId} derivedBatch=${seeded.batchID} priorRows=${seededCensusRows} controlRows=${seededControlRows} priorMetrics=${seededMetrics}`
      );
      expect(seededCensusRows).toBe(PRIOR_ROW_COUNT);
      expect(seededControlRows).toBe(CONTROL_ROW_COUNT);
      expect(seededMetrics).toBe(PRIOR_METRIC_COUNT);

      resetSingleConnectionState(connectionState);
      const result = await commitArcgisImport(ConnectionManager.getInstance(), {
        schema: scope.schema,
        plotID: scope.plotID,
        censusID: scope.censusID,
        importSessionId: seeded.importSessionId,
        fileName: IMPORT_FILE,
        uploadMode: UploadMode.CLEAN_REUPLOAD,
        userId: ARCGIS_TEST_USER,
        uploadSessionID: UPLOAD_SESSION
      });
      console.log(`[AI1 result] ${JSON.stringify(result)}`);

      const transactions = groupStatementsByTransaction(connectionState.statements);
      const kinds = transactions.map(transaction => classify(transaction.statements));
      console.log(`[AI1 sequence] ${transactions.length} transactions: ${kinds.join(', ')}`);
      expect(kinds).toEqual(EXPECTED_SEQUENCE);

      const guardedTransactions = transactions.slice(1);
      for (const transaction of guardedTransactions) {
        const [first = '', second = ''] = transaction.statements;
        console.log(`[AI1 guard] ${transaction.transactionID} opens with: ${first.trim().slice(0, 60)} | ${second.trim().slice(0, 60)}`);
        expect(ARCGIS_COMMIT_STATEMENT.IMPORT_ROW_UNIT_LOCK.test(first), `${transaction.transactionID} must open with the import-row lock`).toBe(true);
        expect(CENSUS_REPLACEMENT_STATEMENT.SESSION_LOCK.test(second), `${transaction.transactionID} must lock the upload session second`).toBe(true);
      }

      const outcomes = transactions.map(transaction => connectionState.transactionOutcomes.get(transaction.transactionID));
      console.log(`[AI1 outcomes] ${outcomes.join(', ')}`);
      expect(outcomes.every(outcome => outcome === 'committed')).toBe(true);

      const measurementWindowDeletes = transactions
        .filter((_, index) => kinds[index] === TRANSACTION_KIND.MEASUREMENT)
        .map(transaction => {
          const deleteStatements = connectionState.statements.filter(
            statement => statement.transactionID === transaction.transactionID && CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_DELETE.test(statement.sql)
          );
          return deleteStatements.reduce((deleted, statement) => deleted + statement.params.length, 0);
        });
      console.log(`[AI1 windows] measurement window deletes=${measurementWindowDeletes.join(',')}`);
      expect(measurementWindowDeletes).toEqual(EXPECTED_MEASUREMENT_WINDOW_DELETES);

      const priorRowsLeft = await countCensusRowsOutsideFamily(connection, scope.censusID, seeded.batchID);
      const controlRowsLeft = await countCensusRowsOutsideFamily(connection, controlScope.censusID, seeded.batchID);
      const deleteAudit = await deleteAuditRows(connection, scope.censusID);
      const metricsLeft = await countScopeMetrics(connection, scope);
      const controlMetricsLeft = await countScopeMetrics(connection, controlScope);
      const stagedRows = await countStagedFamilyRows(connection, IMPORT_FILE, seeded.batchID);
      const familyFailureRows = await countFamilyFailureRows(connection, IMPORT_FILE, seeded.batchID, scope.censusID);
      console.log(
        `[AI1 end state] priorRowsLeft=${priorRowsLeft} controlRowsLeft=${controlRowsLeft} deleteAudit=${JSON.stringify(deleteAudit)} ` +
          `metricsLeft=${metricsLeft} controlMetricsLeft=${controlMetricsLeft} stagedRows=${stagedRows} familyFailureRows=${familyFailureRows}`
      );
      expect(priorRowsLeft).toBe(0);
      expect(controlRowsLeft).toBe(CONTROL_ROW_COUNT);
      expect(deleteAudit).toEqual({ total: PRIOR_ROW_COUNT, distinctRecordIDs: PRIOR_ROW_COUNT });
      expect(metricsLeft).toBe(0);
      expect(controlMetricsLeft).toBe(CONTROL_METRIC_COUNT);
      expect(stagedRows).toBe(IMPORT_ROW_COUNT);
      expect(familyFailureRows).toBe(0);

      const importRow = await readImportRow(connection, seeded.importSessionId);
      console.log(
        `[AI1 import row] state=${importRow.state} committed_row_count=${importRow.committed_row_count} staging_next_row_index=${importRow.staging_next_row_index} ` +
          `marker=${importRow.census_replacement_completed_at} committed_batch_id=${importRow.committed_batch_id}`
      );
      expect(importRow.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
      expect(Number(importRow.committed_row_count)).toBe(IMPORT_ROW_COUNT);
      expect(Number(importRow.staging_next_row_index)).toBe(IMPORT_ROW_COUNT);
      expect(importRow.census_replacement_completed_at).not.toBeNull();
      expect(importRow.committed_batch_id).toBe(seeded.batchID);

      const changelogRows = await fileUploadChangelogRows(connection, scope.censusID, IMPORT_FILE);
      const metadata =
        changelogRows.length === 1
          ? typeof changelogRows[0].NewRowState === 'string'
            ? JSON.parse(changelogRows[0].NewRowState)
            : changelogRows[0].NewRowState
          : null;
      console.log(`[AI1 changelog] rows=${changelogRows.length} recordID=${changelogRows[0]?.RecordID} metadata=${JSON.stringify(metadata)}`);
      expect(changelogRows).toHaveLength(1);
      expect(changelogRows[0].RecordID).toBe(buildFileUploadChangelogRecordID(IMPORT_FILE, UPLOAD_SESSION));
      expect(metadata.rowCount).toBe(IMPORT_ROW_COUNT);
      expect(Object.keys(metadata.chunksByIdentity)).toEqual([seeded.batchID]);
      expect(metadata.chunksByIdentity[seeded.batchID]).toEqual({ rowCount: IMPORT_ROW_COUNT, droppedCount: 0 });

      expect(result).toEqual({ rowCount: IMPORT_ROW_COUNT, fileName: IMPORT_FILE, alreadyCommitted: false, batchID: seeded.batchID });
    },
    TEST_TIMEOUT_MS
  );

  interface AttemptTrace {
    kinds: string[];
    outcomes: Array<string | undefined>;
    statements: Array<{ transactionID: string | null; sql: string; params: unknown[] }>;
  }

  function commitSeededImport(seeded: SeededArcgisImport, uploadSessionID: string) {
    return commitArcgisImport(ConnectionManager.getInstance(), {
      schema: scope.schema,
      plotID: scope.plotID,
      censusID: scope.censusID,
      importSessionId: seeded.importSessionId,
      fileName: seeded.fileName,
      uploadMode: UploadMode.CLEAN_REUPLOAD,
      userId: ARCGIS_TEST_USER,
      uploadSessionID
    });
  }

  /** Throws the injected error INSTEAD of running the `ordinal`-th statement that `matches`; reports how many matches it saw. */
  function injectFailureOnNthMatchingStatement(matches: (sql: string, params: unknown[]) => boolean, ordinal: number): { matchesSeen: () => number } {
    let matchesSeen = 0;
    connectionState.failOn = (sql, params) => {
      if (!matches(sql, params)) return null;
      matchesSeen += 1;
      return matchesSeen === ordinal ? new Error(INJECTED_FAILURE_MESSAGE) : null;
    };
    return { matchesSeen: () => matchesSeen };
  }

  function drainAttemptTrace(label: string): AttemptTrace {
    const transactions = groupStatementsByTransaction(connectionState.statements);
    const kinds = transactions.map(transaction => classify(transaction.statements));
    const outcomes = transactions.map(transaction => connectionState.transactionOutcomes.get(transaction.transactionID));
    console.log(`[${label}] ${transactions.length} transactions: ${kinds.map((kind, index) => `${kind}:${outcomes[index]}`).join(', ')}`);
    const trace = { kinds, outcomes, statements: [...connectionState.statements] };
    connectionState.statements.length = 0;
    connectionState.transactionOutcomes.clear();
    return trace;
  }

  function countOf(kinds: string[], kind: string): number {
    return kinds.filter(candidate => candidate === kind).length;
  }

  async function countDistinctStagedTreeTags(seeded: SeededArcgisImport): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT TreeTag) AS total FROM temporarymeasurements WHERE FileID = ? AND (BatchID = ? OR BatchID LIKE ? ${LIKE_ESCAPE_CLAUSE})`,
      [seeded.fileName, seeded.batchID, buildSubBatchPattern(seeded.batchID)]
    );
    return Number(rows[0].total);
  }

  async function readCensusState(label: string, seeded: SeededArcgisImport) {
    const priorRows = await countCensusRowsOutsideFamily(connection, scope.censusID, seeded.batchID);
    const audits = await deleteAuditRows(connection, scope.censusID);
    const stagedRows = await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID);
    const distinctStagedTags = await countDistinctStagedTreeTags(seeded);
    const importRow = await readImportRow(connection, seeded.importSessionId);
    const fileUploadRows = await fileUploadChangelogRows(connection, scope.censusID, seeded.fileName);
    console.log(
      `[${label}] priorRows=${priorRows} audits=${JSON.stringify(audits)} staged=${stagedRows} distinctStagedTags=${distinctStagedTags} ` +
        `state=${importRow.state} cursor=${importRow.staging_next_row_index} committed_row_count=${importRow.committed_row_count} ` +
        `marker=${importRow.census_replacement_completed_at} fileUploadRows=${fileUploadRows.length}`
    );
    return { priorRows, audits, stagedRows, distinctStagedTags, importRow, fileUploadRows };
  }

  function completedEventPayload(): Record<string, unknown> {
    const call = loggedInfo.mock.calls.find(([event]) => event === ARCGIS_COMMIT_COMPLETED_EVENT);
    if (!call) throw new Error(`no ${ARCGIS_COMMIT_COMPLETED_EVENT} event was logged; events: ${loggedInfo.mock.calls.map(([event]) => event).join(', ')}`);
    return call[1] as Record<string, unknown>;
  }

  async function seedAiScenario(fileName: string, tagPrefix: string, uploadSessionID: string): Promise<SeededArcgisImport> {
    await seedPriorCensusRows(connection, scope, PRIOR_ROW_COUNT);
    await seedScopeMetrics(connection, scope, PRIOR_METRIC_COUNT);
    await startActiveUploadSession(connection, scope, uploadSessionID);
    const seeded = await seedArcgisImport(scope, fileName, IMPORT_ROW_COUNT, tagPrefix);
    resetSingleConnectionState(connectionState);
    return seeded;
  }

  it(
    'AI2: a failure after the census replacement is finished by a retry that clears the leftover staged rows, stages exactly once and audits nothing twice (catches: skipped S0 double-staging, a replacement redone with fresh audits)',
    async () => {
      const seeded = await seedAiScenario(AI2_FILE, AI2_TAG_PREFIX, FAILED_FIRST_ATTEMPT_SESSION);
      const injection = injectFailureOnNthMatchingStatement(sql => ARCGIS_COMMIT_STATEMENT.FILE_UPLOAD_CHANGELOG_INSERT.test(sql), FIRST_STATEMENT_ORDINAL);

      await expect(commitSeededImport(seeded, FAILED_FIRST_ATTEMPT_SESSION)).rejects.toThrow(INJECTED_FAILURE_MESSAGE);
      const firstAttempt = drainAttemptTrace('AI2 attempt 1');
      const afterFailure = await readCensusState('AI2 after attempt 1', seeded);
      expect(injection.matchesSeen(), 'the injected failure must have fired on the file_upload changelog insert').toBe(1);
      expect(firstAttempt.outcomes.at(-1), 'the finalize transaction that failed must have rolled back').toBe('rolled_back');
      expect(afterFailure.priorRows).toBe(0);
      expect(afterFailure.audits).toEqual({ total: PRIOR_ROW_COUNT, distinctRecordIDs: PRIOR_ROW_COUNT });
      expect(afterFailure.importRow.census_replacement_completed_at).not.toBeNull();
      expect(afterFailure.stagedRows).toBe(IMPORT_ROW_COUNT);
      expect(afterFailure.importRow.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTING);
      expect(afterFailure.fileUploadRows).toHaveLength(0);

      await setUploadSessionState(connection, FAILED_FIRST_ATTEMPT_SESSION, UploadSessionState.FAILED);
      await startActiveUploadSession(connection, scope, RETRY_UPLOAD_SESSION);
      connectionState.failOn = null;
      loggedInfo.mockClear();

      const result = await commitSeededImport(seeded, RETRY_UPLOAD_SESSION);
      const retry = drainAttemptTrace('AI2 attempt 2 (retry)');
      const afterRetry = await readCensusState('AI2 after retry', seeded);
      const completed = completedEventPayload();
      console.log(`[AI2 retry result] ${JSON.stringify(result)} completedEvent=${JSON.stringify(completed)}`);

      expect(result).toEqual({ rowCount: IMPORT_ROW_COUNT, fileName: AI2_FILE, alreadyCommitted: false, batchID: seeded.batchID });
      expect(retry.outcomes.every(outcome => outcome === 'committed')).toBe(true);
      expect(retry.kinds[0]).toBe(TRANSACTION_KIND.CLAIM);
      expect(countOf(retry.kinds, TRANSACTION_KIND.CLEAR_STAGED), 'S0 must run again on the retry').toBeGreaterThan(0);
      expect(countOf(retry.kinds, TRANSACTION_KIND.STAGING)).toBe(EXPECTED_STAGING_WINDOW_COUNT);
      expect(
        retry.statements.some(statement => CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_DELETE.test(statement.sql)),
        'the census was already empty, so the replayed replacement must delete nothing'
      ).toBe(false);
      expect(completed.leftoverStagedRowsCleared, 'S0 must delete the whole previous staging').toBe(IMPORT_ROW_COUNT);
      expect(afterRetry.stagedRows, 'staged rows after the retry').toBe(IMPORT_ROW_COUNT);
      expect(afterRetry.distinctStagedTags).toBe(IMPORT_ROW_COUNT);
      expect(afterRetry.audits, 'the replacement must not be audited a second time').toEqual({ total: PRIOR_ROW_COUNT, distinctRecordIDs: PRIOR_ROW_COUNT });
      expect(afterRetry.priorRows).toBe(0);
      expect(afterRetry.importRow.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
      expect(Number(afterRetry.importRow.committed_row_count)).toBe(IMPORT_ROW_COUNT);
      expect(Number(afterRetry.importRow.staging_next_row_index)).toBe(IMPORT_ROW_COUNT);
      expect(afterRetry.fileUploadRows).toHaveLength(1);
      expect(afterRetry.fileUploadRows[0].RecordID).toBe(buildFileUploadChangelogRecordID(AI2_FILE, RETRY_UPLOAD_SESSION));
    },
    TEST_TIMEOUT_MS
  );

  it(
    'AI3: a failure inside the census replacement is resumed by a retry on the same session that deletes only what is left and audits every prior row exactly once (catches: a replacement that restarts from scratch or re-audits deleted rows)',
    async () => {
      const seeded = await seedAiScenario(AI3_FILE, AI3_TAG_PREFIX, AI3_SESSION);
      const injection = injectFailureOnNthMatchingStatement(sql => CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_DELETE.test(sql), SECOND_STATEMENT_ORDINAL);

      await expect(commitSeededImport(seeded, AI3_SESSION)).rejects.toThrow(INJECTED_FAILURE_MESSAGE);
      const firstAttempt = drainAttemptTrace('AI3 attempt 1');
      const afterFailure = await readCensusState('AI3 after attempt 1', seeded);
      expect(injection.matchesSeen(), 'the injected failure must have fired on the second measurement delete').toBe(SECOND_STATEMENT_ORDINAL);
      expect(firstAttempt.outcomes.at(-1)).toBe('rolled_back');
      expect(afterFailure.priorRows, 'only the first window may have been deleted').toBe(PRIOR_ROW_COUNT - AI3_ROWS_DELETED_BEFORE_FAILURE);
      expect(afterFailure.audits).toEqual({ total: AI3_ROWS_DELETED_BEFORE_FAILURE, distinctRecordIDs: AI3_ROWS_DELETED_BEFORE_FAILURE });
      expect(afterFailure.importRow.census_replacement_completed_at, 'the marker is set only when the replacement finishes').toBeNull();
      expect(afterFailure.stagedRows).toBe(IMPORT_ROW_COUNT);

      connectionState.failOn = null;
      loggedInfo.mockClear();
      const result = await commitSeededImport(seeded, AI3_SESSION);
      const retry = drainAttemptTrace('AI3 attempt 2 (retry)');
      const afterRetry = await readCensusState('AI3 after retry', seeded);
      const completed = completedEventPayload();
      console.log(`[AI3 retry result] ${JSON.stringify(result)} completedEvent=${JSON.stringify(completed)}`);

      expect(result).toEqual({ rowCount: IMPORT_ROW_COUNT, fileName: AI3_FILE, alreadyCommitted: false, batchID: seeded.batchID });
      expect(retry.outcomes.every(outcome => outcome === 'committed')).toBe(true);
      expect(completed.leftoverStagedRowsCleared, 'S0 must delete the whole previous staging').toBe(IMPORT_ROW_COUNT);
      expect(afterRetry.stagedRows, 'staged rows after the retry').toBe(IMPORT_ROW_COUNT);
      expect(afterRetry.distinctStagedTags, 'distinct staged tags after the retry').toBe(IMPORT_ROW_COUNT);
      expect(afterRetry.priorRows).toBe(0);
      expect(afterRetry.audits, 'every prior row audited exactly once across both attempts').toEqual({
        total: PRIOR_ROW_COUNT,
        distinctRecordIDs: PRIOR_ROW_COUNT
      });
      expect(afterRetry.importRow.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
      expect(afterRetry.fileUploadRows).toHaveLength(1);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'AI4: a failure inside the second staging window leaves the census whole, and a retry on the same session restarts staging so every row is staged exactly once (catches: a cursor that resumes over the leftover rows, a replacement that runs before staging is complete)',
    async () => {
      const seeded = await seedAiScenario(AI4_FILE, AI4_TAG_PREFIX, AI4_SESSION);
      const injection = injectFailureOnNthMatchingStatement(
        (sql, params) => ARCGIS_COMMIT_STATEMENT.STAGING_INSERT.test(sql) && params.includes(AI4_SECOND_WINDOW_FIRST_TAG),
        FIRST_STATEMENT_ORDINAL
      );

      await expect(commitSeededImport(seeded, AI4_SESSION)).rejects.toThrow(INJECTED_FAILURE_MESSAGE);
      const firstAttempt = drainAttemptTrace('AI4 attempt 1');
      const afterFailure = await readCensusState('AI4 after attempt 1', seeded);
      expect(injection.matchesSeen(), `the injected failure must have fired on the staging insert holding ${AI4_SECOND_WINDOW_FIRST_TAG}`).toBe(1);
      expect(firstAttempt.outcomes.at(-1)).toBe('rolled_back');
      expect(firstAttempt.kinds.includes(TRANSACTION_KIND.MEASUREMENT), 'the census replacement must not have started').toBe(false);
      expect(afterFailure.priorRows, 'the old census must still be whole').toBe(PRIOR_ROW_COUNT);
      expect(afterFailure.audits).toEqual({ total: 0, distinctRecordIDs: 0 });
      expect(afterFailure.stagedRows, 'only the first window is durable').toBe(WINDOWS_COMPLETED_BEFORE_AI4_FAILURE_ROWS);
      expect(Number(afterFailure.importRow.staging_next_row_index)).toBe(WINDOWS_COMPLETED_BEFORE_AI4_FAILURE_ROWS);
      expect(afterFailure.importRow.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTING);

      connectionState.failOn = null;
      loggedInfo.mockClear();
      const result = await commitSeededImport(seeded, AI4_SESSION);
      const retry = drainAttemptTrace('AI4 attempt 2 (retry)');
      const afterRetry = await readCensusState('AI4 after retry', seeded);
      const completed = completedEventPayload();
      console.log(`[AI4 retry result] ${JSON.stringify(result)} completedEvent=${JSON.stringify(completed)}`);

      expect(result).toEqual({ rowCount: IMPORT_ROW_COUNT, fileName: AI4_FILE, alreadyCommitted: false, batchID: seeded.batchID });
      expect(retry.outcomes.every(outcome => outcome === 'committed')).toBe(true);
      expect(completed.leftoverStagedRowsCleared, "S0 must delete the first attempt's durable window").toBe(WINDOWS_COMPLETED_BEFORE_AI4_FAILURE_ROWS);
      expect(countOf(retry.kinds, TRANSACTION_KIND.STAGING), 'the retry restarts staging from row 0').toBe(EXPECTED_STAGING_WINDOW_COUNT);
      expect(afterRetry.stagedRows, 'staged rows after the retry').toBe(IMPORT_ROW_COUNT);
      expect(afterRetry.distinctStagedTags).toBe(IMPORT_ROW_COUNT);
      expect(afterRetry.priorRows).toBe(0);
      expect(afterRetry.audits).toEqual({ total: PRIOR_ROW_COUNT, distinctRecordIDs: PRIOR_ROW_COUNT });
      expect(afterRetry.importRow.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
      expect(Number(afterRetry.importRow.staging_next_row_index)).toBe(IMPORT_ROW_COUNT);
      expect(afterRetry.fileUploadRows).toHaveLength(1);
    },
    TEST_TIMEOUT_MS
  );
});
