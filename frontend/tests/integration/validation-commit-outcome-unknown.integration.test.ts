/**
 * A COMMIT whose outcome is unknown ("committed, then the reply was lost") must not fail a validation run:
 * the run's work is idempotent, so the retry classifier replays it and the rerun converges to the same
 * per-row state as a clean rerun, with exactly one link per (row, error code) (#563, spec §5.2 row 4).
 *
 * The ConnectionManager mock COMMITs for real on the shared connection and then throws the
 * TransactionCommitOutcomeUnknownError the real manager raises when the COMMIT reply never arrives.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import {
  cleanupTestMeasurements,
  insertCrossCensusMeasurements,
  seedStatusAttributes,
  setupTestDatabase,
  setupTwoCensusScenario,
  teardownTestDatabase,
  type CensusInfo,
  type TestData
} from '../setup/local-db-setup';

const COMMIT_FAULT_COMMITTED_THEN_LOST = 'committed_then_lost';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionsBegun: 0,
  commitFault: null as null | 'committed_then_lost',
  commitFaultsInjected: 0
}));

vi.mock('@/lib/db/connectionmanager', async () => {
  const { TransactionCommitOutcomeUnknownError } = await vi.importActual<typeof import('@/lib/db/transactionerrors')>('@/lib/db/transactionerrors');
  const TEST_TRANSACTION_ID = 'validation-commit-unknown-tx';
  const INJECTED_COMMIT_DEADLINE_MS = 30_000;
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (query.includes('??')) throw new Error(`ConnectionManager mock: unformatted identifier placeholders: ${query}`);
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
      sharedState.transactionsBegun += 1;
      sharedState.activeTransactionID = TEST_TRANSACTION_ID;
      return TEST_TRANSACTION_ID;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: commit transactionID mismatch');
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
      if (sharedState.commitFault === 'committed_then_lost') {
        sharedState.commitFault = null;
        sharedState.commitFaultsInjected += 1;
        const transportLoss = Object.assign(new Error('Connection lost: The server closed the connection.'), {
          code: 'PROTOCOL_CONNECTION_LOST',
          sqlMessage: undefined
        });
        throw new TransactionCommitOutcomeUnknownError(transactionID, 'connection_lost', INJECTED_COMMIT_DEADLINE_MS, { cause: transportLoss });
      }
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (sharedState.activeTransactionID === null) return; // finalized, like the real manager
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: rollback transactionID mismatch');
      await sharedState.connection.rollback();
      sharedState.activeTransactionID = null;
    },
    cleanupStaleTransactions: async () => 0,
    closeConnection: async () => undefined,
    acquireApplicationLock: async () => true
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: (...args: unknown[]) => console.warn('[ailogger.warn]', ...args),
    error: (...args: unknown[]) => console.error('[ailogger.error]', ...args)
  }
}));

import { runCombinedDBHValidations, runValidation, updateValidatedRows } from '@/components/processors/processorhelperfunctions';

const VALIDATION_IDS = {
  DBH_GROWTH: 1,
  OUTSIDE_CENSUS_DATE_BOUNDS: 6
} as const;

const SPECIES_CODE = 'ACERRU';
const TEST_TIMEOUT_MS = 120_000;
const SETUP_TIMEOUT_MS = 90_000;
const EXPECTED_TRANSACTIONS_AFTER_ONE_RETRY = 2;
const EXPECTED_FAULTS_INJECTED = 1;
const VALIDATION_ERROR_SOURCE_FILTER = 'validation';

interface ValidationRowState {
  measurementID: number;
  isValidated: boolean | null;
  validationErrorLinks: Array<{ errorCode: string; links: number }>;
}

function toNullableBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value[0] === 1;
  return Number(value) === 1;
}

async function validationRowStates(connection: Connection, measurementIDs: number[]): Promise<ValidationRowState[]> {
  const states: ValidationRowState[] = [];
  for (const measurementID of measurementIDs) {
    const [cmRows] = await connection.query<RowDataPacket[]>('SELECT IsValidated FROM coremeasurements WHERE CoreMeasurementID = ?', [measurementID]);
    const [linkRows] = await connection.query<RowDataPacket[]>(
      `SELECT me.ErrorCode AS errorCode, COUNT(*) AS links
       FROM measurement_error_log mel
       JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE mel.MeasurementID = ? AND mel.IsResolved = FALSE AND me.ErrorSource = ?
       GROUP BY me.ErrorCode ORDER BY me.ErrorCode`,
      [measurementID, VALIDATION_ERROR_SOURCE_FILTER]
    );
    states.push({
      measurementID,
      isValidated: toNullableBool(cmRows[0]?.IsValidated),
      validationErrorLinks: linkRows.map(row => ({ errorCode: String(row.errorCode), links: Number(row.links) }))
    });
  }
  return states;
}

describe('Validations retry a COMMIT whose outcome is unknown and converge (#563 C3)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let census1: CensusInfo;
  let census2: CensusInfo;
  let plotID: number;
  let speciesID: number;

  async function seedQuadrat(name: string, startX: number): Promise<number> {
    const [res] = await connection.query<ResultSetHeader>(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive)
       VALUES (?, ?, ?, 0, 20, 20, 400, 'square', 1)`,
      [plotID, name, startX]
    );
    return res.insertId;
  }

  async function seedMeasuredStem(opts: { treeTag: string; stemTag: string; quadratID: number; censusID: number; dbh: number; date: string }): Promise<number> {
    const [treeRes] = await connection.query<ResultSetHeader>('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', [
      opts.treeTag,
      speciesID,
      opts.censusID
    ]);
    const [stemRes] = await connection.query<ResultSetHeader>(
      `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, 1, 1, 1)`,
      [treeRes.insertId, opts.quadratID, opts.censusID, opts.stemTag]
    );
    const [cmRes] = await connection.query<ResultSetHeader>(
      `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
       VALUES (?, ?, ?, 1.3, ?, NULL, 1)`,
      [stemRes.insertId, opts.censusID, opts.dbh, opts.date]
    );
    return cmRes.insertId;
  }

  async function validationDefinition(validationID: number): Promise<{ procedureName: string; definition: string }> {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT ProcedureName, Definition FROM sitespecificvalidations WHERE ValidationID = ? AND IsEnabled = 1 LIMIT 1',
      [validationID]
    );
    if (rows.length === 0) throw new Error(`Validation ${validationID} missing or disabled`);
    return { procedureName: String(rows[0].ProcedureName), definition: String(rows[0].Definition) };
  }

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    sharedState.connection = connection;
    plotID = testData.plots[0].plotID;

    const scenario = await setupTwoCensusScenario(connection, testData);
    census1 = scenario.census1;
    census2 = scenario.census2;

    await seedStatusAttributes(connection);
    const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species WHERE SpeciesCode = ? LIMIT 1', [SPECIES_CODE]);
    speciesID = speciesRows[0].SpeciesID as number;
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    sharedState.connection = null;
    sharedState.activeTransactionID = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    sharedState.activeTransactionID = null;
    sharedState.transactionsBegun = 0;
    sharedState.commitFault = null;
    sharedState.commitFaultsInjected = 0;
    await cleanupTestMeasurements(connection, testData);
    await connection.query('DELETE FROM specieslimits');
    await connection.query("DELETE FROM quadrats WHERE QuadratName LIKE 'TRAP%'");
  });

  it(
    'runValidation: retries a COMMIT whose outcome is unknown, and the rerun converges to the clean-run state',
    async () => {
      const [originalBounds] = await connection.query<RowDataPacket[]>('SELECT StartDate, EndDate FROM census WHERE CensusID = ?', [census1.censusID]);
      try {
        await connection.query('UPDATE census SET StartDate = ?, EndDate = ? WHERE CensusID = ?', ['2024-06-01', '2024-06-30', census1.censusID]);
        const quadratID = await seedQuadrat('TRAPU', 0);
        const row = await seedMeasuredStem({ treeTag: 'TU1', stemTag: 'U1', quadratID, censusID: census1.censusID, dbh: 50, date: '2024-07-15' });
        const { procedureName, definition } = await validationDefinition(VALIDATION_IDS.OUTSIDE_CENSUS_DATE_BOUNDS);
        const scope = { p_CensusID: census1.censusID, p_PlotID: plotID };

        sharedState.commitFault = COMMIT_FAULT_COMMITTED_THEN_LOST;
        const faultedRun = await runValidation(VALIDATION_IDS.OUTSIDE_CENSUS_DATE_BOUNDS, procedureName, config.database, definition, scope);
        const faultedTransactions = sharedState.transactionsBegun;
        await updateValidatedRows(config.database, scope);
        const afterFaultedRun = await validationRowStates(connection, [row]);

        sharedState.transactionsBegun = 0;
        const cleanRerun = await runValidation(VALIDATION_IDS.OUTSIDE_CENSUS_DATE_BOUNDS, procedureName, config.database, definition, scope);
        await updateValidatedRows(config.database, scope);
        const afterCleanRerun = await validationRowStates(connection, [row]);
        console.log('[C3 runValidation]', JSON.stringify({ faultedRun, faultedTransactions, cleanRerun, afterFaultedRun, afterCleanRerun }));

        expect(faultedRun, 'an unknown COMMIT outcome must be classified retryable; otherwise the run reports failure').toBe(true);
        expect(sharedState.commitFaultsInjected).toBe(EXPECTED_FAULTS_INJECTED);
        expect(faultedTransactions, 'exactly one retry').toBe(EXPECTED_TRANSACTIONS_AFTER_ONE_RETRY);
        expect(cleanRerun).toBe(true);
        expect(afterFaultedRun).toEqual(afterCleanRerun);
        expect(afterFaultedRun).toEqual([
          { measurementID: row, isValidated: false, validationErrorLinks: [{ errorCode: String(VALIDATION_IDS.OUTSIDE_CENSUS_DATE_BOUNDS), links: 1 }] }
        ]);
      } finally {
        await connection.query('UPDATE census SET StartDate = ?, EndDate = ? WHERE CensusID = ?', [
          originalBounds[0].StartDate,
          originalBounds[0].EndDate,
          census1.censusID
        ]);
      }
    },
    TEST_TIMEOUT_MS
  );

  it(
    'runCombinedDBHValidations: retries a COMMIT whose outcome is unknown, and the rerun converges to the clean-run state',
    async () => {
      await seedQuadrat('TRAPU', 0);
      const { census2MeasurementIDs } = await insertCrossCensusMeasurements(connection, testData, census1.censusID, census2.censusID, [
        {
          treeTag: 'TU2',
          stemTag: 'U2',
          speciesCode: SPECIES_CODE,
          quadratName: 'TRAPU',
          x: 1,
          y: 1,
          hom: 1.3,
          census1DBH: 100,
          census2DBH: 200,
          census1Date: '2024-01-15',
          census2Date: '2024-06-15'
        }
      ]);
      const presentRow = census2MeasurementIDs[0];
      const scope = { p_CensusID: census2.censusID, p_PlotID: plotID };

      sharedState.commitFault = COMMIT_FAULT_COMMITTED_THEN_LOST;
      const faultedRun = await runCombinedDBHValidations(config.database, scope);
      const faultedTransactions = sharedState.transactionsBegun;
      await updateValidatedRows(config.database, scope);
      const afterFaultedRun = await validationRowStates(connection, [presentRow]);

      sharedState.transactionsBegun = 0;
      const cleanRerun = await runCombinedDBHValidations(config.database, scope);
      await updateValidatedRows(config.database, scope);
      const afterCleanRerun = await validationRowStates(connection, [presentRow]);
      console.log('[C3 combined DBH]', JSON.stringify({ faultedRun, faultedTransactions, cleanRerun, afterFaultedRun, afterCleanRerun }));

      expect(faultedRun.success, 'an unknown COMMIT outcome must be classified retryable; otherwise the run reports failure').toBe(true);
      expect(sharedState.commitFaultsInjected).toBe(EXPECTED_FAULTS_INJECTED);
      expect(faultedTransactions, 'exactly one retry').toBe(EXPECTED_TRANSACTIONS_AFTER_ONE_RETRY);
      expect(cleanRerun.success).toBe(true);
      expect(afterFaultedRun).toEqual(afterCleanRerun);
      expect(afterFaultedRun).toEqual([
        { measurementID: presentRow, isValidated: false, validationErrorLinks: [{ errorCode: String(VALIDATION_IDS.DBH_GROWTH), links: 1 }] }
      ]);
    },
    TEST_TIMEOUT_MS
  );
});
