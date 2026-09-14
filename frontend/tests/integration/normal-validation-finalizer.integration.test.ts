/**
 * Normal validation finalization only settles active, stem-linked pending rows.
 * The finalizer uses the real updateValidatedRows transaction against MySQL;
 * ConnectionManager is bridged to the test connection so the production query
 * and its transaction lifecycle are both covered.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { cleanupTestMeasurements, setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null
}));

const TEST_TRANSACTION_ID = 'normal-finalizer-test-transaction';

vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID && transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: transactionID mismatch');
      const [rows] = await sharedState.connection.query(query, (params as unknown[]) ?? []);
      return rows;
    },
    beginTransaction: async () => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      await sharedState.connection.beginTransaction();
      sharedState.activeTransactionID = TEST_TRANSACTION_ID;
      return TEST_TRANSACTION_ID;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection || transactionID !== sharedState.activeTransactionID)
        throw new Error('ConnectionManager mock: commit transactionID mismatch');
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection || transactionID !== sharedState.activeTransactionID)
        throw new Error('ConnectionManager mock: rollback transactionID mismatch');
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
    },
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({ default: { error: () => undefined, info: () => undefined } }));

import { updateValidatedRows } from '@/components/processors/processorhelperfunctions';

function toNullableBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value[0] === 1;
  return Number(value) === 1;
}

describe('normal validation finalizer eligibility', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let targetPlotID: number;
  let targetCensusID: number;
  let otherCensusID: number;
  let otherPlotID: number;
  let otherPlotCensusID: number;
  let linkedStemID: number;
  let validationErrorID: number;
  let ingestionErrorID: number;

  async function insertLinkedStem(plotID: number, censusID: number, suffix: string): Promise<number> {
    const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species LIMIT 1');
    const [quadratResult] = await connection.query<ResultSetHeader>(
      "INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive) VALUES (?, ?, 0, 0, 20, 20, 400, 'square', TRUE)",
      [plotID, `FINALIZER_${suffix}`]
    );
    const [treeResult] = await connection.query<ResultSetHeader>('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, TRUE)', [
      `FT_${suffix}`,
      speciesRows[0].SpeciesID,
      censusID
    ]);
    const [stemResult] = await connection.query<ResultSetHeader>(
      'INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, 1, 1, TRUE)',
      [treeResult.insertId, quadratResult.insertId, censusID, `FS_${suffix}`]
    );
    return stemResult.insertId;
  }

  async function insertMeasurement(options: {
    stemGUID?: number | null;
    censusID?: number;
    isActive?: boolean;
    isValidated?: boolean | null;
    dbh?: number;
  }): Promise<number> {
    const [result] = await connection.query<ResultSetHeader>(
      "INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive) VALUES (?, ?, ?, 1.3, '2024-06-01', ?, ?)",
      [options.stemGUID ?? null, options.censusID ?? targetCensusID, options.dbh ?? 10, options.isValidated ?? null, options.isActive ?? true]
    );
    return result.insertId;
  }

  async function addError(measurementID: number, errorID: number, isResolved: boolean): Promise<void> {
    await connection.query('INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) VALUES (?, ?, ?)', [measurementID, errorID, isResolved]);
  }

  async function validationState(measurementID: number): Promise<boolean | null> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT IsValidated FROM coremeasurements WHERE CoreMeasurementID = ?', [measurementID]);
    return toNullableBool(rows[0].IsValidated);
  }

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    sharedState.connection = connection;
    targetPlotID = testData.plots[0].plotID;
    targetCensusID = testData.census[0].censusID;
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    sharedState.activeTransactionID = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    sharedState.activeTransactionID = null;
    await cleanupTestMeasurements(connection, testData);

    const [otherCensusResult] = await connection.query<ResultSetHeader>(
      "INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive) VALUES (?, 99, '2025-01-01', '2025-12-31', TRUE)",
      [targetPlotID]
    );
    otherCensusID = otherCensusResult.insertId;
    const [otherPlotResult] = await connection.query<ResultSetHeader>('INSERT INTO plots (PlotName) VALUES (?)', ['FINALIZER_OTHER_PLOT']);
    otherPlotID = otherPlotResult.insertId;
    const [otherPlotCensusResult] = await connection.query<ResultSetHeader>(
      "INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive) VALUES (?, 1, '2024-01-01', '2024-12-31', TRUE)",
      [otherPlotID]
    );
    otherPlotCensusID = otherPlotCensusResult.insertId;

    linkedStemID = await insertLinkedStem(targetPlotID, targetCensusID, 'TARGET');
    validationErrorID = (await connection.query<RowDataPacket[]>("SELECT ErrorID FROM measurement_errors WHERE ErrorSource = 'validation' LIMIT 1"))[0][0]
      .ErrorID;
    await connection.query(
      "INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage) VALUES ('ingestion', 'FINALIZER_TEST_INGESTION', 'Finalizer integration test ingestion error')"
    );
    ingestionErrorID = (
      await connection.query<RowDataPacket[]>(
        "SELECT ErrorID FROM measurement_errors WHERE ErrorSource = 'ingestion' AND ErrorCode = 'FINALIZER_TEST_INGESTION'"
      )
    )[0][0].ErrorID;
  });

  it('finalizes only active, linked pending measurements in the requested census and plot', async () => {
    const cleanLinked = await insertMeasurement({ stemGUID: linkedStemID, dbh: 10 });
    const blockedLinked = await insertMeasurement({ stemGUID: linkedStemID, dbh: 11 });
    await addError(blockedLinked, validationErrorID, false);

    const unlinkedResolvedIngestion = await insertMeasurement({ stemGUID: null });
    await addError(unlinkedResolvedIngestion, ingestionErrorID, true);
    const unlinkedUnresolvedIngestion = await insertMeasurement({ stemGUID: null });
    await addError(unlinkedUnresolvedIngestion, ingestionErrorID, false);
    const inactiveLinked = await insertMeasurement({ stemGUID: linkedStemID, isActive: false, dbh: 12 });

    const alreadyTrue = await insertMeasurement({ stemGUID: linkedStemID, isValidated: true, dbh: 13 });
    const alreadyFalse = await insertMeasurement({ stemGUID: linkedStemID, isValidated: false, dbh: 14 });

    const otherCensusStem = await insertLinkedStem(targetPlotID, otherCensusID, 'OC');
    const otherCensusPending = await insertMeasurement({ stemGUID: otherCensusStem, censusID: otherCensusID });
    const otherPlotStem = await insertLinkedStem(otherPlotID, otherPlotCensusID, 'OP');
    const otherPlotPending = await insertMeasurement({ stemGUID: otherPlotStem, censusID: otherPlotCensusID });

    await updateValidatedRows(config.database, { p_CensusID: targetCensusID, p_PlotID: targetPlotID });

    expect(await validationState(cleanLinked)).toBe(true);
    expect(await validationState(blockedLinked)).toBe(false);
    expect(await validationState(unlinkedResolvedIngestion)).toBeNull();
    expect(await validationState(unlinkedUnresolvedIngestion)).toBeNull();
    expect(await validationState(inactiveLinked)).toBeNull();
    expect(await validationState(alreadyTrue)).toBe(true);
    expect(await validationState(alreadyFalse)).toBe(false);
    expect(await validationState(otherCensusPending)).toBeNull();
    expect(await validationState(otherPlotPending)).toBeNull();
  });
});
