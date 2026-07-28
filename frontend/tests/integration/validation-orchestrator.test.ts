/**
 * runCensusValidations — Integration Tests
 *
 * Exercises the server-side validation orchestrator (lib/uploads/validation-orchestrator.ts)
 * against a real local MySQL instance. Rows are staged through stageMeasurementChunk and
 * ingested via ingestBatch, exactly like the production upload pipeline, before the
 * orchestrator runs. The orchestrator must:
 *   1. List enabled sitespecificvalidations and pair the combined runs
 *      (growth+shrinkage → shared DBH, quadrat-mismatch+coordinate-drift → shared
 *      cross-census) into single steps.
 *   2. Create a validation_runs record (returning conflict when a fresh running
 *      row exists), update per-step progress, and finalize with a terminal status.
 *   3. After a clean run, flip IsValidated on passing rows (updatepassedvalidations
 *      core) and refresh measurementssummary + viewfulltable.
 *
 * Covered scenarios:
 *   1. Clean census — every step executes, run record completes, views refreshed,
 *      all rows IsValidated = 1.
 *   2. Seeded violation — a row with MeasuredDBH = 9999 trips ValidateFindAbnormallyHighDBH
 *      (ValidationID 15, single-census, threshold 3500mm). The step still SUCCEEDS
 *      (finding violations is not a step failure); the violating row gets an
 *      unresolved measurement_error_log entry, IsValidated = 0, and an Errors string
 *      in measurementssummary, while clean rows get IsValidated = 1.
 *   3. Conflict — a fresh 'running' validation_runs row makes the orchestrator
 *      return { conflict: true } without executing anything.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/validation-orchestrator.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { cleanupTestMeasurements, setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';
import { SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';

// ---------------------------------------------------------------------------
// Safety guard — setupTestDatabase DROPs/CREATEs its schema; never run remote.
// ---------------------------------------------------------------------------

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';

if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(
    `[validation-orchestrator] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops and recreates its test schema and must only run against a local test database.`
  );
}

// ---------------------------------------------------------------------------
// Shared state bridge — hoisted so the ConnectionManager mock closure can read
// the live test connection after beforeAll wires it up.
// ---------------------------------------------------------------------------

const TRANSACTION_ID_PREFIX = 'validation-orchestrator-tx-';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0
}));

// ConnectionManager mock — mirrors the collapse-census test pattern exactly.
// Routes every DB call to the shared real MySQL connection. The orchestrator's
// validation primitives (runValidation, runCombinedDBHValidations, ...) call
// ConnectionManager.getInstance() internally, so they land here too.
vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      const [rows] = await sharedState.connection.query(query, (params as unknown[]) ?? []);
      return rows;
    },
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (sharedState.activeTransactionID) throw new Error('ConnectionManager mock: transaction already active');
      await sharedState.connection.beginTransaction();
      sharedState.transactionCounter += 1;
      const id = `${TRANSACTION_ID_PREFIX}${sharedState.transactionCounter}`;
      sharedState.activeTransactionID = id;
      return id;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: commit transactionID mismatch');
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: rollback transactionID mismatch');
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
    },
    withTransaction: async <T>(fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<any>; readonly id: string }) => Promise<T>): Promise<T> => {
      const id = await manager.beginTransaction();
      try {
        const tx = {
          id,
          query: (sql: string, params?: unknown[]) => manager.executeQuery(sql, params, id)
        };
        const result = await fn(tx);
        await manager.commitTransaction(id);
        return result;
      } catch (error) {
        await manager.rollbackTransaction(id);
        throw error;
      }
    },
    acquireApplicationLock: async (lockName: string, _transactionID: string, timeoutMs: number) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      const [rows] = await sharedState.connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, ?) as acquired', [lockName, Math.ceil(timeoutMs / 1000)]);
      return (rows as RowDataPacket[])[0]?.acquired === 1;
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({
  default: {
    info: (msg: string) => console.log(`[ailogger.info] ${msg}`),
    warn: (msg: string) => console.log(`[ailogger.warn] ${msg}`),
    error: (msg: string, ...rest: unknown[]) => console.log(`[ailogger.error] ${msg}`, ...rest)
  }
}));

import ConnectionManager from '@/lib/db/connectionmanager';
import { stageMeasurementChunk, type StageMeasurementChunkParams } from '@/lib/uploads/stage-measurements';
import { ingestBatch } from '@/lib/uploads/ingest-batch';
import {
  COORDINATE_DRIFT_PROCEDURE,
  DBH_GROWTH_PROCEDURE,
  DBH_SHRINKAGE_PROCEDURE,
  QUADRAT_MISMATCH_PROCEDURE,
  runCensusValidations
} from '@/lib/uploads/validation-orchestrator';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const FILE_NAME = 'validation-orchestrator-fixture.csv';
const BATCH_ID = 'validation-orch-0001';
const UPLOAD_SESSION_ID = 'validation-orchestrator-int-test-session';
const CHANGED_BY = 'validation-orchestrator-test@forestgeo.test';
const CSV_DELIMITER = ',';
const CSV_HEADERS = ['tag', 'stemtag', 'spcode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'];
const MEASUREMENT_DATE = '2024-03-15'; // inside the seeded census bounds 2024-01-01..2024-12-31

const EXPECTED_CLEAN_ROW_COUNT = 5;

// ValidateFindAbnormallyHighDBH (ValidationID 15) flags MeasuredDBH >= 3500mm —
// the only enabled validation that is trippable with a single census and no
// specieslimits, which is why the violation scenario uses it.
const ABNORMAL_DBH_VALIDATION_ID = 15;
const ABNORMAL_DBH_PROCEDURE = 'ValidateFindAbnormallyHighDBH';
const ABNORMAL_DBH_VALUE = '9999';
const VIOLATING_TAG = 'VO666';

/** BIT(1) columns (IsValidated, IsEnabled) come back from mysql2 as 1-byte Buffers. */
function mysqlBitToNumber(value: unknown): number {
  if (Buffer.isBuffer(value)) return value[0];
  return Number(value);
}

function buildRow(tag: string, stemtag: string, spcode: string, quadrat: string, lx: string, ly: string, dbh: string): Record<string, string> {
  return { tag, stemtag, spcode, quadrat, lx, ly, dbh, hom: '1.3', date: MEASUREMENT_DATE, codes: 'A' };
}

function buildCleanFixtureRows(): Record<string, string>[] {
  return [
    buildRow('VO001', '1', 'ACERRU', 'Q01', '1.5', '2.5', '10.5'),
    buildRow('VO002', '1', 'QUERCO', 'Q01', '3.5', '4.5', '20.4'),
    buildRow('VO003', '1', 'PINUST', 'Q02', '5.5', '6.5', '30.1'),
    buildRow('VO004', '1', 'FAGUGR', 'Q02', '7.5', '8.5', '15.2'),
    buildRow('VO005', '1', 'BETUAL', 'Q03', '9.5', '0.5', '25.8')
  ];
}

// ---------------------------------------------------------------------------
// Suite lifecycle
// ---------------------------------------------------------------------------

describe('runCensusValidations — integration', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let schema: string;
  let plotID: number;
  let censusID: number;

  const connectionManager = ConnectionManager.getInstance();

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    schema = setup.config.database;
    plotID = testData.plots[0].plotID;
    censusID = testData.census[0].censusID;
    sharedState.connection = connection;

    // validation_runs is defined in tablestructures.sql but loadSchema's
    // semicolon-split filter silently skips it (the statement chunk begins
    // with a '--' comment block). Create it here with the production DDL so
    // run-record assertions exercise the real column set.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${schema}\`.validation_runs (
        RunID          INT AUTO_INCREMENT PRIMARY KEY,
        PlotID         INT NOT NULL,
        CensusID       INT NOT NULL,
        Status         ENUM ('running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'running',
        TotalSteps     INT NOT NULL DEFAULT 0,
        CompletedSteps INT NOT NULL DEFAULT 0,
        FailedSteps    INT NOT NULL DEFAULT 0,
        CurrentStep    VARCHAR(100) NULL,
        ErrorMessages  JSON NULL,
        StartedAt      DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        CompletedAt    DATETIME NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log(`[setup] schema=${schema} plotID=${plotID} censusID=${censusID}`);
  }, 120000);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    if (sharedState.activeTransactionID) {
      await connection.rollback();
      sharedState.activeTransactionID = null;
    }
    await cleanupTestMeasurements(connection, testData, {
      additionalTables: ['validation_runs', 'measurementssummary', 'viewfulltable']
    });
    console.log('[beforeEach] cleared measurement tables + validation_runs + summary views');
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  async function stageAndIngestRows(rows: Record<string, string>[], expectedInserted: number): Promise<void> {
    const transactionID = await connectionManager.beginTransaction();
    const params: StageMeasurementChunkParams = {
      schema,
      fileName: FILE_NAME,
      batchID: BATCH_ID,
      plotID,
      censusID,
      uploadMode: UploadMode.CLEAN_REUPLOAD,
      sourceFormat: SourceFormat.csv,
      rawRows: rows,
      csvHeaders: CSV_HEADERS,
      delimiter: CSV_DELIMITER,
      uploadSessionID: UPLOAD_SESSION_ID,
      transactionID,
      changedBy: CHANGED_BY
    };
    const stageResult = await stageMeasurementChunk(connectionManager, params);
    await connectionManager.commitTransaction(transactionID);
    console.log(`[stage] insertedCount=${stageResult.insertedCount} invalidRows=${stageResult.invalidRows.length}`);
    expect(stageResult.insertedCount).toBe(expectedInserted);
    expect(stageResult.invalidRows).toHaveLength(0);

    const ingestResult = await ingestBatch(connectionManager, { schema, fileID: FILE_NAME, batchID: BATCH_ID });
    console.log(`[ingest] processedSubBatches=${ingestResult.processedSubBatches} totalRows=${ingestResult.totalRows} noDataFound=${ingestResult.noDataFound}`);
    expect(ingestResult.noDataFound).toBe(false);
    expect(ingestResult.subBatchResults[0].batchFailedButHandled).toBe(false);
  }

  /**
   * Computes the step count the orchestrator should produce: one step per
   * enabled validation, with each fully-enabled combined pair collapsing two
   * validations into one shared step.
   */
  async function computeExpectedTotalSteps(): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT ProcedureName FROM sitespecificvalidations WHERE IsEnabled = 1');
    const names = new Set(rows.map(r => String(r.ProcedureName)));
    let steps = names.size;
    if (names.has(DBH_GROWTH_PROCEDURE) && names.has(DBH_SHRINKAGE_PROCEDURE)) steps -= 1;
    if (names.has(QUADRAT_MISMATCH_PROCEDURE) && names.has(COORDINATE_DRIFT_PROCEDURE)) steps -= 1;
    console.log(`[expected-steps] ${names.size} enabled validations -> ${steps} orchestrator steps`);
    return steps;
  }

  async function fetchValidationRuns(): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT RunID, PlotID, CensusID, Status, TotalSteps, CompletedSteps, FailedSteps, CurrentStep, ErrorMessages, CompletedAt
       FROM validation_runs WHERE PlotID = ? AND CensusID = ? ORDER BY RunID`,
      [plotID, censusID]
    );
    return rows;
  }

  async function fetchUnresolvedValidationErrors(): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT mel.MeasurementID, me.ErrorCode, me.ErrorMessage, cm.MeasuredDBH
       FROM measurement_error_log mel
       JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
       JOIN coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
       WHERE me.ErrorSource = 'validation' AND mel.IsResolved = FALSE AND cm.CensusID = ?
       ORDER BY mel.MeasurementID`,
      [censusID]
    );
    return rows;
  }

  // -------------------------------------------------------------------------
  // 1. Clean census — full run completes, record finalized, views refreshed
  // -------------------------------------------------------------------------

  it('runs all enabled validations on a clean census, completes the run record, and refreshes views', async () => {
    await stageAndIngestRows(buildCleanFixtureRows(), EXPECTED_CLEAN_ROW_COUNT);

    const expectedTotalSteps = await computeExpectedTotalSteps();
    expect(expectedTotalSteps).toBeGreaterThan(0);

    const stepLog: Array<{ name: string; completed: number; failed: number }> = [];
    const summary = await runCensusValidations(connectionManager, {
      schema,
      plotID,
      censusID,
      onStep: async (name, completed, failed) => {
        stepLog.push({ name, completed, failed });
        console.log(`[onStep] ${name}: completed=${completed} failed=${failed}`);
      }
    });

    console.log(`[summary] ${JSON.stringify(summary)}`);
    expect(summary.conflict).toBe(false);
    expect(summary.totalSteps).toBe(expectedTotalSteps);
    expect(summary.failedSteps).toBe(0);
    expect(summary.errors).toEqual([]);

    // onStep fired once per task and the final counts add up.
    expect(stepLog).toHaveLength(expectedTotalSteps);
    const lastStep = stepLog[stepLog.length - 1];
    expect(lastStep.completed + lastStep.failed).toBe(expectedTotalSteps);

    // Combined steps must appear as paired step names, not individual procedures.
    const stepNames = stepLog.map(s => s.name);
    expect(stepNames).toContain(`${DBH_GROWTH_PROCEDURE}+${DBH_SHRINKAGE_PROCEDURE}`);
    expect(stepNames).toContain(`${QUADRAT_MISMATCH_PROCEDURE}+${COORDINATE_DRIFT_PROCEDURE}`);
    expect(stepNames).not.toContain(DBH_GROWTH_PROCEDURE);
    expect(stepNames).not.toContain(QUADRAT_MISMATCH_PROCEDURE);

    // Run record finalized as completed with matching step counts.
    const runs = await fetchValidationRuns();
    console.log(`[validation_runs] ${JSON.stringify(runs)}`);
    expect(runs).toHaveLength(1);
    expect(runs[0].Status).toBe('completed');
    expect(Number(runs[0].TotalSteps)).toBe(expectedTotalSteps);
    expect(Number(runs[0].CompletedSteps)).toBe(expectedTotalSteps);
    expect(Number(runs[0].FailedSteps)).toBe(0);
    expect(runs[0].CompletedAt).not.toBeNull();

    // Clean data: no unresolved validation errors, every row marked validated.
    const validationErrors = await fetchUnresolvedValidationErrors();
    console.log(`[errors] unresolved validation errors: ${JSON.stringify(validationErrors)}`);
    expect(validationErrors).toHaveLength(0);

    const [validatedRows] = await connection.query<RowDataPacket[]>(
      'SELECT CoreMeasurementID, IsValidated FROM coremeasurements WHERE CensusID = ? AND StemGUID IS NOT NULL',
      [censusID]
    );
    expect(validatedRows).toHaveLength(EXPECTED_CLEAN_ROW_COUNT);
    for (const row of validatedRows) {
      expect(mysqlBitToNumber(row.IsValidated)).toBe(1);
    }

    // Views refreshed: measurementssummary repopulated for the scope; spot-check one row.
    const [summaryRows] = await connection.query<RowDataPacket[]>(
      'SELECT CoreMeasurementID, TreeTag, IsValidated, Errors FROM measurementssummary WHERE PlotID = ? AND CensusID = ? ORDER BY TreeTag',
      [plotID, censusID]
    );
    console.log(`[measurementssummary] ${summaryRows.length} rows, first=${JSON.stringify(summaryRows[0])}`);
    expect(summaryRows).toHaveLength(EXPECTED_CLEAN_ROW_COUNT);
    expect(summaryRows[0].TreeTag).toBe('VO001');
    expect(mysqlBitToNumber(summaryRows[0].IsValidated)).toBe(1);
    expect(summaryRows[0].Errors).toBeNull();

    const [viewFullRows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM viewfulltable WHERE PlotID = ? AND CensusID = ?', [
      plotID,
      censusID
    ]);
    expect(Number(viewFullRows[0].count)).toBe(EXPECTED_CLEAN_ROW_COUNT);
  }, 120000);

  // -------------------------------------------------------------------------
  // 2. Seeded violation — abnormally high DBH is flagged, not a step failure
  // -------------------------------------------------------------------------

  it('flags a 9999-DBH row via ValidateFindAbnormallyHighDBH while the run itself completes', async () => {
    const rows = [...buildCleanFixtureRows(), buildRow(VIOLATING_TAG, '1', 'TILIAA', 'Q03', '11.5', '2.5', ABNORMAL_DBH_VALUE)];
    await stageAndIngestRows(rows, EXPECTED_CLEAN_ROW_COUNT + 1);

    // Sanity: the validation we rely on is enabled in this schema.
    const [validationDef] = await connection.query<RowDataPacket[]>('SELECT ProcedureName, IsEnabled FROM sitespecificvalidations WHERE ValidationID = ?', [
      ABNORMAL_DBH_VALIDATION_ID
    ]);
    expect(validationDef).toHaveLength(1);
    expect(validationDef[0].ProcedureName).toBe(ABNORMAL_DBH_PROCEDURE);
    expect(mysqlBitToNumber(validationDef[0].IsEnabled)).toBe(1);

    const [violatingRows] = await connection.query<RowDataPacket[]>('SELECT CoreMeasurementID FROM coremeasurements WHERE CensusID = ? AND MeasuredDBH = ?', [
      censusID,
      Number(ABNORMAL_DBH_VALUE)
    ]);
    expect(violatingRows).toHaveLength(1);
    const violatingID = Number(violatingRows[0].CoreMeasurementID);
    console.log(`[violation] CoreMeasurementID=${violatingID} has MeasuredDBH=${ABNORMAL_DBH_VALUE}`);

    const summary = await runCensusValidations(connectionManager, { schema, plotID, censusID });
    console.log(`[summary] ${JSON.stringify(summary)}`);

    // Finding violations is NOT a step failure — every validation executed.
    expect(summary.conflict).toBe(false);
    expect(summary.failedSteps).toBe(0);
    expect(summary.errors).toEqual([]);

    const runs = await fetchValidationRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].Status).toBe('completed');

    // The violating row carries an unresolved error from validation 15.
    const validationErrors = await fetchUnresolvedValidationErrors();
    console.log(`[errors] unresolved validation errors: ${JSON.stringify(validationErrors)}`);
    const abnormalErrors = validationErrors.filter(e => Number(e.MeasurementID) === violatingID && String(e.ErrorCode) === String(ABNORMAL_DBH_VALIDATION_ID));
    expect(abnormalErrors).toHaveLength(1);

    // updatepassedvalidations core: violating row fails, clean rows pass.
    const [coreRows] = await connection.query<RowDataPacket[]>(
      'SELECT CoreMeasurementID, IsValidated FROM coremeasurements WHERE CensusID = ? AND StemGUID IS NOT NULL',
      [censusID]
    );
    expect(coreRows).toHaveLength(EXPECTED_CLEAN_ROW_COUNT + 1);
    for (const row of coreRows) {
      const expectedValidated = Number(row.CoreMeasurementID) === violatingID ? 0 : 1;
      expect(mysqlBitToNumber(row.IsValidated)).toBe(expectedValidated);
    }

    // Refreshed summary view exposes the validation error on the violating row.
    const [summaryRows] = await connection.query<RowDataPacket[]>('SELECT IsValidated, Errors FROM measurementssummary WHERE CoreMeasurementID = ?', [
      violatingID
    ]);
    console.log(`[measurementssummary] violating row: ${JSON.stringify(summaryRows[0])}`);
    expect(summaryRows).toHaveLength(1);
    expect(mysqlBitToNumber(summaryRows[0].IsValidated)).toBe(0);
    expect(summaryRows[0].Errors).not.toBeNull();
    expect(String(summaryRows[0].Errors)).toContain(ABNORMAL_DBH_PROCEDURE);
  }, 120000);

  // -------------------------------------------------------------------------
  // 4. Step failure — a validation with invalid SQL causes a step failure,
  //    the run record is finalized 'failed' (not stranded 'running'), the
  //    remaining steps still execute, and failedSteps is bounded to totalSteps.
  // -------------------------------------------------------------------------

  it('marks run failed when a validation definition is corrupted, without stranding a running record', async () => {
    await stageAndIngestRows(buildCleanFixtureRows(), EXPECTED_CLEAN_ROW_COUNT);

    // Sanity: target validation exists and is enabled.
    const [targetDef] = await connection.query<RowDataPacket[]>(
      'SELECT ValidationID, ProcedureName, Definition FROM sitespecificvalidations WHERE ValidationID = ?',
      [ABNORMAL_DBH_VALIDATION_ID]
    );
    expect(targetDef).toHaveLength(1);
    expect(
      mysqlBitToNumber(
        (await connection.query<RowDataPacket[]>('SELECT IsEnabled FROM sitespecificvalidations WHERE ValidationID = ?', [ABNORMAL_DBH_VALIDATION_ID]))[0][0]
          .IsEnabled
      )
    ).toBe(1);

    const originalDefinition = String(targetDef[0].Definition);
    const INVALID_SQL = 'THIS IS NOT VALID SQL !!!';

    // Corrupt the definition to guaranteed-unparseable SQL so runValidation
    // takes the non-retryable error path and returns false.
    await connection.query('UPDATE sitespecificvalidations SET Definition = ? WHERE ValidationID = ?', [INVALID_SQL, ABNORMAL_DBH_VALIDATION_ID]);
    console.log(`[step-failure] corrupted ValidationID=${ABNORMAL_DBH_VALIDATION_ID} definition to invalid SQL`);

    const expectedTotalSteps = await computeExpectedTotalSteps();

    let summary: Awaited<ReturnType<typeof runCensusValidations>>;
    try {
      summary = await runCensusValidations(connectionManager, { schema, plotID, censusID });
    } finally {
      // Always restore the definition, even if the orchestrator itself throws.
      await connection.query('UPDATE sitespecificvalidations SET Definition = ? WHERE ValidationID = ?', [originalDefinition, ABNORMAL_DBH_VALIDATION_ID]);
      console.log(`[step-failure] restored ValidationID=${ABNORMAL_DBH_VALIDATION_ID} definition`);
    }

    console.log(`[summary] ${JSON.stringify(summary)}`);

    // At least the corrupted step must be counted as failed.
    expect(summary.failedSteps).toBeGreaterThanOrEqual(1);
    // failedSteps must never exceed the task count — post-pass errors don't bleed in.
    expect(summary.failedSteps).toBeLessThanOrEqual(summary.totalSteps);
    // The error list must mention the corrupted validation by name.
    const mentionsValidation = summary.errors.some(e => e.includes(ABNORMAL_DBH_PROCEDURE));
    expect(mentionsValidation).toBe(true);
    // The orchestrator still attempted every task.
    expect(summary.totalSteps).toBe(expectedTotalSteps);
    // Conflict must not be set.
    expect(summary.conflict).toBe(false);

    // The run record must be finalized — never left in 'running' state.
    const runs = await fetchValidationRuns();
    console.log(`[validation_runs] ${JSON.stringify(runs)}`);
    expect(runs).toHaveLength(1);
    expect(runs[0].Status).toBe('failed');
    expect(runs[0].CompletedAt).not.toBeNull();
    // FailedSteps in the record must also be bounded to the task count.
    expect(Number(runs[0].FailedSteps)).toBeGreaterThanOrEqual(1);
    expect(Number(runs[0].FailedSteps)).toBeLessThanOrEqual(expectedTotalSteps);

    // ErrorMessages is a JSON column — mysql2 auto-parses it; accept either
    // an already-parsed array or a raw JSON string.
    const rawMessages = runs[0].ErrorMessages;
    const recordErrors: string[] = Array.isArray(rawMessages) ? rawMessages : typeof rawMessages === 'string' ? (JSON.parse(rawMessages) as string[]) : [];
    expect(recordErrors.length).toBeGreaterThan(0);
    const recordMentionsValidation = recordErrors.some((e: string) => e.includes(ABNORMAL_DBH_PROCEDURE));
    expect(recordMentionsValidation).toBe(true);
  }, 120000);

  // -------------------------------------------------------------------------
  // 3. Conflict — fresh running row short-circuits the orchestrator
  // -------------------------------------------------------------------------

  it('returns conflict without executing when a fresh running validation_runs row exists', async () => {
    await stageAndIngestRows(buildCleanFixtureRows(), EXPECTED_CLEAN_ROW_COUNT);

    // Simulate another client's active run (StartedAt = NOW() → well under the
    // 15-minute stale threshold).
    const [insertResult] = await connection.query<any>(`INSERT INTO validation_runs (PlotID, CensusID, TotalSteps, Status) VALUES (?, ?, 7, 'running')`, [
      plotID,
      censusID
    ]);
    const existingRunID = Number(insertResult.insertId);
    console.log(`[conflict] inserted running row RunID=${existingRunID}`);

    let onStepCalls = 0;
    const summary = await runCensusValidations(connectionManager, {
      schema,
      plotID,
      censusID,
      onStep: async () => {
        onStepCalls++;
      }
    });

    console.log(`[summary] ${JSON.stringify(summary)} onStepCalls=${onStepCalls}`);
    expect(summary).toEqual({ totalSteps: 0, failedSteps: 0, errors: [], conflict: true });
    expect(onStepCalls).toBe(0);

    // The pre-existing running row is untouched and no second row was created.
    const runs = await fetchValidationRuns();
    console.log(`[validation_runs] ${JSON.stringify(runs)}`);
    expect(runs).toHaveLength(1);
    expect(Number(runs[0].RunID)).toBe(existingRunID);
    expect(runs[0].Status).toBe('running');
    expect(runs[0].CurrentStep).toBeNull();

    // Nothing executed: no validation errors written, no rows validated, no views refreshed.
    const validationErrors = await fetchUnresolvedValidationErrors();
    expect(validationErrors).toHaveLength(0);

    const [validatedRows] = await connection.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM coremeasurements WHERE CensusID = ? AND IsValidated IS NOT NULL',
      [censusID]
    );
    expect(Number(validatedRows[0].count)).toBe(0);

    const [summaryCount] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM measurementssummary WHERE PlotID = ? AND CensusID = ?', [
      plotID,
      censusID
    ]);
    expect(Number(summaryCount[0].count)).toBe(0);
  }, 60000);
});
