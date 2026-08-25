/**
 * Confirms the prepareValidationRun rerun-reset clears stale errors across
 * every "trap family," not just the duplicate-tag case covered by
 * validation-rerun-stale-errors.integration.test.ts.
 *
 * Families exercised, one representative each — in every case the CORRECTION
 * NEVER TOUCHES THE FLAGGED MEASUREMENT, which is exactly the shape that used
 * to strand rows at IsValidated = FALSE forever:
 *   - V4  duplicated quadrat names  → fix = rename a quadrat (reference table)
 *   - V11 DBH outside species limits → fix = widen specieslimits (reference table)
 *   - V6  outside census date bounds → fix = widen census dates (reference table)
 *   - V1  DBH growth exceeds max     → fix = correct the PREVIOUS census's DBH
 *         (cross-census, and runs through the RunSharedDBHChangeValidations
 *         stored-procedure path via runCombinedDBHValidations)
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
  log,
  type CensusInfo,
  type TestData
} from '../setup/local-db-setup';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null
}));

const TEST_TRANSACTION_ID = 'test-transaction-id';

vi.mock('@/lib/db/connectionmanager', () => {
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
      sharedState.activeTransactionID = TEST_TRANSACTION_ID;
      return TEST_TRANSACTION_ID;
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
    cleanupStaleTransactions: async () => undefined,
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
  DUPLICATE_QUADRAT_NAMES: 4,
  OUTSIDE_CENSUS_DATE_BOUNDS: 6,
  DBH_OUTSIDE_SPECIES_LIMITS: 11
} as const;

const SPECIES_CODE = 'ACERRU';

interface RowState {
  isValidated: boolean | null;
  unresolvedValidationErrorCodes: string[];
}

function toNullableBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value[0] === 1;
  return Number(value) === 1;
}

describe('Validation rerun clears stale errors across trap families', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let census1: CensusInfo;
  let census2: CensusInfo;
  let plotID: number;
  let speciesID: number;

  async function rowState(measurementID: number): Promise<RowState> {
    const [cmRows] = await connection.query<RowDataPacket[]>('SELECT IsValidated FROM coremeasurements WHERE CoreMeasurementID = ? LIMIT 1', [measurementID]);
    if (cmRows.length === 0) throw new Error(`coremeasurements row ${measurementID} vanished`);
    const [errorRows] = await connection.query<RowDataPacket[]>(
      `SELECT me.ErrorCode
       FROM measurement_error_log mel
       JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE mel.MeasurementID = ? AND mel.IsResolved = FALSE AND me.ErrorSource = 'validation'
       ORDER BY me.ErrorCode`,
      [measurementID]
    );
    return { isValidated: toNullableBool(cmRows[0].IsValidated), unresolvedValidationErrorCodes: errorRows.map(row => String(row.ErrorCode)) };
  }

  async function runValidationByID(validationID: number, censusID: number): Promise<void> {
    const [defRows] = await connection.query<RowDataPacket[]>(
      'SELECT ProcedureName, Definition FROM sitespecificvalidations WHERE ValidationID = ? AND IsEnabled = 1 LIMIT 1',
      [validationID]
    );
    if (defRows.length === 0) throw new Error(`Validation ${validationID} missing or disabled`);
    const ok = await runValidation(validationID, String(defRows[0].ProcedureName), config.database, String(defRows[0].Definition), {
      p_CensusID: censusID,
      p_PlotID: plotID
    });
    if (!ok) throw new Error(`runValidation ${validationID} reported failure`);
    await updateValidatedRows(config.database, { p_CensusID: censusID, p_PlotID: plotID });
  }

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
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    sharedState.activeTransactionID = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    sharedState.activeTransactionID = null;
    await cleanupTestMeasurements(connection, testData);
    await connection.query('DELETE FROM specieslimits');
    await connection.query("DELETE FROM quadrats WHERE QuadratName LIKE 'TRAP%'");
  });

  it('V4: renaming a duplicated quadrat (pure reference edit, zero measurement edits) clears both flagged rows on rerun', async () => {
    // uq_quadrats_active_name (PR #346) blocks NEW duplicate names, so this
    // scenario only exists as legacy data on schemas that predate the guard.
    // Drop the constraint to simulate that legacy state; restore it after.
    await connection.query('ALTER TABLE quadrats DROP INDEX uq_quadrats_active_name');
    const quadratAID = await seedQuadrat('TRAPQ', 0);
    const quadratBID = await seedQuadrat('TRAPQ', 20);
    const rowA = await seedMeasuredStem({ treeTag: 'TQ1', stemTag: 'Q1', quadratID: quadratAID, censusID: census1.censusID, dbh: 50, date: '2024-06-10' });
    const rowB = await seedMeasuredStem({ treeTag: 'TQ2', stemTag: 'Q2', quadratID: quadratBID, censusID: census1.censusID, dbh: 60, date: '2024-06-11' });

    await runValidationByID(VALIDATION_IDS.DUPLICATE_QUADRAT_NAMES, census1.censusID);
    expect((await rowState(rowA)).unresolvedValidationErrorCodes).toEqual(['4']);
    expect((await rowState(rowB)).unresolvedValidationErrorCodes).toEqual(['4']);

    try {
      await connection.query('UPDATE quadrats SET QuadratName = ? WHERE QuadratID = ?', ['TRAPQ2', quadratBID]);

      await runValidationByID(VALIDATION_IDS.DUPLICATE_QUADRAT_NAMES, census1.censusID);
      const a = await rowState(rowA);
      const b = await rowState(rowB);
      log.debug(`V4 after fix+rerun — A: ${JSON.stringify(a)}, B: ${JSON.stringify(b)}`);
      expect(a.unresolvedValidationErrorCodes).toEqual([]);
      expect(b.unresolvedValidationErrorCodes).toEqual([]);
      expect(a.isValidated).toBe(true);
      expect(b.isValidated).toBe(true);
    } finally {
      await connection.query("DELETE FROM quadrats WHERE QuadratName LIKE 'TRAP%' AND QuadratID NOT IN (?, ?)", [quadratAID, quadratBID]);
      await connection.query('ALTER TABLE quadrats ADD CONSTRAINT uq_quadrats_active_name UNIQUE (PlotID, QuadratName, IsActive)');
    }
  });

  it('V11: widening specieslimits (pure reference edit) clears the flagged row on rerun', async () => {
    const quadratID = await seedQuadrat('TRAPL', 0);
    const row = await seedMeasuredStem({ treeTag: 'TL1', stemTag: 'L1', quadratID, censusID: census1.censusID, dbh: 150, date: '2024-06-10' });
    await connection.query(`INSERT INTO specieslimits (SpeciesID, CensusID, LimitType, LowerBound, UpperBound, IsActive) VALUES (?, ?, 'DBH', 10, 100, 1)`, [
      speciesID,
      census1.censusID
    ]);

    await runValidationByID(VALIDATION_IDS.DBH_OUTSIDE_SPECIES_LIMITS, census1.censusID);
    expect((await rowState(row)).unresolvedValidationErrorCodes).toEqual(['11']);

    await connection.query('UPDATE specieslimits SET UpperBound = 500 WHERE SpeciesID = ? AND CensusID = ?', [speciesID, census1.censusID]);

    await runValidationByID(VALIDATION_IDS.DBH_OUTSIDE_SPECIES_LIMITS, census1.censusID);
    const state = await rowState(row);
    log.debug(`V11 after fix+rerun — ${JSON.stringify(state)}`);
    expect(state.unresolvedValidationErrorCodes).toEqual([]);
    expect(state.isValidated).toBe(true);
  });

  it('V6: widening the census date bounds (census-table edit) clears the flagged row on rerun', async () => {
    await connection.query('UPDATE census SET StartDate = ?, EndDate = ? WHERE CensusID = ?', ['2024-06-01', '2024-06-30', census1.censusID]);
    const quadratID = await seedQuadrat('TRAPD', 0);
    const row = await seedMeasuredStem({ treeTag: 'TD1', stemTag: 'D1', quadratID, censusID: census1.censusID, dbh: 50, date: '2024-07-15' });

    await runValidationByID(VALIDATION_IDS.OUTSIDE_CENSUS_DATE_BOUNDS, census1.censusID);
    expect((await rowState(row)).unresolvedValidationErrorCodes).toEqual(['6']);

    await connection.query('UPDATE census SET EndDate = ? WHERE CensusID = ?', ['2024-07-31', census1.censusID]);

    await runValidationByID(VALIDATION_IDS.OUTSIDE_CENSUS_DATE_BOUNDS, census1.censusID);
    const state = await rowState(row);
    log.debug(`V6 after fix+rerun — ${JSON.stringify(state)}`);
    expect(state.unresolvedValidationErrorCodes).toEqual([]);
    expect(state.isValidated).toBe(true);
  });

  it('V1 (stored-proc path): correcting the PREVIOUS census DBH clears the flagged current-census row on rerun', async () => {
    await seedQuadrat('TRAPG', 0);
    const { census1MeasurementIDs, census2MeasurementIDs } = await insertCrossCensusMeasurements(connection, testData, census1.censusID, census2.censusID, [
      {
        treeTag: 'TG1',
        stemTag: 'G1',
        speciesCode: SPECIES_CODE,
        quadratName: 'TRAPG',
        x: 1,
        y: 1,
        hom: 1.3,
        census1DBH: 100,
        census2DBH: 200,
        census1Date: '2024-01-15',
        census2Date: '2024-06-15'
      }
    ]);
    const pastRow = census1MeasurementIDs[0];
    const presentRow = census2MeasurementIDs[0];

    const first = await runCombinedDBHValidations(config.database, { p_CensusID: census2.censusID, p_PlotID: plotID });
    expect(first.success).toBe(true);
    await updateValidatedRows(config.database, { p_CensusID: census2.censusID, p_PlotID: plotID });
    expect((await rowState(presentRow)).unresolvedValidationErrorCodes).toEqual(['1']);
    expect((await rowState(presentRow)).isValidated).toBe(false);

    // The field correction: the PAST census's DBH was the typo. Fix it there;
    // the flagged present-census row is never touched.
    await connection.query('UPDATE coremeasurements SET MeasuredDBH = 180 WHERE CoreMeasurementID = ?', [pastRow]);

    const second = await runCombinedDBHValidations(config.database, { p_CensusID: census2.censusID, p_PlotID: plotID });
    expect(second.success).toBe(true);
    await updateValidatedRows(config.database, { p_CensusID: census2.censusID, p_PlotID: plotID });
    const state = await rowState(presentRow);
    log.debug(`V1 after fix+rerun — ${JSON.stringify(state)}`);
    expect(state.unresolvedValidationErrorCodes).toEqual([]);
    expect(state.isValidated).toBe(true);
  });
});
