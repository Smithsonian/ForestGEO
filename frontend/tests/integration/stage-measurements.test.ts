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

import ConnectionManager from '@/lib/db/connectionmanager';
import { countStagedRows, stageMeasurementChunk, type StageMeasurementChunkParams } from '@/lib/uploads/stage-measurements';
import { ensureUploadSessionsTable } from '@/config/uploadsessiontracker';
import { resetUploadSessionCensusReplacementColumnCacheForTests } from '@/lib/ingestion/temporary-measurements';

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
 * - row 5:    unparseable date → rejected by row validation and surfaced
 *             through invalidRows, never inserted. Dev commit e3a49bd3
 *             (2026-06-16) made this a hard reject: a date that stays an
 *             unparseable string after transform must not be staged, because
 *             the previous behaviour coerced it to a zero MeasurementDate and
 *             silently ingested bad input.
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

const EXPECTED_STAGED_ROW_COUNT = 4; // 6 fixture rows minus the unparseable-date and missing-quadrat rejects
const EXPECTED_INVALID_ROW_COUNT = 2;
const EXPECTED_INVALID_ROW_TREETAGS = ['T0005', 'T0006'] as const;
const EXPECTED_STAGED_TREETAGS = ['T0001', 'T0002', 'T0003', 'T0004'] as const;

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

    // The census-replacement marker lives on upload_sessions, which the app
    // creates on demand (local-db-setup does not provision it). Production
    // always has it by the time staging runs: a session must exist for a
    // session id to be passed at all.
    // Uses the production DDL, so this also proves ensureUploadSessionsTable
    // declares the marker column rather than only tablestructures.sql doing so.
    await ensureUploadSessionsTable(schema);
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
    await connection.query('DELETE FROM coremeasurements');
    await connection.query('DELETE FROM uploadmetrics');
    await connection.query('DELETE FROM upload_sessions');
    resetUploadSessionCensusReplacementColumnCacheForTests();
    console.log('[beforeEach] cleared temporarymeasurements + unifiedchangelog + coremeasurements + uploadmetrics + upload_sessions');
  });

  /** Inserts the session row the marker is written to, as the upload route would. */
  async function seedUploadSession(sessionID: string): Promise<void> {
    await connection.query(
      `INSERT INTO upload_sessions (session_id, schema_name, plot_id, census_id, user_id, state)
       VALUES (?, ?, ?, ?, 'stage-measurements-test@forestgeo.test', 'uploading')`,
      [sessionID, schema, plotID, censusID]
    );
  }

  async function censusReplacementMarker(sessionID: string): Promise<string | null> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT census_replacement_completed_at AS marker FROM upload_sessions WHERE session_id = ?`, [
      sessionID
    ]);
    return rows.length === 0 || rows[0].marker === null ? null : String(rows[0].marker);
  }

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

    // The unparseable-date and missing-quadrat rows are parse rejects, surfaced
    // for caller-side recording rather than staged.
    expect(result.invalidRows).toHaveLength(EXPECTED_INVALID_ROW_COUNT);
    expect(result.invalidRows.map(row => String(row.tag))).toEqual([...EXPECTED_INVALID_ROW_TREETAGS]);

    const invalidReasonByTag = new Map(result.invalidRows.map(row => [String(row.tag), String(row.failureReason)]));
    expect(invalidReasonByTag.get('T0005')).toContain(`Unparseable date value: ${UNPARSEABLE_DATE}`);
    expect(invalidReasonByTag.get('T0006')).toContain('Missing required fields: quadrat');

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

    // Neither reject (T0005 unparseable date, T0006 missing quadrat) may reach
    // the database — a bad date is refused outright rather than coerced to the
    // zero date and staged.
    const stagedTags = staged.map(row => row.TreeTag);
    for (const rejectedTag of EXPECTED_INVALID_ROW_TREETAGS) {
      expect(stagedTags).not.toContain(rejectedTag);
    }

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
    for (const tag of EXPECTED_STAGED_TREETAGS) {
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

  // -------------------------------------------------------------------------
  // CLEAN_REUPLOAD census replacement runs ONCE per upload session
  // -------------------------------------------------------------------------

  const SECOND_FILE_NAME = 'stage-measurements-fixture-b.csv';
  const SECOND_BATCH_ID = 'stage-batch-0002';

  /**
   * Stands in for the failure rows an earlier file of the same upload already
   * wrote to coremeasurements — insertIngestionFailureRows uses the file's own
   * batch id, and /api/batchedupload mints a fresh one. Neither is in the next
   * file's batch family, and neither has an uploadmetrics row yet.
   */
  async function seedEarlierFileFailureRow(uploadBatchID: string): Promise<void> {
    await connection.query(
      `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
         UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex, IsActive)
       VALUES (?, NULL, FALSE, ?, 1.0, 1.0, ?, ?, 'T0005', 1, 1)`,
      [censusID, VALID_DATE, FILE_NAME, uploadBatchID]
    );
  }

  async function countCensusMeasurements(): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM coremeasurements WHERE CensusID = ?`, [censusID]);
    return Number(rows[0].count);
  }

  it('keeps the failure rows an earlier file of the SAME upload session recorded', async () => {
    await seedUploadSession(UPLOAD_SESSION_ID);

    // File A of the upload stages and records two rejected rows.
    const firstTransactionID = await connectionManager.beginTransaction();
    await stageMeasurementChunk(connectionManager, baseParams(firstTransactionID));
    await connectionManager.commitTransaction(firstTransactionID);
    expect(await censusReplacementMarker(UPLOAD_SESSION_ID), 'file A must record that it replaced the census').not.toBeNull();
    await seedEarlierFileFailureRow('stage-batch-0001-fail');
    await seedEarlierFileFailureRow('batchedupload-fresh-id');
    expect(await countCensusMeasurements()).toBe(2);

    // File B of the SAME upload stages next. The synchronous route stages every
    // file before any ingestion, so file A has no uploadmetrics row yet and its
    // batches are outside file B's family — a second census-wide replacement
    // here would destroy the only record of what file A rejected.
    const secondTransactionID = await connectionManager.beginTransaction();
    await stageMeasurementChunk(
      connectionManager,
      baseParams(secondTransactionID, { fileName: SECOND_FILE_NAME, batchID: SECOND_BATCH_ID, uploadSessionID: UPLOAD_SESSION_ID })
    );
    await connectionManager.commitTransaction(secondTransactionID);

    const surviving = await countCensusMeasurements();
    console.log(`[same-session] failure rows surviving file B's staging: ${surviving}`);
    expect(surviving).toBe(2);
  });

  it('still replaces the census when a NEW upload session starts', async () => {
    const newSessionID = 'a-different-upload-session';
    await seedUploadSession(newSessionID);
    // Rows left behind by a genuinely previous upload.
    await seedEarlierFileFailureRow('previous-upload-batch');
    expect(await countCensusMeasurements()).toBe(1);

    const transactionID = await connectionManager.beginTransaction();
    await stageMeasurementChunk(connectionManager, baseParams(transactionID, { uploadSessionID: newSessionID }));
    await connectionManager.commitTransaction(transactionID);

    const surviving = await countCensusMeasurements();
    console.log(`[new-session] prior rows surviving the census replacement: ${surviving}`);
    expect(surviving).toBe(0);
  });

  /**
   * The zero-staged edge the staged-row proxy could not see.
   *
   * "Has this session already replaced the census" used to be answered by "has
   * this session staged any rows". When every row of file A drops as an INSERT
   * IGNORE duplicate, nothing is staged — so file B read "no staged rows",
   * re-ran the census-wide cleanup, and deleted the failure rows file A had just
   * recorded. The durable marker records the replacement itself, so it is right
   * even when the staging produced nothing.
   */
  it('skips the second file’s cleanup even when the first file staged ZERO rows', async () => {
    await seedUploadSession(UPLOAD_SESSION_ID);

    // File A: every row is dropped before insert, so nothing is staged. Its
    // rejects still land in coremeasurements, which is what must survive.
    const firstTransactionID = await connectionManager.beginTransaction();
    await stageMeasurementChunk(connectionManager, baseParams(firstTransactionID, { rawRows: [] }));
    await connectionManager.commitTransaction(firstTransactionID);

    const stagedByFileA = await countStagedRows(connectionManager, schema, FILE_NAME, BATCH_ID, plotID, censusID);
    console.log(`[zero-staged] file A staged ${stagedByFileA} row(s); marker=${await censusReplacementMarker(UPLOAD_SESSION_ID)}`);
    expect(stagedByFileA, 'this test is only meaningful if file A staged nothing').toBe(0);
    expect(await censusReplacementMarker(UPLOAD_SESSION_ID), 'a zero-row file still performed the census replacement').not.toBeNull();

    await seedEarlierFileFailureRow('stage-batch-0001-fail');
    expect(await countCensusMeasurements()).toBe(1);

    // File B of the same session must NOT replace the census again.
    const secondTransactionID = await connectionManager.beginTransaction();
    await stageMeasurementChunk(
      connectionManager,
      baseParams(secondTransactionID, { fileName: SECOND_FILE_NAME, batchID: SECOND_BATCH_ID, uploadSessionID: UPLOAD_SESSION_ID })
    );
    await connectionManager.commitTransaction(secondTransactionID);

    const surviving = await countCensusMeasurements();
    console.log(`[zero-staged] file A's failure rows surviving file B: ${surviving}`);
    expect(surviving).toBe(1);
  });

  it('loses the marker with the cleanup when the transaction rolls back, so the retry cleans again', async () => {
    await seedUploadSession(UPLOAD_SESSION_ID);
    await seedEarlierFileFailureRow('previous-upload-batch');
    expect(await countCensusMeasurements()).toBe(1);

    // Attempt 1: cleanup + marker both happen, then the caller rolls back.
    const abortedTransactionID = await connectionManager.beginTransaction();
    await stageMeasurementChunk(connectionManager, baseParams(abortedTransactionID));
    await connectionManager.rollbackTransaction(abortedTransactionID);

    // Neither survives — the marker cannot claim a cleanup that was undone.
    console.log(`[rollback] marker after rollback=${await censusReplacementMarker(UPLOAD_SESSION_ID)} priorRows=${await countCensusMeasurements()}`);
    expect(await censusReplacementMarker(UPLOAD_SESSION_ID)).toBeNull();
    expect(await countCensusMeasurements(), 'the rolled-back cleanup must not have removed the prior row').toBe(1);

    // Attempt 2 therefore performs the replacement it owes.
    const retryTransactionID = await connectionManager.beginTransaction();
    await stageMeasurementChunk(connectionManager, baseParams(retryTransactionID));
    await connectionManager.commitTransaction(retryTransactionID);

    console.log(`[rollback] after retry: marker=${await censusReplacementMarker(UPLOAD_SESSION_ID)} priorRows=${await countCensusMeasurements()}`);
    expect(await censusReplacementMarker(UPLOAD_SESSION_ID)).not.toBeNull();
    expect(await countCensusMeasurements()).toBe(0);
  });

  it('does not re-run cleanup for later chunks of the same file once the marker is committed', async () => {
    await seedUploadSession(UPLOAD_SESSION_ID);

    const firstChunkTransactionID = await connectionManager.beginTransaction();
    await stageMeasurementChunk(connectionManager, baseParams(firstChunkTransactionID));
    await connectionManager.commitTransaction(firstChunkTransactionID);
    const markerAfterFirstChunk = await censusReplacementMarker(UPLOAD_SESSION_ID);
    expect(markerAfterFirstChunk).not.toBeNull();

    // Rows an earlier file of this upload rejected, recorded between chunks.
    await seedEarlierFileFailureRow('stage-batch-0001-fail');

    // A later chunk of the SAME file and session: same batch id, so it is not
    // even the multi-file case — it must still not clean.
    const secondChunkTransactionID = await connectionManager.beginTransaction();
    await stageMeasurementChunk(connectionManager, baseParams(secondChunkTransactionID));
    await connectionManager.commitTransaction(secondChunkTransactionID);

    console.log(`[later-chunk] marker unchanged=${(await censusReplacementMarker(UPLOAD_SESSION_ID)) === markerAfterFirstChunk}`);
    expect(await countCensusMeasurements(), 'a later chunk must not re-run the census replacement').toBe(1);
    expect(await censusReplacementMarker(UPLOAD_SESSION_ID), 'the marker is set once, not rewritten').toBe(markerAfterFirstChunk);
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
