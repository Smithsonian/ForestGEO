/**
 * stageMeasurementChunk / countStagedRows — Integration Tests
 *
 * Exercises the shared measurement staging mechanism (lib/uploads/stage-measurements.ts)
 * against a real local MySQL instance with the full production schema, including the
 * server-side header resolution stage from lib/column-mapping.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/stage-measurements.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';
import { SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';

// ---------------------------------------------------------------------------
// Safety guard — setupTestDatabase DROPs/CREATEs its schema; never run remote.
// ---------------------------------------------------------------------------

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';

if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(
    `[stage-measurements] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops and recreates its test schema and must only run against a local test database.`
  );
}

// ---------------------------------------------------------------------------
// Shared state bridge — hoisted so the ConnectionManager mock closure can read
// the live test connection after beforeAll wires it up.
// ---------------------------------------------------------------------------

const TRANSACTION_ID_PREFIX = 'stage-measurements-tx-';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0
}));

// ConnectionManager mock — routes every staging DB call to the shared real
// MySQL connection so commits/rollbacks operate on actual transactions.
vi.mock('@/config/connectionmanager', () => {
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
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/ailogger', () => ({
  default: {
    info: (msg: string) => console.log(`[ailogger.info] ${msg}`),
    warn: (msg: string) => console.log(`[ailogger.warn] ${msg}`),
    error: (msg: string) => console.log(`[ailogger.error] ${msg}`)
  }
}));

import ConnectionManager from '@/config/connectionmanager';
import { countStagedRows, stageMeasurementChunk, type StageMeasurementChunkParams } from '@/lib/uploads/stage-measurements';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const FILE_NAME = 'stage-measurements-fixture.csv';
const BATCH_ID = 'stage-batch-0001';
const UPLOAD_SESSION_ID = 'stage-int-test-session';
const CHANGED_BY = 'stage-test@forestgeo.test';
const CSV_DELIMITER = ',';

// Alias headers on purpose: 'treetag' must resolve to canonical 'tag' and
// 'speciescode' to 'spcode' through lib/column-mapping — proving the server
// resolution stage actually runs inside stageMeasurementChunk.
const CSV_HEADERS = ['treetag', 'stemtag', 'speciescode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'];

const VALID_DATE = '2024-03-15';
const UNPARSEABLE_DATE = 'not-a-real-date';
// MySQL coerces an unparseable date string to the zero date under INSERT IGNORE
// (warning 1265 "Data truncated"), it does NOT reject the row. Read back via
// CAST(... AS CHAR) so the assertion is driver-independent.
const ZERO_DATE_TEXT = '0000-00-00';

interface FixtureRowSpec {
  treetag: string;
  stemtag: string;
  speciescode: string;
  quadrat: string;
  lx: string;
  ly: string;
  dbh: string;
  hom: string;
  date: string;
  codes: string;
}

function fixtureRow(overrides: Partial<FixtureRowSpec> & Pick<FixtureRowSpec, 'treetag'>): Record<string, string> {
  const spec: FixtureRowSpec = {
    stemtag: '1',
    speciescode: 'ACERRU',
    quadrat: 'Q01',
    lx: '1.5',
    ly: '2.5',
    dbh: '10.55',
    hom: '1.3',
    date: VALID_DATE,
    codes: 'A',
    ...overrides
  };
  // Key insertion order MUST mirror CSV_HEADERS: the resolution plan keys
  // values positionally, exactly like rows parsed from a real CSV.
  return {
    treetag: spec.treetag,
    stemtag: spec.stemtag,
    speciescode: spec.speciescode,
    quadrat: spec.quadrat,
    lx: spec.lx,
    ly: spec.ly,
    dbh: spec.dbh,
    hom: spec.hom,
    date: spec.date,
    codes: spec.codes
  };
}

/**
 * Six-row fixture chunk:
 * - rows 1–4: clean rows across two quadrats/species
 * - row 5:    unparseable date (passes row validation — date is non-empty —
 *             and stages with a zero MeasurementDate via INSERT IGNORE coercion)
 * - row 6:    missing required field `quadrat` → rejected by row validation
 *             and surfaced through invalidRows, never inserted
 */
function buildFixtureChunk(): Record<string, string>[] {
  return [
    fixtureRow({ treetag: 'T0001', quadrat: 'Q01', speciescode: 'ACERRU', lx: '1.123456', ly: '2.654321', dbh: '10.55', hom: '1.3' }),
    fixtureRow({ treetag: 'T0002', quadrat: 'Q01', speciescode: 'QUERCO', stemtag: '2', dbh: '20.4', codes: 'A;R' }),
    fixtureRow({ treetag: 'T0003', quadrat: 'Q02', speciescode: 'PINUST', dbh: '30.125', codes: '' }),
    fixtureRow({ treetag: 'T0004', quadrat: 'Q02', speciescode: 'FAGUGR', hom: '1.45' }),
    fixtureRow({ treetag: 'T0005', quadrat: 'Q03', speciescode: 'BETUAL', date: UNPARSEABLE_DATE }),
    fixtureRow({ treetag: 'T0006', quadrat: '', speciescode: 'TILIAA' })
  ];
}

const EXPECTED_STAGED_ROW_COUNT = 5; // 6 fixture rows minus the missing-quadrat reject
const EXPECTED_INVALID_ROW_COUNT = 1;

// ---------------------------------------------------------------------------
// Suite lifecycle
// ---------------------------------------------------------------------------

describe('stageMeasurementChunk — integration', () => {
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
    console.log(`[setup] schema=${schema} plotID=${plotID} censusID=${censusID}`);
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    if (sharedState.activeTransactionID) {
      await connection.rollback();
      sharedState.activeTransactionID = null;
    }
    await connection.query('DELETE FROM temporarymeasurements');
    await connection.query('DELETE FROM unifiedchangelog');
    console.log('[beforeEach] cleared temporarymeasurements + unifiedchangelog');
  });

  function baseParams(transactionID: string, overrides: Partial<StageMeasurementChunkParams> = {}): StageMeasurementChunkParams {
    return {
      schema,
      fileName: FILE_NAME,
      batchID: BATCH_ID,
      plotID,
      censusID,
      uploadMode: UploadMode.CLEAN_REUPLOAD,
      sourceFormat: SourceFormat.csv,
      rawRows: buildFixtureChunk(),
      csvHeaders: CSV_HEADERS,
      delimiter: CSV_DELIMITER,
      uploadSessionID: UPLOAD_SESSION_ID,
      transactionID,
      changedBy: CHANGED_BY,
      ...overrides
    };
  }

  async function fetchStagedRows(): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT FileID, BatchID, SessionID, SourceFormat, PlotID, CensusID,
              TreeTag, StemTag, SpeciesCode, QuadratName,
              CAST(LocalX AS CHAR) AS LocalXText, CAST(LocalY AS CHAR) AS LocalYText,
              CAST(DBH AS CHAR) AS DBHText, CAST(HOM AS CHAR) AS HOMText,
              CAST(MeasurementDate AS CHAR) AS MeasurementDateText,
              Codes, Comments
       FROM temporarymeasurements
       WHERE FileID = ? AND BatchID = ?
       ORDER BY id`,
      [FILE_NAME, BATCH_ID]
    );
    return rows;
  }

  it('stages a fixture chunk through server-side resolution and inserts the exact column values', async () => {
    const transactionID = await connectionManager.beginTransaction();
    const result = await stageMeasurementChunk(connectionManager, baseParams(transactionID));
    await connectionManager.commitTransaction(transactionID);

    console.log(
      `[stage] insertedCount=${result.insertedCount} expectedCount=${result.expectedCount} droppedCount=${result.droppedCount} ` +
        `invalidRows=${result.invalidRows.length} stagedRows=${result.stagedRows.length}`
    );
    console.log(`[stage] invalidRows detail: ${JSON.stringify(result.invalidRows)}`);

    expect(result.insertedCount).toBe(EXPECTED_STAGED_ROW_COUNT);
    expect(result.expectedCount).toBe(EXPECTED_STAGED_ROW_COUNT);
    expect(result.droppedCount).toBe(0);
    expect(result.stagedRows).toHaveLength(EXPECTED_STAGED_ROW_COUNT);

    // The missing-quadrat row is a parse reject, surfaced for caller-side recording.
    expect(result.invalidRows).toHaveLength(EXPECTED_INVALID_ROW_COUNT);
    expect(String(result.invalidRows[0].tag)).toBe('T0006');
    expect(String(result.invalidRows[0].failureReason)).toContain('Missing required fields: quadrat');

    const staged = await fetchStagedRows();
    for (const row of staged) {
      console.log(
        `[db row] TreeTag=${row.TreeTag} StemTag=${row.StemTag} SpeciesCode=${row.SpeciesCode} Quadrat=${row.QuadratName} ` +
          `LocalX=${row.LocalXText} LocalY=${row.LocalYText} DBH=${row.DBHText} HOM=${row.HOMText} Date=${row.MeasurementDateText} ` +
          `Codes=${row.Codes} Session=${row.SessionID} SourceFormat=${row.SourceFormat}`
      );
    }
    expect(staged).toHaveLength(EXPECTED_STAGED_ROW_COUNT);

    // Shared envelope columns — identical on every staged row.
    for (const row of staged) {
      expect(row.FileID).toBe(FILE_NAME);
      expect(row.BatchID).toBe(BATCH_ID);
      expect(row.SessionID).toBe(UPLOAD_SESSION_ID);
      expect(row.SourceFormat).toBe(SourceFormat.csv);
      expect(row.PlotID).toBe(plotID);
      expect(row.CensusID).toBe(censusID);
      expect(row.Comments).toBeNull();
    }

    // Row 1 — proves alias headers resolved (treetag→TreeTag, speciescode→SpeciesCode)
    // and that lx/ly keep 6-decimal precision while dbh/hom round to 2.
    const row1 = staged[0];
    expect(row1.TreeTag).toBe('T0001');
    expect(row1.StemTag).toBe('1');
    expect(row1.SpeciesCode).toBe('ACERRU');
    expect(row1.QuadratName).toBe('Q01');
    expect(Number(row1.LocalXText)).toBeCloseTo(1.123456, 6);
    expect(Number(row1.LocalYText)).toBeCloseTo(2.654321, 6);
    expect(Number(row1.DBHText)).toBeCloseTo(10.55, 2);
    expect(Number(row1.HOMText)).toBeCloseTo(1.3, 2);
    expect(row1.MeasurementDateText).toBe(VALID_DATE);
    expect(row1.Codes).toBe('A');

    // Row 2 — multi-code value passes through untouched.
    const row2 = staged[1];
    expect(row2.TreeTag).toBe('T0002');
    expect(row2.StemTag).toBe('2');
    expect(row2.SpeciesCode).toBe('QUERCO');
    expect(Number(row2.DBHText)).toBeCloseTo(20.4, 2);
    expect(row2.Codes).toBe('A;R');

    // Row 3 — empty codes collapse to NULL via the shared transform.
    const row3 = staged[2];
    expect(row3.TreeTag).toBe('T0003');
    expect(row3.SpeciesCode).toBe('PINUST');
    expect(Number(row3.DBHText)).toBeCloseTo(30.13, 2); // 30.125 rounds to 2 decimals
    expect(row3.Codes).toBeNull();

    // Row 4
    const row4 = staged[3];
    expect(row4.TreeTag).toBe('T0004');
    expect(row4.SpeciesCode).toBe('FAGUGR');
    expect(Number(row4.HOMText)).toBeCloseTo(1.45, 2);

    // Row 5 — unparseable date: row validation does NOT reject it (date is
    // non-empty), so it stages; MySQL coerces the bad date to the zero date
    // under INSERT IGNORE rather than dropping the row.
    const row5 = staged[4];
    expect(row5.TreeTag).toBe('T0005');
    expect(row5.SpeciesCode).toBe('BETUAL');
    expect(row5.MeasurementDateText).toBe(ZERO_DATE_TEXT);

    // The reject (T0006) must never reach the database.
    const stagedTags = staged.map(row => row.TreeTag);
    expect(stagedTags).not.toContain('T0006');

    // unifiedchangelog tracking — one file_upload row carrying the staged counts.
    const [changelog] = await connection.query<RowDataPacket[]>(
      `SELECT TableName, RecordID, Operation, NewRowState, ChangedBy, PlotID, CensusID FROM unifiedchangelog WHERE TableName = 'file_upload'`
    );
    console.log(`[changelog] ${JSON.stringify(changelog)}`);
    expect(changelog).toHaveLength(1);
    expect(changelog[0].RecordID).toBe(FILE_NAME);
    expect(changelog[0].Operation).toBe('INSERT');
    expect(changelog[0].ChangedBy).toBe(CHANGED_BY);
    const metadata = typeof changelog[0].NewRowState === 'string' ? JSON.parse(changelog[0].NewRowState) : changelog[0].NewRowState;
    expect(metadata.rowCount).toBe(EXPECTED_STAGED_ROW_COUNT);
    expect(metadata.droppedCount).toBe(0);
    expect(metadata.batchCount).toBe(1);
    expect(metadata.formType).toBe('measurements');
  });

  it('countStagedRows matches insertedCount for the staged scope and 0 elsewhere', async () => {
    const transactionID = await connectionManager.beginTransaction();
    const result = await stageMeasurementChunk(connectionManager, baseParams(transactionID));
    await connectionManager.commitTransaction(transactionID);

    const counted = await countStagedRows(connectionManager, schema, FILE_NAME, BATCH_ID, plotID, censusID);
    console.log(`[countStagedRows] insertedCount=${result.insertedCount} counted=${counted}`);
    expect(counted).toBe(result.insertedCount);
    expect(counted).toBe(EXPECTED_STAGED_ROW_COUNT);

    const countedOtherBatch = await countStagedRows(connectionManager, schema, FILE_NAME, 'some-other-batch', plotID, censusID);
    console.log(`[countStagedRows] other batch counted=${countedOtherBatch}`);
    expect(countedOtherBatch).toBe(0);
  });

  it('re-staging the identical chunk with the same batchID re-inserts rows (no unique key on temporarymeasurements) and reports droppedCount=0', async () => {
    const firstTransactionID = await connectionManager.beginTransaction();
    const firstResult = await stageMeasurementChunk(connectionManager, baseParams(firstTransactionID));
    await connectionManager.commitTransaction(firstTransactionID);

    const secondTransactionID = await connectionManager.beginTransaction();
    const secondResult = await stageMeasurementChunk(connectionManager, baseParams(secondTransactionID));
    await connectionManager.commitTransaction(secondTransactionID);

    const totalStaged = await countStagedRows(connectionManager, schema, FILE_NAME, BATCH_ID, plotID, censusID);
    console.log(
      `[re-stage] first.insertedCount=${firstResult.insertedCount} second.insertedCount=${secondResult.insertedCount} ` +
        `second.droppedCount=${secondResult.droppedCount} totalStaged=${totalStaged}`
    );

    // DOCUMENTED REALITY: temporarymeasurements has NO unique constraint
    // (sqlscripting/tablestructures.sql defines only non-unique indexes), so the
    // INSERT IGNORE in insertTemporaryMeasurementsInBatches has nothing to
    // collide with: re-staging the identical chunk duplicates every row and the
    // pre/post-count delta reports zero drops. Within-batch dedup happens
    // downstream in bulkingestionprocess, not at staging time. If a unique key
    // is ever added, this test will fail and must be flipped to assert
    // droppedCount === EXPECTED_STAGED_ROW_COUNT and totalStaged === EXPECTED_STAGED_ROW_COUNT.
    expect(firstResult.insertedCount).toBe(EXPECTED_STAGED_ROW_COUNT);
    expect(secondResult.insertedCount).toBe(EXPECTED_STAGED_ROW_COUNT);
    expect(secondResult.droppedCount).toBe(0);
    expect(totalStaged).toBe(EXPECTED_STAGED_ROW_COUNT * 2);

    // Same file+batch on the second pass must NOT trigger the stale-batch
    // cleanup (preInsertCount > 0 skips it) — first-pass rows survive.
    const staged = await fetchStagedRows();
    const tagCounts = staged.reduce<Record<string, number>>((acc, row) => {
      acc[String(row.TreeTag)] = (acc[String(row.TreeTag)] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`[re-stage] per-tag counts: ${JSON.stringify(tagCounts)}`);
    for (const tag of ['T0001', 'T0002', 'T0003', 'T0004', 'T0005']) {
      expect(tagCounts[tag]).toBe(2);
    }

    // Changelog accumulates instead of duplicating: still one row, two batches.
    const [changelog] = await connection.query<RowDataPacket[]>(`SELECT NewRowState FROM unifiedchangelog WHERE TableName = 'file_upload'`);
    expect(changelog).toHaveLength(1);
    const metadata = typeof changelog[0].NewRowState === 'string' ? JSON.parse(changelog[0].NewRowState) : changelog[0].NewRowState;
    console.log(`[re-stage] changelog metadata: ${JSON.stringify(metadata)}`);
    expect(metadata.rowCount).toBe(EXPECTED_STAGED_ROW_COUNT * 2);
    expect(metadata.batchCount).toBe(2);
  });

  it('rolling back the caller-owned transaction leaves no staged rows behind', async () => {
    const transactionID = await connectionManager.beginTransaction();
    const result = await stageMeasurementChunk(connectionManager, baseParams(transactionID));
    expect(result.insertedCount).toBe(EXPECTED_STAGED_ROW_COUNT);

    await connectionManager.rollbackTransaction(transactionID);

    const counted = await countStagedRows(connectionManager, schema, FILE_NAME, BATCH_ID, plotID, censusID);
    console.log(`[rollback] staged rows after rollback=${counted}`);
    expect(counted).toBe(0);
  });
});
