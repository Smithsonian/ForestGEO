/**
 * Setup on pre-partitioned and legacy batch families — Integration Tests
 *
 * Runs ingestBatch through the real ConnectionManager and the real
 * bulkingestionprocess procedure against local MySQL, with the sub-batch size
 * forced to 4 rows:
 *   - a family staged under its final `__subNNN` members ingests without a
 *     single BatchID rewrite and with one family discovery (spec test 7);
 *   - rows staged under the original BatchID (legacy client) take the hinted
 *     keyset fallback split and ingest completely (spec test 8);
 *   - a member larger than the batch size (tampered firstRowOrdinal or a batch
 *     size change between staging and setup) fails setup with a typed error and
 *     touches no row (spec test 9);
 *   - the cross-file unresolved-row cleanup matches rows staged under members.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/setup-prepartitioned.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import ailogger from '@/ailogger';
import ConnectionManager from '../../lib/db/connectionmanager';
import { FAMILY_SCAN_INDEX } from '../../lib/uploads/batch-family';
import { ingestBatch, IngestBatchAbortedError, OversizedSubBatchError, type SetupDiagnostic } from '../../lib/uploads/ingest-batch';
import { SETUP_FAILURE_CODES } from '../../lib/uploads/setup-failure';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];
const BATCH_SIZE = 4;
const BATCH_ID_REWRITE = /UPDATE[\s\S]*temporarymeasurements[\s\S]*SET\s+BatchID/i;
const FAMILY_DISCOVERY = /GROUP BY BatchID[\s\S]*ORDER BY BatchID/i;
const KEYSET_SELECT_MARKER = 'AS rowID';
const FALLBACK_WARNING_MARKER = 'fallback split';
const INGESTION_ERROR_CODE = 'SQL_EXCEPTION';
const UPLOAD_STATUS_COMPLETED = 'completed';

/** Distinct tag ranges per test so no family collides with another family's trees in the shared census. */
const TAG_OFFSET = {
  prepartitioned: 100,
  legacy: 200,
  oversized: 300,
  crossFileCleanup: 400
} as const;

let connection: Connection;
let testData: TestData;
let config: TestDatabaseConfig;
let oldBatchSize: string | undefined;
let nextFileID = 0;
const knownFiles: string[] = [];

function assertLocalHost(): void {
  const host = process.env.AZURE_SQL_SERVER;
  if (!host || !LOCAL_HOSTS.includes(host)) throw new Error(`REFUSING setup integration test on non-local app host '${host}'`);
  if (!LOCAL_HOSTS.includes(DEFAULT_TEST_CONFIG.host)) throw new Error(`REFUSING setup integration test on non-local test host '${DEFAULT_TEST_CONFIG.host}'`);
}

function newFamily(name: string): { fileID: string; batchID: string } {
  const fileID = `setup_${name}_${process.pid}_${++nextFileID}.csv`;
  const batchID = `batch_${name}_${nextFileID}`;
  knownFiles.push(fileID);
  return { fileID, batchID };
}

function treeTagFor(suffix: number): string {
  return `SP${String(suffix).padStart(9, '0')}`;
}

async function insertRow(fileID: string, batchID: string, suffix: number): Promise<void> {
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

async function memberships(fileID: string): Promise<Array<{ rowID: string; BatchID: string }>> {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT CAST(id AS CHAR) AS rowID, BatchID FROM temporarymeasurements WHERE FileID = ? ORDER BY temporarymeasurements.id',
    [fileID]
  );
  return rows.map(row => ({ rowID: String(row.rowID), BatchID: String(row.BatchID) }));
}

async function ingestedRowCount(fileID: string): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS rowCount FROM coremeasurements WHERE UploadFileID = ?', [fileID]);
  return Number(rows[0].rowCount);
}

function spyStatements() {
  const manager = ConnectionManager.getInstance();
  const executeQuerySpy = vi.spyOn(manager, 'executeQuery');
  const statements = () => executeQuerySpy.mock.calls.map(([sql]) => String(sql));
  return { executeQuerySpy, statements };
}

function expectedScope() {
  return { plotID: testData.plots[0].plotID, censusID: testData.census[0].censusID };
}

/** Runs setup to its commit, then aborts before the first procedure call. */
async function runSetupOnly(fileID: string, batchID: string): Promise<SetupDiagnostic[]> {
  const diagnostics: SetupDiagnostic[] = [];
  let setupCommitted = false;
  try {
    await ingestBatch(ConnectionManager.getInstance(), {
      schema: config.database,
      fileID,
      batchID,
      expectedScope: expectedScope(),
      isAborted: () => setupCommitted,
      onSetupProgress: diagnostic => {
        diagnostics.push(diagnostic);
        if (diagnostic.terminal && diagnostic.outcome === 'committed') setupCommitted = true;
      }
    });
    throw new Error('Setup-only run unexpectedly reached procedure completion');
  } catch (error) {
    if (!(error instanceof IngestBatchAbortedError) || !setupCommitted) throw error;
  }
  return diagnostics;
}

async function seedIngestionErrorLink(measurementID: number): Promise<void> {
  const [errorRows] = await connection.query<RowDataPacket[]>(
    `SELECT ErrorID FROM measurement_errors WHERE ErrorSource = 'ingestion' AND ErrorCode = ? LIMIT 1`,
    [INGESTION_ERROR_CODE]
  );
  await connection.query('INSERT INTO measurement_error_log (MeasurementID, ErrorID, IsResolved) VALUES (?, ?, FALSE)', [measurementID, errorRows[0].ErrorID]);
}

describe('ingestBatch setup on pre-partitioned and legacy families (real local MySQL)', () => {
  beforeAll(async () => {
    assertLocalHost();
    oldBatchSize = process.env.INGESTION_SUB_BATCH_ROWS;
    process.env.INGESTION_SUB_BATCH_ROWS = String(BATCH_SIZE);
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
  }, 120_000);

  afterAll(async () => {
    if (connection) {
      for (const fileID of knownFiles) await connection.query('DELETE FROM temporarymeasurements WHERE FileID = ?', [fileID]);
      await teardownTestDatabase(connection, config);
    }
    if (oldBatchSize === undefined) delete process.env.INGESTION_SUB_BATCH_ROWS;
    else process.env.INGESTION_SUB_BATCH_ROWS = oldBatchSize;
  }, 120_000);

  it('ingests a pre-partitioned family without rewriting BatchID (spec test 7)', async () => {
    const family = newFamily('prepart');
    const members = [`${family.batchID}__sub001`, `${family.batchID}__sub002`, `${family.batchID}__sub003`];
    let suffix = TAG_OFFSET.prepartitioned;
    for (const [memberIndex, member] of members.entries()) {
      const rowsInMember = memberIndex === members.length - 1 ? 1 : BATCH_SIZE;
      for (let row = 0; row < rowsInMember; row++) await insertRow(family.fileID, member, ++suffix);
    }
    const warnSpy = vi.spyOn(ailogger, 'warn');
    const { executeQuerySpy, statements } = spyStatements();
    const result = await ingestBatch(ConnectionManager.getInstance(), {
      schema: config.database,
      fileID: family.fileID,
      batchID: family.batchID,
      expectedScope: expectedScope()
    });
    const rewrites = statements().filter(sql => BATCH_ID_REWRITE.test(sql));
    const discoveries = statements().filter(sql => FAMILY_DISCOVERY.test(sql));
    const setupWarnings = warnSpy.mock.calls.map(([message]) => String(message)).filter(message => message.includes(family.batchID));
    console.log(
      `[prepart] processed=${result.processedSubBatches} rewrites=${rewrites.length} discoveries=${discoveries.length} statements=${statements().length}`,
      'members=',
      result.subBatchResults.map(r => r.subBatchID),
      'setupWarnings=',
      setupWarnings
    );
    executeQuerySpy.mockRestore();
    warnSpy.mockRestore();

    expect(rewrites).toEqual([]);
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]).toContain(`/*+ INDEX(tm ${FAMILY_SCAN_INDEX}) */`);
    expect(setupWarnings).toEqual([]);
    expect(result.subBatchResults.map(r => r.subBatchID)).toEqual(members);
    expect(await memberships(family.fileID)).toEqual([]);
    expect(await ingestedRowCount(family.fileID)).toBe(2 * BATCH_SIZE + 1);
  });

  it('splits a legacy family through the hinted fallback and ingests it (spec test 8)', async () => {
    const family = newFamily('legacy');
    const ROWS = 2 * BATCH_SIZE + 1;
    const EXPECTED_KEYSET_PASSES = Math.ceil(ROWS / BATCH_SIZE);
    const EXPECTED_BOUND_QUERIES = 1;
    for (let i = 1; i <= ROWS; i++) await insertRow(family.fileID, family.batchID, TAG_OFFSET.legacy + i);
    const warnSpy = vi.spyOn(ailogger, 'warn');
    const { executeQuerySpy, statements } = spyStatements();
    const result = await ingestBatch(ConnectionManager.getInstance(), {
      schema: config.database,
      fileID: family.fileID,
      batchID: family.batchID,
      expectedScope: expectedScope()
    });
    // The hint rides on the family discovery, the frozen-bound aggregate and every keyset pass, so count them apart.
    const hinted = statements().filter(sql => sql.includes(`INDEX(tm ${FAMILY_SCAN_INDEX})`));
    const hintedDiscoveries = hinted.filter(sql => FAMILY_DISCOVERY.test(sql));
    const hintedKeysetSelects = hinted.filter(sql => sql.includes(KEYSET_SELECT_MARKER));
    const hintedBoundQueries = hinted.filter(sql => !sql.includes(KEYSET_SELECT_MARKER) && !FAMILY_DISCOVERY.test(sql));
    const rewrites = statements().filter(sql => BATCH_ID_REWRITE.test(sql));
    const fallbackWarnings = warnSpy.mock.calls.map(([message]) => String(message)).filter(message => message.includes(FALLBACK_WARNING_MARKER));
    console.log(
      `[legacy] hinted=${hinted.length} discoveries=${hintedDiscoveries.length} keysetSelects=${hintedKeysetSelects.length} boundQueries=${hintedBoundQueries.length} rewrites=${rewrites.length}`,
      'warnings=',
      fallbackWarnings,
      'members=',
      result.subBatchResults.map(r => r.subBatchID)
    );
    executeQuerySpy.mockRestore();
    warnSpy.mockRestore();

    expect(hintedDiscoveries).toHaveLength(1);
    expect(hintedKeysetSelects).toHaveLength(EXPECTED_KEYSET_PASSES);
    expect(hintedBoundQueries).toHaveLength(EXPECTED_BOUND_QUERIES);
    expect(rewrites).toHaveLength(EXPECTED_KEYSET_PASSES);
    expect(fallbackWarnings).toEqual([expect.stringContaining(`${ROWS} row(s)`)]);
    expect(result.subBatchResults.map(r => r.subBatchID)).toEqual([1, 2, 3].map(n => `${family.batchID}__sub00${n}`));
    expect(await memberships(family.fileID)).toEqual([]);
    expect(await ingestedRowCount(family.fileID)).toBe(ROWS);
  });

  it('rejects an oversized pre-partitioned member without touching any row (spec test 9)', async () => {
    const family = newFamily('oversized');
    for (let i = 1; i <= BATCH_SIZE + 1; i++) await insertRow(family.fileID, `${family.batchID}__sub001`, TAG_OFFSET.oversized + i);
    const before = await memberships(family.fileID);
    const diagnostics: SetupDiagnostic[] = [];
    const outcome = await ingestBatch(ConnectionManager.getInstance(), {
      schema: config.database,
      fileID: family.fileID,
      batchID: family.batchID,
      expectedScope: expectedScope(),
      onSetupProgress: diagnostic => diagnostics.push(diagnostic)
    }).catch((error: unknown) => error);
    const terminal = diagnostics.find(diagnostic => diagnostic.terminal);
    console.log('[oversized] outcome:', outcome, 'terminal:', terminal);

    expect(outcome).toBeInstanceOf(OversizedSubBatchError);
    expect((outcome as OversizedSubBatchError).code).toBe(SETUP_FAILURE_CODES.oversizedSubBatch);
    expect((outcome as Error).message).toContain(`${family.batchID}__sub001`);
    expect(terminal).toMatchObject({ outcome: 'failed', step: 'discovery', errorCode: SETUP_FAILURE_CODES.oversizedSubBatch });
    expect(await memberships(family.fileID)).toEqual(before);
    expect(await ingestedRowCount(family.fileID)).toBe(0);
  });

  it('removes a prior file’s unresolved row that matches a row staged under a family member', async () => {
    const family = newFamily('cross_file');
    const priorFileID = `${family.fileID}.prior`;
    const matchedSuffix = TAG_OFFSET.crossFileCleanup + 1;
    await insertRow(family.fileID, `${family.batchID}__sub001`, matchedSuffix);
    await insertRow(family.fileID, `${family.batchID}__sub001`, matchedSuffix + 1);
    // A completed upload in the census keeps failed-first-census recovery from wiping the seeded row.
    await connection.query(
      `INSERT INTO uploadmetrics (uploadId, fileID, batchID, schema_name, plotID, censusID, sourceRecords, status, startTime)
       VALUES (?, ?, 'completed_batch', ?, ?, ?, 1, ?, NOW())`,
      [`completed-${family.fileID}`, `${family.fileID}.completed`, config.database, expectedScope().plotID, expectedScope().censusID, UPLOAD_STATUS_COMPLETED]
    );
    const [insertResult] = await connection.query<RowDataPacket[] & { insertId: number }>(
      `INSERT INTO coremeasurements
       (CensusID, StemGUID, MeasurementDate, MeasuredDBH, MeasuredHOM, UploadFileID, UploadBatchID, RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY)
       VALUES (?, NULL, '2024-03-15', 10, 1.3, ?, 'prior_batch', ?, '1', ?, ?, ?, ?)`,
      [
        expectedScope().censusID,
        priorFileID,
        treeTagFor(matchedSuffix),
        testData.species[0].SpeciesCode,
        testData.quadrats[0].QuadratName,
        matchedSuffix % 10,
        matchedSuffix % 10
      ]
    );
    const priorMeasurementID = (insertResult as unknown as { insertId: number }).insertId;
    await seedIngestionErrorLink(priorMeasurementID);

    await runSetupOnly(family.fileID, family.batchID);
    const [remaining] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS rowCount FROM coremeasurements WHERE CoreMeasurementID = ?', [
      priorMeasurementID
    ]);
    console.log(`[cross-file] prior unresolved row ${priorMeasurementID} remaining=${remaining[0].rowCount}`, 'staged=', await memberships(family.fileID));

    expect(Number(remaining[0].rowCount)).toBe(0);
    expect((await memberships(family.fileID)).map(row => row.BatchID)).toEqual([`${family.batchID}__sub001`, `${family.batchID}__sub001`]);
  });
});
