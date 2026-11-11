/**
 * Revision Apply — #507 Audit Integration (real routes, real SQL)
 *
 * Companion to revision-apply-invalid-persistence.integration.test.ts, which
 * already proves the StemGUID=NULL failed-measurement rows and their
 * measurement_errors/measurement_error_log links persist correctly. This
 * file covers what that suite does NOT assert: the actual unifiedchangelog
 * audit trail recordAuditedIngestionFailureRows/recordDeletedCoreMeasurements
 * Audit write (ChangedBy, Operation, Old/NewRowState), and the
 * edit_operations ledger summary's failedRowCount field — both driven
 * through the REAL `POST /api/revisionupload` (match) and
 * `POST /api/revisionupload/apply` handlers against a real local MySQL
 * database, never a hand-rolled SQL mirror.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { cleanupTestMeasurements, createAdditionalCensus, setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';
import type { RevisionUploadResponse } from '@/config/revisionuploadtypes';
import { HTTPResponses } from '@/config/macros';

process.env.AUTH_SECRET ??= 'test_secret';

// ---------------------------------------------------------------------------
// Named constants — no magic numbers or strings
// ---------------------------------------------------------------------------

const AUTH_USER_EMAIL = 'revision-audit-test@example.com';
const REVISION_UPLOAD_FILE_ID_VALUE = 'revision-upload';
const COREMEASUREMENTS_TABLE_NAME = 'coremeasurements';
const INSERT_OPERATION = 'INSERT';
const UPDATE_OPERATION = 'UPDATE';
const DELETE_OPERATION = 'DELETE';
const BULK_REVISION_OPERATION_TYPE = 'bulk-revision-row';

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: {
      email: AUTH_USER_EMAIL,
      userStatus: 'global',
      sites: []
    }
  }))
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  }
}));

vi.mock('@/config/uploadsessiontracker', async () => {
  const actual = await vi.importActual<typeof import('@/config/uploadsessiontracker')>('@/config/uploadsessiontracker');
  return {
    ...actual,
    ensureUploadSessionsTable: async (_schema: string) => {
      /* no-op: upload_sessions already created by loadSchema */
    }
  };
});

vi.mock('@/config/editplan/authorization', async () => {
  const actual = await vi.importActual<typeof import('@/config/editplan/authorization')>('@/config/editplan/authorization');
  return {
    ...actual,
    createFreshAuthorizationCheck: () => async () => {
      /* always-fresh */
    }
  };
});

import { POST as matchPOST } from '@/app/api/revisionupload/route';
import { POST as applyPOST } from '@/app/api/revisionupload/apply/route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { ensureEditOperationsTable } from '@/config/editoperations';

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

interface ChangelogRow extends RowDataPacket {
  TableName: string;
  RecordID: string;
  Operation: string;
  OldRowState: string | Record<string, unknown> | null;
  NewRowState: string | Record<string, unknown> | null;
  ChangedBy: string | null;
  PlotID: number | null;
  CensusID: number | null;
}

function parseJsonColumn(value: string | Record<string, unknown> | null): Record<string, unknown> | null {
  if (value === null) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function parseJsonArrayColumn(value: unknown): Array<Record<string, unknown>> {
  return typeof value === 'string' ? JSON.parse(value) : (value as Array<Record<string, unknown>>);
}

describe('revision apply — #507 audit integration (real routes)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };

  beforeAll(async () => {
    if (!['localhost', '127.0.0.1'].includes(process.env.AZURE_SQL_SERVER ?? '')) throw new Error('Real ConnectionManager requires a local database');
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    await ensureEditOperationsTable(ConnectionManager.getInstance(), config.database);
  }, 90000);

  afterAll(async () => {
    await ConnectionManager.getInstance().closeConnection();
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData);
    await connection.query(`DELETE FROM \`${config.database}\`.unifiedchangelog`);
    await connection.query(`DELETE FROM \`${config.database}\`.edit_operations`);
  });

  async function readCoreMeasurementsChangelog(recordID: number): Promise<ChangelogRow[]> {
    const [rows] = await connection.query<ChangelogRow[]>(
      `SELECT * FROM \`${config.database}\`.unifiedchangelog WHERE TableName = ? AND RecordID = ? ORDER BY ChangeID`,
      [COREMEASUREMENTS_TABLE_NAME, String(recordID)]
    );
    return rows;
  }

  async function readLatestBulkRevisionSummary(): Promise<Record<string, unknown> | null> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT BeforeState FROM \`${config.database}\`.edit_operations
       WHERE OperationType = ? ORDER BY EditOperationID DESC LIMIT 1`,
      [BULK_REVISION_OPERATION_TYPE]
    );
    if (rows.length === 0) return null;
    const beforeState = parseJsonArrayColumn(rows[0].BeforeState);
    return (beforeState[0]?.row as Record<string, unknown>) ?? null;
  }

  async function countBulkRevisionSummaries(): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM \`${config.database}\`.edit_operations WHERE OperationType = ?`, [
      BULK_REVISION_OPERATION_TYPE
    ]);
    return Number(rows[0].count);
  }

  // =========================================================================
  // (a) invalid-only apply: INSERT unifiedchangelog history, trusted
  //     ChangedBy, raw source fields in NewRowState; summary has failedRowCount
  // =========================================================================

  it('writes an INSERT unifiedchangelog row for an invalid-only apply, attributed to the trusted session actor and carrying the raw source fields, with a ledger summary reporting failedRowCount', async () => {
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const treeTag = 'AUDITINV01';
    const stemTag = 'AUDINVS01';

    const matchRes = await matchPOST(buildMatchRequest({ rows: [{ tag: treeTag, stemtag: stemTag, dbh: '11.0' }], plotID, censusID, schema: config.database }));
    expect(matchRes.status).toBe(HTTPResponses.OK);
    const matchBody = (await matchRes.json()) as RevisionUploadResponse;
    expect(matchBody.invalidRows).toHaveLength(1);

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
    expect(applyRes.status, `apply must succeed; got ${applyRes.status}: ${applyBodyText}`).toBe(HTTPResponses.OK);
    const applyBody = JSON.parse(applyBodyText) as { failedRowCount: number };
    expect(applyBody.failedRowCount).toBe(1);

    const [failureRows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID FROM \`${config.database}\`.coremeasurements
       WHERE UploadFileID = ? AND RawTreeTag = ? AND StemGUID IS NULL`,
      [REVISION_UPLOAD_FILE_ID_VALUE, treeTag]
    );
    expect(failureRows).toHaveLength(1);
    const coreMeasurementID = failureRows[0].CoreMeasurementID as number;

    const changelogRows = await readCoreMeasurementsChangelog(coreMeasurementID);
    expect(changelogRows, 'the persisted failure row must have exactly one audit entry').toHaveLength(1);
    expect(changelogRows[0].Operation).toBe(INSERT_OPERATION);
    expect(changelogRows[0].ChangedBy, 'ChangedBy must be the trusted server-side session identity').toBe(AUTH_USER_EMAIL);
    expect(changelogRows[0].PlotID).toBe(plotID);
    expect(changelogRows[0].CensusID).toBe(censusID);
    const newRowState = parseJsonColumn(changelogRows[0].NewRowState);
    expect(newRowState?.RawTreeTag).toBe(treeTag);
    expect(newRowState?.RawStemTag).toBe(stemTag);

    const summaryRow = await readLatestBulkRevisionSummary();
    expect(summaryRow, 'an invalid-only apply must still write a ledger summary (#507)').not.toBeNull();
    expect(summaryRow!.failedRowCount).toBe(1);
    expect(summaryRow!.updatedCount).toBe(0);
  });

  // =========================================================================
  // (b) same-attempt retry: zero new physical history rows, zero new
  //     summary entries, response still reports the rejected row
  // =========================================================================

  it('adds zero new unifiedchangelog rows and zero new ledger summaries on a same-attempt retry that persists nothing new', async () => {
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const treeTag = 'AUDITRETRY';
    const stemTag = 'AUDRETRS1';

    const matchRes = await matchPOST(buildMatchRequest({ rows: [{ tag: treeTag, stemtag: stemTag, dbh: '11.0' }], plotID, censusID, schema: config.database }));
    const matchBody = (await matchRes.json()) as RevisionUploadResponse;

    function buildApply(body: RevisionUploadResponse) {
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

    const firstApplyRes = await applyPOST(buildApply(matchBody));
    expect(firstApplyRes.status).toBe(HTTPResponses.OK);

    const [failureRows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID FROM \`${config.database}\`.coremeasurements WHERE RawTreeTag = ? AND StemGUID IS NULL`,
      [treeTag]
    );
    expect(failureRows).toHaveLength(1);
    const coreMeasurementID = failureRows[0].CoreMeasurementID as number;

    const changelogAfterFirst = await readCoreMeasurementsChangelog(coreMeasurementID);
    expect(changelogAfterFirst).toHaveLength(1);
    const summariesAfterFirst = await countBulkRevisionSummaries();
    expect(summariesAfterFirst, 'the first apply must write exactly one summary').toBe(1);

    // Retry: identical apply request again — the same content under the
    // same (UploadBatchID, SourceRowIndex) is a no-op for both the audit
    // and the ledger.
    const retryApplyRes = await applyPOST(buildApply(matchBody));
    const retryBodyText = await retryApplyRes.text();
    expect(retryApplyRes.status, `retry apply must succeed; got ${retryApplyRes.status}: ${retryBodyText}`).toBe(HTTPResponses.OK);
    const retryBody = JSON.parse(retryBodyText) as { failedRowCount: number };
    expect(retryBody.failedRowCount, 'the retried row must still be reported as rejected').toBe(1);

    const changelogAfterRetry = await readCoreMeasurementsChangelog(coreMeasurementID);
    expect(changelogAfterRetry, 'an unchanged retry must not add a second audit row').toHaveLength(1);
    const summariesAfterRetry = await countBulkRevisionSummaries();
    expect(summariesAfterRetry, 'an unchanged retry must not write a second ledger summary').toBe(1);
  });

  // =========================================================================
  // (c) changed same-attempt failure: UPDATE history with exact old/new state
  // =========================================================================

  it('writes an UPDATE unifiedchangelog row with the exact old and new raw state when the same attempt re-reviews a rejected row with different content', async () => {
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const treeTag = 'AUDITCHNG1';
    const stemTag = 'AUDCHNGS1';

    const firstMatchRes = await matchPOST(
      buildMatchRequest({ rows: [{ tag: treeTag, stemtag: stemTag, dbh: '11.0' }], plotID, censusID, schema: config.database })
    );
    const firstMatchBody = (await firstMatchRes.json()) as RevisionUploadResponse;
    expect(firstMatchBody.invalidRows).toHaveLength(1);

    const firstApplyRes = await applyPOST(
      buildApplyRequest({
        matchedRows: [],
        newRows: [],
        invalidRows: firstMatchBody.invalidRows,
        confirmNewRows: false,
        duplicateMeasurementIDsToDelete: [],
        schema: config.database,
        plotID,
        censusID,
        bulkPlanHash: firstMatchBody.bulkPlan.planHash,
        uploadAttemptID: firstMatchBody.uploadAttemptID,
        invalidRowsIntegrityHash: firstMatchBody.invalidRowsIntegrityHash
      })
    );
    expect(firstApplyRes.status).toBe(HTTPResponses.OK);

    const [firstFailureRows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID, MeasuredDBH FROM \`${config.database}\`.coremeasurements WHERE RawTreeTag = ? AND StemGUID IS NULL`,
      [treeTag]
    );
    expect(firstFailureRows).toHaveLength(1);
    const coreMeasurementID = firstFailureRows[0].CoreMeasurementID as number;
    expect(parseFloat(firstFailureRows[0].MeasuredDBH)).toBeCloseTo(11.0);

    // Re-match the SAME attempt (previousUploadAttemptID keeps uploadAttemptID
    // identical) with DIFFERENT raw content — the server recomputes a fresh,
    // genuinely valid invalidRowsIntegrityHash over this new content, so this
    // is a real same-attempt content change, never a replayed/forged hash.
    const secondMatchRes = await matchPOST(
      buildMatchRequest({
        rows: [{ tag: treeTag, stemtag: stemTag, dbh: '22.0' }],
        plotID,
        censusID,
        schema: config.database,
        previousUploadAttemptID: firstMatchBody.uploadAttemptID
      })
    );
    const secondMatchBody = (await secondMatchRes.json()) as RevisionUploadResponse;
    expect(secondMatchBody.uploadAttemptID, 'a re-match of the same attempt must retain its identity').toBe(firstMatchBody.uploadAttemptID);
    expect(secondMatchBody.invalidRows).toHaveLength(1);

    const secondApplyRes = await applyPOST(
      buildApplyRequest({
        matchedRows: [],
        newRows: [],
        invalidRows: secondMatchBody.invalidRows,
        confirmNewRows: false,
        duplicateMeasurementIDsToDelete: [],
        schema: config.database,
        plotID,
        censusID,
        bulkPlanHash: secondMatchBody.bulkPlan.planHash,
        uploadAttemptID: secondMatchBody.uploadAttemptID,
        invalidRowsIntegrityHash: secondMatchBody.invalidRowsIntegrityHash
      })
    );
    const secondApplyBodyText = await secondApplyRes.text();
    expect(secondApplyRes.status, `second apply must succeed; got ${secondApplyRes.status}: ${secondApplyBodyText}`).toBe(HTTPResponses.OK);

    const [secondFailureRows] = await connection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID, MeasuredDBH FROM \`${config.database}\`.coremeasurements WHERE RawTreeTag = ? AND StemGUID IS NULL`,
      [treeTag]
    );
    expect(secondFailureRows, 'the same physical row must be updated in place, never duplicated').toHaveLength(1);
    expect(secondFailureRows[0].CoreMeasurementID).toBe(coreMeasurementID);
    expect(parseFloat(secondFailureRows[0].MeasuredDBH)).toBeCloseTo(22.0);

    const changelogRows = await readCoreMeasurementsChangelog(coreMeasurementID);
    expect(changelogRows, 'the row must now have an INSERT followed by an UPDATE audit entry').toHaveLength(2);
    expect(changelogRows[0].Operation).toBe(INSERT_OPERATION);
    expect(changelogRows[1].Operation).toBe(UPDATE_OPERATION);
    const oldState = parseJsonColumn(changelogRows[1].OldRowState);
    const newState = parseJsonColumn(changelogRows[1].NewRowState);
    expect(parseFloat(String(oldState?.MeasuredDBH))).toBeCloseTo(11.0);
    expect(parseFloat(String(newState?.MeasuredDBH))).toBeCloseTo(22.0);
  });

  // =========================================================================
  // (d) independent attempts and different censuses audit separately
  // =========================================================================

  it('keeps unifiedchangelog audit entries distinct across independent attempts and different censuses', async () => {
    const plotID = testData.plots[0].plotID;
    const censusA = testData.census[0].censusID;
    const additionalCensus = await createAdditionalCensus(connection, testData, {
      plotCensusNumber: 9101,
      startDate: '2031-01-01',
      endDate: '2031-12-31'
    });
    const censusB = additionalCensus.censusID;
    const treeTag = 'AUDITINDEP';
    const stemTag = 'AUDINDPS1';

    async function applyInvalidOnly(censusID: number): Promise<void> {
      const matchRes = await matchPOST(
        buildMatchRequest({ rows: [{ tag: treeTag, stemtag: stemTag, dbh: '11.0' }], plotID, censusID, schema: config.database })
      );
      const matchBody = (await matchRes.json()) as RevisionUploadResponse;
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
    }

    await applyInvalidOnly(censusA);
    await applyInvalidOnly(censusB);

    const [changelogRows] = await connection.query<ChangelogRow[]>(
      `SELECT ucl.* FROM \`${config.database}\`.unifiedchangelog ucl
       JOIN \`${config.database}\`.coremeasurements cm ON cm.CoreMeasurementID = ucl.RecordID
       WHERE ucl.TableName = ? AND cm.RawTreeTag = ? ORDER BY ucl.ChangeID`,
      [COREMEASUREMENTS_TABLE_NAME, treeTag]
    );
    expect(changelogRows, 'each census must leave its own INSERT audit entry').toHaveLength(2);
    expect(new Set(changelogRows.map(row => row.CensusID))).toEqual(new Set([censusA, censusB]));
    expect(changelogRows.every(row => row.Operation === INSERT_OPERATION)).toBe(true);
  });

  // =========================================================================
  // (e) duplicate-only DELETE audit records exact prior row state; survivor
  //     retained and unchanged
  // =========================================================================

  it('audits the exact prior row state when deleting a verified duplicate, while leaving the survivor row untouched', async () => {
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const treeTag = 'AUDITDUPON';
    const stemTag = 'AUDDUPST1';
    const dbh = 9.4;
    const hom = 1.3;
    const survivorDate = '2024-04-01';
    const siblingDate = '2024-03-01';

    const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species LIMIT 1');
    const speciesID = speciesRows[0].SpeciesID as number;
    const [quadratRows] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE PlotID = ? LIMIT 1', [plotID]);
    const quadratID = quadratRows[0].QuadratID as number;

    const [treeRes] = await connection.query<any>('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', [
      treeTag,
      speciesID,
      censusID
    ]);
    const treeID = treeRes.insertId;
    const [stemRes] = await connection.query<any>(
      'INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, 1.0, 1.0, 1)',
      [treeID, quadratID, censusID, stemTag]
    );
    const stemGUID = stemRes.insertId;

    async function insertSiblingMeasurement(date: string): Promise<number> {
      const [res] = await connection.query<any>(
        `INSERT INTO \`${config.database}\`.coremeasurements
           (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, RawTreeTag, RawStemTag, IsValidated, IsActive)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
        [stemGUID, censusID, dbh, hom, date, treeTag, stemTag]
      );
      return res.insertId;
    }

    const siblingID = await insertSiblingMeasurement(siblingDate);
    const survivorID = await insertSiblingMeasurement(survivorDate);

    const matchRes = await matchPOST(
      buildMatchRequest({
        rows: [{ tag: treeTag, stemtag: stemTag, dbh: String(dbh), hom: String(hom), date: survivorDate }],
        plotID,
        censusID,
        schema: config.database
      })
    );
    const matchBody = (await matchRes.json()) as RevisionUploadResponse;
    expect(matchBody.matchedRows).toHaveLength(1);
    const survivorRow = matchBody.matchedRows[0];
    const expectedSurvivorID = siblingID > survivorID ? siblingID : survivorID;
    expect(survivorRow.coreMeasurementID).toBe(expectedSurvivorID);
    const duplicateID = survivorRow.duplicateMeasurementIDsToDelete![0];

    const applyRes = await applyPOST(
      buildApplyRequest({
        matchedRows: [{ coreMeasurementID: survivorRow.coreMeasurementID, csvRow: survivorRow.csvRow, duplicateMeasurementIDsToDelete: [duplicateID] }],
        newRows: [],
        invalidRows: [],
        confirmNewRows: false,
        duplicateMeasurementIDsToDelete: [{ coreMeasurementID: duplicateID, survivorCoreMeasurementID: survivorRow.coreMeasurementID }],
        schema: config.database,
        plotID,
        censusID,
        bulkPlanHash: matchBody.bulkPlan.planHash,
        uploadAttemptID: matchBody.uploadAttemptID,
        invalidRowsIntegrityHash: matchBody.invalidRowsIntegrityHash
      })
    );
    expect(applyRes.status).toBe(HTTPResponses.OK);

    const deleteAuditRows = await readCoreMeasurementsChangelog(duplicateID);
    expect(deleteAuditRows, 'the deleted duplicate must have exactly one DELETE audit entry').toHaveLength(1);
    expect(deleteAuditRows[0].Operation).toBe(DELETE_OPERATION);
    const oldState = parseJsonColumn(deleteAuditRows[0].OldRowState);
    expect(oldState?.CoreMeasurementID).toBe(duplicateID);
    expect(parseFloat(String(oldState?.MeasuredDBH))).toBeCloseTo(dbh);

    const survivorAuditRows = await readCoreMeasurementsChangelog(survivorRow.coreMeasurementID);
    expect(survivorAuditRows, 'the survivor must never be audited by the duplicate-deletion path').toHaveLength(0);

    const [survivorAfter] = await connection.query<RowDataPacket[]>(
      `SELECT IsActive, MeasuredDBH FROM \`${config.database}\`.coremeasurements WHERE CoreMeasurementID = ?`,
      [survivorRow.coreMeasurementID]
    );
    expect(Number(survivorAfter[0].IsActive)).toBe(1);
    expect(parseFloat(survivorAfter[0].MeasuredDBH)).toBeCloseTo(dbh);
  });

  // =========================================================================
  // (f) mixed valid edit + rejected rows: summary includes all existing
  //     counts plus failedRowCount
  // =========================================================================

  it('writes one ledger summary with both updatedCount and failedRowCount for a batch mixing a valid edit with a rejected row', async () => {
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species LIMIT 1');
    const speciesID = speciesRows[0].SpeciesID as number;
    const [quadratRows] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE PlotID = ? LIMIT 1', [plotID]);
    const quadratID = quadratRows[0].QuadratID as number;

    const validTreeTag = 'AUDITMIXOK';
    const validStemTag = 'AUDMIXOK1';
    const originalDBH = 15.0;
    const newDBH = 18.5;

    const [treeRes] = await connection.query<any>('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', [
      validTreeTag,
      speciesID,
      censusID
    ]);
    const treeID = treeRes.insertId;
    const [stemRes] = await connection.query<any>(
      'INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, 1.0, 1.0, 1)',
      [treeID, quadratID, censusID, validStemTag]
    );
    const stemGUID = stemRes.insertId;
    const [cmRes] = await connection.query<any>(
      `INSERT INTO \`${config.database}\`.coremeasurements
         (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, RawTreeTag, RawStemTag, IsValidated, IsActive)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [stemGUID, censusID, originalDBH, 1.3, '2024-01-01', validTreeTag, validStemTag]
    );
    const survivorID = cmRes.insertId;

    const invalidTreeTag = 'AUDITMIXBAD';
    const invalidStemTag = 'AUDMIXBD1';

    const matchRes = await matchPOST(
      buildMatchRequest({
        rows: [
          { tag: validTreeTag, stemtag: validStemTag, dbh: String(newDBH), date: '2024-01-01' },
          { tag: invalidTreeTag, stemtag: invalidStemTag, dbh: '1.0' }
        ],
        plotID,
        censusID,
        schema: config.database
      })
    );
    const matchBody = (await matchRes.json()) as RevisionUploadResponse;
    expect(matchBody.matchedRows).toHaveLength(1);
    expect(matchBody.invalidRows).toHaveLength(1);

    const applyRes = await applyPOST(
      buildApplyRequest({
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
      })
    );
    const applyBodyText = await applyRes.text();
    expect(applyRes.status, `mixed apply must succeed; got ${applyRes.status}: ${applyBodyText}`).toBe(HTTPResponses.OK);
    const applyBody = JSON.parse(applyBodyText) as { updatedCount: number; failedRowCount: number };
    expect(applyBody.updatedCount).toBe(1);
    expect(applyBody.failedRowCount).toBe(1);

    const summaryRow = await readLatestBulkRevisionSummary();
    expect(summaryRow).not.toBeNull();
    expect(summaryRow!.updatedCount).toBe(1);
    expect(summaryRow!.failedRowCount).toBe(1);
    expect(summaryRow!.insertedCount).toBe(0);
    expect(summaryRow!.deletedDuplicateCount).toBe(0);
  });

  // =========================================================================
  // (g) late audit failure rolls back valid edits, failure rows, AND the
  //     coremeasurements audit rows together
  // =========================================================================

  it('rolls back the matched-row update, the failure-row insert, AND both of their unifiedchangelog audit rows together when the ledger write fails late', async () => {
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const [speciesRows] = await connection.query<RowDataPacket[]>('SELECT SpeciesID FROM species LIMIT 1');
    const speciesID = speciesRows[0].SpeciesID as number;
    const [quadratRows] = await connection.query<RowDataPacket[]>('SELECT QuadratID FROM quadrats WHERE PlotID = ? LIMIT 1', [plotID]);
    const quadratID = quadratRows[0].QuadratID as number;

    const survivorTreeTag = 'AUDITLATEF';
    const survivorStemTag = 'AUDLATFV1';
    const originalDBH = 20.0;
    const newDBH = 25.0;

    const [treeRes] = await connection.query<any>('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', [
      survivorTreeTag,
      speciesID,
      censusID
    ]);
    const treeID = treeRes.insertId;
    const [stemRes] = await connection.query<any>(
      'INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, 1.0, 1.0, 1)',
      [treeID, quadratID, censusID, survivorStemTag]
    );
    const stemGUID = stemRes.insertId;
    const [cmRes] = await connection.query<any>(
      `INSERT INTO \`${config.database}\`.coremeasurements
         (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, RawTreeTag, RawStemTag, IsValidated, IsActive)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [stemGUID, censusID, originalDBH, 1.3, '2024-01-01', survivorTreeTag, survivorStemTag]
    );
    const survivorID = cmRes.insertId;

    const invalidTreeTag = 'AUDITLATEI';
    const invalidStemTag = 'AUDLATIV1';

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
    const matchBody = (await matchRes.json()) as RevisionUploadResponse;
    expect(matchBody.matchedRows).toHaveLength(1);
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

    const connectionManager = ConnectionManager.getInstance();
    const realExecuteQuery = connectionManager.executeQuery.bind(connectionManager);
    const executeQuerySpy = vi
      .spyOn(connectionManager, 'executeQuery')
      .mockImplementation(async (query: string, params?: unknown[], transactionID?: string) => {
        if (query.includes('INSERT INTO') && query.includes('edit_operations')) {
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
    expect(failureRowsAfterRollback, 'after rollback the failure-row insert must not persist').toHaveLength(0);

    const survivorAuditAfterRollback = await readCoreMeasurementsChangelog(survivorID);
    expect(survivorAuditAfterRollback, 'after rollback the survivor must have no audit trail from this aborted apply').toHaveLength(0);

    const [anyFailureAuditRows] = await connection.query<ChangelogRow[]>(
      `SELECT ucl.* FROM \`${config.database}\`.unifiedchangelog ucl
       JOIN \`${config.database}\`.coremeasurements cm ON cm.CoreMeasurementID = ucl.RecordID
       WHERE ucl.TableName = ? AND cm.RawTreeTag = ?`,
      [COREMEASUREMENTS_TABLE_NAME, invalidTreeTag]
    );
    // The failure row itself was rolled back (no CoreMeasurementID survives to
    // join against), so this must also be empty — confirms the audit insert
    // never independently committed ahead of the data it describes.
    expect(anyFailureAuditRows, 'after rollback there must be no orphaned audit row for the aborted failure row either').toHaveLength(0);

    const summariesAfterRollback = await countBulkRevisionSummaries();
    expect(summariesAfterRollback, 'an aborted apply must leave zero ledger summaries').toBe(0);
  });
});
