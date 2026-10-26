import { NextRequest } from 'next/server';
/**
 * recordInvalidRows / recordFailedMeasurementRows / deleteUnresolvedRowsForBatchFamily
 * against the REAL ConnectionManager (no mock) — Integration Tests
 *
 * tests/integration/record-invalid-rows.test.ts proxies a hand-rolled
 * ConnectionManager shim onto one real mysql2 connection. This suite instead
 * imports the actual `lib/db/connectionmanager.ts` singleton unmocked, so the
 * real transaction pool, the real prepared-statement execution path, and the
 * real per-transaction GET_LOCK/RELEASE_LOCK lifecycle (lib/db/connectionmanager.ts:703-788)
 * are all exercised exactly as production uses them.
 *
 * Pattern copied from tests/integration/recent-changes-reference-audit.integration.test.ts:
 * the AZURE_SQL_SERVER local-host guard, setupTestDatabase/teardownTestDatabase for the
 * disposable per-checkout schema, and connectionManager.closeConnection() + teardownTestDatabase
 * in afterAll.
 *
 * Prerequisites: docker compose up -d mysql, with AZURE_SQL_SERVER (and
 * AZURE_SQL_PORT/USER/PASSWORD) pointed at that same local instance — the same
 * requirement tests/integration/recent-changes-reference-audit.integration.test.ts has.
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/record-invalid-rows-real-connectionmanager.integration.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import ConnectionManager from '@/lib/db/connectionmanager';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';
import { recordInvalidRows, recordFailedMeasurementRows, deleteUnresolvedRowsForBatchFamily, type InvalidRowContext } from '@/lib/uploads/record-invalid-rows';
import { buildIngestionFailureBatchLockName } from '@/lib/changelog/ingestion-failure-audit';
import type { FailedMeasurementsRDS } from '@/lib/db/definitions/core';

// ---------------------------------------------------------------------------
// Local-only guard — identical to recent-changes-reference-audit.integration.test.ts.
// The real ConnectionManager's pool (lib/db/poolmonitorsingleton.ts) reads
// AZURE_SQL_SERVER directly; this suite must hard-fail before any write if
// that host is not local.
// ---------------------------------------------------------------------------

vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'transfer@example.com', userStatus: 'global', sites: [] } }) }));
vi.mock('@/config/uploadsessiontracker', async importOriginal => ({
  ...(await importOriginal<typeof import('@/config/uploadsessiontracker')>()),
  requireUploadSessionOwnership: async () => undefined
}));

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;

const FILE_NAME = 'record-invalid-rows-real-cm-fixture.csv';
const BATCH_ID = 'real-cm';

let setupConnection: Connection | null = null;
let config: TestDatabaseConfig;
let schema: string;
let testData: TestData;
let plotID: number;
let censusID: number;

const connectionManager = ConnectionManager.getInstance();

/** JSON columns round-trip as objects via mysql2, but tolerate a string in case a driver config changes that. */
function rowState(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  return typeof value === 'string' ? JSON.parse(value) : (value as Record<string, unknown>);
}

async function fetchCoreMeasurementID(batchID: string, rawTreeTag: string): Promise<number | null> {
  const [rows] = await setupConnection!.query<RowDataPacket[]>(
    `SELECT CoreMeasurementID FROM \`${schema}\`.coremeasurements
     WHERE UploadFileID = ? AND UploadBatchID = ? AND RawTreeTag = ? AND StemGUID IS NULL
     LIMIT 1`,
    [FILE_NAME, batchID, rawTreeTag]
  );
  return rows.length > 0 ? rows[0].CoreMeasurementID : null;
}

async function fetchChangelogRows(coreMeasurementID: number): Promise<RowDataPacket[]> {
  const [rows] = await setupConnection!.query<RowDataPacket[]>(
    `SELECT Operation, OldRowState, NewRowState, ChangedBy, PlotID, CensusID
     FROM \`${schema}\`.unifiedchangelog
     WHERE TableName = 'coremeasurements' AND RecordID = ?
     ORDER BY ChangeID`,
    [String(coreMeasurementID)]
  );
  return rows;
}

/** `SELECT IS_USED_LOCK(name)` — NULL means no connection/session holds it. */
async function isLockHeld(lockName: string): Promise<unknown> {
  const [rows] = await setupConnection!.query<RowDataPacket[]>('SELECT IS_USED_LOCK(?) AS owner', [lockName]);
  return rows[0]?.owner ?? null;
}

beforeAll(async () => {
  const host = process.env.AZURE_SQL_SERVER;
  console.log(`[record-invalid-rows-real-connectionmanager] resolved ConnectionManager host = '${host}'`);
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid writing to a real database.`);
  }

  const setup = await setupTestDatabase(DEFAULT_TEST_CONFIG);
  setupConnection = setup.connection;
  config = setup.config;
  testData = setup.testData;
  schema = config.database;
  plotID = testData.plots[0].plotID;
  censusID = testData.census[0].censusID;
  console.log(`[setup] schema=${schema} plotID=${plotID} censusID=${censusID}`);
}, 90000);

afterAll(async () => {
  await connectionManager.closeConnection();
  await teardownTestDatabase(setupConnection, config);
});

beforeEach(async () => {
  await setupConnection!.query(`DELETE FROM \`${schema}\`.coremeasurements WHERE UploadFileID = ? AND StemGUID IS NULL`, [FILE_NAME]);
});

describe('record-invalid-rows.ts against the real ConnectionManager (no mock)', () => {
  it("recordInvalidRows (own transaction): INSERT, then a changed-retry UPDATE with the real old/new values, then an unchanged-retry no-op — and the batch's application lock is released after every call", async () => {
    const changedBy = 'real-cm-tester@example.com';
    const batchID = `${BATCH_ID}__insert`;
    const ctx: InvalidRowContext = { schema, plotID, censusID, fileName: FILE_NAME, batchID, changedBy };
    const lockName = buildIngestionFailureBatchLockName(schema, batchID);

    await recordInvalidRows(connectionManager, ctx, [{ tag: 'RCM100', failureReason: 'first reason', comments: 'first comment' }]);
    const measurementID = await fetchCoreMeasurementID(batchID, 'RCM100');
    console.log(`[real-cm] measurementID after first write: ${measurementID}`);
    expect(measurementID).not.toBeNull();

    const afterInsert = await fetchChangelogRows(measurementID!);
    expect(afterInsert).toHaveLength(1);
    expect(afterInsert[0].Operation).toBe('INSERT');
    expect(afterInsert[0].ChangedBy).toBe(changedBy);
    expect(rowState(afterInsert[0].NewRowState)?.Description).toBe('first reason');
    expect(rowState(afterInsert[0].NewRowState)?.RawComments).toBe('first comment');

    expect(await isLockHeld(lockName), `lock "${lockName}" must be released once recordInvalidRows' own transaction commits`).toBeNull();

    await recordInvalidRows(connectionManager, ctx, [{ tag: 'RCM100', failureReason: 'second reason', comments: 'second comment' }]);
    const afterUpdate = await fetchChangelogRows(measurementID!);
    console.log(`[real-cm] audit rows after changed retry: ${JSON.stringify(afterUpdate)}`);
    expect(afterUpdate).toHaveLength(2);
    expect(afterUpdate[1].Operation).toBe('UPDATE');
    expect(afterUpdate[1].ChangedBy).toBe(changedBy);
    const oldRow = rowState(afterUpdate[1].OldRowState)!;
    const newRow = rowState(afterUpdate[1].NewRowState)!;
    expect(oldRow.Description).toBe('first reason');
    expect(oldRow.RawComments).toBe('first comment');
    expect(newRow.Description).toBe('second reason');
    expect(newRow.RawComments).toBe('second comment');

    expect(await isLockHeld(lockName)).toBeNull();

    await recordInvalidRows(connectionManager, ctx, [{ tag: 'RCM100', failureReason: 'second reason', comments: 'second comment' }]);
    const afterNoop = await fetchChangelogRows(measurementID!);
    console.log(`[real-cm] audit rows after unchanged retry: ${JSON.stringify(afterNoop)}`);
    expect(afterNoop, 'an unchanged retry must add exactly zero new history rows for the same key').toHaveLength(2);

    expect(await isLockHeld(lockName)).toBeNull();
  }, 30000);

  it("recordFailedMeasurementRows (own transaction): persists the HTTP wire shape and releases its batch's application lock", async () => {
    const changedBy = 'real-cm-http-tester@example.com';
    const batchID = `${BATCH_ID}__http`;
    const lockName = buildIngestionFailureBatchLockName(schema, batchID);

    const count = await recordFailedMeasurementRows(
      connectionManager,
      schema,
      [{ tag: 'RCM200', comments: 'route note', failureReasons: 'Missing required fields: date' } as FailedMeasurementsRDS],
      FILE_NAME,
      batchID,
      plotID,
      censusID,
      undefined,
      changedBy
    );
    expect(count).toBe(1);

    const measurementID = await fetchCoreMeasurementID(batchID, 'RCM200');
    expect(measurementID).not.toBeNull();

    const auditRows = await fetchChangelogRows(measurementID!);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].Operation).toBe('INSERT');
    expect(auditRows[0].ChangedBy).toBe(changedBy);

    expect(await isLockHeld(lockName), `lock "${lockName}" must be released once recordFailedMeasurementRows' own transaction commits`).toBeNull();
  }, 30000);

  it('deleteUnresolvedRowsForBatchFamily (own transaction): removes the non-preserved row, audits its DELETE with the census-resolved PlotID, and leaves the completed sibling untouched', async () => {
    const changedBy = 'real-cm-cleanup-tester@example.com';
    const cleanupBatchID = `${BATCH_ID}__cleanup`;
    const preservedSubBatchID = `${cleanupBatchID}__sub001`;
    const ctx: InvalidRowContext = { schema, plotID, censusID, fileName: FILE_NAME, batchID: cleanupBatchID };

    await recordInvalidRows(connectionManager, ctx, [{ tag: 'RCM300', failureReason: 'to be deleted' }]);
    const deletedMeasurementID = await fetchCoreMeasurementID(cleanupBatchID, 'RCM300');
    expect(deletedMeasurementID).not.toBeNull();

    await recordInvalidRows(connectionManager, { ...ctx, batchID: preservedSubBatchID }, [{ tag: 'RCM301', failureReason: 'completed sibling, must survive' }]);
    const preservedMeasurementID = await fetchCoreMeasurementID(preservedSubBatchID, 'RCM301');
    expect(preservedMeasurementID).not.toBeNull();

    // plotID is deliberately OMITTED: deleteUnresolvedRowsForBatchFamily must resolve it
    // itself from the census row inside its own transaction against the real ConnectionManager.
    const deletedCount = await deleteUnresolvedRowsForBatchFamily(
      connectionManager,
      schema,
      FILE_NAME,
      cleanupBatchID,
      censusID,
      undefined,
      [preservedSubBatchID],
      changedBy
    );
    console.log(`[real-cm] deletedCount=${deletedCount}`);
    expect(deletedCount).toBe(1);

    expect(await fetchCoreMeasurementID(cleanupBatchID, 'RCM300'), 'the non-preserved row must be gone').toBeNull();
    expect(await fetchCoreMeasurementID(preservedSubBatchID, 'RCM301'), 'the completed sibling must survive untouched').toBe(preservedMeasurementID);

    const deletedRowAudit = await fetchChangelogRows(deletedMeasurementID!);
    console.log(`[real-cm] deleted row audit trail: ${JSON.stringify(deletedRowAudit)}`);
    expect(deletedRowAudit).toHaveLength(2);
    expect(deletedRowAudit[1].Operation).toBe('DELETE');
    expect(deletedRowAudit[1].ChangedBy).toBe(changedBy);
    expect(deletedRowAudit[1].PlotID).toBe(plotID);
    expect(rowState(deletedRowAudit[1].OldRowState)?.RawTreeTag).toBe('RCM300');

    const preservedRowAudit = await fetchChangelogRows(preservedMeasurementID!);
    expect(preservedRowAudit).toHaveLength(1);
    expect(preservedRowAudit[0].Operation).toBe('INSERT');
  }, 30000);
  it.each(['transfer', 'transfer__sub001'])('audits only newly transferred failures through the synchronous endpoint (%s)', async batchID => {
    const { GET } = await import('@/app/api/setupbulkfailure/[fileID]/[batchID]/route');
    await setupConnection!.query(
      `INSERT INTO \`${schema}\`.coremeasurements (CensusID, UploadFileID, UploadBatchID, RawTreeTag, SourceRowIndex)
       VALUES (?, ?, ?, 'PRIOR-UNAUDITED', -99)`,
      [censusID, FILE_NAME, batchID]
    );
    await setupConnection!.query(
      `INSERT INTO \`${schema}\`.temporarymeasurements (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, MeasurementDate)
       VALUES (?, ?, ?, ?, 'TRANSFER', '1', 'ACERRU', 'Q01', '2024-03-15')`,
      [FILE_NAME, batchID, plotID, censusID]
    );
    const request = new NextRequest(`http://localhost/api/setupbulkfailure/${FILE_NAME}/transfer?schema=${schema}`, {
      headers: { 'x-upload-session-id': 'test-transfer-session' }
    });
    const response = await GET(request, { params: Promise.resolve({ fileID: FILE_NAME, batchID: 'transfer' }) });
    expect(response.status, await response.clone().text()).toBe(200);
    const [audit] = await setupConnection!.query<RowDataPacket[]>(
      `SELECT uc.Operation, uc.ChangedBy, uc.NewRowState FROM \`${schema}\`.unifiedchangelog uc
       JOIN \`${schema}\`.coremeasurements cm ON uc.RecordID = cm.CoreMeasurementID
       WHERE uc.TableName = 'coremeasurements' AND cm.UploadBatchID = ? AND cm.UploadFileID = ?`,
      [batchID, FILE_NAME]
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ Operation: 'INSERT', ChangedBy: 'transfer@example.com' });
    expect(rowState(audit[0].NewRowState)?.RawTreeTag).toBe('TRANSFER');
  });

  it('rolls back the synchronous failure transfer when its audit fails after the data insert', async () => {
    const { GET } = await import('@/app/api/setupbulkfailure/[fileID]/[batchID]/route');
    const batchID = 'transfer-fault';
    await setupConnection!.query(
      `INSERT INTO \`${schema}\`.temporarymeasurements (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, MeasurementDate)
       VALUES (?, ?, ?, ?, 'FAULT', '1', 'ACERRU', 'Q01', '2024-03-15')`,
      [FILE_NAME, batchID, plotID, censusID]
    );
    const execute = connectionManager.executeQuery.bind(connectionManager);
    let rowsAtFault = 0;
    const spy = vi.spyOn(connectionManager, 'executeQuery').mockImplementation(async (sql, params, tx) => {
      if (sql.includes('INSERT INTO') && sql.includes('unifiedchangelog')) {
        const rows = await execute(`SELECT COUNT(*) AS total FROM \`${schema}\`.coremeasurements WHERE UploadBatchID = ?`, [batchID], tx);
        rowsAtFault = Number(rows[0].total);
        throw new Error('transfer audit unavailable');
      }
      return execute(sql, params, tx);
    });
    try {
      const request = new NextRequest(`http://localhost/api/setupbulkfailure/${FILE_NAME}/${batchID}?schema=${schema}`, {
        headers: { 'x-upload-session-id': 'test-transfer-session' }
      });
      const response = await GET(request, { params: Promise.resolve({ fileID: FILE_NAME, batchID }) });
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ details: 'Unable to record failure history. Please retry.' });
      expect(rowsAtFault).toBe(1);
      expect(await fetchCoreMeasurementID(batchID, 'FAULT')).toBeNull();
      const [staged] = await setupConnection!.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${schema}\`.temporarymeasurements WHERE BatchID = ?`, [
        batchID
      ]);
      expect(Number(staged[0].total)).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
