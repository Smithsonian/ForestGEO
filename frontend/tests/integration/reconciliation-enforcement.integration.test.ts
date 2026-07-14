/**
 * Reconciliation enforcement: proves that an unaccounted row is a CRITICAL,
 * diagnosable signal — not an info-level log that a "clean" upload can swallow.
 *
 * The FINAL RECONCILIATION CHECK in db/sql/storedprocedures.sql computes
 *   @unaccounted = vBatchRowCount - @final_success - vDataLossCount
 * and, when non-zero, emits a RECONCILIATION_MISMATCH row into uploadintegrityalerts
 * (severity 'critical' when rows were lost) plus uploadmetrics.missingRecords = ABS(gap).
 *
 * This suite drives bulkingestionprocess twice on a throwaway schema:
 *   1. CONTROL — a healthy batch reconciles: no mismatch alert, missingRecords = 0.
 *   2. FAULT-INJECTED — one already-inserted successful row is dropped BEFORE the
 *      reconciliation count via the @forceUnaccountedDrop hook (the honest, controllable
 *      way to "delete one successful row before reconciliation" from OUTSIDE an atomic
 *      CALL). The procedure must then surface a critical RECONCILIATION_MISMATCH with
 *      missingRecords = 1, and the client verdict (evaluateUploadReconciliation) over the
 *      same real counts must agree it is NOT reconciled.
 *
 * SAFETY: the beforeAll REFUSING TO RUN guard hard-fails before any write if the host is
 * not local, so this can never touch a real database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestMeasurements,
  insertTestMeasurements,
  runBulkIngestion,
  DEFAULT_TEST_CONFIG,
  type TestData,
  type TestDatabaseConfig
} from '../setup/local-db-setup';
import { readIngestionOutcome, INGESTION_ALERT_TYPE, type IngestionScope } from '../setup/ingestion-outcome';
import { evaluateUploadReconciliation, RECONCILIATION_MISMATCH_CODE, ReconciliationSeverity } from '@/lib/ingestion/reconciliation';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;

function assertLocalHostOrRefuse(): void {
  // Copied verbatim (intent + message) from coreapifunctions-patch-atomicity.integration.test.ts.
  const host = process.env.AZURE_SQL_SERVER;
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid writing to a real database.`);
  }
  const testHost = DEFAULT_TEST_CONFIG.host;
  if (!LOCAL_HOSTS.includes(testHost as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: TEST_DB_HOST is '${testHost}', not local. Aborting to avoid writing to a real database.`);
  }
}

const MEASUREMENT_DATE = '2024-06-15';
const HEALTHY_BATCH_SIZE = 3;
const FORCED_DROP_COUNT = 1;
const RECONCILIATION_CRITICAL_SEVERITY = 'critical';

function buildValidRows(testData: TestData, count: number) {
  const speciesCode = testData.species[0].SpeciesCode;
  const quadratName = testData.quadrats[0].QuadratName;
  return Array.from({ length: count }, (_, i) => ({
    treeTag: `RECON_${i + 1}`,
    stemTag: `S${i + 1}`,
    speciesCode,
    quadratName,
    x: i + 1,
    y: i + 1,
    dbh: 10 + i,
    hom: 1.3,
    date: MEASUREMENT_DATE
  }));
}

async function readMismatchAlert(connection: Connection, scope: IngestionScope): Promise<RowDataPacket | undefined> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT type, severity, sourceRecords, processedRecords, failedRecords, missingRecords, message
     FROM uploadintegrityalerts
     WHERE fileID = ? AND batchID = ? AND type = ?`,
    [scope.fileID, scope.batchID, INGESTION_ALERT_TYPE.RECONCILIATION_MISMATCH]
  );
  return rows[0];
}

describe('Reconciliation enforcement (bulkingestionprocess FINAL RECONCILIATION CHECK)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;

  beforeAll(async () => {
    assertLocalHostOrRefuse();
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    // Guarantee a clean session flag between tests so a leaked value can never taint a run.
    await connection.query('SET @forceUnaccountedDrop = NULL');
    await cleanupTestMeasurements(connection, testData);
  });

  it('CONTROL: a healthy batch reconciles with no mismatch alert and zero missing records', async () => {
    const rows = buildValidRows(testData, HEALTHY_BATCH_SIZE);
    const censusID = testData.census[0].censusID;
    const { fileID, batchID } = await insertTestMeasurements(connection, testData, rows, { censusID });

    const result = await runBulkIngestion(connection, fileID, batchID);
    expect(result.batch_failed, `procedure should not hard-fail a healthy batch: ${result.message}`).toBe(false);

    const scope: IngestionScope = { fileID, batchID, censusID };
    const outcome = await readIngestionOutcome(connection, scope);

    expect(outcome.successfulRows, 'every healthy row should succeed').toBe(HEALTHY_BATCH_SIZE);
    expect(outcome.failedRows).toBe(0);
    expect(outcome.metricMissingRecords, 'uploadmetrics.missingRecords must be 0 for a reconciled batch').toBe(0);
    expect(outcome.alertTypes, 'no RECONCILIATION_MISMATCH alert on a healthy batch').not.toContain(INGESTION_ALERT_TYPE.RECONCILIATION_MISMATCH);
    expect(await readMismatchAlert(connection, scope), 'no mismatch alert row should exist').toBeUndefined();

    // The client verdict over the real counts agrees the batch is clean.
    const verdict = evaluateUploadReconciliation({
      sourceRecords: rows.length,
      successfulRecords: outcome.successfulRows,
      failedRecords: outcome.failedRows
    });
    expect(verdict.reconciled).toBe(true);
    expect(verdict.severity).toBe(ReconciliationSeverity.RECONCILED);
  });

  it('FAULT-INJECTED: one dropped success surfaces a CRITICAL RECONCILIATION_MISMATCH with missingRecords=1 (not an info log)', async () => {
    const rows = buildValidRows(testData, HEALTHY_BATCH_SIZE);
    const censusID = testData.census[0].censusID;
    const { fileID, batchID } = await insertTestMeasurements(connection, testData, rows, { censusID });

    // Induce exactly one unaccounted row: the hook deletes one already-inserted successful
    // measurement immediately before the reconciliation count, so input (3) != success (2) + failed (0).
    await connection.query('SET @forceUnaccountedDrop = ?', [FORCED_DROP_COUNT]);
    const result = await runBulkIngestion(connection, fileID, batchID);

    const scope: IngestionScope = { fileID, batchID, censusID };
    const outcome = await readIngestionOutcome(connection, scope);

    // One successful row was removed before reconciliation, so success is short by exactly one.
    expect(outcome.successfulRows, 'one successful row should have been dropped pre-reconciliation').toBe(HEALTHY_BATCH_SIZE - FORCED_DROP_COUNT);
    expect(outcome.failedRows, 'the lost row is NOT a surfaced failure — that is the whole point').toBe(0);

    // The gap is a CRITICAL, diagnosable signal — a real alert row, not merely a log line.
    const alert = await readMismatchAlert(connection, scope);
    expect(alert, 'a RECONCILIATION_MISMATCH alert row MUST be emitted for the unaccounted row').toBeDefined();
    expect(alert!.type).toBe(RECONCILIATION_MISMATCH_CODE);
    expect(alert!.severity, 'a lost row (positive @unaccounted) is critical, not a warning').toBe(RECONCILIATION_CRITICAL_SEVERITY);
    expect(Number(alert!.missingRecords), 'exactly one row is missing').toBe(FORCED_DROP_COUNT);
    expect(Number(alert!.sourceRecords)).toBe(HEALTHY_BATCH_SIZE);
    expect(Number(alert!.processedRecords)).toBe(HEALTHY_BATCH_SIZE - FORCED_DROP_COUNT);

    // uploadmetrics carries the same diagnosable counters.
    expect(outcome.metricMissingRecords, 'uploadmetrics.missingRecords must equal the gap').toBe(FORCED_DROP_COUNT);
    expect(outcome.alertTypes).toContain(INGESTION_ALERT_TYPE.RECONCILIATION_MISMATCH);

    // The production client verdict over the SAME real counts must independently flag the
    // mismatch as critical — the signal the upload UI blocks completion on.
    const verdict = evaluateUploadReconciliation({
      sourceRecords: rows.length,
      successfulRecords: outcome.successfulRows,
      failedRecords: outcome.failedRows
    });
    expect(verdict.reconciled, 'client reconciliation must NOT report clean when a row is unaccounted').toBe(false);
    expect(verdict.code).toBe(RECONCILIATION_MISMATCH_CODE);
    expect(verdict.severity).toBe(ReconciliationSeverity.CRITICAL);
    expect(verdict.missingRecords).toBe(FORCED_DROP_COUNT);
  });

  it('the fault-injection flag is one-shot: a subsequent batch on the same connection reconciles cleanly', async () => {
    // Prove the hook cleared itself so it cannot silently corrupt later batches.
    const rows = buildValidRows(testData, HEALTHY_BATCH_SIZE);
    const censusID = testData.census[0].censusID;

    await connection.query('SET @forceUnaccountedDrop = ?', [FORCED_DROP_COUNT]);
    const first = await insertTestMeasurements(connection, testData, rows, { censusID });
    await runBulkIngestion(connection, first.fileID, first.batchID);

    await cleanupTestMeasurements(connection, testData);

    const second = await insertTestMeasurements(connection, testData, buildValidRows(testData, HEALTHY_BATCH_SIZE), { censusID });
    const secondResult = await runBulkIngestion(connection, second.fileID, second.batchID);
    expect(secondResult.batch_failed).toBe(false);

    const secondOutcome = await readIngestionOutcome(connection, { fileID: second.fileID, batchID: second.batchID, censusID });
    expect(secondOutcome.successfulRows, 'the second batch must be unaffected by the one-shot flag').toBe(HEALTHY_BATCH_SIZE);
    expect(secondOutcome.metricMissingRecords).toBe(0);
    expect(secondOutcome.alertTypes).not.toContain(INGESTION_ALERT_TYPE.RECONCILIATION_MISMATCH);
  });
});
