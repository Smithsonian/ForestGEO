/**
 * Provisioned-site lifecycle (integration, real MySQL).
 *
 * The whole point of this file is the SUBJECT, not the assertions: every other
 * integration suite builds its schema with `tests/setup/local-db-setup.ts`
 * `loadSchema`, whose naive semicolon split silently drops any statement whose
 * chunk opens with a `--` banner comment (`upload_errors`, `upload_sessions`,
 * `validation_runs` are the known casualties — upload-worker.test.ts hand-creates
 * two of them to compensate). Production provisioning uses a DIFFERENT splitter,
 * `lib/provisioning/sql-runner.ts` `splitSqlFile`.
 *
 * So the async upload path has never been proven against a schema built the way
 * production builds one. This file provisions a site through the real
 * orchestrator chain, asserts the result satisfies the schema contract, uploads
 * measurements into it, and tears it down.
 *
 * Coverage that exists nowhere else:
 *   - `runProvisioning` executing the full STEPS chain (every other test either
 *     runs a single step or spies out the dispatch; the one existing call, in
 *     orchestrator.test.ts, is a failure path).
 *   - The schema contract read against a PROVISIONED schema.
 *   - `upload_errors` / `upload_sessions` / `validation_runs` proven to come from
 *     production DDL rather than from a test's inline CREATE TABLE.
 *
 * Prerequisites: docker compose up -d mysql
 *
 * Run in isolation:
 *   npx vitest run --config vitest.integration.config.mts tests/integration/provisioned-site-lifecycle.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import mysql, { type Connection, type Pool, type RowDataPacket } from 'mysql2/promise';

import { runProvisioning, startRun, getRunWithSteps, teardownProvisionedSite } from '@/lib/provisioning/orchestrator';
import { ProvisioningError } from '@/lib/provisioning/errors';
import { createUploadBackgroundJob } from '@/lib/background-jobs/repository';
import { FormType, SourceFormat, type FileRow } from '@/config/macros/formdetails';
import { applyCatalogMigrationsForTests } from '../setup/catalog-migrations';
import { STEPS } from '@/lib/provisioning/steps';
import { REQUIRED_PROCEDURES, REQUIRED_VIEWS } from '@/lib/provisioning/steps/sql-steps';
import { SEQUENTIAL_QUADRAT_NAME_PATTERN } from '@/lib/provisioning/grid-generator';
import type { ProvisioningInput } from '@/lib/provisioning/types';
import {
  CONTRACT_READ_TABLES,
  compareSchemaContracts,
  formatContractFailures,
  loadCanonicalSchemaContract,
  readLiveSchemaContract,
  TARGET_TEXT_COLLATION,
  type SchemaContract,
  type SchemaQueryRow
} from '@/lib/db/schema-contract';
import { seedCatalogTables } from './admin-provision/_shared';
import { UploadMode } from '@/config/uploadmodes';

// Errors are surfaced, not swallowed: runValidation catches and returns false,
// so without this a failed validation is an opaque boolean.
vi.mock('@/ailogger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn((...args: unknown[]) => console.error('[ailogger.error]', ...args))
  }
}));

// Importing app/api/sqlpacketload/route for its reference-data writers drags in
// the real next-auth module, whose lib/env.js imports the extensionless
// `next/server` subpath that Node's native ESM resolver cannot resolve. Mocking
// @/auth keeps it out of the graph. This suite calls the writers directly and
// never reaches the route's auth gate. Same workaround as reingest-routes.
// The literal is deliberate: vi.mock factories are hoisted above the module's
// const declarations, so referencing STARTED_BY here would hit its TDZ.
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: 'lifecycle-test@forestgeo', userStatus: 'global', sites: [] } }))
}));

// ---------------------------------------------------------------------------
// Shared state bridge — hoisted so the ConnectionManager mock closure can read
// the live connection after beforeAll wires it up. The connection cannot exist
// at module load: the schema it points at does not exist until provisioning
// runs. Reading it lazily inside the closure is what makes that ordering work.
// ---------------------------------------------------------------------------

const TRANSACTION_ID_PREFIX = 'lifecycle-tx-';

const sharedState = vi.hoisted(() => ({
  connection: null as import('mysql2/promise').Connection | null,
  activeTransactionID: null as string | null,
  transactionCounter: 0,
  catalogPool: null as import('mysql2/promise').Pool | null
}));

// Routes every schema-side call through the provisioned schema's connection.
// Mirrors the mock in upload-worker.test.ts / ingest-batch.test.ts.
vi.mock('@/lib/db/connectionmanager', () => {
  const requireConnection = () => {
    if (!sharedState.connection) throw new Error('Provisioned-schema connection not initialized');
    return sharedState.connection;
  };
  const manager = {
    executeQuery: async (query: string, params?: unknown[], transactionID?: string) => {
      const connection = requireConnection();
      if (transactionID && transactionID !== sharedState.activeTransactionID) {
        throw new Error(`ConnectionManager mock: transactionID mismatch (got "${transactionID}", active "${sharedState.activeTransactionID}")`);
      }
      const [rows] = await connection.query(query, (params as unknown[]) ?? []);
      return rows;
    },
    beginTransaction: async () => {
      const connection = requireConnection();
      if (sharedState.activeTransactionID) throw new Error('ConnectionManager mock: transaction already active');
      await connection.beginTransaction();
      sharedState.transactionCounter += 1;
      const id = `${TRANSACTION_ID_PREFIX}${sharedState.transactionCounter}`;
      sharedState.activeTransactionID = id;
      return id;
    },
    commitTransaction: async (transactionID: string) => {
      const connection = requireConnection();
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: commit transactionID mismatch');
      await connection.commit();
      sharedState.activeTransactionID = null;
    },
    rollbackTransaction: async (transactionID: string) => {
      const connection = requireConnection();
      if (transactionID !== sharedState.activeTransactionID) throw new Error('ConnectionManager mock: rollback transactionID mismatch');
      await connection.rollback();
      sharedState.activeTransactionID = null;
    },
    withTransaction: async <T>(fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<any>; readonly id: string }) => Promise<T>): Promise<T> => {
      const id = await manager.beginTransaction();
      try {
        const result = await fn({ id, query: (sql: string, params?: unknown[]) => manager.executeQuery(sql, params, id) });
        await manager.commitTransaction(id);
        return result;
      } catch (error) {
        await manager.rollbackTransaction(id);
        throw error;
      }
    },
    acquireApplicationLock: async (lockName: string, _transactionID: string, timeoutMs: number) => {
      const connection = requireConnection();
      const [rows] = await connection.query<import('mysql2/promise').RowDataPacket[]>('SELECT GET_LOCK(?, ?) as acquired', [
        lockName,
        Math.ceil(timeoutMs / 1000)
      ]);
      return rows[0]?.acquired === 1;
    },
    cleanupStaleTransactions: async () => undefined,
    closeConnection: async () => undefined
  };
  return { default: { getInstance: () => manager } };
});

// The worker reads the catalog pool from getPoolMonitorInstance().getUsablePool(), and the
// upload-session tracker acquires pooled connections from the same monitor.
// Both are routed to the local catalog pool (no default database; every session
// query is schema-qualified).
vi.mock('@/lib/db/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: () => {
    if (!sharedState.catalogPool) throw new Error('Test catalog pool not initialized');
    const pool = sharedState.catalogPool;
    return {
      pool,
      getUsablePool: async () => pool,
      getConnection: () => pool.getConnection(),
      signalActivity: () => undefined
    };
  }
}));

// Imported after the mocks so these modules bind the mocked singletons.
import ConnectionManager from '@/lib/db/connectionmanager';
import { upsertAttributeRows, upsertSpeciesRows } from '@/lib/uploads/reference-data-writers';
import { runJobIfClaimable, type WorkerDeps } from '@/lib/background-jobs/worker';
import type { BackgroundJobFileRecord } from '@/lib/background-jobs/types';

// ---------------------------------------------------------------------------
// Safety guard — this file DROPs a database and writes to the shared catalog
// schema. It must never point at a remote server.
// ---------------------------------------------------------------------------

const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
const TEST_DB_PORT = Number(process.env.TEST_DB_PORT || 3306);
const TEST_DB_USER = process.env.TEST_DB_USER || 'root';
const TEST_DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'testpassword';

if (!['localhost', '127.0.0.1', '::1'].includes(TEST_DB_HOST)) {
  throw new Error(
    `[provisioned-site-lifecycle] Refusing to run: TEST_DB_HOST="${TEST_DB_HOST}" is not a local address. ` +
      `This suite drops its provisioned schema and writes to the shared catalog schema; it must only run locally.`
  );
}

// ---------------------------------------------------------------------------
// The site this suite provisions
// ---------------------------------------------------------------------------

const SCHEMA_NAME = 'forestgeo_lifecycle_test';
const SITE_NAME = 'Lifecycle Test Site';
const PLOT_NAME = 'Lifecycle Plot';
const STARTED_BY = 'lifecycle-test@forestgeo';

/**
 * 40x40 m plot on a 20x20 m grid => 2x2 = 4 quadrats.
 *
 * `namingPattern: 'row-col'` is deliberate, not cosmetic. The 'sequential'
 * pattern emits `Q00001`-style names, which is exactly the legacy
 * auto-generated placeholder grid that the Revisions divergence guard treats as
 * a replaceable placeholder set (PR #346). Using row-col keeps this fixture out
 * of that special case, and the names are readable in the measurement CSVs.
 */
const PLOT_DIMENSION_M = 40;
const QUADRAT_SIZE_M = 20;
const EXPECTED_QUADRAT_COUNT = 4;
const EXPECTED_QUADRAT_NAMES = ['1-1', '1-2', '2-1', '2-2'] as const;

const PROVISIONING_INPUT: ProvisioningInput = {
  site: {
    siteName: SITE_NAME,
    schemaName: SCHEMA_NAME,
    sqDimX: QUADRAT_SIZE_M,
    sqDimY: QUADRAT_SIZE_M,
    defaultUOMDBH: 'cm',
    defaultUOMHOM: 'm',
    doubleDataEntry: false,
    location: 'Lifecycle Location',
    country: 'Panama'
  },
  plot: {
    plotName: PLOT_NAME,
    dimensionX: PLOT_DIMENSION_M,
    dimensionY: PLOT_DIMENSION_M,
    area: PLOT_DIMENSION_M * PLOT_DIMENSION_M,
    globalX: 0,
    globalY: 0,
    globalZ: 0,
    plotShape: 'square',
    description: 'Provisioned by the lifecycle integration test',
    defaultDimensionUnits: 'm',
    defaultCoordinateUnits: 'm',
    defaultAreaUnits: 'm2',
    defaultDBHUnits: 'cm',
    defaultHOMUnits: 'm'
  },
  quadrats: {
    mode: 'grid',
    quadratSizeX: QUADRAT_SIZE_M,
    quadratSizeY: QUADRAT_SIZE_M,
    namingPattern: 'row-col'
  }
};

/**
 * Tables that `loadSchema` silently drops. Asserting them by name is the single
 * highest-value check in this file: it is the only place in the suite where
 * these three are proven to come from production DDL.
 */
const TABLES_LOADSCHEMA_DROPS = ['upload_errors', 'upload_sessions', 'validation_runs'] as const;

/** Created by tablestructures.sql; redeployed on every deploy by scripts/deploy-taxonomy-views-to-all-schemas.ts. */
const TAXONOMY_VIEWS = ['alltaxonomiesview', 'stemtaxonomiesview'] as const;

/** Every one of these must be empty in a freshly provisioned schema. */
const EMPTY_ON_PROVISION_TABLES = ['species', 'genus', 'family', 'attributes', 'coremeasurements', 'trees', 'stems'] as const;

const WAITING_RETRY_STATUS = 'waiting_retry';
const CANCELLED_STATUS = 'cancelled';
const CONFLICT_ERROR_KIND = 'conflict';
const PARKED_JOB_FILE_NAME = 'lifecycle-parked.csv';
const BLOB_CONTAINER = 'lifecycle-test-container';
const WRONG_CONFIRMATION = 'forestgeo_not_the_target';

const BASE_TABLE_TYPE = 'BASE TABLE';
const VIEW_TYPE = 'VIEW';
const COMPLETED_STATUS = 'completed';

// ---------------------------------------------------------------------------
// Reference data
//
// A provisioned schema has none: tablestructures.sql seeds only the
// measurement_errors catalog. Measurement ingestion resolves species codes and
// attribute codes, so this has to be created before any upload.
//
// It is written through the PRODUCTION writers (upsertSpeciesRows /
// upsertAttributeRows, the same functions app/api/sqlpacketload dispatches to),
// not through hand-rolled INSERTs. The async pipeline cannot be used here:
// ASYNC_UPLOAD_V1_PIPELINES is measurements-only, so a species job is rejected
// by the worker as unsupported routing.
// ---------------------------------------------------------------------------

const ATTRIBUTE_SEED_ROWS: FileRow[] = [
  { code: 'A', description: 'Alive', status: 'alive' },
  { code: 'D', description: 'Dead', status: 'dead' },
  { code: 'M', description: 'Missing', status: 'missing' }
];

/**
 * UNUSED_SPECIES_CODE is seeded but never referenced by a measurement fixture.
 * It keeps "the upload rejected an unknown species" distinguishable from
 * "seeding never ran" — without it, both look identical in a reject assertion.
 */
const SEEDED_SPECIES_CODE = 'ACERRU';
const SECOND_SPECIES_CODE = 'QUERCO';
const UNUSED_SPECIES_CODE = 'PINUST';

const SPECIES_SEED_ROWS: FileRow[] = [
  { spcode: SEEDED_SPECIES_CODE, family: 'Sapindaceae', genus: 'Acer', species: 'rubrum', idlevel: 'species' },
  { spcode: SECOND_SPECIES_CODE, family: 'Fagaceae', genus: 'Quercus', species: 'alba', idlevel: 'species' },
  { spcode: UNUSED_SPECIES_CODE, family: 'Pinaceae', genus: 'Pinus', species: 'strobus', idlevel: 'species' }
];

// ---------------------------------------------------------------------------
// Measurement fixture
//
// Every quadrat name here is one provisioning actually generated, and every
// species code is one the seeding step wrote. Nothing is inherited from
// local-db-setup — a provisioned schema has no seed data.
// ---------------------------------------------------------------------------

const MEASUREMENT_FILE_NAME = 'lifecycle-measurements.csv';
const CSV_HEADER = 'tag,stemtag,spcode,quadrat,lx,ly,dbh,hom,date,codes';
const MEASUREMENT_DATE = '2024-03-15';

const VALID_MEASUREMENT_ROW_COUNT = 4;
/** One row with no quadrat: ingestion must record it as a failure, not drop it silently. */
const REJECT_MEASUREMENT_ROW_COUNT = 1;
const MEASUREMENT_ROW_COUNT = VALID_MEASUREMENT_ROW_COUNT + REJECT_MEASUREMENT_ROW_COUNT;

const MEASUREMENT_CSV = [
  CSV_HEADER,
  `L1001,1,${SEEDED_SPECIES_CODE},1-1,1.5,2.5,10.5,1.3,${MEASUREMENT_DATE},A`,
  `L1002,1,${SECOND_SPECIES_CODE},1-2,3.5,4.5,20.4,1.3,${MEASUREMENT_DATE},A`,
  `L1003,1,${SEEDED_SPECIES_CODE},2-1,5.5,6.5,30.1,1.3,${MEASUREMENT_DATE},A`,
  `L1004,1,${SECOND_SPECIES_CODE},2-2,7.5,8.5,15.2,1.3,${MEASUREMENT_DATE},A`,
  `L1005,1,${SEEDED_SPECIES_CODE},,2.5,3.5,11.1,1.3,${MEASUREMENT_DATE},A`
].join('\n');

const COMPLETED_JOB_STATUS = 'completed';
const FULLY_COMPLETE_PERCENT = 100;
const UPLOADMETRICS_COMPLETED = 'completed';
const IDEMPOTENCY_KEY = 'lifecycle-idempotency-key';

describe('provisioned-site lifecycle', () => {
  let catalogPool: Pool;
  let siteConnection: Connection;
  let runId: number;
  let plotId: number;
  let censusId: number;
  let preSeedRowCounts: Record<string, number>;
  let uploadJobId: number;

  beforeAll(async () => {
    catalogPool = mysql.createPool({
      host: TEST_DB_HOST,
      port: TEST_DB_PORT,
      user: TEST_DB_USER,
      password: TEST_DB_PASSWORD,
      multipleStatements: true,
      charset: 'UTF8MB4_0900_AI_CI',
      connectionLimit: 5
    });

    sharedState.catalogPool = catalogPool;

    await seedCatalogTables(catalogPool);
    await applyCatalogMigrationsForTests();
    await clearLifecycleState(catalogPool);

    runId = await startRunWithoutBackgroundDispatch();
    console.log(`[setup] started provisioning runId=${runId} schema=${SCHEMA_NAME}`);

    // The real chain, awaited. No step is mocked, skipped, or replayed.
    await runProvisioning(runId, catalogPool);

    siteConnection = await mysql.createConnection({
      host: TEST_DB_HOST,
      port: TEST_DB_PORT,
      user: TEST_DB_USER,
      password: TEST_DB_PASSWORD,
      database: SCHEMA_NAME,
      // Must match lib/db/poolmonitorsingleton.ts and lib/provisioning/steps/
      // sql-steps.ts buildSitePool. mysql2's default connection collation is
      // utf8mb4_unicode_ci, which makes every validation query die on
      // ER_CANT_AGGREGATE_2COLLATIONS against these utf8mb4_0900_ai_ci tables.
      charset: 'UTF8MB4_0900_AI_CI',
      timezone: 'Z'
    });
    sharedState.connection = siteConnection;
    console.log(`[setup] provisioning finished; connected to ${SCHEMA_NAME}`);

    // Snapshot emptiness BEFORE seeding so the "a provisioned site starts
    // empty" assertion stays true regardless of test ordering.
    preSeedRowCounts = await countRows(EMPTY_ON_PROVISION_TABLES);

    await seedReferenceData();
  }, 180_000);

  afterAll(async () => {
    // Defensive: the teardown cases drop the schema themselves, but an earlier
    // failure leaves it behind and the next run must start clean.
    if (siteConnection) await siteConnection.end().catch(() => {});
    if (catalogPool) {
      await clearLifecycleState(catalogPool).catch(() => {});
      await catalogPool.end();
    }
  }, 60_000);

  /**
   * `startRun` is the production entry point and is what seeds the ten
   * `provisioning_steps` rows, so the test uses it rather than hand-inserting
   * them. Its trailing `dispatchRun` fires `runProvisioning` through
   * `setImmediate`; suppressing that lets the test await the chain itself
   * instead of racing a detached background run. Same suppression the
   * admin-provision route tests use.
   */
  async function startRunWithoutBackgroundDispatch(): Promise<number> {
    const setImmediateSpy = vi.spyOn(globalThis, 'setImmediate').mockImplementation(((_cb: unknown) => 0) as never);
    try {
      const { runId: startedRunId } = await startRun({
        input: PROVISIONING_INPUT,
        startedBy: STARTED_BY,
        catalogPool
      });
      return startedRunId;
    } finally {
      setImmediateSpy.mockRestore();
    }
  }

  async function clearLifecycleState(pool: Pool): Promise<void> {
    // Scoped to this suite's schema — other integration files share the catalog.
    // Single-table DELETEs with subqueries, not multi-table JOIN deletes: this
    // pool has no default database and MySQL rejects multi-table DELETE without
    // one even when every table is schema-qualified (ER_NO_DB_ERROR).
    await pool.query(`DELETE FROM catalog.provisioning_steps WHERE RunID IN (SELECT RunID FROM catalog.provisioning_runs WHERE SchemaName = ?)`, [SCHEMA_NAME]);
    await pool.query(`DELETE FROM catalog.provisioning_runs WHERE SchemaName = ?`, [SCHEMA_NAME]);
    await pool.query(`DELETE FROM catalog.usersiterelations WHERE SiteID IN (SELECT SiteID FROM catalog.sites WHERE SchemaName = ?)`, [SCHEMA_NAME]);
    await pool.query(`DELETE FROM catalog.sites WHERE SchemaName = ?`, [SCHEMA_NAME]);
    await deleteBackgroundJobRowsForSchema(pool);
    await pool.query(`DROP DATABASE IF EXISTS \`${SCHEMA_NAME}\``);
  }

  /** FK-safe order: events -> files -> jobs. Scoped to this suite's schema. */
  async function deleteBackgroundJobRowsForSchema(pool: Pool): Promise<void> {
    const jobIdSubquery = `SELECT JobID FROM catalog.background_jobs WHERE SchemaName = ?`;
    await pool.query(`DELETE FROM catalog.background_job_events WHERE JobID IN (${jobIdSubquery})`, [SCHEMA_NAME]);
    await pool.query(`DELETE FROM catalog.background_job_files WHERE JobID IN (${jobIdSubquery})`, [SCHEMA_NAME]);
    await pool.query(`DELETE FROM catalog.background_jobs WHERE SchemaName = ?`, [SCHEMA_NAME]);
  }

  async function countBackgroundJobRowsForSchema(): Promise<{ jobs: number; files: number; events: number }> {
    const jobIdSubquery = `SELECT JobID FROM catalog.background_jobs WHERE SchemaName = ?`;
    const [jobs] = await catalogPool.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM catalog.background_jobs WHERE SchemaName = ?`, [SCHEMA_NAME]);
    const [files] = await catalogPool.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM catalog.background_job_files WHERE JobID IN (${jobIdSubquery})`, [
      SCHEMA_NAME
    ]);
    const [events] = await catalogPool.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM catalog.background_job_events WHERE JobID IN (${jobIdSubquery})`, [
      SCHEMA_NAME
    ]);
    return { jobs: Number(jobs[0].count), files: Number(files[0].count), events: Number(events[0].count) };
  }

  async function schemaExists(): Promise<boolean> {
    const [rows] = await catalogPool.query<RowDataPacket[]>(`SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`, [SCHEMA_NAME]);
    return rows.length > 0;
  }

  /**
   * A job parked mid-flight: the state a site can genuinely be in when an admin
   * reaches for teardown. `waiting_retry` with retry budget left is what the
   * sweeper will pick up and dispatch again.
   */
  async function createParkedUploadJob(): Promise<number> {
    const job = await createUploadBackgroundJob(
      catalogPool,
      {
        schema: SCHEMA_NAME,
        plotID: plotId,
        censusID: censusId,
        uploadMode: UploadMode.REVISIONS,
        sourceFormat: SourceFormat.csv,
        formType: FormType.measurements,
        payload: {},
        files: [{ fileName: PARKED_JOB_FILE_NAME, blobContainer: BLOB_CONTAINER, blobName: `uploads/${PARKED_JOB_FILE_NAME}`, expectedRows: 1 }]
      },
      STARTED_BY
    );
    await catalogPool.query(`UPDATE catalog.background_jobs SET Status = ?, NextAttemptAt = DATE_ADD(NOW(), INTERVAL 1 MINUTE) WHERE JobID = ?`, [
      WAITING_RETRY_STATUS,
      job.jobID
    ]);
    return job.jobID;
  }

  /**
   * Runs in beforeAll, after the schema exists and after `sharedState.connection`
   * is wired up. Uses REVISIONS rather than CLEAN_REUPLOAD: the clean path
   * DELETEs every active row first, which is pointless against an empty schema
   * and, for species, carries a dependency guard this fixture has no reason to
   * exercise.
   */
  async function seedReferenceData(): Promise<void> {
    const connectionManager = ConnectionManager.getInstance();
    const transactionID = await connectionManager.beginTransaction();
    try {
      const attributeResult = await upsertAttributeRows(connectionManager, SCHEMA_NAME, ATTRIBUTE_SEED_ROWS, UploadMode.REVISIONS, transactionID);
      const speciesResult = await upsertSpeciesRows(connectionManager, SCHEMA_NAME, SPECIES_SEED_ROWS, UploadMode.REVISIONS, transactionID);
      await connectionManager.commitTransaction(transactionID);
      console.log(
        `[seed] attributes inserted=${attributeResult.insertedCount} skipped=${attributeResult.skippedCount}; ` +
          `species inserted=${speciesResult.insertedCount} skipped=${speciesResult.skippedCount}`
      );
    } catch (error) {
      await connectionManager.rollbackTransaction(transactionID);
      throw error;
    }
  }

  /** Blob access is dependency-injected, so no Azure call happens. */
  function measurementFixtureDeps(): WorkerDeps {
    return {
      fetchFileText: async (file: BackgroundJobFileRecord) => {
        if (file.fileName !== MEASUREMENT_FILE_NAME) throw new Error(`[test deps] no fixture text for ${file.fileName}`);
        return MEASUREMENT_CSV;
      }
    };
  }

  async function measurementIdsWhere(predicate: string): Promise<number[]> {
    const [rows] = await siteConnection.query<RowDataPacket[]>(
      `SELECT CoreMeasurementID FROM coremeasurements WHERE UploadFileID = ? AND ${predicate} ORDER BY CoreMeasurementID`,
      [MEASUREMENT_FILE_NAME]
    );
    return rows.map(row => Number(row.CoreMeasurementID));
  }

  async function countRows(tables: readonly string[]): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const [rows] = await siteConnection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM \`${table}\``);
      counts[table] = Number(rows[0].count);
    }
    return counts;
  }

  async function objectNamesOfType(tableType: string): Promise<string[]> {
    const [rows] = await siteConnection.query<RowDataPacket[]>(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = ?`, [
      SCHEMA_NAME,
      tableType
    ]);
    return rows.map(row => String(row.TABLE_NAME).toLowerCase());
  }

  // -------------------------------------------------------------------------
  // A. Provisioning
  // -------------------------------------------------------------------------

  describe('provisioning the site', () => {
    it('drives the run to completed with every step completed and no error recorded', async () => {
      const result = await getRunWithSteps(runId, catalogPool);
      expect(result, `run ${runId} vanished from the catalog`).not.toBeNull();

      const { run, steps } = result!;
      const stepSummary = steps.map(step => `${step.stepIndex}:${step.stepKey}=${step.status}${step.errorMessage ? ` (${step.errorMessage})` : ''}`).join('\n');
      console.log(`[provisioning] run status=${run.status}\n${stepSummary}`);

      // Per-step, not just the run status: a silently skipped step is the
      // failure mode a run-level assertion cannot see.
      expect(steps.map(step => step.stepKey)).toEqual(STEPS.map(step => step.key));
      for (const step of steps) {
        expect(step.status, `step ${step.stepKey} did not complete:\n${stepSummary}`).toBe(COMPLETED_STATUS);
        expect(step.errorMessage, `step ${step.stepKey} recorded an error`).toBeNull();
      }
      expect(run.status, `run did not complete:\n${stepSummary}`).toBe(COMPLETED_STATUS);
    });

    it('registers the site in the catalog and creates the first plot, census, and quadrat grid', async () => {
      const [siteRows] = await catalogPool.query<RowDataPacket[]>(`SELECT SiteID, SiteName, SQDimX, SQDimY FROM catalog.sites WHERE SchemaName = ?`, [
        SCHEMA_NAME
      ]);
      expect(siteRows).toHaveLength(1);
      expect(siteRows[0].SiteName).toBe(SITE_NAME);
      expect(Number(siteRows[0].SQDimX)).toBe(QUADRAT_SIZE_M);

      const [plotRows] = await siteConnection.query<RowDataPacket[]>(`SELECT PlotID, DimensionX, DimensionY FROM plots WHERE PlotName = ?`, [PLOT_NAME]);
      expect(plotRows).toHaveLength(1);
      plotId = Number(plotRows[0].PlotID);
      expect(Number(plotRows[0].DimensionX)).toBe(PLOT_DIMENSION_M);

      const [censusRows] = await siteConnection.query<RowDataPacket[]>(`SELECT CensusID FROM census WHERE PlotID = ? AND PlotCensusNumber = 1`, [plotId]);
      expect(censusRows).toHaveLength(1);
      censusId = Number(censusRows[0].CensusID);

      const [quadratRows] = await siteConnection.query<RowDataPacket[]>(`SELECT QuadratName FROM quadrats WHERE PlotID = ? ORDER BY QuadratName`, [plotId]);
      const quadratNames = quadratRows.map(row => String(row.QuadratName));
      console.log(`[provisioning] plotID=${plotId} censusID=${censusId} quadrats=${quadratNames.join(',')}`);

      expect(quadratNames).toHaveLength(EXPECTED_QUADRAT_COUNT);
      expect(quadratNames).toEqual([...EXPECTED_QUADRAT_NAMES]);
      // Guards the fixture assumption that these names are NOT the legacy
      // placeholder grid the Revisions divergence guard special-cases.
      for (const name of quadratNames) {
        expect(SEQUENTIAL_QUADRAT_NAME_PATTERN.test(name), `${name} matches the legacy placeholder grid pattern`).toBe(false);
      }
    });

    it('produces a schema that satisfies the canonical schema contract', async () => {
      const exec = async (sql: string, params: unknown[]): Promise<SchemaQueryRow[]> => {
        const [rows] = await siteConnection.query<RowDataPacket[]>(sql, params);
        return rows as SchemaQueryRow[];
      };

      const canonicalContract: SchemaContract = loadCanonicalSchemaContract();
      const liveContract: SchemaContract = await readLiveSchemaContract(exec, SCHEMA_NAME, CONTRACT_READ_TABLES);

      const { failures, extras } = compareSchemaContracts(canonicalContract, liveContract);
      if (extras.length > 0) {
        console.info(
          `[contract] ${extras.length} object(s) beyond the contract (informational):\n${extras.map(e => `[${e.table}] ${e.category} "${e.object}"`).join('\n')}`
        );
      }
      if (failures.length > 0) {
        throw new Error(`Provisioned schema violates the canonical contract (${failures.length}):\n${formatContractFailures(failures)}`);
      }
      expect(failures).toEqual([]);
      expect(liveContract.defaultCollation).toBe(TARGET_TEXT_COLLATION);
    });

    it('creates the three tables loadSchema silently drops', async () => {
      // tests/setup/local-db-setup.ts loadSchema skips statements whose chunk
      // begins with a '--' banner comment, so these three are absent from every
      // other integration suite's schema (upload-worker.test.ts creates two of
      // them inline). Production's splitter must not have that hole.
      const tables = await objectNamesOfType(BASE_TABLE_TYPE);
      for (const table of TABLES_LOADSCHEMA_DROPS) {
        expect(tables, `provisioning did not create ${table}`).toContain(table);
      }
    });

    it('creates every required view, including both taxonomy views', async () => {
      const views = await objectNamesOfType(VIEW_TYPE);
      for (const view of [...REQUIRED_VIEWS, ...TAXONOMY_VIEWS]) {
        expect(views, `provisioning did not create view ${view}`).toContain(view.toLowerCase());
      }
    });

    it('deploys every required stored procedure under the authenticated deployment account', async () => {
      const [procedures] = await siteConnection.query<RowDataPacket[]>(
        `SELECT ROUTINE_NAME, LOWER(DEFINER) AS DEFINER, LOWER(CURRENT_USER()) AS DEPLOYMENT_ACCOUNT
           FROM information_schema.ROUTINES
          WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'`,
        [SCHEMA_NAME]
      );
      const deployed = procedures.map(row => String(row.ROUTINE_NAME).toLowerCase());
      for (const procedure of REQUIRED_PROCEDURES) {
        expect(deployed, `provisioning did not deploy ${procedure}`).toContain(procedure.toLowerCase());
      }

      const expectedDefiner = String(procedures[0].DEPLOYMENT_ACCOUNT).toLowerCase();
      for (const procedure of procedures) {
        expect(String(procedure.DEFINER).toLowerCase(), `${procedure.ROUTINE_NAME} has a stale or environment-specific definer`).toBe(expectedDefiner);
      }
    });

    it('seeds the site-specific validation catalog', async () => {
      const [rows] = await siteConnection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM sitespecificvalidations`);
      expect(Number(rows[0].count), 'seed_validations completed but left no validation rules').toBeGreaterThan(0);
    });

    it('has no measurement or reference data — a provisioned site starts empty', async () => {
      // Asserted from the pre-seed snapshot: this is the precondition that
      // forces the seeding step to exist at all.
      for (const table of EMPTY_ON_PROVISION_TABLES) {
        expect(preSeedRowCounts[table], `${table} should be empty in a freshly provisioned schema`).toBe(0);
      }
      // measurement_errors is the one thing tablestructures.sql seeds inline.
      const [errorCatalog] = await siteConnection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM measurement_errors`);
      expect(Number(errorCatalog[0].count), 'the ingestion error catalog should be seeded by the canonical DDL').toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // B. Reference data, written through the production writers
  // -------------------------------------------------------------------------

  describe('seeding reference data into the provisioned site', () => {
    it('writes every attribute code through upsertAttributeRows', async () => {
      const [rows] = await siteConnection.query<RowDataPacket[]>(`SELECT Code, Status FROM attributes WHERE IsActive = 1 ORDER BY Code`);
      const codes = rows.map(row => String(row.Code));
      expect(codes).toEqual(ATTRIBUTE_SEED_ROWS.map(row => row.code));

      // Ingestion silently drops measurements carrying an unknown code, so a
      // missing attribute would surface as a PASSING upload with wrong data.
      // Pin the status values the fixture relies on.
      const statusByCode = new Map(rows.map(row => [String(row.Code), String(row.Status)]));
      expect(statusByCode.get('A')).toBe('alive');
      expect(statusByCode.get('D')).toBe('dead');
    });

    it('writes species with their genus and family resolved through upsertSpeciesRows', async () => {
      const [rows] = await siteConnection.query<RowDataPacket[]>(
        `SELECT sp.SpeciesCode, sp.SpeciesName, g.Genus, f.Family
           FROM species sp
           LEFT JOIN genus g ON g.GenusID = sp.GenusID
           LEFT JOIN family f ON f.FamilyID = g.FamilyID
          WHERE sp.IsActive = 1
          ORDER BY sp.SpeciesCode`
      );
      const seeded = rows.map(row => ({
        code: String(row.SpeciesCode),
        name: row.SpeciesName === null ? null : String(row.SpeciesName),
        genus: row.Genus === null ? null : String(row.Genus),
        family: row.Family === null ? null : String(row.Family)
      }));
      console.log(`[seed] species rows: ${JSON.stringify(seeded)}`);

      expect(seeded.map(row => row.code)).toEqual([SEEDED_SPECIES_CODE, UNUSED_SPECIES_CODE, SECOND_SPECIES_CODE].sort());

      // The taxonomy hierarchy is what makes these usable by ingestion; a
      // species row with a NULL GenusID would resolve differently.
      const acer = seeded.find(row => row.code === SEEDED_SPECIES_CODE);
      expect(acer).toBeDefined();
      expect(acer!.name).toBe('rubrum');
      expect(acer!.genus).toBe('Acer');
      expect(acer!.family).toBe('Sapindaceae');
    });

    it('exposes the seeded taxonomy through alltaxonomiesview', async () => {
      // Proves the provisioned view is not merely present but actually joins —
      // the datagrid reads this, and a broken view is invisible to a
      // table-existence check.
      const [rows] = await siteConnection.query<RowDataPacket[]>(`SELECT SpeciesCode, Genus, Family FROM alltaxonomiesview ORDER BY SpeciesCode`);
      expect(rows.map(row => String(row.SpeciesCode))).toEqual([SEEDED_SPECIES_CODE, UNUSED_SPECIES_CODE, SECOND_SPECIES_CODE].sort());
    });
  });

  // -------------------------------------------------------------------------
  // B2. Measurement upload through the async background-job pipeline
  // -------------------------------------------------------------------------

  describe('uploading measurements into the provisioned site', () => {
    it('ingests a measurement file end-to-end through the background worker', async () => {
      const job = await createUploadBackgroundJob(
        catalogPool,
        {
          schema: SCHEMA_NAME,
          plotID: plotId,
          censusID: censusId,
          uploadMode: UploadMode.REVISIONS,
          sourceFormat: SourceFormat.csv,
          formType: FormType.measurements,
          idempotencyKey: IDEMPOTENCY_KEY,
          payload: { selectedDelimiters: { [MEASUREMENT_FILE_NAME]: ',' } },
          files: [
            {
              fileName: MEASUREMENT_FILE_NAME,
              blobContainer: BLOB_CONTAINER,
              blobName: `uploads/${MEASUREMENT_FILE_NAME}`,
              expectedRows: MEASUREMENT_ROW_COUNT
            }
          ]
        },
        STARTED_BY
      );
      uploadJobId = job.jobID;
      console.log(`[upload] created jobID=${uploadJobId} for ${SCHEMA_NAME}`);

      await runJobIfClaimable(uploadJobId, measurementFixtureDeps());

      const [jobRows] = await catalogPool.query<RowDataPacket[]>(
        `SELECT Status, Phase, PercentComplete, LastError FROM catalog.background_jobs WHERE JobID = ?`,
        [uploadJobId]
      );
      expect(jobRows).toHaveLength(1);
      console.log(`[upload] job status=${jobRows[0].Status} phase=${jobRows[0].Phase} percent=${jobRows[0].PercentComplete} lastError=${jobRows[0].LastError}`);
      expect(jobRows[0].LastError, 'job recorded an error').toBeNull();
      expect(jobRows[0].Status).toBe(COMPLETED_JOB_STATUS);
      expect(Number(jobRows[0].PercentComplete)).toBe(FULLY_COMPLETE_PERCENT);

      // Ingested rows carry a StemGUID; a NULL StemGUID is this schema's
      // representation of a failed/unresolved measurement.
      const ingested = await measurementIdsWhere('StemGUID IS NOT NULL');
      const rejected = await measurementIdsWhere('StemGUID IS NULL');
      console.log(`[upload] ingested=${ingested.length} rejected=${rejected.length}`);
      expect(ingested).toHaveLength(VALID_MEASUREMENT_ROW_COUNT);
      expect(rejected).toHaveLength(REJECT_MEASUREMENT_ROW_COUNT);

      // The reject must be catalogued, not silently dropped. This is the check
      // that proves the PROVISIONED bulkingestionprocess records failures.
      const [errorLinks] = await siteConnection.query<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM measurement_error_log WHERE MeasurementID IN (?)`, [
        rejected
      ]);
      expect(Number(errorLinks[0].count), 'the rejected row has no measurement_error_log entry').toBeGreaterThan(0);
    });

    it('resolves every ingested row against the provisioned quadrats and seeded species', async () => {
      // Guards against a "green" ingest that silently coerced quadrat or
      // species references — the failure mode an ingested-count check misses.
      const [rows] = await siteConnection.query<RowDataPacket[]>(
        `SELECT q.QuadratName, sp.SpeciesCode
           FROM coremeasurements cm
           JOIN stems st ON st.StemGUID = cm.StemGUID
           JOIN quadrats q ON q.QuadratID = st.QuadratID
           JOIN trees t ON t.TreeID = st.TreeID
           JOIN species sp ON sp.SpeciesID = t.SpeciesID
          WHERE cm.StemGUID IS NOT NULL`
      );
      expect(rows).toHaveLength(VALID_MEASUREMENT_ROW_COUNT);

      const quadratNames = new Set(rows.map(row => String(row.QuadratName)));
      const speciesCodes = new Set(rows.map(row => String(row.SpeciesCode)));
      console.log(`[upload] resolved quadrats=${[...quadratNames].join(',')} species=${[...speciesCodes].join(',')}`);

      for (const name of quadratNames) {
        expect(EXPECTED_QUADRAT_NAMES, `ingest resolved an unexpected quadrat: ${name}`).toContain(name);
      }
      expect([...speciesCodes].sort()).toEqual([SEEDED_SPECIES_CODE, SECOND_SPECIES_CODE].sort());
      // The seeded-but-unreferenced code must not appear; if it did, resolution
      // is matching something other than the CSV's species column.
      expect(speciesCodes.has(UNUSED_SPECIES_CODE)).toBe(false);
    });

    it('records the batch in uploadmetrics and releases the upload session', async () => {
      const [metrics] = await siteConnection.query<RowDataPacket[]>(`SELECT status FROM uploadmetrics WHERE fileID = ?`, [MEASUREMENT_FILE_NAME]);
      expect(metrics.map(row => String(row.status))).toEqual([UPLOADMETRICS_COMPLETED]);

      // upload_sessions and validation_runs exist here only because PRODUCTION
      // provisioning created them — loadSchema drops both, so these two
      // assertions are meaningless in every other integration suite.
      const [sessions] = await siteConnection.query<RowDataPacket[]>(`SELECT state FROM upload_sessions WHERE file_id = ?`, [`async-job-${uploadJobId}`]);
      expect(sessions.length, 'the worker never opened an upload session').toBeGreaterThan(0);
      expect(
        sessions.every(row => String(row.state) !== 'active'),
        'an upload session was left active'
      ).toBe(true);

      const [validationRuns] = await siteConnection.query<RowDataPacket[]>(`SELECT Status FROM validation_runs WHERE CensusID = ?`, [censusId]);
      expect(validationRuns.length, 'no validation run was recorded').toBeGreaterThan(0);
      expect(validationRuns.map(row => String(row.Status))).toContain(COMPLETED_STATUS);
    });

    it('returns the existing job for a repeated idempotency key instead of ingesting twice', async () => {
      const ingestedBefore = (await measurementIdsWhere('StemGUID IS NOT NULL')).length;

      const duplicate = await createUploadBackgroundJob(
        catalogPool,
        {
          schema: SCHEMA_NAME,
          plotID: plotId,
          censusID: censusId,
          uploadMode: UploadMode.REVISIONS,
          sourceFormat: SourceFormat.csv,
          formType: FormType.measurements,
          idempotencyKey: IDEMPOTENCY_KEY,
          payload: { selectedDelimiters: { [MEASUREMENT_FILE_NAME]: ',' } },
          files: [
            {
              fileName: MEASUREMENT_FILE_NAME,
              blobContainer: BLOB_CONTAINER,
              blobName: `uploads/${MEASUREMENT_FILE_NAME}`,
              expectedRows: MEASUREMENT_ROW_COUNT
            }
          ]
        },
        STARTED_BY
      );

      expect(duplicate.jobID, 'a second job was created for the same idempotency key').toBe(uploadJobId);
      expect((await measurementIdsWhere('StemGUID IS NOT NULL')).length).toBe(ingestedBefore);
    });
  });

  // -------------------------------------------------------------------------
  // C. Teardown
  //
  // These run last and are order-dependent: the final case drops the schema.
  // -------------------------------------------------------------------------

  describe('tearing the site down', () => {
    it('refuses teardown while a background upload job for the schema is still live', async () => {
      const jobRowsBefore = await countBackgroundJobRowsForSchema();
      const jobID = await createParkedUploadJob();
      console.log(`[teardown] parked jobID=${jobID} in ${WAITING_RETRY_STATUS} for ${SCHEMA_NAME}`);

      // catalog.background_jobs.SchemaName is NOT NULL and findRunnableJobIDs
      // filters on status/NextAttemptAt only — it never checks that the schema
      // still exists. Dropping the database out from under a live job leaves
      // the sweeper dispatching against a schema that is gone, burning the
      // retry budget on "unknown database" until MaxRetries.
      await expect(teardownProvisionedSite(runId, SCHEMA_NAME, catalogPool, STARTED_BY)).rejects.toMatchObject({
        kind: CONFLICT_ERROR_KIND
      });

      // Teardown must be all-or-nothing: nothing may have been dropped or
      // deleted on the refusal path.
      expect(await schemaExists(), 'schema was dropped despite the refusal').toBe(true);
      const [siteRows] = await catalogPool.query<RowDataPacket[]>(`SELECT SiteID FROM catalog.sites WHERE SchemaName = ?`, [SCHEMA_NAME]);
      expect(siteRows, 'catalog site row was deleted despite the refusal').toHaveLength(1);
      expect((await countBackgroundJobRowsForSchema()).jobs, 'job rows were deleted despite the refusal').toBe(jobRowsBefore.jobs + 1);
    });

    it('still refuses on a mismatched confirmation, without touching the background job rows', async () => {
      const before = await countBackgroundJobRowsForSchema();

      await expect(teardownProvisionedSite(runId, WRONG_CONFIRMATION, catalogPool, STARTED_BY)).rejects.toBeInstanceOf(ProvisioningError);

      expect(await schemaExists()).toBe(true);
      expect(await countBackgroundJobRowsForSchema(), 'confirmation-mismatch path must not partially clean up').toEqual(before);
    });

    it('tears down cleanly once the job reaches a terminal state, leaving no orphan job rows', async () => {
      await catalogPool.query(`UPDATE catalog.background_jobs SET Status = ?, FinishedAt = NOW() WHERE SchemaName = ?`, [CANCELLED_STATUS, SCHEMA_NAME]);

      await teardownProvisionedSite(runId, SCHEMA_NAME, catalogPool, STARTED_BY);

      expect(await schemaExists(), 'schema survived teardown').toBe(false);

      const [siteRows] = await catalogPool.query<RowDataPacket[]>(`SELECT SiteID FROM catalog.sites WHERE SchemaName = ?`, [SCHEMA_NAME]);
      expect(siteRows, 'catalog site row survived teardown').toHaveLength(0);

      // The orphan-row assertion. Terminal jobs and their files/events must go
      // with the schema; anything left behind references a database that no
      // longer exists.
      expect(await countBackgroundJobRowsForSchema()).toEqual({ jobs: 0, files: 0, events: 0 });
    });
  });
});
