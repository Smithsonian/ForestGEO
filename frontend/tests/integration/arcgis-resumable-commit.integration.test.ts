/**
 * ArcGIS resumable commit (#561) — the reference sequence against real MySQL.
 *
 * AI1 runs one CLEAN_REUPLOAD commit of a 10,007-row import over a census holding 2,500 prior rows and proves the
 * spec's 14 separately committed transactions, one by one, by the transaction ids the single-connection manager
 * mock hands out, and the exact end state they leave behind.
 *
 * Prerequisites: docker compose up -d mysql
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from 'mysql2/promise';
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
  startActiveUploadSession,
  type ArcgisImportScope
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
import { ARCGIS_STAGING_WINDOW_ROWS, commitArcgisImport } from '@/lib/uploads/arcgis-commit';
import { ARCGIS_IMPORT_SESSION_STATE } from '@/lib/arcgis/import-session';
import { UploadMode } from '@/config/uploadmodes';
import { CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE } from '@/lib/ingestion/temporary-measurements';
import { buildFileUploadChangelogRecordID } from '@/lib/uploads/file-names';

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

describe('AI1: the resumable ArcGIS commit runs the 14-transaction reference sequence on MySQL (#561)', () => {
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
    await connection.query('SELECT RELEASE_ALL_LOCKS()');
    for (const table of SUITE_TABLES) await connection.query(`DELETE FROM ${table}`);
  });

  it(
    'commits in claim, S0, F0, 3 staging windows, 4 replacement windows, legacy, metrics, completion and finalize transactions, each guarded, and leaves the exact end state',
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
});
