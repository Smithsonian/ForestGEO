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
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';
import { SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { buildFileUploadChangelogRecordID } from '@/lib/uploads/file-names';

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
    // replaceCensusForCleanReupload runs each unit in its own withTransaction; this
    // mock begins, commits or rolls back on the shared connection like the real one.
    withTransaction: async <T>(fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown>; readonly id: string }) => Promise<T>): Promise<T> => {
      const id = await manager.beginTransaction();
      try {
        const result = await fn({ id, query: (sql: string, params?: unknown[]) => manager.executeQuery(sql, params, id) });
        await manager.commitTransaction(id);
        return result;
      } catch (error) {
        await manager.rollbackTransaction(id);
        throw error;
      }
    },
    // Real MySQL GET_LOCK/RELEASE_LOCK (#507) — recordAuditedIngestionFailureRows
    // serializes its bounded before-snapshot per (schema, batchID) with this.
    acquireApplicationLock: async (lockName: string, transactionID: string, timeoutMs: number) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      const [rows] = await sharedState.connection.query('SELECT GET_LOCK(?, ?) as acquired', [lockName, Math.ceil(timeoutMs / 1000)]);
      return (rows as { acquired: number }[])[0]?.acquired === 1;
    },
    releaseApplicationLock: async (lockName: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      await sharedState.connection.query('SELECT RELEASE_LOCK(?) as released', [lockName]);
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
import {
  CensusReplacementIncompleteError,
  countStagedRows,
  EmptyMeasurementUploadError,
  replaceCensusForCleanReupload,
  stageMeasurementChunk,
  type CensusReplacementParams,
  type StageMeasurementChunkParams
} from '@/lib/uploads/stage-measurements';
import { ensureUploadSessionsTable } from '@/config/uploadsessiontracker';
import { TEMPORARY_MEASUREMENT_INSERT_COLUMNS } from '@/lib/ingestion/temporary-measurements';
import { CENSUS_REPLACEMENT_STATEMENT } from '../setup/census-replacement-statement-patterns';
import { resetUploadSessionReplacementMarkerCacheForTests } from '@/lib/uploads/upload-session-replacement-marker';

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
  let config: TestDatabaseConfig;
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
    // This suite's shared connection accumulates GET_LOCKs across tests (MySQL
    // ties them to the session, not the transaction) — release them all so one
    // test's lock state can never bleed into the next.
    await connection.query('SELECT RELEASE_ALL_LOCKS()');
    await connection.query('DELETE FROM temporarymeasurements');
    await connection.query('DELETE FROM unifiedchangelog');
    await connection.query('DELETE FROM coremeasurements');
    await connection.query('DELETE FROM uploadmetrics');
    await connection.query('DELETE FROM upload_sessions');
    resetUploadSessionReplacementMarkerCacheForTests();
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

  /** The sync route's and worker's production sequence: finish the census replacement, then open the staging transaction. */
  async function replaceThenBegin(overrides: Partial<StageMeasurementChunkParams> = {}): Promise<string> {
    const replacementParams = baseReplacementParams(overrides);
    if (replacementParams.uploadSessionID !== null) await ensureUploadSession(replacementParams.uploadSessionID);
    const replacement = await replaceCensusForCleanReupload(connectionManager, replacementParams);
    console.log(
      `[replace] outcome=${replacement.outcome} deletedRows=${replacement.deletedRows} windowCount=${replacement.windowCount} ` +
        `session=${replacementParams.uploadSessionID}`
    );
    return connectionManager.beginTransaction();
  }

  async function ensureUploadSession(sessionID: string): Promise<void> {
    const [existing] = await connection.query<RowDataPacket[]>(`SELECT 1 FROM upload_sessions WHERE session_id = ?`, [sessionID]);
    if (existing.length === 0) await seedUploadSession(sessionID);
  }

  function baseParams(transactionID: string, overrides: Partial<StageMeasurementChunkParams> = {}): StageMeasurementChunkParams {
    return { ...baseReplacementParams(overrides), transactionID, ...overrides };
  }

  function baseReplacementParams(overrides: Partial<StageMeasurementChunkParams> = {}): CensusReplacementParams {
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
      firstRowOrdinal: null,
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
    const transactionID = await replaceThenBegin();
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
    // RecordID is keyed by upload ATTEMPT, not the raw filename (#507) — see
    // buildFileUploadChangelogRecordID's doc comment: uploadSessionID is the
    // attempt identity here.
    expect(changelog[0].RecordID).toBe(buildFileUploadChangelogRecordID(FILE_NAME, UPLOAD_SESSION_ID));
    expect(changelog[0].Operation).toBe('INSERT');
    expect(changelog[0].ChangedBy).toBe(CHANGED_BY);
    const metadata = typeof changelog[0].NewRowState === 'string' ? JSON.parse(changelog[0].NewRowState) : changelog[0].NewRowState;
    expect(metadata.rowCount).toBe(EXPECTED_STAGED_ROW_COUNT);
    expect(metadata.droppedCount).toBe(0);
    expect(metadata.batchCount).toBe(1);
    expect(metadata.formType).toBe('measurements');
  });

  // temporarymeasurements has no unique constraint (see the re-staging test below),
  // so a real INSERT IGNORE collision cannot occur naturally here. To exercise the
  // dropped-row detection path with a REAL drop, this test intercepts the bulk
  // INSERT statement and strips one row's VALUES tuple before it reaches the
  // server — exactly what a duplicate-key collision would do to the statement's
  // effect. Every downstream step (the INSERT affectedRows sum, findDroppedMeasurementCandidates,
  // and the failure-row insert) still runs against the real database.
  it('records RawPlotX/RawPlotY when a row is silently dropped by INSERT IGNORE', async () => {
    const KEPT_TREETAG = 'T9001';
    const DROPPED_TREETAG = 'T9002';
    const DROPPED_PLOT_X = '-0.271';
    const DROPPED_PLOT_Y = '267.5';

    const coordCsvHeaders = ['treetag', 'stemtag', 'speciescode', 'quadrat', 'lx', 'ly', 'px', 'py', 'dbh', 'hom', 'date', 'codes'];
    const rawRows = [
      {
        treetag: KEPT_TREETAG,
        stemtag: '1',
        speciescode: 'ACERRU',
        quadrat: 'Q01',
        lx: '1.5',
        ly: '2.5',
        px: '10',
        py: '20',
        dbh: '10.55',
        hom: '1.3',
        date: VALID_DATE,
        codes: 'A'
      },
      {
        treetag: DROPPED_TREETAG,
        stemtag: '1',
        speciescode: 'ACERRU',
        quadrat: 'Q01',
        lx: '3.5',
        ly: '4.5',
        px: DROPPED_PLOT_X,
        py: DROPPED_PLOT_Y,
        dbh: '12.0',
        hom: '1.3',
        date: VALID_DATE,
        codes: 'A'
      }
    ];

    const columnCount = TEMPORARY_MEASUREMENT_INSERT_COLUMNS.length;
    const treeTagColumnIndex = TEMPORARY_MEASUREMENT_INSERT_COLUMNS.indexOf('TreeTag');

    const originalExecuteQuery = ConnectionManager.getInstance().executeQuery.bind(connectionManager);
    const executeQuerySpy = vi
      .spyOn(connectionManager, 'executeQuery')
      .mockImplementation(async (query: string, params?: unknown[], transactionID?: string) => {
        if (typeof query === 'string' && query.includes('INSERT IGNORE INTO') && query.includes('.temporarymeasurements') && Array.isArray(params)) {
          const rowCount = params.length / columnCount;
          let dropRowIndex = -1;
          for (let i = 0; i < rowCount; i++) {
            if (params[i * columnCount + treeTagColumnIndex] === DROPPED_TREETAG) {
              dropRowIndex = i;
              break;
            }
          }
          if (dropRowIndex !== -1) {
            const [beforeValues, afterValues] = query.split(' VALUES ');
            const tuples = afterValues.match(/\([^()]*\)/g) ?? [];
            tuples.splice(dropRowIndex, 1);
            const newQuery = `${beforeValues} VALUES ${tuples.join(', ')}`;
            const newParams = [...params.slice(0, dropRowIndex * columnCount), ...params.slice((dropRowIndex + 1) * columnCount)];
            return originalExecuteQuery(newQuery, newParams, transactionID);
          }
        }
        return originalExecuteQuery(query, params, transactionID);
      });

    try {
      const transactionID = await replaceThenBegin({
        fileName: 'stage-measurements-drop-fixture.csv',
        batchID: 'stage-drop-batch-0001',
        rawRows,
        csvHeaders: coordCsvHeaders
      });
      const result = await stageMeasurementChunk(
        connectionManager,
        baseParams(transactionID, {
          fileName: 'stage-measurements-drop-fixture.csv',
          batchID: 'stage-drop-batch-0001',
          rawRows,
          csvHeaders: coordCsvHeaders
        })
      );
      await connectionManager.commitTransaction(transactionID);

      console.log(`[drop-fixture] insertedCount=${result.insertedCount} expectedCount=${result.expectedCount} droppedCount=${result.droppedCount}`);
      expect(result.expectedCount).toBe(2);
      expect(result.insertedCount).toBe(1);
      expect(result.droppedCount, 'the spy must have forced exactly one row to be dropped').toBe(1);

      const [failedRows] = await connection.query<RowDataPacket[]>(
        `SELECT CoreMeasurementID, RawTreeTag, CAST(RawX AS CHAR) AS RawXText, CAST(RawY AS CHAR) AS RawYText,
                CAST(RawPlotX AS CHAR) AS RawPlotXText, CAST(RawPlotY AS CHAR) AS RawPlotYText
         FROM coremeasurements
         WHERE StemGUID IS NULL AND RawTreeTag = ?`,
        [DROPPED_TREETAG]
      );
      console.log(`[drop-fixture] failed coremeasurements row: ${JSON.stringify(failedRows)}`);
      expect(failedRows, 'the dropped row must be recorded as an unresolved ingestion error').toHaveLength(1);
      expect(Number(failedRows[0].RawPlotXText)).toBeCloseTo(Number(DROPPED_PLOT_X), 6);
      expect(Number(failedRows[0].RawPlotYText)).toBeCloseTo(Number(DROPPED_PLOT_Y), 6);

      // #507: the dropped row stageMeasurementChunk just persisted into
      // coremeasurements is itself a committed write and must be audited in
      // Recent Changes exactly like a real ingestion row — not just silently
      // written.
      const [auditRows] = await connection.query<RowDataPacket[]>(
        `SELECT Operation, NewRowState FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND RecordID = ?`,
        [failedRows[0].CoreMeasurementID]
      );
      console.log(`[drop-fixture] audit rows for dropped CoreMeasurementID=${failedRows[0].CoreMeasurementID}: ${JSON.stringify(auditRows)}`);
      expect(auditRows, 'the dropped row must have exactly one audit entry, not zero and not duplicated').toHaveLength(1);
      expect(auditRows[0].Operation).toBe('INSERT');
      const auditedState = typeof auditRows[0].NewRowState === 'string' ? JSON.parse(auditRows[0].NewRowState) : auditRows[0].NewRowState;
      expect(auditedState.RawTreeTag).toBe(DROPPED_TREETAG);
      expect(auditedState.StemGUID).toBeNull();
    } finally {
      executeQuerySpy.mockRestore();
    }
  });

  // -------------------------------------------------------------------------
  // #507: insertIngestionFailureRows UPSERTs dropped rows on the real unique
  // key ux_cm_uploadbatch_rowindex (UploadBatchID, SourceRowIndex) — a SECOND
  // stageMeasurementChunk call for the SAME (fileName, batchID) whose dropped
  // row lands at the SAME sourceRowIndex collides for real and triggers
  // MySQL's own ON DUPLICATE KEY UPDATE, not a simulated one. These three
  // tests drive that real collision via the SAME drop-forcing spy as the test
  // above, reused via buildTreeTagDropSpy, to prove the audit honestly
  // distinguishes changed-content (UPDATE), unchanged-content (no new audit
  // row), and a failed late audit (full rollback).
  // -------------------------------------------------------------------------

  function buildTreeTagDropSpy(droppedTreeTag: string, onQuery?: (query: string, params: unknown[] | undefined) => void) {
    const columnCount = TEMPORARY_MEASUREMENT_INSERT_COLUMNS.length;
    const treeTagColumnIndex = TEMPORARY_MEASUREMENT_INSERT_COLUMNS.indexOf('TreeTag');
    const originalExecuteQuery = ConnectionManager.getInstance().executeQuery.bind(connectionManager);
    return vi.spyOn(connectionManager, 'executeQuery').mockImplementation(async (query: string, params?: unknown[], transactionID?: string) => {
      if (typeof query === 'string') onQuery?.(query, params);
      if (typeof query === 'string' && query.includes('INSERT IGNORE INTO') && query.includes('.temporarymeasurements') && Array.isArray(params)) {
        const rowCount = params.length / columnCount;
        let dropRowIndex = -1;
        for (let i = 0; i < rowCount; i++) {
          if (params[i * columnCount + treeTagColumnIndex] === droppedTreeTag) {
            dropRowIndex = i;
            break;
          }
        }
        if (dropRowIndex !== -1) {
          const [beforeValues, afterValues] = query.split(' VALUES ');
          const tuples = afterValues.match(/\([^()]*\)/g) ?? [];
          tuples.splice(dropRowIndex, 1);
          const newQuery = `${beforeValues} VALUES ${tuples.join(', ')}`;
          const newParams = [...params.slice(0, dropRowIndex * columnCount), ...params.slice((dropRowIndex + 1) * columnCount)];
          return originalExecuteQuery(newQuery, newParams, transactionID);
        }
      }
      return originalExecuteQuery(query, params, transactionID);
    });
  }

  function buildTwoRowDropFixture(droppedTreeTag: string, droppedPlotX: string, droppedPlotY: string) {
    return {
      csvHeaders: ['treetag', 'stemtag', 'speciescode', 'quadrat', 'lx', 'ly', 'px', 'py', 'dbh', 'hom', 'date', 'codes'],
      rawRows: [
        {
          treetag: 'T9001',
          stemtag: '1',
          speciescode: 'ACERRU',
          quadrat: 'Q01',
          lx: '1.5',
          ly: '2.5',
          px: '10',
          py: '20',
          dbh: '10.55',
          hom: '1.3',
          date: VALID_DATE,
          codes: 'A'
        },
        {
          treetag: droppedTreeTag,
          stemtag: '1',
          speciescode: 'ACERRU',
          quadrat: 'Q01',
          lx: '3.5',
          ly: '4.5',
          px: droppedPlotX,
          py: droppedPlotY,
          dbh: '12.0',
          hom: '1.3',
          date: VALID_DATE,
          codes: 'A'
        }
      ]
    };
  }

  it('a changed-content retry of the same dropped row produces exactly one UPDATE audit with the correct Old/NewRowState (#507)', async () => {
    const DROPPED_TREETAG = 'T9010';
    const fileName = 'stage-measurements-drop-retry-changed.csv';
    const batchID = 'stage-drop-retry-changed-0001';

    const firstFixture = buildTwoRowDropFixture(DROPPED_TREETAG, '-0.271', '267.5');
    const firstSpy = buildTreeTagDropSpy(DROPPED_TREETAG);
    try {
      const tx1 = await replaceThenBegin({ fileName, batchID, ...firstFixture });
      await stageMeasurementChunk(connectionManager, baseParams(tx1, { fileName, batchID, ...firstFixture }));
      await connectionManager.commitTransaction(tx1);
    } finally {
      firstSpy.mockRestore();
    }

    const [firstRows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID FROM coremeasurements WHERE StemGUID IS NULL AND RawTreeTag = ? AND UploadFileID = ?`,
      [DROPPED_TREETAG, fileName]
    );
    expect(firstRows, 'setup: the first call must have recorded exactly one dropped row').toHaveLength(1);
    const coreMeasurementID = firstRows[0].CoreMeasurementID;

    // Second call: SAME fileName/batchID, SAME row position (sourceRowIndex),
    // DIFFERENT RawPlotX/RawPlotY — a real retry with changed content.
    const secondFixture = buildTwoRowDropFixture(DROPPED_TREETAG, '-0.512', '301.25');
    const secondSpy = buildTreeTagDropSpy(DROPPED_TREETAG);
    try {
      const tx2 = await replaceThenBegin({ fileName, batchID, ...secondFixture });
      await stageMeasurementChunk(connectionManager, baseParams(tx2, { fileName, batchID, ...secondFixture }));
      await connectionManager.commitTransaction(tx2);
    } finally {
      secondSpy.mockRestore();
    }

    // Still the SAME physical row (the unique key collided, not a new insert).
    const [secondRows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID, CAST(RawPlotX AS CHAR) AS RawPlotXText, CAST(RawPlotY AS CHAR) AS RawPlotYText
       FROM coremeasurements WHERE StemGUID IS NULL AND RawTreeTag = ? AND UploadFileID = ?`,
      [DROPPED_TREETAG, fileName]
    );
    expect(secondRows, 'the retry must UPSERT the SAME row via ux_cm_uploadbatch_rowindex, not insert a second one').toHaveLength(1);
    expect(secondRows[0].CoreMeasurementID).toBe(coreMeasurementID);
    expect(Number(secondRows[0].RawPlotXText)).toBeCloseTo(-0.512, 6);
    expect(Number(secondRows[0].RawPlotYText)).toBeCloseTo(301.25, 6);

    const [auditRows] = await connection.query<RowDataPacket[]>(
      `SELECT Operation, OldRowState, NewRowState FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND RecordID = ? ORDER BY ChangeID`,
      [coreMeasurementID]
    );
    console.log(`[drop-retry-changed] audit rows: ${JSON.stringify(auditRows)}`);
    expect(auditRows, 'exactly one INSERT (first call) and one UPDATE (changed retry), nothing more').toHaveLength(2);
    expect(auditRows[0].Operation).toBe('INSERT');
    expect(auditRows[1].Operation).toBe('UPDATE');
    const oldState = typeof auditRows[1].OldRowState === 'string' ? JSON.parse(auditRows[1].OldRowState) : auditRows[1].OldRowState;
    const newState = typeof auditRows[1].NewRowState === 'string' ? JSON.parse(auditRows[1].NewRowState) : auditRows[1].NewRowState;
    expect(Number(oldState.RawPlotX)).toBeCloseTo(-0.271, 6);
    expect(Number(oldState.RawPlotY)).toBeCloseTo(267.5, 6);
    expect(Number(newState.RawPlotX)).toBeCloseTo(-0.512, 6);
    expect(Number(newState.RawPlotY)).toBeCloseTo(301.25, 6);
  });

  it('an unchanged-content retry of the same dropped row produces zero new audit rows (#507)', async () => {
    const DROPPED_TREETAG = 'T9011';
    const fileName = 'stage-measurements-drop-retry-unchanged.csv';
    const batchID = 'stage-drop-retry-unchanged-0001';
    const fixture = buildTwoRowDropFixture(DROPPED_TREETAG, '-0.271', '267.5');

    for (let attempt = 0; attempt < 2; attempt++) {
      const spy = buildTreeTagDropSpy(DROPPED_TREETAG);
      try {
        const tx = await replaceThenBegin({ fileName, batchID, ...fixture });
        await stageMeasurementChunk(connectionManager, baseParams(tx, { fileName, batchID, ...fixture }));
        await connectionManager.commitTransaction(tx);
      } finally {
        spy.mockRestore();
      }
    }

    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID FROM coremeasurements WHERE StemGUID IS NULL AND RawTreeTag = ? AND UploadFileID = ?`,
      [DROPPED_TREETAG, fileName]
    );
    expect(rows).toHaveLength(1);

    const [auditRows] = await connection.query<RowDataPacket[]>(
      `SELECT Operation FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND RecordID = ?`,
      [rows[0].CoreMeasurementID]
    );
    console.log(`[drop-retry-unchanged] audit rows: ${JSON.stringify(auditRows)}`);
    expect(auditRows, 'an identical-content retry must not add a second (UPDATE) audit row — only the original INSERT').toHaveLength(1);
    expect(auditRows[0].Operation).toBe('INSERT');
  });

  it('a failed late audit of a dropped row rolls back the staging insert AND the dropped-row persistence (#507)', async () => {
    const DROPPED_TREETAG = 'T9012';
    const fileName = 'stage-measurements-drop-audit-fail.csv';
    const batchID = 'stage-drop-audit-fail-0001';
    const fixture = buildTwoRowDropFixture(DROPPED_TREETAG, '-0.271', '267.5');
    const AUDIT_FAILURE_MESSAGE = 'Simulated unifiedchangelog write failure for a dropped row';

    const spy = buildTreeTagDropSpy(DROPPED_TREETAG, query => {
      // recordAuditedIngestionFailureRows' keyed diff writes its INSERT audit
      // row via recordSnapshotRowsAudit (lib/changelog/ingestion-audit.ts),
      // which serializes caller-supplied before/after snapshots directly
      // rather than the old whole-scope `INSERT ... SELECT ... NOT EXISTS`
      // shape — match THAT statement's distinctive column list (both
      // OldRowState and NewRowState together is unique to it among every
      // other unifiedchangelog write this chunk issues).
      if (query.includes('.unifiedchangelog') && query.includes('OldRowState') && query.includes('NewRowState')) {
        throw new Error(AUDIT_FAILURE_MESSAGE);
      }
    });

    try {
      const transactionID = await replaceThenBegin({ fileName, batchID, ...fixture });
      // finally-bounded: if the `rejects` assertion itself throws (e.g. the
      // call unexpectedly resolves), the transaction must still be rolled
      // back, or it dangles open and every later test's beginTransaction in
      // this suite fails with "transaction already active".
      try {
        await expect(stageMeasurementChunk(connectionManager, baseParams(transactionID, { fileName, batchID, ...fixture }))).rejects.toThrow(
          AUDIT_FAILURE_MESSAGE
        );
      } finally {
        await connectionManager.rollbackTransaction(transactionID);
      }

      expect(await countStagedRows(connectionManager, schema, fileName, batchID, plotID, censusID), 'the staging insert must have rolled back too').toBe(0);
      const [coreRows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM coremeasurements WHERE UploadFileID = ?', [fileName]);
      expect(Number(coreRows[0].count), 'the dropped-row persistence must have rolled back together with its failed audit').toBe(0);
      const [auditRows] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND PlotID = ? AND CensusID = ?`,
        [plotID, censusID]
      );
      expect(Number(auditRows[0].count), 'no audit rows may survive a rolled-back transaction').toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('countStagedRows matches insertedCount for the staged scope and 0 elsewhere', async () => {
    const transactionID = await replaceThenBegin();
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
    const firstTransactionID = await replaceThenBegin();
    const firstResult = await stageMeasurementChunk(connectionManager, baseParams(firstTransactionID));
    await connectionManager.commitTransaction(firstTransactionID);

    const secondTransactionID = await replaceThenBegin();
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
    // inserted count reports zero drops. Within-batch dedup happens
    // downstream in bulkingestionprocess, not at staging time. If a unique key
    // is ever added, this test will fail and must be flipped to assert
    // droppedCount === EXPECTED_STAGED_ROW_COUNT and totalStaged === EXPECTED_STAGED_ROW_COUNT.
    expect(firstResult.insertedCount).toBe(EXPECTED_STAGED_ROW_COUNT);
    expect(secondResult.insertedCount).toBe(EXPECTED_STAGED_ROW_COUNT);
    expect(secondResult.droppedCount).toBe(0);
    expect(totalStaged).toBe(EXPECTED_STAGED_ROW_COUNT * 2);

    // Same file+batch on the second pass must NOT trigger the stale-batch
    // cleanup (the family is already staged) — first-pass rows survive.
    const staged = await fetchStagedRows();
    const tagCounts = staged.reduce<Record<string, number>>((acc, row) => {
      acc[String(row.TreeTag)] = (acc[String(row.TreeTag)] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`[re-stage] per-tag counts: ${JSON.stringify(tagCounts)}`);
    for (const tag of EXPECTED_STAGED_TREETAGS) {
      expect(tagCounts[tag]).toBe(2);
    }

    // Changelog is keyed by chunkIdentity, defaulting to batchID when a
    // caller does not pass one (#507): re-staging the SAME batchID with no
    // explicit chunkIdentity REPLACES that identity's own contribution rather
    // than adding to it, so the row count does NOT double even though
    // temporarymeasurements itself now holds two physical copies of the data
    // (asserted above). See the genuinely-new-chunk tests below for the case
    // where accumulation IS expected.
    const [changelog] = await connection.query<RowDataPacket[]>(`SELECT NewRowState FROM unifiedchangelog WHERE TableName = 'file_upload'`);
    expect(changelog).toHaveLength(1);
    const metadata = typeof changelog[0].NewRowState === 'string' ? JSON.parse(changelog[0].NewRowState) : changelog[0].NewRowState;
    console.log(`[re-stage] changelog metadata: ${JSON.stringify(metadata)}`);
    expect(metadata.rowCount, 'a retry of the SAME batchID must not inflate the running total').toBe(EXPECTED_STAGED_ROW_COUNT);
    expect(metadata.batchCount, 'a retry of the SAME batchID must not count as a second batch').toBe(1);
  });

  it('staging a genuinely NEW batchID for the same attempt accumulates into the running total (#507)', async () => {
    const NEW_CHUNK_BATCH_ID = 'stage-batch-0001-chunk2';

    const firstTransactionID = await replaceThenBegin();
    const firstResult = await stageMeasurementChunk(connectionManager, baseParams(firstTransactionID));
    await connectionManager.commitTransaction(firstTransactionID);

    const secondTransactionID = await replaceThenBegin({ batchID: NEW_CHUNK_BATCH_ID });
    const secondResult = await stageMeasurementChunk(connectionManager, baseParams(secondTransactionID, { batchID: NEW_CHUNK_BATCH_ID }));
    await connectionManager.commitTransaction(secondTransactionID);

    console.log(`[new-chunk] first.insertedCount=${firstResult.insertedCount} second.insertedCount=${secondResult.insertedCount}`);
    expect(firstResult.insertedCount).toBe(EXPECTED_STAGED_ROW_COUNT);
    expect(secondResult.insertedCount).toBe(EXPECTED_STAGED_ROW_COUNT);

    // A batchID never seen before for this attempt (uploadSessionID is shared
    // via baseParams) DOES accumulate — unlike the same-batchID-retry case
    // above, this is two real chunks of the same file, not one chunk counted
    // twice.
    const [changelog] = await connection.query<RowDataPacket[]>(`SELECT NewRowState FROM unifiedchangelog WHERE TableName = 'file_upload'`);
    expect(changelog).toHaveLength(1);
    const metadata = typeof changelog[0].NewRowState === 'string' ? JSON.parse(changelog[0].NewRowState) : changelog[0].NewRowState;
    console.log(`[new-chunk] changelog metadata: ${JSON.stringify(metadata)}`);
    expect(metadata.rowCount, 'two distinct chunks must sum').toBe(EXPECTED_STAGED_ROW_COUNT * 2);
    expect(metadata.batchCount, 'two distinct batchIDs must count as two batches').toBe(2);
  });

  // -------------------------------------------------------------------------
  // The REAL worker.ts shape (#507): lib/background-jobs/worker.ts stages
  // every chunk of one file under the SAME batchID (only chunkIndex differs),
  // passing `chunkIdentity: \`${batchID}:chunk${chunkIndex}\`` — the batchID
  // tests above never exercise this, since worker chunks never get distinct
  // batchIDs. This proves the actual bug Codex found: two distinct chunk
  // identities under ONE batchID must both accumulate (not collapse into
  // whichever ran last), and a retry of one of those same identities must
  // not then double it.
  // -------------------------------------------------------------------------

  it('accumulates two distinct logical chunks sharing one batchID (the real worker.ts shape), and a retry of one does not inflate (#507)', async () => {
    const CHUNK_0_IDENTITY = `${BATCH_ID}:chunk0`;
    const CHUNK_1_IDENTITY = `${BATCH_ID}:chunk1`;

    const chunk0TransactionID = await replaceThenBegin({ chunkIdentity: CHUNK_0_IDENTITY });
    const chunk0Result = await stageMeasurementChunk(connectionManager, baseParams(chunk0TransactionID, { chunkIdentity: CHUNK_0_IDENTITY }));
    await connectionManager.commitTransaction(chunk0TransactionID);

    const chunk1TransactionID = await replaceThenBegin({ chunkIdentity: CHUNK_1_IDENTITY });
    const chunk1Result = await stageMeasurementChunk(connectionManager, baseParams(chunk1TransactionID, { chunkIdentity: CHUNK_1_IDENTITY }));
    await connectionManager.commitTransaction(chunk1TransactionID);

    console.log(`[same-batch-chunks] chunk0.insertedCount=${chunk0Result.insertedCount} chunk1.insertedCount=${chunk1Result.insertedCount}`);
    expect(chunk0Result.insertedCount).toBe(EXPECTED_STAGED_ROW_COUNT);
    expect(chunk1Result.insertedCount).toBe(EXPECTED_STAGED_ROW_COUNT);

    const afterTwoChunks = await connection.query<RowDataPacket[]>(`SELECT NewRowState FROM unifiedchangelog WHERE TableName = 'file_upload'`);
    const metadataAfterTwoChunks = (() => {
      const row = afterTwoChunks[0][0];
      return typeof row.NewRowState === 'string' ? JSON.parse(row.NewRowState) : row.NewRowState;
    })();
    console.log(`[same-batch-chunks] after 2 distinct chunks: ${JSON.stringify(metadataAfterTwoChunks)}`);
    expect(metadataAfterTwoChunks.rowCount, 'two distinct chunk identities under ONE batchID must both accumulate').toBe(EXPECTED_STAGED_ROW_COUNT * 2);
    expect(metadataAfterTwoChunks.batchCount).toBe(2);

    // A worker retry of chunk 0 (same batchID, same chunkIdentity — the
    // worker reprocesses the file from chunkIndex 0 again after a transient
    // failure further down the file).
    const chunk0RetryTransactionID = await replaceThenBegin({ chunkIdentity: CHUNK_0_IDENTITY });
    const chunk0RetryResult = await stageMeasurementChunk(connectionManager, baseParams(chunk0RetryTransactionID, { chunkIdentity: CHUNK_0_IDENTITY }));
    await connectionManager.commitTransaction(chunk0RetryTransactionID);
    expect(chunk0RetryResult.insertedCount).toBe(EXPECTED_STAGED_ROW_COUNT);

    const afterRetry = await connection.query<RowDataPacket[]>(`SELECT NewRowState FROM unifiedchangelog WHERE TableName = 'file_upload'`);
    const metadataAfterRetry = (() => {
      const row = afterRetry[0][0];
      return typeof row.NewRowState === 'string' ? JSON.parse(row.NewRowState) : row.NewRowState;
    })();
    console.log(`[same-batch-chunks] after chunk0 retry: ${JSON.stringify(metadataAfterRetry)}`);
    expect(metadataAfterRetry.rowCount, 'retrying the SAME logical chunk must not inflate the total — only chunk1 is still counted once').toBe(
      EXPECTED_STAGED_ROW_COUNT * 2
    );
    expect(metadataAfterRetry.batchCount, 'retrying chunk0 must not be counted as a third chunk').toBe(2);
  });

  it('two differently-sized chunks (100 + 50) of one batch accumulate to exactly 150, and a retry of the first leaves the total unchanged (#507)', async () => {
    const CHUNK_A_IDENTITY = `${BATCH_ID}:chunk-a-100`;
    const CHUNK_B_IDENTITY = `${BATCH_ID}:chunk-b-50`;
    const rowsA = Array.from({ length: 100 }, (_, index) => fixtureRow({ treetag: `SIZEDA${index}`, quadrat: 'Q01', speciescode: 'ACERRU' }));
    const rowsB = Array.from({ length: 50 }, (_, index) => fixtureRow({ treetag: `SIZEDB${index}`, quadrat: 'Q01', speciescode: 'ACERRU' }));

    const txA = await replaceThenBegin({ chunkIdentity: CHUNK_A_IDENTITY, rawRows: rowsA });
    const resultA = await stageMeasurementChunk(connectionManager, baseParams(txA, { chunkIdentity: CHUNK_A_IDENTITY, rawRows: rowsA }));
    await connectionManager.commitTransaction(txA);
    expect(resultA.insertedCount).toBe(100);

    const txB = await replaceThenBegin({ chunkIdentity: CHUNK_B_IDENTITY, rawRows: rowsB });
    const resultB = await stageMeasurementChunk(connectionManager, baseParams(txB, { chunkIdentity: CHUNK_B_IDENTITY, rawRows: rowsB }));
    await connectionManager.commitTransaction(txB);
    expect(resultB.insertedCount).toBe(50);

    const [afterBothRows] = await connection.query<RowDataPacket[]>(`SELECT NewRowState FROM unifiedchangelog WHERE TableName = 'file_upload'`);
    const metadataAfterBoth = typeof afterBothRows[0].NewRowState === 'string' ? JSON.parse(afterBothRows[0].NewRowState) : afterBothRows[0].NewRowState;
    expect(metadataAfterBoth.rowCount, '100 + 50 must accumulate to exactly 150').toBe(150);
    expect(metadataAfterBoth.batchCount).toBe(2);

    // A retry of chunk A (same chunkIdentity) must REPLACE its own
    // contribution, not add a third 100 on top of the existing 150.
    const txARetry = await replaceThenBegin({ chunkIdentity: CHUNK_A_IDENTITY, rawRows: rowsA });
    const resultARetry = await stageMeasurementChunk(connectionManager, baseParams(txARetry, { chunkIdentity: CHUNK_A_IDENTITY, rawRows: rowsA }));
    await connectionManager.commitTransaction(txARetry);
    expect(resultARetry.insertedCount).toBe(100);

    const [afterRetryRows] = await connection.query<RowDataPacket[]>(`SELECT NewRowState FROM unifiedchangelog WHERE TableName = 'file_upload'`);
    const metadataAfterRetry = typeof afterRetryRows[0].NewRowState === 'string' ? JSON.parse(afterRetryRows[0].NewRowState) : afterRetryRows[0].NewRowState;
    expect(metadataAfterRetry.rowCount, 'a retry of chunk A must REPLACE its own contribution, leaving the total at 150, not inflate it to 250').toBe(150);
    expect(metadataAfterRetry.batchCount).toBe(2);
  });

  it('identical-content chunks staged at DIFFERENT chunkIdentity positions remain distinct, never collapsing into one', async () => {
    const sharedRows = buildFixtureChunk();
    const POSITION_1_IDENTITY = `${BATCH_ID}:chunk1`;
    const POSITION_2_IDENTITY = `${BATCH_ID}:chunk2`;

    const tx1 = await replaceThenBegin({ chunkIdentity: POSITION_1_IDENTITY, rawRows: sharedRows });
    await stageMeasurementChunk(connectionManager, baseParams(tx1, { chunkIdentity: POSITION_1_IDENTITY, rawRows: sharedRows }));
    await connectionManager.commitTransaction(tx1);

    const tx2 = await replaceThenBegin({ chunkIdentity: POSITION_2_IDENTITY, rawRows: sharedRows });
    await stageMeasurementChunk(connectionManager, baseParams(tx2, { chunkIdentity: POSITION_2_IDENTITY, rawRows: sharedRows }));
    await connectionManager.commitTransaction(tx2);

    const [rows] = await connection.query<RowDataPacket[]>(`SELECT NewRowState FROM unifiedchangelog WHERE TableName = 'file_upload'`);
    const metadata = typeof rows[0].NewRowState === 'string' ? JSON.parse(rows[0].NewRowState) : rows[0].NewRowState;
    expect(metadata.batchCount, 'two positions with byte-identical row content must still be tracked as two distinct chunks, not collapsed into one').toBe(2);
    expect(metadata.rowCount).toBe(EXPECTED_STAGED_ROW_COUNT * 2);
  });

  it('two independent upload attempts for the SAME filename get separate changelog rows with independent counts (#507)', async () => {
    const SECOND_ATTEMPT_SESSION_ID = 'stage-int-test-session-second-attempt';
    await seedUploadSession(UPLOAD_SESSION_ID);

    const firstAttemptTransactionID = await replaceThenBegin({ uploadSessionID: UPLOAD_SESSION_ID });
    await stageMeasurementChunk(connectionManager, baseParams(firstAttemptTransactionID, { uploadSessionID: UPLOAD_SESSION_ID }));
    await connectionManager.commitTransaction(firstAttemptTransactionID);

    // upload_sessions.active_scope_key (tablestructures.sql) is a generated
    // column that is non-NULL only while state is one of the "in-flight"
    // values, and uq_upload_sessions_active_scope enforces at most ONE such
    // row per (schema, plot, census). The first attempt's session must be
    // moved OUT of that active set before a second session for the SAME
    // scope is seeded, or the second seedUploadSession below violates that
    // unique index — two simultaneously "active" sessions in one scope was
    // exactly the bug this fixture used to have.
    await connection.query(`UPDATE upload_sessions SET state = 'completed' WHERE session_id = ?`, [UPLOAD_SESSION_ID]);
    await seedUploadSession(SECOND_ATTEMPT_SESSION_ID);

    // A SECOND, independent attempt — different uploadSessionID AND batchID
    // (a fresh batchID is what production actually mints per attempt), SAME
    // fileName (a brand-new upload of the same file after the first
    // attempt's session ended). This must never be merged into the first
    // attempt's running totals: buildFileUploadChangelogRecordID keys the
    // changelog row by attempt, not by filename alone.
    const secondAttemptTransactionID = await replaceThenBegin({ uploadSessionID: SECOND_ATTEMPT_SESSION_ID, batchID: 'stage-batch-0001-second-attempt' });
    await stageMeasurementChunk(
      connectionManager,
      baseParams(secondAttemptTransactionID, { uploadSessionID: SECOND_ATTEMPT_SESSION_ID, batchID: 'stage-batch-0001-second-attempt' })
    );
    await connectionManager.commitTransaction(secondAttemptTransactionID);

    const [changelogRows] = await connection.query<RowDataPacket[]>(
      `SELECT RecordID, NewRowState FROM unifiedchangelog WHERE TableName = 'file_upload' ORDER BY RecordID`
    );
    console.log(`[independent-attempts] changelog rows: ${JSON.stringify(changelogRows)}`);
    expect(changelogRows, 'two independent attempts must produce two separate file_upload rows, never merged').toHaveLength(2);

    const recordIDs = changelogRows.map(row => String(row.RecordID));
    expect(recordIDs).toContain(buildFileUploadChangelogRecordID(FILE_NAME, UPLOAD_SESSION_ID));
    expect(recordIDs).toContain(buildFileUploadChangelogRecordID(FILE_NAME, SECOND_ATTEMPT_SESSION_ID));

    for (const row of changelogRows) {
      const metadata = typeof row.NewRowState === 'string' ? JSON.parse(row.NewRowState) : row.NewRowState;
      expect(metadata.rowCount, `attempt ${row.RecordID} must report its OWN count, not the other attempt's`).toBe(EXPECTED_STAGED_ROW_COUNT);
      expect(metadata.batchCount).toBe(1);
    }
  });

  // ---------------------------------------------------------------------------
  // Cross-connection serialization of the file_upload summary row (#507) — a
  // genuinely separate physical MySQL session, not an emulation, so the
  // GET_LOCK contention between it and the suite's shared connection is real.
  // ---------------------------------------------------------------------------

  it('serializes overlapping first chunks before staging rows, producing one exact summary through real ConnectionManager', async () => {
    if (!['localhost', '127.0.0.1'].includes(process.env.AZURE_SQL_SERVER ?? '')) throw new Error('Local DB required');
    const { default: RealConnectionManager } = await vi.importActual<typeof import('@/lib/db/connectionmanager')>('@/lib/db/connectionmanager');
    const manager = RealConnectionManager.getInstance();
    const txA = await manager.beginTransaction();
    const txB = await manager.beginTransaction();
    const rowsA = Array.from({ length: 100 }, (_, index) => fixtureRow({ treetag: `RACEA${index}` }));
    const rowsB = Array.from({ length: 50 }, (_, index) => fixtureRow({ treetag: `RACEB${index}` }));
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    let sawFirstInsert!: () => void;
    const firstInsert = new Promise<void>(resolve => {
      sawFirstInsert = resolve;
    });
    let sawSecondLock!: () => void;
    const secondLock = new Promise<void>(resolve => {
      sawSecondLock = resolve;
    });
    const execute = manager.executeQuery.bind(manager);
    const acquire = manager.acquireApplicationLock.bind(manager);
    let paused = false;
    const querySpy = vi.spyOn(manager, 'executeQuery').mockImplementation(async (sql, params, tx) => {
      const result = await execute(sql, params, tx);
      // Pauses A after its summary lock and first staging INSERT, so B must queue behind that lock.
      if (tx === txA && !paused && sql.includes('INSERT') && sql.includes('temporarymeasurements')) {
        paused = true;
        sawFirstInsert();
        await firstGate;
      }
      return result;
    });
    const lockSpy = vi.spyOn(manager, 'acquireApplicationLock').mockImplementation((name, tx, timeout) => {
      if (tx === txB) sawSecondLock();
      return acquire(name, tx, timeout);
    });
    const run = async (tx: string, rows: ReturnType<typeof fixtureRow>[], chunkIdentity: string) => {
      try {
        const result = await stageMeasurementChunk(
          manager,
          baseParams(tx, {
            rawRows: rows,
            chunkIdentity,
            uploadSessionID: null,
            uploadMode: UploadMode.REVISIONS
          })
        );
        await manager.commitTransaction(tx);
        return result;
      } catch (error) {
        await manager.rollbackTransaction(tx);
        throw error;
      }
    };
    const runA = run(txA, rowsA, 'chunk-a');
    let runB: ReturnType<typeof run> | undefined;
    try {
      await firstInsert;
      runB = run(txB, rowsB, 'chunk-b');
      await secondLock;
      releaseFirst();
      const [resultA, resultB] = await Promise.all([runA, runB]);
      expect([resultA.insertedCount, resultB.insertedCount]).toEqual([100, 50]);
      const [summaries] = await connection.query<RowDataPacket[]>("SELECT NewRowState FROM unifiedchangelog WHERE TableName = 'file_upload'");
      expect(summaries).toHaveLength(1);
      const metadata = typeof summaries[0].NewRowState === 'string' ? JSON.parse(summaries[0].NewRowState) : summaries[0].NewRowState;
      expect(metadata.rowCount).toBe(150);
      expect(metadata.batchCount).toBe(2);
    } finally {
      releaseFirst();
      await Promise.allSettled([runA, ...(runB ? [runB] : [])]);
      querySpy.mockRestore();
      lockSpy.mockRestore();
      await manager.rollbackTransaction(txA);
      await manager.rollbackTransaction(txB);
      await manager.closeConnection();
    }
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
    const firstTransactionID = await replaceThenBegin();
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
    const secondTransactionID = await replaceThenBegin({ fileName: SECOND_FILE_NAME, batchID: SECOND_BATCH_ID, uploadSessionID: UPLOAD_SESSION_ID });
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

    const transactionID = await replaceThenBegin({ uploadSessionID: newSessionID });
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
   * this session staged any rows". When every row of file A fails row
   * validation, nothing is staged — so file B read "no staged rows", re-ran
   * the census-wide cleanup, and deleted the failure rows file A had just
   * recorded. The durable marker records the replacement itself, so it is
   * right even when the staging produced nothing.
   *
   * Deliberately nonempty-but-all-invalid input (every row is missing the
   * required `quadrat` field) rather than `rawRows: []` — issue #504's
   * structural-empty guard (EmptyMeasurementUploadError) now rejects a truly
   * empty/blank chunk before staging runs at all, so `rawRows: []` can no
   * longer stand in for "zero VALID rows" here. See the
   * "empty/blank input guard" tests below for that guard's own coverage.
   */
  it('skips the second file’s cleanup even when the first file staged ZERO rows', async () => {
    await seedUploadSession(UPLOAD_SESSION_ID);

    // File A: every row carries real data but fails validation (missing
    // quadrat), so nothing is staged. Its rejects still land in
    // coremeasurements, which is what must survive.
    const allInvalidNonblankRows = buildFixtureChunk().map(row => ({ ...row, quadrat: '' }));
    const firstTransactionID = await replaceThenBegin({ rawRows: allInvalidNonblankRows });
    await stageMeasurementChunk(connectionManager, baseParams(firstTransactionID, { rawRows: allInvalidNonblankRows }));
    await connectionManager.commitTransaction(firstTransactionID);

    const stagedByFileA = await countStagedRows(connectionManager, schema, FILE_NAME, BATCH_ID, plotID, censusID);
    console.log(`[zero-staged] file A staged ${stagedByFileA} row(s); marker=${await censusReplacementMarker(UPLOAD_SESSION_ID)}`);
    expect(stagedByFileA, 'this test is only meaningful if file A staged nothing').toBe(0);
    expect(await censusReplacementMarker(UPLOAD_SESSION_ID), 'a zero-row file still performed the census replacement').not.toBeNull();

    await seedEarlierFileFailureRow('stage-batch-0001-fail');
    expect(await countCensusMeasurements()).toBe(1);

    // File B of the same session must NOT replace the census again.
    const secondTransactionID = await replaceThenBegin({ fileName: SECOND_FILE_NAME, batchID: SECOND_BATCH_ID, uploadSessionID: UPLOAD_SESSION_ID });
    await stageMeasurementChunk(
      connectionManager,
      baseParams(secondTransactionID, { fileName: SECOND_FILE_NAME, batchID: SECOND_BATCH_ID, uploadSessionID: UPLOAD_SESSION_ID })
    );
    await connectionManager.commitTransaction(secondTransactionID);

    const surviving = await countCensusMeasurements();
    console.log(`[zero-staged] file A's failure rows surviving file B: ${surviving}`);
    expect(surviving).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Issue #504: structurally empty/blank input must be rejected BEFORE any
  // destructive CLEAN_REUPLOAD census-replacement cleanup runs — a header-only
  // (or otherwise entirely blank) chunk must never be able to wipe an existing
  // census. This is distinct from "zero VALID rows" (covered by the
  // zero-staged test above): a row with real-but-invalid data must still
  // proceed to normal validation/failure-recording, never be treated as
  // "empty".
  // -------------------------------------------------------------------------
  describe('empty/blank input guard (issue #504)', () => {
    /**
     * In-transaction reads via connectionManager, NOT the suite's separate
     * `connection`, which cannot see uncommitted writes. These direct staging
     * calls prove staging's own empty-input guard fires before it writes anything:
     * asserting only after rollback could not tell "the guard ran first" from "a
     * write ran, then rolled back". Reading mid-transaction can.
     */
    async function countCensusMeasurementsInTransaction(transactionID: string): Promise<number> {
      const countSQL = safeFormatQuery(schema, `SELECT COUNT(*) AS count FROM ??.coremeasurements WHERE CensusID = ?`);
      const rows = await connectionManager.executeQuery(countSQL, [censusID], transactionID);
      return Number(rows[0]?.count ?? 0);
    }

    async function censusReplacementMarkerInTransaction(sessionID: string, transactionID: string): Promise<string | null> {
      const markerSQL = safeFormatQuery(schema, `SELECT census_replacement_completed_at AS marker FROM ??.upload_sessions WHERE session_id = ?`);
      const rows = await connectionManager.executeQuery(markerSQL, [sessionID], transactionID);
      return rows.length === 0 || rows[0].marker === null ? null : String(rows[0].marker);
    }

    async function countStagedRowsInTransaction(fileName: string, batchID: string, transactionID: string): Promise<number> {
      const countSQL = safeFormatQuery(schema, `SELECT COUNT(*) AS count FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?`);
      const rows = await connectionManager.executeQuery(countSQL, [fileName, batchID], transactionID);
      return Number(rows[0]?.count ?? 0);
    }

    it('rejects an empty rawRows array before any census-replacement cleanup, preserving existing rows', async () => {
      await seedUploadSession(UPLOAD_SESSION_ID);
      await seedEarlierFileFailureRow('previous-upload-batch');
      expect(await countCensusMeasurements()).toBe(1);

      const transactionID = await connectionManager.beginTransaction();
      await expect(stageMeasurementChunk(connectionManager, baseParams(transactionID, { rawRows: [] }))).rejects.toThrow(EmptyMeasurementUploadError);

      const inTxnCensusCount = await countCensusMeasurementsInTransaction(transactionID);
      const inTxnMarker = await censusReplacementMarkerInTransaction(UPLOAD_SESSION_ID, transactionID);
      const inTxnStagedCount = await countStagedRowsInTransaction(FILE_NAME, BATCH_ID, transactionID);
      console.log(`[empty-guard] rawRows:[] — IN-TXN (pre-rollback): censusCount=${inTxnCensusCount} marker=${inTxnMarker} stagedCount=${inTxnStagedCount}`);
      expect(inTxnCensusCount, 'the census-replacement DELETE must never have run, not merely been rolled back').toBe(1);
      expect(inTxnMarker, 'the replacement marker UPDATE must never have run, not merely been rolled back').toBeNull();
      expect(inTxnStagedCount, 'the staging INSERT must never have run, not merely been rolled back').toBe(0);

      await connectionManager.rollbackTransaction(transactionID);

      console.log(`[empty-guard] rawRows:[] — census rows after rejected chunk: ${await countCensusMeasurements()}`);
      expect(await countCensusMeasurements(), 'an empty rawRows chunk must not have run the census-replacement cleanup').toBe(1);
      expect(await censusReplacementMarker(UPLOAD_SESSION_ID), 'no replacement marker should have been written for a rejected empty chunk').toBeNull();
      expect(await countStagedRows(connectionManager, schema, FILE_NAME, BATCH_ID, plotID, censusID)).toBe(0);
    });

    it('rejects an empty preKeyedRows array before any census-replacement cleanup, even when rawRows is nonempty', async () => {
      await seedUploadSession(UPLOAD_SESSION_ID);
      await seedEarlierFileFailureRow('previous-upload-batch');
      expect(await countCensusMeasurements()).toBe(1);

      const transactionID = await connectionManager.beginTransaction();
      // preKeyedRows takes precedence over rawRows (see stage-measurements.ts
      // JSDoc) — this proves the structural-empty check honours that same
      // precedence rather than falling back to the nonempty rawRows.
      await expect(stageMeasurementChunk(connectionManager, baseParams(transactionID, { preKeyedRows: [], rawRows: buildFixtureChunk() }))).rejects.toThrow(
        EmptyMeasurementUploadError
      );

      // See the comment on the in-txn helpers above: post-rollback-only
      // assertions cannot distinguish "guard ran first" from "cleanup ran,
      // then rolled back" — both land on the same final state.
      const inTxnCensusCount = await countCensusMeasurementsInTransaction(transactionID);
      const inTxnMarker = await censusReplacementMarkerInTransaction(UPLOAD_SESSION_ID, transactionID);
      const inTxnStagedCount = await countStagedRowsInTransaction(FILE_NAME, BATCH_ID, transactionID);
      console.log(
        `[empty-guard] preKeyedRows:[] — IN-TXN (pre-rollback): censusCount=${inTxnCensusCount} marker=${inTxnMarker} stagedCount=${inTxnStagedCount}`
      );
      expect(inTxnCensusCount, 'the census-replacement DELETE must never have run, not merely been rolled back').toBe(1);
      expect(inTxnMarker, 'the replacement marker UPDATE must never have run, not merely been rolled back').toBeNull();
      expect(inTxnStagedCount, 'the staging INSERT must never have run, not merely been rolled back').toBe(0);

      await connectionManager.rollbackTransaction(transactionID);

      console.log(`[empty-guard] preKeyedRows:[] — census rows after rejected chunk: ${await countCensusMeasurements()}`);
      expect(await countCensusMeasurements(), 'an empty preKeyedRows chunk must not have run the census-replacement cleanup').toBe(1);
      expect(await censusReplacementMarker(UPLOAD_SESSION_ID)).toBeNull();
    });

    it('rejects an all-blank-cell rawRows chunk (e.g. delimiter-only CSV lines) before any census-replacement cleanup', async () => {
      await seedUploadSession(UPLOAD_SESSION_ID);
      await seedEarlierFileFailureRow('previous-upload-batch');
      expect(await countCensusMeasurements()).toBe(1);

      // Shape a real CSV parse of ",,,,,,,,,\n,,,,,,,,,\n" would produce under
      // header:true — every cell an empty string, not an absent row.
      const blankCellRows: Record<string, string>[] = [
        { treetag: '', stemtag: '', speciescode: '', quadrat: '', lx: '', ly: '', dbh: '', hom: '', date: '', codes: '' },
        { treetag: '   ', stemtag: '', speciescode: '', quadrat: '', lx: '', ly: '', dbh: '', hom: '', date: '', codes: '' }
      ];

      const transactionID = await connectionManager.beginTransaction();
      await expect(stageMeasurementChunk(connectionManager, baseParams(transactionID, { rawRows: blankCellRows }))).rejects.toThrow(
        EmptyMeasurementUploadError
      );

      // See the comment on the in-txn helpers above: post-rollback-only
      // assertions cannot distinguish "guard ran first" from "cleanup ran,
      // then rolled back" — both land on the same final state.
      const inTxnCensusCount = await countCensusMeasurementsInTransaction(transactionID);
      const inTxnMarker = await censusReplacementMarkerInTransaction(UPLOAD_SESSION_ID, transactionID);
      const inTxnStagedCount = await countStagedRowsInTransaction(FILE_NAME, BATCH_ID, transactionID);
      console.log(
        `[empty-guard] all-blank-cell rows — IN-TXN (pre-rollback): censusCount=${inTxnCensusCount} marker=${inTxnMarker} stagedCount=${inTxnStagedCount}`
      );
      expect(inTxnCensusCount, 'the census-replacement DELETE must never have run, not merely been rolled back').toBe(1);
      expect(inTxnMarker, 'the replacement marker UPDATE must never have run, not merely been rolled back').toBeNull();
      expect(inTxnStagedCount, 'the staging INSERT must never have run, not merely been rolled back').toBe(0);

      await connectionManager.rollbackTransaction(transactionID);

      console.log(`[empty-guard] all-blank-cell rows — census rows after rejected chunk: ${await countCensusMeasurements()}`);
      expect(await countCensusMeasurements(), 'an all-blank-cell chunk must not have run the census-replacement cleanup').toBe(1);
      expect(await censusReplacementMarker(UPLOAD_SESSION_ID)).toBeNull();
    });

    it('does NOT treat a nonempty chunk whose rows all fail validation as empty — it still proceeds to staging/failure recording', async () => {
      await seedUploadSession(UPLOAD_SESSION_ID);

      // Every row carries real data (a tag, species, etc.) but is missing the
      // required `quadrat` field. This must NOT throw EmptyMeasurementUploadError:
      // it is "zero valid rows", not "empty input", and must still run the
      // census-replacement cleanup and record the rows as invalid.
      const allInvalidNonblankRows = buildFixtureChunk().map(row => ({ ...row, quadrat: '' }));
      const transactionID = await replaceThenBegin({ rawRows: allInvalidNonblankRows });
      const result = await stageMeasurementChunk(connectionManager, baseParams(transactionID, { rawRows: allInvalidNonblankRows }));
      await connectionManager.commitTransaction(transactionID);

      expect(result.insertedCount).toBe(0);
      expect(result.invalidRows.length).toBe(allInvalidNonblankRows.length);
      expect(await censusReplacementMarker(UPLOAD_SESSION_ID), 'a nonempty-but-all-invalid chunk is a real CLEAN_REUPLOAD attempt').not.toBeNull();
    });
  });

  class InjectedWindowFailure extends Error {}

  it('keeps the marker unset when a replacement window rolls back, leaves that window intact, and the retry finishes the replacement', async () => {
    await seedUploadSession(UPLOAD_SESSION_ID);
    await seedEarlierFileFailureRow('previous-upload-batch');
    expect(await countCensusMeasurements()).toBe(1);

    const originalExecuteQuery = connectionManager.executeQuery.bind(connectionManager);
    const failingDeleteSpy = vi
      .spyOn(connectionManager, 'executeQuery')
      .mockImplementation(async (query: string, params?: unknown[], transactionID?: string) => {
        if (CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_DELETE.test(query)) throw new InjectedWindowFailure('injected failure at the census measurement DELETE');
        return originalExecuteQuery(query, params, transactionID);
      });
    let replacementError: unknown;
    try {
      await replaceCensusForCleanReupload(connectionManager, baseReplacementParams());
    } catch (error) {
      replacementError = error;
    } finally {
      failingDeleteSpy.mockRestore();
    }

    console.log(
      `[window-rollback] error=${replacementError instanceof Error ? replacementError.name : String(replacementError)} ` +
        `marker=${await censusReplacementMarker(UPLOAD_SESSION_ID)} priorRows=${await countCensusMeasurements()}`
    );
    expect(replacementError).toBeInstanceOf(InjectedWindowFailure);
    expect(await censusReplacementMarker(UPLOAD_SESSION_ID), 'a rolled-back window must not leave a marker claiming the replacement finished').toBeNull();
    expect(await countCensusMeasurements(), 'the rolled-back window must not have removed the prior row').toBe(1);

    const retryTransactionID = await replaceThenBegin();
    await stageMeasurementChunk(connectionManager, baseParams(retryTransactionID));
    await connectionManager.commitTransaction(retryTransactionID);

    console.log(`[window-rollback] after retry: marker=${await censusReplacementMarker(UPLOAD_SESSION_ID)} priorRows=${await countCensusMeasurements()}`);
    expect(await censusReplacementMarker(UPLOAD_SESSION_ID)).not.toBeNull();
    expect(await countCensusMeasurements()).toBe(0);
  });

  describe('I6: a staging rollback does not undo the replacement', () => {
    const PRIOR_ROW_COUNT = 3;

    async function countDeleteAudits(): Promise<number> {
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS count FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND Operation = 'DELETE' AND PlotID = ? AND CensusID = ?`,
        [plotID, censusID]
      );
      return Number(rows[0].count);
    }

    it('a retry with the same session replaces nothing again, stages, and adds no DELETE audits (catches: a replacement that re-runs, or a marker rolled back with staging)', async () => {
      await seedUploadSession(UPLOAD_SESSION_ID);
      for (let priorRow = 0; priorRow < PRIOR_ROW_COUNT; priorRow++) await seedEarlierFileFailureRow(`previous-upload-batch-${priorRow}`);
      expect(await countCensusMeasurements()).toBe(PRIOR_ROW_COUNT);

      const abortedTransactionID = await replaceThenBegin();
      await stageMeasurementChunk(connectionManager, baseParams(abortedTransactionID));
      await connectionManager.rollbackTransaction(abortedTransactionID);

      const auditsAfterReplacement = await countDeleteAudits();
      console.log(
        `[staging-rollback] marker=${await censusReplacementMarker(UPLOAD_SESSION_ID)} priorRows=${await countCensusMeasurements()} ` +
          `deleteAudits=${auditsAfterReplacement} staged=${await countStagedRows(connectionManager, schema, FILE_NAME, BATCH_ID, plotID, censusID)}`
      );
      expect(await censusReplacementMarker(UPLOAD_SESSION_ID), 'the replacement committed on its own; rolling back staging must not unset it').not.toBeNull();
      expect(await countCensusMeasurements(), 'the committed replacement stays applied').toBe(0);
      expect(auditsAfterReplacement, 'every removed row was audited').toBe(PRIOR_ROW_COUNT);
      expect(await countStagedRows(connectionManager, schema, FILE_NAME, BATCH_ID, plotID, censusID)).toBe(0);

      const retryReplacement = await replaceCensusForCleanReupload(connectionManager, baseReplacementParams());
      console.log(`[staging-rollback] retry replacement: ${JSON.stringify(retryReplacement)}`);
      expect(retryReplacement).toEqual({ outcome: 'already_completed', deletedRows: 0, windowCount: 0 });

      const retryTransactionID = await connectionManager.beginTransaction();
      const retryResult = await stageMeasurementChunk(connectionManager, baseParams(retryTransactionID));
      await connectionManager.commitTransaction(retryTransactionID);

      expect(retryResult.insertedCount).toBe(EXPECTED_STAGED_ROW_COUNT);
      expect(await countDeleteAudits(), 'the retry must not delete or audit anything again').toBe(auditsAfterReplacement);
    });
  });

  it('refuses a clean re-upload first chunk whose replacement never ran, without touching the census', async () => {
    await seedUploadSession(UPLOAD_SESSION_ID);
    await seedEarlierFileFailureRow('previous-upload-batch');

    const transactionID = await connectionManager.beginTransaction();
    await expect(stageMeasurementChunk(connectionManager, baseParams(transactionID))).rejects.toThrow(CensusReplacementIncompleteError);
    const stagedInTransaction = await connectionManager.executeQuery(
      safeFormatQuery(schema, `SELECT COUNT(*) AS count FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?`),
      [FILE_NAME, BATCH_ID],
      transactionID
    );
    await connectionManager.rollbackTransaction(transactionID);

    console.log(`[guard] stagedInTransaction=${stagedInTransaction[0]?.count} priorRows=${await countCensusMeasurements()}`);
    expect(Number(stagedInTransaction[0]?.count ?? 0), 'nothing may be staged before the guard refuses').toBe(0);
    expect(await countCensusMeasurements(), 'the guard must not delete census rows').toBe(1);
    expect(await censusReplacementMarker(UPLOAD_SESSION_ID)).toBeNull();
  });

  it('still removes the stale staged batches of the same file in the staging transaction once the guard passes (catches: dropping the stale-batch cleanup with the census cleanup)', async () => {
    const ABANDONED_BATCH_ID = 'abandoned-earlier-attempt-batch';
    await seedUploadSession(UPLOAD_SESSION_ID);
    const abandonedTransactionID = await replaceThenBegin({ batchID: ABANDONED_BATCH_ID });
    await stageMeasurementChunk(connectionManager, baseParams(abandonedTransactionID, { batchID: ABANDONED_BATCH_ID }));
    await connectionManager.commitTransaction(abandonedTransactionID);
    expect(await countStagedRows(connectionManager, schema, FILE_NAME, ABANDONED_BATCH_ID, plotID, censusID), 'setup: the abandoned batch is staged').toBe(
      EXPECTED_STAGED_ROW_COUNT
    );

    const freshTransactionID = await replaceThenBegin();
    await stageMeasurementChunk(connectionManager, baseParams(freshTransactionID));
    await connectionManager.commitTransaction(freshTransactionID);

    const abandonedAfter = await countStagedRows(connectionManager, schema, FILE_NAME, ABANDONED_BATCH_ID, plotID, censusID);
    const freshAfter = await countStagedRows(connectionManager, schema, FILE_NAME, BATCH_ID, plotID, censusID);
    console.log(`[stale-batch] abandonedAfter=${abandonedAfter} freshAfter=${freshAfter}`);
    expect(abandonedAfter, 'the abandoned batch of the same file must be removed when a new batch starts').toBe(0);
    expect(freshAfter).toBe(EXPECTED_STAGED_ROW_COUNT);
  });

  it('does not re-run cleanup for later chunks of the same file once the marker is committed', async () => {
    await seedUploadSession(UPLOAD_SESSION_ID);

    const firstChunkTransactionID = await replaceThenBegin();
    await stageMeasurementChunk(connectionManager, baseParams(firstChunkTransactionID));
    await connectionManager.commitTransaction(firstChunkTransactionID);
    const markerAfterFirstChunk = await censusReplacementMarker(UPLOAD_SESSION_ID);
    expect(markerAfterFirstChunk).not.toBeNull();

    // Rows an earlier file of this upload rejected, recorded between chunks.
    await seedEarlierFileFailureRow('stage-batch-0001-fail');

    // A later chunk of the SAME file and session: same batch id, so it is not
    // even the multi-file case — it must still not clean.
    const secondChunkTransactionID = await replaceThenBegin();
    await stageMeasurementChunk(connectionManager, baseParams(secondChunkTransactionID));
    await connectionManager.commitTransaction(secondChunkTransactionID);

    console.log(`[later-chunk] marker unchanged=${(await censusReplacementMarker(UPLOAD_SESSION_ID)) === markerAfterFirstChunk}`);
    expect(await countCensusMeasurements(), 'a later chunk must not re-run the census replacement').toBe(1);
    expect(await censusReplacementMarker(UPLOAD_SESSION_ID), 'the marker is set once, not rewritten').toBe(markerAfterFirstChunk);
  });

  it('rolling back the caller-owned transaction leaves no staged rows behind', async () => {
    const transactionID = await replaceThenBegin();
    const result = await stageMeasurementChunk(connectionManager, baseParams(transactionID));
    expect(result.insertedCount).toBe(EXPECTED_STAGED_ROW_COUNT);

    await connectionManager.rollbackTransaction(transactionID);

    const counted = await countStagedRows(connectionManager, schema, FILE_NAME, BATCH_ID, plotID, censusID);
    console.log(`[rollback] staged rows after rollback=${counted}`);
    expect(counted).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Issue #507: the `file_upload` unifiedchangelog write is the ONLY durable
  // record that an upload attempt happened at all — distinct from the
  // per-row coremeasurements audit that ingestBatch writes later. A prior
  // version of stageMeasurementChunk caught this write's failure and logged
  // it, letting the staged temporarymeasurements rows commit anyway: Recent
  // Changes would then show no trace that the upload ever occurred, with no
  // way to tell from the data alone that anything was missing. This test
  // forces that INSERT to fail and proves the error now propagates far
  // enough that the caller's transaction rollback undoes the staging too,
  // instead of leaving an unlogged chunk committed.
  // -------------------------------------------------------------------------
  it('propagates a file_upload changelog write failure so the caller rolls back the whole chunk, including the just-staged rows (issue #507)', async () => {
    const originalExecuteQuery = ConnectionManager.getInstance().executeQuery.bind(connectionManager);
    const SIMULATED_CHANGELOG_FAILURE = 'Simulated unifiedchangelog file_upload write failure';
    const executeQuerySpy = vi
      .spyOn(connectionManager, 'executeQuery')
      .mockImplementation(async (query: string, params?: unknown[], transactionID?: string) => {
        if (
          typeof query === 'string' &&
          query.includes('INSERT INTO') &&
          query.includes('.unifiedchangelog') &&
          Array.isArray(params) &&
          params[0] === 'file_upload'
        ) {
          throw new Error(SIMULATED_CHANGELOG_FAILURE);
        }
        return originalExecuteQuery(query, params, transactionID);
      });

    try {
      const transactionID = await replaceThenBegin();
      await expect(stageMeasurementChunk(connectionManager, baseParams(transactionID))).rejects.toThrow(SIMULATED_CHANGELOG_FAILURE);

      // The temporarymeasurements INSERT ran earlier in the same statement
      // sequence and is still visible INSIDE this uncommitted transaction —
      // proving the failure happened downstream of staging, not before it,
      // so this test is actually exercising the propagation path and not a
      // no-op where staging never ran.
      const stagedBeforeRollback = await connectionManager.executeQuery(
        safeFormatQuery(schema, `SELECT COUNT(*) AS count FROM ??.temporarymeasurements WHERE FileID = ? AND BatchID = ?`),
        [FILE_NAME, BATCH_ID],
        transactionID
      );
      console.log(`[changelog-failure] staged rows still visible pre-rollback (inside txn)=${stagedBeforeRollback[0]?.count}`);
      expect(Number(stagedBeforeRollback[0]?.count ?? 0)).toBe(EXPECTED_STAGED_ROW_COUNT);

      // The caller (ingest-batch / the upload route) owns the transaction and
      // rolls it back on any propagated staging error.
      await connectionManager.rollbackTransaction(transactionID);

      const stagedAfterRollback = await countStagedRows(connectionManager, schema, FILE_NAME, BATCH_ID, plotID, censusID);
      console.log(`[changelog-failure] staged rows after rollback=${stagedAfterRollback}`);
      expect(stagedAfterRollback, 'the rollback must undo the staging that happened before the changelog write failed').toBe(0);

      const [changelog] = await connection.query<RowDataPacket[]>(`SELECT * FROM unifiedchangelog WHERE TableName = 'file_upload'`);
      expect(changelog, 'no file_upload changelog row may survive either — the failed write never committed').toHaveLength(0);
    } finally {
      executeQuerySpy.mockRestore();
    }
  });
});
