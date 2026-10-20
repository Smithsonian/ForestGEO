/**
 * GET /api/setupbulkfailure on a pre-partitioned family — Integration Tests
 *
 * Pre-partitioned staging writes every row under `<batch>__subNNN`, so the
 * client's call with the original BatchID finds no exact-match rows; the route
 * must move every member that family discovery returns. A broken transfer
 * leaves a failed upload's rows stranded in temporarymeasurements. These tests run the real route, the real upload
 * session ownership check and the real transfer against local MySQL; only the
 * authenticated user is mocked.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/setupbulkfailure-subbatch.integration.test.ts
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { createUploadSession, ensureUploadSessionsTable, updateSessionState, UploadSessionState } from '@/config/uploadsessiontracker';
import { errorCodeForSystemFailure, INGESTION_ERROR_SOURCE } from '@/config/measurementerrors';
import { buildSubBatchID } from '@/lib/uploads/batch-family';
import type { RouteContext } from '@/lib/route-authz';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: 'subbatch-failure@forestgeo.test', userStatus: 'global', sites: [] } }))
}));

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];
const HTTP_OK = 200;
const TEST_USER = 'subbatch-failure@forestgeo.test';
const SESSION_HEADER = 'x-upload-session-id';
const INTERRUPTION_REASON = 'Server error 504: 504.0 GatewayTimeout';
const INTERRUPTED_ERROR_CODE = errorCodeForSystemFailure('interrupted_upload');
const MEMBER_ROW_COUNTS = [4, 4, 1];

/** Distinct tag ranges per test so no family collides with another's trees in the shared census. */
const TAG_OFFSET = {
  fullFamily: 100,
  neighbours: 200,
  mixedFamily: 300
} as const;

let connection: Connection;
let testData: TestData;
let config: TestDatabaseConfig;
let nextFileID = 0;
const knownFiles: string[] = [];
const openSessionIDs: string[] = [];

function assertLocalHost(): void {
  const host = process.env.AZURE_SQL_SERVER;
  if (!host || !LOCAL_HOSTS.includes(host)) throw new Error(`REFUSING setupbulkfailure integration test on non-local app host '${host}'`);
  if (!LOCAL_HOSTS.includes(DEFAULT_TEST_CONFIG.host))
    throw new Error(`REFUSING setupbulkfailure integration test on non-local test host '${DEFAULT_TEST_CONFIG.host}'`);
}

function newFileID(name: string): string {
  const fileID = `failure_${name}_${process.pid}_${++nextFileID}.csv`;
  knownFiles.push(fileID);
  return fileID;
}

function treeTagFor(suffix: number): string {
  return `SF${String(suffix).padStart(9, '0')}`;
}

async function stageRow(fileID: string, batchID: string, suffix: number): Promise<void> {
  await connection.query(
    `INSERT INTO temporarymeasurements
     (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate)
     VALUES (?, ?, ?, ?, ?, '1', ?, ?, ?, ?, 10, 1.3, '2024-03-15')`,
    [
      fileID,
      batchID,
      testData.plots[0].plotID,
      testData.census[0].censusID,
      treeTagFor(suffix),
      testData.species[0].SpeciesCode,
      testData.quadrats[0].QuadratName,
      suffix % 10,
      suffix % 10
    ]
  );
}

/** Stages `MEMBER_ROW_COUNTS` rows under the family's `__subNNN` members and returns the staged tags per member. */
async function stagePrepartitionedFamily(fileID: string, batchID: string, firstSuffix: number): Promise<Map<string, string[]>> {
  const tagsByMember = new Map<string, string[]>();
  let suffix = firstSuffix;
  for (const [memberIndex, rowCount] of MEMBER_ROW_COUNTS.entries()) {
    const memberID = buildSubBatchID(batchID, memberIndex + 1);
    const tags: string[] = [];
    for (let row = 0; row < rowCount; row++) {
      await stageRow(fileID, memberID, ++suffix);
      tags.push(treeTagFor(suffix));
    }
    tagsByMember.set(memberID, tags);
  }
  return tagsByMember;
}

async function openProcessingSession(fileID: string): Promise<string> {
  const session = await createUploadSession(
    config.database,
    testData.plots[0].plotID,
    testData.census[0].censusID,
    TEST_USER,
    fileID,
    MEMBER_ROW_COUNTS.length
  );
  await updateSessionState(config.database, session.sessionId, UploadSessionState.PROCESSING);
  openSessionIDs.push(session.sessionId);
  return session.sessionId;
}

async function callSetupBulkFailure(fileID: string, batchID: string, sessionID: string) {
  const { GET } = await import('@/app/api/setupbulkfailure/[fileID]/[batchID]/route');
  const url = `http://localhost/api/setupbulkfailure/${encodeURIComponent(fileID)}/${encodeURIComponent(batchID)}?schema=${config.database}&reason=${encodeURIComponent(INTERRUPTION_REASON)}`;
  const request = new NextRequest(url, { method: 'GET', headers: { [SESSION_HEADER]: sessionID } });
  return GET(request, { params: Promise.resolve({ fileID, batchID }) } satisfies RouteContext);
}

async function stagedBatchIDs(fileID: string): Promise<string[]> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT BatchID FROM temporarymeasurements WHERE FileID = ? ORDER BY id', [fileID]);
  return rows.map(row => String(row.BatchID));
}

interface MovedRow {
  UploadBatchID: string;
  RawTreeTag: string;
  StemGUID: string | null;
  ErrorSource: string | null;
  ErrorCode: string | null;
}

async function movedRows(fileID: string): Promise<MovedRow[]> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT cm.UploadBatchID, cm.RawTreeTag, cm.StemGUID, me.ErrorSource, me.ErrorCode
     FROM coremeasurements cm
     LEFT JOIN measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
     LEFT JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
     WHERE cm.UploadFileID = ?
     ORDER BY cm.UploadBatchID, cm.RawTreeTag`,
    [fileID]
  );
  return rows as MovedRow[];
}

function tagsByBatch(rows: MovedRow[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) grouped.set(row.UploadBatchID, [...(grouped.get(row.UploadBatchID) ?? []), row.RawTreeTag]);
  return grouped;
}

describe('GET /api/setupbulkfailure on a pre-partitioned family (real local MySQL)', () => {
  beforeAll(async () => {
    assertLocalHost();
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    await ensureUploadSessionsTable(config.database);
  }, 120_000);

  afterEach(async () => {
    // One active session per plot/census: close each test's session so the next can open its own.
    for (const sessionID of openSessionIDs.splice(0)) await updateSessionState(config.database, sessionID, UploadSessionState.COMPLETED);
  });

  afterAll(async () => {
    if (connection) {
      for (const fileID of knownFiles) await connection.query('DELETE FROM temporarymeasurements WHERE FileID = ?', [fileID]);
      await teardownTestDatabase(connection, config);
    }
  }, 120_000);

  it('moves every sub-batch member to unresolved measurements when called with the original BatchID', async () => {
    const fileID = newFileID('full_family');
    const batchID = `fullfam_${nextFileID}`;
    const expectedTagsByMember = await stagePrepartitionedFamily(fileID, batchID, TAG_OFFSET.fullFamily);
    const sessionID = await openProcessingSession(fileID);

    const response = await callSetupBulkFailure(fileID, batchID, sessionID);
    const remaining = await stagedBatchIDs(fileID);
    const moved = await movedRows(fileID);
    console.log(
      `[full-family] status=${response.status} remainingStaged=${remaining.length} moved=${moved.length}`,
      'movedByBatch=',
      Object.fromEntries(tagsByBatch(moved)),
      'errorCodes=',
      [...new Set(moved.map(row => `${row.ErrorSource}/${row.ErrorCode}`))]
    );

    expect(response.status).toBe(HTTP_OK);
    expect(remaining).toEqual([]);
    expect(tagsByBatch(moved)).toEqual(expectedTagsByMember);
    expect(moved.every(row => row.StemGUID === null)).toBe(true);
    expect(moved.every(row => row.ErrorSource === INGESTION_ERROR_SOURCE && row.ErrorCode === INTERRUPTED_ERROR_CODE)).toBe(true);
  });

  it('leaves a neighbouring family whose BatchID differs only where LIKE wildcards would match untouched', async () => {
    const fileID = newFileID('neighbours');
    const batchID = `nb_${nextFileID}`;
    // `_` is a LIKE wildcard: unescaped, `nb_7__sub%` would also match `nbX7__sub001`.
    const neighbourBatchID = batchID.replace('_', 'X');
    await stagePrepartitionedFamily(fileID, batchID, TAG_OFFSET.neighbours);
    const neighbourTags = await stagePrepartitionedFamily(fileID, neighbourBatchID, TAG_OFFSET.neighbours + MEMBER_ROW_COUNTS.length * 10);
    const sessionID = await openProcessingSession(fileID);

    const response = await callSetupBulkFailure(fileID, batchID, sessionID);
    const remaining = await stagedBatchIDs(fileID);
    const moved = await movedRows(fileID);
    console.log(
      `[neighbours] status=${response.status} target=${batchID} neighbour=${neighbourBatchID}`,
      'remainingStaged=',
      [...new Set(remaining)],
      'movedBatches=',
      [...new Set(moved.map(row => row.UploadBatchID))]
    );

    expect(response.status).toBe(HTTP_OK);
    expect([...new Set(remaining)]).toEqual([...neighbourTags.keys()]);
    expect(remaining).toHaveLength(MEMBER_ROW_COUNTS.reduce((sum, count) => sum + count, 0));
    expect(moved.every(row => row.UploadBatchID.startsWith(`${batchID}__sub`))).toBe(true);
  });

  it('moves the sub-batch members too when rows are also staged under the original BatchID', async () => {
    const fileID = newFileID('mixed_family');
    const batchID = `mixfam_${nextFileID}`;
    const exactRowTag = treeTagFor(TAG_OFFSET.mixedFamily);
    await stageRow(fileID, batchID, TAG_OFFSET.mixedFamily);
    const expectedMemberTags = await stagePrepartitionedFamily(fileID, batchID, TAG_OFFSET.mixedFamily + 10);
    const sessionID = await openProcessingSession(fileID);

    const response = await callSetupBulkFailure(fileID, batchID, sessionID);
    const remaining = await stagedBatchIDs(fileID);
    const moved = await movedRows(fileID);
    console.log(`[mixed-family] status=${response.status} remainingStaged=`, [...new Set(remaining)], 'movedByBatch=', Object.fromEntries(tagsByBatch(moved)));

    expect(response.status).toBe(HTTP_OK);
    expect(remaining).toEqual([]);
    expect(tagsByBatch(moved)).toEqual(new Map([[batchID, [exactRowTag]], ...expectedMemberTags]));
  });
});
