/**
 * #304 — Harvard-scale pending-validation rerun.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * A read-only production audit of census13 found 116227 active coremeasurements
 * rows: 116226 already IsValidated = TRUE, and exactly ONE left pending/failed.
 * The latest census separately has 130514 rows with many parked ingestion
 * failures that scientific validation does not (and must not) repair. This
 * suite proves the #304 fix — a failed-only rerun that resolves a single
 * previously-flagged row WITHOUT a manual IsValidated reset — holds at that
 * production shape, using the REAL runCensusValidations orchestrator and the
 * REAL (unmocked) ConnectionManager singleton, not a mocked connection.query()
 * bridge. It does NOT prove or disprove the separate, unproven large-data Azure
 * crash referenced in the issue — that remains out of scope here.
 *
 * ── Why no vi.mock('@/lib/db/connectionmanager') ──────────────────────────
 * validation-orchestrator.test.ts (and most other integration suites) bridge
 * ConnectionManager.executeQuery straight to connection.query(), which hides
 * mysql2's prepared-statement handling of `IN (?)` placeholders used by real
 * production code paths. This suite instead calls ConnectionManager.getInstance()
 * directly — identical to connectionmanager.integration.test.ts — so every
 * query the orchestrator issues goes through the production pool exactly as it
 * would against Azure MySQL (pointed at local docker by
 * vitest.integration.config.mts for every integration test).
 *
 * ── Bounding the real orchestrator and raw queries ──────────────────────────
 * Every query this suite waits on — orchestrator-issued or raw — is bounded
 * by the REAL primitives.runQuery (lib/db/primitives.ts), never a mock or a
 * duplicate cancellation implementation:
 *   - Orchestrator queries funnel through ConnectionManager.executeQuery's
 *     single call into runQuery (connectionmanager.ts:220). A vi.spyOn on the
 *     real, imported primitives.runQuery delegates every call to the captured
 *     ORIGINAL implementation, only shortening timeoutMs and refusing to
 *     start a new statement once a shared overall deadline has elapsed. See
 *     installRunQueryDeadlineGuard below.
 *   - Raw queries on this file's own `connection` (seeding + every assertion)
 *     call runQuery directly (see queryRaw below), so a slow raw statement
 *     hits the exact same QueryTimeoutError -> connection.destroy() ->
 *     killQueryOnThread quarantine path production relies on, rather than a
 *     second, duplicated cancellation implementation.
 * runCensusValidations itself is always fully awaited — never raced or
 * abandoned — so its own rollback/run-record finalization completes, still
 * bounded, before any teardown.
 *
 * ── Fixture shape ───────────────────────────────────────────────────────────
 * FIXTURE_ROW_COUNT - 1 rows are bulk-seeded already IsValidated = TRUE (via
 * INSERT...SELECT over a non-recursive digit generator, not a per-row await
 * loop) plus exactly one pending target row carrying a deliberate
 * ValidateFindAbnormallyHighDBH violation (MeasuredDBH = 9999mm) — mirroring
 * the census13 audit's "116226 valid, 1 pending" shape. A single census is
 * sufficient: every enabled validation already runs cleanly on one census in
 * validation-orchestrator.test.ts, and the DBH growth/shrinkage and
 * quadrat-mismatch/coordinate-drift pairs only compare across censuses when a
 * prior census exists, so they are no-ops here rather than false failures.
 * This single-census shape matches the audited census13 incident; it says
 * nothing about cross-census validation performance, which is out of scope.
 *
 * MAX_FIXTURE_ROW_COUNT below is a safety CEILING, deliberately larger than
 * HARVARD_SCALE_REFERENCE_ROW_COUNT — the two are not meant to be equal, and
 * neither row count is asserted to be "the" production scale beyond the one
 * audited reference size.
 *
 * ── Run commands ────────────────────────────────────────────────────────────
 *   Normal (fast, FIXTURE_ROW_COUNT = 1000; also runs the bounded
 *   timeout-guard demonstration tests described above installRunQueryDeadlineGuard and queryRaw):
 *     npm run test:integration -- tests/integration/validation-rerun-scale.integration.test.ts
 *
 *   Manual Harvard-scale run (FIXTURE_ROW_COUNT = 116227, the audited reference):
 *     VALIDATION_RERUN_SCALE_ROW_COUNT=116227 npm run test:integration -- tests/integration/validation-rerun-scale.integration.test.ts
 *
 * Prerequisites: docker compose up -d mysql
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createConnection, type Connection, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import { DEFAULT_TEST_CONFIG, setupTestDatabase, teardownTestDatabase, type TestData, type TestDatabaseConfig } from '../setup/local-db-setup';
import ConnectionManager from '@/lib/db/connectionmanager';
import * as dbPrimitives from '@/lib/db/primitives';
import { COORDINATE_DRIFT_PROCEDURE, QUADRAT_MISMATCH_PROCEDURE, runCensusValidations } from '@/lib/uploads/validation-orchestrator';
import { DBH_GROWTH_PROCEDURE, DBH_SHRINKAGE_PROCEDURE } from '@/config/dbhchangevalidations';

// ---------------------------------------------------------------------------
// Safety guard — setupTestDatabase DROPs/CREATEs its schema AND the real
// ConnectionManager pool will write through whatever host AZURE_SQL_SERVER
// resolves to. Refuse before any setup/write unless BOTH are local. Mirrors
// ingestion-scale-benchmark.integration.test.ts's assertLocalHostOrRefuse.
// ---------------------------------------------------------------------------

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'] as const;

function assertLocalHostOrRefuse(): void {
  const connectionManagerHost = process.env.AZURE_SQL_SERVER;
  if (!connectionManagerHost || !LOCAL_HOSTS.includes(connectionManagerHost as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(
      `[validation-rerun-scale] REFUSING TO RUN: ConnectionManager host (AZURE_SQL_SERVER) is '${connectionManagerHost}', not local. ` +
        'This suite seeds and mutates rows through the production ConnectionManager pool and must only run against a local test database.'
    );
  }
  const fixtureHost = DEFAULT_TEST_CONFIG.host;
  if (!LOCAL_HOSTS.includes(fixtureHost as (typeof LOCAL_HOSTS)[number])) {
    throw new Error(`[validation-rerun-scale] REFUSING TO RUN: TEST_DB_HOST (fixture host) is '${fixtureHost}', not local. Aborting before any setup/write.`);
  }
}

// ---------------------------------------------------------------------------
// Row-count bounds — a named, explicitly validated env var selects the
// Harvard-scale size; the default keeps the normal suite run fast. No path
// here ever scales beyond MAX_FIXTURE_ROW_COUNT.
// ---------------------------------------------------------------------------

const SCALE_ROW_COUNT_ENV_VAR = 'VALIDATION_RERUN_SCALE_ROW_COUNT';
const DEFAULT_FIXTURE_ROW_COUNT = 1000;
/**
 * Live production census13 audit (read-only, non-identifying): 116227 active
 * coremeasurements rows, 116226 already valid, exactly 1 pending. This is the
 * reference size for the manual scale run — never a default, so the normal
 * suite run stays fast.
 */
const HARVARD_SCALE_REFERENCE_ROW_COUNT = 116227;
/** Safety ceiling only — intentionally larger than, and unrelated in value to, HARVARD_SCALE_REFERENCE_ROW_COUNT. */
const MAX_FIXTURE_ROW_COUNT = 200000;
const MIN_FIXTURE_ROW_COUNT = 2; // 1 pending target + at least 1 already-valid row

function resolveFixtureRowCount(): number {
  const raw = process.env[SCALE_ROW_COUNT_ENV_VAR];
  if (raw === undefined || raw === '') return DEFAULT_FIXTURE_ROW_COUNT;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_FIXTURE_ROW_COUNT) {
    throw new Error(
      `[validation-rerun-scale] ${SCALE_ROW_COUNT_ENV_VAR}=${JSON.stringify(raw)} must be an integer >= ${MIN_FIXTURE_ROW_COUNT} ` +
        '(1 pending target + at least 1 already-valid row).'
    );
  }
  if (parsed > MAX_FIXTURE_ROW_COUNT) {
    throw new Error(
      `[validation-rerun-scale] ${SCALE_ROW_COUNT_ENV_VAR}=${parsed} exceeds the safety cap of ${MAX_FIXTURE_ROW_COUNT}. ` +
        'This fixture never scales beyond an explicitly audited reference size.'
    );
  }
  return parsed;
}

const FIXTURE_ROW_COUNT = resolveFixtureRowCount();
const ALREADY_VALID_ROW_COUNT = FIXTURE_ROW_COUNT - 1;

// ---------------------------------------------------------------------------
// Orchestrator query-deadline guard — see the "Bounding the real orchestrator
// and raw queries" header section above.
// ---------------------------------------------------------------------------

/** Short compared to production's 11-minute primitives.DEFAULT_QUERY_TIMEOUT_MS, but generous for one Harvard-scale bulk statement. */
const PER_QUERY_TIMEOUT_MS = 5 * 60 * 1000;
/** Overall wall-clock budget for one whole runCensusValidations() call. */
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

class OrchestratorDeadlineExceededError extends Error {
  constructor(label: string, overallDeadlineMs: number) {
    super(`[validation-rerun-scale] ${label} exceeded its ${overallDeadlineMs}ms overall deadline before a new query could start`);
    this.name = 'OrchestratorDeadlineExceededError';
  }
}

/**
 * Spies on the REAL primitives.runQuery and delegates every call — same
 * connection, query text, and params — to the captured ORIGINAL
 * implementation, adding two bounds on top of production's single
 * 11-minute default:
 *   1. a short per-query timeout (`perQueryTimeoutMs`), so a runaway
 *      statement hits runQuery's own QueryTimeoutError -> destroy() ->
 *      killQueryOnThread path (lib/db/primitives.ts) quickly instead of
 *      after 11 minutes;
 *   2. a shared overall deadline (`overallDeadlineMs`): once elapsed, the
 *      spy throws OrchestratorDeadlineExceededError and refuses to start a
 *      new statement at all. The error carries no MySQL code, so
 *      isRetryableValidationExecutionError (processorhelperfunctions.tsx)
 *      treats it as non-retryable and the caller rolls back immediately
 *      instead of exhausting its own bounded retry loop (MAX_ATTEMPTS=10).
 *
 * `vi.spyOn` on a named export works because Vitest's own module transform
 * keeps this project's source-module exports reconfigurable; nothing here
 * fakes ConnectionManager or substitutes a result.
 *
 * Callers MUST restore() in a `finally`, after fully awaiting the guarded
 * call (never Promise.race), so the orchestrator's own error handling runs
 * to completion under the same bound before the guard is lifted.
 */
function installRunQueryDeadlineGuard(label: string, overallDeadlineMs: number, perQueryTimeoutMs: number = PER_QUERY_TIMEOUT_MS): { restore: () => void } {
  const deadlineAt = Date.now() + overallDeadlineMs;
  const originalRunQuery = dbPrimitives.runQuery;
  const spy = vi.spyOn(dbPrimitives, 'runQuery').mockImplementation(async (...args: Parameters<typeof dbPrimitives.runQuery>) => {
    const [connection, query, params] = args;
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      throw new OrchestratorDeadlineExceededError(label, overallDeadlineMs);
    }
    return originalRunQuery(connection, query, params, Math.min(perQueryTimeoutMs, remainingMs));
  });
  return {
    restore: () => {
      spy.mockRestore();
    }
  };
}

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const VALID_TAG_PREFIX = 'VRS';
const BULK_STEM_TAG = 'S0';
const TARGET_TREE_TAG = 'PENDTGT1'; // deliberately does not start with VALID_TAG_PREFIX
const TARGET_STEM_TAG = 'S0';
const MEASUREMENT_DATE = '2024-06-01'; // inside the seeded census bounds 2024-01-01..2024-12-31
const VALID_MEASURED_DBH_MM = 100;
const VALID_MEASURED_HOM_M = 1.3;
const CORRECTED_TARGET_DBH_MM = 150; // well below the 3500mm abnormal-DBH threshold

// ValidateFindAbnormallyHighDBH (ValidationID 15) flags MeasuredDBH >= 3500mm
// (after plots.DefaultDBHUnits conversion) — the only enabled validation
// trippable with a single census and no specieslimits rows, matching
// validation-orchestrator.test.ts's choice for the same reason.
const ABNORMAL_DBH_VALIDATION_ID = 15;
const ABNORMAL_DBH_PROCEDURE = 'ValidateFindAbnormallyHighDBH';
const ABNORMAL_TARGET_DBH_MM = 9999;
const VALIDATION_ERROR_SOURCE = 'validation';

const DIGITS_0_9 =
  'SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9';

/**
 * Builds a non-recursive digit generator sized to the requested row count.
 * MySQL's default cte_max_recursion_depth (1000) would reject a recursive CTE
 * for a Harvard-scale fixture, so this composes `digitCount` CROSS JOINed
 * copies of DIGITS_0_9 instead — the same non-recursive technique as
 * validation-reset-recheck.integration.test.ts's FOUR_DIGIT_NUMBER_GENERATOR,
 * sized dynamically so the default 1000-row suite run doesn't pay for a
 * million-row cross join it doesn't need.
 */
function buildNumberGenerator(digitCount: number): string {
  const aliases = Array.from({ length: digitCount }, (_, index) => `d${index}`);
  const selectExpr = aliases.map((alias, index) => `${alias}.n * ${10 ** index}`).join(' + ');
  const fromClause = aliases.map(alias => `(${DIGITS_0_9}) ${alias}`).join(', ');
  return `SELECT ${selectExpr} AS n FROM ${fromClause}`;
}

/** Smallest digit count whose generator covers every value in [0, exclusiveUpperBound). */
function digitsNeededFor(exclusiveUpperBound: number): number {
  return Math.max(1, String(Math.max(exclusiveUpperBound - 1, 0)).length);
}

/** BIT(1) columns (IsValidated) come back from mysql2 as 1-byte Buffers. */
function mysqlBitToNumber(value: unknown): number {
  if (Buffer.isBuffer(value)) return value[0];
  return Number(value);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('runCensusValidations — Harvard-scale pending-validation rerun (#304)', () => {
  let connection: Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;
  let schema: string;
  let plotID: number;
  let censusID: number;
  let quadratID: number;
  let speciesID: number;

  const connectionManager = ConnectionManager.getInstance();

  beforeAll(async () => {
    assertLocalHostOrRefuse();

    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
    schema = config.database;
    plotID = testData.plots[0].plotID;
    censusID = testData.census[0].censusID;

    const quadratName = testData.quadrats[0].QuadratName || testData.quadrats[0].Quadrat;
    const quadratRows = await queryRaw<RowDataPacket[]>(
      'SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ?',
      [quadratName, plotID],
      LOOKUP_QUERY_TIMEOUT_MS
    );
    quadratID = Number(quadratRows[0].QuadratID);

    const speciesCode = testData.species[0].SpeciesCode || testData.species[0].Mnemonic;
    const speciesRows = await queryRaw<RowDataPacket[]>('SELECT SpeciesID FROM species WHERE SpeciesCode = ?', [speciesCode], LOOKUP_QUERY_TIMEOUT_MS);
    speciesID = Number(speciesRows[0].SpeciesID);

    console.log(
      `[validation-rerun-scale] schema=${schema} plotID=${plotID} censusID=${censusID} FIXTURE_ROW_COUNT=${FIXTURE_ROW_COUNT} ` +
        `(${SCALE_ROW_COUNT_ENV_VAR}=${process.env[SCALE_ROW_COUNT_ENV_VAR] ?? '<unset, using default>'}, Harvard reference=${HARVARD_SCALE_REFERENCE_ROW_COUNT})`
    );
  }, 120000);

  afterAll(async () => {
    // Best-effort bookkeeping sweep, not a cancellation mechanism: every
    // guarded call above is fully awaited to settlement before this runs, so
    // no transaction should be outstanding. Tolerates a thrown test leaving a
    // transactionMeta entry behind.
    await connectionManager.cleanupStaleTransactions(0).catch(() => undefined);
    await connectionManager.closeConnection();

    // `connection` may already be destroyed: queryRaw's timeout path delegates
    // to the real primitives.runQuery, which destroys a timed-out connection
    // exactly like production does. Never hand a possibly-dead connection to
    // teardownTestDatabase — always drop the schema through a fresh one. Also
    // tolerate beforeAll never reaching setupTestDatabase (config unset).
    if (connection) {
      await connection.end().catch(() => undefined);
    }
    if (!config) return;
    const teardownConnection = await createConnection(config);
    await teardownTestDatabase(teardownConnection, config);
  });

  // -------------------------------------------------------------------------
  // Raw query bound — every statement this suite issues directly on its own
  // `connection` (bulk seeding, every assertion) bypasses ConnectionManager,
  // so installRunQueryDeadlineGuard above cannot see it. queryRaw gives these
  // the SAME real bound by calling primitives.runQuery directly: on timeout
  // it destroys `connection` and issues KILL QUERY via the production pool
  // (killQueryOnThread) — no duplicate cancellation logic lives here. A
  // timed-out raw query therefore destroys THIS connection (afterAll above
  // never reuses it for teardown); unresolved cancellation failures are
  // already logged by killQueryOnThread itself (lib/db/primitives.ts).
  // -------------------------------------------------------------------------

  /** Generous for one bulk INSERT...SELECT at Harvard scale; same order as PER_QUERY_TIMEOUT_MS. */
  const SEED_QUERY_TIMEOUT_MS = 5 * 60 * 1000;
  /** Keeps beforeAll's two single-row lookups comfortably inside its own 120000ms hook timeout (below). */
  const LOOKUP_QUERY_TIMEOUT_MS = 30 * 1000;

  async function queryRaw<T = any>(sql: string, params?: unknown[], timeoutMs: number = SEED_QUERY_TIMEOUT_MS): Promise<T> {
    return dbPrimitives.runQuery(connection as unknown as PoolConnection, sql, params as any[] | undefined, timeoutMs);
  }

  // -------------------------------------------------------------------------
  // Seeding helpers — bulk INSERT...SELECT, never a per-row await loop.
  // -------------------------------------------------------------------------

  /** Bulk-seeds `count` already-valid (IsValidated = TRUE) trees/stems/coremeasurements. */
  async function seedAlreadyValidRows(count: number): Promise<void> {
    if (count <= 0) return;
    const numberGenerator = buildNumberGenerator(digitsNeededFor(count));

    await queryRaw(
      `INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive)
       SELECT CONCAT(?, numbers.n), ?, ?, 1
       FROM (${numberGenerator}) numbers
       WHERE numbers.n < ?`,
      [VALID_TAG_PREFIX, speciesID, censusID, count]
    );
    await queryRaw(
      `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
       SELECT TreeID, ?, CensusID, ?, 0, 0, 1
       FROM trees
       WHERE CensusID = ? AND TreeTag LIKE CONCAT(?, '%')`,
      [quadratID, BULK_STEM_TAG, censusID, VALID_TAG_PREFIX]
    );
    await queryRaw(
      `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
       SELECT s.StemGUID, s.CensusID, ?, ?, ?, 1, 1
       FROM stems s
       JOIN trees t ON t.TreeID = s.TreeID
       WHERE t.CensusID = ? AND t.TreeTag LIKE CONCAT(?, '%')`,
      [VALID_MEASURED_DBH_MM, VALID_MEASURED_HOM_M, MEASUREMENT_DATE, censusID, VALID_TAG_PREFIX]
    );
  }

  /**
   * Seeds exactly one pending (IsValidated = NULL) row carrying a deliberate
   * ValidateFindAbnormallyHighDBH violation. insertDirectMeasurements in
   * local-db-setup.ts hardcodes IsValidated = 1, so this uses a raw
   * three-statement insert instead — the only intentionally-pending row in
   * the fixture, matching the census13 audit's "116226 valid, 1 pending" shape.
   */
  async function seedPendingTarget(): Promise<number> {
    await queryRaw('INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)', [TARGET_TREE_TAG, speciesID, censusID]);
    const treeRows = await queryRaw<RowDataPacket[]>('SELECT TreeID FROM trees WHERE TreeTag = ? AND CensusID = ?', [TARGET_TREE_TAG, censusID]);
    const treeID = Number(treeRows[0].TreeID);

    await queryRaw('INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, 0, 0, 1)', [
      treeID,
      quadratID,
      censusID,
      TARGET_STEM_TAG
    ]);
    const stemRows = await queryRaw<RowDataPacket[]>('SELECT StemGUID FROM stems WHERE TreeID = ? AND CensusID = ?', [treeID, censusID]);
    const stemGUID = Number(stemRows[0].StemGUID);

    await queryRaw(
      'INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive) VALUES (?, ?, ?, ?, ?, NULL, 1)',
      [stemGUID, censusID, ABNORMAL_TARGET_DBH_MM, VALID_MEASURED_HOM_M, MEASUREMENT_DATE]
    );
    const measurementRows = await queryRaw<RowDataPacket[]>('SELECT CoreMeasurementID FROM coremeasurements WHERE StemGUID = ? AND CensusID = ?', [
      stemGUID,
      censusID
    ]);
    return Number(measurementRows[0].CoreMeasurementID);
  }

  // -------------------------------------------------------------------------
  // Read helpers
  // -------------------------------------------------------------------------

  async function computeExpectedTotalSteps(): Promise<number> {
    const rows = await queryRaw<RowDataPacket[]>('SELECT ProcedureName FROM sitespecificvalidations WHERE IsEnabled = 1');
    const names = new Set(rows.map(row => String(row.ProcedureName)));
    let steps = names.size;
    if (names.has(DBH_GROWTH_PROCEDURE) && names.has(DBH_SHRINKAGE_PROCEDURE)) steps -= 1;
    if (names.has(QUADRAT_MISMATCH_PROCEDURE) && names.has(COORDINATE_DRIFT_PROCEDURE)) steps -= 1;
    return steps;
  }

  async function fetchValidationRuns(): Promise<RowDataPacket[]> {
    return queryRaw<RowDataPacket[]>(
      `SELECT RunID, Status, TotalSteps, CompletedSteps, FailedSteps, CompletedAt
       FROM validation_runs WHERE PlotID = ? AND CensusID = ? ORDER BY RunID`,
      [plotID, censusID]
    );
  }

  async function fetchTargetIsValidated(targetID: number): Promise<number | null> {
    const rows = await queryRaw<RowDataPacket[]>('SELECT IsValidated FROM coremeasurements WHERE CoreMeasurementID = ?', [targetID]);
    const raw = rows[0]?.IsValidated;
    return raw === null || raw === undefined ? null : mysqlBitToNumber(raw);
  }

  async function fetchUnresolvedTargetErrorCount(targetID: number): Promise<number> {
    const rows = await queryRaw<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM measurement_error_log mel
       JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE mel.MeasurementID = ? AND me.ErrorSource = ? AND me.ErrorCode = ? AND mel.IsResolved = FALSE`,
      [targetID, VALIDATION_ERROR_SOURCE, String(ABNORMAL_DBH_VALIDATION_ID)]
    );
    return Number(rows[0].count);
  }

  async function fetchValidatedTrueCount(): Promise<number> {
    const rows = await queryRaw<RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM coremeasurements WHERE CensusID = ? AND StemGUID IS NOT NULL AND IsValidated = TRUE',
      [censusID]
    );
    return Number(rows[0].count);
  }

  async function fetchViewCount(table: 'measurementssummary' | 'viewfulltable'): Promise<number> {
    const rows = await queryRaw<RowDataPacket[]>(`SELECT COUNT(*) AS count FROM ${table} WHERE PlotID = ? AND CensusID = ?`, [plotID, censusID]);
    return Number(rows[0].count);
  }

  async function fetchTargetSummary(targetID: number): Promise<{ isValidated: number; errors: string | null }> {
    const rows = await queryRaw<RowDataPacket[]>('SELECT IsValidated, Errors FROM measurementssummary WHERE CoreMeasurementID = ?', [targetID]);
    expect(rows, 'the target must have a row in the refreshed summary view').toHaveLength(1);
    return { isValidated: mysqlBitToNumber(rows[0].IsValidated), errors: rows[0].Errors ?? null };
  }

  // -------------------------------------------------------------------------
  // The scenario
  // -------------------------------------------------------------------------

  const RAW_SEED_STATEMENT_COUNT = 3; // seedAlreadyValidRows's trees/stems/coremeasurements bulk INSERT...SELECT statements
  const ASSERTION_AND_SETUP_SLACK_MS = 10 * 60 * 1000; // beforeAll lookups, seedPendingTarget's six fast single-row statements, every fetch* assertion
  const TEST_TIMEOUT_MS =
    RAW_SEED_STATEMENT_COUNT * SEED_QUERY_TIMEOUT_MS + // worst case: every bulk seed statement hits its own bound and gets destroyed by the real runQuery
    2 * (RUN_TIMEOUT_MS + PER_QUERY_TIMEOUT_MS) + // two full runs, each possibly overshooting its own deadline by one in-flight query
    ASSERTION_AND_SETUP_SLACK_MS;

  it(
    'resolves a single pending/failed row on a failed-only rerun, with no manual IsValidated reset, leaving every already-valid row untouched',
    async () => {
      const seedStartedAt = Date.now();
      await seedAlreadyValidRows(ALREADY_VALID_ROW_COUNT);
      const targetID = await seedPendingTarget();
      const seedElapsedMs = Date.now() - seedStartedAt;
      console.log(`[seed] ${FIXTURE_ROW_COUNT} rows (valid=${ALREADY_VALID_ROW_COUNT}, pending target=1) in ${seedElapsedMs}ms, targetID=${targetID}`);

      const totalRows = await queryRaw<RowDataPacket[]>('SELECT COUNT(*) AS count FROM coremeasurements WHERE CensusID = ? AND StemGUID IS NOT NULL', [
        censusID
      ]);
      expect(Number(totalRows[0].count), 'fixture must contain exactly FIXTURE_ROW_COUNT rows before any run').toBe(FIXTURE_ROW_COUNT);
      expect(await fetchTargetIsValidated(targetID), 'the seeded target must start pending (IsValidated IS NULL), not pre-failed').toBeNull();

      const expectedTotalSteps = await computeExpectedTotalSteps();
      expect(expectedTotalSteps).toBeGreaterThan(0);

      // --- Run 1: every step executes; the target fails ValidateFindAbnormallyHighDBH.
      //     Finding a violation is not a step failure (matches validation-orchestrator.test.ts). ---
      const run1StepLog: Array<{ name: string; completed: number; failed: number; elapsedMs: number }> = [];
      let run1LastStepAt = Date.now();
      const run1StartedAt = Date.now();
      const run1Guard = installRunQueryDeadlineGuard('runCensusValidations (run 1)', RUN_TIMEOUT_MS);
      let run1Summary: Awaited<ReturnType<typeof runCensusValidations>>;
      try {
        run1Summary = await runCensusValidations(connectionManager, {
          schema,
          plotID,
          censusID,
          onStep: async (name, completed, failed) => {
            const now = Date.now();
            run1StepLog.push({ name, completed, failed, elapsedMs: now - run1LastStepAt });
            run1LastStepAt = now;
          }
        });
      } finally {
        run1Guard.restore();
      }
      const run1ElapsedMs = Date.now() - run1StartedAt;
      console.log(`[run1] completed in ${run1ElapsedMs}ms: ${JSON.stringify(run1Summary)}`);
      console.log(`[run1] step timings: ${JSON.stringify(run1StepLog)}`);

      expect(run1Summary.conflict).toBe(false);
      expect(run1Summary.totalSteps).toBe(expectedTotalSteps);
      expect(run1Summary.failedSteps, 'a validation finding a violation is a successful step, not a step failure').toBe(0);
      expect(run1Summary.errors).toEqual([]);

      expect(await fetchTargetIsValidated(targetID), 'the target must be marked failed (IsValidated = FALSE) after run 1').toBe(0);
      expect(await fetchUnresolvedTargetErrorCount(targetID), 'the target must carry exactly one unresolved abnormal-DBH occurrence').toBe(1);
      expect(await fetchValidatedTrueCount(), 'every already-valid row stays validated; the failed target must not be counted').toBe(ALREADY_VALID_ROW_COUNT);

      const run1Runs = await fetchValidationRuns();
      expect(run1Runs).toHaveLength(1);
      expect(run1Runs[0].Status).toBe('completed');
      expect(run1Runs[0].CompletedAt).not.toBeNull();
      expect(run1Runs[0].TotalSteps, 'persisted TotalSteps must match the run summary').toBe(expectedTotalSteps);
      expect(run1Runs[0].CompletedSteps, 'every step must have completed in run 1').toBe(expectedTotalSteps);
      expect(run1Runs[0].FailedSteps, 'finding a violation is not a step failure').toBe(0);

      expect(await fetchViewCount('measurementssummary'), 'measurementssummary must be fully refreshed for the whole fixture after run 1').toBe(
        FIXTURE_ROW_COUNT
      );
      expect(await fetchViewCount('viewfulltable'), 'viewfulltable must be fully refreshed for the whole fixture after run 1').toBe(FIXTURE_ROW_COUNT);

      const run1TargetSummary = await fetchTargetSummary(targetID);
      expect(run1TargetSummary.isValidated).toBe(0);
      expect(run1TargetSummary.errors).not.toBeNull();
      expect(String(run1TargetSummary.errors)).toContain(ABNORMAL_DBH_PROCEDURE);

      // --- Correct the target's DBH. Deliberately do NOT reset IsValidated or clear its
      //     error by hand: proving #304 means the orchestrator's OWN rerun must do that. ---
      await queryRaw('UPDATE coremeasurements SET MeasuredDBH = ? WHERE CoreMeasurementID = ?', [CORRECTED_TARGET_DBH_MM, targetID]);
      expect(await fetchTargetIsValidated(targetID), 'correcting the DBH value alone must not change IsValidated').toBe(0);
      expect(await fetchUnresolvedTargetErrorCount(targetID), 'correcting the DBH value alone must not resolve the stale occurrence').toBe(1);

      // --- Run 2: the orchestrator's own prepareNonDbhValidationRunInTransaction must reset
      //     the target's stale FALSE -> NULL, delete its stale occurrence, re-evaluate it as
      //     clean, and finalizeValidatedRowsInTransaction must flip it back to TRUE. ---
      const run2StepLog: Array<{ name: string; completed: number; failed: number; elapsedMs: number }> = [];
      let run2LastStepAt = Date.now();
      const run2StartedAt = Date.now();
      const run2Guard = installRunQueryDeadlineGuard('runCensusValidations (run 2)', RUN_TIMEOUT_MS);
      let run2Summary: Awaited<ReturnType<typeof runCensusValidations>>;
      try {
        run2Summary = await runCensusValidations(connectionManager, {
          schema,
          plotID,
          censusID,
          onStep: async (name, completed, failed) => {
            const now = Date.now();
            run2StepLog.push({ name, completed, failed, elapsedMs: now - run2LastStepAt });
            run2LastStepAt = now;
          }
        });
      } finally {
        run2Guard.restore();
      }
      const run2ElapsedMs = Date.now() - run2StartedAt;
      console.log(`[run2] completed in ${run2ElapsedMs}ms: ${JSON.stringify(run2Summary)}`);
      console.log(`[run2] step timings: ${JSON.stringify(run2StepLog)}`);

      expect(run2Summary.conflict).toBe(false);
      expect(run2Summary.totalSteps).toBe(expectedTotalSteps);
      expect(run2Summary.failedSteps).toBe(0);
      expect(run2Summary.errors).toEqual([]);

      expect(await fetchTargetIsValidated(targetID), 'the failed-only rerun must resolve the target to valid without any manual reset').toBe(1);
      expect(await fetchUnresolvedTargetErrorCount(targetID), 'the stale abnormal-DBH occurrence must be cleared by run 2').toBe(0);
      expect(await fetchValidatedTrueCount(), 'every row, including the now-resolved target, must be validated after run 2').toBe(FIXTURE_ROW_COUNT);

      const run2Runs = await fetchValidationRuns();
      expect(run2Runs, 'both run records must terminate; neither may be stranded running, and no conflict must occur').toHaveLength(2);
      for (const run of run2Runs) {
        expect(run.Status).toBe('completed');
        expect(run.CompletedAt).not.toBeNull();
        expect(run.TotalSteps, `persisted TotalSteps must match for RunID=${run.RunID}`).toBe(expectedTotalSteps);
        expect(run.CompletedSteps, `every step must have completed for RunID=${run.RunID}`).toBe(expectedTotalSteps);
        expect(run.FailedSteps, `neither run may persist a step failure for RunID=${run.RunID}`).toBe(0);
      }

      expect(await fetchViewCount('measurementssummary'), 'measurementssummary must reflect the final all-valid state').toBe(FIXTURE_ROW_COUNT);
      expect(await fetchViewCount('viewfulltable'), 'viewfulltable must reflect the final all-valid state').toBe(FIXTURE_ROW_COUNT);

      const run2TargetSummary = await fetchTargetSummary(targetID);
      expect(run2TargetSummary.isValidated).toBe(1);
      expect(run2TargetSummary.errors).toBeNull();

      console.log(
        `[validation-rerun-scale] DONE FIXTURE_ROW_COUNT=${FIXTURE_ROW_COUNT} seedMs=${seedElapsedMs} run1Ms=${run1ElapsedMs} run2Ms=${run2ElapsedMs}`
      );
    },
    TEST_TIMEOUT_MS
  );

  /** A local metadata probe never needs queryRaw's 300000ms seed-query default; keeping it this tight holds the demo tests' own 15000ms test timeout. */
  const THREAD_SETTLEMENT_PROBE_TIMEOUT_MS = 1000;

  /**
   * Confirms the killed thread is no longer executing the demo SLEEP: either
   * its session is already gone (the destroyed connection's socket closed),
   * or killQueryOnThread's KILL QUERY already stopped the statement. Bounded
   * by an explicit short timeout, so this cannot hang.
   */
  async function assertKilledThreadSettled(threadId: number): Promise<void> {
    const rows = await queryRaw<RowDataPacket[]>(
      'SELECT Info FROM information_schema.processlist WHERE ID = ?',
      [threadId],
      THREAD_SETTLEMENT_PROBE_TIMEOUT_MS
    );
    if (rows.length === 0) return; // thread/session is gone entirely — settled.
    // Vitest's `.not.toMatch` throws on a null/undefined actual value, so a
    // surviving idle thread with Info=NULL must be normalized to an empty
    // string first — NULL here just means "no active query", not a failure.
    const info = rows[0].Info === null || rows[0].Info === undefined ? '' : String(rows[0].Info);
    expect(info, `thread ${threadId} must no longer be executing the SLEEP after the KILL`).not.toMatch(/SLEEP/i);
  }

  // -------------------------------------------------------------------------
  // Bounded timeout-guard demonstrations — prove both bound mechanisms above
  // actually interrupt a slow statement via the REAL production
  // QueryTimeoutError/killQueryOnThread path (never an arbitrary exception),
  // leave no stale transaction, and do not poison the pool/connection for
  // subsequent queries.
  // -------------------------------------------------------------------------

  const DEMO_SLEEP_SECONDS = 5;
  const DEMO_OVERALL_DEADLINE_MS = 1000; // deliberately shorter than DEMO_SLEEP_SECONDS * 1000
  const DEMO_PER_QUERY_TIMEOUT_MS = DEMO_OVERALL_DEADLINE_MS;
  const DEMO_TEST_TIMEOUT_MS = DEMO_SLEEP_SECONDS * 1000 + 10000; // generous slack beyond the full SLEEP in case the KILL lands late

  it(
    'orchestrator guard: a slow query is interrupted by the real QueryTimeoutError/killQueryOnThread path, not an arbitrary exception',
    async () => {
      const guard = installRunQueryDeadlineGuard('demo', DEMO_OVERALL_DEADLINE_MS, DEMO_PER_QUERY_TIMEOUT_MS);
      const startedAt = Date.now();
      let caughtError: unknown;
      try {
        await connectionManager.executeQuery(`SELECT SLEEP(${DEMO_SLEEP_SECONDS}) AS slept`);
      } catch (error) {
        caughtError = error;
      } finally {
        guard.restore();
      }
      const elapsedMs = Date.now() - startedAt;

      expect(caughtError, 'must be the real primitives.QueryTimeoutError, not an arbitrary exception').toBeInstanceOf(dbPrimitives.QueryTimeoutError);
      const timeoutError = caughtError as InstanceType<typeof dbPrimitives.QueryTimeoutError>;
      // The guard clamps to Math.min(perQueryTimeoutMs, remainingMs); remainingMs shrinks by
      // however long elapses between installRunQueryDeadlineGuard() and the actual runQuery
      // call (connection acquisition, schema USE), so this is commonly < DEMO_PER_QUERY_TIMEOUT_MS,
      // not exactly it — assert the real bound, not an exact value that depends on pool timing.
      expect(timeoutError.timeoutMs, 'must be a positive timeout actually passed to the real primitive').toBeGreaterThan(0);
      expect(timeoutError.timeoutMs, 'must never exceed the configured guard bound').toBeLessThanOrEqual(DEMO_PER_QUERY_TIMEOUT_MS);
      expect(typeof timeoutError.threadId, 'must identify the killed server-side thread').toBe('number');
      expect(
        elapsedMs,
        `the interrupted SLEEP took ${elapsedMs}ms; it must be cut off near the ${DEMO_OVERALL_DEADLINE_MS}ms deadline, not the full ${DEMO_SLEEP_SECONDS * 1000}ms`
      ).toBeLessThan(DEMO_SLEEP_SECONDS * 1000);

      expect(connectionManager.hasActiveTransactions(), 'the demo query ran outside any transaction; none may be left stranded').toBe(false);

      const stillHealthy = await connectionManager.executeQuery('SELECT 1 AS ok');
      expect(stillHealthy[0].ok, 'the pool must still serve queries after the KILL — the quarantine must not poison it').toBe(1);

      await assertKilledThreadSettled(timeoutError.threadId as number);
    },
    DEMO_TEST_TIMEOUT_MS
  );

  const RAW_DEMO_SLEEP_SECONDS = 5;
  const RAW_DEMO_QUERY_TIMEOUT_MS = 1000; // deliberately shorter than RAW_DEMO_SLEEP_SECONDS * 1000
  const RAW_DEMO_TEST_TIMEOUT_MS = RAW_DEMO_SLEEP_SECONDS * 1000 + 10000;

  it(
    'raw query bound: queryRaw delegates to the real primitives.runQuery timeout, destroying only its own connection',
    async () => {
      // A dedicated connection, not the shared fixture `connection` queryRaw
      // uses elsewhere: this test deliberately drives it into the real
      // destroy() path, and must not take the fixture's own connection down.
      const demoConnection = await createConnection(config);
      try {
        const startedAt = Date.now();
        let caughtError: unknown;
        try {
          await dbPrimitives.runQuery(
            demoConnection as unknown as PoolConnection,
            `SELECT SLEEP(${RAW_DEMO_SLEEP_SECONDS}) AS slept`,
            undefined,
            RAW_DEMO_QUERY_TIMEOUT_MS
          );
        } catch (error) {
          caughtError = error;
        }
        const elapsedMs = Date.now() - startedAt;

        expect(caughtError, 'must be the real primitives.QueryTimeoutError, not an arbitrary exception').toBeInstanceOf(dbPrimitives.QueryTimeoutError);
        const timeoutError = caughtError as InstanceType<typeof dbPrimitives.QueryTimeoutError>;
        // Passed directly as the 4th argument with no deadline clamping (unlike the
        // guarded orchestrator call above), so this unguarded call's timeoutMs is exact.
        expect(timeoutError.timeoutMs).toBe(RAW_DEMO_QUERY_TIMEOUT_MS);
        expect(typeof timeoutError.threadId, 'must identify the killed server-side thread').toBe('number');
        expect(elapsedMs, `must be cut off near ${RAW_DEMO_QUERY_TIMEOUT_MS}ms, not the full ${RAW_DEMO_SLEEP_SECONDS * 1000}ms`).toBeLessThan(
          RAW_DEMO_SLEEP_SECONDS * 1000
        );

        // runQuery destroyed `demoConnection` (production's real quarantine).
        // Confirm the SHARED fixture `connection` queryRaw otherwise uses is a
        // separate, still-healthy session unaffected by that quarantine.
        const healthyRows = await queryRaw<RowDataPacket[]>('SELECT 1 AS ok');
        expect(healthyRows[0].ok).toBe(1);

        await assertKilledThreadSettled(timeoutError.threadId as number);
      } finally {
        // Always close the dedicated connection: a success, an unrelated
        // error, or any assertion failure above must not leak it.
        await demoConnection.end().catch(() => undefined);
      }
    },
    RAW_DEMO_TEST_TIMEOUT_MS
  );
});
