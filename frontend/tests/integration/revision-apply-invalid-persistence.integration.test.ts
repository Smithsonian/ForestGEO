/**
 * Revision Apply — Invalid-Only / Duplicate-Only Persistence (#505, real routes)
 *
 * Drives the REAL `POST /api/revisionupload` (match) and
 * `POST /api/revisionupload/apply` handlers end to end against a real local
 * MySQL database — not a hand-rolled SQL mirror of their logic. This is the
 * gap `revision-upload.integration.test.ts` deliberately leaves open (its
 * own header says it tests reimplemented SQL "directly against a local
 * MySQL database... does NOT go through the HTTP layer"): a bug in the
 * actual route (wrong column, wrong transaction boundary, a validation
 * check reordered ahead of another) would never surface there even though
 * every hand-mirrored assertion still passes.
 *
 * Covers the P1-C fix: a revision file consisting ENTIRELY of rejected rows,
 * or a matched row whose only actionable content is duplicate cleanup (no
 * field changes), must still be Apply-able and must leave a persisted,
 * queryable trace — not silently vanish once the HTTP response is discarded.
 *
 * Also exercises the full uploadAttemptID / invalidRowsIntegrityHash
 * handshake (see shared/invalidrowintegrity.ts) by sending apply exactly
 * what match returned, unchanged — the same path a conforming client takes.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { cleanupTestMeasurements, createAdditionalCensus, setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';
import type { RevisionUploadResponse } from '@/config/revisionuploadtypes';
import { HTTPResponses } from '@/config/macros';

// computeInvalidRowsIntegrityHash (shared/invalidrowintegrity.ts) signs with
// AUTH_SECRET and fails closed without it. The unit suite gets this for free
// from setup.ts -> tests/mocks/auth-mocks.ts, but vitest.integration.config.mts's
// setupFiles do not set it, so every match/apply call in this suite would throw
// without an explicit, deterministic value here. The exact value is irrelevant —
// only that it stays constant across a test's match+apply call pair.
process.env.AUTH_SECRET ??= 'test_secret';

// ---------------------------------------------------------------------------
// Named constants — no magic numbers or strings
// ---------------------------------------------------------------------------

const AUTH_USER_EMAIL = 'invalid-persistence-test@example.com';
const TRANSACTION_ID_PREFIX = 'invpersist-tx-';

const INVALID_ROW_TREE_TAG = 'INVPERSIST01';
// stems.StemTag / coremeasurements.RawStemTag are both varchar(10) (tablestructures.sql) —
// must stay at or under that length or the insert this test depends on truncates/warns.
const INVALID_ROW_STEM_TAG = 'INVPSTEM01';
const INVALID_ROW_DBH = '12.3';

const DUPLICATE_ONLY_TREE_TAG = 'DUPONLY01';
const DUPLICATE_ONLY_STEM_TAG = 'DUPONLYS1';
const DUPLICATE_ONLY_DBH = 9.4;
const DUPLICATE_ONLY_HOM = 1.3;
const DUPLICATE_ONLY_DATE_SURVIVOR = '2024-04-01';
const DUPLICATE_ONLY_DATE_SIBLING = '2024-03-01';

const REVISION_UPLOAD_FILE_ID_VALUE = 'revision-upload';

// ---------------------------------------------------------------------------
// Shared state bridge — same pattern as editplan-integrity.integration.test.ts
// ---------------------------------------------------------------------------
const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0
}));

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
    withTransaction: async <T>(fn: (tx: { query: <R = unknown>(sql: string, params?: unknown[]) => Promise<R>; id: string }) => Promise<T>) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      await sharedState.connection.beginTransaction();
      sharedState.transactionCounter += 1;
      const txID = `${TRANSACTION_ID_PREFIX}${sharedState.transactionCounter}`;
      sharedState.activeTransactionID = txID;
      const tx = {
        query: async <R = unknown>(sql: string, params?: unknown[]): Promise<R> => {
          const [rows] = await sharedState.connection!.query(sql, (params as unknown[]) ?? []);
          return rows as R;
        },
        id: txID
      };
      try {
        const result = await fn(tx);
        await sharedState.connection.commit();
        sharedState.activeTransactionID = null;
        return result;
      } catch (err) {
        await sharedState.connection.rollback();
        sharedState.activeTransactionID = null;
        throw err;
      }
    },
    acquireApplicationLock: async (lockName: string, _transactionID: string, timeoutMs: number) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      const timeoutSeconds = Math.ceil(timeoutMs / 1000);
      const [rows] = (await sharedState.connection.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, timeoutSeconds])) as unknown as [
        RowDataPacket[],
        unknown
      ];
      return rows?.[0]?.acquired === 1;
    },
    releaseApplicationLock: async (lockName: string) => {
      if (!sharedState.connection) return;
      await sharedState.connection.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined
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

// ensureUploadSessionsTable opens its own pool connection outside the mocked
// ConnectionManager — stub it out the same way editplan-integrity.integration
// does; the table already exists from loadSchema.
vi.mock('@/config/uploadsessiontracker', async () => {
  const actual = await vi.importActual<typeof import('@/config/uploadsessiontracker')>('@/config/uploadsessiontracker');
  return {
    ...actual,
    ensureUploadSessionsTable: async (_schema: string) => {
      /* no-op: upload_sessions already created by loadSchema */
    }
  };
});

// Auth freshness re-check: always-fresh (no role/access drift exercised here).
vi.mock('@/config/editplan/authorization', async () => {
  const actual = await vi.importActual<typeof import('@/config/editplan/authorization')>('@/config/editplan/authorization');
  return {
    ...actual,
    createFreshAuthorizationCheck: () => async () => {
      /* always-fresh */
    }
  };
});

// Route handlers — imported after vi.mock so the mocked modules are wired in.
import { POST as matchPOST } from '@/app/api/revisionupload/route';
import { POST as applyPOST } from '@/app/api/revisionupload/apply/route';
// Same mocked singleton the routes above call through — used by the late-failure
// case to install a scoped spy on one specific later query.
import ConnectionManager from '@/lib/db/connectionmanager';

function buildMatchRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/revisionupload', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as any;
}

function buildApplyRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/revisionupload/apply', {
    method: 'POST',
    body: JSON.stringify(body)
  }) as any;
}

describe('revision apply — invalid-only / duplicate-only persistence (integration, real routes)', () => {
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
    sharedState.activeTransactionID = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    sharedState.activeTransactionID = null;
    await connection.query('ROLLBACK');
    await connection.query('SELECT RELEASE_ALL_LOCKS()');
    await cleanupTestMeasurements(connection, testData);
  });

  // ---------------------------------------------------------------------
  // Shared fixture helpers for the cases below -- plain inserts against the
  // real local MySQL database (no production SQL/classification reused),
  // mirroring the inline pattern the duplicate-only test above already uses.
  // ---------------------------------------------------------------------

  async function getDefaultSpeciesID(): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species LIMIT 1');
    return rows[0].SpeciesID as number;
  }

  async function getDefaultQuadratID(plotID: number): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE PlotID = ? LIMIT 1', [plotID]);
    return rows[0].QuadratID as number;
  }

  async function insertActiveStemMeasurement(options: {
    censusID: number;
    quadratID: number;
    speciesID: number;
    treeTag: string;
    stemTag: string;
    dbh: number;
    hom: number;
    date: string;
  }): Promise<{ coreMeasurementID: number; stemGUID: number }> {
    const [treeRes] = await connection.query<any>('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', [
      options.treeTag,
      options.speciesID,
      options.censusID
    ]);
    const treeID = treeRes.insertId;

    const [stemRes] = await connection.query<any>(
      'INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, 1.0, 1.0, 1)',
      [treeID, options.quadratID, options.censusID, options.stemTag]
    );
    const stemGUID = stemRes.insertId;

    const [cmRes] = await connection.query<any>(
      `INSERT INTO \`${config.database}\`.coremeasurements
         (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, RawTreeTag, RawStemTag, IsValidated, IsActive)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [stemGUID, options.censusID, options.dbh, options.hom, options.date, options.treeTag, options.stemTag]
    );

    return { coreMeasurementID: cmRes.insertId, stemGUID };
  }

  async function runInvalidOnlyAttempt(
    plotID: number,
    censusID: number,
    treeTag: string,
    stemTag: string,
    previousUploadAttemptID?: string
  ): Promise<RevisionUploadResponse> {
    const matchRes = await matchPOST(
      buildMatchRequest({
        rows: [{ tag: treeTag, stemtag: stemTag, dbh: '10.0' }],
        plotID,
        censusID,
        schema: config.database,
        ...(previousUploadAttemptID ? { previousUploadAttemptID } : {})
      })
    );
    expect(matchRes.status, `match route must succeed; got ${matchRes.status}`).toBe(HTTPResponses.OK);
    const matchBody = (await matchRes.json()) as RevisionUploadResponse;
    expect(matchBody.invalidRows, `row "${treeTag}/${stemTag}" must classify invalid`).toHaveLength(1);

    const applyRes = await applyPOST(
      buildApplyRequest({
        matchedRows: [],
        newRows: [],
        invalidRows: matchBody.invalidRows,
        confirmNewRows: false,
        duplicateMeasurementIDsToDelete: [],
        schema: config.database,
        plotID,
        censusID,
        bulkPlanHash: matchBody.bulkPlan.planHash,
        uploadAttemptID: matchBody.uploadAttemptID,
        invalidRowsIntegrityHash: matchBody.invalidRowsIntegrityHash
      })
    );
    expect(applyRes.status, `invalid-only apply must succeed; got ${applyRes.status}`).toBe(HTTPResponses.OK);

    return matchBody;
  }

  // =========================================================================
  // Invalid-only upload: entire file is rejected rows
  // =========================================================================

  it('persists an invalid-only upload as a StemGUID=NULL failed measurement with a linked error-log entry', async () => {
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;

    // tag+stemtag present (satisfies the header requirement) but every
    // required new-row insert field (spcode/quadrat/lx/ly/date) is missing,
    // and no existing stem matches this tag+stemtag — the match route must
    // classify this as invalid, not matched or new.
    const matchRes = await matchPOST(
      buildMatchRequest({
        rows: [
          {
            tag: INVALID_ROW_TREE_TAG,
            stemtag: INVALID_ROW_STEM_TAG,
            dbh: INVALID_ROW_DBH
          }
        ],
        plotID,
        censusID,
        schema: config.database
      })
    );

    expect(matchRes.status, `match route must succeed; got ${matchRes.status}`).toBe(HTTPResponses.OK);
    const matchBody = (await matchRes.json()) as RevisionUploadResponse;

    expect(matchBody.matchedRows, 'row has no DB counterpart — must not be matched').toHaveLength(0);
    expect(matchBody.newRows, 'row is missing required insert fields — must not be classified as new').toHaveLength(0);
    expect(matchBody.invalidRows, 'row must be classified invalid').toHaveLength(1);
    expect(matchBody.invalidRows[0].csvIndex).toBe(0);
    expect(matchBody.uploadAttemptID, 'match route must mint an uploadAttemptID').toBeTruthy();
    expect(matchBody.invalidRowsIntegrityHash, 'match route must compute invalidRowsIntegrityHash').toBeTruthy();

    // Apply echoes match's output unchanged, exactly as a conforming client does.
    const applyRes = await applyPOST(
      buildApplyRequest({
        matchedRows: [],
        newRows: [],
        invalidRows: matchBody.invalidRows,
        confirmNewRows: false,
        duplicateMeasurementIDsToDelete: [],
        schema: config.database,
        plotID,
        censusID,
        bulkPlanHash: matchBody.bulkPlan.planHash,
        uploadAttemptID: matchBody.uploadAttemptID,
        invalidRowsIntegrityHash: matchBody.invalidRowsIntegrityHash
      })
    );

    const applyBodyText = await applyRes.text();
    expect(applyRes.status, `invalid-only apply must succeed (200); got ${applyRes.status}: ${applyBodyText}`).toBe(HTTPResponses.OK);
    const applyBody = JSON.parse(applyBodyText) as {
      updatedCount: number;
      insertedCount: number;
      deletedDuplicateCount: number;
      skippedCount: number;
      failedRowCount: number;
    };

    expect(applyBody.failedRowCount, 'the one rejected row must be reported as a persisted failure').toBe(1);
    expect(applyBody.updatedCount).toBe(0);
    expect(applyBody.insertedCount).toBe(0);
    expect(applyBody.deletedDuplicateCount).toBe(0);

    // The actual persisted trace: a StemGUID=NULL coremeasurements row this
    // upload attempt owns, carrying the original raw CSV content.
    const [failureRows] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM \`${config.database}\`.coremeasurements
       WHERE UploadFileID = ? AND SourceRowIndex = 0 AND StemGUID IS NULL`,
      [REVISION_UPLOAD_FILE_ID_VALUE]
    );
    expect(failureRows, 'apply must leave exactly one StemGUID=NULL audit row for the rejected source row').toHaveLength(1);
    const failureRow = failureRows[0];
    expect(failureRow.RawTreeTag).toBe(INVALID_ROW_TREE_TAG);
    expect(failureRow.RawStemTag).toBe(INVALID_ROW_STEM_TAG);
    expect(parseFloat(failureRow.MeasuredDBH)).toBeCloseTo(parseFloat(INVALID_ROW_DBH));
    expect(failureRow.CensusID).toBe(censusID);

    // The error catalog link that makes this row discoverable/actionable,
    // not just present — mirrors the ingestion-error pipeline's shape.
    const [errorLogRows] = await connection.query<RowDataPacket[]>(
      `SELECT mel.IsResolved, me.ErrorSource
       FROM \`${config.database}\`.measurement_error_log mel
       JOIN \`${config.database}\`.measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE mel.MeasurementID = ?`,
      [failureRow.CoreMeasurementID]
    );
    expect(errorLogRows.length, 'the rejected row must have at least one linked, unresolved error').toBeGreaterThan(0);
    for (const row of errorLogRows) {
      expect(row.ErrorSource).toBe('ingestion');
      // IsResolved is a MySQL BIT/TINYINT(1); both surface as falsy-zero here.
      expect(Number(row.IsResolved)).toBe(0);
    }
  });

  // =========================================================================
  // Duplicate-only matched row: no field changes, only duplicate cleanup
  // =========================================================================

  it('applies duplicate-only cleanup (unchanged fields) and actually deletes the sibling rows via the real route', async () => {
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;

    const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species LIMIT 1');
    const speciesID = speciesRows[0].SpeciesID as number;
    const [quadratRows] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE PlotID = ? LIMIT 1', [plotID]);
    const quadratID = quadratRows[0].QuadratID as number;

    const [treeRes] = await connection.query<any>('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', [
      DUPLICATE_ONLY_TREE_TAG,
      speciesID,
      censusID
    ]);
    const treeID = treeRes.insertId;

    const [stemRes] = await connection.query<any>(
      'INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, 1.0, 1.0, 1)',
      [treeID, quadratID, censusID, DUPLICATE_ONLY_STEM_TAG]
    );
    const stemGUID = stemRes.insertId;

    async function insertSiblingMeasurement(date: string): Promise<number> {
      const [res] = await connection.query<any>(
        `INSERT INTO \`${config.database}\`.coremeasurements
           (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, RawTreeTag, RawStemTag, IsValidated, IsActive)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
        [stemGUID, censusID, DUPLICATE_ONLY_DBH, DUPLICATE_ONLY_HOM, date, DUPLICATE_ONLY_TREE_TAG, DUPLICATE_ONLY_STEM_TAG]
      );
      return res.insertId;
    }

    // Insert the sibling FIRST so the survivor (inserted second) gets the higher
    // auto-increment CoreMeasurementID — classifyFileRows picks the
    // highest-CoreMeasurementID row among resolvable duplicates as the survivor
    // (matchdiff.ts), and the submitted CSV's `date` below must match whichever
    // row that selection actually lands on, or computeDiff surfaces a spurious
    // `date` change and the "zero field changes" assertion below fails.
    const siblingID = await insertSiblingMeasurement(DUPLICATE_ONLY_DATE_SIBLING);
    const survivorID = await insertSiblingMeasurement(DUPLICATE_ONLY_DATE_SURVIVOR);

    const matchRes = await matchPOST(
      buildMatchRequest({
        rows: [
          {
            tag: DUPLICATE_ONLY_TREE_TAG,
            stemtag: DUPLICATE_ONLY_STEM_TAG,
            dbh: String(DUPLICATE_ONLY_DBH),
            hom: String(DUPLICATE_ONLY_HOM),
            date: DUPLICATE_ONLY_DATE_SURVIVOR
          }
        ],
        plotID,
        censusID,
        schema: config.database
      })
    );

    expect(matchRes.status, `match route must succeed; got ${matchRes.status}`).toBe(HTTPResponses.OK);
    const matchBody = (await matchRes.json()) as RevisionUploadResponse;

    expect(matchBody.matchedRows, 'two identical-stem siblings must collapse into one matched row').toHaveLength(1);
    const survivorRow = matchBody.matchedRows[0];
    expect(survivorRow.coreMeasurementID, 'highest CoreMeasurementID must be chosen as survivor').toBe(siblingID > survivorID ? siblingID : survivorID);
    expect(Object.keys(survivorRow.changes), 'submitted CSV values match the survivor row exactly — no field changes').toHaveLength(0);
    expect(survivorRow.duplicateMeasurementIDsToDelete, 'the non-survivor sibling must be queued for deletion').toHaveLength(1);

    const applyRes = await applyPOST(
      buildApplyRequest({
        matchedRows: [
          {
            coreMeasurementID: survivorRow.coreMeasurementID,
            csvRow: survivorRow.csvRow,
            duplicateMeasurementIDsToDelete: survivorRow.duplicateMeasurementIDsToDelete ?? []
          }
        ],
        newRows: [],
        invalidRows: [],
        confirmNewRows: false,
        duplicateMeasurementIDsToDelete: survivorRow.duplicateMeasurementIDsToDelete!.map(id => ({
          coreMeasurementID: id,
          survivorCoreMeasurementID: survivorRow.coreMeasurementID
        })),
        schema: config.database,
        plotID,
        censusID,
        bulkPlanHash: matchBody.bulkPlan.planHash,
        uploadAttemptID: matchBody.uploadAttemptID,
        invalidRowsIntegrityHash: matchBody.invalidRowsIntegrityHash
      })
    );

    const applyBodyText = await applyRes.text();
    expect(applyRes.status, `duplicate-only apply must succeed (200); got ${applyRes.status}: ${applyBodyText}`).toBe(HTTPResponses.OK);
    const applyBody = JSON.parse(applyBodyText) as { updatedCount: number; deletedDuplicateCount: number; skippedCount: number };

    expect(applyBody.deletedDuplicateCount, 'the one queued sibling must actually be deleted').toBe(1);
    // No field values changed, so the survivor update itself is a no-op —
    // this is the P1-C case: duplicate-only content must still count as
    // actionable (enforced by the review UI's canApply gate) even though
    // updatedCount stays 0 here.
    expect(applyBody.updatedCount).toBe(0);

    const [survivorAfter] = await connection.query<RowDataPacket[]>(
      `SELECT IsActive FROM \`${config.database}\`.coremeasurements WHERE CoreMeasurementID = ?`,
      [survivorRow.coreMeasurementID]
    );
    expect(survivorAfter, 'survivor row must still exist').toHaveLength(1);

    const deletedID = survivorRow.duplicateMeasurementIDsToDelete![0];
    const [deletedRow] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID, IsActive FROM \`${config.database}\`.coremeasurements WHERE CoreMeasurementID = ?`,
      [deletedID]
    );
    if (deletedRow.length > 0) {
      // Soft-delete convention: row remains but is deactivated.
      expect(Number(deletedRow[0].IsActive), 'duplicate sibling must be deactivated if not hard-deleted').toBe(0);
    }
  });

  // =========================================================================
  // Tamper rejection: a forged/stale invalidRowsIntegrityHash must 409 and
  // write nothing, through the REAL routes (not a mocked recompute).
  // =========================================================================

  it("returns 409 and persists nothing when a rejected row's reason is changed after match but the original invalidRowsIntegrityHash is resubmitted", async () => {
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const tamperTreeTag = 'INVTAMPER1';
    const tamperStemTag = 'INVTAMPS1';

    const matchRes = await matchPOST(
      buildMatchRequest({
        rows: [{ tag: tamperTreeTag, stemtag: tamperStemTag, dbh: '15.0' }],
        plotID,
        censusID,
        schema: config.database
      })
    );
    expect(matchRes.status).toBe(HTTPResponses.OK);
    const matchBody = (await matchRes.json()) as RevisionUploadResponse;
    expect(matchBody.invalidRows).toHaveLength(1);

    // The client alters the rejected row's reason text after review (e.g. to
    // hide/relabel why it was rejected) but replays the ORIGINAL hash the
    // review screen returned -- a plain unkeyed digest of the same inputs
    // would be trivially recomputable by the same client and could not
    // catch this; the server-side HMAC (shared/invalidrowintegrity.ts) must.
    const tamperedInvalidRows = [{ ...matchBody.invalidRows[0], reason: 'tampered reason: not actually invalid' }];

    const applyRes = await applyPOST(
      buildApplyRequest({
        matchedRows: [],
        newRows: [],
        invalidRows: tamperedInvalidRows,
        confirmNewRows: false,
        duplicateMeasurementIDsToDelete: [],
        schema: config.database,
        plotID,
        censusID,
        bulkPlanHash: matchBody.bulkPlan.planHash,
        uploadAttemptID: matchBody.uploadAttemptID,
        invalidRowsIntegrityHash: matchBody.invalidRowsIntegrityHash
      })
    );

    expect(applyRes.status, 'a tampered rejected-row payload replayed against the original hash must be rejected').toBe(HTTPResponses.CONFLICT);

    const [persistedRows] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM \`${config.database}\`.coremeasurements WHERE RawTreeTag = ? AND StemGUID IS NULL`,
      [tamperTreeTag]
    );
    expect(persistedRows, 'a rejected 409 must leave no trace in coremeasurements').toHaveLength(0);
  });

  // =========================================================================
  // Precision-equivalent duplicate collapse through the real match route
  // (matchdiff.ts compareSourceRows) -- not a DUPLICATE_ENTRY rejection.
  // =========================================================================

  it('collapses a same-key row pair differing only beyond stored DECIMAL(12,6) precision into one survivor, via the real match route', async () => {
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const precisionTreeTag = 'INVPRECIS1';
    const precisionStemTag = 'INVPRECS1';

    // '12.1234561' and '12.1234564' are different as parsed doubles, and
    // round to the SAME DECIMAL(12,6) value ('12.123456') -- a precision-only
    // difference, not a genuine second measurement.
    const matchRes = await matchPOST(
      buildMatchRequest({
        rows: [
          { tag: precisionTreeTag, stemtag: precisionStemTag, dbh: '12.1234561' },
          { tag: precisionTreeTag, stemtag: precisionStemTag, dbh: '12.1234564' }
        ],
        plotID,
        censusID,
        schema: config.database
      })
    );

    expect(matchRes.status).toBe(HTTPResponses.OK);
    const matchBody = (await matchRes.json()) as RevisionUploadResponse;

    expect(matchBody.collapsedRows, 'the second row must collapse into the first, not be rejected as a duplicate').toHaveLength(1);
    expect(matchBody.collapsedRows[0].csvIndex).toBe(1);
    expect(matchBody.collapsedRows[0].collapsedIntoCsvIndex).toBe(0);
    expect(
      matchBody.invalidRows.some(row => row.csvIndex === 1),
      'the collapsed row must not also appear as invalid'
    ).toBe(false);
  });

  // =========================================================================
  // 10 valid rows + 1 exact duplicate, via the real routes: every source
  // csvIndex (0-10) must be accounted for as either a success or a
  // persisted DUPLICATE_ENTRY failure -- none silently dropped.
  // =========================================================================

  it('applies 10 valid matched-row updates and persists the 11th (an exact duplicate of row 0) as a DUPLICATE_ENTRY failure, accounting for every source csvIndex', async () => {
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const VALID_ROW_COUNT = 10;
    const speciesID = await getDefaultSpeciesID();
    const quadratID = await getDefaultQuadratID(plotID);

    const seeded: Array<{ treeTag: string; stemTag: string; coreMeasurementID: number; originalDBH: number; newDBH: number }> = [];
    for (let index = 0; index < VALID_ROW_COUNT; index++) {
      const treeTag = `BATCH${index}TAG`;
      const stemTag = `BS${index}`;
      const originalDBH = 10 + index;
      const { coreMeasurementID } = await insertActiveStemMeasurement({
        censusID,
        quadratID,
        speciesID,
        treeTag,
        stemTag,
        dbh: originalDBH,
        hom: 1.3,
        date: '2024-01-01'
      });
      seeded.push({ treeTag, stemTag, coreMeasurementID, originalDBH, newDBH: originalDBH + 0.5 });
    }

    const csvRows = seeded.map(row => ({ tag: row.treeTag, stemtag: row.stemTag, dbh: String(row.newDBH), date: '2024-01-01' }));
    // csvIndex 10: an EXACT duplicate of row 0 (same tag/stemtag/dbh/date) --
    // buildResolutionCandidates (matchdiff.ts, via route.ts) rejects the
    // later occurrence as a genuine duplicate, never a precision collapse.
    csvRows.push({ ...csvRows[0] });

    const matchRes = await matchPOST(buildMatchRequest({ rows: csvRows, plotID, censusID, schema: config.database }));
    expect(matchRes.status, `match route must succeed; got ${matchRes.status}`).toBe(HTTPResponses.OK);
    const matchBody = (await matchRes.json()) as RevisionUploadResponse;

    expect(matchBody.matchedRows, 'all 10 distinct rows must match their seeded measurement').toHaveLength(VALID_ROW_COUNT);
    expect(matchBody.invalidRows, 'the exact duplicate (csvIndex 10) must be the only invalid row').toHaveLength(1);
    expect(matchBody.invalidRows[0].csvIndex).toBe(VALID_ROW_COUNT);
    expect(matchBody.invalidRows[0].reason).toContain('duplicate');
    // Every source row (0-10) accounted for exactly once.
    expect(matchBody.matchedRows.length + matchBody.invalidRows.length).toBe(VALID_ROW_COUNT + 1);

    const applyRes = await applyPOST(
      buildApplyRequest({
        matchedRows: matchBody.matchedRows.map(row => ({ coreMeasurementID: row.coreMeasurementID, csvRow: row.csvRow, duplicateMeasurementIDsToDelete: [] })),
        newRows: [],
        invalidRows: matchBody.invalidRows,
        confirmNewRows: false,
        duplicateMeasurementIDsToDelete: [],
        schema: config.database,
        plotID,
        censusID,
        bulkPlanHash: matchBody.bulkPlan.planHash,
        uploadAttemptID: matchBody.uploadAttemptID,
        invalidRowsIntegrityHash: matchBody.invalidRowsIntegrityHash
      })
    );
    const applyBodyText = await applyRes.text();
    expect(applyRes.status, `apply must succeed (200); got ${applyRes.status}: ${applyBodyText}`).toBe(HTTPResponses.OK);
    const applyBody = JSON.parse(applyBodyText) as { updatedCount: number; failedRowCount: number };

    expect(applyBody.updatedCount, 'all 10 valid rows must be updated').toBe(VALID_ROW_COUNT);
    expect(applyBody.failedRowCount, 'the one duplicate must be persisted as a failure').toBe(1);

    for (const row of seeded) {
      const [dbRow] = await connection.query<RowDataPacket[]>(`SELECT MeasuredDBH FROM \`${config.database}\`.coremeasurements WHERE CoreMeasurementID = ?`, [
        row.coreMeasurementID
      ]);
      expect(parseFloat(dbRow[0].MeasuredDBH), `row ${row.treeTag} must be updated to its new DBH`).toBeCloseTo(row.newDBH);
    }

    const [failureRows] = await connection.query<RowDataPacket[]>(
      `SELECT cm.CoreMeasurementID, mel.IsResolved, me.ErrorCode
       FROM \`${config.database}\`.coremeasurements cm
       JOIN \`${config.database}\`.measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
       JOIN \`${config.database}\`.measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE cm.RawTreeTag = ? AND cm.RawStemTag = ? AND cm.SourceRowIndex = ? AND cm.StemGUID IS NULL`,
      [seeded[0].treeTag, seeded[0].stemTag, VALID_ROW_COUNT]
    );
    expect(failureRows, 'exactly one DUPLICATE_ENTRY failure row must be persisted for csvIndex 10').toHaveLength(1);
    expect(failureRows[0].ErrorCode).toBe('DUPLICATE_ENTRY');
  });

  // =========================================================================
  // Literal "NULL" cells must persist as true SQL NULL, never the text
  // "NULL" -- proves the failure-row writer applies the same blank/NULL
  // placeholder tolerance as the rest of the revision-upload pipeline.
  // =========================================================================

  it('persists a literal "NULL" cell as true SQL NULL in the failed-measurement evidence row, not the text "NULL"', async () => {
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const treeTag = 'NULLTAG01';
    const stemTag = 'NULLSTEM1';

    const matchRes = await matchPOST(
      buildMatchRequest({
        rows: [{ tag: treeTag, stemtag: stemTag, dbh: 'NULL', codes: 'NULL', comments: 'null' }],
        plotID,
        censusID,
        schema: config.database
      })
    );
    expect(matchRes.status).toBe(HTTPResponses.OK);
    const matchBody = (await matchRes.json()) as RevisionUploadResponse;
    expect(matchBody.invalidRows, 'row with no DB match and missing required new-row fields must classify invalid').toHaveLength(1);

    const applyRes = await applyPOST(
      buildApplyRequest({
        matchedRows: [],
        newRows: [],
        invalidRows: matchBody.invalidRows,
        confirmNewRows: false,
        duplicateMeasurementIDsToDelete: [],
        schema: config.database,
        plotID,
        censusID,
        bulkPlanHash: matchBody.bulkPlan.planHash,
        uploadAttemptID: matchBody.uploadAttemptID,
        invalidRowsIntegrityHash: matchBody.invalidRowsIntegrityHash
      })
    );
    expect(applyRes.status).toBe(HTTPResponses.OK);

    const [failureRows] = await connection.query<RowDataPacket[]>(
      `SELECT MeasuredDBH, RawCodes, RawComments, RawTreeTag, RawStemTag FROM \`${config.database}\`.coremeasurements
       WHERE RawTreeTag = ? AND RawStemTag = ? AND StemGUID IS NULL`,
      [treeTag, stemTag]
    );
    expect(failureRows).toHaveLength(1);
    const failureRow = failureRows[0];
    expect(failureRow.MeasuredDBH, 'a literal "NULL" dbh cell must persist as SQL NULL').toBeNull();
    expect(failureRow.RawCodes, 'a literal "NULL" codes cell must persist as SQL NULL, not the text "NULL"').toBeNull();
    expect(failureRow.RawComments, 'a lowercase literal "null" comments cell must also persist as SQL NULL').toBeNull();
    // Genuinely present cells must survive untouched -- only recognized
    // blank/NULL placeholders are nulled.
    expect(failureRow.RawTreeTag).toBe(treeTag);
    expect(failureRow.RawStemTag).toBe(stemTag);
  });

  // =========================================================================
  // Independent attempts and different censuses must retain distinct
  // failure evidence -- per-attempt, census-scoped UploadBatchID keys.
  // =========================================================================

  it('keeps failure evidence from independent upload attempts and different censuses distinct, scoped by attempt and census', async () => {
    const plotID = testData.plots[0].plotID;
    const censusA = testData.census[0].censusID;
    const additionalCensus = await createAdditionalCensus(connection, testData, {
      plotCensusNumber: 9001,
      startDate: '2030-01-01',
      endDate: '2030-12-31'
    });
    const censusB = additionalCensus.censusID;
    const treeTag = 'ATTEMPTTAG1';
    const stemTag = 'ATMPT1ST1';

    // Two independent attempts against the SAME census/tag -- each upload
    // mints its own uploadAttemptID (route.ts), so each must leave its own
    // persisted row rather than overwriting the other's evidence.
    const attempt1 = await runInvalidOnlyAttempt(plotID, censusA, treeTag, stemTag);
    const attempt2 = await runInvalidOnlyAttempt(plotID, censusA, treeTag, stemTag);
    expect(attempt1.uploadAttemptID, 'two independent uploads must never share an identity').not.toBe(attempt2.uploadAttemptID);

    // A third attempt against a DIFFERENT census, same tag/stemtag text --
    // CensusID must scope its own evidence rather than merging with censusA's.
    const attempt3 = await runInvalidOnlyAttempt(plotID, censusB, treeTag, stemTag);
    expect(attempt3.uploadAttemptID).not.toBe(attempt1.uploadAttemptID);
    expect(attempt3.uploadAttemptID).not.toBe(attempt2.uploadAttemptID);

    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID, CensusID, UploadBatchID FROM \`${config.database}\`.coremeasurements
       WHERE RawTreeTag = ? AND RawStemTag = ? AND StemGUID IS NULL ORDER BY CoreMeasurementID ASC`,
      [treeTag, stemTag]
    );

    expect(rows, 'all three independent attempts must each leave their own persisted failure row').toHaveLength(3);
    const batchIDs = new Set(rows.map(row => row.UploadBatchID));
    expect(batchIDs.size, 'every attempt must derive a distinct UploadBatchID').toBe(3);
    expect(
      rows.filter(row => row.CensusID === censusA),
      'two rows must be scoped to census A'
    ).toHaveLength(2);
    expect(
      rows.filter(row => row.CensusID === censusB),
      'one row must be scoped to census B'
    ).toHaveLength(1);
  });

  // =========================================================================
  // Same-attempt retry / re-review idempotency -- including a re-match via
  // previousUploadAttemptID (#505 route.ts contract).
  // =========================================================================

  it('is idempotent for a same-attempt retry and for a same-attempt re-review via previousUploadAttemptID -- never creating duplicate failure-evidence rows', async () => {
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const treeTag = 'RETRYTAG01';
    const stemTag = 'RETRYST01';

    const matchBody = await runInvalidOnlyAttempt(plotID, censusID, treeTag, stemTag);

    function buildRetryApplyRequest(body: RevisionUploadResponse) {
      return buildApplyRequest({
        matchedRows: [],
        newRows: [],
        invalidRows: body.invalidRows,
        confirmNewRows: false,
        duplicateMeasurementIDsToDelete: [],
        schema: config.database,
        plotID,
        censusID,
        bulkPlanHash: body.bulkPlan.planHash,
        uploadAttemptID: body.uploadAttemptID,
        invalidRowsIntegrityHash: body.invalidRowsIntegrityHash
      });
    }

    // Retry: the exact same apply request again (e.g. the client never saw
    // the first response and resubmitted). Must hit insertIngestionFailureRows'
    // ON DUPLICATE KEY UPDATE on (UploadBatchID, SourceRowIndex), not a second row.
    const retryApplyRes = await applyPOST(buildRetryApplyRequest(matchBody));
    expect(retryApplyRes.status).toBe(HTTPResponses.OK);

    const [rowsAfterRetry] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID FROM \`${config.database}\`.coremeasurements WHERE RawTreeTag = ? AND RawStemTag = ? AND StemGUID IS NULL`,
      [treeTag, stemTag]
    );
    expect(rowsAfterRetry, 'retrying the identical apply request must not create a second failure row').toHaveLength(1);
    const persistedCoreMeasurementID = rowsAfterRetry[0].CoreMeasurementID;

    // Re-review: re-match the SAME attempt via previousUploadAttemptID --
    // the match route must echo back the SAME uploadAttemptID rather than
    // minting a new one, and applying again must still be idempotent.
    const rematchRes = await matchPOST(
      buildMatchRequest({
        rows: [{ tag: treeTag, stemtag: stemTag, dbh: '10.0' }],
        plotID,
        censusID,
        schema: config.database,
        previousUploadAttemptID: matchBody.uploadAttemptID
      })
    );
    expect(rematchRes.status).toBe(HTTPResponses.OK);
    const rematchBody = (await rematchRes.json()) as RevisionUploadResponse;
    expect(rematchBody.uploadAttemptID, 'a re-match of the same attempt must retain its identity').toBe(matchBody.uploadAttemptID);

    const rereviewApplyRes = await applyPOST(buildRetryApplyRequest(rematchBody));
    expect(rereviewApplyRes.status).toBe(HTTPResponses.OK);

    const [rowsAfterRereview] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID FROM \`${config.database}\`.coremeasurements WHERE RawTreeTag = ? AND RawStemTag = ? AND StemGUID IS NULL`,
      [treeTag, stemTag]
    );
    expect(rowsAfterRereview, 'a same-attempt re-review/apply cycle must still resolve to exactly one failure row').toHaveLength(1);
    expect(rowsAfterRereview[0].CoreMeasurementID).toBe(persistedCoreMeasurementID);
  });

  // =========================================================================
  // A forged hash (recomputed over the tampered payload, but without the
  // server's AUTH_SECRET) must be rejected exactly like a stale one.
  // =========================================================================

  it('rejects a forged invalidRowsIntegrityHash recomputed over a changed reason, not just a stale original hash, with zero rows persisted', async () => {
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const treeTag = 'FORGETAG01';
    const stemTag = 'FORGEST01';

    const matchRes = await matchPOST(buildMatchRequest({ rows: [{ tag: treeTag, stemtag: stemTag, dbh: '9.0' }], plotID, censusID, schema: config.database }));
    expect(matchRes.status).toBe(HTTPResponses.OK);
    const matchBody = (await matchRes.json()) as RevisionUploadResponse;
    expect(matchBody.invalidRows).toHaveLength(1);

    const tamperedInvalidRows = [{ ...matchBody.invalidRows[0], reason: 'forged reason, not the real rejection' }];

    // An attacker without AUTH_SECRET cannot reproduce the server's HMAC,
    // but CAN recompute an unkeyed digest of the same public inputs and
    // submit that as the "hash" -- proving the check is a real signature,
    // not a value a client could independently reconstruct.
    const forgedHash = createHash('sha256')
      .update(JSON.stringify({ schema: config.database, plotID, censusID, uploadAttemptID: matchBody.uploadAttemptID, rows: tamperedInvalidRows }))
      .digest('hex');

    const applyRes = await applyPOST(
      buildApplyRequest({
        matchedRows: [],
        newRows: [],
        invalidRows: tamperedInvalidRows,
        confirmNewRows: false,
        duplicateMeasurementIDsToDelete: [],
        schema: config.database,
        plotID,
        censusID,
        bulkPlanHash: matchBody.bulkPlan.planHash,
        uploadAttemptID: matchBody.uploadAttemptID,
        invalidRowsIntegrityHash: forgedHash
      })
    );

    expect(applyRes.status, 'a forged (attacker-recomputed, unkeyed) hash paired with a changed reason must still be rejected').toBe(HTTPResponses.CONFLICT);

    const [persistedRows] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM \`${config.database}\`.coremeasurements WHERE RawTreeTag = ? AND StemGUID IS NULL`,
      [treeTag]
    );
    expect(persistedRows, 'a rejected 409 must leave no trace in coremeasurements').toHaveLength(0);
  });

  // =========================================================================
  // A late failure inside the apply transaction -- injected via a scoped
  // spy on the LAST production write the transaction makes (the
  // writeEditOperation ledger INSERT), not a 409 pre-check and not a
  // production code change -- must roll back BOTH the earlier valid
  // matched-row write and the earlier failure-row evidence insert.
  // =========================================================================

  it('rolls back both the valid matched-row update and the failed-row evidence insert when the ledger write fails late in the same transaction', async () => {
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const speciesID = await getDefaultSpeciesID();
    const quadratID = await getDefaultQuadratID(plotID);

    const survivorTreeTag = 'LATEFAILSV';
    const survivorStemTag = 'LATEFSV1';
    const originalDBH = 20.0;
    const newDBH = 25.0;
    const { coreMeasurementID: survivorID } = await insertActiveStemMeasurement({
      censusID,
      quadratID,
      speciesID,
      treeTag: survivorTreeTag,
      stemTag: survivorStemTag,
      dbh: originalDBH,
      hom: 1.3,
      date: '2024-01-01'
    });

    const invalidTreeTag = 'LATEFAILIV';
    const invalidStemTag = 'LATEFIV1';

    const matchRes = await matchPOST(
      buildMatchRequest({
        rows: [
          { tag: survivorTreeTag, stemtag: survivorStemTag, dbh: String(newDBH), date: '2024-01-01' },
          { tag: invalidTreeTag, stemtag: invalidStemTag, dbh: '1.0' }
        ],
        plotID,
        censusID,
        schema: config.database
      })
    );
    expect(matchRes.status).toBe(HTTPResponses.OK);
    const matchBody = (await matchRes.json()) as RevisionUploadResponse;
    expect(matchBody.matchedRows).toHaveLength(1);
    expect(matchBody.matchedRows[0].coreMeasurementID).toBe(survivorID);
    expect(matchBody.invalidRows).toHaveLength(1);

    const applyRequest = buildApplyRequest({
      matchedRows: [{ coreMeasurementID: survivorID, csvRow: matchBody.matchedRows[0].csvRow, duplicateMeasurementIDsToDelete: [] }],
      newRows: [],
      invalidRows: matchBody.invalidRows,
      confirmNewRows: false,
      duplicateMeasurementIDsToDelete: [],
      schema: config.database,
      plotID,
      censusID,
      bulkPlanHash: matchBody.bulkPlan.planHash,
      uploadAttemptID: matchBody.uploadAttemptID,
      invalidRowsIntegrityHash: matchBody.invalidRowsIntegrityHash
    });

    // Scoped spy on the SAME ConnectionManager singleton the real route
    // calls through: every query passes through to the real connection
    // UNCHANGED except the ledger INSERT (writeEditOperation, editoperations.ts),
    // the LAST production write the transaction makes. By the time that
    // query runs, the matched-row UPDATE and the failure-row INSERT have
    // unconditionally already executed (apply/route.ts's write order) --
    // captured here, on the transaction's own connection, before the fault
    // fires, so the proof that both writes actually happened does not rely
    // on asserting anything after rollback.
    const connectionManager = ConnectionManager.getInstance();
    const realExecuteQuery = connectionManager.executeQuery.bind(connectionManager);
    let preFaultSnapshot: { survivorDBH: number; failureRowCount: number } | null = null;
    const executeQuerySpy = vi
      .spyOn(connectionManager, 'executeQuery')
      .mockImplementation(async (query: string, params?: unknown[], transactionID?: string) => {
        if (query.includes('INSERT INTO') && query.includes('edit_operations')) {
          const [survivorRows] = await connection.query<RowDataPacket[]>(
            `SELECT MeasuredDBH FROM \`${config.database}\`.coremeasurements WHERE CoreMeasurementID = ?`,
            [survivorID]
          );
          const [failureRows] = await connection.query<RowDataPacket[]>(
            `SELECT CoreMeasurementID FROM \`${config.database}\`.coremeasurements WHERE RawTreeTag = ? AND StemGUID IS NULL`,
            [invalidTreeTag]
          );
          preFaultSnapshot = { survivorDBH: parseFloat(survivorRows[0]?.MeasuredDBH), failureRowCount: failureRows.length };
          throw new Error('INJECTED_LATE_FAULT: simulated ledger-write failure');
        }
        return realExecuteQuery(query, params, transactionID);
      });

    let applyRes: Response;
    try {
      applyRes = await applyPOST(applyRequest);
    } finally {
      executeQuerySpy.mockRestore();
    }

    expect(preFaultSnapshot, 'the ledger write must actually have been reached').not.toBeNull();
    expect(preFaultSnapshot!.survivorDBH, 'the matched-row UPDATE must be visible on the transaction connection before the late fault').toBeCloseTo(newDBH);
    expect(preFaultSnapshot!.failureRowCount, 'the failure-row INSERT must be visible on the transaction connection before the late fault').toBe(1);

    expect(applyRes.status, 'an unexpected late write failure must surface as a server error, not a silent success').toBe(HTTPResponses.INTERNAL_SERVER_ERROR);

    const [survivorAfterRollback] = await connection.query<RowDataPacket[]>(
      `SELECT MeasuredDBH FROM \`${config.database}\`.coremeasurements WHERE CoreMeasurementID = ?`,
      [survivorID]
    );
    expect(parseFloat(survivorAfterRollback[0].MeasuredDBH), 'after rollback the matched-row update must not persist').toBeCloseTo(originalDBH);

    const [failureRowsAfterRollback] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM \`${config.database}\`.coremeasurements WHERE RawTreeTag = ? AND StemGUID IS NULL`,
      [invalidTreeTag]
    );
    expect(failureRowsAfterRollback, 'after rollback the failure-row insert must not persist either').toHaveLength(0);
  });
});
