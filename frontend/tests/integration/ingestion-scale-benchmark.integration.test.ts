/**
 * Ingestion scale benchmark: sub-batch time must NOT blow up as the census fills.
 *
 * ── The incident this guards against (Harvard census upload, 2026-07-28) ──────
 * bulkingestionprocess ran three equal 10k-row sub-batches into one census:
 * 8s -> 8s -> 1,500s+. The blowup was the existing_tag_stemtag_collision_failures
 * query (storedprocedures.sql, STAGE 8): once coremeasurements held 20k rows the
 * optimizer abandoned the batch-driven nested-loop plan for a
 * trees x coremeasurements pair explosion — cost proportional to
 * (existing measurements x batch rows) instead of (batch rows). The fix pins the
 * join order with STRAIGHT_JOIN so every stage is one indexed lookup.
 *
 * This benchmark re-runs the incident's shape in miniature: three equal
 * sub-batches into one census (0, then 10k, then 20k existing measurements) with
 * every row a distinct tree+stem, timing each CALL. The assertion is deliberately
 * generous — a healthy run is ~flat (later batches within ~1.5x of the first),
 * the pathological plan is 10-100x — so it only fires on a real regression, not
 * CI noise. If a future optimizer change reintroduces the flip, the third batch
 * blows past the bound (or the test times out, which is the same signal).
 *
 * CRITICAL SAFETY: the beforeAll REFUSING TO RUN guard hard-fails before any
 * write if the host is not local, so this can never touch a real database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection, type RowDataPacket } from 'mysql2/promise';
import { setupTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'] as const;

const BATCH_SIZE = 10000;
const BATCH_COUNT = 3;
const STAGING_CHUNK_SIZE = 2000;
// A later batch may cost at most RATIO_LIMIT x the first (empty-census) batch,
// with an absolute floor so a fast first batch cannot make the bound flaky.
// Healthy observed ratio is ~1x-1.5x; the pathological plan is 10x-100x.
const RATIO_LIMIT = 5;
const MIN_ALLOWED_MS = 30000;
const MAX_BATCH_DURATION_MS = 30000;
const CALL_TIMEOUT_MS = 45000;
const DATE_SPREAD_DAYS = 90;
const TEST_TIMEOUT_MS = CALL_TIMEOUT_MS * BATCH_COUNT + 60000;

let connection: Connection;
let testData: TestData;
let config: TestDatabaseConfig;

type ThreadedConnection = Connection & { threadId?: number };
type ProcedureResults = RowDataPacket[] | RowDataPacket[][];

class BenchmarkCallTimeoutError extends Error {
  constructor(batchID: string) {
    super(`bulkingestionprocess timed out after ${CALL_TIMEOUT_MS}ms for ${batchID}`);
    this.name = 'BenchmarkCallTimeoutError';
  }
}

function assertLocalHostOrRefuse(): void {
  const host = process.env.AZURE_SQL_SERVER;
  if (!host || !LOCAL_HOSTS.includes(host as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: ConnectionManager host is '${host}', not local. Aborting to avoid writing to a real database.`);
  }
  const testHost = DEFAULT_TEST_CONFIG.host;
  if (!LOCAL_HOSTS.includes(testHost as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`REFUSING TO RUN: TEST_DB_HOST is '${testHost}', not local. Aborting to avoid writing to a real database.`);
  }
}

function measurementDate(rowIndex: number): string {
  const day = rowIndex % DATE_SPREAD_DAYS;
  const base = new Date(Date.UTC(2024, 0, 1));
  base.setUTCDate(base.getUTCDate() + day);
  return base.toISOString().slice(0, 10);
}

/** Bulk-stages one sub-batch into temporarymeasurements (insertTestMeasurements is row-at-a-time and far too slow at this scale). */
async function stageBatch(batchIndex: number): Promise<{ fileID: string; batchID: string }> {
  const fileID = 'scale_benchmark.csv';
  const batchID = `scale_benchmark__sub${String(batchIndex + 1).padStart(3, '0')}`;
  const plotID = testData.plots[0].plotID;
  const censusID = testData.census[0].censusID;
  const speciesCode = testData.species[0].SpeciesCode;
  const quadratName = testData.quadrats[0].QuadratName;

  const rows: unknown[][] = [];
  for (let i = 1; i <= BATCH_SIZE; i++) {
    // Every row is its own tree+stem (the dominant shape of a census upload).
    const treeTag = `B${batchIndex + 1}T${String(i).padStart(6, '0')}`;
    rows.push([
      fileID,
      batchID,
      plotID,
      censusID,
      treeTag,
      '1',
      speciesCode,
      quadratName,
      (i % 500) / 10,
      (i % 700) / 10,
      10 + (i % 900) / 10,
      1.3,
      measurementDate(i),
      null,
      null,
      null
    ]);
  }
  for (let offset = 0; offset < rows.length; offset += STAGING_CHUNK_SIZE) {
    await connection.query(
      `INSERT INTO temporarymeasurements
         (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName,
          LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments, PublishedStemID)
       VALUES ?`,
      [rows.slice(offset, offset + STAGING_CHUNK_SIZE)]
    );
  }
  return { fileID, batchID };
}

async function successfulRowCount(batchID: string): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM coremeasurements WHERE UploadBatchID = ? AND StemGUID IS NOT NULL AND IsActive = 1`,
    [batchID]
  );
  return Number(rows[0].total);
}

/**
 * Runs one CALL on a disposable connection. If the incident regresses and the
 * statement hangs, abort it from a second connection before failing the test;
 * a Vitest timeout alone cannot cancel server-side MySQL work.
 */
async function runBulkIngestionWithTimeout(fileID: string, batchID: string): Promise<ProcedureResults> {
  const ingestConnection = await createConnection(config);
  const threadID = (ingestConnection as ThreadedConnection).threadId;
  if (!Number.isInteger(threadID)) {
    await ingestConnection.end();
    throw new Error(`MySQL connection for ${batchID} did not expose a numeric thread id`);
  }

  let timeoutHandle: NodeJS.Timeout | undefined;
  let destroyed = false;
  const callPromise = ingestConnection.query('CALL bulkingestionprocess(?, ?)', [fileID, batchID]) as Promise<[ProcedureResults, unknown]>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new BenchmarkCallTimeoutError(batchID)), CALL_TIMEOUT_MS);
  });

  try {
    const [results] = await Promise.race([callPromise, timeoutPromise]);
    return results;
  } catch (error) {
    if (error instanceof BenchmarkCallTimeoutError) {
      // Attach before KILL so ER_QUERY_INTERRUPTED can never become an unhandled rejection.
      void callPromise.catch(() => undefined);
      let killConnection: Connection | undefined;
      try {
        killConnection = await createConnection(config);
        await killConnection.query(`KILL QUERY ${threadID}`);
      } finally {
        await killConnection?.end().catch(() => undefined);
        // Never reuse a connection that may still have a statement settling.
        ingestConnection.destroy();
        destroyed = true;
      }
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
    if (!destroyed) await ingestConnection.end();
  }
}

beforeAll(async () => {
  assertLocalHostOrRefuse();
  const setup = await setupTestDatabase();
  connection = setup.connection;
  testData = setup.testData;
  config = setup.config;
}, 90000);

afterAll(async () => {
  await teardownTestDatabase(connection, config);
});

describe('Ingestion scale benchmark (0 / 10k / 20k existing measurements)', () => {
  it(
    'keeps sub-batch ingestion time flat as prior sub-batches fill the census',
    async () => {
      const durationsMs: number[] = [];

      for (let batchIndex = 0; batchIndex < BATCH_COUNT; batchIndex++) {
        const existingBefore = batchIndex * BATCH_SIZE;
        const { fileID, batchID } = await stageBatch(batchIndex);

        const startedAt = Date.now();
        const results = await runBulkIngestionWithTimeout(fileID, batchID);
        const elapsedMs = Date.now() - startedAt;
        durationsMs.push(elapsedMs);

        const resultRow = Array.isArray(results[0]) ? (results[0] as RowDataPacket[])[0] : results[0];
        expect(resultRow?.batch_failed, `batch ${batchID}: ${resultRow?.message}`).toBeFalsy();

        // The benchmark must measure REAL ingestion — a batch that silently failed
        // its rows would be fast for the wrong reason.
        const succeeded = await successfulRowCount(batchID);
        expect(succeeded, `batch ${batchID} fully ingested`).toBe(BATCH_SIZE);
        expect(elapsedMs, `batch ${batchID} exceeded the ${MAX_BATCH_DURATION_MS}ms absolute latency ceiling`).toBeLessThan(MAX_BATCH_DURATION_MS);

        console.log(`[scale-benchmark] batch ${batchIndex + 1}/${BATCH_COUNT} (${existingBefore} existing): ${elapsedMs}ms, ${succeeded} rows ingested`);
      }

      const [firstBatchMs, ...laterBatchesMs] = durationsMs;
      const allowedMs = Math.max(RATIO_LIMIT * firstBatchMs, MIN_ALLOWED_MS);
      console.log(`[scale-benchmark] durations ${durationsMs.map(d => `${d}ms`).join(' -> ')}; bound for later batches: ${allowedMs}ms`);

      for (const [i, later] of laterBatchesMs.entries()) {
        expect(
          later,
          `batch ${i + 2} took ${later}ms with ${(i + 1) * BATCH_SIZE} existing measurements — over ${allowedMs}ms bound ` +
            `(first batch ${firstBatchMs}ms). This is the incident signature: a stage whose cost scales with existing x batch rows.`
        ).toBeLessThan(allowedMs);
      }
    },
    TEST_TIMEOUT_MS
  );
});
