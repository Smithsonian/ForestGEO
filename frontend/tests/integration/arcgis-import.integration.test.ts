/**
 * ArcGIS two-sheet .xlsx import — end-to-end integration.
 *
 * Builds a tiny two-sheet workbook in memory, runs the pure reader + transform,
 * stages the canonical rows into temporarymeasurements, then exercises the real
 * bulkingestionprocess stored procedure and asserts the resulting coremeasurements.
 *
 * Prerequisites: docker compose up -d mysql
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import ExcelJS from 'exceljs';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestMeasurements,
  insertTestMeasurements,
  runBulkIngestion,
  type TestData
} from '../setup/local-db-setup';
import { readArcgisWorkbook } from '../../lib/arcgis/workbook-reader';
import { transformArcgisWorkbook } from '../../lib/arcgis/transform';
import type { TransformResult } from '../../lib/arcgis/types';

// Identity the auth mock authenticates as. getSessionUserId() returns the
// email first, so staged ArcGIS sessions are seeded with this as user_id.
const AUTH_USER_EMAIL = 'arcgis-commit@example.com';
const TRANSACTION_ID_PREFIX = 'arcgis-commit-tx-';

// ---------------------------------------------------------------------------
// Shared state bridge — hoisted so the ConnectionManager mock closure can read
// the live test connection after beforeAll wires it up.
// ---------------------------------------------------------------------------
const sharedState = vi.hoisted(() => ({
  connection: null as Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0,
  executedQueries: [] as string[]
}));
// Echoes back the caller-supplied sessionId (the `x-upload-session-id` header
// value route.ts forwards as `options.sessionId`) rather than a fixed string —
// commitArcgisImport's uploadSessionID is `uploadSession.sessionId ?? sessionId`,
// so a mock that always returns the same session id would key every commit's
// file_upload changelog row to that one identity regardless of which attempt
// actually ran, making buildFileUploadChangelogRecordID lookups for a test's
// OWN uploadSessionId miss entirely (#507).
const uploadSessionState = vi.hoisted((): { requireOwnership: (options: { sessionId?: string | null }) => Promise<{ sessionId: string }> } => ({
  requireOwnership: async (options: { sessionId?: string | null }) => ({ sessionId: options?.sessionId ?? 'mock-upload-session' })
}));

// Auth mock — 'global' role lets assertCanEditMeasurementScope pass the
// schema-access check (it still verifies plot/census exist against the DB).
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

// ConnectionManager mock — routes every route-handler DB call to the shared
// test connection and implements withTransaction against real MySQL so the
// commit route's single transaction actually commits the staged rows.
vi.mock('@/lib/db/connectionmanager', () => {
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      sharedState.executedQueries.push(query);
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
    // Production's withTransaction (lib/db/connectionmanager.ts) hands the callback a
    // TxExecutor — `{ id, query }` — not a bare transaction-id string. arcgis-commit.ts
    // reads `tx.id` (line ~78) and passes `tx` itself to transactionExecutorFor-shaped
    // callers; a mock that invoked `fn(txID)` here silently handed every one of those
    // `undefined`, which is what the dropped-row ArcGIS tests were actually tripping over.
    withTransaction: async <T>(fn: (tx: { id: string; query: <R = unknown>(sql: string, params?: unknown[]) => Promise<R> }) => Promise<T>) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      await sharedState.connection.beginTransaction();
      sharedState.transactionCounter += 1;
      const txID = `${TRANSACTION_ID_PREFIX}${sharedState.transactionCounter}`;
      sharedState.activeTransactionID = txID;
      try {
        const result = await fn({ id: txID, query: <R = unknown>(sql: string, params?: unknown[]) => manager.executeQuery(sql, params, txID) as Promise<R> });
        await sharedState.connection.commit();
        sharedState.activeTransactionID = null;
        return result;
      } catch (err) {
        await sharedState.connection.rollback();
        sharedState.activeTransactionID = null;
        throw err;
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
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

// requireUploadSessionOwnership / getSession open their own pool connection
// (real Azure DB). Delegate to a per-test handler so most integration tests can
// short-circuit ownership while negative-path tests can force guard failures.
vi.mock('@/config/uploadsessiontracker', async () => {
  const actual = await vi.importActual<typeof import('@/config/uploadsessiontracker')>('@/config/uploadsessiontracker');
  return {
    ...actual,
    requireUploadSessionOwnership: (options: { sessionId?: string | null }) => uploadSessionState.requireOwnership(options)
  };
});

// Route handler + session loader imported AFTER vi.mock so the mocks are wired.
import { POST as commitPOST } from '@/app/api/arcgis/commit/route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { commitArcgisImport } from '@/lib/uploads/arcgis-commit';
import { buildFileUploadChangelogRecordID, MAX_MEASUREMENT_FILE_ID_LENGTH } from '@/lib/uploads/file-names';
import { ARCGIS_IMPORT_SESSION_STATE, ArcgisImportSessionError, ArcgisStagingAccountingError, createArcgisImportSession } from '@/lib/arcgis/import-session';
import { UploadMode } from '@/config/uploadmodes';
import { HTTPResponses } from '@/config/macros';
import { UploadSessionOwnershipError } from '@/config/uploadsessiontracker';
import { buildSubBatchID, buildSubBatchPattern, deriveArcgisCommitBatchID, LIKE_ESCAPE_CLAUSE, MAX_ORIGINAL_BATCH_ID_LENGTH } from '@/lib/uploads/batch-family';

/** A commit this small fits in one sub-batch, so every row stages under the first member. */
const FIRST_SUB_BATCH_ORDINAL = 1;
const STAGED_ROW_COUNT_SQL = /SELECT\s+COUNT\(\*\)[\s\S]*FROM\s+\S*temporarymeasurements\b/i;
import {
  buildArcgisImportRows,
  countCensusRowsOutsideFamily,
  countFamilyFailureRows,
  dropStagingTupleWithTreeTag,
  readImportRow,
  seedPriorCensusRows,
  startActiveUploadSession,
  type ArcgisImportScope
} from '../setup/arcgis-commit-fixtures';

async function buildWorkbook(sheets: Record<string, unknown[][]>): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, aoa] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    aoa.forEach(row => ws.addRow(row));
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

function buildCommitRequest(body: Record<string, unknown>, uploadSessionId: string) {
  return new Request('http://localhost/api/arcgis/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-upload-session-id': uploadSessionId },
    body: JSON.stringify(body)
  }) as any;
}

describe('ArcGIS xlsx import (end-to-end)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    // Bridge the mocked ConnectionManager to this real test connection so the
    // commit route handler's queries run against the same isolated schema.
    sharedState.connection = connection;
  }, 90000);

  afterAll(async () => {
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    // Echo the caller's sessionId by default — see the hoisted mock's doc
    // comment above for why a fixed string here breaks RecordID lookups.
    uploadSessionState.requireOwnership = async (options: { sessionId?: string | null }) => ({ sessionId: options?.sessionId ?? 'mock-upload-session' });
    sharedState.executedQueries = [];
    await cleanupTestMeasurements(connection, testData);
    // This suite's shared connection accumulates GET_LOCKs across tests (MySQL
    // ties them to the session, not the transaction) — release them all so one
    // test's lock state can never bleed into the next.
    await connection.query('SELECT RELEASE_ALL_LOCKS()');
  });

  it('ingests a tree + its additional stem with inherited coordinates and joined codes', async () => {
    const speciesCode = testData.species[0].SpeciesCode;
    const quadratName = testData.quadrats[0].QuadratName;
    const dateSerial = 46036;

    // Only seeded codes (A/D/M/B/R) survive bulkingestionprocess.
    const TREE_HEADER = ['GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured', 'lx', 'ly', 'COD_M', 'COD_R'];
    const STEM_HEADER = ['ParentGlobalID', 'GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured', 'COD_A'];

    const buffer = await buildWorkbook({
      trees: [TREE_HEADER, ['G1', quadratName, 'T100', 'T100', speciesCode, 12.3, 1.3, 'primary', dateSerial, 5.123456, 6.234567, 'M', 'R']],
      stems: [STEM_HEADER, ['G1', 'S1', quadratName, 'T100', 'T100-2', speciesCode, 4.4, 1.3, '', dateSerial, 'A']]
    });

    const result = transformArcgisWorkbook(await readArcgisWorkbook(buffer));
    expect(result.rows).toHaveLength(2);

    const measurements = result.rows.map(r => ({
      treeTag: r.tag as string,
      stemTag: (r.stemtag as string) ?? '',
      speciesCode: r.spcode as string,
      quadratName: r.quadrat as string,
      x: Number(r.lx),
      y: Number(r.ly),
      dbh: Number(r.dbh),
      hom: Number(r.hom),
      date: r.date as string,
      codes: r.codes || undefined,
      comments: r.comments || undefined
    }));

    const { fileID, batchID } = await insertTestMeasurements(connection, testData, measurements);
    const ingestion = await runBulkIngestion(connection, fileID, batchID);
    expect(ingestion.batch_failed).toBe(false);

    const [coreRows] = await connection.query<RowDataPacket[]>(
      `SELECT t.TreeTag, s.StemTag, q.QuadratName, s.LocalX, s.LocalY, cm.MeasuredDBH, cm.RawCodes,
              GROUP_CONCAT(DISTINCT cma.Code ORDER BY cma.Code SEPARATOR ';') AS Codes
         FROM coremeasurements cm
         INNER JOIN stems s ON s.StemGUID = cm.StemGUID
         INNER JOIN trees t ON t.TreeID = s.TreeID
         INNER JOIN quadrats q ON q.QuadratID = s.QuadratID
         LEFT JOIN cmattributes cma ON cma.CoreMeasurementID = cm.CoreMeasurementID
        WHERE t.TreeTag = 'T100'
        GROUP BY cm.CoreMeasurementID, t.TreeTag, s.StemTag, q.QuadratName, s.LocalX, s.LocalY, cm.MeasuredDBH, cm.RawCodes
        ORDER BY s.StemTag`,
      []
    );

    expect(coreRows).toHaveLength(2);
    const primary = coreRows.find(r => r.StemTag === 'T100');
    const additional = coreRows.find(r => r.StemTag === 'T100-2');
    expect(primary).toBeDefined();
    expect(additional).toBeDefined();

    expect(Number(primary!.LocalX)).toBeCloseTo(5.123456, 6);
    expect(Number(primary!.LocalY)).toBeCloseTo(6.234567, 6);
    expect(Number(additional!.LocalX)).toBeCloseTo(5.123456, 6);
    expect(Number(additional!.LocalY)).toBeCloseTo(6.234567, 6);
    expect(additional!.QuadratName).toBe(quadratName);
    expect(String(primary!.Codes)).toContain('M');
    expect(String(primary!.Codes)).toContain('R');
    expect(String(additional!.Codes)).toContain('A');
  });

  it('commits every staged arcgis row into temporarymeasurements in one server-side call', async () => {
    const schema = config.database;
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const speciesCode = testData.species[0].SpeciesCode;
    const quadratName = testData.quadrats[0].QuadratName;
    const dateSerial = 46036;

    // Build a real two-sheet workbook and run the same reader+transform the
    // preflight route uses, so the staged rows are byte-identical to production.
    const TREE_HEADER = ['GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured', 'lx', 'ly', 'COD_M'];
    const STEM_HEADER = ['ParentGlobalID', 'GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured', 'COD_A'];

    const buffer = await buildWorkbook({
      trees: [
        TREE_HEADER,
        ['GC1', quadratName, 'C200', 'C200', speciesCode, 15.5, 1.3, 'primary', dateSerial, 7.111111, 8.222222, 'M'],
        ['GC2', quadratName, 'C201', 'C201', speciesCode, 9.9, 1.3, 'primary', dateSerial, 9.333333, 10.444444, 'M']
      ],
      stems: [STEM_HEADER, ['GC1', 'SC1', quadratName, 'C200', 'C200-2', speciesCode, 4.4, 1.3, '', dateSerial, 'A']]
    });

    const result = transformArcgisWorkbook(await readArcgisWorkbook(buffer));
    const stagedRowCount = result.rows.length;
    expect(stagedRowCount).toBeGreaterThan(0);

    // Seed the preflight import session exactly as POST /api/arcgis/preflight does.
    const fileName = 'cooks-branch-commit.xlsx';
    const importReference = await createArcgisImportSession({
      schema,
      plotID,
      censusID,
      userId: AUTH_USER_EMAIL,
      fileName,
      result
    });
    expect(importReference.rowCount).toBe(stagedRowCount);

    const batchID = deriveArcgisCommitBatchID(importReference.importSessionId);
    const uploadSessionId = 'upload-session-arcgis-commit';
    await startUploadSession(uploadSessionId);

    const response = await commitPOST(
      buildCommitRequest(
        {
          schema,
          plotID,
          censusID,
          importSessionId: importReference.importSessionId,
          fileName,
          uploadMode: UploadMode.REVISIONS
        },
        uploadSessionId
      )
    );

    expect(response.status).toBe(HTTPResponses.OK);
    const payload = (await response.json()) as { rowCount: number; fileName: string; batchID: string };
    expect(payload.fileName).toBe(fileName);
    expect(payload.rowCount).toBe(stagedRowCount);
    expect(payload.batchID, 'the server derives the batch from the import session; the client sent none').toBe(batchID);

    // The staged rows must physically land in temporarymeasurements under the
    // committed FileID's batch family with the arcgis_xlsx provenance tag, each
    // already under its final sub-batch so setup has nothing to split.
    const [memberRows] = await connection.query<RowDataPacket[]>(
      `SELECT BatchID, SourceFormat, COUNT(*) AS total FROM temporarymeasurements
       WHERE FileID = ? AND (BatchID = ? OR BatchID LIKE ? ${LIKE_ESCAPE_CLAUSE})
       GROUP BY BatchID, SourceFormat ORDER BY BatchID`,
      [fileName, batchID, buildSubBatchPattern(batchID)]
    );
    const stagedMembers = memberRows.map(row => ({ batchID: String(row.BatchID), sourceFormat: String(row.SourceFormat), total: Number(row.total) }));
    const stagedRowCountQueries = sharedState.executedQueries.filter(query => STAGED_ROW_COUNT_SQL.test(query));
    console.log(`[arcgis-commit] staged members=${JSON.stringify(stagedMembers)} countQueries=${JSON.stringify(stagedRowCountQueries)}`);
    expect(stagedMembers).toEqual([{ batchID: buildSubBatchID(batchID, FIRST_SUB_BATCH_ORDINAL), sourceFormat: 'arcgis_xlsx', total: stagedRowCount }]);
    expect(
      stagedRowCountQueries,
      'staging windows count inserts from INSERT results; only the finalize unit reads COUNT(*) over temporarymeasurements, once, to verify the import'
    ).toHaveLength(1);

    // Audit-trail parity with the CSV measurements path: the commit must write a
    // single file_upload row into unifiedchangelog so the upload appears in the
    // upload-history UI, carrying arcgis_xlsx provenance and the inserted rowCount.
    // RecordID is keyed by upload ATTEMPT (buildFileUploadChangelogRecordID:
    // `${fileName}::${uploadSessionID}`, #507), not by fileName alone — a
    // plain-filename lookup here would silently match zero rows once two
    // attempts for the same file both exist.
    const fileUploadRecordID = buildFileUploadChangelogRecordID(fileName, uploadSessionId);
    const [changelogRows] = await connection.query<RowDataPacket[]>(
      `SELECT ChangedBy, PlotID, CensusID, NewRowState
         FROM unifiedchangelog
        WHERE TableName = 'file_upload' AND RecordID = ? AND CensusID = ?`,
      [fileUploadRecordID, censusID]
    );
    expect(changelogRows).toHaveLength(1);

    const changelogRow = changelogRows[0];
    expect(changelogRow.ChangedBy).toBe(AUTH_USER_EMAIL);
    expect(Number(changelogRow.PlotID)).toBe(plotID);
    expect(Number(changelogRow.CensusID)).toBe(censusID);

    // NewRowState is the JSON metadata blob; the mysql2 driver may auto-parse the
    // JSON column, so tolerate either a string or an already-parsed object.
    const metadata = typeof changelogRow.NewRowState === 'string' ? JSON.parse(changelogRow.NewRowState) : changelogRow.NewRowState;
    expect(metadata.fileName).toBe(fileName);
    expect(metadata.formType).toBe('measurements');
    expect(metadata.sourceFormat).toBe('arcgis_xlsx');
    expect(metadata.uploadMode).toBe(UploadMode.REVISIONS);
    expect(metadata.rowCount).toBe(stagedRowCount);
    expect(metadata.droppedCount).toBe(0);
    expect(metadata.batchCount).toBe(1);

    // A second, genuinely DIFFERENT upload attempt for the SAME file+census
    // (new importSessionId + batchID + uploadSessionID) must get its OWN
    // changelog row under its OWN attempt-scoped RecordID — proving distinct
    // attempts stay separate rather than merging into one row (#507).
    const secondImportReference = await createArcgisImportSession({
      schema,
      plotID,
      censusID,
      userId: AUTH_USER_EMAIL,
      fileName,
      result
    });
    const secondUploadSessionId = 'upload-session-arcgis-commit-second';
    await startUploadSession(secondUploadSessionId);
    const secondResponse = await commitPOST(
      buildCommitRequest(
        {
          schema,
          plotID,
          censusID,
          importSessionId: secondImportReference.importSessionId,
          fileName,
          uploadMode: UploadMode.REVISIONS
        },
        secondUploadSessionId
      )
    );
    expect(secondResponse.status).toBe(HTTPResponses.OK);
    expect(((await secondResponse.json()) as { batchID: string }).batchID).toBe(deriveArcgisCommitBatchID(secondImportReference.importSessionId));

    const secondFileUploadRecordID = buildFileUploadChangelogRecordID(fileName, secondUploadSessionId);
    const [firstAttemptRowsAfterSecond] = await connection.query<RowDataPacket[]>(
      `SELECT ChangeID FROM unifiedchangelog WHERE TableName = 'file_upload' AND RecordID = ? AND CensusID = ?`,
      [fileUploadRecordID, censusID]
    );
    const [secondAttemptRows] = await connection.query<RowDataPacket[]>(
      `SELECT ChangeID FROM unifiedchangelog WHERE TableName = 'file_upload' AND RecordID = ? AND CensusID = ?`,
      [secondFileUploadRecordID, censusID]
    );
    expect(firstAttemptRowsAfterSecond, 'the first attempt row must be untouched by a second, distinct attempt').toHaveLength(1);
    expect(secondAttemptRows, 'a second distinct attempt must get its own changelog row, not merge into the first').toHaveLength(1);
    expect(secondFileUploadRecordID).not.toBe(fileUploadRecordID);
  });

  // -------------------------------------------------------------------------
  // Negative-path coverage for the attacker-facing commit endpoint.
  //
  // Each test seeds a REAL staged session via createArcgisImportSession, drives
  // the real commit POST handler with a deliberately-bad request, and asserts:
  //   (a) the handler returns the correct rejection status, AND
  //   (b) NOTHING was staged into temporarymeasurements for that FileID/BatchID.
  // Property (b) is the key safety guarantee: a rejected commit must perform no
  // partial side effects on the staging table.
  // -------------------------------------------------------------------------
  async function seedValidStagedSession(overrides?: { userId?: string; fileName?: string }): Promise<{
    importSessionId: string;
    fileName: string;
    plotID: number;
    censusID: number;
    schema: string;
    stagedRowCount: number;
  }> {
    const schema = config.database;
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const speciesCode = testData.species[0].SpeciesCode;
    const quadratName = testData.quadrats[0].QuadratName;
    const dateSerial = 46036;

    const TREE_HEADER = ['GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured', 'lx', 'ly', 'COD_M'];
    const STEM_HEADER = ['ParentGlobalID', 'GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured', 'COD_A'];
    const buffer = await buildWorkbook({
      trees: [TREE_HEADER, ['GN1', quadratName, 'N300', 'N300', speciesCode, 11.1, 1.3, 'primary', dateSerial, 1.111111, 2.222222, 'M']],
      stems: [STEM_HEADER, ['GN1', 'SN1', quadratName, 'N300', 'N300-2', speciesCode, 3.3, 1.3, '', dateSerial, 'A']]
    });
    const result = transformArcgisWorkbook(await readArcgisWorkbook(buffer));
    expect(result.rows.length).toBeGreaterThan(0);

    const fileName = overrides?.fileName ?? `arcgis-negative-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`;
    const importReference = await createArcgisImportSession({
      schema,
      plotID,
      censusID,
      userId: overrides?.userId ?? AUTH_USER_EMAIL,
      fileName,
      result
    });

    return { importSessionId: importReference.importSessionId, fileName, plotID, censusID, schema, stagedRowCount: result.rows.length };
  }

  /** Rows staged under the batch family: the original ID and every `__subNNN` member. */
  async function countStagedRows(fileName: string, batchID: string): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ? AND (BatchID = ? OR BatchID LIKE ? ${LIKE_ESCAPE_CLAUSE})`,
      [fileName, batchID, buildSubBatchPattern(batchID)]
    );
    return Number(rows[0].total);
  }

  async function getImportSession(importSessionId: string): Promise<RowDataPacket> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT state, committed_file_id, committed_batch_id, committed_upload_session_id, committed_row_count, committed_at
         FROM arcgis_import_sessions
        WHERE import_session_id = ?`,
      [importSessionId]
    );
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  function importScope(): ArcgisImportScope {
    return {
      schema: config.database,
      plotID: testData.plots[0].plotID,
      censusID: testData.census[0].censusID,
      speciesCode: testData.species[0].SpeciesCode,
      quadratName: testData.quadrats[0].QuadratName
    };
  }

  /** The commit's units read this row to prove their upload session is still live, so every committing test needs one. */
  function startUploadSession(uploadSessionID: string): Promise<void> {
    return startActiveUploadSession(connection, importScope(), uploadSessionID);
  }

  async function startedUploadSession(uploadSessionID: string): Promise<string> {
    await startUploadSession(uploadSessionID);
    return uploadSessionID;
  }

  /** The body the UI now sends: no batchID, the server derives it. */
  function buildCommitBody(
    seeded: { importSessionId: string; fileName: string; plotID: number; censusID: number; schema: string },
    uploadMode = UploadMode.REVISIONS
  ) {
    return {
      schema: seeded.schema,
      plotID: seeded.plotID,
      censusID: seeded.censusID,
      importSessionId: seeded.importSessionId,
      fileName: seeded.fileName,
      uploadMode
    };
  }

  it('commits ArcGIS rows through the normal bulk ingestion procedure after server-side staging', async () => {
    const seeded = await seedValidStagedSession({ fileName: `arcgis-process-${Date.now()}.xlsx` });
    const batchID = deriveArcgisCommitBatchID(seeded.importSessionId);
    const uploadSessionId = 'upload-session-arcgis-process';
    await startUploadSession(uploadSessionId);

    const response = await commitPOST(buildCommitRequest(buildCommitBody(seeded), uploadSessionId));
    expect(response.status).toBe(HTTPResponses.OK);
    expect(((await response.json()) as { batchID: string }).batchID).toBe(batchID);
    expect(await countStagedRows(seeded.fileName, batchID)).toBe(seeded.stagedRowCount);

    const memberBatchID = buildSubBatchID(batchID, FIRST_SUB_BATCH_ORDINAL);
    const ingestion = await runBulkIngestion(connection, seeded.fileName, memberBatchID);
    expect(ingestion.batch_failed).toBe(false);

    const [coreRows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
         FROM coremeasurements
        WHERE UploadFileID = ? AND UploadBatchID = ?`,
      [seeded.fileName, memberBatchID]
    );
    expect(Number(coreRows[0].total)).toBe(seeded.stagedRowCount);
    expect(await countStagedRows(seeded.fileName, batchID)).toBe(0);
  });

  it('captures a StemID column from the ArcGIS workbook all the way to stems.PublishedStemID', async () => {
    const schema = config.database;
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const speciesCode = testData.species[0].SpeciesCode;
    const quadratName = testData.quadrats[0].QuadratName;
    const dateSerial = 46036;
    const treePublishedStemId = 7001;
    const stemPublishedStemId = 7002;

    // Both sheets carry a StemID column; the tree-sheet id belongs to the primary stem, the
    // stem-sheet id to the additional stem.
    const TREE_HEADER = ['GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'DBH_CURRENT', 'HOM', 'notes', 'Date_measured', 'lx', 'ly', 'COD_M', 'StemID'];
    const STEM_HEADER = [
      'ParentGlobalID',
      'GlobalID',
      'quadrat',
      'tag',
      'StemTag',
      'spcode',
      'DBH_CURRENT',
      'HOM',
      'notes',
      'Date_measured',
      'COD_A',
      'StemID'
    ];
    const buffer = await buildWorkbook({
      trees: [
        TREE_HEADER,
        ['GP1', quadratName, 'PSID400', 'PSID400', speciesCode, 11.1, 1.3, 'primary', dateSerial, 1.111111, 2.222222, 'M', treePublishedStemId]
      ],
      stems: [STEM_HEADER, ['GP1', 'SP1', quadratName, 'PSID400', 'PSID400-2', speciesCode, 3.3, 1.3, '', dateSerial, 'A', stemPublishedStemId]]
    });
    const result = transformArcgisWorkbook(await readArcgisWorkbook(buffer));

    // Keep the generated name within the canonical FileID width.
    const fileName = `arcgis-psid-${Date.now()}.xlsx`;
    const importReference = await createArcgisImportSession({ schema, plotID, censusID, userId: AUTH_USER_EMAIL, fileName, result });
    const batchID = deriveArcgisCommitBatchID(importReference.importSessionId);
    const uploadSessionId = 'upload-session-arcgis-publishedstemid';
    await startUploadSession(uploadSessionId);

    const response = await commitPOST(
      buildCommitRequest(
        { schema, plotID, censusID, importSessionId: importReference.importSessionId, fileName, uploadMode: UploadMode.REVISIONS },
        uploadSessionId
      )
    );
    expect(response.status).toBe(HTTPResponses.OK);

    const memberBatchID = buildSubBatchID(batchID, FIRST_SUB_BATCH_ORDINAL);
    const ingestion = await runBulkIngestion(connection, fileName, memberBatchID);
    expect(ingestion.batch_failed).toBe(false);

    const [stemRows] = await connection.query<RowDataPacket[]>(
      `SELECT s.StemTag, s.PublishedStemID
         FROM stems s
         INNER JOIN coremeasurements cm ON cm.StemGUID = s.StemGUID
        WHERE cm.UploadFileID = ? AND cm.UploadBatchID = ?
        ORDER BY s.StemTag`,
      [fileName, memberBatchID]
    );
    const byTag = Object.fromEntries(stemRows.map(r => [r.StemTag, r.PublishedStemID]));
    expect(byTag['PSID400']).toBe(treePublishedStemId);
    expect(byTag['PSID400-2']).toBe(stemPublishedStemId);
  });

  it('treats an exact same-batch commit replay as idempotent and does not duplicate rows or changelog metadata', async () => {
    const seeded = await seedValidStagedSession({ fileName: `arcgis-idempotent-${Date.now()}.xlsx` });
    const batchID = deriveArcgisCommitBatchID(seeded.importSessionId);
    const body = buildCommitBody(seeded);
    await startUploadSession('upload-session-arcgis-idem-1');

    const first = await commitPOST(buildCommitRequest(body, 'upload-session-arcgis-idem-1'));
    expect(first.status).toBe(HTTPResponses.OK);
    expect((await first.json()) as { alreadyCommitted?: boolean }).toMatchObject({ alreadyCommitted: false, batchID });
    expect(await countStagedRows(seeded.fileName, batchID)).toBe(seeded.stagedRowCount);

    await startUploadSession('upload-session-arcgis-idem-2');
    const second = await commitPOST(buildCommitRequest(body, 'upload-session-arcgis-idem-2'));
    expect(second.status).toBe(HTTPResponses.OK);
    const replayPayload = (await second.json()) as { rowCount: number; alreadyCommitted: boolean; batchID: string };
    expect(replayPayload).toMatchObject({ rowCount: seeded.stagedRowCount, alreadyCommitted: true, batchID });
    expect(await countStagedRows(seeded.fileName, batchID)).toBe(seeded.stagedRowCount);

    const sessionRow = await getImportSession(seeded.importSessionId);
    expect(sessionRow.state).toBe('committed');
    expect(sessionRow.committed_batch_id).toBe(batchID);
    expect(Number(sessionRow.committed_row_count)).toBe(seeded.stagedRowCount);
    expect(sessionRow.committed_at).toBeTruthy();

    // The replay's `alreadyCommitted` short-circuit (the claim)
    // returns before the file_upload changelog block runs at all, so only the FIRST
    // call's uploadSessionID ever produces a RecordID (#507: buildFileUploadChangelogRecordID
    // keys by attempt, not by fileName alone — a plain-filename lookup silently matches 0 rows).
    const fileUploadRecordID = buildFileUploadChangelogRecordID(seeded.fileName, 'upload-session-arcgis-idem-1');
    const [changelogRows] = await connection.query<RowDataPacket[]>(
      `SELECT NewRowState
         FROM unifiedchangelog
        WHERE TableName = 'file_upload' AND RecordID = ? AND CensusID = ?`,
      [fileUploadRecordID, seeded.censusID]
    );
    expect(changelogRows).toHaveLength(1);
    const metadata = typeof changelogRows[0].NewRowState === 'string' ? JSON.parse(changelogRows[0].NewRowState) : changelogRows[0].NewRowState;
    expect(metadata.rowCount).toBe(seeded.stagedRowCount);
    expect(metadata.batchCount).toBe(1);
  });

  // Worker-style direct call (Task 10 in-process worker): no HTTP request, no
  // auth/ownership guards — commitArcgisImport is invoked exactly as the
  // background worker will invoke it, and a same-batch retry must be a no-op.
  it('commitArcgisImport called directly twice: second call returns alreadyCommitted, stages/audits/changelogs nothing new (#507)', async () => {
    // Keep the fixture name within temporarymeasurements.FileID's canonical width
    // or INSERT IGNORE silently truncates it and count-by-FileID finds nothing.
    const seeded = await seedValidStagedSession({ fileName: `arc-direct-${Date.now()}.xlsx` });
    const batchID = deriveArcgisCommitBatchID(seeded.importSessionId);
    const connectionManager = ConnectionManager.getInstance();
    const uploadSessionID = 'worker-session-direct-idem';
    await startUploadSession(uploadSessionID);
    const params = {
      schema: seeded.schema,
      plotID: seeded.plotID,
      censusID: seeded.censusID,
      importSessionId: seeded.importSessionId,
      fileName: seeded.fileName,
      uploadMode: UploadMode.REVISIONS,
      userId: AUTH_USER_EMAIL,
      uploadSessionID
    };

    const first = await commitArcgisImport(connectionManager, params);
    expect(first).toEqual({ rowCount: seeded.stagedRowCount, fileName: seeded.fileName, alreadyCommitted: false, batchID });
    expect(await countStagedRows(seeded.fileName, batchID)).toBe(seeded.stagedRowCount);

    const [coreCountBefore] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM coremeasurements WHERE UploadFileID = ?', [
      seeded.fileName
    ]);
    const [auditCountBefore] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND RecordID IN (SELECT CoreMeasurementID FROM coremeasurements WHERE UploadFileID = ?)`,
      [seeded.fileName]
    );
    const [changelogBefore] = await connection.query<RowDataPacket[]>(
      `SELECT NewRowState FROM unifiedchangelog WHERE TableName = 'file_upload' AND RecordID = ?`,
      [`${seeded.fileName}::${uploadSessionID}`]
    );
    const metadataBefore = typeof changelogBefore[0].NewRowState === 'string' ? JSON.parse(changelogBefore[0].NewRowState) : changelogBefore[0].NewRowState;

    const second = await commitArcgisImport(connectionManager, params);
    expect(second).toEqual({ rowCount: seeded.stagedRowCount, fileName: seeded.fileName, alreadyCommitted: true, batchID });

    // The retry must NOT have inserted any additional temporarymeasurements rows.
    expect(await countStagedRows(seeded.fileName, batchID)).toBe(seeded.stagedRowCount);

    // #507: the claim's alreadyCommitted short-circuit
    // must prevent the dropped-row diff/audit AND the file_upload changelog
    // merge code paths from running at all on replay — proven by exact counts
    // and byte-identical metadata, not merely asserted.
    const [coreCountAfter] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM coremeasurements WHERE UploadFileID = ?', [
      seeded.fileName
    ]);
    expect(Number(coreCountAfter[0].count), 'a replay must create zero new coremeasurements rows').toBe(Number(coreCountBefore[0].count));

    const [auditCountAfter] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND RecordID IN (SELECT CoreMeasurementID FROM coremeasurements WHERE UploadFileID = ?)`,
      [seeded.fileName]
    );
    expect(Number(auditCountAfter[0].count), 'a replay must write zero new coremeasurements audit rows').toBe(Number(auditCountBefore[0].count));

    const [changelogAfter] = await connection.query<RowDataPacket[]>(
      `SELECT NewRowState FROM unifiedchangelog WHERE TableName = 'file_upload' AND RecordID = ?`,
      [`${seeded.fileName}::${uploadSessionID}`]
    );
    expect(changelogAfter, 'a replay must not create a second file_upload changelog row').toHaveLength(1);
    const metadataAfter = typeof changelogAfter[0].NewRowState === 'string' ? JSON.parse(changelogAfter[0].NewRowState) : changelogAfter[0].NewRowState;
    expect(metadataAfter, 'a replay must leave the summary metadata byte-identical').toEqual(metadataBefore);

    const sessionRow = await getImportSession(seeded.importSessionId);
    expect(sessionRow.state).toBe('committed');
    expect(sessionRow.committed_batch_id).toBe(batchID);
    expect(Number(sessionRow.committed_row_count)).toBe(seeded.stagedRowCount);
  });

  // -------------------------------------------------------------------------
  // #507: dropped-row audit — temporarymeasurements has no unique key (same
  // documented reality as the CSV path's own drop-fixture test), so a real
  // INSERT IGNORE collision cannot occur naturally. The spy below strips one
  // row's VALUES tuple from the staging INSERT before it reaches the server —
  // exactly what a duplicate-key collision would do to the statement's
  // effect — so every downstream step (count diff, candidate detection,
  // failure-row persistence, and its audit) still runs for real.
  // -------------------------------------------------------------------------

  const AUDIT_FAILURE_MESSAGE = 'Simulated unifiedchangelog write failure for an ArcGIS dropped row';
  const PRIOR_CENSUS_ROW_COUNT = 3;
  const DUPLICATE_SOURCE_ROW_COUNT = 3;

  /**
   * Strips the dropped tag's tuple from every staging INSERT before it reaches the server — what a duplicate-key
   * collision does to the statement's effect — so the count diff, candidate detection, failure-row persistence and its
   * audit all still run for real. `shouldFailAudit` makes the failure-row audit INSERT throw while it returns true.
   */
  function spyOnStagingWindow(connectionManager: ConnectionManager, droppedTreeTag: string, shouldFailAudit: () => boolean = () => false) {
    const realExecuteQuery = connectionManager.executeQuery.bind(connectionManager);
    return vi.spyOn(connectionManager, 'executeQuery').mockImplementation(async (query: string, params?: unknown[], transactionId?: string) => {
      // recordAuditedIngestionFailureRows writes its INSERT audit row via recordSnapshotRowsAudit
      // (lib/changelog/ingestion-audit.ts); OldRowState and NewRowState together are unique to that statement among
      // every other unifiedchangelog write a commit issues.
      const isFailureRowAudit = query.includes('.unifiedchangelog') && query.includes('OldRowState') && query.includes('NewRowState');
      if (isFailureRowAudit && shouldFailAudit()) throw new Error(AUDIT_FAILURE_MESSAGE);
      const withoutDroppedTuple = dropStagingTupleWithTreeTag(query, params ?? [], droppedTreeTag);
      if (withoutDroppedTuple) return realExecuteQuery(withoutDroppedTuple.sql, withoutDroppedTuple.params, transactionId);
      return realExecuteQuery(query, params, transactionId);
    });
  }

  function buildDirectCommitParams(seeded: Awaited<ReturnType<typeof seedValidStagedSession>>, uploadSessionID: string, uploadMode = UploadMode.REVISIONS) {
    return { ...buildCommitBody(seeded, uploadMode), userId: AUTH_USER_EMAIL, uploadSessionID };
  }

  it('persists a dropped ArcGIS row as an unresolved ingestion error and audits it as a real INSERT (#507)', async () => {
    const DROPPED_TREE_TAG = 'N300'; // seedValidStagedSession's tree row
    const seeded = await seedValidStagedSession({ fileName: `arc-dropped-${Date.now()}.xlsx` });
    const uploadSessionID = 'worker-session-dropped';
    await startUploadSession(uploadSessionID);
    const connectionManager = ConnectionManager.getInstance();
    const executeQuerySpy = spyOnStagingWindow(connectionManager, DROPPED_TREE_TAG);

    try {
      const result = await commitArcgisImport(connectionManager, buildDirectCommitParams(seeded, uploadSessionID));
      console.log(`[arcgis-dropped] rowCount=${result.rowCount} alreadyCommitted=${result.alreadyCommitted} batchID=${result.batchID}`);
      expect(result.alreadyCommitted).toBe(false);
      expect(result.rowCount).toBe(seeded.stagedRowCount - 1);

      const [failedRows] = await connection.query<RowDataPacket[]>(
        `SELECT CoreMeasurementID, RawTreeTag FROM coremeasurements WHERE StemGUID IS NULL AND RawTreeTag = ? AND UploadFileID = ?`,
        [DROPPED_TREE_TAG, seeded.fileName]
      );
      expect(failedRows, 'the dropped row must be recorded as an unresolved ingestion error').toHaveLength(1);

      const [auditRows] = await connection.query<RowDataPacket[]>(
        `SELECT Operation, NewRowState FROM unifiedchangelog WHERE TableName = 'coremeasurements' AND RecordID = ?`,
        [failedRows[0].CoreMeasurementID]
      );
      console.log(`[arcgis-dropped] audit rows: ${JSON.stringify(auditRows)}`);
      expect(auditRows, 'the dropped ArcGIS row must have exactly one audit entry — not zero, not duplicated').toHaveLength(1);
      expect(auditRows[0].Operation).toBe('INSERT');
      const newState = typeof auditRows[0].NewRowState === 'string' ? JSON.parse(auditRows[0].NewRowState) : auditRows[0].NewRowState;
      expect(newState.RawTreeTag).toBe(DROPPED_TREE_TAG);
      expect(newState.StemGUID).toBeNull();
    } finally {
      executeQuerySpy.mockRestore();
    }
  });

  it('rolls back that staging window when the late audit of a dropped row fails, leaves the census whole, and a retry completes (#507, #561 AI13)', async () => {
    const DROPPED_TREE_TAG = 'N300';
    const seeded = await seedValidStagedSession({ fileName: `arc-late-audit-fail-${Date.now()}.xlsx` });
    const batchID = deriveArcgisCommitBatchID(seeded.importSessionId);
    const uploadSessionID = 'worker-session-late-audit-fail';
    await startUploadSession(uploadSessionID);
    await seedPriorCensusRows(connection, importScope(), PRIOR_CENSUS_ROW_COUNT);
    const connectionManager = ConnectionManager.getInstance();
    let auditShouldFail = true;
    const executeQuerySpy = spyOnStagingWindow(connectionManager, DROPPED_TREE_TAG, () => auditShouldFail);
    const params = buildDirectCommitParams(seeded, uploadSessionID, UploadMode.CLEAN_REUPLOAD);

    try {
      await expect(commitArcgisImport(connectionManager, params)).rejects.toThrow(AUDIT_FAILURE_MESSAGE);

      const afterFailure = await getImportSession(seeded.importSessionId);
      const cursorAfterFailure = Number((await readImportRow(connection, seeded.importSessionId)).staging_next_row_index);
      console.log(`[arcgis-late-audit] after failure: state=${afterFailure.state} cursor=${cursorAfterFailure}`);
      expect(await countStagedRows(seeded.fileName, batchID), 'a failed late audit must roll back the whole staging window').toBe(0);
      expect(
        await countFamilyFailureRows(connection, seeded.fileName, batchID, seeded.censusID),
        'the dropped-row failure row rolled back with its audit'
      ).toBe(0);
      expect(cursorAfterFailure, 'the cursor moves only with a window that fully committed').toBe(0);
      expect(await countCensusRowsOutsideFamily(connection, seeded.censusID, batchID), 'staging fails before the census is replaced').toBe(
        PRIOR_CENSUS_ROW_COUNT
      );
      expect(afterFailure.state, 'the claim committed on its own, so the import stays resumable').toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTING);

      auditShouldFail = false;
      const retry = await commitArcgisImport(connectionManager, params);
      console.log(`[arcgis-late-audit] retry: ${JSON.stringify(retry)}`);
      expect(retry).toEqual({ rowCount: seeded.stagedRowCount - 1, fileName: seeded.fileName, alreadyCommitted: false, batchID });
      expect(await countStagedRows(seeded.fileName, batchID)).toBe(seeded.stagedRowCount - 1);
      expect(await countFamilyFailureRows(connection, seeded.fileName, batchID, seeded.censusID)).toBe(1);
      expect(await countCensusRowsOutsideFamily(connection, seeded.censusID, batchID), 'the finished clean re-upload replaced the prior census').toBe(0);
      expect((await getImportSession(seeded.importSessionId)).state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTED);
    } finally {
      executeQuerySpy.mockRestore();
    }
  });

  it('refuses a window whose dropped row is identical to an earlier staged row with 422, rolling the window back and leaving the census whole (#561 AI13)', async () => {
    const DUPLICATED_TREE_TAG = 'DUP0';
    const scope = importScope();
    const sourceRows = buildArcgisImportRows(scope, DUPLICATE_SOURCE_ROW_COUNT, 'DUP');
    sourceRows[1] = { ...sourceRows[0] };
    const fileName = `arc-identical-drop-${Date.now()}.xlsx`;
    const importReference = await createArcgisImportSession({
      schema: scope.schema,
      plotID: scope.plotID,
      censusID: scope.censusID,
      userId: AUTH_USER_EMAIL,
      fileName,
      result: {
        rows: sourceRows,
        warnings: [],
        summary: {
          treesTransformed: DUPLICATE_SOURCE_ROW_COUNT,
          stemsJoined: 0,
          blankQuadratCount: 0,
          tagMismatchCount: 0,
          orphanStemsEmitted: 0,
          duplicateTreeTags: 0,
          duplicateGlobalIds: 0,
          missingRequired: 0,
          totalRows: DUPLICATE_SOURCE_ROW_COUNT
        }
      }
    });
    const batchID = deriveArcgisCommitBatchID(importReference.importSessionId);
    const uploadSessionID = 'upload-session-arcgis-identical-drop';
    await startUploadSession(uploadSessionID);
    await seedPriorCensusRows(connection, scope, PRIOR_CENSUS_ROW_COUNT);
    const connectionManager = ConnectionManager.getInstance();
    // Two source rows share every matched column, so dropping either leaves a staged twin and the dropped one has no candidate.
    const executeQuerySpy = spyOnStagingWindow(connectionManager, DUPLICATED_TREE_TAG);

    try {
      const response = await commitPOST(
        buildCommitRequest(
          {
            schema: scope.schema,
            plotID: scope.plotID,
            censusID: scope.censusID,
            importSessionId: importReference.importSessionId,
            fileName,
            uploadMode: UploadMode.CLEAN_REUPLOAD
          },
          uploadSessionID
        )
      );
      const payload = (await response.json()) as { error: string };
      const cursor = Number((await readImportRow(connection, importReference.importSessionId)).staging_next_row_index);
      console.log(`[arcgis-identical-drop] status=${response.status} error=${payload.error} cursor=${cursor}`);

      expect(response.status).toBe(HTTPResponses.UNPROCESSABLE_ENTITY);
      expect(payload.error).toContain(
        new ArcgisStagingAccountingError({
          importSessionId: importReference.importSessionId,
          firstRowIndex: 0,
          sourceRows: DUPLICATE_SOURCE_ROW_COUNT,
          insertedRows: DUPLICATE_SOURCE_ROW_COUNT - 1,
          droppedCandidates: 0,
          persistedFailureRows: 0
        }).message
      );
      expect(await countStagedRows(fileName, batchID), 'the unaccounted window rolled back').toBe(0);
      expect(await countFamilyFailureRows(connection, fileName, batchID, scope.censusID)).toBe(0);
      expect(cursor).toBe(0);
      expect(await countCensusRowsOutsideFamily(connection, scope.censusID, batchID), 'staging fails before the census is replaced').toBe(
        PRIOR_CENSUS_ROW_COUNT
      );
      expect((await getImportSession(importReference.importSessionId)).state).toBe(ARCGIS_IMPORT_SESSION_STATE.COMMITTING);
    } finally {
      executeQuerySpy.mockRestore();
    }
  });

  /** Everything a rejected commit must leave exactly as it found it (AI12): staged rows, the prior census, the import's state. */
  async function expectCommitLeftNothingBehind(seeded: { importSessionId: string; fileName: string; censusID: number }, priorCensusRowCount: number) {
    const stagedRows = await countAllStagedRows(seeded.fileName);
    const priorRowsRemaining = await countCensusRowsOutsideFamily(connection, seeded.censusID, deriveArcgisCommitBatchID(seeded.importSessionId));
    const importRow = await readImportRow(connection, seeded.importSessionId);
    console.log(
      `[arcgis-rejected] stagedRows=${stagedRows} priorCensusRows=${priorRowsRemaining} state=${importRow.state} cursor=${importRow.staging_next_row_index}`
    );
    expect(stagedRows, 'a rejected commit must stage nothing').toBe(0);
    expect(priorRowsRemaining, 'a rejected commit must leave the prior census rows untouched').toBe(priorCensusRowCount);
    expect(importRow.state, 'a rejected commit must leave the import at preflight').toBe(ARCGIS_IMPORT_SESSION_STATE.PREFLIGHT);
    expect(Number(importRow.staging_next_row_index)).toBe(0);
  }

  async function countAllStagedRows(fileName: string): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ?`, [fileName]);
    return Number(rows[0].total);
  }

  // arcgis_import_sessions.file_id is varchar(255), wider than the varchar(50)
  // FileID chain the commit stages into. A session captured before the length
  // contract existed must fail with a readable error at the write boundary
  // rather than ER_DATA_TOO_LONG part-way through the commit.
  it('commitArcgisImport refuses a stored session whose file name exceeds the FileID contract, staging nothing', async () => {
    const overLengthName = `${'a'.repeat(47)}.xlsx`;
    expect(overLengthName.length).toBeGreaterThan(MAX_MEASUREMENT_FILE_ID_LENGTH);

    const seeded = await seedValidStagedSession({ fileName: overLengthName });
    const batchID = deriveArcgisCommitBatchID(seeded.importSessionId);
    const uploadSessionID = 'worker-session-too-long';
    await startUploadSession(uploadSessionID);
    await seedPriorCensusRows(connection, importScope(), PRIOR_CENSUS_ROW_COUNT);

    await expect(
      commitArcgisImport(ConnectionManager.getInstance(), buildDirectCommitParams(seeded, uploadSessionID, UploadMode.CLEAN_REUPLOAD))
    ).rejects.toThrow(/50 characters or fewer/);

    expect(await countStagedRows(seeded.fileName, batchID)).toBe(0);
    // ...and the refusal must leave the session uploadable so the user can run a
    // fresh preflight after renaming the file.
    await expectCommitLeftNothingBehind(seeded, PRIOR_CENSUS_ROW_COUNT);
  });

  // Since #561 the route takes no batch from the UI; the library still shape-checks a batch the worker's pre-deploy
  // catalog entries may carry. Each row stages under `<batchID>__subNNN` and BatchID is varchar(36), so an original
  // ID with no room for the suffix is refused as a client error up front.
  it('commitArcgisImport rejects a sent batch ID too long for a sub-batch suffix with 400 INVALID_REQUEST and stages nothing', async () => {
    const seeded = await seedValidStagedSession({ fileName: `arc-longbatch-${Date.now()}.xlsx` });
    const overLongBatchID = 'b'.repeat(MAX_ORIGINAL_BATCH_ID_LENGTH + 1);
    const uploadSessionID = 'worker-session-long-batch';
    await startUploadSession(uploadSessionID);
    await seedPriorCensusRows(connection, importScope(), PRIOR_CENSUS_ROW_COUNT);

    const refusal = await commitArcgisImport(ConnectionManager.getInstance(), {
      ...buildDirectCommitParams(seeded, uploadSessionID, UploadMode.CLEAN_REUPLOAD),
      batchID: overLongBatchID
    }).then(
      () => null,
      (error: unknown) => error
    );
    console.log(`[arcgis-long-batch] refusal=${refusal instanceof Error ? `${refusal.name}: ${refusal.message}` : String(refusal)}`);

    expect(refusal).toBeInstanceOf(ArcgisImportSessionError);
    expect((refusal as ArcgisImportSessionError).status).toBe(HTTPResponses.INVALID_REQUEST);
    expect((refusal as ArcgisImportSessionError).message).toContain(`at most ${MAX_ORIGINAL_BATCH_ID_LENGTH}`);
    expect(await countStagedRows(seeded.fileName, overLongBatchID)).toBe(0);
    await expectCommitLeftNothingBehind(seeded, PRIOR_CENSUS_ROW_COUNT);
  });

  it('refuses a stale page that sends a random batch ID with 409, writing nothing and leaving the import at preflight (#561 M4)', async () => {
    const seeded = await seedValidStagedSession({ fileName: `arcgis-stale-batch-${Date.now()}.xlsx` });
    const staleBatchID = `arc_stale_${Date.now()}`;
    const uploadSessionID = 'upload-session-arcgis-stale-batch';
    await startUploadSession(uploadSessionID);
    await seedPriorCensusRows(connection, importScope(), PRIOR_CENSUS_ROW_COUNT);

    const response = await commitPOST(buildCommitRequest({ ...buildCommitBody(seeded, UploadMode.CLEAN_REUPLOAD), batchID: staleBatchID }, uploadSessionID));
    const payload = (await response.json()) as { error: string };
    console.log(`[arcgis-stale-batch] status=${response.status} error=${payload.error}`);

    expect(response.status).toBe(HTTPResponses.CONFLICT);
    expect(payload.error).toContain('Reload the page');
    expect(await countStagedRows(seeded.fileName, staleBatchID)).toBe(0);
    await expectCommitLeftNothingBehind(seeded, PRIOR_CENSUS_ROW_COUNT);
  });

  it('replays a committed session with any batch as alreadyCommitted under its stored derived batch, staging nothing new (#561 AI14)', async () => {
    const seeded = await seedValidStagedSession({ fileName: `arcgis-replay-${Date.now()}.xlsx` });
    const batchID = deriveArcgisCommitBatchID(seeded.importSessionId);
    const firstUploadSessionID = 'upload-session-arcgis-replay-1';
    await startUploadSession(firstUploadSessionID);

    const first = await commitPOST(buildCommitRequest(buildCommitBody(seeded), firstUploadSessionID));
    expect(first.status).toBe(HTTPResponses.OK);
    expect(await countStagedRows(seeded.fileName, batchID)).toBe(seeded.stagedRowCount);

    const replaySession = async (uploadSessionID: string, body: Record<string, unknown>) => {
      await startUploadSession(uploadSessionID);
      const response = await commitPOST(buildCommitRequest(body, uploadSessionID));
      return { status: response.status, payload: (await response.json()) as { alreadyCommitted: boolean; batchID: string; rowCount: number } };
    };
    const withoutBatch = await replaySession('upload-session-arcgis-replay-2', buildCommitBody(seeded));
    const withDerivedBatch = await replaySession('upload-session-arcgis-replay-3', { ...buildCommitBody(seeded), batchID });
    console.log(`[arcgis-replay] withoutBatch=${JSON.stringify(withoutBatch)} withDerivedBatch=${JSON.stringify(withDerivedBatch)}`);
    for (const replay of [withoutBatch, withDerivedBatch]) {
      expect(replay.status).toBe(HTTPResponses.OK);
      expect(replay.payload).toMatchObject({ alreadyCommitted: true, batchID, rowCount: seeded.stagedRowCount });
    }

    // The library keeps no opinion on a sent batch once the session is committed with a recorded mode: the worker's
    // pre-deploy catalog entries may carry any batch, and all of them replay.
    const otherBatchID = `arc_rp_other_${Date.now()}`;
    const workerReplay = await commitArcgisImport(ConnectionManager.getInstance(), {
      ...buildDirectCommitParams(seeded, 'upload-session-arcgis-replay-4'),
      batchID: otherBatchID
    });
    expect(workerReplay).toEqual({ rowCount: seeded.stagedRowCount, fileName: seeded.fileName, alreadyCommitted: true, batchID });

    expect(await countStagedRows(seeded.fileName, batchID)).toBe(seeded.stagedRowCount);
    expect(await countStagedRows(seeded.fileName, otherBatchID)).toBe(0);
    const sessionRow = await getImportSession(seeded.importSessionId);
    expect(sessionRow.committed_batch_id).toBe(batchID);
    expect(Number(sessionRow.committed_row_count)).toBe(seeded.stagedRowCount);
  });

  it('keeps a stale page from replaying a committed session with a random batch (409), without disturbing the commit (#561 M4)', async () => {
    const seeded = await seedValidStagedSession({ fileName: `arcgis-replay-stale-${Date.now()}.xlsx` });
    const batchID = deriveArcgisCommitBatchID(seeded.importSessionId);
    await startUploadSession('upload-session-arcgis-replay-stale-1');
    const first = await commitPOST(buildCommitRequest(buildCommitBody(seeded), 'upload-session-arcgis-replay-stale-1'));
    expect(first.status).toBe(HTTPResponses.OK);

    const staleBatchID = `arc_replay_stale_${Date.now()}`;
    await startUploadSession('upload-session-arcgis-replay-stale-2');
    const second = await commitPOST(buildCommitRequest({ ...buildCommitBody(seeded), batchID: staleBatchID }, 'upload-session-arcgis-replay-stale-2'));

    expect(second.status).toBe(HTTPResponses.CONFLICT);
    expect(await countStagedRows(seeded.fileName, staleBatchID)).toBe(0);
    expect(await countStagedRows(seeded.fileName, batchID)).toBe(seeded.stagedRowCount);
    expect((await getImportSession(seeded.importSessionId)).committed_batch_id).toBe(batchID);
  });

  it('replays a session committed before #561 (no recorded mode) only with its stored client batch, through the route (#561 AI14 legacy)', async () => {
    const seeded = await seedValidStagedSession({ fileName: `arcgis-legacy-${Date.now()}.xlsx` });
    const derivedBatchID = deriveArcgisCommitBatchID(seeded.importSessionId);
    await startUploadSession('upload-session-arcgis-legacy-1');
    const first = await commitPOST(buildCommitRequest(buildCommitBody(seeded), 'upload-session-arcgis-legacy-1'));
    expect(first.status).toBe(HTTPResponses.OK);

    const legacyClientBatchID = `arc_legacy_${Date.now()}`;
    await connection.query(`UPDATE arcgis_import_sessions SET committed_upload_mode = NULL, committed_batch_id = ? WHERE import_session_id = ?`, [
      legacyClientBatchID,
      seeded.importSessionId
    ]);

    const replayStoredBatch = await commitPOST(
      buildCommitRequest({ ...buildCommitBody(seeded), batchID: legacyClientBatchID }, await startedUploadSession('upload-session-arcgis-legacy-2'))
    );
    const replayPayload = (await replayStoredBatch.json()) as { alreadyCommitted: boolean; batchID: string; rowCount: number };
    console.log(`[arcgis-legacy] storedBatchReplay=${replayStoredBatch.status} ${JSON.stringify(replayPayload)}`);
    expect(replayStoredBatch.status).toBe(HTTPResponses.OK);
    expect(replayPayload).toMatchObject({ alreadyCommitted: true, batchID: legacyClientBatchID, rowCount: seeded.stagedRowCount });

    const otherBatchID = `arc_legacy_other_${Date.now()}`;
    const replayOtherBatch = await commitPOST(
      buildCommitRequest({ ...buildCommitBody(seeded), batchID: otherBatchID }, await startedUploadSession('upload-session-arcgis-legacy-3'))
    );
    expect(replayOtherBatch.status, 'a batch that is neither the derived id nor the stored legacy batch is a stale page').toBe(HTTPResponses.CONFLICT);

    const replayWithoutBatch = await commitPOST(buildCommitRequest(buildCommitBody(seeded), await startedUploadSession('upload-session-arcgis-legacy-4')));
    expect(replayWithoutBatch.status, 'a legacy commit has no derived batch to fall back to').toBe(HTTPResponses.CONFLICT);

    expect(await countStagedRows(seeded.fileName, otherBatchID)).toBe(0);
    expect(await countStagedRows(seeded.fileName, derivedBatchID)).toBe(seeded.stagedRowCount);
    expect((await getImportSession(seeded.importSessionId)).committed_batch_id).toBe(legacyClientBatchID);
  });

  it('rejects a commit when the upload-session guard fails and stages no rows', async () => {
    const seeded = await seedValidStagedSession({ fileName: `arcgis-upload-session-${Date.now()}.xlsx` });
    await seedPriorCensusRows(connection, importScope(), PRIOR_CENSUS_ROW_COUNT);
    uploadSessionState.requireOwnership = async () => {
      throw new UploadSessionOwnershipError('Upload session does not own this ArcGIS commit', HTTPResponses.CONFLICT);
    };

    const response = await commitPOST(
      buildCommitRequest(buildCommitBody(seeded, UploadMode.CLEAN_REUPLOAD), await startedUploadSession('upload-session-arcgis-guard-fail'))
    );

    expect(response.status).toBe(HTTPResponses.CONFLICT);
    await expectCommitLeftNothingBehind(seeded, PRIOR_CENSUS_ROW_COUNT);
  });

  it('rejects a commit when the staged session belongs to a DIFFERENT user (403 FORBIDDEN) and stages no rows', async () => {
    // The auth mock authenticates as AUTH_USER_EMAIL, so the resolved scope.userId
    // is AUTH_USER_EMAIL. Seed the session under a foreign owner so the claim's
    // `session.user_id !== input.userId` check trips.
    const foreignOwner = 'someone-else@example.com';
    const seeded = await seedValidStagedSession({ userId: foreignOwner });
    await seedPriorCensusRows(connection, importScope(), PRIOR_CENSUS_ROW_COUNT);

    const response = await commitPOST(
      buildCommitRequest(buildCommitBody(seeded, UploadMode.CLEAN_REUPLOAD), await startedUploadSession('upload-session-arcgis-neg-wronguser'))
    );

    expect(response.status).toBe(HTTPResponses.FORBIDDEN);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain('does not belong to the authenticated user');
    await expectCommitLeftNothingBehind(seeded, PRIOR_CENSUS_ROW_COUNT);
  });

  it('rejects a commit when the body plot/census scope does NOT match the staged session (409 CONFLICT) and stages no rows', async () => {
    const seeded = await seedValidStagedSession();
    await seedPriorCensusRows(connection, importScope(), PRIOR_CENSUS_ROW_COUNT);

    // The scope guard (assertCanEditMeasurementScope) runs BEFORE the staged-session
    // scope check and rejects a non-existent census with 403, so to reach the
    // ArcgisImportSessionError "scope does not match" (409) path the body must name
    // a census that genuinely EXISTS and is editable, yet differs from the one the
    // session was staged against. Create a second active census on the same plot.
    // beforeEach's cleanupTestMeasurements deletes any census beyond testData (1),
    // so this extra census is torn down before the next test.
    await connection.query(`INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate) VALUES (?, 2, '2025-01-01', '2025-12-31')`, [seeded.plotID]);
    const [secondCensusRows] = await connection.query<RowDataPacket[]>('SELECT CensusID FROM census WHERE PlotID = ? AND PlotCensusNumber = 2', [
      seeded.plotID
    ]);
    const mismatchedCensusID = Number(secondCensusRows[0].CensusID);
    expect(mismatchedCensusID).not.toBe(seeded.censusID);
    const uploadSessionID = 'upload-session-arcgis-neg-scope';
    await startActiveUploadSession(connection, { ...importScope(), censusID: mismatchedCensusID }, uploadSessionID);

    const response = await commitPOST(
      buildCommitRequest({ ...buildCommitBody(seeded, UploadMode.CLEAN_REUPLOAD), censusID: mismatchedCensusID }, uploadSessionID)
    );

    expect(response.status).toBe(HTTPResponses.CONFLICT);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain('scope does not match');
    await expectCommitLeftNothingBehind(seeded, PRIOR_CENSUS_ROW_COUNT);
  });

  it('rejects a commit when the body fileName does NOT match the staged session file (409 CONFLICT) and stages no rows', async () => {
    const seeded = await seedValidStagedSession();
    await seedPriorCensusRows(connection, importScope(), PRIOR_CENSUS_ROW_COUNT);
    const mismatchedFileName = `not-the-staged-file-${Date.now()}.xlsx`;

    const response = await commitPOST(
      buildCommitRequest(
        { ...buildCommitBody(seeded, UploadMode.CLEAN_REUPLOAD), fileName: mismatchedFileName },
        await startedUploadSession('upload-session-arcgis-neg-file')
      )
    );

    expect(response.status).toBe(HTTPResponses.CONFLICT);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain('file does not match');

    // Nothing staged under EITHER the staged file or the mismatched body file.
    expect(await countAllStagedRows(mismatchedFileName)).toBe(0);
    await expectCommitLeftNothingBehind(seeded, PRIOR_CENSUS_ROW_COUNT);
  });

  it('rejects a commit for a session with ZERO staged rows (422 UNPROCESSABLE_ENTITY) and stages no rows', async () => {
    const schema = config.database;
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const fileName = `arcgis-empty-${Date.now()}.xlsx`;

    // Seed a session with NO staged rows. createArcgisImportSession simply skips
    // its row-insert loop when result.rows is empty, producing a row_count=0
    // session — the exact 0-row state the commit route must reject with 422.
    const emptyResult: TransformResult = {
      rows: [],
      warnings: [],
      summary: {
        treesTransformed: 0,
        stemsJoined: 0,
        blankQuadratCount: 0,
        tagMismatchCount: 0,
        orphanStemsEmitted: 0,
        duplicateTreeTags: 0,
        duplicateGlobalIds: 0,
        missingRequired: 0,
        totalRows: 0
      }
    };
    const importReference = await createArcgisImportSession({
      schema,
      plotID,
      censusID,
      userId: AUTH_USER_EMAIL,
      fileName,
      result: emptyResult
    });
    expect(importReference.rowCount).toBe(0);
    await seedPriorCensusRows(connection, importScope(), PRIOR_CENSUS_ROW_COUNT);
    const emptySession = { importSessionId: importReference.importSessionId, fileName, plotID, censusID, schema };

    const response = await commitPOST(
      buildCommitRequest(buildCommitBody(emptySession, UploadMode.CLEAN_REUPLOAD), await startedUploadSession('upload-session-arcgis-neg-empty'))
    );

    expect(response.status).toBe(HTTPResponses.UNPROCESSABLE_ENTITY);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain('contains no rows');
    await expectCommitLeftNothingBehind(emptySession, PRIOR_CENSUS_ROW_COUNT);
  });
});
