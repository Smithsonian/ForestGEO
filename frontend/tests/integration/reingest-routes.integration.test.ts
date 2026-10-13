import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import {
  cleanupTestMeasurements,
  getFailedMeasurements,
  insertDirectMeasurements,
  insertTestMeasurements,
  runBulkIngestion,
  setupTestDatabase,
  teardownTestDatabase,
  type TestData,
  type TestDatabaseConfig
} from '../setup/local-db-setup';
import { assertIngestionOutcome, INGESTION_ERROR_CODE, readIngestionOutcome } from '../setup/ingestion-outcome';
import { buildFailedMeasurementsSelectQuery, INGESTION_ERROR_SOURCE, VALIDATION_ERROR_SOURCE } from '@/config/measurementerrors';
import { HTTPResponses } from '@/config/macros';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';

// Not exposed by tests/setup/ingestion-outcome.ts's INGESTION_ERROR_CODE map (that file
// is outside this task's allowed-file list, and these three are deliberately excluded
// from measurementerrors.ts's resolvable-codes contract — see issue #307 F3/F4) —
// declared locally so the regression below never hardcodes a bare string.
const FIELD_TOO_LONG_ERROR_CODE = 'FIELD_TOO_LONG';
const QUADRAT_MISMATCH_ERROR_CODE = 'QUADRAT_MISMATCH';
const COORDINATE_DRIFT_ERROR_CODE = 'COORDINATE_DRIFT';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  batchCounter: 0,
  /** The one transaction the stub has open, so every executeQuery can be checked against it. */
  activeTransactionID: null as string | null
}));

// Grant a 'global' role so the route's auth() gate and assertSchemaAccess pass
// without a live session. Mocking @/auth also keeps the real next-auth module
// (whose lib/env.js imports the extensionless `next/server` subpath) from being
// loaded by Node's native ESM resolver, which cannot resolve it.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

vi.mock('@/lib/db/connectionmanager', () => {
  const TRANSACTION_ID = 'test-transaction-id';

  // Production routes a query with no (or another) transaction ID to a different pooled
  // connection, outside the route's transaction. The stub shares one connection, so it
  // must reject such a query instead of silently running it inside the transaction.
  function assertBoundToActiveTransaction(query: string, transactionID: string | undefined) {
    const active = sharedState.activeTransactionID ?? undefined;
    if (active !== transactionID) {
      throw new Error(
        `executeQuery transaction mismatch: active=${active ?? 'none'} received=${transactionID ?? 'none'} for: ${query.replace(/\s+/g, ' ').slice(0, 120)}`
      );
    }
  }

  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
      assertBoundToActiveTransaction(query, transactionID);

      const [rows] = await sharedState.connection.query(query, params as any[]);
      return rows;
    },
    discardTransaction: (transactionID: string, reason: string) => {
      throw new Error(`discardTransaction must not run in this suite (transaction ${transactionID}: ${reason})`);
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined,
    acquireApplicationLock: async () => true,
    withTransaction: async (fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown>; id: string }) => Promise<unknown>) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }

      // Mirror the real TxExecutor contract: tx.query runs on the (shared test)
      // transaction connection; tx.id is the migration-bridge string id.
      const tx = {
        query: async (sql: string, params?: unknown[]) => {
          const [rows] = await sharedState.connection!.query(sql, params as any[]);
          return rows;
        },
        id: TRANSACTION_ID
      };

      await sharedState.connection.beginTransaction();
      sharedState.activeTransactionID = TRANSACTION_ID;
      try {
        const result = await fn(tx);
        await sharedState.connection.commit();
        return result;
      } catch (error) {
        await sharedState.connection.rollback();
        throw error;
      } finally {
        sharedState.activeTransactionID = null;
      }
    },
    beginTransaction: async () => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }

      await sharedState.connection.beginTransaction();
      sharedState.activeTransactionID = TRANSACTION_ID;
      return TRANSACTION_ID;
    },
    commitTransaction: async () => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }

      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async () => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }

      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
    }
  };

  return {
    default: {
      getInstance: () => manager
    }
  };
});

vi.mock('@/lib/contextvalidation', () => ({
  validateContextualValues: async () => ({ success: false })
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

vi.mock('@/config/utils', async importOriginal => {
  const actual = await importOriginal<typeof import('@/config/utils')>();
  return {
    ...actual,
    generateShortBatchID: () => {
      sharedState.batchCounter += 1;
      return `test-batch-id-${sharedState.batchCounter}`;
    }
  };
});

import { GET as bulkReingestGet, POST as bulkReingestPost } from '@/app/api/reingest/[schema]/[plotID]/[censusID]/route';
import { GET as singleReingestGet } from '@/app/api/reingestsinglefailure/[schema]/[targetRowID]/route';
import { GET as validateFailedGet } from '@/app/api/validatefailed/[schema]/[plotID]/[censusID]/route';
import ConnectionManager from '@/lib/db/connectionmanager';

interface FailedRowSnapshot {
  CoreMeasurementID: number;
  UploadFileID: string | null;
  UploadBatchID: string | null;
  SourceRowIndex: number | null;
  RawSpCode: string | null;
  StemGUID: number | null;
}

describe('Reingest route integration tests', () => {
  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    sharedState.connection = connection;
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    sharedState.batchCounter = 0;
    sharedState.activeTransactionID = null;
    await cleanupTestMeasurements(connection, testData, {
      additionalTables: ['uploadintegrityalerts', 'uploadmetrics']
    });
    vi.clearAllMocks();
  });

  function makeBulkRequest(method: 'GET' | 'POST') {
    return new Request(`http://localhost/api/reingest/${config.database}/${testData.plots[0].plotID}/${testData.census[0].censusID}`, {
      method
    }) as any;
  }

  function makeBulkParams() {
    return {
      params: Promise.resolve({
        schema: config.database,
        plotID: String(testData.plots[0].plotID),
        censusID: String(testData.census[0].censusID)
      })
    } as any;
  }

  function makeSingleRequest(targetRowID: number) {
    return new Request(`http://localhost/api/reingestsinglefailure/${config.database}/${targetRowID}`) as any;
  }

  function makeSingleParams(targetRowID: number) {
    return {
      params: Promise.resolve({
        schema: config.database,
        targetRowID: String(targetRowID)
      })
    } as any;
  }

  async function createInvalidSpeciesFailures(count: number): Promise<{
    fileID: string;
    batchID: string;
    failedRows: Array<{ FailedMeasurementID: number; FileID: string; BatchID: string; Tag: string; StemTag: string; FailureReasons: string }>;
    validSpeciesCode: string;
    quadratName: string;
  }> {
    const validSpeciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
    const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;

    if (!validSpeciesCode || !quadratName) {
      throw new Error('Test setup failed: missing species or quadrat data');
    }

    const measurements = Array.from({ length: count }, (_, idx) => ({
      treeTag: `REINGEST_FAIL_${idx + 1}`,
      stemTag: 'S001',
      speciesCode: `BADSPECIES_${idx + 1}`,
      quadratName,
      x: 10 + idx,
      y: 20 + idx,
      dbh: 100 + idx,
      hom: 1.3,
      date: '2024-06-15',
      codes: 'A'
    }));

    // Seed matching trees/stems in the census first so that correcting only the
    // species code produces a genuinely reingestable row during the route test.
    await insertDirectMeasurements(
      connection,
      testData,
      testData.census[0].censusID,
      measurements.map((measurement, idx) => ({
        treeTag: measurement.treeTag,
        stemTag: measurement.stemTag,
        speciesCode: validSpeciesCode,
        quadratName: measurement.quadratName,
        x: measurement.x,
        y: measurement.y,
        dbh: 50 + idx,
        hom: measurement.hom,
        date: '2023-06-15',
        codes: measurement.codes
      }))
    );

    const { fileID, batchID } = await insertTestMeasurements(connection, testData, measurements);
    const ingestionResult = await runBulkIngestion(connection, fileID, batchID);

    expect(ingestionResult.batch_failed).toBe(false);

    const failedRows = await getFailedMeasurements(connection, { fileID, batchID });
    expect(failedRows).toHaveLength(count);

    return { fileID, batchID, failedRows, validSpeciesCode, quadratName };
  }

  async function getCoreMeasurementSnapshots(ids: number[]): Promise<FailedRowSnapshot[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID, UploadFileID, UploadBatchID, SourceRowIndex, RawSpCode, StemGUID
       FROM coremeasurements
       WHERE CoreMeasurementID IN (?)
       ORDER BY CoreMeasurementID`,
      [ids]
    );

    return rows as FailedRowSnapshot[];
  }

  async function getMeasurementAttributes(ids: number[]): Promise<Map<number, string[]>> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID, Code
       FROM cmattributes
       WHERE CoreMeasurementID IN (?)
       ORDER BY CoreMeasurementID, Code`,
      [ids]
    );

    const attributeMap = new Map<number, string[]>();
    for (const row of rows) {
      const coreMeasurementID = Number(row.CoreMeasurementID);
      const codes = attributeMap.get(coreMeasurementID) || [];
      codes.push(String(row.Code));
      attributeMap.set(coreMeasurementID, codes);
    }

    return attributeMap;
  }

  interface ErrorLogSnapshotRow {
    MeasurementID: number;
    ErrorSource: string;
    ErrorCode: string;
    IsResolved: number;
    ResolvedAt: string | null;
  }

  // Snapshot of every measurement_error_log row for the given measurement
  // IDs, across BOTH ErrorSource values — MeasurementID/ErrorSource/
  // ErrorCode/IsResolved/ResolvedAt only; CreatedAt is intentionally NOT
  // selected, so this is NOT a full-row/all-column snapshot. Used to prove a
  // validatefailed call left an unrelated or untouched link unchanged across
  // every column this snapshot does compare (issue #307 F2b/F2c), not just
  // "still present but modified".
  async function loadErrorLogSnapshot(measurementIDs: number[]): Promise<ErrorLogSnapshotRow[]> {
    if (measurementIDs.length === 0) return [];
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT mel.MeasurementID, me.ErrorSource, me.ErrorCode, mel.IsResolved, mel.ResolvedAt
       FROM measurement_error_log mel
       JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE mel.MeasurementID IN (?)
       ORDER BY mel.MeasurementID, me.ErrorSource, me.ErrorCode`,
      [measurementIDs]
    );
    return rows as ErrorLogSnapshotRow[];
  }

  // Executes the EXACT same query builder the fixeddata failedmeasurements
  // grid route uses, scoped to one row — so a "grid-query agreement" assertion
  // is proof the two call sites genuinely share logic, not a coincidence of
  // independently-duplicated SQL.
  async function loadGridRow(failedMeasurementID: number): Promise<RowDataPacket | undefined> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM (${buildFailedMeasurementsSelectQuery(config.database)}) fm WHERE fm.FailedMeasurementID = ?`,
      [failedMeasurementID]
    );
    return rows[0];
  }

  async function countUnresolvedIngestionErrors(ids: number[]): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT cm.CoreMeasurementID) AS count
       FROM coremeasurements cm
       JOIN measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
       JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE cm.CoreMeasurementID IN (?)
         AND me.ErrorSource = 'ingestion'
         AND mel.IsResolved = FALSE`,
      [ids]
    );

    return Number(rows[0]?.count || 0);
  }

  // Seeds a measurement_error_log row directly against the catalog entry for
  // (errorSource, errorCode) — reusing the same ON DUPLICATE KEY UPDATE +
  // LAST_INSERT_ID() idiom ensureMeasurementErrorDefinition uses in
  // config/measurementerrors.ts, so a pre-existing catalog row (every
  // 'ingestion' code is already seeded by db/sql/tablestructures.sql) is
  // reused rather than duplicated, while a genuinely new (source, code) pair
  // — like the 'validation' INVALID_SPECIES sentinel used below — is
  // created on demand. Used to set up HISTORICAL fixture state directly,
  // never to simulate what revalidateEditedFailedRow would itself derive.
  async function seedErrorLink(
    measurementID: number,
    errorSource: typeof INGESTION_ERROR_SOURCE | typeof VALIDATION_ERROR_SOURCE,
    errorCode: string
  ): Promise<void> {
    await connection.query(
      `INSERT INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE ErrorID = LAST_INSERT_ID(ErrorID)`,
      [errorSource, errorCode, `Seeded ${errorSource} fixture error: ${errorCode}`]
    );
    const [errorIDRows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS ErrorID');
    const errorID = errorIDRows[0].ErrorID;

    await connection.query('INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved, ResolvedAt) VALUES (?, ?, FALSE, NULL)', [
      measurementID,
      errorID
    ]);
  }

  it('POST stages unresolved ingestion failures into temporarymeasurements without removing originals', async () => {
    const { fileID, failedRows } = await createInvalidSpeciesFailures(2);
    const originalIDs = failedRows.map(row => row.FailedMeasurementID);

    const response = await bulkReingestPost(makeBulkRequest('POST'), makeBulkParams());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      rowsMoved: 2,
      fileID: 'reingestion.csv',
      batchID: 'test-batch-id-1',
      originalsRetained: true
    });

    const [tempRows] = await connection.query<RowDataPacket[]>(
      `SELECT id, FileID, BatchID, PlotID, CensusID, SpeciesCode
       FROM temporarymeasurements
       WHERE FileID = 'reingestion.csv'`
    );
    expect(tempRows).toHaveLength(2);
    expect(tempRows.every(row => row.FileID === 'reingestion.csv')).toBe(true);
    expect(tempRows.every(row => row.BatchID === 'test-batch-id-1')).toBe(true);

    const originals = await getCoreMeasurementSnapshots(originalIDs);
    expect(originals).toHaveLength(2);
    expect(originals.every(row => row.UploadFileID === fileID)).toBe(true);

    const remainingFailed = await getFailedMeasurements(connection, { fileID });
    expect(remainingFailed.map(row => row.FailedMeasurementID).sort((a, b) => a - b)).toEqual([...originalIDs].sort((a, b) => a - b));
  });

  it('GET reconciles mixed-success reingestion batches back onto the original rows', async () => {
    const { fileID, batchID, failedRows, validSpeciesCode } = await createInvalidSpeciesFailures(3);
    const originalIDs = failedRows.map(row => row.FailedMeasurementID);
    const before = await getCoreMeasurementSnapshots(originalIDs);

    await connection.query('UPDATE coremeasurements SET RawSpCode = ? WHERE CoreMeasurementID IN (?, ?)', [validSpeciesCode, originalIDs[0], originalIDs[1]]);

    const response = await bulkReingestGet(makeBulkRequest('GET'), makeBulkParams());
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);

    expect(body).toMatchObject({
      responseMessage: 'Reingestion completed',
      totalProcessed: 3,
      successfulReingestions: 2,
      remainingFailures: 1
    });

    const after = await getCoreMeasurementSnapshots(originalIDs);
    const resolvedRows = after.filter(row => row.StemGUID !== null);
    const unresolvedRows = after.filter(row => row.StemGUID === null);

    expect(resolvedRows).toHaveLength(2);
    expect(unresolvedRows).toHaveLength(1);

    for (const row of after) {
      const original = before.find(prev => prev.CoreMeasurementID === row.CoreMeasurementID)!;
      expect(row.UploadFileID).toBe(original.UploadFileID);
      expect(row.UploadBatchID).toBe(original.UploadBatchID);
      expect(row.SourceRowIndex).toBe(original.SourceRowIndex);
    }

    const attributeMap = await getMeasurementAttributes(resolvedRows.map(row => row.CoreMeasurementID));
    for (const row of resolvedRows) {
      expect(attributeMap.get(row.CoreMeasurementID)).toEqual(['A']);
    }

    const unresolvedIngestionErrors = await countUnresolvedIngestionErrors(originalIDs);
    expect(unresolvedIngestionErrors).toBe(1);

    const [transientRows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count
       FROM coremeasurements
       WHERE UploadFileID = 'reingestion.csv'
         AND UploadBatchID = 'test-batch-id-1'`
    );
    expect(Number(transientRows[0]?.count || 0)).toBe(0);

    const [stagedRows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count
       FROM temporarymeasurements
       WHERE FileID = 'reingestion.csv'
         AND BatchID = 'test-batch-id-1'`
    );
    expect(Number(stagedRows[0]?.count || 0)).toBe(0);

    const remainingFailed = await getFailedMeasurements(connection, { fileID, batchID });
    expect(remainingFailed).toHaveLength(1);
  });

  it('single-row reingest updates the original row in place and leaves no transient rows behind', async () => {
    const { fileID, batchID, failedRows, validSpeciesCode } = await createInvalidSpeciesFailures(1);
    const targetRowID = failedRows[0].FailedMeasurementID;
    const [before] = await getCoreMeasurementSnapshots([targetRowID]);

    await connection.query('UPDATE coremeasurements SET RawSpCode = ? WHERE CoreMeasurementID = ?', [validSpeciesCode, targetRowID]);

    const response = await singleReingestGet(makeSingleRequest(targetRowID), makeSingleParams(targetRowID));
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ message: 'Success' });

    const [after] = await getCoreMeasurementSnapshots([targetRowID]);
    expect(after.StemGUID, JSON.stringify(after)).not.toBeNull();
    expect(after.UploadFileID).toBe(before.UploadFileID);
    expect(after.UploadBatchID).toBe(before.UploadBatchID);
    expect(after.SourceRowIndex).toBe(before.SourceRowIndex);

    const attributeMap = await getMeasurementAttributes([targetRowID]);
    expect(attributeMap.get(targetRowID)).toEqual(['A']);

    const unresolvedIngestionErrors = await countUnresolvedIngestionErrors([targetRowID]);
    expect(unresolvedIngestionErrors).toBe(0);

    const [transientRows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count
       FROM coremeasurements
       WHERE UploadFileID = 'single_row_file.csv'
         AND UploadBatchID = 'test-batch-id-1'`
    );
    expect(Number(transientRows[0]?.count || 0)).toBe(0);

    const [stagedRows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count
       FROM temporarymeasurements
       WHERE FileID = 'single_row_file.csv'
         AND BatchID = 'test-batch-id-1'`
    );
    expect(Number(stagedRows[0]?.count || 0)).toBe(0);

    const remainingFailed = await getFailedMeasurements(connection, { fileID, batchID });
    expect(remainingFailed).toHaveLength(0);
  });

  describe('validatefailed route integration tests (issue #307: retention contract)', () => {
    it('F2a: a real duplicate parked by bulk ingestion stays unresolved through validatefailed, and the fixeddata grid query agrees', async () => {
      const censusID = testData.census[0].censusID;
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;
      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Two byte-identical rows in the same file/batch: bulkingestionprocess's
      // Stage 2a dedup key (TreeTag/StemTag/SpeciesCode/QuadratName/LocalX/
      // LocalY/DBH/HOM/MeasurementDate) collapses them — the lower id ingests,
      // the other is parked as a genuine DUPLICATE_ENTRY failure. Nothing here
      // fabricates an error-log row directly.
      const duplicateRow = {
        treeTag: 'VFDUP1',
        stemTag: '1',
        speciesCode,
        quadratName,
        x: 11,
        y: 11,
        dbh: 44,
        hom: 1.3,
        date: '2024-06-15',
        codes: 'A'
      };

      const { fileID, batchID } = await insertTestMeasurements(connection, testData, [duplicateRow, { ...duplicateRow }], {
        censusID,
        fileID: 'vf_dup_file',
        batchID: 'vf_dup_batch'
      });

      const ingestionResult = await runBulkIngestion(connection, fileID, batchID);
      expect(ingestionResult.batch_failed, ingestionResult.message).toBe(false);

      const outcome = await readIngestionOutcome(connection, { fileID, batchID, censusID });
      assertIngestionOutcome(outcome, {
        successfulRows: 1,
        failedRows: 1,
        errorCodes: [INGESTION_ERROR_CODE.DUPLICATE_ENTRY]
      });

      const failedRows = await getFailedMeasurements(connection, { fileID, batchID });
      expect(failedRows).toHaveLength(1);
      const duplicateMeasurementID = failedRows[0].FailedMeasurementID;

      const before = await loadErrorLogSnapshot([duplicateMeasurementID]);
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({ ErrorSource: 'ingestion', ErrorCode: INGESTION_ERROR_CODE.DUPLICATE_ENTRY, IsResolved: 0 });

      const response = await validateFailedGet(makeBulkRequest('GET'), makeBulkParams());
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(HTTPResponses.OK);

      expect(body.totalRows).toBe(1);
      expect(body.readyCount).toBe(0);
      expect(body.failingCount).toBe(1);

      const detail = body.details.find((d: any) => d.failedMeasurementID === duplicateMeasurementID);
      expect(detail, JSON.stringify(body.details)).toBeDefined();
      expect(detail.isReady).toBe(false);
      expect(detail.currentFailureReasons).toBe('Duplicate measurement row detected');

      // Retention contract: the duplicate link's IsResolved/ResolvedAt must
      // stay completely unchanged — revalidateEditedFailedRow never checks
      // for duplicates, so DUPLICATE_ENTRY can never enter checkedCodes and
      // can never be a candidate for resolveCheckedMeasurementErrors.
      const after = await loadErrorLogSnapshot([duplicateMeasurementID]);
      expect(after).toEqual(before);

      // Grid-query agreement: the fixeddata failedmeasurements grid
      // (app/api/fixeddata/.../route.ts) and this route are both built from
      // buildFailedMeasurementsSelectQuery, so running that exact builder
      // directly must report the identical failing/ready state.
      const gridRow = await loadGridRow(duplicateMeasurementID);
      expect(gridRow, 'grid query must surface the parked duplicate row').toBeDefined();
      expect(gridRow!.CurrentFailureReasons).toBe('Duplicate measurement row detected');
      expect(gridRow!.FailureReasons).toBe('Duplicate measurement row detected');
      expect(Number(gridRow!.PlotID)).toBe(testData.plots[0].plotID);
      expect(Number(gridRow!.CensusID)).toBe(censusID);
    });

    it('F2b: STEM_RESOLUTION_FAILED survives a row-only validation refresh (never a candidate for resolution)', async () => {
      const censusID = testData.census[0].censusID;
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;
      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Reproduces the real STEM_RESOLUTION_FAILED path (storedprocedures.sql):
      // an active current-census tree whose only matching stem is inactive
      // blocks insertion of the measurement.
      const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species WHERE SpeciesCode = ?', [speciesCode]);
      const [quadratRows] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE PlotID = ? AND QuadratName = ?', [
        testData.plots[0].plotID,
        quadratName
      ]);
      const speciesID = speciesRows[0].SpeciesID;
      const quadratID = quadratRows[0].QuadratID;

      await connection.query('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', ['VFINACT1', speciesID, censusID]);
      const [treeRows] = await connection.query<RowDataPacket[]>('SELECT TreeID FROM trees WHERE TreeTag = ? AND SpeciesID = ? AND CensusID = ?', [
        'VFINACT1',
        speciesID,
        censusID
      ]);
      const treeID = treeRows[0].TreeID;

      await connection.query('INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, ?, ?, 0)', [
        treeID,
        quadratID,
        censusID,
        'S001',
        7.0,
        7.0
      ]);

      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'VFINACT1',
            stemTag: 'S001',
            speciesCode,
            quadratName,
            x: 7.0,
            y: 7.0,
            dbh: 130.0,
            hom: 1.3,
            date: '2024-06-15',
            codes: 'A'
          }
        ],
        { censusID, fileID: 'vf_stemfail_file', batchID: 'vf_stemfail_batch' }
      );

      const ingestionResult = await runBulkIngestion(connection, fileID, batchID);
      expect(ingestionResult.batch_failed, ingestionResult.message).toBe(false);

      const failedRows = await getFailedMeasurements(connection, { fileID, batchID });
      expect(failedRows).toHaveLength(1);
      const measurementID = failedRows[0].FailedMeasurementID;

      const before = await loadErrorLogSnapshot([measurementID]);
      expect(before.map(row => row.ErrorCode)).toContain('STEM_RESOLUTION_FAILED');

      const response = await validateFailedGet(makeBulkRequest('GET'), makeBulkParams());
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(HTTPResponses.OK);

      const detail = body.details.find((d: any) => d.failedMeasurementID === measurementID);
      expect(detail, JSON.stringify(body.details)).toBeDefined();
      expect(detail.isReady).toBe(false);
      expect(detail.currentFailureReasons).toContain('Stem resolution failed after stem materialization');

      // The link must be exactly as it was: STEM_RESOLUTION_FAILED is never
      // checked by revalidateEditedFailedRow, so it can never be resolved.
      const after = await loadErrorLogSnapshot([measurementID]);
      expect(after).toEqual(before);
    });

    it('F2b: a corrected INVALID_SPECIES clears via validatefailed without requiring a full reingest, and never touches an independent validation-source INVALID_SPECIES link on the same row', async () => {
      const { failedRows, validSpeciesCode } = await createInvalidSpeciesFailures(1);
      const targetRowID = failedRows[0].FailedMeasurementID;

      const before = await loadErrorLogSnapshot([targetRowID]);
      expect(before.map(row => row.ErrorCode)).toContain('INVALID_SPECIES');

      // An independent 'validation'-source finding using the SAME ErrorCode
      // string, on the SAME row. measurement_errors' unique key is
      // (ErrorSource, ErrorCode), so this is a genuinely distinct catalog
      // entry/link from the 'ingestion' INVALID_SPECIES above. Seeded so a
      // missing ErrorSource predicate in EITHER the resolve UPDATE or the
      // fetch SELECT (issue #307 F2 item 3) would be caught: without that
      // predicate this independent link would wrongly resolve too, which the
      // earlier version of this test — exercising the code only on a
      // SUCCESSFULLY ingested, unrelated row that validatefailed excludes
      // anyway — could never have detected.
      await seedErrorLink(targetRowID, VALIDATION_ERROR_SOURCE, 'INVALID_SPECIES');
      const beforeWithValidation = await loadErrorLogSnapshot([targetRowID]);
      const validationBefore = beforeWithValidation.find(row => row.ErrorSource === 'validation');
      expect(validationBefore, JSON.stringify(beforeWithValidation)).toBeDefined();
      expect(validationBefore!.IsResolved).toBe(0);
      expect(validationBefore!.ResolvedAt).toBeNull();

      await connection.query('UPDATE coremeasurements SET RawSpCode = ? WHERE CoreMeasurementID = ?', [validSpeciesCode, targetRowID]);

      const response = await validateFailedGet(makeBulkRequest('GET'), makeBulkParams());
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(HTTPResponses.OK);

      const detail = body.details.find((d: any) => d.failedMeasurementID === targetRowID);
      expect(detail, JSON.stringify(body.details)).toBeDefined();
      // isReady is computed from ingestion-source errors only
      // (refreshIngestionErrorsForMeasurement -> fetchUnresolvedMeasurementErrors
      // with source='ingestion'); the still-unresolved validation-source link
      // must NOT prevent readiness.
      expect(detail.isReady).toBe(true);
      expect(detail.currentFailureReasons).toBeNull();

      const unresolvedCount = await countUnresolvedIngestionErrors([targetRowID]);
      expect(unresolvedCount).toBe(0);

      const afterAll = await loadErrorLogSnapshot([targetRowID]);

      // The ingestion occurrence resolved...
      const ingestionAfter = afterAll.find(row => row.ErrorSource === 'ingestion' && row.ErrorCode === 'INVALID_SPECIES');
      expect(ingestionAfter, JSON.stringify(afterAll)).toBeDefined();
      expect(ingestionAfter!.IsResolved).toBe(1);
      expect(ingestionAfter!.ResolvedAt).not.toBeNull();

      // ...but the validation occurrence is completely unchanged: same
      // IsResolved, same (null) ResolvedAt as before the call.
      const validationAfter = afterAll.find(row => row.ErrorSource === 'validation');
      expect(validationAfter).toEqual(validationBefore);

      // validatefailed only revalidates and resolves error links — it never
      // writes StemGUID or otherwise moves the row through real reingestion.
      const [snapshot] = await getCoreMeasurementSnapshots([targetRowID]);
      expect(snapshot.StemGUID).toBeNull();
    });

    it("F2b: refreshing one row never touches a different row's link or a validation-source link on an unrelated measurement", async () => {
      const censusID = testData.census[0].censusID;
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;
      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // An unrelated, SUCCESSFULLY ingested measurement carrying a genuine
      // validation-source (attribute-code, STAGE 9) error. 'A' is a seeded
      // active attribute; 'ZZ' is not, so the row ingests but logs a
      // validation/14 error — completely outside the failed-row set
      // validatefailed queries (cm.StemGUID IS NULL).
      const { fileID: unrelatedFileID, batchID: unrelatedBatchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: 'VFVALID1',
            stemTag: '1',
            speciesCode,
            quadratName,
            x: 3,
            y: 3,
            dbh: 12,
            hom: 1.3,
            date: '2024-06-15',
            codes: 'A;ZZ'
          }
        ],
        { censusID, fileID: 'vf_unrelated_file', batchID: 'vf_unrelated_batch' }
      );
      const unrelatedResult = await runBulkIngestion(connection, unrelatedFileID, unrelatedBatchID);
      expect(unrelatedResult.batch_failed, unrelatedResult.message).toBe(false);

      const [unrelatedRows] = await connection.query<RowDataPacket[]>(
        `SELECT CoreMeasurementID FROM coremeasurements WHERE UploadFileID = ? AND UploadBatchID = ? AND StemGUID IS NOT NULL`,
        [unrelatedFileID, unrelatedBatchID]
      );
      expect(unrelatedRows).toHaveLength(1);
      const unrelatedMeasurementID = unrelatedRows[0].CoreMeasurementID;

      const unrelatedBefore = await loadErrorLogSnapshot([unrelatedMeasurementID]);
      expect(unrelatedBefore.map(row => row.ErrorSource)).toContain('validation');

      // Two genuinely failed rows in the same plot/census, both INVALID_SPECIES.
      // Correct only the first; the second's link must stay exactly as it was.
      const { failedRows, validSpeciesCode } = await createInvalidSpeciesFailures(2);
      const [rowA, rowB] = failedRows;

      const rowBBefore = await loadErrorLogSnapshot([rowB.FailedMeasurementID]);
      expect(rowBBefore.map(row => row.ErrorCode)).toContain('INVALID_SPECIES');

      await connection.query('UPDATE coremeasurements SET RawSpCode = ? WHERE CoreMeasurementID = ?', [validSpeciesCode, rowA.FailedMeasurementID]);

      const response = await validateFailedGet(makeBulkRequest('GET'), makeBulkParams());
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(HTTPResponses.OK);

      const detailA = body.details.find((d: any) => d.failedMeasurementID === rowA.FailedMeasurementID);
      const detailB = body.details.find((d: any) => d.failedMeasurementID === rowB.FailedMeasurementID);
      expect(detailA, JSON.stringify(body.details)).toBeDefined();
      expect(detailB, JSON.stringify(body.details)).toBeDefined();
      expect(detailA.isReady).toBe(true);
      expect(detailB.isReady).toBe(false);

      // Row B's own link is untouched by row A's refresh.
      const rowBAfter = await loadErrorLogSnapshot([rowB.FailedMeasurementID]);
      expect(rowBAfter).toEqual(rowBBefore);

      // The unrelated, successfully-ingested measurement's validation-source
      // link is untouched — it was never even in validatefailed's row set.
      const unrelatedAfter = await loadErrorLogSnapshot([unrelatedMeasurementID]);
      expect(unrelatedAfter).toEqual(unrelatedBefore);
    });

    it('F3+F4: a real FIELD_TOO_LONG parked by ingestion, plus historical cross-census QUADRAT_MISMATCH/COORDINATE_DRIFT on the same row, all survive validatefailed even after the tag is corrected — and remain recoverable via explicit reingest', async () => {
      const censusID = testData.census[0].censusID;
      const speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic;
      const quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat;
      if (!speciesCode || !quadratName) {
        throw new Error('Test setup failed: missing species or quadrat data');
      }

      // Step 1: a genuinely too-long TreeTag by BYTE length only. Eleven 'é'
      // characters is 11 JS/UTF-16 code units (fits every in-app length
      // check in config/measurementerrors.ts) but 22 UTF-8 bytes (the test
      // database is utf8mb4 — db/sql/tablestructures.sql) — over TreeTag's
      // 20-byte ingestion rule (db/sql/storedprocedures.sql:1977, which maps
      // to FIELD_TOO_LONG at line 2014). Every other field is valid, so
      // FIELD_TOO_LONG must be the row's ONLY ingestion failure.
      const overlongTag = 'é'.repeat(11);
      const { fileID, batchID } = await insertTestMeasurements(
        connection,
        testData,
        [
          {
            treeTag: overlongTag,
            stemTag: 'S001',
            speciesCode,
            quadratName,
            x: 5,
            y: 5,
            dbh: 100,
            hom: 1.3,
            date: '2024-06-15',
            codes: 'A'
          }
        ],
        { censusID, fileID: 'vf_f3f4_file', batchID: 'vf_f3f4_batch' }
      );

      const ingestionResult = await runBulkIngestion(connection, fileID, batchID);
      expect(ingestionResult.batch_failed, ingestionResult.message).toBe(false);

      const outcome = await readIngestionOutcome(connection, { fileID, batchID, censusID });
      assertIngestionOutcome(outcome, {
        successfulRows: 0,
        failedRows: 1,
        errorCodes: [FIELD_TOO_LONG_ERROR_CODE]
      });

      const failedRows = await getFailedMeasurements(connection, { fileID, batchID });
      expect(failedRows).toHaveLength(1);
      const targetRowID = failedRows[0].FailedMeasurementID;

      // Step 2: historical cross-census codes, seeded directly as fixture
      // state onto the SAME row (not derived from an actual cross-census
      // lookup — the row-only checker must never derive these; see F4).
      await seedErrorLink(targetRowID, INGESTION_ERROR_SOURCE, QUADRAT_MISMATCH_ERROR_CODE);
      await seedErrorLink(targetRowID, INGESTION_ERROR_SOURCE, COORDINATE_DRIFT_ERROR_CODE);

      const seeded = await loadErrorLogSnapshot([targetRowID]);
      expect(seeded.map(row => row.ErrorCode).sort()).toEqual([COORDINATE_DRIFT_ERROR_CODE, FIELD_TOO_LONG_ERROR_CODE, QUADRAT_MISMATCH_ERROR_CODE].sort());
      expect(seeded.every(row => row.IsResolved === 0)).toBe(true);

      // Step 3: validatefailed must retain all three, completely unchanged.
      const firstResponse = await validateFailedGet(makeBulkRequest('GET'), makeBulkParams());
      const firstBody = await firstResponse.json();
      expect(firstResponse.status, JSON.stringify(firstBody)).toBe(HTTPResponses.OK);

      const firstDetail = firstBody.details.find((d: any) => d.failedMeasurementID === targetRowID);
      expect(firstDetail, JSON.stringify(firstBody.details)).toBeDefined();
      expect(firstDetail.isReady).toBe(false);

      const afterFirstRefresh = await loadErrorLogSnapshot([targetRowID]);
      expect(afterFirstRefresh).toEqual(seeded);

      // Step 4: correct ONLY the tag, to a short ASCII value that trivially
      // satisfies both the real byte-length rule AND the JS row-checker's
      // String.length check. Even so, ALL THREE must remain unresolved:
      // FIELD_TOO_LONG (F3 — excluded from UNCONDITIONALLY_REVALIDATED_CODES
      // because this checker cannot reproduce the SQL LENGTH()/byte
      // semantics) and QUADRAT_MISMATCH/COORDINATE_DRIFT (F4 — the row-only
      // lookup is not PlotID- or PlotCensusNumber-scoped, so it is never
      // authoritative and can never enter checkedCodes).
      await connection.query('UPDATE coremeasurements SET RawTreeTag = ? WHERE CoreMeasurementID = ?', ['FIXEDTAG1', targetRowID]);

      const secondResponse = await validateFailedGet(makeBulkRequest('GET'), makeBulkParams());
      const secondBody = await secondResponse.json();
      expect(secondResponse.status, JSON.stringify(secondBody)).toBe(HTTPResponses.OK);

      const secondDetail = secondBody.details.find((d: any) => d.failedMeasurementID === targetRowID);
      expect(secondDetail, JSON.stringify(secondBody.details)).toBeDefined();
      expect(secondDetail.isReady).toBe(false);

      const afterSecondRefresh = await loadErrorLogSnapshot([targetRowID]);
      expect(afterSecondRefresh).toEqual(seeded);

      // Step 5: conservative retention must not block the real recovery
      // path. The existing explicit single-row reingest route re-runs full
      // bulkingestionprocess and, on success, resolves every unresolved
      // ingestion-source link for this row wholesale — it does not go
      // through revalidateEditedFailedRow / checkedCodes at all.
      const reingestResponse = await singleReingestGet(makeSingleRequest(targetRowID), makeSingleParams(targetRowID));
      const reingestBody = await reingestResponse.json();
      expect(reingestResponse.status, JSON.stringify(reingestBody)).toBe(HTTPResponses.OK);
      expect(reingestBody).toMatchObject({ message: 'Success' });

      const [afterReingest] = await getCoreMeasurementSnapshots([targetRowID]);
      expect(afterReingest.CoreMeasurementID).toBe(targetRowID);
      expect(afterReingest.StemGUID, JSON.stringify(afterReingest)).not.toBeNull();

      const unresolvedAfterReingest = await countUnresolvedIngestionErrors([targetRowID]);
      expect(unresolvedAfterReingest).toBe(0);

      const finalSnapshot = await loadErrorLogSnapshot([targetRowID]);
      expect(finalSnapshot.map(row => row.ErrorCode).sort()).toEqual(
        [COORDINATE_DRIFT_ERROR_CODE, FIELD_TOO_LONG_ERROR_CODE, QUADRAT_MISMATCH_ERROR_CODE].sort()
      );
      expect(finalSnapshot.every(row => row.IsResolved === 1)).toBe(true);
    });

    it('F2c: a failure on the post-write read-back rolls back every write this call already made, for both a resolve AND a fresh insert (atomic rollback)', async () => {
      const { failedRows, validSpeciesCode } = await createInvalidSpeciesFailures(1);
      const targetRowID = failedRows[0].FailedMeasurementID;

      // Correct the species (so INVALID_SPECIES is genuinely resolvable this
      // call) AND null out the tag (so a BRAND NEW MISSING_FIELD_TREETAG
      // fresh error is genuinely inserted this call). Fixing every input —
      // the earlier version of this test — guarantees refreshIngestionErrorsForMeasurement
      // never calls upsertMeasurementErrors at all, so a rollback of a
      // fresh INSERT could never have been exercised.
      await connection.query('UPDATE coremeasurements SET RawSpCode = ?, RawTreeTag = NULL WHERE CoreMeasurementID = ?', [validSpeciesCode, targetRowID]);

      const before = await loadErrorLogSnapshot([targetRowID]);
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({ ErrorCode: 'INVALID_SPECIES', IsResolved: 0 });

      const manager = ConnectionManager.getInstance() as unknown as {
        executeQuery: (query: string, params?: unknown[], transactionID?: string) => Promise<any>;
      };
      const originalExecuteQuery = manager.executeQuery.bind(manager);
      const INJECTED_FAILURE_MESSAGE = 'INJECTED TEST FAILURE: simulated post-write read-back failure';
      const INJECTED_FAILURE = new Error(INJECTED_FAILURE_MESSAGE);

      // Captured INSIDE the injected hook, from the same (mocked) connection
      // the route's own transaction is running on — so this is a genuine
      // in-transaction read of this call's own uncommitted writes, not a
      // separate session that would be blocked/see nothing. Declared here
      // (enclosing scope) and read by the assertions below OUTSIDE the
      // hook/route call: an `expect` thrown inside the hook would be
      // swallowed by the route's own catch block and turned into an
      // ordinary 500 response, letting a broken assertion pass silently.
      let observedDuringTransaction: ErrorLogSnapshotRow[] | null = null;
      let hookFired = false;

      // fetchUnresolvedMeasurementErrors (`SELECT ... ErrorCode AS errorCode`)
      // is the ONLY query matching this marker, and it runs strictly AFTER
      // resolveCheckedMeasurementErrors (UPDATE, resolves INVALID_SPECIES)
      // and upsertMeasurementErrors (INSERT, inserts MISSING_FIELD_TREETAG)
      // have already issued their writes for this row this call — so this
      // reproduces a failure that is realistically post-write.
      const spy = vi.spyOn(manager, 'executeQuery').mockImplementation(async (sql: string, params?: unknown[], transactionID?: string) => {
        if (sql.includes('ErrorCode AS errorCode')) {
          hookFired = true;
          observedDuringTransaction = await loadErrorLogSnapshot([targetRowID]);
          throw INJECTED_FAILURE;
        }
        return originalExecuteQuery(sql, params, transactionID);
      });

      try {
        const response = await validateFailedGet(makeBulkRequest('GET'), makeBulkParams());
        const body = await response.json();

        expect(response.status, JSON.stringify(body)).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
        expect(body.error).toContain(INJECTED_FAILURE_MESSAGE);
      } finally {
        spy.mockRestore();
      }

      // The hook must have actually run — otherwise every assertion below
      // about its captured snapshot would be vacuously true.
      expect(hookFired, 'injected read-back hook never fired; the mock match condition no longer matches the real query').toBe(true);
      expect(observedDuringTransaction, 'hook fired but never captured a snapshot').not.toBeNull();

      const midTransaction = observedDuringTransaction!;
      const midInvalidSpecies = midTransaction.find(row => row.ErrorCode === 'INVALID_SPECIES');
      const midMissingTreeTag = midTransaction.find(row => row.ErrorCode === 'MISSING_FIELD_TREETAG');
      expect(midInvalidSpecies, JSON.stringify(midTransaction)).toBeDefined();
      expect(midInvalidSpecies!.IsResolved, 'resolveCheckedMeasurementErrors must have already resolved INVALID_SPECIES before the injected failure').toBe(1);
      expect(midMissingTreeTag, JSON.stringify(midTransaction)).toBeDefined();
      expect(
        midMissingTreeTag!.IsResolved,
        'upsertMeasurementErrors must have already inserted the fresh MISSING_FIELD_TREETAG link before the injected failure'
      ).toBe(0);

      // After rollback: the resolve AND the fresh insert must both have been
      // undone — the link set is back to exactly what it was before the
      // call (INVALID_SPECIES only, still unresolved; the new
      // MISSING_FIELD_TREETAG link is completely ABSENT, not merely marked
      // unresolved).
      const after = await loadErrorLogSnapshot([targetRowID]);
      expect(after).toEqual(before);
      expect(after.find(row => row.ErrorCode === 'MISSING_FIELD_TREETAG')).toBeUndefined();
    });
  });

  it('rolls back the CALL output, original-row updates and error-link changes when reconciliation fails after the CALL', async () => {
    const REINGEST_FILE_ID = 'reingestion.csv';
    const REINGEST_BATCH_ID = 'test-batch-id-1';
    const RESTORE_ATTRIBUTES_MARKER = 'FROM reingestion_attributes';
    const RESOLVE_EXISTING_MARKER = 'JOIN reingestion_map rm ON rm.OriginalID = mel.MeasurementID';
    const INJECTED_FAILURE_MESSAGE = 'INJECTED TEST FAILURE: reconciliation failed after the CALL (#527)';

    const { failedRows, validSpeciesCode } = await createInvalidSpeciesFailures(2);
    const originalIDs = failedRows.map(row => row.FailedMeasurementID);
    await connection.query('UPDATE coremeasurements SET RawSpCode = ? WHERE CoreMeasurementID IN (?)', [validSpeciesCode, originalIDs]);

    const readOriginalRows = async (reader: Connection) =>
      (await reader.query<RowDataPacket[]>('SELECT * FROM coremeasurements WHERE CoreMeasurementID IN (?) ORDER BY CoreMeasurementID', [originalIDs]))[0];
    const readTreeStemCounts = async (reader: Connection) =>
      (await reader.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM trees) AS trees, (SELECT COUNT(*) FROM stems) AS stems'))[0][0];
    const readTransientRows = async (reader: Connection) =>
      Number(
        (
          await reader.query<RowDataPacket[]>(
            'SELECT COUNT(*) AS total FROM coremeasurements WHERE UploadFileID = ? AND UploadBatchID = ? AND StemGUID IS NOT NULL',
            [REINGEST_FILE_ID, REINGEST_BATCH_ID]
          )
        )[0][0].total
      );

    const originalRowsBefore = await readOriginalRows(connection);
    const attributesBefore = await getMeasurementAttributes(originalIDs);
    const errorLinksBefore = await loadErrorLogSnapshot(originalIDs);
    const treeStemBefore = await readTreeStemCounts(connection);
    const [stagedBefore] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ?', [REINGEST_FILE_ID]);
    expect(Number(stagedBefore[0].total), 'reingest staging must start empty').toBe(0);
    expect(originalRowsBefore.every(row => row.StemGUID === null)).toBe(true);

    const manager = ConnectionManager.getInstance() as unknown as {
      executeQuery: (query: string, params?: unknown[], transactionID?: string) => Promise<any>;
    };
    const originalExecuteQuery = manager.executeQuery.bind(manager);
    let resolvedTransientRowsAfterCall: number | null = null;
    let originalRowsDuringTransaction: RowDataPacket[] | null = null;
    let errorLinksDuringTransaction: ErrorLogSnapshotRow[] | null = null;
    let restoreHookFired = false;

    // Assertions run outside the route: anything thrown inside the hook would be turned into
    // the expected 500 and could not fail this test.
    const spy = vi.spyOn(manager, 'executeQuery').mockImplementation(async (sql: string, params?: unknown[], transactionID?: string) => {
      if (sql.includes(RESOLVE_EXISTING_MARKER)) {
        resolvedTransientRowsAfterCall = await readTransientRows(connection);
      }
      if (sql.includes(RESTORE_ATTRIBUTES_MARKER)) {
        restoreHookFired = true;
        originalRowsDuringTransaction = await readOriginalRows(connection);
        errorLinksDuringTransaction = await loadErrorLogSnapshot(originalIDs);
        throw new Error(INJECTED_FAILURE_MESSAGE);
      }
      return originalExecuteQuery(sql, params, transactionID);
    });

    try {
      const response = await bulkReingestGet(makeBulkRequest('GET'), makeBulkParams());
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
      expect(body.error).toContain(INJECTED_FAILURE_MESSAGE);
    } finally {
      spy.mockRestore();
    }

    expect(resolvedTransientRowsAfterCall, 'the CALL must really have produced resolved transient rows before reconciliation').toBe(originalIDs.length);
    expect(restoreHookFired, 'the attribute-restore hook never fired; the match marker no longer matches the route query').toBe(true);
    expect(
      originalRowsDuringTransaction!.every(row => row.StemGUID !== null),
      'syncOriginalRowsSQL must have updated the originals inside the transaction before the failure'
    ).toBe(true);
    expect(errorLinksDuringTransaction, 'the ingestion error links must have changed inside the transaction before the failure').not.toEqual(errorLinksBefore);

    const independent = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      timezone: config.timezone
    });
    try {
      expect(await readOriginalRows(independent), 'original measurement rows must be exactly as before').toEqual(originalRowsBefore);
      expect(await readTreeStemCounts(independent), 'no trees or stems may survive the rollback').toEqual(treeStemBefore);
      expect(await readTransientRows(independent), 'no transient CALL output may survive the rollback').toBe(0);
      assertIngestionOutcome(
        await readIngestionOutcome(independent, { fileID: REINGEST_FILE_ID, batchID: REINGEST_BATCH_ID, censusID: testData.census[0].censusID }),
        {
          sourceRecords: null,
          successfulRows: 0,
          failedRows: 0,
          remainingTemporaryRows: 0,
          errorCodes: [],
          alertTypes: []
        }
      );
    } finally {
      await independent.end();
    }
    expect(await getMeasurementAttributes(originalIDs), 'original attributes must be exactly as before').toEqual(attributesBefore);
    expect(await loadErrorLogSnapshot(originalIDs), 'original error links must be exactly as before').toEqual(errorLinksBefore);
  });
});
