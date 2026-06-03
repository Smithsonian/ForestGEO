import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import {
  cleanupTestMeasurements,
  getFailedMeasurements,
  insertDirectMeasurements,
  insertTestMeasurements,
  runBulkIngestion,
  setupTestDatabase,
  teardownTestDatabase,
  type TestData
} from '../setup/local-db-setup';

const AUTH_USER_EMAIL = 'integration-runner@forestgeo.test';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  batchCounter: 0
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

vi.mock('@/config/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[]) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }

      const [rows] = await sharedState.connection.query(query, params as any[]);
      return rows;
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
        id: 'test-transaction-id'
      };

      await sharedState.connection.beginTransaction();
      try {
        const result = await fn(tx);
        await sharedState.connection.commit();
        return result;
      } catch (error) {
        await sharedState.connection.rollback();
        throw error;
      }
    },
    beginTransaction: async () => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }

      await sharedState.connection.beginTransaction();
      return 'test-transaction-id';
    },
    commitTransaction: async () => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }

      await sharedState.connection.commit();
    },
    rollbackTransaction: async () => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }

      await sharedState.connection.rollback();
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
  let config: { database: string };

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
});
