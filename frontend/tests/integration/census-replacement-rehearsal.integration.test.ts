/**
 * Census-replacement rehearsal at Mpala scale (#552, spec section 5.1) — OPT-IN.
 *
 * A clean re-upload replaces the whole target census inside the FIRST chunk's
 * transaction (lib/background-jobs/worker.ts begin ~913, commit ~941). For Mpala
 * census 3 that one transaction must delete 412,427 parked rows and their error
 * links, write 412,427 DELETE-audit rows, delete 42 failed uploadmetrics rows, and
 * stage a 5,000-row chunk. ConnectionManager.cleanupStaleTransactions rolls back
 * ANY transaction in the process older than 240 s, and any user can trigger it
 * through "reingest all" on any site. This rehearsal measures that transaction
 * locally, against the real ConnectionManager singleton, on a seeded Mpala shape.
 *
 * Profiles (env CENSUS_REPLACEMENT_REHEARSAL):
 *   full  — the measured Mpala counts. The only profile that counts for the recovery gate.
 *   smoke — same shape at about 1/20 scale, for authoring and self-checks.
 *   unset — every test is skipped; the normal suite and CI never pay for this file.
 *
 * Run (from frontend/, local MySQL up, no other integration suite running):
 *   caffeinate -dimsu env CENSUS_REPLACEMENT_REHEARSAL=full npm run test:integration -- census-replacement-rehearsal
 *
 * Pass rule (spec 5.1): both committed transactions finish begin-to-commit within
 * LOCAL_FIRST_CHUNK_BUDGET_MS, every count and fingerprint check holds in all three
 * runs, and the SUMMARY line reads "passed":true. Any failure triggers the stop
 * rule: escalate before anyone asks for the Mpala re-upload. A local pass is not
 * an Azure guarantee.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import ConnectionManager from '@/lib/db/connectionmanager';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import {
  createAdditionalCensus,
  DEFAULT_TEST_CONFIG,
  setupTestDatabase,
  teardownTestDatabase,
  type TestData,
  type TestDatabaseConfig
} from '../setup/local-db-setup';
import { getChunkRows } from '@/lib/background-jobs/worker';
import { stageMeasurementChunk } from '@/lib/uploads/stage-measurements';
import { ensureUploadSessionsTable } from '@/config/uploadsessiontracker';
import { CENSUS_REPLACEMENT_MARKER_COLUMN, resetUploadSessionReplacementMarkerCacheForTests } from '@/lib/uploads/upload-session-replacement-marker';
import { buildSubBatchPattern, LIKE_ESCAPE_CLAUSE, SUB_BATCH_ORDINAL_WIDTH, SUB_BATCH_SEPARATOR } from '@/lib/uploads/batch-family';
import { generateShortBatchID } from '@/config/utils';
import { SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';

// ---------------------------------------------------------------------------
// Profile selection
// ---------------------------------------------------------------------------

const REHEARSAL_ENV_FLAG = 'CENSUS_REPLACEMENT_REHEARSAL';

interface RehearsalProfile {
  name: 'full' | 'smoke';
  censusOneRows: number;
  censusTwoRows: number;
  failedSubBatchRows: number;
  subBatchRows: number;
}

/** Measured on forestgeo_mpala, 2026-10-26: 6 parse rejects + 412,421 SQL_EXCEPTION rows over 42 sub-batches of 10,000. */
const MPALA_SUB_BATCH_ROWS = 10_000;
const MPALA_PARSE_REJECT_ROWS = 6;
const MPALA_FAILED_SUB_BATCH_COUNT = 42;

const REHEARSAL_PROFILES: Record<RehearsalProfile['name'], RehearsalProfile> = {
  full: { name: 'full', censusOneRows: 363_983, censusTwoRows: 156_492, failedSubBatchRows: 412_421, subBatchRows: MPALA_SUB_BATCH_ROWS },
  smoke: { name: 'smoke', censusOneRows: 3_640, censusTwoRows: 1_565, failedSubBatchRows: 20_521, subBatchRows: 500 }
};

class UnknownRehearsalProfileError extends Error {
  constructor(value: string) {
    super(`${REHEARSAL_ENV_FLAG}="${value}" is not a rehearsal profile. Use one of: ${Object.keys(REHEARSAL_PROFILES).join(', ')}, or leave it unset to skip.`);
    this.name = 'UnknownRehearsalProfileError';
  }
}

function resolveRehearsalProfile(value: string | undefined): RehearsalProfile | null {
  if (value === undefined || value === '') return null;
  if (!Object.prototype.hasOwnProperty.call(REHEARSAL_PROFILES, value)) throw new UnknownRehearsalProfileError(value);
  return REHEARSAL_PROFILES[value as RehearsalProfile['name']];
}

const rehearsalProfile = resolveRehearsalProfile(process.env[REHEARSAL_ENV_FLAG]);

// ---------------------------------------------------------------------------
// Budget, fixture vocabulary, timeouts
// ---------------------------------------------------------------------------

const STALE_TRANSACTION_REAPER_THRESHOLD_MS = ConnectionManager.DEFAULT_STALE_TRANSACTION_THRESHOLD_MS;
/** Judgement margin for Azure (slower I/O, ~340 network round trips); not a measured ratio. */
const AZURE_SAFETY_FACTOR = 4;
const LOCAL_FIRST_CHUNK_BUDGET_MS = STALE_TRANSACTION_REAPER_THRESHOLD_MS / AZURE_SAFETY_FACTOR;

const WORKER_FIRST_CHUNK_ROWS = getChunkRows();
const FIRST_CHUNK_INDEX = 0;
const FIRST_CHUNK_ROW_ORDINAL = 0;

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'] as const;
const REHEARSAL_SCHEMA_SUFFIX = '_rehearsal';
const SEQUENCE_TABLE = 'rehearsal_sequence';
const SEQUENCE_DECIMAL_DIGITS = 6;

const FAILED_FAMILY_ROOT = 'mvgqurcn-i5itw73d2ss';
const FAILED_FILE = 'mpala_census3.csv';
const FAILED_UPLOAD_ID_PREFIX = 'rehearsal-';
const FAILED_BATCH_ERROR_MESSAGE = "Error 1054: Unknown column 'sp.StemID' in 'where clause'";
const REPLACEMENT_FILE = 'mpala_census3_replacement.csv';
const REPLACEMENT_TAG_PREFIX = 'R3T';
const CONTROL_TAG_PREFIX = { CENSUS_ONE: 'C1T', CENSUS_TWO: 'C2T' } as const;
const FAILED_TAG_PREFIX = 'C3T';
const REHEARSAL_CHANGED_BY = 'census-replacement-rehearsal';
const SESSION_USER = 'census-replacement-rehearsal@forestgeo.test';
const SESSION_STATE_UPLOADING = 'uploading';
const SESSION_ID = { COMMIT_RUN: 'rehearsal-commit-session', ROLLBACK_RUN: 'rehearsal-rollback-session' } as const;

const SPECIES_CODE = 'ACERRU';
const QUADRAT_NAME = 'Q01';
const STEM_TAG = '1';
const ATTRIBUTE_CODE = 'A';
const HOM = 1.3;
const CSV_DELIMITER = ',';
const CSV_HEADERS = ['treetag', 'stemtag', 'speciescode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'] as const;
const LOCAL_GRID_SIZE = 20;
const DBH_SPREAD = 500;
const DBH_BASE = 10;
const DBH_DIVISOR = 10;

const CENSUS_TWO = { plotCensusNumber: 2, startDate: '2025-01-01', endDate: '2025-12-31' } as const;
const CENSUS_THREE = { plotCensusNumber: 3, startDate: '2026-01-01', endDate: '2026-12-31' } as const;
const MEASUREMENT_DATE = { CENSUS_ONE: '2024-06-01', CENSUS_TWO: '2025-06-01', CENSUS_THREE: '2026-06-01' } as const;

const ERROR_CODE = { MISSING_FIELD_SPECIESCODE: 'MISSING_FIELD_SPECIESCODE', SQL_EXCEPTION: 'SQL_EXCEPTION' } as const;
const ERROR_SOURCE_INGESTION = 'ingestion';
const UPLOAD_STATUS_FAILED = 'failed';
const CHANGELOG_TABLE_COREMEASUREMENTS = 'coremeasurements';
const CHANGELOG_OPERATION = { INSERT: 'INSERT', DELETE: 'DELETE' } as const;

const SEED_TIMEOUT_MS = 40 * 60_000;
const RUN_TIMEOUT_MS = 20 * 60_000;
const TEARDOWN_TIMEOUT_MS = 10 * 60_000;
const STATEMENT_PREVIEW_LENGTH = 160;
const SUMMARY_LOG_PREFIX = '[census-replacement-rehearsal] SUMMARY';

// ---------------------------------------------------------------------------
// Statement timing (test-side only; product code gets no instrumentation)
// ---------------------------------------------------------------------------

const STATEMENT_PHASE = {
  ERROR_LINK_DELETE: 'errorLinkDelete',
  COREMEASUREMENT_SELECT_FOR_UPDATE: 'coreMeasurementSelectForUpdate',
  COREMEASUREMENT_DELETE_AUDIT: 'coreMeasurementDeleteAudit',
  COREMEASUREMENT_DELETE: 'coreMeasurementDelete',
  UPLOADMETRICS_DELETE: 'uploadMetricsDelete',
  STAGING_INSERT: 'stagingInsert',
  OTHER: 'other'
} as const;
type StatementPhase = (typeof STATEMENT_PHASE)[keyof typeof STATEMENT_PHASE];

/** Every phase except OTHER must match at least one statement in a committed run. */
const NAMED_STATEMENT_PHASES: readonly StatementPhase[] = Object.values(STATEMENT_PHASE).filter(phase => phase !== STATEMENT_PHASE.OTHER);

const STATEMENT_PHASE_PATTERNS: ReadonlyArray<{ phase: StatementPhase; pattern: RegExp }> = [
  { phase: STATEMENT_PHASE.ERROR_LINK_DELETE, pattern: /^\s*DELETE FROM\s+\S+\.measurement_error_log\b/i },
  {
    phase: STATEMENT_PHASE.COREMEASUREMENT_SELECT_FOR_UPDATE,
    pattern: /^\s*SELECT\s+(DISTINCT\s+)?\S*CoreMeasurementID\s+FROM\s+\S+\.coremeasurements[\s\S]*FOR UPDATE\s*$/i
  },
  { phase: STATEMENT_PHASE.COREMEASUREMENT_DELETE_AUDIT, pattern: /^\s*INSERT INTO\s+\S+\.unifiedchangelog[\s\S]*FROM\s+\S+\.coremeasurements cm\b/i },
  { phase: STATEMENT_PHASE.COREMEASUREMENT_DELETE, pattern: /^\s*DELETE FROM\s+\S+\.coremeasurements WHERE CoreMeasurementID IN/i },
  { phase: STATEMENT_PHASE.UPLOADMETRICS_DELETE, pattern: /^\s*DELETE FROM\s+\S+\.uploadmetrics\b/i },
  { phase: STATEMENT_PHASE.STAGING_INSERT, pattern: /^\s*INSERT IGNORE INTO\s+\S+\.temporarymeasurements\b/i }
];

function classifyStatement(sql: string): StatementPhase {
  return STATEMENT_PHASE_PATTERNS.find(candidate => candidate.pattern.test(sql))?.phase ?? STATEMENT_PHASE.OTHER;
}

interface TimedStatement {
  phase: StatementPhase;
  durationMs: number;
  preview: string;
}

interface StatementTimer {
  statements: TimedStatement[];
  /** True once the injected failure has been thrown at `failOnPhase`. */
  injectionFired(): boolean;
  restore(): void;
}

class InjectedStagingFailureError extends Error {
  constructor() {
    super('Injected failure at the staging insert (census-replacement rehearsal)');
    this.name = 'InjectedStagingFailureError';
  }
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function installStatementTimer(connectionManager: ConnectionManager, failOnPhase: StatementPhase | null): StatementTimer {
  const originalExecuteQuery = connectionManager.executeQuery;
  const statements: TimedStatement[] = [];
  let fired = false;
  connectionManager.executeQuery = async (query: string, params?: unknown[], transactionId?: string) => {
    const phase = classifyStatement(query);
    if (phase === failOnPhase) {
      fired = true;
      throw new InjectedStagingFailureError();
    }
    const startedAt = performance.now();
    try {
      return await originalExecuteQuery.call(connectionManager, query, params, transactionId);
    } finally {
      statements.push({ phase, durationMs: performance.now() - startedAt, preview: query.replace(/\s+/g, ' ').trim().slice(0, STATEMENT_PREVIEW_LENGTH) });
    }
  };
  return {
    statements,
    injectionFired: () => fired,
    restore: () => {
      connectionManager.executeQuery = originalExecuteQuery;
    }
  };
}

interface PhaseTotals {
  statements: number;
  totalMs: number;
}

function summarizePhases(statements: TimedStatement[]): Record<StatementPhase, PhaseTotals> {
  const totals = Object.fromEntries(Object.values(STATEMENT_PHASE).map(phase => [phase, { statements: 0, totalMs: 0 }])) as Record<StatementPhase, PhaseTotals>;
  for (const statement of statements) {
    totals[statement.phase].statements += 1;
    totals[statement.phase].totalMs += statement.durationMs;
  }
  for (const phase of Object.values(STATEMENT_PHASE)) totals[phase].totalMs = Math.round(totals[phase].totalMs);
  return totals;
}

function slowestStatement(statements: TimedStatement[]): TimedStatement | null {
  return statements.reduce<TimedStatement | null>(
    (slowest, statement) => (slowest === null || statement.durationMs > slowest.durationMs ? statement : slowest),
    null
  );
}

// ---------------------------------------------------------------------------
// State snapshots
// ---------------------------------------------------------------------------

interface CensusThreeState {
  failedFamilyRows: number;
  failedFamilyErrorLinks: Record<keyof typeof ERROR_CODE, number>;
  censusThreeMeasurementRows: number;
  deleteAuditRows: number;
  distinctDeleteAuditRecords: number;
  insertAuditRows: number;
  uploadMetricsRows: number;
  failedUploadMetricsRows: number;
  stagedReplacementRows: number;
  sessionMarkerSet: boolean;
}

interface ControlCensusFingerprint {
  measurementRows: number;
  resolvedRows: number;
  contentCrc: string;
  trees: number;
  stems: number;
  deleteAuditRows: number;
}

function failedRowTotal(profile: RehearsalProfile): number {
  return MPALA_PARSE_REJECT_ROWS + profile.failedSubBatchRows;
}

function expectedSeedState(profile: RehearsalProfile): CensusThreeState {
  const total = failedRowTotal(profile);
  return {
    failedFamilyRows: total,
    failedFamilyErrorLinks: { MISSING_FIELD_SPECIESCODE: MPALA_PARSE_REJECT_ROWS, SQL_EXCEPTION: profile.failedSubBatchRows },
    censusThreeMeasurementRows: total,
    deleteAuditRows: 0,
    distinctDeleteAuditRecords: 0,
    insertAuditRows: total,
    uploadMetricsRows: MPALA_FAILED_SUB_BATCH_COUNT,
    failedUploadMetricsRows: MPALA_FAILED_SUB_BATCH_COUNT,
    stagedReplacementRows: 0,
    sessionMarkerSet: false
  };
}

function expectedReplacedState(profile: RehearsalProfile): CensusThreeState {
  const total = failedRowTotal(profile);
  return {
    failedFamilyRows: 0,
    failedFamilyErrorLinks: { MISSING_FIELD_SPECIESCODE: 0, SQL_EXCEPTION: 0 },
    censusThreeMeasurementRows: 0,
    deleteAuditRows: total,
    distinctDeleteAuditRecords: total,
    insertAuditRows: total,
    uploadMetricsRows: 0,
    failedUploadMetricsRows: 0,
    stagedReplacementRows: WORKER_FIRST_CHUNK_ROWS,
    sessionMarkerSet: true
  };
}

function describeMismatches<T extends object>(expected: T, actual: T): string[] {
  return Object.keys(expected)
    .filter(key => JSON.stringify(expected[key as keyof T]) !== JSON.stringify(actual[key as keyof T]))
    .map(key => `${key}: expected ${JSON.stringify(expected[key as keyof T])}, got ${JSON.stringify(actual[key as keyof T])}`);
}

// ---------------------------------------------------------------------------
// Summary (printed once, in afterAll)
// ---------------------------------------------------------------------------

type RunOutcome = 'committed' | 'rolled_back' | 'failed';
type RunKey = 'commitRun' | 'rollbackRun' | 'retryRun';

/** Filled in after the run's state checks complete; null means verification never finished. */
interface RunVerification {
  /** Checks taken before the run started (the fresh census-3 seed for the rollback run). */
  preRunMismatches: string[];
  countMismatches: string[];
  controlCensusMismatches: string[];
}

interface RunSummary {
  outcome: RunOutcome;
  beginToEndMs: number;
  commitMs: number | null;
  rollbackMs: number | null;
  withinBudget: boolean | null;
  injectionPoint: StatementPhase | null;
  injectionFired: boolean;
  /** The census-replacement cleanup ran to its last statement (coremeasurements and uploadmetrics deletes both issued). */
  cleanupCompleted: boolean;
  error: string | null;
  rollbackError: string | null;
  phases: Record<StatementPhase, PhaseTotals>;
  selectForUpdatePlusAuditMs: number;
  slowestStatement: TimedStatement | null;
  unmatchedPhases: StatementPhase[];
  verification: RunVerification | null;
}

interface RehearsalSummary {
  rehearsal: 'census-replacement';
  profile: RehearsalProfile['name'] | null;
  schema: string | null;
  mysqlVersion: string | null;
  innodbBufferPoolBytes: number | null;
  budgetMs: number;
  reaperThresholdMs: number;
  seed: { censusOneRows: number; censusTwoRows: number; censusThreeFailedRows: number; failedSubBatches: number; seedMs: number; mismatches: string[] } | null;
  runs: Partial<Record<RunKey, RunSummary>>;
  failedChecks: string[];
  passed: boolean;
}

const rehearsalSummary: RehearsalSummary = {
  rehearsal: 'census-replacement',
  profile: rehearsalProfile?.name ?? null,
  schema: null,
  mysqlVersion: null,
  innodbBufferPoolBytes: null,
  budgetMs: LOCAL_FIRST_CHUNK_BUDGET_MS,
  reaperThresholdMs: STALE_TRANSACTION_REAPER_THRESHOLD_MS,
  seed: null,
  runs: {},
  failedChecks: [],
  passed: false
};

interface RunExpectation {
  outcome: RunOutcome;
  injectionPoint: StatementPhase | null;
  budgeted: boolean;
}

/** The single definition of "this run passed", used by each test's assertion AND by SUMMARY.passed, so the two cannot diverge. */
const RUN_EXPECTATIONS: Record<RunKey, RunExpectation> = {
  commitRun: { outcome: 'committed', injectionPoint: null, budgeted: true },
  rollbackRun: { outcome: 'rolled_back', injectionPoint: STATEMENT_PHASE.STAGING_INSERT, budgeted: false },
  retryRun: { outcome: 'committed', injectionPoint: null, budgeted: true }
};

function runFailedChecks(key: RunKey, run: RunSummary | undefined): string[] {
  if (!run) return [`${key}: never attempted`];
  const expectation = RUN_EXPECTATIONS[key];
  const failed: string[] = [];
  if (run.outcome !== expectation.outcome) failed.push(`${key}: outcome ${run.outcome}, expected ${expectation.outcome}`);
  if (run.error !== null) failed.push(`${key}: unexpected error ${run.error}`);
  if (run.rollbackError !== null) failed.push(`${key}: rollback failed ${run.rollbackError}`);
  if (run.injectionPoint !== expectation.injectionPoint) failed.push(`${key}: injection point ${run.injectionPoint}, expected ${expectation.injectionPoint}`);
  if (run.injectionFired !== (expectation.injectionPoint !== null)) failed.push(`${key}: injection fired=${run.injectionFired}`);
  if (!run.cleanupCompleted) failed.push(`${key}: the census-replacement cleanup did not run to completion`);
  if (expectation.budgeted && run.withinBudget !== true)
    failed.push(`${key}: begin-to-commit ${run.beginToEndMs} ms is over the ${LOCAL_FIRST_CHUNK_BUDGET_MS} ms budget`);
  if (expectation.outcome === 'committed' && run.unmatchedPhases.length > 0)
    failed.push(`${key}: phases matched no statement: ${run.unmatchedPhases.join(', ')}`);
  if (run.verification === null) {
    failed.push(`${key}: state verification did not complete`);
  } else {
    for (const [label, mismatches] of Object.entries(run.verification)) {
      if (mismatches.length > 0) failed.push(`${key}: ${label}: ${mismatches.join('; ')}`);
    }
  }
  return failed;
}

function rehearsalFailedChecks(summary: RehearsalSummary): string[] {
  const failed: string[] = [];
  if (summary.seed === null) failed.push('seed: did not complete');
  else if (summary.seed.mismatches.length > 0) failed.push(`seed: ${summary.seed.mismatches.join('; ')}`);
  for (const key of Object.keys(RUN_EXPECTATIONS) as RunKey[]) failed.push(...runFailedChecks(key, summary.runs[key]));
  return failed;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(rehearsalProfile === null)('census replacement rehearsal at Mpala scale (opt-in, #552)', () => {
  const profile = rehearsalProfile as RehearsalProfile;
  let connectionManager: ConnectionManager;
  let setupConnection: Connection | null = null;
  let config: TestDatabaseConfig;
  let testData: TestData;
  let schema: string;
  let plotID: number;
  let speciesID: number;
  let quadratID: number;
  const censusIDs = { one: 0, two: 0, three: 0 };
  let controlBaseline: ControlCensusFingerprint[];
  /** Set right before the first ConnectionManager call opens the real pool; afterAll closes that pool only then. */
  let connectionManagerPoolOpened = false;
  const rollbackRunBatchID = generateShortBatchID();

  async function query(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
    const [rows] = await setupConnection!.query<RowDataPacket[]>(sql, params);
    return rows;
  }

  async function countOf(sql: string, params: unknown[] = []): Promise<number> {
    const rows = await query(sql, params);
    return Number(rows[0].total);
  }

  async function createSequenceTable(): Promise<void> {
    const digits = Array.from({ length: 10 }, (_, digit) => `SELECT ${digit} AS d`).join(' UNION ALL ');
    const joins = Array.from({ length: SEQUENCE_DECIMAL_DIGITS }, (_, place) => `(${digits}) d${place}`).join(' CROSS JOIN ');
    const value = Array.from({ length: SEQUENCE_DECIMAL_DIGITS }, (_, place) => `d${place}.d * ${10 ** place}`).join(' + ');
    await query(`DROP TABLE IF EXISTS ${SEQUENCE_TABLE}`);
    await query(`CREATE TABLE ${SEQUENCE_TABLE} (n INT NOT NULL PRIMARY KEY)`);
    await query(`INSERT INTO ${SEQUENCE_TABLE} (n) SELECT ${value} FROM ${joins}`);
  }

  async function seedIngestedControlCensus(censusID: number, rowCount: number, tagPrefix: string, measurementDate: string): Promise<void> {
    await query(`INSERT INTO trees (TreeTag, SpeciesID, CensusID) SELECT CONCAT(?, n), ?, ? FROM ${SEQUENCE_TABLE} WHERE n < ?`, [
      tagPrefix,
      speciesID,
      censusID,
      rowCount
    ]);
    await query(
      `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY)
       SELECT TreeID, ?, CensusID, ?, MOD(TreeID, ?), MOD(TreeID DIV ?, ?) FROM trees WHERE CensusID = ?`,
      [quadratID, STEM_TAG, LOCAL_GRID_SIZE, LOCAL_GRID_SIZE, LOCAL_GRID_SIZE, censusID]
    );
    await query(
      `INSERT INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM,
                                     UploadFileID, UploadBatchID, RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, IsActive)
       SELECT s.CensusID, s.StemGUID, b'1', ?, ? + MOD(s.StemGUID, ?) / ?, ?, NULL, NULL, t.TreeTag, s.StemTag, ?, ?, s.LocalX, s.LocalY, ?, 1
       FROM stems s JOIN trees t ON t.TreeID = s.TreeID WHERE s.CensusID = ?`,
      [measurementDate, DBH_BASE, DBH_SPREAD, DBH_DIVISOR, HOM, SPECIES_CODE, QUADRAT_NAME, ATTRIBUTE_CODE, censusID]
    );
  }

  async function seedFailedCensusThreeFamily(): Promise<void> {
    const census = censusIDs.three;
    await query(
      `INSERT INTO coremeasurements (CensusID, StemGUID, MeasurementDate, MeasuredDBH, MeasuredHOM, UploadFileID, UploadBatchID,
                                     RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, SourceRowIndex, IsActive)
       SELECT ?, NULL, ?, ? + MOD(n, ?) / ?, ?, ?,
              IF(n < ?, ?, CONCAT(?, ?, LPAD(FLOOR((n - ?) / ?) + 1, ?, '0'))),
              CONCAT(?, n), ?, IF(n < ?, NULL, ?), ?, MOD(n, ?), MOD(n DIV ?, ?), ?, n + 1, 1
       FROM ${SEQUENCE_TABLE} WHERE n < ?`,
      [
        census,
        MEASUREMENT_DATE.CENSUS_THREE,
        DBH_BASE,
        DBH_SPREAD,
        DBH_DIVISOR,
        HOM,
        FAILED_FILE,
        MPALA_PARSE_REJECT_ROWS,
        FAILED_FAMILY_ROOT,
        FAILED_FAMILY_ROOT,
        SUB_BATCH_SEPARATOR,
        MPALA_PARSE_REJECT_ROWS,
        profile.subBatchRows,
        SUB_BATCH_ORDINAL_WIDTH,
        FAILED_TAG_PREFIX,
        STEM_TAG,
        MPALA_PARSE_REJECT_ROWS,
        SPECIES_CODE,
        QUADRAT_NAME,
        LOCAL_GRID_SIZE,
        LOCAL_GRID_SIZE,
        LOCAL_GRID_SIZE,
        ATTRIBUTE_CODE,
        failedRowTotal(profile)
      ]
    );
    await query(
      `INSERT INTO measurement_error_log (MeasurementID, ErrorID)
       SELECT cm.CoreMeasurementID, me.ErrorID
       FROM coremeasurements cm
       JOIN measurement_errors me ON me.ErrorSource = ? AND me.ErrorCode = IF(cm.UploadBatchID = ?, ?, ?)
       WHERE cm.CensusID = ?`,
      [ERROR_SOURCE_INGESTION, FAILED_FAMILY_ROOT, ERROR_CODE.MISSING_FIELD_SPECIESCODE, ERROR_CODE.SQL_EXCEPTION, census]
    );
    await query(
      `INSERT INTO uploadmetrics (uploadId, fileID, batchID, schema_name, plotID, censusID, sourceRecords, failedRecords, status, errorMessage, startTime, endTime)
       SELECT CONCAT(?, cm.UploadBatchID), ?, cm.UploadBatchID, ?, ?, ?, COUNT(*), COUNT(*), ?, ?, NOW(), NOW()
       FROM coremeasurements cm
       WHERE cm.CensusID = ? AND cm.UploadBatchID LIKE ? ${LIKE_ESCAPE_CLAUSE}
       GROUP BY cm.UploadBatchID`,
      [
        FAILED_UPLOAD_ID_PREFIX,
        FAILED_FILE,
        schema,
        plotID,
        census,
        UPLOAD_STATUS_FAILED,
        FAILED_BATCH_ERROR_MESSAGE,
        census,
        buildSubBatchPattern(FAILED_FAMILY_ROOT)
      ]
    );
    await query(
      `INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangedBy, PlotID, CensusID)
       SELECT ?, cm.CoreMeasurementID, ?, JSON_OBJECT('CoreMeasurementID', cm.CoreMeasurementID, 'UploadBatchID', cm.UploadBatchID, 'RawTreeTag', cm.RawTreeTag), ?, ?, cm.CensusID
       FROM coremeasurements cm WHERE cm.CensusID = ?`,
      [CHANGELOG_TABLE_COREMEASUREMENTS, CHANGELOG_OPERATION.INSERT, REHEARSAL_CHANGED_BY, plotID, census]
    );
  }

  async function clearCensusThreeScope(): Promise<void> {
    const census = censusIDs.three;
    await query(`DELETE FROM temporarymeasurements WHERE CensusID = ?`, [census]);
    await query(`DELETE mel FROM measurement_error_log mel JOIN coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID WHERE cm.CensusID = ?`, [
      census
    ]);
    await query(`DELETE FROM coremeasurements WHERE CensusID = ?`, [census]);
    await query(`DELETE FROM uploadmetrics WHERE censusID = ?`, [census]);
    await query(`DELETE FROM unifiedchangelog WHERE CensusID = ?`, [census]);
    await query(`DELETE FROM upload_sessions`);
  }

  async function seedUploadSession(sessionID: string): Promise<void> {
    await query(`INSERT INTO upload_sessions (session_id, schema_name, plot_id, census_id, user_id, state) VALUES (?, ?, ?, ?, ?, ?)`, [
      sessionID,
      schema,
      plotID,
      censusIDs.three,
      SESSION_USER,
      SESSION_STATE_UPLOADING
    ]);
  }

  async function readCensusThreeState(incomingBatchID: string, sessionID: string): Promise<CensusThreeState> {
    const census = censusIDs.three;
    const familyPattern = buildSubBatchPattern(FAILED_FAMILY_ROOT);
    const failedFamilyRows = await countOf(
      `SELECT COUNT(*) AS total FROM coremeasurements WHERE CensusID = ? AND (UploadBatchID = ? OR UploadBatchID LIKE ? ${LIKE_ESCAPE_CLAUSE})`,
      [census, FAILED_FAMILY_ROOT, familyPattern]
    );
    const linkRows = await query(
      `SELECT me.ErrorCode AS errorCode, COUNT(*) AS linkCount
       FROM measurement_error_log mel
       JOIN coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
       JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE cm.CensusID = ? AND (cm.UploadBatchID = ? OR cm.UploadBatchID LIKE ? ${LIKE_ESCAPE_CLAUSE})
       GROUP BY me.ErrorCode`,
      [census, FAILED_FAMILY_ROOT, familyPattern]
    );
    const linkCount = (code: string) => Number(linkRows.find(row => String(row.errorCode) === code)?.linkCount ?? 0);
    const auditRows = await query(
      `SELECT SUM(Operation = ?) AS deleteAuditRows, COUNT(DISTINCT CASE WHEN Operation = ? THEN RecordID END) AS distinctDeleteAuditRecords,
              SUM(Operation = ?) AS insertAuditRows
       FROM unifiedchangelog WHERE TableName = ? AND CensusID = ?`,
      [CHANGELOG_OPERATION.DELETE, CHANGELOG_OPERATION.DELETE, CHANGELOG_OPERATION.INSERT, CHANGELOG_TABLE_COREMEASUREMENTS, census]
    );
    const metricsRows = await query(`SELECT COUNT(*) AS total, SUM(status = ?) AS failedTotal FROM uploadmetrics WHERE plotID = ? AND censusID = ?`, [
      UPLOAD_STATUS_FAILED,
      plotID,
      census
    ]);
    const markerRows = await query(`SELECT ${CENSUS_REPLACEMENT_MARKER_COLUMN} IS NOT NULL AS markerSet FROM upload_sessions WHERE session_id = ?`, [
      sessionID
    ]);
    return {
      failedFamilyRows,
      failedFamilyErrorLinks: {
        MISSING_FIELD_SPECIESCODE: linkCount(ERROR_CODE.MISSING_FIELD_SPECIESCODE),
        SQL_EXCEPTION: linkCount(ERROR_CODE.SQL_EXCEPTION)
      },
      censusThreeMeasurementRows: await countOf(`SELECT COUNT(*) AS total FROM coremeasurements WHERE CensusID = ?`, [census]),
      deleteAuditRows: Number(auditRows[0].deleteAuditRows ?? 0),
      distinctDeleteAuditRecords: Number(auditRows[0].distinctDeleteAuditRecords ?? 0),
      insertAuditRows: Number(auditRows[0].insertAuditRows ?? 0),
      uploadMetricsRows: Number(metricsRows[0].total),
      failedUploadMetricsRows: Number(metricsRows[0].failedTotal ?? 0),
      stagedReplacementRows: await countOf(
        `SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ? AND CensusID = ? AND (BatchID = ? OR BatchID LIKE ? ${LIKE_ESCAPE_CLAUSE})`,
        [REPLACEMENT_FILE, census, incomingBatchID, buildSubBatchPattern(incomingBatchID)]
      ),
      sessionMarkerSet: markerRows.length === 1 && Number(markerRows[0].markerSet) === 1
    };
  }

  async function readControlFingerprints(): Promise<ControlCensusFingerprint[]> {
    const fingerprints: ControlCensusFingerprint[] = [];
    for (const censusID of [censusIDs.one, censusIDs.two]) {
      const measurement = await query(
        `SELECT COUNT(*) AS measurementRows, SUM(StemGUID IS NOT NULL) AS resolvedRows,
                COALESCE(SUM(CRC32(CONCAT_WS('#', CoreMeasurementID, StemGUID, MeasurementDate, MeasuredDBH, MeasuredHOM, RawTreeTag, IsActive))), 0) AS contentCrc
         FROM coremeasurements WHERE CensusID = ?`,
        [censusID]
      );
      fingerprints.push({
        measurementRows: Number(measurement[0].measurementRows),
        resolvedRows: Number(measurement[0].resolvedRows ?? 0),
        contentCrc: String(measurement[0].contentCrc),
        trees: await countOf(`SELECT COUNT(*) AS total FROM trees WHERE CensusID = ?`, [censusID]),
        stems: await countOf(`SELECT COUNT(*) AS total FROM stems WHERE CensusID = ?`, [censusID]),
        deleteAuditRows: await countOf(`SELECT COUNT(*) AS total FROM unifiedchangelog WHERE TableName = ? AND Operation = ? AND CensusID = ?`, [
          CHANGELOG_TABLE_COREMEASUREMENTS,
          CHANGELOG_OPERATION.DELETE,
          censusID
        ])
      });
    }
    return fingerprints;
  }

  function buildReplacementChunk(): Record<string, string>[] {
    // Key order mirrors CSV_HEADERS: the resolution plan keys values positionally, like a parsed CSV.
    return Array.from({ length: WORKER_FIRST_CHUNK_ROWS }, (_, index) => ({
      treetag: `${REPLACEMENT_TAG_PREFIX}${index}`,
      stemtag: STEM_TAG,
      speciescode: SPECIES_CODE,
      quadrat: QUADRAT_NAME,
      lx: String(index % LOCAL_GRID_SIZE),
      ly: String(Math.floor(index / LOCAL_GRID_SIZE) % LOCAL_GRID_SIZE),
      dbh: String(DBH_BASE + (index % DBH_SPREAD) / DBH_DIVISOR),
      hom: String(HOM),
      date: MEASUREMENT_DATE.CENSUS_THREE,
      codes: ATTRIBUTE_CODE
    }));
  }

  interface FirstChunkResult {
    outcome: RunOutcome;
    beginToEndMs: number;
    commitMs: number | null;
    rollbackMs: number | null;
    injectionPoint: StatementPhase | null;
    injectionFired: boolean;
    error: string | null;
    rollbackError: string | null;
    statements: TimedStatement[];
  }

  /**
   * The worker's first-chunk transaction (worker.ts ~913-963), parameter for parameter.
   * It always returns a result, including on an unexpected error (outcome 'failed', with the
   * message in `error`), so the caller records the timings, the slowest statement and the
   * rollback status before any assertion runs. That is recorded, not swallowed:
   * runFailedChecks fails the test on any non-null `error`.
   */
  async function runFirstChunk(batchID: string, sessionID: string, injectionPoint: StatementPhase | null): Promise<FirstChunkResult> {
    resetUploadSessionReplacementMarkerCacheForTests();
    const rawRows = buildReplacementChunk();
    const timer = installStatementTimer(connectionManager, injectionPoint);
    const beganAt = performance.now();
    let transactionID: string | null = null;
    try {
      transactionID = await connectionManager.beginTransaction();
      await stageMeasurementChunk(connectionManager, {
        schema,
        fileName: REPLACEMENT_FILE,
        batchID,
        plotID,
        censusID: censusIDs.three,
        uploadMode: UploadMode.CLEAN_REUPLOAD,
        sourceFormat: SourceFormat.csv,
        rawRows,
        csvHeaders: [...CSV_HEADERS],
        delimiter: CSV_DELIMITER,
        storedMapping: undefined,
        uploadSessionID: sessionID,
        transactionID,
        firstRowOrdinal: FIRST_CHUNK_ROW_ORDINAL,
        changedBy: REHEARSAL_CHANGED_BY,
        suppressCensusReplacementCleanup: false,
        chunkIdentity: `${batchID}:chunk${FIRST_CHUNK_INDEX}`
      });
      const commitStartedAt = performance.now();
      await connectionManager.commitTransaction(transactionID);
      const committedAt = performance.now();
      return {
        outcome: 'committed',
        beginToEndMs: committedAt - beganAt,
        commitMs: committedAt - commitStartedAt,
        rollbackMs: null,
        injectionPoint,
        injectionFired: timer.injectionFired(),
        error: null,
        rollbackError: null,
        statements: timer.statements
      };
    } catch (error) {
      const injected = error instanceof InjectedStagingFailureError;
      if (!injected) console.error(`[census-replacement-rehearsal] unexpected error in the first-chunk run`, error);
      const rollbackStartedAt = performance.now();
      let rollbackError: string | null = null;
      if (transactionID !== null) {
        try {
          await connectionManager.rollbackTransaction(transactionID);
        } catch (caughtRollbackError) {
          // Mirrors the worker: a failed rollback is recorded and never masks the original error.
          rollbackError = errorMessageOf(caughtRollbackError);
        }
      }
      const rolledBackAt = performance.now();
      return {
        outcome: injected ? 'rolled_back' : 'failed',
        beginToEndMs: rolledBackAt - beganAt,
        commitMs: null,
        rollbackMs: transactionID === null ? null : rolledBackAt - rollbackStartedAt,
        injectionPoint,
        injectionFired: timer.injectionFired(),
        error: injected ? null : errorMessageOf(error),
        rollbackError,
        statements: timer.statements
      };
    } finally {
      timer.restore();
    }
  }

  /** Records a run's timings in the summary immediately, before any verification query can fail. */
  function recordRun(key: RunKey, result: FirstChunkResult): RunSummary {
    const phases = summarizePhases(result.statements);
    const run: RunSummary = {
      outcome: result.outcome,
      beginToEndMs: Math.round(result.beginToEndMs),
      commitMs: result.commitMs === null ? null : Math.round(result.commitMs),
      rollbackMs: result.rollbackMs === null ? null : Math.round(result.rollbackMs),
      withinBudget: result.outcome === 'committed' ? result.beginToEndMs <= LOCAL_FIRST_CHUNK_BUDGET_MS : null,
      injectionPoint: result.injectionPoint,
      injectionFired: result.injectionFired,
      cleanupCompleted: phases[STATEMENT_PHASE.COREMEASUREMENT_DELETE].statements > 0 && phases[STATEMENT_PHASE.UPLOADMETRICS_DELETE].statements > 0,
      error: result.error,
      rollbackError: result.rollbackError,
      phases,
      selectForUpdatePlusAuditMs:
        phases[STATEMENT_PHASE.COREMEASUREMENT_SELECT_FOR_UPDATE].totalMs + phases[STATEMENT_PHASE.COREMEASUREMENT_DELETE_AUDIT].totalMs,
      slowestStatement: slowestStatement(result.statements),
      unmatchedPhases: NAMED_STATEMENT_PHASES.filter(phase => phases[phase].statements === 0),
      verification: null
    };
    rehearsalSummary.runs[key] = run;
    console.log(`[census-replacement-rehearsal] ${key} ${JSON.stringify(run)}`);
    return run;
  }

  /** Reads census 3 and the controls, attaches the mismatches to the recorded run, and returns the raw state for detailed diffs. */
  async function verifyRun(
    key: RunKey,
    run: RunSummary,
    expectedState: CensusThreeState,
    batchID: string,
    sessionID: string,
    preRunMismatches: string[]
  ): Promise<{ state: CensusThreeState; controls: ControlCensusFingerprint[] }> {
    const state = await readCensusThreeState(batchID, sessionID);
    const controls = await readControlFingerprints();
    run.verification = {
      preRunMismatches,
      countMismatches: describeMismatches(expectedState, state),
      controlCensusMismatches: describeMismatches(controlBaseline, controls)
    };
    console.log(`[census-replacement-rehearsal] ${key} verification ${JSON.stringify(run.verification)} state=${JSON.stringify(state)}`);
    return { state, controls };
  }

  beforeAll(async () => {
    const connectionManagerHost = process.env.AZURE_SQL_SERVER;
    const testDbHost = process.env.TEST_DB_HOST || 'localhost';
    if (!connectionManagerHost || !LOCAL_HOSTS.includes(connectionManagerHost as (typeof LOCAL_HOSTS)[number])) {
      throw new Error(`REFUSING TO RUN: ConnectionManager host is '${connectionManagerHost}', not local. Aborting to avoid writing to a real database.`);
    }
    if (!LOCAL_HOSTS.includes(testDbHost as (typeof LOCAL_HOSTS)[number])) {
      throw new Error(`REFUSING TO RUN: TEST_DB_HOST is '${testDbHost}', not local. Aborting to avoid writing to a real database.`);
    }

    const seedStartedAt = performance.now();
    const setup = await setupTestDatabase({ ...DEFAULT_TEST_CONFIG, database: `${DEFAULT_TEST_CONFIG.database}${REHEARSAL_SCHEMA_SUFFIX}` });
    setupConnection = setup.connection;
    config = setup.config;
    testData = setup.testData;
    schema = config.database;
    plotID = testData.plots[0].plotID;
    censusIDs.one = testData.census[0].censusID;
    censusIDs.two = (await createAdditionalCensus(setupConnection, testData, CENSUS_TWO)).censusID;
    censusIDs.three = (await createAdditionalCensus(setupConnection, testData, CENSUS_THREE)).censusID;
    connectionManager = ConnectionManager.getInstance();
    connectionManagerPoolOpened = true;
    await ensureUploadSessionsTable(schema);
    rehearsalSummary.schema = schema;

    const environment = await query(`SELECT VERSION() AS version, @@innodb_buffer_pool_size AS bufferPoolBytes`);
    rehearsalSummary.mysqlVersion = String(environment[0].version);
    rehearsalSummary.innodbBufferPoolBytes = Number(environment[0].bufferPoolBytes);

    speciesID = Number((await query(`SELECT SpeciesID FROM species WHERE SpeciesCode = ?`, [SPECIES_CODE]))[0].SpeciesID);
    quadratID = Number((await query(`SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ?`, [QUADRAT_NAME, plotID]))[0].QuadratID);

    await createSequenceTable();
    await seedIngestedControlCensus(censusIDs.one, profile.censusOneRows, CONTROL_TAG_PREFIX.CENSUS_ONE, MEASUREMENT_DATE.CENSUS_ONE);
    await seedIngestedControlCensus(censusIDs.two, profile.censusTwoRows, CONTROL_TAG_PREFIX.CENSUS_TWO, MEASUREMENT_DATE.CENSUS_TWO);
    await seedFailedCensusThreeFamily();
    controlBaseline = await readControlFingerprints();
    const seededState = await readCensusThreeState(generateShortBatchID(), SESSION_ID.COMMIT_RUN);
    const seedMismatches = [
      ...describeMismatches(expectedSeedState(profile), seededState),
      ...describeMismatches(
        {
          censusOneResolvedRows: profile.censusOneRows,
          censusTwoResolvedRows: profile.censusTwoRows,
          censusOneStems: profile.censusOneRows,
          censusTwoStems: profile.censusTwoRows
        },
        {
          censusOneResolvedRows: controlBaseline[0].resolvedRows,
          censusTwoResolvedRows: controlBaseline[1].resolvedRows,
          censusOneStems: controlBaseline[0].stems,
          censusTwoStems: controlBaseline[1].stems
        }
      )
    ];

    rehearsalSummary.seed = {
      censusOneRows: profile.censusOneRows,
      censusTwoRows: profile.censusTwoRows,
      censusThreeFailedRows: failedRowTotal(profile),
      failedSubBatches: MPALA_FAILED_SUB_BATCH_COUNT,
      seedMs: Math.round(performance.now() - seedStartedAt),
      mismatches: seedMismatches
    };
    console.log(
      `[census-replacement-rehearsal] seeded profile=${profile.name} schema=${schema} censuses=${JSON.stringify(censusIDs)} seed=${JSON.stringify(rehearsalSummary.seed)}\n` +
        `[census-replacement-rehearsal] control baseline=${JSON.stringify(controlBaseline)}\n[census-replacement-rehearsal] census-3 seed state=${JSON.stringify(seededState)}`
    );

    expect(seedMismatches, 'census-3 seed must reproduce the measured Mpala family and the control censuses').toEqual([]);
    expect(seededState).toEqual(expectedSeedState(profile));
  }, SEED_TIMEOUT_MS);

  afterAll(async () => {
    rehearsalSummary.failedChecks = rehearsalFailedChecks(rehearsalSummary);
    rehearsalSummary.passed = rehearsalSummary.failedChecks.length === 0;
    console.log(`${SUMMARY_LOG_PREFIX} ${JSON.stringify(rehearsalSummary)}`);
    try {
      // ConnectionManager.closeConnection() is a no-op (lib/db/connectionmanager.ts ~482). The real
      // pool belongs to the pool-monitor singleton; close it as editplan-species-correction does.
      if (connectionManagerPoolOpened) await getPoolMonitorInstance().closeAllConnections();
    } finally {
      await teardownTestDatabase(setupConnection, config ?? { database: `${DEFAULT_TEST_CONFIG.database}${REHEARSAL_SCHEMA_SUFFIX}` });
    }
  }, TEARDOWN_TIMEOUT_MS);

  it(
    '(A) commit run: the first-chunk replacement commits within budget with exact counts',
    async () => {
      const batchID = generateShortBatchID();
      await seedUploadSession(SESSION_ID.COMMIT_RUN);
      const result = await runFirstChunk(batchID, SESSION_ID.COMMIT_RUN, RUN_EXPECTATIONS.commitRun.injectionPoint);
      const run = recordRun('commitRun', result);
      const { state, controls } = await verifyRun('commitRun', run, expectedReplacedState(profile), batchID, SESSION_ID.COMMIT_RUN, []);

      expect(runFailedChecks('commitRun', run), 'every commit-run check (the same list feeds SUMMARY.passed)').toEqual([]);
      expect(state).toEqual(expectedReplacedState(profile));
      expect(controls).toEqual(controlBaseline);
    },
    RUN_TIMEOUT_MS
  );

  it(
    '(B) injected staging failure: the rollback restores the census-3 seed exactly',
    async () => {
      await clearCensusThreeScope();
      await seedFailedCensusThreeFamily();
      const reseededState = await readCensusThreeState(rollbackRunBatchID, SESSION_ID.ROLLBACK_RUN);
      const preRunMismatches = describeMismatches(expectedSeedState(profile), reseededState);
      await seedUploadSession(SESSION_ID.ROLLBACK_RUN);

      const result = await runFirstChunk(rollbackRunBatchID, SESSION_ID.ROLLBACK_RUN, RUN_EXPECTATIONS.rollbackRun.injectionPoint);
      const run = recordRun('rollbackRun', result);
      const { state, controls } = await verifyRun(
        'rollbackRun',
        run,
        expectedSeedState(profile),
        rollbackRunBatchID,
        SESSION_ID.ROLLBACK_RUN,
        preRunMismatches
      );

      // runFailedChecks covers: outcome rolled_back, injection fired at the staging insert,
      // the cleanup ran to completion first, no rollback error, and an exact restore.
      expect(runFailedChecks('rollbackRun', run), 'every rollback-run check (the same list feeds SUMMARY.passed)').toEqual([]);
      expect(reseededState, 'fresh census-3 seed before the rollback run').toEqual(expectedSeedState(profile));
      expect(state).toEqual(expectedSeedState(profile));
      expect(controls).toEqual(controlBaseline);
    },
    RUN_TIMEOUT_MS
  );

  it(
    '(C) retry after the rollback: the same batch and session commit within budget with exact counts',
    async () => {
      const result = await runFirstChunk(rollbackRunBatchID, SESSION_ID.ROLLBACK_RUN, RUN_EXPECTATIONS.retryRun.injectionPoint);
      const run = recordRun('retryRun', result);
      const { state, controls } = await verifyRun('retryRun', run, expectedReplacedState(profile), rollbackRunBatchID, SESSION_ID.ROLLBACK_RUN, []);

      expect(runFailedChecks('retryRun', run), 'every retry-run check (the same list feeds SUMMARY.passed)').toEqual([]);
      expect(state).toEqual(expectedReplacedState(profile));
      expect(controls).toEqual(controlBaseline);
    },
    RUN_TIMEOUT_MS
  );
});
