/**
 * Reconciliation enforcement: proves that an unaccounted row is a CRITICAL,
 * diagnosable signal — not an info-level log that a "clean" upload can swallow.
 *
 * The FINAL RECONCILIATION CHECK in db/sql/storedprocedures.sql computes
 *   @unaccounted = vBatchRowCount - @final_success - vDataLossCount
 * and, when non-zero, emits a RECONCILIATION_MISMATCH row into uploadintegrityalerts
 * (severity 'critical' when rows were lost) plus uploadmetrics.missingRecords = ABS(gap).
 *
 * Fault-injection strategy (NO test hook ships in production SQL): the throwaway test
 * schema gets a VARIANT procedure, bulkingestionprocess_faultinjected, built by reading
 * the REAL bulkingestionprocess text from db/sql/storedprocedures.sql and splicing a
 * single-row DELETE in immediately before the (unmodified) FINAL RECONCILIATION CHECK.
 * The variant therefore exercises the procedure's own, real reconciliation math while the
 * deployed db/sql/storedprocedures.sql stays pristine. The variant lives ONLY in the
 * throwaway schema and is never called by the deployed pipeline.
 *
 * This suite drives ingestion three ways on that schema:
 *   1. CONTROL — the canonical bulkingestionprocess reconciles a healthy batch: no
 *      mismatch alert, missingRecords = 0.
 *   2. FAULT-INJECTED — the variant drops one already-inserted successful row before the
 *      reconciliation count, so the real reconciliation observes input != success + failed
 *      and surfaces a critical RECONCILIATION_MISMATCH with missingRecords = 1; the client
 *      verdict (evaluateUploadReconciliation) over the same real counts must agree.
 *   3. NO-BLEED — after the variant runs, the canonical procedure still reconciles a fresh
 *      batch cleanly, proving the fault is confined to the variant, not the real procedure.
 *
 * SAFETY: the beforeAll REFUSING TO RUN guard hard-fails before any write if the host is
 * not local, so this can never touch a real database.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
const EXPECTED_MISSING_COUNT = 1;
const CANONICAL_PROCEDURE = 'bulkingestionprocess';
const FAULT_INJECTED_PROCEDURE = 'bulkingestionprocess_faultinjected';

/**
 * Stable comment anchor that opens the FINAL RECONCILIATION CHECK block in
 * db/sql/storedprocedures.sql. The DELETE is spliced immediately BEFORE this so the
 * reconciliation math itself is left byte-for-byte identical.
 */
const RECONCILIATION_ANCHOR = [
  '    -- =====================================================',
  '    -- FINAL RECONCILIATION CHECK',
  '    -- Verify: input_rows = success + failed + deduplicated',
  '    -- ====================================================='
].join('\n');

/**
 * One-row DELETE that removes a single already-inserted successful measurement for the
 * batch, so the (unmodified) reconciliation block downstream sees success short by one.
 */
const FAULT_INJECTION_DELETE = `    -- TEST-ONLY fault injection (throwaway-schema variant procedure only): drop exactly one
    -- already-inserted successful measurement for this batch immediately before the
    -- reconciliation count, so the REAL reconciliation block below observes a genuine
    -- unaccounted-row gap.
    DELETE FROM coremeasurements
    WHERE CoreMeasurementID = (
        SELECT victim.CoreMeasurementID FROM (
            SELECT cm.CoreMeasurementID
            FROM coremeasurements cm
            WHERE cm.CensusID = vCurrentCensusID
              AND cm.StemGUID IS NOT NULL
              AND cm.UploadFileID = vFileID
              AND cm.UploadBatchID = vBatchID
            ORDER BY cm.CoreMeasurementID DESC
            LIMIT 1
        ) AS victim
    );

`;

/**
 * Reads the canonical bulkingestionprocess out of db/sql/storedprocedures.sql, strips the
 * DELIMITER/DEFINER noise the same way tests/setup/local-db-setup.ts does, renames it, and
 * splices the fault-injection DELETE in before the FINAL RECONCILIATION CHECK. Returns the
 * ready-to-CREATE variant body. Throws loudly if the procedure or the anchor cannot be
 * found so a future SQL refactor can never degrade this into a silent no-op.
 */
function buildFaultInjectedProcedureSql(): string {
  const proceduresPath = join(process.cwd(), 'db/sql', 'storedprocedures.sql');
  const fileContent = readFileSync(proceduresPath, 'utf-8');

  const withoutDelimiters = fileContent.replace(/DELIMITER\s+\$\$/gi, '').replace(/DELIMITER\s+;/gi, '');
  const statements = withoutDelimiters.split('$$');

  // The chunk that declares the parameter list. It also carries the leading
  // `DROP PROCEDURE IF EXISTS bulkingestionprocess;` (that DROP lives between the same $$
  // delimiters), so slice from the CREATE keyword — otherwise creating the variant would
  // also drop the canonical procedure this schema still needs.
  const createChunk = statements.find(s => s.includes(`PROCEDURE ${CANONICAL_PROCEDURE}(`));
  if (!createChunk) {
    throw new Error(`Could not locate the CREATE for ${CANONICAL_PROCEDURE} in ${proceduresPath}`);
  }
  // Anchor to the CREATE that immediately precedes `PROCEDURE <name>(` rather than the first
  // CREATE token in the chunk, so a stray "CREATE" inside a comment before the DROP can't make
  // the slice start early.
  const procedureIndex = createChunk.indexOf(`PROCEDURE ${CANONICAL_PROCEDURE}(`);
  const createIndex = createChunk.lastIndexOf('CREATE', procedureIndex);
  if (createIndex === -1) {
    throw new Error(`Could not find the CREATE keyword preceding PROCEDURE ${CANONICAL_PROCEDURE}( in ${proceduresPath}`);
  }
  const createOnly = createChunk.slice(createIndex);

  const definerStripped = createOnly.trim().replace(/definer\s*=\s*`?[^`\s]+`?@`?[^`\s]+`?\s*/gi, '');
  const renamed = definerStripped.replace(`PROCEDURE ${CANONICAL_PROCEDURE}(`, `PROCEDURE ${FAULT_INJECTED_PROCEDURE}(`);

  if (!renamed.includes(RECONCILIATION_ANCHOR)) {
    throw new Error(
      `FINAL RECONCILIATION CHECK anchor not found in ${CANONICAL_PROCEDURE}; the splice would be a no-op. ` +
        `The reconciliation block in db/sql/storedprocedures.sql may have been reformatted — update RECONCILIATION_ANCHOR.`
    );
  }

  const spliced = renamed.replace(RECONCILIATION_ANCHOR, `${FAULT_INJECTION_DELETE}${RECONCILIATION_ANCHOR}`);
  // Exactly one DELETE was inserted, and the reconciliation math is untouched.
  if ((spliced.match(/-- TEST-ONLY fault injection/g) || []).length !== 1) {
    throw new Error('Fault-injection splice did not insert exactly one DELETE block.');
  }
  return spliced;
}

async function createFaultInjectedProcedure(connection: Connection): Promise<void> {
  await connection.query(`DROP PROCEDURE IF EXISTS ${FAULT_INJECTED_PROCEDURE}`);
  await connection.query(buildFaultInjectedProcedureSql());
}

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
    // Provision the fault-injecting variant INTO the throwaway schema only.
    await createFaultInjectedProcedure(connection);
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData);
  });

  it('CONTROL: the canonical procedure reconciles a healthy batch with no mismatch alert and zero missing records', async () => {
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

    // The variant deletes one already-inserted successful measurement before the real
    // reconciliation count, so input (3) != success (2) + failed (0). The reconciliation
    // block that evaluates and reports the gap is the UNMODIFIED procedure logic.
    await connection.query(`CALL ${FAULT_INJECTED_PROCEDURE}(?, ?)`, [fileID, batchID]);

    const scope: IngestionScope = { fileID, batchID, censusID };
    const outcome = await readIngestionOutcome(connection, scope);

    expect(outcome.successfulRows, 'one successful row should have been dropped pre-reconciliation').toBe(HEALTHY_BATCH_SIZE - EXPECTED_MISSING_COUNT);
    expect(outcome.failedRows, 'the lost row is NOT a surfaced failure — that is the whole point').toBe(0);

    // The gap is a CRITICAL, diagnosable signal — a real alert row, not merely a log line.
    const alert = await readMismatchAlert(connection, scope);
    expect(alert, 'a RECONCILIATION_MISMATCH alert row MUST be emitted for the unaccounted row').toBeDefined();
    expect(alert!.type).toBe(RECONCILIATION_MISMATCH_CODE);
    expect(alert!.severity, 'a lost row (positive @unaccounted) is critical, not a warning').toBe(ReconciliationSeverity.CRITICAL);
    expect(Number(alert!.missingRecords), 'exactly one row is missing').toBe(EXPECTED_MISSING_COUNT);
    expect(Number(alert!.sourceRecords)).toBe(HEALTHY_BATCH_SIZE);
    expect(Number(alert!.processedRecords)).toBe(HEALTHY_BATCH_SIZE - EXPECTED_MISSING_COUNT);

    // uploadmetrics carries the same diagnosable counters.
    expect(outcome.metricMissingRecords, 'uploadmetrics.missingRecords must equal the gap').toBe(EXPECTED_MISSING_COUNT);
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
    expect(verdict.missingRecords).toBe(EXPECTED_MISSING_COUNT);
  });

  it('NO-BLEED: the canonical procedure still reconciles a fresh batch cleanly after the variant ran', async () => {
    const censusID = testData.census[0].censusID;

    // Run the fault-injecting variant first (produces a mismatch on its own batch).
    const injected = await insertTestMeasurements(connection, testData, buildValidRows(testData, HEALTHY_BATCH_SIZE), { censusID });
    await connection.query(`CALL ${FAULT_INJECTED_PROCEDURE}(?, ?)`, [injected.fileID, injected.batchID]);

    await cleanupTestMeasurements(connection, testData);

    // The deployed procedure must be untouched by the variant.
    const clean = await insertTestMeasurements(connection, testData, buildValidRows(testData, HEALTHY_BATCH_SIZE), { censusID });
    const cleanResult = await runBulkIngestion(connection, clean.fileID, clean.batchID);
    expect(cleanResult.batch_failed).toBe(false);

    const cleanOutcome = await readIngestionOutcome(connection, { fileID: clean.fileID, batchID: clean.batchID, censusID });
    expect(cleanOutcome.successfulRows, 'the canonical procedure must reconcile every row').toBe(HEALTHY_BATCH_SIZE);
    expect(cleanOutcome.metricMissingRecords).toBe(0);
    expect(cleanOutcome.alertTypes).not.toContain(INGESTION_ALERT_TYPE.RECONCILIATION_MISMATCH);
  });
});
