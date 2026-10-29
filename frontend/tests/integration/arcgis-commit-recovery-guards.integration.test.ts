/**
 * ArcGIS resumable commit (#561) — the recovery guards, against real MySQL.
 *
 * AI5   a retry survives an intervening upload of another file, and of the same file name
 * AI6   F's verification failure is retryable: it is not an ArcgisImportSessionError and writes nothing
 * AI7   the upload mode is bound to the first claim
 * AI8   one committing import per upload session (sequential half; the overlap half is Task 22's)
 * AI17b F0 deletes the import's own leftover family and nothing that merely looks like it
 *
 * Every test drives the product `commitArcgisImport` through the single-connection manager mock, so each statement is
 * recorded under its transaction id and failures are injected at exact statements.
 *
 * Prerequisites: docker compose up -d mysql
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestDatabaseConfig, type TestData } from '../setup/local-db-setup';
import type { SingleConnectionState } from '../setup/single-connection-manager-mock';
import { parkNextTransactionStart, resetSingleConnectionState, type ParkedTransactionStart } from '../setup/single-connection-manager-mock';
import { ARCGIS_COMMIT_STATEMENT, WRITE_STATEMENT } from '../setup/arcgis-commit-statement-patterns';
import { CENSUS_REPLACEMENT_STATEMENT } from '../setup/census-replacement-statement-patterns';
import {
  ARCGIS_TEST_USER,
  countCensusRowsOutsideFamily,
  countFamilyFailureRows,
  countStagedFamilyRows,
  deleteAuditRows,
  dropStagingTupleWithTreeTag,
  fileUploadChangelogRows,
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
vi.mock('@/ailogger', () => ({ default: { info: () => undefined, warn: () => undefined, error: () => undefined } }));

import ConnectionManager from '@/lib/db/connectionmanager';
import { ARCGIS_STAGING_WINDOW_ROWS, ArcgisCommitVerificationError, commitArcgisImport } from '@/lib/uploads/arcgis-commit';
import { ARCGIS_IMPORT_SESSION_STATE, ArcgisImportSessionError } from '@/lib/arcgis/import-session';
import { replaceCensusForCleanReupload, stageMeasurementChunk, type CensusReplacementParams } from '@/lib/uploads/stage-measurements';
import { CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE } from '@/lib/ingestion/temporary-measurements';
import { UploadMode } from '@/config/uploadmodes';
import { UploadSessionState } from '@/config/uploadsessiontracker';
import { SourceFormat } from '@/config/macros/formdetails';
import { HTTPResponses } from '@/config/macros';
import { generateShortBatchID } from '@/config/utils';

const PRIOR_ROW_COUNT = 2_500;
const IMPORT_ROW_COUNT = 2 * ARCGIS_STAGING_WINDOW_ROWS + 7;
const SMALL_IMPORT_ROW_COUNT = 20;
const DROPPED_TAG_ORDINAL = 3;
const SECOND_WINDOW_FIRST_TAG_ORDINAL = ARCGIS_STAGING_WINDOW_ROWS;
const SECOND_REPLACEMENT_WINDOW = 2;
const FIRST_WINDOW_DROPPED_ROWS = 1;
const REMAINING_PRIOR_ROWS_AFTER_FIRST_WINDOW = PRIOR_ROW_COUNT - CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE;
const VERIFICATION_DELETED_STAGED_ROWS = 10;
const INTERVENING_CENSUS_ROWS = 3;
const INTERVENING_FILE = 'other.csv';
const INTERVENING_BATCH = 'intervening-batch-0001';
const INTERVENING_CSV_DELIMITER = ',';
const INTERVENING_CSV_HEADERS = ['treetag', 'stemtag', 'speciescode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'];
const INTERVENING_RAW_ROW_DATE = '2021-06-01';
const CALLER_BATCH = 'caller-sent-batch-17';
const LOOKALIKE_PARKED_ROW_TAG_PREFIX = 'LK';
const SETUP_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 300_000;

const SUITE_TABLES = [
  'temporarymeasurements',
  'measurement_error_log',
  'coremeasurements',
  'uploadmetrics',
  'unifiedchangelog',
  'arcgis_import_sessions',
  'upload_sessions'
];

class InjectedFailure extends Error {
  constructor(label: string) {
    super(`injected failure: ${label}`);
    this.name = 'InjectedFailure';
  }
}

let connection: Connection;
let testData: TestData;
let config: TestDatabaseConfig;
let scope: ArcgisImportScope;

beforeAll(async () => {
  const setup = await setupTestDatabase();
  connection = setup.connection;
  testData = setup.testData;
  config = setup.config;
  connectionState.connection = connection;
  scope = {
    schema: config.database,
    plotID: testData.plots[0].plotID,
    censusID: testData.census[0].censusID,
    speciesCode: testData.species[0].SpeciesCode,
    quadratName: testData.quadrats[0].QuadratName
  };
  console.log(`[recovery guards setup] schema=${scope.schema} plot=${scope.plotID} census=${scope.censusID}`);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  connectionState.connection = null;
  await teardownTestDatabase(connection, config);
});

beforeEach(async () => {
  await resetSingleConnectionState(connectionState);
  await connection.query('SELECT RELEASE_ALL_LOCKS()');
  for (const table of SUITE_TABLES) await connection.query(`DELETE FROM ${table}`);
});

interface CommitRequest {
  seeded: SeededArcgisImport;
  uploadMode: UploadMode;
  uploadSessionID: string;
  batchID?: string;
}

function commit(request: CommitRequest) {
  return commitArcgisImport(ConnectionManager.getInstance(), {
    schema: scope.schema,
    plotID: scope.plotID,
    censusID: scope.censusID,
    importSessionId: request.seeded.importSessionId,
    fileName: request.seeded.fileName,
    uploadMode: request.uploadMode,
    userId: ARCGIS_TEST_USER,
    uploadSessionID: request.uploadSessionID,
    ...(request.batchID === undefined ? {} : { batchID: request.batchID })
  });
}

interface AttemptInstrumentation {
  failOn?: SingleConnectionState['failOn'];
  rewrite?: SingleConnectionState['rewrite'];
}

/** Starts a clean statement log and installs this attempt's injections, so ordinal counts restart with every attempt. */
async function beginAttempt(instrumentation: AttemptInstrumentation = {}): Promise<void> {
  await resetSingleConnectionState(connectionState);
  connectionState.failOn = instrumentation.failOn ?? null;
  connectionState.rewrite = instrumentation.rewrite ?? null;
}

function countRecordedStatements(pattern: RegExp): number {
  return connectionState.statements.filter(statement => pattern.test(statement.sql)).length;
}

function failOnNthMatchingStatement(pattern: RegExp, ordinal: number, label: string): SingleConnectionState['failOn'] {
  return sql => (pattern.test(sql) && countRecordedStatements(pattern) === ordinal ? new InjectedFailure(label) : null);
}

function failOnStagingInsertContainingTag(tag: string): SingleConnectionState['failOn'] {
  return (sql, params) =>
    ARCGIS_COMMIT_STATEMENT.STAGING_INSERT.test(sql) && params.includes(tag) ? new InjectedFailure(`staging insert holding ${tag}`) : null;
}

function dropStagedTag(tag: string): SingleConnectionState['rewrite'] {
  return (sql, params) => dropStagingTupleWithTreeTag(sql, params, tag);
}

function writesOutsideDDL(): string[] {
  return connectionState.statements
    .filter(statement => statement.transactionID !== null && WRITE_STATEMENT.test(statement.sql))
    .map(statement => statement.sql.trim().slice(0, 80));
}

async function snapshotImportRow(importSessionId: string): Promise<string> {
  return JSON.stringify(await readImportRow(connection, importSessionId));
}

async function countCoreMeasurementsInCensus(): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM coremeasurements WHERE CensusID = ?`, [scope.censusID]);
  return Number(rows[0].total);
}

/** Short RawTreeTag (varchar(20)) so batch ids of any legal length can be seeded; the fixtures' seeder derives the tag from the batch id. */
async function seedCensusRowsUnderBatch(batchID: string, fileName: string, rowCount: number): Promise<number[]> {
  const insertedIDs: number[] = [];
  for (let ordinal = 1; ordinal <= rowCount; ordinal += 1) {
    const [result] = await connection.query<RowDataPacket[]>(
      `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
       VALUES (?, NULL, FALSE, '2024-03-15', 1.0, 1.0, ?, ?, ?, ?, 1)`,
      [scope.censusID, fileName, batchID, `${LOOKALIKE_PARKED_ROW_TAG_PREFIX}${ordinal}`, ordinal]
    );
    insertedIDs.push((result as unknown as { insertId: number }).insertId);
  }
  return insertedIDs;
}

async function countDeleteAuditsForRecords(recordIDs: number[]): Promise<number> {
  if (recordIDs.length === 0) return 0;
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND Operation = 'DELETE' AND CensusID = ? AND RecordID IN (?)`,
    [scope.censusID, recordIDs.map(String)]
  );
  return Number(rows[0].total);
}

async function countCoreMeasurementsByID(recordIDs: number[]): Promise<number> {
  if (recordIDs.length === 0) return 0;
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM coremeasurements WHERE CoreMeasurementID IN (?)`, [recordIDs]);
  return Number(rows[0].total);
}

async function readFamilyFailureRowIDs(seeded: SeededArcgisImport): Promise<number[]> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT CoreMeasurementID FROM coremeasurements WHERE CensusID = ? AND UploadFileID = ? AND (UploadBatchID = ? OR UploadBatchID LIKE ? ESCAPE '\\\\') ORDER BY CoreMeasurementID`,
    [scope.censusID, seeded.fileName, seeded.batchID, `${seeded.batchID.replace(/[\\%_]/g, character => `\\${character}`)}\\_\\_sub%`]
  );
  return rows.map(row => Number(row.CoreMeasurementID));
}

function buildInterveningParams(uploadSessionID: string, fileName: string): CensusReplacementParams {
  return {
    schema: scope.schema,
    fileName,
    batchID: INTERVENING_BATCH,
    plotID: scope.plotID,
    censusID: scope.censusID,
    uploadMode: UploadMode.CLEAN_REUPLOAD,
    sourceFormat: SourceFormat.csv,
    rawRows: Array.from({ length: INTERVENING_CENSUS_ROWS }, (_, ordinal) => ({
      treetag: `OTH${ordinal}`,
      stemtag: '1',
      speciescode: scope.speciesCode,
      quadrat: scope.quadratName,
      lx: '1',
      ly: '1',
      dbh: '10',
      hom: '1.3',
      date: INTERVENING_RAW_ROW_DATE,
      codes: ''
    })),
    csvHeaders: INTERVENING_CSV_HEADERS,
    delimiter: INTERVENING_CSV_DELIMITER,
    uploadSessionID,
    firstRowOrdinal: 0,
    changedBy: ARCGIS_TEST_USER
  };
}

/**
 * A CLEAN upload of `fileName` through the production CSV functions: census replacement, then one staged chunk, then the
 * census rows its ingestion would have created (staging alone creates none), then the session completes.
 */
async function runInterveningCleanUpload(uploadSessionID: string, fileName: string): Promise<number[]> {
  await startActiveUploadSession(connection, scope, uploadSessionID);
  const params = buildInterveningParams(uploadSessionID, fileName);
  const replacement = await replaceCensusForCleanReupload(ConnectionManager.getInstance(), params);
  console.log(`[intervening ${fileName}] replacement outcome=${replacement.outcome} deletedRows=${replacement.deletedRows} windows=${replacement.windowCount}`);
  const staged = await ConnectionManager.getInstance().withTransaction(tx =>
    stageMeasurementChunk(ConnectionManager.getInstance(), { ...params, transactionID: tx.id })
  );
  console.log(`[intervening ${fileName}] staged inserted=${staged.insertedCount} dropped=${staged.droppedCount}`);
  const ingestedCensusRowIDs = await seedCensusRowsUnderBatch(INTERVENING_BATCH, fileName, INTERVENING_CENSUS_ROWS);
  await setUploadSessionState(connection, uploadSessionID, UploadSessionState.COMPLETED);
  return ingestedCensusRowIDs;
}

describe('AI5: a retry survives an intervening upload (#561)', () => {
  const SESSION_FIRST_ATTEMPT = 'ai5-first-attempt-session';
  const SESSION_INTERVENING = 'ai5-intervening-session';
  const SESSION_RETRY = 'ai5-retry-session';
  const IMPORT_TAG_PREFIX = 'ai5-';

  async function failFirstAttemptInStagingWindowTwo(importFile: string) {
    await seedPriorCensusRows(connection, scope, PRIOR_ROW_COUNT);
    await startActiveUploadSession(connection, scope, SESSION_FIRST_ATTEMPT);
    const seeded = await seedArcgisImport(scope, importFile, IMPORT_ROW_COUNT, IMPORT_TAG_PREFIX);

    await beginAttempt({
      rewrite: dropStagedTag(`${IMPORT_TAG_PREFIX}${DROPPED_TAG_ORDINAL}`),
      failOn: failOnStagingInsertContainingTag(`${IMPORT_TAG_PREFIX}${SECOND_WINDOW_FIRST_TAG_ORDINAL}`)
    });
    await expect(commit({ seeded, uploadMode: UploadMode.CLEAN_REUPLOAD, uploadSessionID: SESSION_FIRST_ATTEMPT })).rejects.toBeInstanceOf(InjectedFailure);

    const staged = await countStagedFamilyRows(connection, importFile, seeded.batchID);
    const failureRows = await countFamilyFailureRows(connection, importFile, seeded.batchID, scope.censusID);
    const censusRowsOutsideFamily = await countCensusRowsOutsideFamily(connection, scope.censusID, seeded.batchID);
    console.log(
      `[AI5 attempt 1] staged=${staged} familyFailureRows=${failureRows} priorRowsInCensus=${censusRowsOutsideFamily} importRow=${await snapshotImportRow(seeded.importSessionId)}`
    );
    expect(staged).toBe(ARCGIS_STAGING_WINDOW_ROWS - FIRST_WINDOW_DROPPED_ROWS);
    expect(failureRows).toBe(FIRST_WINDOW_DROPPED_ROWS);
    expect(censusRowsOutsideFamily).toBe(PRIOR_ROW_COUNT);
    await setUploadSessionState(connection, SESSION_FIRST_ATTEMPT, UploadSessionState.FAILED);
    return seeded;
  }

  async function retryAfterInterveningUpload(seeded: SeededArcgisImport, interveningCensusRowIDs: number[]) {
    await startActiveUploadSession(connection, scope, SESSION_RETRY);
    await beginAttempt({ rewrite: dropStagedTag(`${IMPORT_TAG_PREFIX}${DROPPED_TAG_ORDINAL}`) });
    const result = await commit({ seeded, uploadMode: UploadMode.CLEAN_REUPLOAD, uploadSessionID: SESSION_RETRY });
    console.log(`[AI5 retry] result=${JSON.stringify(result)}`);

    const staged = await countStagedFamilyRows(connection, seeded.fileName, seeded.batchID);
    const failureRows = await countFamilyFailureRows(connection, seeded.fileName, seeded.batchID, scope.censusID);
    const interveningRowsLeft = await countCoreMeasurementsByID(interveningCensusRowIDs);
    const interveningRowAudits = await countDeleteAuditsForRecords(interveningCensusRowIDs);
    const deleteAudit = await deleteAuditRows(connection, scope.censusID);
    const importRow = await readImportRow(connection, seeded.importSessionId);
    console.log(
      `[AI5 end state] staged=${staged} familyFailureRows=${failureRows} interveningRowsLeft=${interveningRowsLeft} interveningRowAudits=${interveningRowAudits} ` +
        `deleteAudit=${JSON.stringify(deleteAudit)} state=${importRow.state} committed_row_count=${importRow.committed_row_count}`
    );
    expect(result.alreadyCommitted).toBe(false);
    expect(staged).toBe(IMPORT_ROW_COUNT - FIRST_WINDOW_DROPPED_ROWS);
    expect(failureRows).toBe(FIRST_WINDOW_DROPPED_ROWS);
    expect(interveningRowsLeft).toBe(0);
    expect(interveningRowAudits).toBe(INTERVENING_CENSUS_ROWS);
    const rowsDeletedByInterveningUpload = PRIOR_ROW_COUNT + FIRST_WINDOW_DROPPED_ROWS;
    expect(deleteAudit).toEqual({
      total: rowsDeletedByInterveningUpload + INTERVENING_CENSUS_ROWS,
      distinctRecordIDs: rowsDeletedByInterveningUpload + INTERVENING_CENSUS_ROWS
    });
    expect(importRow.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
    expect(Number(importRow.committed_row_count)).toBe(IMPORT_ROW_COUNT - FIRST_WINDOW_DROPPED_ROWS);
  }

  it(
    'after an intervening different-file CLEAN upload deleted the census, the retry restages, replaces the intervening rows with audits and commits (catches a retry that trusts its own leftovers)',
    async () => {
      const importFile = 'ai5-different-file.xlsx';
      const seeded = await failFirstAttemptInStagingWindowTwo(importFile);

      const interveningCensusRowIDs = await runInterveningCleanUpload(SESSION_INTERVENING, INTERVENING_FILE);
      const stagedAfterIntervening = await countStagedFamilyRows(connection, importFile, seeded.batchID);
      const failureRowsAfterIntervening = await countFamilyFailureRows(connection, importFile, seeded.batchID, scope.censusID);
      console.log(
        `[AI5 after intervening] importStaged=${stagedAfterIntervening} importFailureRows=${failureRowsAfterIntervening} interveningCensusRows=${interveningCensusRowIDs.length}`
      );
      expect(stagedAfterIntervening).toBe(ARCGIS_STAGING_WINDOW_ROWS - FIRST_WINDOW_DROPPED_ROWS);
      expect(failureRowsAfterIntervening).toBe(0);
      expect(await countCoreMeasurementsInCensus()).toBe(INTERVENING_CENSUS_ROWS);

      await retryAfterInterveningUpload(seeded, interveningCensusRowIDs);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'when the intervening upload has the same file name and its stale-batch delete removed the staged prefix, the retry still restages everything and never answers 409 (catches a retry that trusts the cursor)',
    async () => {
      const importFile = 'ai5-same-file.xlsx';
      const seeded = await failFirstAttemptInStagingWindowTwo(importFile);

      const interveningCensusRowIDs = await runInterveningCleanUpload(SESSION_INTERVENING, importFile);
      const stagedAfterIntervening = await countStagedFamilyRows(connection, importFile, seeded.batchID);
      const importRow = await readImportRow(connection, seeded.importSessionId);
      console.log(`[AI5 variant after intervening] importStaged=${stagedAfterIntervening} cursor=${importRow.staging_next_row_index} state=${importRow.state}`);
      expect(stagedAfterIntervening).toBe(0);
      expect(Number(importRow.staging_next_row_index)).toBe(ARCGIS_STAGING_WINDOW_ROWS);
      expect(importRow.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTING);

      await retryAfterInterveningUpload(seeded, interveningCensusRowIDs);
    },
    TEST_TIMEOUT_MS
  );
});

describe('AI6: a finalize verification failure is retryable (#561)', () => {
  const UPLOAD_SESSION = 'ai6-upload-session';
  const IMPORT_FILE = 'ai6-verification.xlsx';
  const IMPORT_TAG_PREFIX = 'ai6-';

  it(
    'throws ArcgisCommitVerificationError when staged rows vanish before F, leaves the import committing with no file_upload row, and the retry commits (catches a verification that is fatal or skipped)',
    async () => {
      await seedPriorCensusRows(connection, scope, PRIOR_ROW_COUNT);
      await startActiveUploadSession(connection, scope, UPLOAD_SESSION);
      const seeded = await seedArcgisImport(scope, IMPORT_FILE, IMPORT_ROW_COUNT, IMPORT_TAG_PREFIX);

      await beginAttempt();
      const parkedAtFinalize: ParkedTransactionStart = parkNextTransactionStart(connectionState, () =>
        connectionState.statements.some(statement => ARCGIS_COMMIT_STATEMENT.CURSOR_CAS.test(statement.sql) && statement.params[0] === IMPORT_ROW_COUNT)
      );
      const outcome = commit({ seeded, uploadMode: UploadMode.REVISIONS, uploadSessionID: UPLOAD_SESSION }).then(
        value => ({ settled: 'resolved' as const, value }),
        (error: unknown) => ({ settled: 'rejected' as const, error })
      );
      await Promise.race([
        parkedAtFinalize.reached,
        outcome.then(settled => {
          throw new Error(`the commit settled before F's transaction start was parked: ${JSON.stringify(settled)}`);
        })
      ]);

      const [deleteResult] = await connection.query<RowDataPacket[]>(
        `DELETE FROM temporarymeasurements WHERE FileID = ? LIMIT ${VERIFICATION_DELETED_STAGED_ROWS}`,
        [IMPORT_FILE]
      );
      console.log(`[AI6 sabotage] deleted ${(deleteResult as unknown as { affectedRows: number }).affectedRows} staged rows while F was parked`);
      parkedAtFinalize.release();

      const settled = await outcome;
      console.log(`[AI6 attempt 1] settled=${settled.settled} error=${settled.settled === 'rejected' ? String(settled.error) : 'none'}`);
      expect(settled.settled).toBe('rejected');
      const error = (settled as { error: unknown }).error;
      expect(error).toBeInstanceOf(ArcgisCommitVerificationError);
      expect(error).not.toBeInstanceOf(ArcgisImportSessionError);
      expect((error as ArcgisCommitVerificationError).detail).toEqual({
        importSessionId: seeded.importSessionId,
        expectedStagedRows: IMPORT_ROW_COUNT,
        foundStagedRows: IMPORT_ROW_COUNT - VERIFICATION_DELETED_STAGED_ROWS,
        expectedFailureRows: 0,
        foundFailureRows: 0
      });

      const importRowAfterFailure = await readImportRow(connection, seeded.importSessionId);
      const changelogAfterFailure = await fileUploadChangelogRows(connection, scope.censusID, IMPORT_FILE);
      console.log(`[AI6 after failure] state=${importRowAfterFailure.state} fileUploadRows=${changelogAfterFailure.length}`);
      expect(importRowAfterFailure.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTING);
      expect(changelogAfterFailure).toHaveLength(0);

      await beginAttempt();
      const retry = await commit({ seeded, uploadMode: UploadMode.REVISIONS, uploadSessionID: UPLOAD_SESSION });
      const stagedAfterRetry = await countStagedFamilyRows(connection, IMPORT_FILE, seeded.batchID);
      const importRowAfterRetry = await readImportRow(connection, seeded.importSessionId);
      console.log(`[AI6 retry] result=${JSON.stringify(retry)} staged=${stagedAfterRetry} state=${importRowAfterRetry.state}`);
      expect(retry).toEqual({ rowCount: IMPORT_ROW_COUNT, fileName: IMPORT_FILE, alreadyCommitted: false, batchID: seeded.batchID });
      expect(stagedAfterRetry).toBe(IMPORT_ROW_COUNT);
      expect(importRowAfterRetry.state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
    },
    TEST_TIMEOUT_MS
  );
});

describe('AI7: the upload mode is bound to the first claim (#561)', () => {
  const UPLOAD_SESSION = 'ai7-upload-session';
  const IMPORT_TAG_PREFIX = 'ai7-';

  it(
    '(a) a CLEAN commit that failed inside the replacement is not retried as REVISIONS: 409, nothing written, then the CLEAN retry commits (catches a mode that is re-chosen per attempt)',
    async () => {
      const importFile = 'ai7a-clean.xlsx';
      await seedPriorCensusRows(connection, scope, PRIOR_ROW_COUNT);
      await startActiveUploadSession(connection, scope, UPLOAD_SESSION);
      const seeded = await seedArcgisImport(scope, importFile, IMPORT_ROW_COUNT, IMPORT_TAG_PREFIX);

      await beginAttempt({
        failOn: failOnNthMatchingStatement(CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_DELETE, SECOND_REPLACEMENT_WINDOW, 'second replacement window delete')
      });
      await expect(commit({ seeded, uploadMode: UploadMode.CLEAN_REUPLOAD, uploadSessionID: UPLOAD_SESSION })).rejects.toBeInstanceOf(InjectedFailure);
      const priorRowsLeft = await countCensusRowsOutsideFamily(connection, scope.censusID, seeded.batchID);
      const stagedBefore = await countStagedFamilyRows(connection, importFile, seeded.batchID);
      const importRowBefore = await snapshotImportRow(seeded.importSessionId);
      console.log(`[AI7a attempt 1] priorRowsLeft=${priorRowsLeft} staged=${stagedBefore} importRow=${importRowBefore}`);
      expect(priorRowsLeft).toBe(REMAINING_PRIOR_ROWS_AFTER_FIRST_WINDOW);
      expect(stagedBefore).toBe(IMPORT_ROW_COUNT);

      await beginAttempt();
      const wrongModeError = await commit({ seeded, uploadMode: UploadMode.REVISIONS, uploadSessionID: UPLOAD_SESSION }).then(
        () => null,
        (error: unknown) => error
      );
      console.log(
        `[AI7a wrong mode] ${wrongModeError instanceof Error ? `${wrongModeError.name} status=${(wrongModeError as ArcgisImportSessionError).status}: ${wrongModeError.message}` : 'no error'}`
      );
      expect(wrongModeError).toBeInstanceOf(ArcgisImportSessionError);
      expect((wrongModeError as ArcgisImportSessionError).status).toBe(HTTPResponses.CONFLICT);
      expect(writesOutsideDDL()).toEqual([]);
      expect(await countCensusRowsOutsideFamily(connection, scope.censusID, seeded.batchID)).toBe(priorRowsLeft);
      expect(await countStagedFamilyRows(connection, importFile, seeded.batchID)).toBe(stagedBefore);
      expect(await snapshotImportRow(seeded.importSessionId)).toBe(importRowBefore);

      await beginAttempt();
      const retry = await commit({ seeded, uploadMode: UploadMode.CLEAN_REUPLOAD, uploadSessionID: UPLOAD_SESSION });
      const deleteAudit = await deleteAuditRows(connection, scope.censusID);
      console.log(`[AI7a retry] result=${JSON.stringify(retry)} deleteAudit=${JSON.stringify(deleteAudit)}`);
      expect(retry.alreadyCommitted).toBe(false);
      expect(await countCensusRowsOutsideFamily(connection, scope.censusID, seeded.batchID)).toBe(0);
      expect(deleteAudit).toEqual({ total: PRIOR_ROW_COUNT, distinctRecordIDs: PRIOR_ROW_COUNT });
      expect(await countStagedFamilyRows(connection, importFile, seeded.batchID)).toBe(IMPORT_ROW_COUNT);
    },
    TEST_TIMEOUT_MS
  );

  it(
    '(b) a REVISIONS commit that failed in staging is not retried as CLEAN: 409, the census is not replaced, then the REVISIONS retry commits (catches a CLEAN retry that wipes the census)',
    async () => {
      const importFile = 'ai7b-revisions.xlsx';
      await seedPriorCensusRows(connection, scope, PRIOR_ROW_COUNT);
      await startActiveUploadSession(connection, scope, UPLOAD_SESSION);
      const seeded = await seedArcgisImport(scope, importFile, IMPORT_ROW_COUNT, IMPORT_TAG_PREFIX);

      await beginAttempt({ failOn: failOnStagingInsertContainingTag(`${IMPORT_TAG_PREFIX}${SECOND_WINDOW_FIRST_TAG_ORDINAL}`) });
      await expect(commit({ seeded, uploadMode: UploadMode.REVISIONS, uploadSessionID: UPLOAD_SESSION })).rejects.toBeInstanceOf(InjectedFailure);
      const stagedBefore = await countStagedFamilyRows(connection, importFile, seeded.batchID);
      const importRowBefore = await snapshotImportRow(seeded.importSessionId);
      console.log(`[AI7b attempt 1] staged=${stagedBefore} importRow=${importRowBefore}`);
      expect(stagedBefore).toBe(ARCGIS_STAGING_WINDOW_ROWS);

      await beginAttempt();
      const wrongModeError = await commit({ seeded, uploadMode: UploadMode.CLEAN_REUPLOAD, uploadSessionID: UPLOAD_SESSION }).then(
        () => null,
        (error: unknown) => error
      );
      console.log(
        `[AI7b wrong mode] ${wrongModeError instanceof Error ? `${wrongModeError.name} status=${(wrongModeError as ArcgisImportSessionError).status}: ${wrongModeError.message}` : 'no error'}`
      );
      expect(wrongModeError).toBeInstanceOf(ArcgisImportSessionError);
      expect((wrongModeError as ArcgisImportSessionError).status).toBe(HTTPResponses.CONFLICT);
      expect(writesOutsideDDL()).toEqual([]);
      expect(await countCensusRowsOutsideFamily(connection, scope.censusID, seeded.batchID)).toBe(PRIOR_ROW_COUNT);
      expect(await countStagedFamilyRows(connection, importFile, seeded.batchID)).toBe(stagedBefore);
      expect(await snapshotImportRow(seeded.importSessionId)).toBe(importRowBefore);

      await beginAttempt();
      const retry = await commit({ seeded, uploadMode: UploadMode.REVISIONS, uploadSessionID: UPLOAD_SESSION });
      console.log(`[AI7b retry] result=${JSON.stringify(retry)}`);
      expect(retry.alreadyCommitted).toBe(false);
      expect(await countStagedFamilyRows(connection, importFile, seeded.batchID)).toBe(IMPORT_ROW_COUNT);
      expect(await countCensusRowsOutsideFamily(connection, scope.censusID, seeded.batchID)).toBe(PRIOR_ROW_COUNT);
    },
    TEST_TIMEOUT_MS
  );
});

describe('AI8 (sequential): one committing import per upload session (#561)', () => {
  const UPLOAD_SESSION = 'ai8-upload-session';
  const FILE_A = 'a.xlsx';
  const FILE_B = 'b.xlsx';
  const TAG_PREFIX_A = 'ai8a-';
  const TAG_PREFIX_B = 'ai8b-';

  it(
    'refuses B with 409 naming A while A is committing, leaves A, the census and B untouched, then lets A and then B finish (catches a session that can commit two imports)',
    async () => {
      await seedPriorCensusRows(connection, scope, PRIOR_ROW_COUNT);
      await startActiveUploadSession(connection, scope, UPLOAD_SESSION);
      const importA = await seedArcgisImport(scope, FILE_A, IMPORT_ROW_COUNT, TAG_PREFIX_A);

      await beginAttempt({ failOn: failOnStagingInsertContainingTag(`${TAG_PREFIX_A}${SECOND_WINDOW_FIRST_TAG_ORDINAL}`) });
      await expect(commit({ seeded: importA, uploadMode: UploadMode.REVISIONS, uploadSessionID: UPLOAD_SESSION })).rejects.toBeInstanceOf(InjectedFailure);
      // Pre-flight deletes the user's earlier preflight and committed sessions of the census, so B is seeded once A is committing.
      const importB = await seedArcgisImport(scope, FILE_B, SMALL_IMPORT_ROW_COUNT, TAG_PREFIX_B);
      const stagedA = await countStagedFamilyRows(connection, FILE_A, importA.batchID);
      const importRowA = await snapshotImportRow(importA.importSessionId);
      const importRowB = await snapshotImportRow(importB.importSessionId);
      console.log(`[AI8 A failed] stagedA=${stagedA}\n  A=${importRowA}\n  B=${importRowB}`);
      expect(stagedA).toBe(ARCGIS_STAGING_WINDOW_ROWS);
      expect((await readImportRow(connection, importA.importSessionId)).state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTING);
      expect((await readImportRow(connection, importB.importSessionId)).state).toBe(ARCGIS_IMPORT_SESSION_STATE.PREFLIGHT);

      await beginAttempt();
      const refusal = await commit({ seeded: importB, uploadMode: UploadMode.REVISIONS, uploadSessionID: UPLOAD_SESSION }).then(
        () => null,
        (error: unknown) => error
      );
      console.log(
        `[AI8 B refused] ${refusal instanceof Error ? `${refusal.name} status=${(refusal as ArcgisImportSessionError).status}: ${refusal.message}` : 'no error'}`
      );
      expect(refusal).toBeInstanceOf(ArcgisImportSessionError);
      expect((refusal as ArcgisImportSessionError).status).toBe(HTTPResponses.CONFLICT);
      expect((refusal as ArcgisImportSessionError).message).toContain(importA.importSessionId);
      expect(writesOutsideDDL()).toEqual([]);
      expect(await countStagedFamilyRows(connection, FILE_A, importA.batchID)).toBe(stagedA);
      expect(await countStagedFamilyRows(connection, FILE_B, importB.batchID)).toBe(0);
      expect(await countCensusRowsOutsideFamily(connection, scope.censusID, importA.batchID)).toBe(PRIOR_ROW_COUNT);
      expect(await snapshotImportRow(importA.importSessionId)).toBe(importRowA);
      expect(await snapshotImportRow(importB.importSessionId)).toBe(importRowB);

      await beginAttempt();
      const resultA = await commit({ seeded: importA, uploadMode: UploadMode.REVISIONS, uploadSessionID: UPLOAD_SESSION });
      console.log(`[AI8 A retried] ${JSON.stringify(resultA)}`);
      expect(resultA).toEqual({ rowCount: IMPORT_ROW_COUNT, fileName: FILE_A, alreadyCommitted: false, batchID: importA.batchID });

      await beginAttempt();
      const resultB = await commit({ seeded: importB, uploadMode: UploadMode.REVISIONS, uploadSessionID: UPLOAD_SESSION });
      console.log(`[AI8 B under the same session] ${JSON.stringify(resultB)}`);
      expect(resultB).toEqual({ rowCount: SMALL_IMPORT_ROW_COUNT, fileName: FILE_B, alreadyCommitted: false, batchID: importB.batchID });
      expect(await countStagedFamilyRows(connection, FILE_A, importA.batchID)).toBe(IMPORT_ROW_COUNT);
      expect(await countStagedFamilyRows(connection, FILE_B, importB.batchID)).toBe(SMALL_IMPORT_ROW_COUNT);
      expect((await readImportRow(connection, importA.importSessionId)).state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
      expect((await readImportRow(connection, importB.importSessionId)).state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
    },
    TEST_TIMEOUT_MS
  );
});

describe('AI17(b): F0 deletes only the import’s own family (#561)', () => {
  const UPLOAD_SESSION = 'ai17b-upload-session';
  const IMPORT_FILE = 'ai17b-lookalikes.xlsx';
  const IMPORT_TAG_PREFIX = 'ai17b-';

  function buildLookalikeBatchIDs(derivedBatchID: string): string[] {
    const lastCharacter = derivedBatchID.endsWith('z') ? 'y' : 'z';
    return [
      `arb${derivedBatchID.slice(3)}`,
      `${derivedBatchID.slice(0, -1)}${lastCharacter}`,
      derivedBatchID.slice(0, 27),
      `${derivedBatchID}x`,
      `${derivedBatchID.slice(0, 10)}_${derivedBatchID.slice(11)}`,
      generateShortBatchID(),
      CALLER_BATCH
    ];
  }

  it(
    'a retry clears exactly the one leftover failure row of its own family with an audit, and every look-alike batch row of the same file survives unaudited (catches an F0 that matches by prefix, case, wildcard or the caller batch)',
    async () => {
      await startActiveUploadSession(connection, scope, UPLOAD_SESSION);
      const seeded = await seedArcgisImport(scope, IMPORT_FILE, IMPORT_ROW_COUNT, IMPORT_TAG_PREFIX);
      const lookalikeBatchIDs = buildLookalikeBatchIDs(seeded.batchID);
      const lookalikeRowIDs: number[] = [];
      for (const lookalikeBatchID of lookalikeBatchIDs) lookalikeRowIDs.push(...(await seedCensusRowsUnderBatch(lookalikeBatchID, IMPORT_FILE, 1)));
      console.log(`[AI17b seed] derivedBatch=${seeded.batchID}\n  lookalikes=${lookalikeBatchIDs.join(' | ')}\n  lookalikeRowIDs=${lookalikeRowIDs.join(',')}`);
      expect(new Set(lookalikeBatchIDs).size).toBe(lookalikeBatchIDs.length);
      expect(lookalikeBatchIDs).not.toContain(seeded.batchID);
      expect(await countCoreMeasurementsByID(lookalikeRowIDs)).toBe(lookalikeBatchIDs.length);

      await beginAttempt({
        rewrite: dropStagedTag(`${IMPORT_TAG_PREFIX}${DROPPED_TAG_ORDINAL}`),
        failOn: failOnStagingInsertContainingTag(`${IMPORT_TAG_PREFIX}${SECOND_WINDOW_FIRST_TAG_ORDINAL}`)
      });
      await expect(commit({ seeded, uploadMode: UploadMode.REVISIONS, uploadSessionID: UPLOAD_SESSION, batchID: CALLER_BATCH })).rejects.toBeInstanceOf(
        InjectedFailure
      );
      const leftoverFailureRowIDs = await readFamilyFailureRowIDs(seeded);
      const failureRowsAfterFailure = await countFamilyFailureRows(connection, IMPORT_FILE, seeded.batchID, scope.censusID);
      console.log(`[AI17b attempt 1] familyFailureRows=${failureRowsAfterFailure} leftoverFailureRowIDs=${leftoverFailureRowIDs.join(',')}`);
      expect(failureRowsAfterFailure).toBe(FIRST_WINDOW_DROPPED_ROWS);
      expect(leftoverFailureRowIDs).toHaveLength(FIRST_WINDOW_DROPPED_ROWS);
      expect(await deleteAuditRows(connection, scope.censusID)).toEqual({ total: 0, distinctRecordIDs: 0 });

      await beginAttempt({ rewrite: dropStagedTag(`${IMPORT_TAG_PREFIX}${DROPPED_TAG_ORDINAL}`) });
      const retry = await commit({ seeded, uploadMode: UploadMode.REVISIONS, uploadSessionID: UPLOAD_SESSION, batchID: CALLER_BATCH });
      console.log(`[AI17b retry] result=${JSON.stringify(retry)}`);

      const lookalikesLeft = await countCoreMeasurementsByID(lookalikeRowIDs);
      const lookalikeAudits = await countDeleteAuditsForRecords(lookalikeRowIDs);
      const leftoverFailureRowsLeft = await countCoreMeasurementsByID(leftoverFailureRowIDs);
      const leftoverFailureRowAudits = await countDeleteAuditsForRecords(leftoverFailureRowIDs);
      const deleteAudit = await deleteAuditRows(connection, scope.censusID);
      const finalFailureRows = await countFamilyFailureRows(connection, IMPORT_FILE, seeded.batchID, scope.censusID);
      console.log(
        `[AI17b end state] lookalikesLeft=${lookalikesLeft} lookalikeAudits=${lookalikeAudits} leftoverFailureRowsLeft=${leftoverFailureRowsLeft} ` +
          `leftoverFailureRowAudits=${leftoverFailureRowAudits} deleteAudit=${JSON.stringify(deleteAudit)} finalFailureRows=${finalFailureRows}`
      );
      expect(retry.alreadyCommitted).toBe(false);
      expect(lookalikesLeft).toBe(lookalikeBatchIDs.length);
      expect(lookalikeAudits).toBe(0);
      expect(leftoverFailureRowsLeft).toBe(0);
      expect(leftoverFailureRowAudits).toBe(FIRST_WINDOW_DROPPED_ROWS);
      expect(deleteAudit).toEqual({ total: FIRST_WINDOW_DROPPED_ROWS, distinctRecordIDs: FIRST_WINDOW_DROPPED_ROWS });
      expect(finalFailureRows).toBe(FIRST_WINDOW_DROPPED_ROWS);
      expect((await readImportRow(connection, seeded.importSessionId)).state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
    },
    TEST_TIMEOUT_MS
  );
});
