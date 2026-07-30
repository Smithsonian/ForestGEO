/**
 * Sync-vs-worker pipeline equivalence — drift guard (async-upload Task 13).
 *
 * ONE fixture CSV is pushed through BOTH measurement upload pipelines inside a
 * single provisioned schema, against two separate plot/census scopes:
 *
 *   SYNC (scope A)   — the interactive pipeline's exact calls:
 *                      stageMeasurementChunk invoked the way
 *                      app/api/sqlpacketload/route.ts invokes it on the
 *                      server-resolution path (rawRows + csvHeaders + delimiter,
 *                      storedMapping undefined, preKeyedRows undefined), parse
 *                      rejects pushed the way the client + batchedupload route
 *                      record them, then ingestBatch and collapseCensus.
 *   WORKER (scope B) — the full background worker via runJobIfClaimable with an
 *                      injected fetchFileText returning the same CSV text.
 *
 * The resulting coremeasurements (resolved rows joined out to
 * TreeTag/StemTag/SpeciesCode/Quadrat/coords/DBH/HOM/Date/Codes, plus
 * unresolved reject rows) are compared FIELD-LEVEL after normalizing only
 * scope-dependent values (IDs, batch ids, SourceRowIndex sign — the worker
 * deliberately records rejects in the negative index namespace). Ordering is
 * by logical row content, never by auto-increment IDs. Any divergence prints
 * full row diffs via toEqual.
 *
 * KNOWN DIVERGENCE (pinned, not hidden): on the FIRST-ever upload of a census,
 * the interactive ordering records parse rejects BEFORE ingestion, and
 * ingestBatch's failed-initial-census recovery preflight
 * (lib/failedinitialcensusrecovery.ts) treats those pre-ingest
 * StemGUID-IS-NULL rows as residue from a crashed load and wipes them. The
 * worker was explicitly built to record rejects AFTER ingest to survive this
 * (lib/background-jobs/worker.ts, "ORDER IS LOAD-BEARING"). This test pins the
 * actual behavior of both pipelines so any change — fixing the sync loss or
 * regressing the worker's ordering — fails loudly here.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/upload-pipeline-equivalence.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import mysql, { type Connection, type Pool, type RowDataPacket } from 'mysql2/promise';
import moment from 'moment';
import Papa from 'papaparse';
import { setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

// ---------------------------------------------------------------------------
// Safety guard — setupTestDatabase DROPs/CREATEs its schema and this suite
// DELETEs from the shared catalog schema; never run remote.
// ---------------------------------------------------------------------------

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';

if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(
    `[upload-pipeline-equivalence] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops/recreates its test schema and clears catalog.background_jobs; it must only run locally.`
  );
}

const TEST_DB_PORT = Number(process.env.TEST_DB_PORT || 3306);
const TEST_DB_USER = process.env.TEST_DB_USER || 'root';
const TEST_DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'testpassword';

// ---------------------------------------------------------------------------
// Shared state bridge — identical pattern to upload-worker.test.ts: route every
// schema-side query through one real MySQL connection, and the catalog through
// a local pool.
// ---------------------------------------------------------------------------

const TRANSACTION_ID_PREFIX = 'equivalence-tx-';

const sharedState = vi.hoisted(() => ({
  connection: null as import('mysql2/promise').Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0,
  catalogPool: null as import('mysql2/promise').Pool | null
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
    withTransaction: async <T>(fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<any>; readonly id: string }) => Promise<T>): Promise<T> => {
      const id = await manager.beginTransaction();
      try {
        const tx = {
          id,
          query: (sql: string, params?: unknown[]) => manager.executeQuery(sql, params, id)
        };
        const result = await fn(tx);
        await manager.commitTransaction(id);
        return result;
      } catch (error) {
        await manager.rollbackTransaction(id);
        throw error;
      }
    },
    acquireApplicationLock: async (lockName: string, _transactionID: string, timeoutMs: number) => {
      if (!sharedState.connection) throw new Error('Test DB connection not initialized');
      const [rows] = await sharedState.connection.query<import('mysql2/promise').RowDataPacket[]>('SELECT GET_LOCK(?, ?) as acquired', [
        lockName,
        Math.ceil(timeoutMs / 1000)
      ]);
      return (rows as import('mysql2/promise').RowDataPacket[])[0]?.acquired === 1;
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});

vi.mock('@/lib/db/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: () => {
    if (!sharedState.catalogPool) throw new Error('Test catalog pool not initialized');
    const pool = sharedState.catalogPool;
    return {
      pool,
      getConnection: () => pool.getConnection(),
      signalActivity: () => undefined
    };
  }
}));

vi.mock('@/ailogger', () => ({
  default: {
    info: (msg: string) => console.log(`[ailogger.info] ${msg}`),
    warn: (msg: string) => console.log(`[ailogger.warn] ${msg}`),
    error: (msg: string, ...rest: unknown[]) => console.log(`[ailogger.error] ${msg}`, ...rest)
  }
}));

import { applyCatalogMigrationsForTests } from '../setup/catalog-migrations';
import { seedCatalogTables } from './admin-provision/_shared';
import { createUploadBackgroundJob, getBackgroundJob } from '@/lib/background-jobs/repository';
import { runJobIfClaimable, type WorkerDeps } from '@/lib/background-jobs/worker';
import { ensureUploadSessionsTable } from '@/config/uploadsessiontracker';
import { FormType, SourceFormat, type FileRow } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { generateShortBatchID } from '@/config/utils';
import ConnectionManager from '@/lib/db/connectionmanager';
import { detectDelimiter } from '@/lib/uploads/detect-delimiter';
import { stageMeasurementChunk } from '@/lib/uploads/stage-measurements';
import { ingestBatch } from '@/lib/uploads/ingest-batch';
import { collapseCensus } from '@/lib/uploads/collapse-census';
import { recordFailedMeasurementRows } from '@/lib/uploads/record-invalid-rows';
import type { FailedMeasurementsRDS } from '@/lib/db/definitions/core';

// ---------------------------------------------------------------------------
// Fixture — ONE CSV through both pipelines.
//   - alias headers: treetag (alias of tag), SpeciesCode (alias of spcode)
//   - row E1006 is invalid (missing required quadrat) → parse reject
//   - rows E1001/E1003 exercise decimal precision (3+ decimal DBH/coords)
// ---------------------------------------------------------------------------

const FILE_NAME = 'equivalence-fixture.csv';
const TEST_USER = 'equivalence-test@forestgeo.test';
const BLOB_CONTAINER = 'equivalence-test-container';
const MEASUREMENT_DATE = '2024-03-15';

const VALID_ROW_COUNT = 5;
const REJECT_ROW_COUNT = 1;

const FIXTURE_CSV = [
  'treetag,stemtag,SpeciesCode,quadrat,lx,ly,dbh,hom,date,codes',
  `E1001,1,ACERRU,Q01,1.4567,2.5,10.4567,1.3,${MEASUREMENT_DATE},A`,
  `E1002,1,QUERCO,Q01,3.25,4.75,20.4,1.3,${MEASUREMENT_DATE},A`,
  `E1003,1,PINUST,Q02,5.5,6.5,30.125,1.35,${MEASUREMENT_DATE},A`,
  `E1004,1,FAGUGR,Q02,7.5,8.5,15.2,1.3,${MEASUREMENT_DATE},A`,
  `E1005,1,BETUAL,Q03,9.5,0.5,25.8,1.3,${MEASUREMENT_DATE},A`,
  `E1006,1,ACERRU,,2.5,3.5,11.1,1.3,${MEASUREMENT_DATE},A`
].join('\n');

// ---------------------------------------------------------------------------
// Normalized row shapes — every scope-dependent field (auto-increment IDs,
// PlotID/CensusID, batch ids, timestamps) is excluded; SourceRowIndex is
// compared by magnitude because the worker intentionally records rejects in
// the negative index namespace.
// ---------------------------------------------------------------------------

interface ResolvedRowSnapshot {
  treeTag: string;
  stemTag: string;
  speciesCode: string;
  quadratName: string;
  localX: number | null;
  localY: number | null;
  dbh: number | null;
  hom: number | null;
  measurementDate: string | null;
  codes: string | null;
}

interface RejectRowSnapshot {
  rawTreeTag: string | null;
  rawStemTag: string | null;
  rawSpCode: string | null;
  rawQuadrat: string | null;
  rawX: number | null;
  rawY: number | null;
  dbh: number | null;
  hom: number | null;
  measurementDate: string | null;
  rawCodes: string | null;
  rawComments: string | null;
  sourceRowIndexMagnitude: number | null;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return String(value);
}

describe('upload pipeline equivalence — sync route vs background worker', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };
  let schema: string;
  let catalogPool: Pool;

  // Scope A — the seeded plot/census, used by the SYNC pipeline.
  let plotA: number;
  let censusA: number;
  // Scope B — a second plot/census in the SAME schema, used by the WORKER.
  let plotB: number;
  let censusB: number;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    schema = setup.config.database;
    plotA = testData.plots[0].plotID;
    censusA = testData.census[0].censusID;
    sharedState.connection = connection;

    catalogPool = mysql.createPool({
      host: TEST_DB_HOST,
      port: TEST_DB_PORT,
      user: TEST_DB_USER,
      password: TEST_DB_PASSWORD,
      connectionLimit: 5
    });
    sharedState.catalogPool = catalogPool;
    await seedCatalogTables(catalogPool);
    await applyCatalogMigrationsForTests();
    await catalogPool.query(`DELETE FROM catalog.sites WHERE SchemaName = ?`, [schema]);
    await catalogPool.query(
      `INSERT INTO catalog.sites
         (SiteName, SchemaName, SQDimX, SQDimY, DefaultUOMDBH, DefaultUOMHOM, DoubleDataEntry)
       VALUES ('Upload Equivalence Test Site', ?, 20, 20, 'cm', 'm', 0)`,
      [schema]
    );

    // Scope B: second plot with the same quadrat names and an own census so the
    // worker run is fully independent of scope A inside the same schema.
    await connection.query(
      `INSERT INTO plots (PlotName, LocationName, CountryName, DimensionX, DimensionY, Area, GlobalX, GlobalY, GlobalZ, PlotShape, PlotDescription)
       VALUES ('Equivalence Plot B', 'Test Location', 'Panama', 500, 500, 250000, 0, 0, 0, 'square', 'Worker-path scope for the equivalence drift guard')`
    );
    const [plotRows] = await connection.query<RowDataPacket[]>(`SELECT PlotID FROM plots WHERE PlotName = 'Equivalence Plot B'`);
    plotB = Number(plotRows[0].PlotID);

    // Distinct StartX/StartY per plot-B quadrat: uq_quadrats_full does not
    // include PlotID, so re-using plot A's (name, 0, 0, ...) tuple collides.
    const PLOT_B_QUADRAT_OFFSET = 100;
    const quadratNames = ['Q01', 'Q02', 'Q03'];
    for (let i = 0; i < quadratNames.length; i++) {
      await connection.query(
        `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape)
         VALUES (?, ?, ?, ?, 20, 20, 400, 'square')`,
        [plotB, quadratNames[i], PLOT_B_QUADRAT_OFFSET + i * 20, PLOT_B_QUADRAT_OFFSET]
      );
    }

    await connection.query(`INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate) VALUES (?, 1, '2024-01-01', '2024-12-31')`, [plotB]);
    const [censusRows] = await connection.query<RowDataPacket[]>(`SELECT CensusID FROM census WHERE PlotID = ? AND PlotCensusNumber = 1`, [plotB]);
    censusB = Number(censusRows[0].CensusID);

    // validation_runs and upload_sessions are skipped by loadSchema's
    // semicolon-split filter — same workaround as upload-worker.test.ts.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${schema}\`.validation_runs (
        RunID          INT AUTO_INCREMENT PRIMARY KEY,
        PlotID         INT NOT NULL,
        CensusID       INT NOT NULL,
        Status         ENUM ('running', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'running',
        TotalSteps     INT NOT NULL DEFAULT 0,
        CompletedSteps INT NOT NULL DEFAULT 0,
        FailedSteps    INT NOT NULL DEFAULT 0,
        CurrentStep    VARCHAR(100) NULL,
        ErrorMessages  JSON NULL,
        StartedAt      DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        CompletedAt    DATETIME NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await ensureUploadSessionsTable(schema);

    // Catalog rows in FK-safe order: events → files → jobs.
    await catalogPool.query(`DELETE FROM catalog.background_job_events`);
    await catalogPool.query(`DELETE FROM catalog.background_job_files`);
    await catalogPool.query(`DELETE FROM catalog.background_jobs`);

    console.log(`[setup] schema=${schema} scopeA(plot=${plotA},census=${censusA}) scopeB(plot=${plotB},census=${censusB})`);
  }, 120000);

  afterAll(async () => {
    sharedState.catalogPool = null;
    if (catalogPool) {
      await catalogPool.query(`DELETE FROM catalog.sites WHERE SchemaName = ?`, [schema]);
      await catalogPool.end();
    }
    sharedState.connection = null;
    await teardownTestDatabase(connection, config);
  });

  // -------------------------------------------------------------------------
  // Snapshot helpers — ordered by logical row content, never by IDs.
  // -------------------------------------------------------------------------

  async function fetchResolvedRows(censusID: number): Promise<ResolvedRowSnapshot[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT t.TreeTag, s.StemTag, sp.SpeciesCode, q.QuadratName,
              s.LocalX, s.LocalY,
              cm.MeasuredDBH, cm.MeasuredHOM,
              DATE_FORMAT(cm.MeasurementDate, '%Y-%m-%d') AS MeasurementDate,
              (SELECT GROUP_CONCAT(ca.Code ORDER BY ca.Code SEPARATOR ';')
                 FROM cmattributes ca
                WHERE ca.CoreMeasurementID = cm.CoreMeasurementID) AS Codes
       FROM coremeasurements cm
       JOIN stems s ON s.StemGUID = cm.StemGUID
       JOIN trees t ON t.TreeID = s.TreeID
       JOIN quadrats q ON q.QuadratID = s.QuadratID
       JOIN species sp ON sp.SpeciesID = t.SpeciesID
       WHERE cm.CensusID = ? AND cm.StemGUID IS NOT NULL
       ORDER BY t.TreeTag, s.StemTag, sp.SpeciesCode, q.QuadratName, cm.MeasuredDBH, cm.MeasurementDate`,
      [censusID]
    );
    return rows.map(row => ({
      treeTag: String(row.TreeTag),
      stemTag: String(row.StemTag),
      speciesCode: String(row.SpeciesCode),
      quadratName: String(row.QuadratName),
      localX: toNumberOrNull(row.LocalX),
      localY: toNumberOrNull(row.LocalY),
      dbh: toNumberOrNull(row.MeasuredDBH),
      hom: toNumberOrNull(row.MeasuredHOM),
      measurementDate: toStringOrNull(row.MeasurementDate),
      codes: toStringOrNull(row.Codes)
    }));
  }

  async function fetchRejectRows(censusID: number): Promise<RejectRowSnapshot[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY,
              MeasuredDBH, MeasuredHOM,
              DATE_FORMAT(MeasurementDate, '%Y-%m-%d') AS MeasurementDate,
              RawCodes, RawComments, SourceRowIndex
       FROM coremeasurements
       WHERE CensusID = ? AND StemGUID IS NULL
       ORDER BY RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, MeasuredDBH`,
      [censusID]
    );
    return rows.map(row => ({
      rawTreeTag: toStringOrNull(row.RawTreeTag),
      rawStemTag: toStringOrNull(row.RawStemTag),
      rawSpCode: toStringOrNull(row.RawSpCode),
      rawQuadrat: toStringOrNull(row.RawQuadrat),
      rawX: toNumberOrNull(row.RawX),
      rawY: toNumberOrNull(row.RawY),
      dbh: toNumberOrNull(row.MeasuredDBH),
      hom: toNumberOrNull(row.MeasuredHOM),
      measurementDate: toStringOrNull(row.MeasurementDate),
      rawCodes: toStringOrNull(row.RawCodes),
      rawComments: toStringOrNull(row.RawComments),
      // The worker records parse rejects with NEGATIVE indices (collision-free
      // namespace under UNIQUE (UploadBatchID, SourceRowIndex)); the sync
      // batchedupload route records them positive. Compare by magnitude.
      sourceRowIndexMagnitude: row.SourceRowIndex === null ? null : Math.abs(Number(row.SourceRowIndex))
    }));
  }

  // -------------------------------------------------------------------------
  // SYNC pipeline (scope A) — the interactive pipeline's exact calls.
  // -------------------------------------------------------------------------

  async function runSyncPipeline(): Promise<{ stagedCount: number; invalidRows: FileRow[]; rejectsBeforeIngest: RejectRowSnapshot[] }> {
    const connectionManager = ConnectionManager.getInstance();
    const batchID = generateShortBatchID();

    // Parse exactly like the worker does (and like the client's raw-rows path):
    // raw Papa parse with header row, no transforms.
    const delimiter = detectDelimiter(FIXTURE_CSV, FILE_NAME, undefined);
    const parsed = Papa.parse<Record<string, string>>(FIXTURE_CSV, { delimiter, header: true, skipEmptyLines: true });
    const csvHeaders = (parsed.meta.fields ?? []).map(String);
    const rawRows = parsed.data;
    expect(rawRows).toHaveLength(VALID_ROW_COUNT + REJECT_ROW_COUNT);

    // stageMeasurementChunk invoked the way app/api/sqlpacketload/route.ts
    // invokes it on the server-resolution path: rawRows + csvHeaders +
    // delimiter, storedMapping undefined (no client mapping), preKeyedRows
    // undefined, caller-owned transaction.
    let invalidRows: FileRow[] = [];
    const stagingTxn = await connectionManager.beginTransaction();
    let stageResult;
    try {
      stageResult = await stageMeasurementChunk(connectionManager, {
        schema,
        fileName: FILE_NAME,
        batchID,
        plotID: plotA,
        censusID: censusA,
        uploadMode: UploadMode.CLEAN_REUPLOAD,
        sourceFormat: SourceFormat.csv,
        rawRows,
        csvHeaders,
        delimiter,
        storedMapping: undefined,
        uploadSessionID: null,
        transactionID: stagingTxn,
        changedBy: TEST_USER,
        onInvalidRows: rows => {
          invalidRows = rows;
        }
      });
      await connectionManager.commitTransaction(stagingTxn);
    } catch (error) {
      await connectionManager.rollbackTransaction(stagingTxn);
      throw error;
    }
    console.log(
      `[sync] staged=${stageResult.insertedCount} expected=${stageResult.expectedCount} dropped=${stageResult.droppedCount} invalid=${invalidRows.length}`
    );

    // The interactive client pushes the server's failingRows to the
    // batchedupload route IMMEDIATELY after the chunk POST — i.e. BEFORE
    // ingestion. Mirror uploadfiresql.pushErrorRowsToFailedMeasurements's
    // mapping and the route's recordFailedMeasurementRows call (fresh batch ID,
    // fileID from the query param).
    if (invalidRows.length > 0) {
      const clientMappedRows = invalidRows.map(row => ({
        plotID: plotA,
        censusID: censusA,
        tag: row.tag || null,
        stemTag: row.stemtag || null,
        spCode: row.spcode || null,
        quadrat: row.quadrat || null,
        x: row.lx || null,
        y: row.ly || null,
        dbh: row.dbh || null,
        hom: row.hom || null,
        date: row.date ? moment(row.date).format('YYYY-MM-DD') : null,
        codes: row.codes || null,
        comments: row.comments || null,
        failureReasons: row.failureReason || 'Unknown error'
      })) as unknown as FailedMeasurementsRDS[];

      const rejectBatchID = generateShortBatchID();
      const rejectTxn = await connectionManager.beginTransaction();
      try {
        await recordFailedMeasurementRows(connectionManager, schema, clientMappedRows, FILE_NAME, rejectBatchID, plotA, censusA, rejectTxn);
        await connectionManager.commitTransaction(rejectTxn);
      } catch (error) {
        await connectionManager.rollbackTransaction(rejectTxn);
        throw error;
      }
    }
    const rejectsBeforeIngest = await fetchRejectRows(censusA);
    console.log(`[sync] rejects recorded before ingest: ${JSON.stringify(rejectsBeforeIngest)}`);

    // Then the interactive pipeline's processing phase: ingest + collapse.
    const ingestResult = await ingestBatch(connectionManager, { schema, fileID: FILE_NAME, batchID });
    console.log(
      `[sync] ingest: subBatches=${ingestResult.processedSubBatches} totalRows=${ingestResult.totalRows} recovered=${ingestResult.recovered} ` +
        `failedSubBatches=${ingestResult.subBatchResults.filter(r => r.batchFailedButHandled).length}`
    );
    await collapseCensus(connectionManager, { schema, censusID: censusA });

    return { stagedCount: stageResult.insertedCount, invalidRows, rejectsBeforeIngest };
  }

  // -------------------------------------------------------------------------
  // WORKER pipeline (scope B) — full runJobIfClaimable with injected blob text.
  // -------------------------------------------------------------------------

  async function runWorkerPipeline(): Promise<void> {
    const job = await createUploadBackgroundJob(
      catalogPool,
      {
        schema,
        plotID: plotB,
        censusID: censusB,
        uploadMode: UploadMode.CLEAN_REUPLOAD,
        sourceFormat: SourceFormat.csv,
        formType: FormType.measurements,
        payload: { selectedDelimiters: { [FILE_NAME]: ',' } },
        files: [
          {
            fileName: FILE_NAME,
            blobContainer: BLOB_CONTAINER,
            blobName: `uploads/${FILE_NAME}`,
            expectedRows: VALID_ROW_COUNT + REJECT_ROW_COUNT
          }
        ]
      },
      TEST_USER
    );

    const deps: WorkerDeps = { fetchFileText: async () => FIXTURE_CSV };
    await runJobIfClaimable(job.jobID, deps);

    const finished = await getBackgroundJob(catalogPool, job.jobID);
    console.log(
      `[worker] job ${job.jobID}: status=${finished?.status} phase=${finished?.phase} processed=${finished?.processedRows} failed=${finished?.failedRows} lastError=${finished?.lastError}`
    );
    expect(finished!.status).toBe('completed');
    expect(finished!.processedRows).toBe(VALID_ROW_COUNT);
    expect(finished!.failedRows).toBe(REJECT_ROW_COUNT);
  }

  // -------------------------------------------------------------------------
  // The drift guard
  // -------------------------------------------------------------------------

  it('produces field-identical resolved measurements through the sync route calls and the background worker', async () => {
    const syncRun = await runSyncPipeline();
    await runWorkerPipeline();

    // --- Resolved (ingested) rows: strict field-level equality. ---
    const syncResolved = await fetchResolvedRows(censusA);
    const workerResolved = await fetchResolvedRows(censusB);
    console.log(`[compare] sync resolved rows (${syncResolved.length}):\n${JSON.stringify(syncResolved, null, 2)}`);
    console.log(`[compare] worker resolved rows (${workerResolved.length}):\n${JSON.stringify(workerResolved, null, 2)}`);

    expect(syncResolved).toHaveLength(VALID_ROW_COUNT);
    expect(workerResolved).toHaveLength(VALID_ROW_COUNT);
    // Field-level equality of the two result sets — a failure here prints the
    // full row diff.
    expect(syncResolved).toEqual(workerResolved);

    // Pin the shared rounding behavior so a divergence can't hide behind both
    // sides changing together unnoticed: the ingestion mechanism rounds DBH to
    // 2 decimal places (10.4567 → 10.46) while stem coordinates keep their
    // full precision (1.4567 survives into stems.LocalX).
    const precisionRow = workerResolved.find(row => row.treeTag === 'E1001');
    expect(precisionRow).toBeDefined();
    expect(precisionRow!.dbh).toBe(10.46);
    expect(precisionRow!.localX).toBeCloseTo(1.4567, 4);

    // --- Parse rejects: the SAME resolution mechanism rejected the SAME row. ---
    expect(syncRun.invalidRows).toHaveLength(REJECT_ROW_COUNT);
    expect(syncRun.invalidRows[0].tag).toBe('E1006');

    const workerRejects = await fetchRejectRows(censusB);
    const syncRejectsAfterIngest = await fetchRejectRows(censusA);
    console.log(`[compare] sync rejects BEFORE ingest:\n${JSON.stringify(syncRun.rejectsBeforeIngest, null, 2)}`);
    console.log(`[compare] sync rejects AFTER ingest:\n${JSON.stringify(syncRejectsAfterIngest, null, 2)}`);
    console.log(`[compare] worker rejects:\n${JSON.stringify(workerRejects, null, 2)}`);

    // Worker rejects persist with full Raw* content.
    expect(workerRejects).toHaveLength(REJECT_ROW_COUNT);
    expect(workerRejects[0]).toMatchObject({
      rawTreeTag: 'E1006',
      rawSpCode: 'ACERRU',
      rawQuadrat: null,
      rawCodes: 'A',
      sourceRowIndexMagnitude: 1
    });

    // The reject CONTENT both pipelines produced is identical at recording
    // time (same Raw* fields from the same shared resolution)...
    expect(syncRun.rejectsBeforeIngest).toEqual(workerRejects);

    // ...but reject PERSISTENCE diverges. KNOWN DIVERGENCE — pinned, not
    // normalized away: the interactive ordering records rejects BEFORE the
    // file's ingest, and on a first-ever census upload ingestBatch's
    // failed-initial-census recovery preflight wipes every StemGUID-IS-NULL
    // row for the census (lib/failedinitialcensusrecovery.ts). The worker
    // records rejects AFTER ingest specifically to survive this. If the sync
    // ordering is ever fixed, this assertion fails — flip it to strict
    // equality with workerRejects at that point.
    expect(syncRejectsAfterIngest).toEqual([]);
  }, 240000);
});
