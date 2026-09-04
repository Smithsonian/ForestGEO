/**
 * recordInvalidRows / deleteUnresolvedRowsForBatchFamily — Integration Tests
 *
 * Exercises the shared invalid-row recording mechanism
 * (lib/uploads/record-invalid-rows.ts) against a real local MySQL instance
 * with the full production schema.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/record-invalid-rows.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

// ---------------------------------------------------------------------------
// Safety guard — setupTestDatabase DROPs/CREATEs its schema; never run remote.
// ---------------------------------------------------------------------------

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';

if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(
    `[record-invalid-rows] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops and recreates its test schema and must only run against a local test database.`
  );
}

// ---------------------------------------------------------------------------
// Shared state bridge — hoisted so the ConnectionManager mock closure can read
// the live test connection after beforeAll wires it up.
// ---------------------------------------------------------------------------

const TRANSACTION_ID_PREFIX = 'record-invalid-rows-tx-';

const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0
}));

// ConnectionManager mock — routes every DB call to the shared real MySQL
// connection so commits/rollbacks operate on actual transactions.
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
import { recordInvalidRows, recordFailedMeasurementRows, deleteUnresolvedRowsForBatchFamily, type InvalidRowContext } from '@/lib/uploads/record-invalid-rows';
import { insertIngestionFailureRows, FALLBACK_FAILURE_REASON } from '@/config/measurementerrors';
import type { FailedMeasurementsRDS } from '@/lib/db/definitions/core';

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const FILE_NAME = 'record-invalid-rows-fixture.csv';
const BATCH_ID = 'invalid-batch-0001';
const OTHER_BATCH_ID = 'invalid-batch-9999';

// ---------------------------------------------------------------------------
// Suite lifecycle
// ---------------------------------------------------------------------------

describe('recordInvalidRows / deleteUnresolvedRowsForBatchFamily — integration', () => {
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
    // Clean any rows left by previous test cases scoped to our FILE_NAME/BATCH_IDs.
    await connection.query(`DELETE FROM \`${schema}\`.coremeasurements WHERE UploadFileID = ? AND StemGUID IS NULL`, [FILE_NAME]);
    console.log('[beforeEach] cleared coremeasurements parse-reject rows for fixture file');
  });

  // -------------------------------------------------------------------------
  // Helpers to read back recorded data from the DB.
  // -------------------------------------------------------------------------

  async function fetchCoreMeasurementID(fileID: string, batchID: string, rawTreeTag: string): Promise<number | null> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID FROM \`${schema}\`.coremeasurements
       WHERE UploadFileID = ? AND UploadBatchID = ? AND RawTreeTag = ? AND StemGUID IS NULL
       LIMIT 1`,
      [fileID, batchID, rawTreeTag]
    );
    return rows.length > 0 ? rows[0].CoreMeasurementID : null;
  }

  async function fetchMeasurementErrors(measurementID: number): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT mel.MeasurementID, me.ErrorCode, me.ErrorMessage, mel.IsResolved
       FROM \`${schema}\`.measurement_error_log mel
       JOIN \`${schema}\`.measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE mel.MeasurementID = ?`,
      [measurementID]
    );
    return rows;
  }

  async function fetchRecordedRows(batchID: string): Promise<RowDataPacket[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT CensusID,
              StemGUID,
              UploadFileID,
              UploadBatchID,
              RawTreeTag,
              RawStemTag,
              RawSpCode,
              RawQuadrat,
              CAST(RawX AS CHAR) AS RawXText,
              CAST(RawY AS CHAR) AS RawYText,
              CAST(MeasuredDBH AS CHAR) AS MeasuredDBHText,
              CAST(MeasuredHOM AS CHAR) AS MeasuredHOMText,
              CAST(MeasurementDate AS CHAR) AS MeasurementDateText,
              RawCodes,
              RawComments,
              Description
       FROM \`${schema}\`.coremeasurements
       WHERE UploadFileID = ? AND UploadBatchID = ? AND StemGUID IS NULL
       ORDER BY SourceRowIndex`,
      [FILE_NAME, batchID]
    );
    return rows;
  }

  // -------------------------------------------------------------------------
  // Test 1: recordInvalidRows persists parse-reject FileRows correctly.
  // -------------------------------------------------------------------------

  it('records 2 parse-reject rows: full row + sparse row (tag+failureReason only)', async () => {
    // sourceRowIndexOffset: -3 pushes these two worker rejects into the real
    // negative SourceRowIndex namespace (-2, -1) that the async worker uses to
    // stay out of bulkingestionprocess's positive auto-increment range.
    const ctx: InvalidRowContext = { schema, plotID, censusID, fileName: FILE_NAME, batchID: BATCH_ID, sourceRowIndexOffset: -3 };

    const fullRow = {
      tag: 'T0100',
      stemtag: 'S01',
      spcode: 'ACERRU',
      quadrat: 'Q01',
      lx: '1.5',
      ly: '2.75',
      dbh: '12.345',
      hom: '1.3',
      date: '2024-05-20',
      codes: 'A',
      comments: 'test comment',
      failureReason: 'Missing required fields: quadrat'
    };

    // failureReason: null (not the fallback literal) proves the CHOKE-POINT
    // fallback in insertIngestionFailureRows applies FALLBACK_FAILURE_REASON,
    // rather than the fixture merely passing a literal string through.
    const sparseRow = {
      tag: 'T0101',
      failureReason: null
    };

    const transactionID = await connectionManager.beginTransaction();
    const count = await recordInvalidRows(connectionManager, ctx, [fullRow, sparseRow], transactionID);
    await connectionManager.commitTransaction(transactionID);

    console.log(`[test1] recordInvalidRows returned count=${count}`);
    expect(count).toBe(2);

    const recorded = await fetchRecordedRows(BATCH_ID);
    console.log(`[test1] rows from DB: ${JSON.stringify(recorded, null, 2)}`);
    expect(recorded).toHaveLength(2);

    // Envelope columns — must be correct on both rows.
    for (const row of recorded) {
      expect(row.StemGUID).toBeNull();
      expect(row.UploadFileID).toBe(FILE_NAME);
      expect(row.UploadBatchID).toBe(BATCH_ID);
      expect(row.CensusID).toBe(censusID);
    }

    // Full row — all Raw* columns and date/dbh/hom should be populated.
    const fullRecorded = recorded[0];
    console.log(
      `[test1] full row: tag=${fullRecorded.RawTreeTag} stemTag=${fullRecorded.RawStemTag} spCode=${fullRecorded.RawSpCode} ` +
        `quadrat=${fullRecorded.RawQuadrat} x=${fullRecorded.RawXText} y=${fullRecorded.RawYText} ` +
        `dbh=${fullRecorded.MeasuredDBHText} hom=${fullRecorded.MeasuredHOMText} date=${fullRecorded.MeasurementDateText} ` +
        `codes=${fullRecorded.RawCodes} comments=${fullRecorded.RawComments} description=${fullRecorded.Description}`
    );
    expect(fullRecorded.RawTreeTag).toBe('T0100');
    expect(fullRecorded.RawStemTag).toBe('S01');
    expect(fullRecorded.RawSpCode).toBe('ACERRU');
    expect(fullRecorded.RawQuadrat).toBe('Q01');
    expect(String(fullRecorded.MeasurementDateText)).toBe('2024-05-20');
    // Numeric fields: the fixture sends string values ('1.5', '2.75', etc.) which
    // toFiniteNumber parses to finite numbers before storage. MySQL returns them
    // as CAST-to-CHAR strings; compare numerically to tolerate decimal formatting.
    expect(parseFloat(fullRecorded.RawXText)).toBeCloseTo(1.5);
    expect(parseFloat(fullRecorded.RawYText)).toBeCloseTo(2.75);
    expect(parseFloat(fullRecorded.MeasuredDBHText)).toBeCloseTo(12.345);
    expect(parseFloat(fullRecorded.MeasuredHOMText)).toBeCloseTo(1.3);
    // Description round-trips the verbatim failure reason; RawComments round-trips
    // the verbatim comments. They are NOT copies of each other — this is the
    // #454 fix under test (Description used to be silently NULL, or overwritten
    // with the comments field, depending on the code path).
    expect(fullRecorded.Description).toBe('Missing required fields: quadrat');
    expect(fullRecorded.RawComments).toBe('test comment');

    // Verify the failure reason was written to measurement_error_log.
    const fullMeasurementID = await fetchCoreMeasurementID(FILE_NAME, BATCH_ID, 'T0100');
    expect(fullMeasurementID).not.toBeNull();
    const fullErrors = await fetchMeasurementErrors(fullMeasurementID!);
    console.log(`[test1] full row error_log entries: ${JSON.stringify(fullErrors)}`);
    expect(fullErrors.length).toBeGreaterThan(0);

    // Sparse row — only tag populated; null fields must be null/missing.
    const sparseRecorded = recorded[1];
    console.log(`[test1] sparse row: tag=${sparseRecorded.RawTreeTag} description=${sparseRecorded.Description} stemTag=${sparseRecorded.RawStemTag}`);
    expect(sparseRecorded.RawTreeTag).toBe('T0101');
    expect(sparseRecorded.RawStemTag).toBeNull();
    // Sparse row's failureReason is null — the choke point (normalizeFailureDescription
    // in config/measurementerrors.ts) must apply FALLBACK_FAILURE_REASON, never leave
    // Description NULL. A NULL Description here is exactly what the #454 detector query
    // (SourceRowIndex < 0 AND Description IS NULL) flags as an unrecorded reject.
    expect(sparseRecorded.Description).toBe(FALLBACK_FAILURE_REASON);
    const sparseMeasurementID = await fetchCoreMeasurementID(FILE_NAME, BATCH_ID, 'T0101');
    expect(sparseMeasurementID).not.toBeNull();
    const sparseErrors = await fetchMeasurementErrors(sparseMeasurementID!);
    console.log(`[test1] sparse row error_log entries: ${JSON.stringify(sparseErrors)}`);
    expect(sparseErrors.length).toBeGreaterThan(0);
    // An unrecognized (here: absent) reason must classify as UNCLASSIFIED_REJECT,
    // never SQL_EXCEPTION — the choke point must not guess a system-failure code
    // from prose it doesn't recognize.
    const sparseErrorCodes = sparseErrors.map(row => row.ErrorCode);
    console.log(`[test1] sparse row error codes: ${JSON.stringify(sparseErrorCodes)}`);
    expect(sparseErrorCodes).toContain('UNCLASSIFIED_REJECT');
    expect(sparseErrorCodes).not.toContain('SQL_EXCEPTION');

    // #454 detector, scoped to this fixture's UploadFileID: fresh worker-path
    // writes must never leave a negative-SourceRowIndex row with a NULL
    // Description. Never run this unscoped — other tests' seed data is out of
    // bounds for this assertion.
    const [detectorRows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM \`${schema}\`.coremeasurements
       WHERE UploadFileID = ? AND SourceRowIndex < 0 AND Description IS NULL`,
      [FILE_NAME]
    );
    console.log(`[test1] #454 detector (scoped to fixture file) n=${detectorRows[0].n}`);
    expect(Number(detectorRows[0].n)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 2: sequential-path insert — proves insertPreparedIngestionFailureRowsSequential
  // against real SQL. The bulk-metadata cases above (batchID set) never reach this
  // code path; only a falsy batchID does.
  // -------------------------------------------------------------------------

  it('insertIngestionFailureRows with batchID: null takes the sequential insert path and round-trips Description/RawComments', async () => {
    const reason = 'Unparseable date value: 31/13/2020';
    const comments = 'sequential path note';

    const transactionID = await connectionManager.beginTransaction();
    const insertedIDs = await insertIngestionFailureRows(
      connectionManager,
      schema,
      [
        {
          plotID,
          censusID,
          tag: 'T0400',
          comments,
          failureReason: reason,
          fileID: FILE_NAME,
          batchID: null,
          sourceRowIndex: 1
        }
      ],
      transactionID
    );
    await connectionManager.commitTransaction(transactionID);

    console.log(`[test2] insertIngestionFailureRows (sequential path) returned insertedIDs=${JSON.stringify(insertedIDs)}`);
    expect(insertedIDs).toHaveLength(1);

    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT Description, RawComments, UploadBatchID, StemGUID
       FROM \`${schema}\`.coremeasurements
       WHERE CoreMeasurementID = ?`,
      [insertedIDs[0]]
    );
    console.log(`[test2] sequential-path row: ${JSON.stringify(rows[0])}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].UploadBatchID).toBeNull();
    expect(rows[0].StemGUID).toBeNull();
    expect(rows[0].Description).toBe(reason);
    expect(rows[0].RawComments).toBe(comments);
  });

  // -------------------------------------------------------------------------
  // Test 3: HTTP-shape (recordFailedMeasurementRows) — proves the batchedupload
  // route's persistence boundary round-trips the actual wire shape, including
  // the plural `failureReasons` field name.
  // -------------------------------------------------------------------------

  it('recordFailedMeasurementRows persists the HTTP wire shape { comments, failureReasons } verbatim', async () => {
    const reason = 'Missing required fields: date';
    const comments = 'route note';
    const httpBatchID = `${BATCH_ID}__http`;

    const transactionID = await connectionManager.beginTransaction();
    const count = await recordFailedMeasurementRows(
      connectionManager,
      schema,
      [{ tag: 'T0500', comments, failureReasons: reason } as FailedMeasurementsRDS],
      FILE_NAME,
      httpBatchID,
      plotID,
      censusID,
      transactionID
    );
    await connectionManager.commitTransaction(transactionID);

    console.log(`[test3] recordFailedMeasurementRows returned count=${count}`);
    expect(count).toBe(1);

    const recorded = await fetchRecordedRows(httpBatchID);
    console.log(`[test3] HTTP-shape row: ${JSON.stringify(recorded)}`);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].RawTreeTag).toBe('T0500');
    expect(recorded[0].Description).toBe(reason);
    expect(recorded[0].RawComments).toBe(comments);
  });

  // -------------------------------------------------------------------------
  // Test 4: deleteUnresolvedRowsForBatchFamily scoped delete behavior.
  // -------------------------------------------------------------------------

  it('deleteUnresolvedRowsForBatchFamily: returns count, clears unresolved rows, does not delete resolved or different-batch rows', async () => {
    // Pre-condition: record 2 unresolved rows under BATCH_ID.
    const ctx: InvalidRowContext = { schema, plotID, censusID, fileName: FILE_NAME, batchID: BATCH_ID };
    const txInsert = await connectionManager.beginTransaction();
    await recordInvalidRows(
      connectionManager,
      ctx,
      [
        { tag: 'T0200', failureReason: 'Missing field' },
        { tag: 'T0201', failureReason: 'Bad coordinate' }
      ],
      txInsert
    );
    await connectionManager.commitTransaction(txInsert);

    console.log('[test4] seeded 2 unresolved rows under BATCH_ID');

    // Also insert a "resolved" control row under BATCH_ID with non-NULL StemGUID.
    // We need a real StemGUID — insert a stem that satisfies the FK, then insert
    // the coremeasurement referencing it.
    //
    // trees table columns: TreeTag, SpeciesID, CensusID, IsActive.
    // stems table columns: TreeID, StemTag, QuadratID, CensusID, LocalX, LocalY, IsActive.
    const [treeInsertResult]: any = await connection.query(
      `INSERT INTO \`${schema}\`.trees (TreeTag, SpeciesID, CensusID, IsActive)
       VALUES ('CTRL-TREE-200', NULL, ?, 1)`,
      [censusID]
    );
    const treeID: number = treeInsertResult.insertId;
    console.log(`[test4] inserted control tree treeID=${treeID}`);

    const [stemInsertResult]: any = await connection.query(
      `INSERT INTO \`${schema}\`.stems (TreeID, StemTag, LocalX, LocalY, CensusID, IsActive)
       VALUES (?, 'CS200', 0.0, 0.0, ?, 1)`,
      [treeID, censusID]
    );
    const stemGUID: number = stemInsertResult.insertId;
    console.log(`[test4] inserted control stem stemGUID=${stemGUID}`);

    // Insert a resolved coremeasurement (StemGUID IS NOT NULL) under the same
    // BATCH_ID — this row must survive the delete.
    await connection.query(
      `INSERT INTO \`${schema}\`.coremeasurements
         (CensusID, StemGUID, MeasurementDate, MeasuredDBH, MeasuredHOM, UploadFileID, UploadBatchID, IsActive)
       VALUES (?, ?, '2024-01-01', 5.0, 1.3, ?, ?, 1)`,
      [censusID, stemGUID, FILE_NAME, BATCH_ID]
    );
    console.log('[test4] inserted 1 resolved control row (StemGUID IS NOT NULL)');

    // Also record 1 unresolved row under a DIFFERENT batch — must survive the delete.
    const txOther = await connectionManager.beginTransaction();
    await recordInvalidRows(connectionManager, { ...ctx, batchID: OTHER_BATCH_ID }, [{ tag: 'T0299', failureReason: 'Other batch reject' }], txOther);
    await connectionManager.commitTransaction(txOther);
    console.log('[test4] seeded 1 unresolved row under OTHER_BATCH_ID');

    // And 1 unresolved row under a SUB-BATCH of BATCH_ID — this one MUST be
    // deleted. An interrupted split leaves rows under `__subNNN`; a delete that
    // only matched the unsuffixed ID would strand them and the retry would then
    // show the same source row twice.
    const SUB_BATCH_ID = `${BATCH_ID}__sub001`;
    const txSub = await connectionManager.beginTransaction();
    await recordInvalidRows(connectionManager, { ...ctx, batchID: SUB_BATCH_ID }, [{ tag: 'T0298', failureReason: 'Sub-batch reject' }], txSub);
    await connectionManager.commitTransaction(txSub);
    console.log(`[test4] seeded 1 unresolved row under ${SUB_BATCH_ID}`);

    // Run the delete.
    const txDelete = await connectionManager.beginTransaction();
    const deletedCount = await deleteUnresolvedRowsForBatchFamily(connectionManager, schema, FILE_NAME, BATCH_ID, censusID, txDelete);
    await connectionManager.commitTransaction(txDelete);

    console.log(`[test4] deleteUnresolvedRowsForBatchFamily returned deletedCount=${deletedCount}`);
    // 2 under the original ID + 1 under its sub-batch.
    expect(deletedCount).toBe(3);

    const remainingSubBatch = await fetchRecordedRows(SUB_BATCH_ID);
    console.log(`[test4] remaining rows under ${SUB_BATCH_ID} after delete: ${remainingSubBatch.length}`);
    expect(remainingSubBatch).toHaveLength(0);

    // Verify the unresolved BATCH_ID rows are gone.
    const remainingBatch = await fetchRecordedRows(BATCH_ID);
    console.log(`[test4] remaining rows under BATCH_ID after delete: ${remainingBatch.length}`);
    expect(remainingBatch).toHaveLength(0);

    // Verify the resolved row (StemGUID IS NOT NULL) under BATCH_ID survived.
    const [resolvedRows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID FROM \`${schema}\`.coremeasurements
       WHERE UploadFileID = ? AND UploadBatchID = ? AND StemGUID IS NOT NULL`,
      [FILE_NAME, BATCH_ID]
    );
    console.log(`[test4] resolved rows under BATCH_ID after delete: ${resolvedRows.length}`);
    expect(resolvedRows).toHaveLength(1);

    // Verify the OTHER_BATCH_ID row survived.
    const remainingOther = await fetchRecordedRows(OTHER_BATCH_ID);
    console.log(`[test4] remaining rows under OTHER_BATCH_ID after delete: ${remainingOther.length}`);
    expect(remainingOther).toHaveLength(1);
    expect(remainingOther[0].RawTreeTag).toBe('T0299');
  });

  // -------------------------------------------------------------------------
  // Test 5: Retry simulation — re-record after delete produces clean state.
  // -------------------------------------------------------------------------

  it('retry simulation: record → delete → re-record yields exactly the new rows', async () => {
    const ctx: InvalidRowContext = { schema, plotID, censusID, fileName: FILE_NAME, batchID: BATCH_ID };

    // First attempt: record 2 rows (simulating a crashed job).
    const txFirst = await connectionManager.beginTransaction();
    const firstCount = await recordInvalidRows(
      connectionManager,
      ctx,
      [
        { tag: 'T0300', failureReason: 'First attempt error A' },
        { tag: 'T0301', failureReason: 'First attempt error B' }
      ],
      txFirst
    );
    await connectionManager.commitTransaction(txFirst);
    console.log(`[test5] first attempt recorded count=${firstCount}`);
    expect(firstCount).toBe(2);

    const afterFirst = await fetchRecordedRows(BATCH_ID);
    console.log(`[test5] rows after first attempt: ${afterFirst.length}`);
    expect(afterFirst).toHaveLength(2);

    // Retry cleanup: delete the first-attempt rows.
    const txCleanup = await connectionManager.beginTransaction();
    const cleanedCount = await deleteUnresolvedRowsForBatchFamily(connectionManager, schema, FILE_NAME, BATCH_ID, censusID, txCleanup);
    await connectionManager.commitTransaction(txCleanup);
    console.log(`[test5] cleanup deleted count=${cleanedCount}`);
    expect(cleanedCount).toBe(2);

    const afterCleanup = await fetchRecordedRows(BATCH_ID);
    console.log(`[test5] rows after cleanup: ${afterCleanup.length}`);
    expect(afterCleanup).toHaveLength(0);

    // Second attempt (retry): record 1 row (simulating fewer failures on retry).
    const txRetry = await connectionManager.beginTransaction();
    const retryCount = await recordInvalidRows(connectionManager, ctx, [{ tag: 'T0302', failureReason: 'Retry attempt error C' }], txRetry);
    await connectionManager.commitTransaction(txRetry);
    console.log(`[test5] retry recorded count=${retryCount}`);
    expect(retryCount).toBe(1);

    const afterRetry = await fetchRecordedRows(BATCH_ID);
    console.log(`[test5] rows after retry: ${afterRetry.length} — ${JSON.stringify(afterRetry)}`);
    expect(afterRetry).toHaveLength(1);
    expect(afterRetry[0].RawTreeTag).toBe('T0302');
    // Description round-trips the verbatim failure reason (no comments on this row).
    expect(afterRetry[0].Description).toBe('Retry attempt error C');
    expect(afterRetry[0].RawComments).toBeNull();
    expect(afterRetry[0].StemGUID).toBeNull();
    expect(afterRetry[0].UploadBatchID).toBe(BATCH_ID);
    expect(afterRetry[0].CensusID).toBe(censusID);
    // Verify the failure reason was wired up to measurement_error_log.
    const retryMeasurementID = await fetchCoreMeasurementID(FILE_NAME, BATCH_ID, 'T0302');
    expect(retryMeasurementID).not.toBeNull();
    const retryErrors = await fetchMeasurementErrors(retryMeasurementID!);
    console.log(`[test5] retry row error_log entries: ${JSON.stringify(retryErrors)}`);
    expect(retryErrors.length).toBeGreaterThan(0);
  });
});
