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
  transactionCounter: 0
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
    withTransaction: async <T>(fn: (transactionID: string) => Promise<T>) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      await sharedState.connection.beginTransaction();
      sharedState.transactionCounter += 1;
      const txID = `${TRANSACTION_ID_PREFIX}${sharedState.transactionCounter}`;
      sharedState.activeTransactionID = txID;
      try {
        const result = await fn(txID);
        await sharedState.connection.commit();
        sharedState.activeTransactionID = null;
        return result;
      } catch (err) {
        await sharedState.connection.rollback();
        sharedState.activeTransactionID = null;
        throw err;
      }
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
// (real Azure DB) — short-circuit ownership to a no-op so the commit route's
// upload-session guard is satisfied without an external session row.
vi.mock('@/config/uploadsessiontracker', async () => {
  const actual = await vi.importActual<typeof import('@/config/uploadsessiontracker')>('@/config/uploadsessiontracker');
  return {
    ...actual,
    requireUploadSessionOwnership: async () => ({ sessionId: 'mock-upload-session' })
  };
});

// Route handler + session loader imported AFTER vi.mock so the mocks are wired.
import { POST as commitPOST } from '@/app/api/arcgis/commit/route';
import { createArcgisImportSession } from '@/lib/arcgis/import-session';
import { UploadMode } from '@/config/uploadmodes';
import { HTTPResponses } from '@/config/macros';

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
    await cleanupTestMeasurements(connection, testData);
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

    const batchID = `arcgis_commit_batch_${Date.now()}`;
    const uploadSessionId = 'upload-session-arcgis-commit';

    const response = await commitPOST(
      buildCommitRequest(
        {
          schema,
          plotID,
          censusID,
          importSessionId: importReference.importSessionId,
          fileName,
          batchID,
          uploadMode: UploadMode.REVISIONS
        },
        uploadSessionId
      )
    );

    expect(response.status).toBe(HTTPResponses.OK);
    const payload = (await response.json()) as { rowCount: number; fileName: string };
    expect(payload.fileName).toBe(fileName);
    expect(payload.rowCount).toBe(stagedRowCount);

    // The staged rows must physically land in temporarymeasurements under the
    // committed FileID/BatchID with the arcgis_xlsx provenance tag.
    const [countRows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ? AND BatchID = ? AND SourceFormat = 'arcgis_xlsx'`,
      [fileName, batchID]
    );
    expect(Number(countRows[0].total)).toBe(stagedRowCount);

    // And nothing leaked under the same File/Batch without the provenance tag.
    const [totalRows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ? AND BatchID = ?`, [
      fileName,
      batchID
    ]);
    expect(Number(totalRows[0].total)).toBe(stagedRowCount);

    // Audit-trail parity with the CSV measurements path: the commit must write a
    // single file_upload row into unifiedchangelog so the upload appears in the
    // upload-history UI, carrying arcgis_xlsx provenance and the inserted rowCount.
    const [changelogRows] = await connection.query<RowDataPacket[]>(
      `SELECT ChangedBy, PlotID, CensusID, NewRowState
         FROM unifiedchangelog
        WHERE TableName = 'file_upload' AND RecordID = ? AND CensusID = ?`,
      [fileName, censusID]
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
  });
});
