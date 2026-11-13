import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  insertTestMeasurements,
  runBulkIngestion,
  setupTestDatabase,
  teardownTestDatabase,
  type TestData,
  type TestDatabaseConfig
} from '../setup/local-db-setup';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0
}));

const TEST_TRANSACTION_ID_PREFIX = 'redesign-transaction-';

vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) {
        throw new Error('Test DB connection not initialized');
      }
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
      sharedState.activeTransactionID = `${TEST_TRANSACTION_ID_PREFIX}${sharedState.transactionCounter}`;
      return sharedState.activeTransactionID;
    },
    commitTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error('ConnectionManager mock: commit transactionID mismatch');
      }
      await sharedState.connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID !== sharedState.activeTransactionID) {
        throw new Error('ConnectionManager mock: rollback transactionID mismatch');
      }
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
    warn: () => undefined,
    error: () => undefined
  }
}));

// Imports must follow vi.mock so the mocked ConnectionManager is wired in.
import ConnectionManager from '@/lib/db/connectionmanager';
import { analyzeEdit, TargetNotFoundError } from '@/config/editplan/analyzer';
import { applyEdit } from '@/config/editplan/apply';
import { DEFAULT_ERROR_EXPLORER_FILTERS } from '@/config/errorsexplorer';
import { refreshMeasurementViewsForScope } from '@/lib/measurementviewrefresh';
import { buildErrorExplorerDetails, buildErrorExplorerFacets } from '@/app/api/errors/explorer/_shared';

const SECOND_CENSUS_ID = 9201;
const SECOND_PLOT_CENSUS_NUMBER = 92;
const SECOND_CENSUS_TREE_TAG = 'SC001';
const SECOND_CENSUS_STEM_TAG = 'SC1';
const SAME_BATCH_TAG = 'SB001';
const ERROR_SOURCE_VALIDATION = 'validation';
const VALIDATION_CODE_SAME_BATCH_SPECIES_CONFLICT = '21';
const SECOND_CENSUS_STEM_X = 3.5;
const SECOND_CENSUS_STEM_Y = 4.25;
const INITIAL_DBH = 12.34;
const INITIAL_HOM = 1.3;
const INITIAL_DATE = '2024-06-15';
const EDITED_DBH = 45.5;
const DBH_DECIMAL_PLACES = 2;
const CREATED_BY = 'view-errors-integration';
const EXPECTED_FLAGGED_PER_ROW = [0, 1];
const EXPLORER_TEST_PAIR = {
  firstStemTag: 'S1',
  secondStemTag: 'S2',
  firstDBH: 100,
  secondDBH: 80,
  firstY: 10,
  secondY: 10.5,
  x: 10,
  hom: 1.3,
  codes: 'A'
} as const;

async function seedSecondCensusRow(connection: Connection, plotID: number): Promise<number> {
  await connection.query('INSERT INTO census (CensusID, PlotID, PlotCensusNumber) VALUES (?, ?, ?)', [SECOND_CENSUS_ID, plotID, SECOND_PLOT_CENSUS_NUMBER]);
  const [quadrats] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE PlotID = ? LIMIT 1', [plotID]);
  const [species] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species LIMIT 1');
  const [tree] = await connection.query<ResultSetHeader>('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', [
    SECOND_CENSUS_TREE_TAG,
    species[0].SpeciesID,
    SECOND_CENSUS_ID
  ]);
  const [stem] = await connection.query<ResultSetHeader>(
    'INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, ?, ?, 1)',
    [tree.insertId, quadrats[0].QuadratID, SECOND_CENSUS_ID, SECOND_CENSUS_STEM_TAG, SECOND_CENSUS_STEM_X, SECOND_CENSUS_STEM_Y]
  );
  const [measurement] = await connection.query<ResultSetHeader>(
    `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive) VALUES (?, ?, ?, ?, ?, 1, 1)`,
    [stem.insertId, SECOND_CENSUS_ID, INITIAL_DBH, INITIAL_HOM, INITIAL_DATE]
  );
  return measurement.insertId;
}

describe('View Errors server facts against real MySQL', () => {
  let connection: Connection;
  let config: TestDatabaseConfig;
  let testData: TestData;
  let schema: string;
  let plotID: number;
  let firstCensusID: number;
  let secondCensusRowID: number;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    config = setup.config;
    testData = setup.testData;
    schema = setup.config.database;
    plotID = testData.plots[0].plotID;
    firstCensusID = testData.census[0].censusID;
    sharedState.connection = connection;
    secondCensusRowID = await seedSecondCensusRow(connection, plotID);
    await refreshMeasurementViewsForScope(ConnectionManager.getInstance(), schema, plotID, SECOND_CENSUS_ID);
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    sharedState.activeTransactionID = null;
    await teardownTestDatabase(connection, config);
  });

  it('previews and applies a second-census row only with its own census ID (P2-3)', async () => {
    const cm = ConnectionManager.getInstance();
    await expect(analyzeEdit(cm, schema, 'measurementssummary', plotID, firstCensusID, secondCensusRowID, { MeasuredDBH: EDITED_DBH })).rejects.toBeInstanceOf(
      TargetNotFoundError
    );
    const plan = await analyzeEdit(cm, schema, 'measurementssummary', plotID, SECOND_CENSUS_ID, secondCensusRowID, { MeasuredDBH: EDITED_DBH });
    console.log('[view-errors multi-census edit]', JSON.stringify({ planHash: plan.planHash, fieldChanges: plan.fieldChanges }));
    const result = await applyEdit(cm, {
      dataType: 'measurementssummary',
      schema,
      plotID,
      censusID: SECOND_CENSUS_ID,
      targetID: secondCensusRowID,
      newRow: { MeasuredDBH: EDITED_DBH },
      expectedPlanHash: plan.planHash,
      createdBy: CREATED_BY
    });
    expect(result.editOperationID).not.toBeNull();
    const [rows] = await connection.query<RowDataPacket[]>('SELECT MeasuredDBH FROM coremeasurements WHERE CoreMeasurementID = ?', [secondCensusRowID]);
    expect(Number(rows[0].MeasuredDBH)).toBeCloseTo(EDITED_DBH, DBH_DECIMAL_PLACES);
  });

  it('logs validation 21 on the second row only and returns the first as a related row outside the error set (P2-7)', async () => {
    const [species1, species2] = testData.species;
    const quadratName = testData.quadrats[0].QuadratName;
    const { fileID, batchID } = await insertTestMeasurements(connection, testData, [
      {
        treeTag: SAME_BATCH_TAG,
        stemTag: EXPLORER_TEST_PAIR.firstStemTag,
        speciesCode: species1.SpeciesCode,
        quadratName,
        x: EXPLORER_TEST_PAIR.x,
        y: EXPLORER_TEST_PAIR.firstY,
        dbh: EXPLORER_TEST_PAIR.firstDBH,
        hom: EXPLORER_TEST_PAIR.hom,
        date: INITIAL_DATE,
        codes: EXPLORER_TEST_PAIR.codes
      },
      {
        treeTag: SAME_BATCH_TAG,
        stemTag: EXPLORER_TEST_PAIR.secondStemTag,
        speciesCode: species2.SpeciesCode,
        quadratName,
        x: EXPLORER_TEST_PAIR.x,
        y: EXPLORER_TEST_PAIR.secondY,
        dbh: EXPLORER_TEST_PAIR.secondDBH,
        hom: EXPLORER_TEST_PAIR.hom,
        date: INITIAL_DATE,
        codes: EXPLORER_TEST_PAIR.codes
      }
    ]);
    const ingestion = await runBulkIngestion(connection, fileID, batchID);
    expect(ingestion.success, ingestion.message).toBe(true);
    await refreshMeasurementViewsForScope(ConnectionManager.getInstance(), schema, plotID, firstCensusID);
    const [pair] = await connection.query<RowDataPacket[]>(
      `SELECT cm.CoreMeasurementID, EXISTS (SELECT 1 FROM measurement_error_log mel JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
              WHERE mel.MeasurementID = cm.CoreMeasurementID AND me.ErrorSource = ? AND me.ErrorCode = ? AND mel.IsResolved = FALSE) AS flagged
       FROM coremeasurements cm WHERE cm.UploadBatchID = ? ORDER BY cm.CoreMeasurementID`,
      [ERROR_SOURCE_VALIDATION, VALIDATION_CODE_SAME_BATCH_SPECIES_CONFLICT, batchID]
    );
    console.log('[view-errors one-sided 21]', JSON.stringify(pair));
    expect(pair.map(row => Number(row.flagged))).toEqual(EXPECTED_FLAGGED_PER_ROW);
    const [first, second] = pair.map(row => Number(row.CoreMeasurementID));
    const details = await buildErrorExplorerDetails(ConnectionManager.getInstance(), { schema, plotID, censusID: firstCensusID }, second);
    console.log('[view-errors one-sided 21 details]', JSON.stringify(details.relatedRows));
    expect(details.relatedRows).toEqual([expect.objectContaining({ coreMeasurementID: first, inErrorSet: false })]);
    const facets = await buildErrorExplorerFacets(ConnectionManager.getInstance(), {
      schema,
      plotID,
      censusID: firstCensusID,
      censusIDs: [firstCensusID],
      filters: DEFAULT_ERROR_EXPLORER_FILTERS
    });
    const sameBatchType = facets.errorTypes.find(type => type.source === ERROR_SOURCE_VALIDATION && type.code === VALIDATION_CODE_SAME_BATCH_SPECIES_CONFLICT);
    expect(sameBatchType?.count, JSON.stringify(facets.errorTypes)).toBe(1);
  });
});
