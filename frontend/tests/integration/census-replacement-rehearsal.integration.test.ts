/**
 * Census-replacement rehearsal at Mpala scale (#552, #555) — OPT-IN.
 *
 * A Clean Re-Upload replaces its census in separately committed transactions that run
 * BEFORE the staging transaction opens (replaceCensusForCleanReupload: measurement
 * windows of CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE ids, legacy failedmeasurements passes,
 * uploadmetrics windows, then the session marker). For Mpala census 3 that is 412,427
 * parked rows with their error links and DELETE-audit rows. ConnectionManager.cleanupStaleTransactions
 * rolls back ANY transaction in the process older than 240 s, and any user can trigger it through
 * "reingest all" on any site, so no single transaction may get near that. This rehearsal drives the
 * production sequence on the real ConnectionManager singleton, on a seeded Mpala shape:
 * replaceCensusForCleanReupload, then beginTransaction / stageMeasurementChunk / commitTransaction
 * with the worker's parameters. Test-side only, it wraps the instance's beginTransaction,
 * commitTransaction and rollbackTransaction (which withTransaction calls through `this`) to time every
 * transaction from BEGIN to COMMIT or ROLLBACK, and classifies each by the statements it ran.
 *
 * Runs (each gated by RUN_EXPECTATIONS, the one list that also feeds SUMMARY.passed):
 *   1 replacementRun      replacement + first chunk; every transaction within LOCAL_TRANSACTION_BUDGET_MS,
 *                         exact replaced state, controls untouched, the window statements EXPLAIN as range on PRIMARY
 *   2 interruptedRun      fresh seed; failure injected at the coremeasurements DELETE of the middle window;
 *                         the committed windows stay deleted and audited, the marker stays unset, nothing is staged
 *   3 resumedRun          retry of run 2 with the same batch and session; finishes the replacement, no double audit
 *   4 stagingRollbackRun  fresh seed; failure injected at the staging insert after the replacement; staging rolls back,
 *                         the marker stays set, the census stays replaced; the retry runs no replacement transaction
 *   5 recoveryRun         ingestBatch on a failed-first census (the #562 recovery, 412,427 rows at the full profile): bounded
 *                         recovery_window transactions then one recovery_final, all outside setup and within budget, flat window
 *                         locks, one scope read, exact recovered state, setup issues no coremeasurements DELETE
 *   6 interruptedRecoveryRun  fresh seed; failure injected at the coremeasurements DELETE of the middle recovery window; exactly
 *                         the committed windows' lowest ids are gone and audited, setup never starts; the retry meets run 5's bar
 *   7 residualRecoveryRun run 5 plus the supported legacy residue (residual trees and stems, stale staged rows); the final
 *                         transaction stays within budget and the residue is gone
 *
 * Profiles (env CENSUS_REPLACEMENT_REHEARSAL):
 *   full  — the measured Mpala counts. ONLY a full SUMMARY with "passed":true satisfies acceptance criterion 9
 *           of the #555 spec; a smoke SUMMARY proves the harness, not the scale.
 *   smoke — same shape at about 1/20 scale, for authoring and self-checks.
 *   unset — every test is skipped; the normal suite and CI never pay for this file.
 *
 * Run (from frontend/, local MySQL up, no other integration suite running; a full run writes several GB of binlog):
 *   caffeinate -dimsu env CENSUS_REPLACEMENT_REHEARSAL=full npx vitest run --config vitest.integration.config.mts tests/integration/census-replacement-rehearsal.integration.test.ts
 *   CENSUS_REPLACEMENT_REHEARSAL=smoke npx vitest run --config vitest.integration.config.mts tests/integration/census-replacement-rehearsal.integration.test.ts
 *
 * Pass rule: every count, fingerprint and kind-count check holds in all four runs, every transaction of runs 1 and 3
 * finishes begin-to-end within LOCAL_TRANSACTION_BUDGET_MS, and the SUMMARY line reads "passed":true. Any failure
 * triggers the stop rule: escalate before anyone asks for the Mpala re-upload. A local pass is not an Azure guarantee.
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
import {
  CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS,
  replaceCensusForCleanReupload,
  stageMeasurementChunk,
  type CensusReplacementOutcome,
  type CensusReplacementParams,
  type CensusReplacementResult
} from '@/lib/uploads/stage-measurements';
import { CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE } from '@/lib/ingestion/temporary-measurements';
import { CENSUS_REPLACEMENT_STATEMENT } from '../setup/census-replacement-statement-patterns';
import { captureCensusReplacementWindowStatements } from '../setup/census-replacement-statement-capture';
import { ensureUploadSessionsTable } from '@/config/uploadsessiontracker';
import { CENSUS_REPLACEMENT_MARKER_COLUMN, resetUploadSessionReplacementMarkerCacheForTests } from '@/lib/uploads/upload-session-replacement-marker';
import { buildSubBatchPattern, getIngestionBatchSize, LIKE_ESCAPE_CLAUSE, SUB_BATCH_ORDINAL_WIDTH, SUB_BATCH_SEPARATOR } from '@/lib/uploads/batch-family';
import { ingestBatch, type IngestBatchResult, type SetupDiagnostic } from '@/lib/uploads/ingest-batch';
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
  /** Run 7 (spec #562 Goal 3): legacy residual trees (one stem each) and stale staged rows of census 3. */
  residualTreeRows: number;
  residualStagedRows: number;
}

/** Measured on forestgeo_mpala, 2026-10-26: 6 parse rejects + 412,421 SQL_EXCEPTION rows over 42 sub-batches of 10,000. */
const MPALA_SUB_BATCH_ROWS = 10_000;
const MPALA_PARSE_REJECT_ROWS = 6;
const MPALA_FAILED_SUB_BATCH_COUNT = 42;
/** Spec #562 Goal 3: the supported legacy residue per census (trees, stems and stale staged rows each), lowered from 100,000 after run 7 measured 0.138 ms per residual row at that size. */
const SUPPORTED_RESIDUAL_ROWS = 30_000;
const SMOKE_RESIDUAL_ROWS = 5_000;

const REHEARSAL_PROFILES: Record<RehearsalProfile['name'], RehearsalProfile> = {
  full: {
    name: 'full',
    censusOneRows: 363_983,
    censusTwoRows: 156_492,
    failedSubBatchRows: 412_421,
    subBatchRows: MPALA_SUB_BATCH_ROWS,
    residualTreeRows: SUPPORTED_RESIDUAL_ROWS,
    residualStagedRows: SUPPORTED_RESIDUAL_ROWS
  },
  smoke: {
    name: 'smoke',
    censusOneRows: 3_640,
    censusTwoRows: 1_565,
    failedSubBatchRows: 20_521,
    subBatchRows: 500,
    residualTreeRows: SMOKE_RESIDUAL_ROWS,
    residualStagedRows: SMOKE_RESIDUAL_ROWS
  }
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
/** Every transaction, BEGIN to COMMIT or ROLLBACK: the production callback deadline over the Azure factor (15,000 ms). */
const LOCAL_TRANSACTION_BUDGET_MS = CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS / AZURE_SAFETY_FACTOR;

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
const RECOVERY_INCOMING_ROWS = 100;
const RECOVERY_INCOMING_FILE = 'mpala_census3_recovery.csv';
const RECOVERY_INCOMING_TAG_PREFIX = 'RC3T';
const RECOVERY_STALE_FILE = 'mpala_census3_stale_staging.csv';
const RECOVERY_STALE_BATCH = 'rehearsal-stale-family';
const RESIDUAL_TREE_TAG_PREFIX = 'RES3T';
const WINDOW_FLATNESS_RATIO_LIMIT = 3;
const WINDOW_FLATNESS_NOISE_FLOOR_MS = 10;
const DECILE_COUNT = 10;
const CONTROL_TAG_PREFIX = { CENSUS_ONE: 'C1T', CENSUS_TWO: 'C2T' } as const;
const FAILED_TAG_PREFIX = 'C3T';
const REHEARSAL_CHANGED_BY = 'census-replacement-rehearsal';
const SESSION_USER = 'census-replacement-rehearsal@forestgeo.test';
const SESSION_STATE_UPLOADING = 'uploading';
const SESSION_ID = {
  REPLACEMENT_RUN: 'rehearsal-replacement-session',
  INTERRUPTED_RUN: 'rehearsal-interrupted-session',
  STAGING_ROLLBACK_RUN: 'rehearsal-staging-rollback-session'
} as const;

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
// Statement and transaction timing (test-side only; product code gets no instrumentation)
// ---------------------------------------------------------------------------

const STATEMENT_PHASE = {
  SESSION_LOCK: 'sessionLock',
  ERROR_LINK_DELETE: 'errorLinkDelete',
  COREMEASUREMENT_SELECT_FOR_UPDATE: 'coreMeasurementSelectForUpdate',
  COREMEASUREMENT_DELETE_AUDIT: 'coreMeasurementDeleteAudit',
  COREMEASUREMENT_DELETE: 'coreMeasurementDelete',
  LEGACY_DELETE: 'legacyDelete',
  UPLOADMETRICS_DELETE: 'uploadMetricsDelete',
  MARKER_UPDATE: 'markerUpdate',
  STAGING_INSERT: 'stagingInsert',
  RECOVERY_SCOPE_READ: 'recoveryScopeRead',
  CENSUS_LOCK: 'censusLock',
  RECOVERY_GUARD: 'recoveryGuard',
  WINDOW_LOCK: 'windowLock',
  RECOVERY_FINAL_READ: 'recoveryFinalRead',
  RECOVERY_FINAL: 'recoveryFinal',
  SETUP_DISCOVERY: 'setupDiscovery',
  SUB_BATCH_CALL: 'subBatchCall',
  OTHER: 'other'
} as const;
type StatementPhase = (typeof STATEMENT_PHASE)[keyof typeof STATEMENT_PHASE];

/** Runs 1-4: every one of these must match at least one statement in a run that finishes the replacement and commits its staging. */
const REPLACEMENT_RUN_PHASES: readonly StatementPhase[] = [
  STATEMENT_PHASE.SESSION_LOCK,
  STATEMENT_PHASE.ERROR_LINK_DELETE,
  STATEMENT_PHASE.COREMEASUREMENT_SELECT_FOR_UPDATE,
  STATEMENT_PHASE.COREMEASUREMENT_DELETE_AUDIT,
  STATEMENT_PHASE.COREMEASUREMENT_DELETE,
  STATEMENT_PHASE.LEGACY_DELETE,
  STATEMENT_PHASE.UPLOADMETRICS_DELETE,
  STATEMENT_PHASE.MARKER_UPDATE,
  STATEMENT_PHASE.STAGING_INSERT
];

/** Runs 5-7: the recovery's own statements plus the setup and sub-batch work that follows it. */
const RECOVERY_RUN_PHASES: readonly StatementPhase[] = [
  STATEMENT_PHASE.RECOVERY_SCOPE_READ,
  STATEMENT_PHASE.CENSUS_LOCK,
  STATEMENT_PHASE.RECOVERY_GUARD,
  STATEMENT_PHASE.WINDOW_LOCK,
  STATEMENT_PHASE.RECOVERY_FINAL_READ,
  STATEMENT_PHASE.RECOVERY_FINAL,
  STATEMENT_PHASE.COREMEASUREMENT_DELETE_AUDIT,
  STATEMENT_PHASE.COREMEASUREMENT_DELETE,
  STATEMENT_PHASE.SETUP_DISCOVERY,
  STATEMENT_PHASE.SUB_BATCH_CALL
];

/** The window's cursor SELECT, with or without the optimizer hint production puts in front of the select list. */
const COREMEASUREMENT_SELECT_FOR_UPDATE_PATTERN =
  /^\s*SELECT\s+(\/\*\+[^*]*\*\/\s+)?(DISTINCT\s+)?\S*CoreMeasurementID\s+FROM\s+\S+\.coremeasurements[\s\S]*FOR UPDATE\s*$/i;
const STAGING_INSERT_PATTERN = /^\s*INSERT IGNORE INTO\s+\S+\.temporarymeasurements\b/i;

const RECOVERY_SCOPE_READ_PATTERN = /^\s*SELECT\s+CoreMeasurementID\s+FROM\s+\S+\.coremeasurements\s+WHERE\s+CensusID = \?\s+ORDER BY\s+CoreMeasurementID\s*$/;
const CENSUS_LOCK_PATTERN = /^\s*SELECT CensusID FROM\s+\S+\.census WHERE CensusID = \? FOR UPDATE\s*$/;
const RECOVERY_GUARD_PATTERN = /^\s*SELECT COUNT\(\*\) AS completedUploads FROM\s+\S+\.uploadmetrics/;
/** The statement that locks a recovery window's ids: on the base code today's census-wide `LIMIT … FOR UPDATE`, after #562 the PRIMARY lock. */
const RECOVERY_WINDOW_LOCK_PATTERN =
  /^\s*SELECT\s+(\/\*\+\s+INDEX\(coremeasurements PRIMARY\)\s+\*\/\s+)?CoreMeasurementID\s+FROM\s+\S+\.coremeasurements\s+WHERE\s+(\(CensusID = \?\)\s+AND\s+CoreMeasurementID\s+IN|CensusID = \?\s+ORDER BY\s+CoreMeasurementID\s+LIMIT)[\s\S]*FOR UPDATE\s*$/;
const RECOVERY_FINAL_READ_PATTERN = /^\s*SELECT CoreMeasurementID FROM\s+\S+\.coremeasurements WHERE CensusID = \? ORDER BY CoreMeasurementID LIMIT \d+\s*$/;
/** The final transaction's residue statements (the metrics DELETE is classified with the replacement's METRICS_DELETE pattern below it, so it is listed here first). */
const RECOVERY_FINAL_PATTERN =
  /^\s*DELETE (FROM\s+\S+\.(measurementssummary|stems|trees|uploadintegrityalerts)\s+WHERE\s+(PlotID = \? AND )?CensusID = \?|tm\s+FROM\s+\S+\.temporarymeasurements tm\s+INNER JOIN\s+\S+\.uploadmetrics um|FROM\s+\S+\.uploadmetrics WHERE PlotID = \? AND CensusID = \? AND status IN)/;
const SETUP_DISCOVERY_PATTERN = /GROUP BY BatchID\s+ORDER BY BatchID FOR UPDATE\s*$/;
const SUB_BATCH_CALL_PATTERN = /CALL\s+\S*bulkingestionprocess/i;

const STATEMENT_PHASE_PATTERNS: ReadonlyArray<{ phase: StatementPhase; pattern: RegExp }> = [
  { phase: STATEMENT_PHASE.RECOVERY_SCOPE_READ, pattern: RECOVERY_SCOPE_READ_PATTERN },
  { phase: STATEMENT_PHASE.CENSUS_LOCK, pattern: CENSUS_LOCK_PATTERN },
  { phase: STATEMENT_PHASE.RECOVERY_GUARD, pattern: RECOVERY_GUARD_PATTERN },
  { phase: STATEMENT_PHASE.WINDOW_LOCK, pattern: RECOVERY_WINDOW_LOCK_PATTERN },
  { phase: STATEMENT_PHASE.RECOVERY_FINAL_READ, pattern: RECOVERY_FINAL_READ_PATTERN },
  { phase: STATEMENT_PHASE.RECOVERY_FINAL, pattern: RECOVERY_FINAL_PATTERN },
  { phase: STATEMENT_PHASE.SETUP_DISCOVERY, pattern: SETUP_DISCOVERY_PATTERN },
  { phase: STATEMENT_PHASE.SUB_BATCH_CALL, pattern: SUB_BATCH_CALL_PATTERN },
  { phase: STATEMENT_PHASE.SESSION_LOCK, pattern: CENSUS_REPLACEMENT_STATEMENT.SESSION_LOCK },
  { phase: STATEMENT_PHASE.ERROR_LINK_DELETE, pattern: CENSUS_REPLACEMENT_STATEMENT.ERROR_LINK_DELETE },
  { phase: STATEMENT_PHASE.COREMEASUREMENT_SELECT_FOR_UPDATE, pattern: COREMEASUREMENT_SELECT_FOR_UPDATE_PATTERN },
  { phase: STATEMENT_PHASE.COREMEASUREMENT_DELETE_AUDIT, pattern: CENSUS_REPLACEMENT_STATEMENT.DELETE_AUDIT },
  { phase: STATEMENT_PHASE.COREMEASUREMENT_DELETE, pattern: CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_DELETE },
  { phase: STATEMENT_PHASE.LEGACY_DELETE, pattern: CENSUS_REPLACEMENT_STATEMENT.LEGACY_DELETE },
  { phase: STATEMENT_PHASE.UPLOADMETRICS_DELETE, pattern: CENSUS_REPLACEMENT_STATEMENT.METRICS_DELETE },
  { phase: STATEMENT_PHASE.MARKER_UPDATE, pattern: CENSUS_REPLACEMENT_STATEMENT.MARKER_UPDATE },
  { phase: STATEMENT_PHASE.STAGING_INSERT, pattern: STAGING_INSERT_PATTERN }
];

function classifyStatement(sql: string): StatementPhase {
  return STATEMENT_PHASE_PATTERNS.find(candidate => candidate.pattern.test(sql))?.phase ?? STATEMENT_PHASE.OTHER;
}

interface TimedStatement {
  phase: StatementPhase;
  /** Null for statements run outside any transaction (the preliminary probes). */
  transactionID: string | null;
  /** performance.now() before the statement ran. */
  startedAtMs: number;
  durationMs: number;
  preview: string;
}

/** Throw on the `occurrence`-th (1-based) statement of `phase`. */
interface FailureInjection {
  phase: StatementPhase;
  occurrence: number;
}

interface StatementTimer {
  statements: TimedStatement[];
  /** True once the injected failure has been thrown. */
  injectionFired(): boolean;
  restore(): void;
}

class InjectedRehearsalFailureError extends Error {
  constructor(injection: FailureInjection) {
    super(`Injected failure at statement ${injection.occurrence} of phase ${injection.phase} (census-replacement rehearsal)`);
    this.name = 'InjectedRehearsalFailureError';
  }
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function previewOf(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().slice(0, STATEMENT_PREVIEW_LENGTH);
}

function installStatementTimer(connectionManager: ConnectionManager, injection: FailureInjection | null): StatementTimer {
  const originalExecuteQuery = connectionManager.executeQuery;
  const statements: TimedStatement[] = [];
  let seenInInjectedPhase = 0;
  let fired = false;
  connectionManager.executeQuery = async (query: string, params?: unknown[], transactionId?: string) => {
    const phase = classifyStatement(query);
    const transactionID = transactionId ?? null;
    if (injection !== null && phase === injection.phase) {
      seenInInjectedPhase += 1;
      if (seenInInjectedPhase === injection.occurrence) {
        fired = true;
        statements.push({ phase, transactionID, startedAtMs: performance.now(), durationMs: 0, preview: previewOf(query) });
        throw new InjectedRehearsalFailureError(injection);
      }
    }
    const startedAt = performance.now();
    try {
      return await originalExecuteQuery.call(connectionManager, query, params, transactionId);
    } finally {
      statements.push({ phase, transactionID, startedAtMs: startedAt, durationMs: performance.now() - startedAt, preview: previewOf(query) });
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

const TRANSACTION_KIND = {
  MEASUREMENT_WINDOW: 'measurement_window',
  LEGACY_PASS: 'legacy_pass',
  METRICS_WINDOW: 'metrics_window',
  COMPLETION: 'completion',
  STAGING: 'staging',
  RECOVERY_WINDOW: 'recovery_window',
  RECOVERY_FINAL: 'recovery_final',
  SETUP: 'setup',
  SUB_BATCH: 'sub_batch',
  UNCLASSIFIED: 'unclassified'
} as const;
type TransactionKind = (typeof TRANSACTION_KIND)[keyof typeof TRANSACTION_KIND];

/** What the transaction's statements say it was; the first match wins. */
const TRANSACTION_KIND_BY_PHASE: ReadonlyArray<{ phase: StatementPhase; kind: TransactionKind }> = [
  { phase: STATEMENT_PHASE.RECOVERY_FINAL_READ, kind: TRANSACTION_KIND.RECOVERY_FINAL },
  // On the base code the recovery runs inside setup, so its window locks then count toward 'setup'.
  { phase: STATEMENT_PHASE.SETUP_DISCOVERY, kind: TRANSACTION_KIND.SETUP },
  { phase: STATEMENT_PHASE.CENSUS_LOCK, kind: TRANSACTION_KIND.RECOVERY_WINDOW },
  { phase: STATEMENT_PHASE.SUB_BATCH_CALL, kind: TRANSACTION_KIND.SUB_BATCH },
  { phase: STATEMENT_PHASE.STAGING_INSERT, kind: TRANSACTION_KIND.STAGING },
  { phase: STATEMENT_PHASE.COREMEASUREMENT_SELECT_FOR_UPDATE, kind: TRANSACTION_KIND.MEASUREMENT_WINDOW },
  { phase: STATEMENT_PHASE.LEGACY_DELETE, kind: TRANSACTION_KIND.LEGACY_PASS },
  { phase: STATEMENT_PHASE.UPLOADMETRICS_DELETE, kind: TRANSACTION_KIND.METRICS_WINDOW },
  { phase: STATEMENT_PHASE.MARKER_UPDATE, kind: TRANSACTION_KIND.COMPLETION }
];

function classifyTransaction(statements: TimedStatement[]): TransactionKind {
  const phases = new Set(statements.map(statement => statement.phase));
  return TRANSACTION_KIND_BY_PHASE.find(candidate => phases.has(candidate.phase))?.kind ?? TRANSACTION_KIND.UNCLASSIFIED;
}

type TransactionEnd = 'committed' | 'rolled_back' | 'commit_failed';

interface TransactionRecord {
  transactionID: string;
  kind: TransactionKind;
  end: TransactionEnd;
  /** BEGIN to the end of COMMIT or ROLLBACK. */
  durationMs: number;
  /** performance.now() at the end of COMMIT or ROLLBACK. */
  endedAtMs: number;
}

interface TransactionTimer {
  /** Finished transactions, classified by the statements the statement timer saw under their ids. */
  records(statements: TimedStatement[]): TransactionRecord[];
  restore(): void;
}

function installTransactionTimer(connectionManager: ConnectionManager): TransactionTimer {
  const originalBegin = connectionManager.beginTransaction;
  const originalCommit = connectionManager.commitTransaction;
  const originalRollback = connectionManager.rollbackTransaction;
  const beganAtByTransaction = new Map<string, number>();
  const finished: Array<{ transactionID: string; end: TransactionEnd; durationMs: number; endedAtMs: number }> = [];

  const finish = (transactionID: string, end: TransactionEnd) => {
    const beganAt = beganAtByTransaction.get(transactionID);
    if (beganAt === undefined) return;
    const endedAtMs = performance.now();
    finished.push({ transactionID, end, durationMs: endedAtMs - beganAt, endedAtMs });
    beganAtByTransaction.delete(transactionID);
  };

  connectionManager.beginTransaction = async () => {
    const beganAt = performance.now();
    const transactionID = await originalBegin.call(connectionManager);
    beganAtByTransaction.set(transactionID, beganAt);
    return transactionID;
  };
  connectionManager.commitTransaction = async (transactionID: string) => {
    try {
      await originalCommit.call(connectionManager, transactionID);
    } catch (error) {
      finish(transactionID, 'commit_failed');
      throw error;
    }
    finish(transactionID, 'committed');
  };
  connectionManager.rollbackTransaction = async (transactionID: string) => {
    try {
      await originalRollback.call(connectionManager, transactionID);
    } finally {
      finish(transactionID, 'rolled_back');
    }
  };

  return {
    records: statements =>
      finished.map(transaction => ({
        ...transaction,
        kind: classifyTransaction(statements.filter(statement => statement.transactionID === transaction.transactionID))
      })),
    restore: () => {
      connectionManager.beginTransaction = originalBegin;
      connectionManager.commitTransaction = originalCommit;
      connectionManager.rollbackTransaction = originalRollback;
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

const MEDIAN_FRACTION = 0.5;
const P95_FRACTION = 0.95;

/** Nearest-rank percentile of an ascending-sorted, non-empty list. */
function percentileOf(sortedAscending: number[], fraction: number): number {
  return sortedAscending[Math.max(0, Math.ceil(fraction * sortedAscending.length) - 1)];
}

function emptyKindCounts(): Record<TransactionKind, number> {
  return Object.fromEntries(Object.values(TRANSACTION_KIND).map(kind => [kind, 0])) as Record<TransactionKind, number>;
}

function countKinds(transactions: TransactionRecord[]): Record<TransactionKind, number> {
  const counts = emptyKindCounts();
  for (const transaction of transactions) counts[transaction.kind] += 1;
  return counts;
}

interface TransactionDurationSummary {
  transactionCount: number;
  transactionMs: { p50: number; p95: number; max: number };
  slowestTransactionKind: TransactionKind | null;
}

function summarizeTransactionDurations(transactions: TransactionRecord[]): TransactionDurationSummary {
  if (transactions.length === 0) return { transactionCount: 0, transactionMs: { p50: 0, p95: 0, max: 0 }, slowestTransactionKind: null };
  const sortedDurations = transactions.map(transaction => transaction.durationMs).sort((first, second) => first - second);
  const slowest = transactions.reduce((slowestSoFar, transaction) => (transaction.durationMs > slowestSoFar.durationMs ? transaction : slowestSoFar));
  return {
    transactionCount: transactions.length,
    transactionMs: {
      p50: Math.round(percentileOf(sortedDurations, MEDIAN_FRACTION)),
      p95: Math.round(percentileOf(sortedDurations, P95_FRACTION)),
      max: Math.round(sortedDurations[sortedDurations.length - 1])
    },
    slowestTransactionKind: slowest.kind
  };
}

// ---------------------------------------------------------------------------
// Expected shapes of the window sequence
// ---------------------------------------------------------------------------

const SINGLE_TRANSACTION = 1;
const FIRST_WINDOW_ORDINAL = 1;

/**
 * Unit A's transactions for `rows` prior rows: one per window that deletes, plus the cursor-0
 * confirming window, plus one empty continuation window when the last deleting window was full.
 */
function expectedMeasurementWindowCount(rows: number, windowSize: number): number {
  const deletingWindows = Math.ceil(rows / windowSize);
  const lastDeletingWindowWasFull = rows % windowSize === 0;
  return deletingWindows + (lastDeletingWindowWasFull ? 2 : 1);
}

/** The middle deleting window (1-based): the one whose DELETE run 2 fails. */
function interruptedWindowIndex(rows: number, windowSize: number): number {
  return Math.max(FIRST_WINDOW_ORDINAL, Math.ceil(Math.ceil(rows / windowSize) / 2));
}

/** Rows the replacement has deleted when `windowIndex` (1-based) begins: every earlier window was full. */
function rowsDeletedBeforeWindow(windowIndex: number): number {
  return (windowIndex - FIRST_WINDOW_ORDINAL) * CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE;
}

interface RecoveryShape {
  slices: number;
  recoveryWindows: number;
  recoveryFinals: number;
  interruptedWindow: number;
  rowsGoneWhenInterrupted: number;
}

class InterruptedWindowNotCommittedError extends Error {
  constructor(window: number, windows: number) {
    super(`interrupted window ${window} is not one of the ${windows} committed recovery windows; run 6 would interrupt the final transaction`);
    this.name = 'InterruptedWindowNotCommittedError';
  }
}

/** Spec #562 rehearsal table: every slice but the last is a window transaction; the last slice is held back into the final transaction. */
function expectedRecoveryShape(rows: number, windowSize: number): RecoveryShape {
  const slices = Math.ceil(rows / windowSize);
  const recoveryWindows = slices - 1;
  const interruptedWindow = interruptedWindowIndex(rows, windowSize);
  if (interruptedWindow > recoveryWindows) throw new InterruptedWindowNotCommittedError(interruptedWindow, recoveryWindows);
  return {
    slices,
    recoveryWindows,
    recoveryFinals: SINGLE_TRANSACTION,
    interruptedWindow,
    rowsGoneWhenInterrupted: rowsDeletedBeforeWindow(interruptedWindow)
  };
}

/** Spec #562 rehearsal table, the reference the derivation is checked against. */
const SPEC_RECOVERY_SHAPES: Record<RehearsalProfile['name'], RecoveryShape> = {
  full: { slices: 413, recoveryWindows: 412, recoveryFinals: 1, interruptedWindow: 207, rowsGoneWhenInterrupted: 206_000 },
  smoke: { slices: 21, recoveryWindows: 20, recoveryFinals: 1, interruptedWindow: 11, rowsGoneWhenInterrupted: 10_000 }
};

function decileMeansMs(durations: number[]): number[] {
  if (durations.length < DECILE_COUNT) return [];
  const size = Math.floor(durations.length / DECILE_COUNT);
  return Array.from({ length: DECILE_COUNT }, (_, decile) => {
    const slice = durations.slice(decile * size, decile === DECILE_COUNT - 1 ? durations.length : (decile + 1) * size);
    return Math.round((slice.reduce((sum, value) => sum + value, 0) / slice.length) * 100) / 100;
  });
}

function windowLockIsFlat(deciles: number[]): boolean {
  return deciles.length === DECILE_COUNT && deciles[DECILE_COUNT - 1] <= WINDOW_FLATNESS_RATIO_LIMIT * deciles[0] + WINDOW_FLATNESS_NOISE_FLOOR_MS;
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

type RunOutcome = 'committed' | 'replacement_interrupted' | 'staging_rolled_back' | 'failed';
type RunKey = 'replacementRun' | 'interruptedRun' | 'resumedRun' | 'stagingRollbackRun';
const RUN_KEYS: readonly RunKey[] = ['replacementRun', 'interruptedRun', 'resumedRun', 'stagingRollbackRun'];

/** Filled in after the run's state checks complete; null means verification never finished. */
interface RunVerification {
  /** Checks taken before the run started (the fresh census-3 seed for runs 2 and 4). */
  preRunMismatches: string[];
  /** EXPLAIN of the window's DELETE and audit INSERT (run 1 only). */
  statementPlanMismatches: string[];
  countMismatches: string[];
  controlCensusMismatches: string[];
}

interface OverBudgetTransaction {
  kind: TransactionKind;
  end: TransactionEnd;
  durationMs: number;
}

/** The attempt that follows run 4's staging rollback, with the same batch and session. */
interface RetryAfterRollbackSummary {
  outcome: RunOutcome;
  replacementOutcome: CensusReplacementOutcome | null;
  transactionKindCounts: Record<TransactionKind, number>;
  error: string | null;
  stateMismatches: string[];
}

interface RunSummary extends TransactionDurationSummary {
  outcome: RunOutcome;
  endToEndMs: number;
  replacementOutcome: CensusReplacementOutcome | null;
  /** Unit A's transactions: the windows that deleted plus the confirming window. */
  measurementWindowCount: number;
  transactionKindCounts: Record<TransactionKind, number>;
  rolledBackTransactions: number;
  overBudgetTransactions: OverBudgetTransaction[];
  injection: FailureInjection | null;
  injectionFired: boolean;
  error: string | null;
  rollbackError: string | null;
  phases: Record<StatementPhase, PhaseTotals>;
  slowestStatement: TimedStatement | null;
  unmatchedPhases: StatementPhase[];
  verification: RunVerification | null;
  retryAfterRollback: RetryAfterRollbackSummary | null;
}

interface RehearsalSummary {
  rehearsal: 'census-replacement';
  profile: RehearsalProfile['name'] | null;
  schema: string | null;
  mysqlVersion: string | null;
  innodbBufferPoolBytes: number | null;
  budgetMs: number;
  reaperThresholdMs: number;
  measurementWindowSize: number;
  seed: { censusOneRows: number; censusTwoRows: number; censusThreeFailedRows: number; failedSubBatches: number; seedMs: number; mismatches: string[] } | null;
  runs: Partial<Record<RunKey, RunSummary>>;
  recoveryRuns: Partial<Record<RecoveryRunKey, RecoveryRunSummary>>;
  failedChecks: string[];
  passed: boolean;
}

const rehearsalSummary: RehearsalSummary = {
  rehearsal: 'census-replacement',
  profile: rehearsalProfile?.name ?? null,
  schema: null,
  mysqlVersion: null,
  innodbBufferPoolBytes: null,
  budgetMs: LOCAL_TRANSACTION_BUDGET_MS,
  reaperThresholdMs: STALE_TRANSACTION_REAPER_THRESHOLD_MS,
  measurementWindowSize: CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE,
  seed: null,
  runs: {},
  recoveryRuns: {},
  failedChecks: [],
  passed: false
};

interface RunExpectation {
  outcome: RunOutcome;
  /** Null when the replacement throws before returning. */
  replacementOutcome: CensusReplacementOutcome | null;
  injection: FailureInjection | null;
  /** True when every transaction of the run must finish within LOCAL_TRANSACTION_BUDGET_MS. */
  budgeted: boolean;
  transactionKindCounts: Record<TransactionKind, number>;
  rolledBackTransactions: number;
  expectsRetryAfterRollback: boolean;
}

function kindCounts(counts: Partial<Record<TransactionKind, number>>): Record<TransactionKind, number> {
  return { ...emptyKindCounts(), ...counts };
}

function fullSequenceKindCounts(priorRows: number): Record<TransactionKind, number> {
  return kindCounts({
    [TRANSACTION_KIND.MEASUREMENT_WINDOW]: expectedMeasurementWindowCount(priorRows, CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE),
    [TRANSACTION_KIND.LEGACY_PASS]: SINGLE_TRANSACTION,
    [TRANSACTION_KIND.METRICS_WINDOW]: SINGLE_TRANSACTION,
    [TRANSACTION_KIND.COMPLETION]: SINGLE_TRANSACTION,
    [TRANSACTION_KIND.STAGING]: SINGLE_TRANSACTION
  });
}

/** The single definition of "this run passed", used by each test's assertion AND by SUMMARY.passed, so the two cannot diverge. */
function buildRunExpectations(profile: RehearsalProfile): Record<RunKey, RunExpectation> {
  const priorRows = failedRowTotal(profile);
  const interruptedWindow = interruptedWindowIndex(priorRows, CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE);
  const interruptedRunInjection: FailureInjection = { phase: STATEMENT_PHASE.COREMEASUREMENT_DELETE, occurrence: interruptedWindow };
  const rowsLeftAfterInterruption = priorRows - rowsDeletedBeforeWindow(interruptedWindow);
  return {
    replacementRun: {
      outcome: 'committed',
      replacementOutcome: 'replaced',
      injection: null,
      budgeted: true,
      transactionKindCounts: fullSequenceKindCounts(priorRows),
      rolledBackTransactions: 0,
      expectsRetryAfterRollback: false
    },
    interruptedRun: {
      outcome: 'replacement_interrupted',
      replacementOutcome: null,
      injection: interruptedRunInjection,
      budgeted: false,
      transactionKindCounts: kindCounts({ [TRANSACTION_KIND.MEASUREMENT_WINDOW]: interruptedWindow }),
      rolledBackTransactions: SINGLE_TRANSACTION,
      expectsRetryAfterRollback: false
    },
    resumedRun: {
      outcome: 'committed',
      replacementOutcome: 'replaced',
      injection: null,
      budgeted: true,
      transactionKindCounts: fullSequenceKindCounts(rowsLeftAfterInterruption),
      rolledBackTransactions: 0,
      expectsRetryAfterRollback: false
    },
    stagingRollbackRun: {
      outcome: 'staging_rolled_back',
      replacementOutcome: 'replaced',
      injection: { phase: STATEMENT_PHASE.STAGING_INSERT, occurrence: SINGLE_TRANSACTION },
      budgeted: false,
      transactionKindCounts: fullSequenceKindCounts(priorRows),
      rolledBackTransactions: SINGLE_TRANSACTION,
      expectsRetryAfterRollback: true
    }
  };
}

const RETRY_AFTER_ROLLBACK_EXPECTATION = {
  outcome: 'committed',
  replacementOutcome: 'already_completed',
  transactionKindCounts: kindCounts({ [TRANSACTION_KIND.STAGING]: SINGLE_TRANSACTION })
} as const;

function sameInjection(first: FailureInjection | null, second: FailureInjection | null): boolean {
  return first?.phase === second?.phase && first?.occurrence === second?.occurrence;
}

function describeInjection(injection: FailureInjection | null): string {
  return injection === null ? 'none' : `${injection.phase}#${injection.occurrence}`;
}

function runFailedChecks(key: RunKey, run: RunSummary | undefined, expectation: RunExpectation): string[] {
  if (!run) return [`${key}: never attempted`];
  const failed: string[] = [];
  if (run.outcome !== expectation.outcome) failed.push(`${key}: outcome ${run.outcome}, expected ${expectation.outcome}`);
  if (run.error !== null) failed.push(`${key}: unexpected error ${run.error}`);
  if (run.rollbackError !== null) failed.push(`${key}: rollback failed ${run.rollbackError}`);
  if (run.replacementOutcome !== expectation.replacementOutcome)
    failed.push(`${key}: replacement outcome ${run.replacementOutcome}, expected ${expectation.replacementOutcome}`);
  if (!sameInjection(run.injection, expectation.injection))
    failed.push(`${key}: injection ${describeInjection(run.injection)}, expected ${describeInjection(expectation.injection)}`);
  if (run.injectionFired !== (expectation.injection !== null)) failed.push(`${key}: injection fired=${run.injectionFired}`);
  failed.push(...describeMismatches(expectation.transactionKindCounts, run.transactionKindCounts).map(mismatch => `${key}: transaction kind ${mismatch}`));
  if (run.rolledBackTransactions !== expectation.rolledBackTransactions)
    failed.push(`${key}: ${run.rolledBackTransactions} rolled-back transactions, expected ${expectation.rolledBackTransactions}`);
  if (expectation.budgeted && run.overBudgetTransactions.length > 0)
    failed.push(
      `${key}: ${run.overBudgetTransactions.length} transactions over the ${LOCAL_TRANSACTION_BUDGET_MS} ms budget (slowest ${run.transactionMs.max} ms, a ${run.slowestTransactionKind}): ` +
        JSON.stringify(run.overBudgetTransactions)
    );
  if (expectation.outcome === 'committed' && run.unmatchedPhases.length > 0)
    failed.push(`${key}: phases matched no statement: ${run.unmatchedPhases.join(', ')}`);
  if (run.verification === null) {
    failed.push(`${key}: state verification did not complete`);
  } else {
    for (const [label, mismatches] of Object.entries(run.verification)) {
      if (mismatches.length > 0) failed.push(`${key}: ${label}: ${mismatches.join('; ')}`);
    }
  }
  failed.push(...retryAfterRollbackFailedChecks(key, run.retryAfterRollback, expectation.expectsRetryAfterRollback));
  return failed;
}

function retryAfterRollbackFailedChecks(key: RunKey, retry: RetryAfterRollbackSummary | null, expected: boolean): string[] {
  if (!expected) return retry === null ? [] : [`${key}: unexpected retry record`];
  if (retry === null) return [`${key}: the retry after the staging rollback never ran`];
  const failed: string[] = [];
  if (retry.outcome !== RETRY_AFTER_ROLLBACK_EXPECTATION.outcome)
    failed.push(`${key} retry: outcome ${retry.outcome}, expected ${RETRY_AFTER_ROLLBACK_EXPECTATION.outcome}`);
  if (retry.error !== null) failed.push(`${key} retry: unexpected error ${retry.error}`);
  if (retry.replacementOutcome !== RETRY_AFTER_ROLLBACK_EXPECTATION.replacementOutcome)
    failed.push(`${key} retry: replacement outcome ${retry.replacementOutcome}, expected ${RETRY_AFTER_ROLLBACK_EXPECTATION.replacementOutcome}`);
  failed.push(
    ...describeMismatches(RETRY_AFTER_ROLLBACK_EXPECTATION.transactionKindCounts, retry.transactionKindCounts).map(
      mismatch => `${key} retry: transaction kind ${mismatch}`
    )
  );
  failed.push(...retry.stateMismatches.map(mismatch => `${key} retry: ${mismatch}`));
  return failed;
}

// ---------------------------------------------------------------------------
// Recovery runs (#562): summary, expectations and checks
// ---------------------------------------------------------------------------

type RecoveryRunKey = 'recoveryRun' | 'interruptedRecoveryRun' | 'residualRecoveryRun';
const RECOVERY_RUN_KEYS: readonly RecoveryRunKey[] = ['recoveryRun', 'interruptedRecoveryRun', 'residualRecoveryRun'];
type RecoveryRunOutcome = 'recovered' | 'recovery_interrupted' | 'failed';
const RECOVERY_DIAGNOSTIC_STEP = 'recovery';
const BUDGETED_RECOVERY_KINDS: readonly TransactionKind[] = [TRANSACTION_KIND.RECOVERY_WINDOW, TRANSACTION_KIND.RECOVERY_FINAL, TRANSACTION_KIND.SETUP];

interface RecoveryRunVerification {
  preRunMismatches: string[];
  stateMismatches: string[];
  controlCensusMismatches: string[];
}

interface RecoveryRunSummary {
  outcome: RecoveryRunOutcome;
  recovered: boolean | null;
  endToEndMs: number;
  /** First recovery statement to the end of the recovery_final COMMIT; null when no final transaction committed (always on the base code). */
  recoveryEndToEndMs: number | null;
  /** The 'recovery' SetupDiagnostic's completed/failed elapsedMs minus its started elapsedMs. */
  recoveryDiagnosticMs: number | null;
  transactionKindCounts: Record<TransactionKind, number>;
  transactionMsByKind: Partial<Record<TransactionKind, { p50: number; p95: number; max: number }>>;
  rolledBackTransactions: number;
  overBudgetTransactions: OverBudgetTransaction[];
  scopeReadCount: number;
  windowLockCount: number;
  windowLockDecileMeansMs: number[];
  windowLockFlat: boolean;
  finalTransactionMs: number | null;
  /** Run 7: final transaction ms ÷ (residual trees + stems + staged rows). */
  residualRowCostMs: number | null;
  setupMeasurementDeletes: number;
  injection: FailureInjection | null;
  injectionFired: boolean;
  error: string | null;
  phases: Record<StatementPhase, PhaseTotals>;
  unmatchedPhases: StatementPhase[];
  verification: RecoveryRunVerification | null;
  retry: RecoveryRunSummary | null;
}

interface RecoveryIngestionResult {
  outcome: RecoveryRunOutcome;
  ingestion: IngestBatchResult | null;
  endToEndMs: number;
  injection: FailureInjection | null;
  injectionFired: boolean;
  error: string | null;
  statements: TimedStatement[];
  transactions: TransactionRecord[];
  diagnostics: SetupDiagnostic[];
}

function millisecondSpread(durations: number[]): { p50: number; p95: number; max: number } {
  const sorted = [...durations].sort((first, second) => first - second);
  return {
    p50: Math.round(percentileOf(sorted, MEDIAN_FRACTION)),
    p95: Math.round(percentileOf(sorted, P95_FRACTION)),
    max: Math.round(sorted[sorted.length - 1])
  };
}

function summarizeRecoveryRun(result: RecoveryIngestionResult, residualRows: number | null): RecoveryRunSummary {
  const kindByTransaction = new Map(result.transactions.map(transaction => [transaction.transactionID, transaction.kind]));
  const transactionMsByKind: RecoveryRunSummary['transactionMsByKind'] = {};
  for (const kind of Object.values(TRANSACTION_KIND)) {
    const durations = result.transactions.filter(transaction => transaction.kind === kind).map(transaction => transaction.durationMs);
    if (durations.length > 0) transactionMsByKind[kind] = millisecondSpread(durations);
  }
  const windowLocks = result.statements.filter(statement => statement.phase === STATEMENT_PHASE.WINDOW_LOCK);
  const windowLockDecileMeansMs = decileMeansMs(windowLocks.map(statement => statement.durationMs));
  const finalTransaction =
    result.transactions.find(transaction => transaction.kind === TRANSACTION_KIND.RECOVERY_FINAL && transaction.end === 'committed') ?? null;
  const firstRecoveryStatement =
    result.statements.find(statement => statement.phase === STATEMENT_PHASE.RECOVERY_SCOPE_READ || statement.phase === STATEMENT_PHASE.WINDOW_LOCK) ?? null;
  const recoveryStarted = result.diagnostics.find(diagnostic => diagnostic.step === RECOVERY_DIAGNOSTIC_STEP && diagnostic.outcome === 'started');
  const recoveryEnded = result.diagnostics.find(
    diagnostic => diagnostic.step === RECOVERY_DIAGNOSTIC_STEP && (diagnostic.outcome === 'completed' || diagnostic.outcome === 'failed')
  );
  const phases = summarizePhases(result.statements);
  const finalTransactionMs = finalTransaction ? Math.round(finalTransaction.durationMs) : null;
  return {
    outcome: result.outcome,
    recovered: result.ingestion?.recovered ?? null,
    endToEndMs: Math.round(result.endToEndMs),
    recoveryEndToEndMs: finalTransaction && firstRecoveryStatement ? Math.round(finalTransaction.endedAtMs - firstRecoveryStatement.startedAtMs) : null,
    recoveryDiagnosticMs: recoveryStarted && recoveryEnded ? Math.round(recoveryEnded.elapsedMs - recoveryStarted.elapsedMs) : null,
    transactionKindCounts: countKinds(result.transactions),
    transactionMsByKind,
    rolledBackTransactions: result.transactions.filter(transaction => transaction.end === 'rolled_back').length,
    overBudgetTransactions: result.transactions
      .filter(transaction => BUDGETED_RECOVERY_KINDS.includes(transaction.kind) && transaction.durationMs > LOCAL_TRANSACTION_BUDGET_MS)
      .map(transaction => ({ kind: transaction.kind, end: transaction.end, durationMs: Math.round(transaction.durationMs) })),
    scopeReadCount: phases[STATEMENT_PHASE.RECOVERY_SCOPE_READ].statements,
    windowLockCount: windowLocks.length,
    windowLockDecileMeansMs,
    windowLockFlat: windowLockIsFlat(windowLockDecileMeansMs),
    finalTransactionMs,
    residualRowCostMs: residualRows !== null && finalTransactionMs !== null ? finalTransactionMs / residualRows : null,
    setupMeasurementDeletes: result.statements.filter(
      statement =>
        statement.phase === STATEMENT_PHASE.COREMEASUREMENT_DELETE &&
        statement.transactionID !== null &&
        kindByTransaction.get(statement.transactionID) === TRANSACTION_KIND.SETUP
    ).length,
    injection: result.injection,
    injectionFired: result.injectionFired,
    error: result.error,
    phases,
    unmatchedPhases: RECOVERY_RUN_PHASES.filter(phase => phases[phase].statements === 0),
    verification: null,
    retry: null
  };
}

/** Records a recovery run in the SUMMARY immediately, before any verification query can fail. */
function recordRecoveryRun(key: RecoveryRunKey, result: RecoveryIngestionResult, residualRows: number | null): RecoveryRunSummary {
  const run = summarizeRecoveryRun(result, residualRows);
  rehearsalSummary.recoveryRuns[key] = run;
  console.log(`[census-replacement-rehearsal] ${key} ${JSON.stringify(run)}`);
  return run;
}

/** The checks every completed recovery shares (runs 5 and 7, and run 6's retry): the spec's run-5 bar. */
function completedRecoveryFailedChecks(label: string, run: RecoveryRunSummary, recoveryWindows: number, windowLocks: number): string[] {
  const failed: string[] = [];
  if (run.outcome !== 'recovered') failed.push(`${label}: outcome ${run.outcome}${run.error ? ` (${run.error})` : ''}, expected recovered`);
  if (run.recovered !== true) failed.push(`${label}: ingestBatch reported recovered=${run.recovered}`);
  const kinds = run.transactionKindCounts;
  if (kinds[TRANSACTION_KIND.RECOVERY_WINDOW] !== recoveryWindows)
    failed.push(`${label}: ${kinds[TRANSACTION_KIND.RECOVERY_WINDOW]} recovery_window transactions, expected ${recoveryWindows}`);
  if (kinds[TRANSACTION_KIND.RECOVERY_FINAL] !== SINGLE_TRANSACTION)
    failed.push(`${label}: ${kinds[TRANSACTION_KIND.RECOVERY_FINAL]} recovery_final transactions, expected ${SINGLE_TRANSACTION}`);
  if (kinds[TRANSACTION_KIND.SETUP] !== SINGLE_TRANSACTION)
    failed.push(`${label}: ${kinds[TRANSACTION_KIND.SETUP]} setup transactions, expected ${SINGLE_TRANSACTION}`);
  if (kinds[TRANSACTION_KIND.SUB_BATCH] < SINGLE_TRANSACTION) failed.push(`${label}: the incoming family was never ingested`);
  if (run.rolledBackTransactions !== 0) failed.push(`${label}: ${run.rolledBackTransactions} rolled-back transactions`);
  if (run.scopeReadCount !== SINGLE_TRANSACTION) failed.push(`${label}: ${run.scopeReadCount} scope reads, expected ${SINGLE_TRANSACTION}`);
  if (run.windowLockCount !== windowLocks) failed.push(`${label}: ${run.windowLockCount} window locks, expected ${windowLocks}`);
  if (!run.windowLockFlat)
    failed.push(
      `${label}: window locks grow (deciles ${JSON.stringify(run.windowLockDecileMeansMs)}; limit ${WINDOW_FLATNESS_RATIO_LIMIT}× first + ${WINDOW_FLATNESS_NOISE_FLOOR_MS} ms)`
    );
  if (run.overBudgetTransactions.length > 0)
    failed.push(`${label}: over the ${LOCAL_TRANSACTION_BUDGET_MS} ms budget: ${JSON.stringify(run.overBudgetTransactions)}`);
  if (run.setupMeasurementDeletes !== 0) failed.push(`${label}: the setup transaction issued ${run.setupMeasurementDeletes} coremeasurements DELETEs`);
  if (run.unmatchedPhases.length > 0) failed.push(`${label}: phases matched no statement: ${run.unmatchedPhases.join(', ')}`);
  failed.push(...verificationFailedChecks(label, run.verification));
  return failed;
}

function verificationFailedChecks(label: string, verification: RecoveryRunVerification | null): string[] {
  if (verification === null) return [`${label}: state verification did not complete`];
  return Object.entries(verification)
    .filter(([, mismatches]) => mismatches.length > 0)
    .map(([part, mismatches]) => `${label}: ${part}: ${mismatches.join('; ')}`);
}

/** The single definition of "this recovery run passed", used by each test and by SUMMARY.passed. */
function recoveryRunFailedChecks(key: RecoveryRunKey, run: RecoveryRunSummary | undefined, shape: RecoveryShape): string[] {
  if (!run) return [`${key}: never attempted`];
  if (key !== 'interruptedRecoveryRun') return completedRecoveryFailedChecks(key, run, shape.recoveryWindows, shape.slices);
  const failed: string[] = [];
  const injection: FailureInjection = { phase: STATEMENT_PHASE.COREMEASUREMENT_DELETE, occurrence: shape.interruptedWindow };
  if (run.outcome !== 'recovery_interrupted') failed.push(`${key}: outcome ${run.outcome}${run.error ? ` (${run.error})` : ''}, expected recovery_interrupted`);
  if (!sameInjection(run.injection, injection) || !run.injectionFired)
    failed.push(`${key}: injection ${describeInjection(run.injection)} fired=${run.injectionFired}, expected ${describeInjection(injection)}`);
  if (run.transactionKindCounts[TRANSACTION_KIND.RECOVERY_WINDOW] !== shape.interruptedWindow)
    failed.push(
      `${key}: ${run.transactionKindCounts[TRANSACTION_KIND.RECOVERY_WINDOW]} recovery_window transactions, expected ${shape.interruptedWindow} (the last rolled back)`
    );
  if (run.rolledBackTransactions !== SINGLE_TRANSACTION)
    failed.push(`${key}: ${run.rolledBackTransactions} rolled-back transactions, expected ${SINGLE_TRANSACTION}`);
  if (run.transactionKindCounts[TRANSACTION_KIND.SETUP] !== 0) failed.push(`${key}: setup began after an interrupted recovery`);
  failed.push(...verificationFailedChecks(key, run.verification));
  if (run.retry === null) failed.push(`${key}: the retry never ran`);
  else {
    const windowsAlreadyCommitted = shape.interruptedWindow - FIRST_WINDOW_ORDINAL;
    failed.push(
      ...completedRecoveryFailedChecks(`${key} retry`, run.retry, shape.recoveryWindows - windowsAlreadyCommitted, shape.slices - windowsAlreadyCommitted)
    );
  }
  return failed;
}

/** Census 3 after a completed recovery and the incoming family's ingestion. */
function expectedRecoveredState(profile: RehearsalProfile): CensusThreeState {
  const total = failedRowTotal(profile);
  return {
    failedFamilyRows: 0,
    failedFamilyErrorLinks: { MISSING_FIELD_SPECIESCODE: 0, SQL_EXCEPTION: 0 },
    censusThreeMeasurementRows: RECOVERY_INCOMING_ROWS,
    deleteAuditRows: total,
    distinctDeleteAuditRecords: total,
    insertAuditRows: total + RECOVERY_INCOMING_ROWS,
    uploadMetricsRows: SINGLE_TRANSACTION,
    failedUploadMetricsRows: 0,
    stagedReplacementRows: 0,
    sessionMarkerSet: false
  };
}

function rehearsalFailedChecks(summary: RehearsalSummary, expectations: Record<RunKey, RunExpectation>, recoveryShape: RecoveryShape): string[] {
  const failed: string[] = [];
  if (summary.seed === null) failed.push('seed: did not complete');
  else if (summary.seed.mismatches.length > 0) failed.push(`seed: ${summary.seed.mismatches.join('; ')}`);
  for (const key of RUN_KEYS) failed.push(...runFailedChecks(key, summary.runs[key], expectations[key]));
  for (const key of RECOVERY_RUN_KEYS) failed.push(...recoveryRunFailedChecks(key, summary.recoveryRuns[key], recoveryShape));
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
  /** Built in beforeAll: describe.skipIf still runs this callback with a null profile when the flag is unset. */
  let runExpectations: Record<RunKey, RunExpectation>;
  let recoveryShape: RecoveryShape;
  const interruptedRunBatchID = generateShortBatchID();
  const stagingRollbackRunBatchID = generateShortBatchID();

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
    await query(`DELETE FROM stems WHERE CensusID = ?`, [census]);
    await query(`DELETE FROM trees WHERE CensusID = ?`, [census]);
    await query(`DELETE FROM uploadintegrityalerts WHERE censusID = ?`, [census]);
    await query(`DELETE FROM measurementssummary WHERE CensusID = ?`, [census]);
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

  async function readCensusThreeState(incomingBatchID: string, sessionID: string, stagedFileName: string = REPLACEMENT_FILE): Promise<CensusThreeState> {
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
        [stagedFileName, census, incomingBatchID, buildSubBatchPattern(incomingBatchID)]
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

  function buildMeasurementChunk(rowCount: number, tagPrefix: string): Record<string, string>[] {
    // Key order mirrors CSV_HEADERS: the resolution plan keys values positionally, like a parsed CSV.
    return Array.from({ length: rowCount }, (_, index) => ({
      treetag: `${tagPrefix}${index}`,
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

  const RECOVERY_NO_SESSION = 'rehearsal-recovery-no-session';
  const RESIDUAL_STEM_TAG = 'R';

  async function stageRecoveryIncomingFamily(batchID: string): Promise<void> {
    const transactionID = await connectionManager.beginTransaction();
    try {
      const staged = await stageMeasurementChunk(connectionManager, {
        schema,
        fileName: RECOVERY_INCOMING_FILE,
        batchID,
        plotID,
        censusID: censusIDs.three,
        uploadMode: UploadMode.REVISIONS,
        sourceFormat: SourceFormat.csv,
        rawRows: buildMeasurementChunk(RECOVERY_INCOMING_ROWS, RECOVERY_INCOMING_TAG_PREFIX),
        csvHeaders: [...CSV_HEADERS],
        delimiter: CSV_DELIMITER,
        storedMapping: undefined,
        uploadSessionID: null,
        firstRowOrdinal: FIRST_CHUNK_ROW_ORDINAL,
        changedBy: REHEARSAL_CHANGED_BY,
        transactionID
      });
      await connectionManager.commitTransaction(transactionID);
      expect(staged.insertedCount, 'the incoming family stages whole').toBe(RECOVERY_INCOMING_ROWS);
      expect(RECOVERY_INCOMING_ROWS, 'the incoming family fits one sub-batch').toBeLessThanOrEqual(getIngestionBatchSize());
    } catch (stagingError) {
      await connectionManager.rollbackTransaction(transactionID);
      throw stagingError;
    }
  }

  /** Run 7: legacy residue of the trees/stems branch: residual trees with one stem each, and a stale staged family with its failed metric. */
  async function seedResidualCensusThree(): Promise<void> {
    const census = censusIDs.three;
    await query(`INSERT INTO trees (TreeTag, SpeciesID, CensusID) SELECT CONCAT(?, n), ?, ? FROM ${SEQUENCE_TABLE} WHERE n < ?`, [
      RESIDUAL_TREE_TAG_PREFIX,
      speciesID,
      census,
      profile.residualTreeRows
    ]);
    await query(
      `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY)
       SELECT TreeID, ?, CensusID, ?, 0, 0 FROM trees WHERE CensusID = ? AND TreeTag LIKE CONCAT(?, '%')`,
      [quadratID, RESIDUAL_STEM_TAG, census, RESIDUAL_TREE_TAG_PREFIX]
    );
    await query(
      `INSERT INTO temporarymeasurements (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, MeasurementDate)
       SELECT ?, ?, ?, ?, CONCAT(?, n), ?, ?, ?, ? FROM ${SEQUENCE_TABLE} WHERE n < ?`,
      [
        RECOVERY_STALE_FILE,
        RECOVERY_STALE_BATCH,
        plotID,
        census,
        RESIDUAL_TREE_TAG_PREFIX,
        STEM_TAG,
        SPECIES_CODE,
        QUADRAT_NAME,
        MEASUREMENT_DATE.CENSUS_THREE,
        profile.residualStagedRows
      ]
    );
    await query(
      `INSERT INTO uploadmetrics (uploadId, fileID, batchID, schema_name, plotID, censusID, sourceRecords, failedRecords, status, errorMessage, startTime, endTime)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        `${FAILED_UPLOAD_ID_PREFIX}${RECOVERY_STALE_BATCH}`,
        RECOVERY_STALE_FILE,
        RECOVERY_STALE_BATCH,
        schema,
        plotID,
        census,
        profile.residualStagedRows,
        profile.residualStagedRows,
        UPLOAD_STATUS_FAILED,
        FAILED_BATCH_ERROR_MESSAGE
      ]
    );
  }

  async function readResidualCounts(): Promise<{ trees: number; stems: number; staleStaged: number }> {
    const census = censusIDs.three;
    return {
      trees: await countOf(`SELECT COUNT(*) AS total FROM trees WHERE CensusID = ? AND TreeTag LIKE CONCAT(?, '%')`, [census, RESIDUAL_TREE_TAG_PREFIX]),
      stems: await countOf(`SELECT COUNT(*) AS total FROM stems WHERE CensusID = ? AND StemTag = ?`, [census, RESIDUAL_STEM_TAG]),
      staleStaged: await countOf(`SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ?`, [RECOVERY_STALE_FILE])
    };
  }

  /** Fresh census 3 (failed family, 42 failed metrics) plus the staged incoming family; returns pre-run mismatches. */
  async function reseedForRecovery(batchID: string): Promise<string[]> {
    await clearCensusThreeScope();
    await seedFailedCensusThreeFamily();
    await stageRecoveryIncomingFamily(batchID);
    const seeded = await readCensusThreeState(batchID, RECOVERY_NO_SESSION, RECOVERY_INCOMING_FILE);
    return describeMismatches({ ...expectedSeedState(profile), stagedReplacementRows: RECOVERY_INCOMING_ROWS }, seeded);
  }

  /** Never throws: an unexpected error is recorded in `error` so the caller can write the SUMMARY before any assertion runs. */
  async function runRecoveryIngestion(batchID: string, injection: FailureInjection | null): Promise<RecoveryIngestionResult> {
    const statementTimer = installStatementTimer(connectionManager, injection);
    const transactionTimer = installTransactionTimer(connectionManager);
    const diagnostics: SetupDiagnostic[] = [];
    const startedAt = performance.now();
    let ingestion: IngestBatchResult | null = null;
    let failure: unknown = null;
    try {
      ingestion = await ingestBatch(connectionManager, {
        schema,
        fileID: RECOVERY_INCOMING_FILE,
        batchID,
        expectedScope: { plotID, censusID: censusIDs.three },
        changedBy: REHEARSAL_CHANGED_BY,
        onSetupProgress: diagnostic => {
          diagnostics.push(diagnostic);
        }
      });
    } catch (error) {
      failure = error;
      if (!(error instanceof InjectedRehearsalFailureError)) console.error('[census-replacement-rehearsal] unexpected error in a recovery run', error);
    } finally {
      statementTimer.restore();
      transactionTimer.restore();
    }
    const outcome: RecoveryRunOutcome = failure === null ? 'recovered' : failure instanceof InjectedRehearsalFailureError ? 'recovery_interrupted' : 'failed';
    return {
      outcome,
      ingestion,
      endToEndMs: performance.now() - startedAt,
      injection,
      injectionFired: statementTimer.injectionFired(),
      error: outcome === 'failed' ? errorMessageOf(failure) : null,
      statements: statementTimer.statements,
      transactions: transactionTimer.records(statementTimer.statements),
      diagnostics
    };
  }

  function buildReplacementParams(batchID: string, sessionID: string): CensusReplacementParams {
    return {
      schema,
      fileName: REPLACEMENT_FILE,
      batchID,
      plotID,
      censusID: censusIDs.three,
      uploadMode: UploadMode.CLEAN_REUPLOAD,
      sourceFormat: SourceFormat.csv,
      rawRows: buildMeasurementChunk(WORKER_FIRST_CHUNK_ROWS, REPLACEMENT_TAG_PREFIX),
      csvHeaders: [...CSV_HEADERS],
      delimiter: CSV_DELIMITER,
      storedMapping: undefined,
      uploadSessionID: sessionID,
      firstRowOrdinal: FIRST_CHUNK_ROW_ORDINAL,
      changedBy: REHEARSAL_CHANGED_BY,
      suppressCensusReplacementCleanup: false,
      chunkIdentity: `${batchID}:chunk${FIRST_CHUNK_INDEX}`
    };
  }

  interface ReplacementAndFirstChunkResult {
    outcome: RunOutcome;
    replacement: CensusReplacementResult | null;
    endToEndMs: number;
    injection: FailureInjection | null;
    injectionFired: boolean;
    error: string | null;
    rollbackError: string | null;
    statements: TimedStatement[];
    transactions: TransactionRecord[];
  }

  function outcomeOf(failure: unknown, stagingBegan: boolean): RunOutcome {
    if (failure === null) return 'committed';
    if (!(failure instanceof InjectedRehearsalFailureError)) return 'failed';
    return stagingBegan ? 'staging_rolled_back' : 'replacement_interrupted';
  }

  /**
   * The worker's sequence for a job's first chunk (worker.ts): the census replacement in its own
   * transactions, then one staging transaction with begin / stage / commit and a rollback on error.
   * It always returns a result, including on an unexpected error (outcome 'failed', with the message in
   * `error`), so the caller records the timings and the rollback status before any assertion runs. That is
   * recorded, not swallowed: runFailedChecks fails the test on any non-null `error`.
   */
  async function runReplacementAndFirstChunk(batchID: string, sessionID: string, injection: FailureInjection | null): Promise<ReplacementAndFirstChunkResult> {
    resetUploadSessionReplacementMarkerCacheForTests();
    const params = buildReplacementParams(batchID, sessionID);
    const statementTimer = installStatementTimer(connectionManager, injection);
    const transactionTimer = installTransactionTimer(connectionManager);
    const startedAt = performance.now();
    let replacement: CensusReplacementResult | null = null;
    let stagingTransactionID: string | null = null;
    let stagingCommitted = false;
    let failure: unknown = null;
    let rollbackError: string | null = null;
    try {
      replacement = await replaceCensusForCleanReupload(connectionManager, params);
      stagingTransactionID = await connectionManager.beginTransaction();
      await stageMeasurementChunk(connectionManager, { ...params, transactionID: stagingTransactionID });
      await connectionManager.commitTransaction(stagingTransactionID);
      stagingCommitted = true;
    } catch (error) {
      failure = error;
      if (!(error instanceof InjectedRehearsalFailureError))
        console.error(`[census-replacement-rehearsal] unexpected error in the replacement-and-first-chunk run`, error);
      if (stagingTransactionID !== null && !stagingCommitted) {
        try {
          await connectionManager.rollbackTransaction(stagingTransactionID);
        } catch (caughtRollbackError) {
          // Mirrors the worker: a failed rollback is recorded and never masks the original error.
          rollbackError = errorMessageOf(caughtRollbackError);
        }
      }
    } finally {
      statementTimer.restore();
      transactionTimer.restore();
    }
    const endToEndMs = performance.now() - startedAt;
    const outcome = outcomeOf(failure, stagingTransactionID !== null);
    return {
      outcome,
      replacement,
      endToEndMs,
      injection,
      injectionFired: statementTimer.injectionFired(),
      error: outcome === 'failed' ? errorMessageOf(failure) : null,
      rollbackError,
      statements: statementTimer.statements,
      transactions: transactionTimer.records(statementTimer.statements)
    };
  }

  /** Records a run's timings in the summary immediately, before any verification query can fail. */
  function recordRun(key: RunKey, result: ReplacementAndFirstChunkResult): RunSummary {
    const phases = summarizePhases(result.statements);
    const transactionKindCounts = countKinds(result.transactions);
    const run: RunSummary = {
      outcome: result.outcome,
      endToEndMs: Math.round(result.endToEndMs),
      replacementOutcome: result.replacement?.outcome ?? null,
      measurementWindowCount: transactionKindCounts[TRANSACTION_KIND.MEASUREMENT_WINDOW],
      ...summarizeTransactionDurations(result.transactions),
      transactionKindCounts,
      rolledBackTransactions: result.transactions.filter(transaction => transaction.end === 'rolled_back').length,
      overBudgetTransactions: result.transactions
        .filter(transaction => transaction.durationMs > LOCAL_TRANSACTION_BUDGET_MS)
        .map(transaction => ({ kind: transaction.kind, end: transaction.end, durationMs: Math.round(transaction.durationMs) })),
      injection: result.injection,
      injectionFired: result.injectionFired,
      error: result.error,
      rollbackError: result.rollbackError,
      phases,
      slowestStatement: slowestStatement(result.statements),
      unmatchedPhases: REPLACEMENT_RUN_PHASES.filter(phase => phases[phase].statements === 0),
      verification: null,
      retryAfterRollback: null
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
    preRunMismatches: string[],
    statementPlanMismatches: string[] = []
  ): Promise<{ state: CensusThreeState; controls: ControlCensusFingerprint[] }> {
    const state = await readCensusThreeState(batchID, sessionID);
    const controls = await readControlFingerprints();
    run.verification = {
      preRunMismatches,
      statementPlanMismatches,
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

    runExpectations = buildRunExpectations(profile);
    recoveryShape = expectedRecoveryShape(failedRowTotal(profile), CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE);
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
    const seededState = await readCensusThreeState(generateShortBatchID(), SESSION_ID.REPLACEMENT_RUN);
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
    rehearsalSummary.failedChecks = rehearsalFailedChecks(rehearsalSummary, runExpectations, recoveryShape);
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

  const RANGE_PLAN_TYPE = 'range';
  const PRIMARY_KEY_NAME = 'PRIMARY';
  const RANGE_OPTIMIZATION_SKIPPED_WARNING_CODE = 3170;
  const COREMEASUREMENTS_PLAN_TABLES = ['coremeasurements', 'cm'];

  /**
   * EXPLAINs the exact DELETE and audit INSERT production issues for one full window of census-3 ids.
   * Catches a window that falls back to scanning coremeasurements under row locks (warning 3170 or a non-PRIMARY plan).
   */
  async function describeWindowStatementPlanMismatches(batchID: string): Promise<string[]> {
    const windowRows = await query(`SELECT CoreMeasurementID FROM coremeasurements WHERE CensusID = ? ORDER BY CoreMeasurementID LIMIT ?`, [
      censusIDs.three,
      CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE
    ]);
    const windowIDs = windowRows.map(row => Number(row.CoreMeasurementID));
    if (windowIDs.length !== CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE)
      return [`census 3 has ${windowIDs.length} rows, fewer than the ${CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE}-id window the plan check needs`];

    const statements = await captureCensusReplacementWindowStatements(
      { schema, incomingBatchID: batchID, plotID, censusID: censusIDs.three, afterCoreMeasurementID: 0, changedBy: REHEARSAL_CHANGED_BY },
      windowIDs
    );
    const mismatches: string[] = [];
    for (const [label, statement] of [
      ['window DELETE', statements.coreMeasurementDelete],
      ['window audit INSERT', statements.deleteAudit]
    ] as const) {
      const planRows = await query(`EXPLAIN ${statement.sql}`, statement.params);
      const warningCodes = (await query('SHOW WARNINGS')).map(warning => Number(warning.Code));
      console.log(
        `[census-replacement-rehearsal] EXPLAIN ${label}: ${planRows.map(row => `${row.table}:type=${row.type},key=${row.key}`).join('; ')} warningCodes=[${warningCodes.join(',')}]`
      );
      const coreMeasurementRows = planRows.filter(row => COREMEASUREMENTS_PLAN_TABLES.includes(String(row.table)));
      if (coreMeasurementRows.length === 0)
        mismatches.push(`${label}: no plan row reads coremeasurements (tables: ${planRows.map(row => row.table).join(', ')})`);
      for (const row of coreMeasurementRows) {
        if (String(row.type) !== RANGE_PLAN_TYPE || String(row.key) !== PRIMARY_KEY_NAME)
          mismatches.push(`${label}: expected type=${RANGE_PLAN_TYPE} key=${PRIMARY_KEY_NAME}, got type=${row.type} key=${row.key}`);
      }
      if (warningCodes.includes(RANGE_OPTIMIZATION_SKIPPED_WARNING_CODE))
        mismatches.push(`${label}: range optimization skipped (warning ${RANGE_OPTIMIZATION_SKIPPED_WARNING_CODE})`);
    }
    return mismatches;
  }

  interface InterruptionPrefix {
    deletedRows: number;
    lastDeletedID: number;
    deletedErrorLinks: Record<keyof typeof ERROR_CODE, number>;
  }

  /** The first `deletedRows` census-3 ids in id order and their error links: exactly what the interrupted replacement must have deleted. */
  async function readInterruptionPrefix(deletedRows: number): Promise<InterruptionPrefix> {
    const prefixIDs = await query(`SELECT CoreMeasurementID FROM coremeasurements WHERE CensusID = ? ORDER BY CoreMeasurementID LIMIT ?`, [
      censusIDs.three,
      deletedRows
    ]);
    const linkRows = await query(
      `SELECT me.ErrorCode AS errorCode, COUNT(*) AS linkCount
       FROM (SELECT CoreMeasurementID FROM coremeasurements WHERE CensusID = ? ORDER BY CoreMeasurementID LIMIT ?) prefix
       JOIN measurement_error_log mel ON mel.MeasurementID = prefix.CoreMeasurementID
       JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
       GROUP BY me.ErrorCode`,
      [censusIDs.three, deletedRows]
    );
    const linkCount = (code: string) => Number(linkRows.find(row => String(row.errorCode) === code)?.linkCount ?? 0);
    return {
      deletedRows,
      lastDeletedID: Number(prefixIDs[prefixIDs.length - 1].CoreMeasurementID),
      deletedErrorLinks: {
        MISSING_FIELD_SPECIESCODE: linkCount(ERROR_CODE.MISSING_FIELD_SPECIESCODE),
        SQL_EXCEPTION: linkCount(ERROR_CODE.SQL_EXCEPTION)
      }
    };
  }

  function expectedInterruptedState(prefix: InterruptionPrefix): CensusThreeState {
    const seed = expectedSeedState(profile);
    return {
      ...seed,
      failedFamilyRows: seed.failedFamilyRows - prefix.deletedRows,
      failedFamilyErrorLinks: {
        MISSING_FIELD_SPECIESCODE: seed.failedFamilyErrorLinks.MISSING_FIELD_SPECIESCODE - prefix.deletedErrorLinks.MISSING_FIELD_SPECIESCODE,
        SQL_EXCEPTION: seed.failedFamilyErrorLinks.SQL_EXCEPTION - prefix.deletedErrorLinks.SQL_EXCEPTION
      },
      censusThreeMeasurementRows: seed.censusThreeMeasurementRows - prefix.deletedRows,
      deleteAuditRows: prefix.deletedRows,
      distinctDeleteAuditRecords: prefix.deletedRows
    };
  }

  /** The deleted rows must be the first ones by id, not merely as many: nothing at or below the cursor survives, and each is audited. */
  async function describePrefixMismatches(prefix: InterruptionPrefix): Promise<string[]> {
    const survivorsInPrefix = await countOf(`SELECT COUNT(*) AS total FROM coremeasurements WHERE CensusID = ? AND CoreMeasurementID <= ?`, [
      censusIDs.three,
      prefix.lastDeletedID
    ]);
    const auditedInPrefix = await countOf(
      `SELECT COUNT(DISTINCT RecordID) AS total FROM unifiedchangelog WHERE TableName = ? AND Operation = ? AND CensusID = ? AND RecordID <= ?`,
      [CHANGELOG_TABLE_COREMEASUREMENTS, CHANGELOG_OPERATION.DELETE, censusIDs.three, prefix.lastDeletedID]
    );
    const mismatches: string[] = [];
    if (survivorsInPrefix !== 0) mismatches.push(`${survivorsInPrefix} rows at or below id ${prefix.lastDeletedID} survived the interrupted replacement`);
    if (auditedInPrefix !== prefix.deletedRows)
      mismatches.push(`${auditedInPrefix} audited ids at or below ${prefix.lastDeletedID}, expected ${prefix.deletedRows}`);
    return mismatches;
  }

  async function reseedCensusThree(batchID: string, sessionID: string): Promise<string[]> {
    await clearCensusThreeScope();
    await seedFailedCensusThreeFamily();
    const reseededState = await readCensusThreeState(batchID, sessionID);
    const preRunMismatches = describeMismatches(expectedSeedState(profile), reseededState);
    await seedUploadSession(sessionID);
    return preRunMismatches;
  }

  async function verifyRecoveredRun(batchID: string, preRunMismatches: string[], extraStateMismatches: string[]): Promise<RecoveryRunVerification> {
    const state = await readCensusThreeState(batchID, RECOVERY_NO_SESSION, RECOVERY_INCOMING_FILE);
    const verification = {
      preRunMismatches,
      stateMismatches: [...describeMismatches(expectedRecoveredState(profile), state), ...extraStateMismatches],
      controlCensusMismatches: describeMismatches(controlBaseline, await readControlFingerprints())
    };
    console.log(`[census-replacement-rehearsal] recovery verification ${JSON.stringify(verification)} state=${JSON.stringify(state)}`);
    return verification;
  }

  it('(0) recovery shapes derive from the profile exactly as the #562 spec tabulates them (catches: a drifted derivation)', () => {
    const derived = expectedRecoveryShape(failedRowTotal(profile), CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE);
    console.log(`[census-replacement-rehearsal] recovery shape ${profile.name}: ${JSON.stringify(derived)}`);
    expect(derived).toEqual(SPEC_RECOVERY_SHAPES[profile.name]);
  });

  it(
    '(1) replacement run: every transaction commits within budget with exact counts (catches: a replacement transaction that grows with the census)',
    async () => {
      const batchID = generateShortBatchID();
      await seedUploadSession(SESSION_ID.REPLACEMENT_RUN);
      const statementPlanMismatches = await describeWindowStatementPlanMismatches(batchID);
      const expectation = runExpectations.replacementRun;

      const result = await runReplacementAndFirstChunk(batchID, SESSION_ID.REPLACEMENT_RUN, expectation.injection);
      const run = recordRun('replacementRun', result);
      const { state, controls } = await verifyRun(
        'replacementRun',
        run,
        expectedReplacedState(profile),
        batchID,
        SESSION_ID.REPLACEMENT_RUN,
        [],
        statementPlanMismatches
      );

      expect(runFailedChecks('replacementRun', run, expectation), 'every replacement-run check (the same list feeds SUMMARY.passed)').toEqual([]);
      expect(state).toEqual(expectedReplacedState(profile));
      expect(controls).toEqual(controlBaseline);
    },
    RUN_TIMEOUT_MS
  );

  it(
    '(2) interrupted run: a failure at the middle window leaves exactly the committed windows deleted and audited, the marker unset (catches: a replacement that rolls back or over-deletes)',
    async () => {
      const expectation = runExpectations.interruptedRun;
      const preRunMismatches = await reseedCensusThree(interruptedRunBatchID, SESSION_ID.INTERRUPTED_RUN);
      const interruptedWindow = expectation.injection!.occurrence;
      const prefix = await readInterruptionPrefix(rowsDeletedBeforeWindow(interruptedWindow));
      console.log(`[census-replacement-rehearsal] interruptedRun expects prefix ${JSON.stringify(prefix)} (window ${interruptedWindow} fails)`);

      const result = await runReplacementAndFirstChunk(interruptedRunBatchID, SESSION_ID.INTERRUPTED_RUN, expectation.injection);
      const run = recordRun('interruptedRun', result);
      const { state, controls } = await verifyRun(
        'interruptedRun',
        run,
        expectedInterruptedState(prefix),
        interruptedRunBatchID,
        SESSION_ID.INTERRUPTED_RUN,
        preRunMismatches
      );
      run.verification!.countMismatches.push(...(await describePrefixMismatches(prefix)));

      expect(runFailedChecks('interruptedRun', run, expectation), 'every interrupted-run check (the same list feeds SUMMARY.passed)').toEqual([]);
      expect(state).toEqual(expectedInterruptedState(prefix));
      expect(controls).toEqual(controlBaseline);
    },
    RUN_TIMEOUT_MS
  );

  it(
    '(3) resumed run: the retry finishes the replacement within budget with no double audit (catches: a retry that starts over or skips the left-over rows)',
    async () => {
      const expectation = runExpectations.resumedRun;

      const result = await runReplacementAndFirstChunk(interruptedRunBatchID, SESSION_ID.INTERRUPTED_RUN, expectation.injection);
      const run = recordRun('resumedRun', result);
      const { state, controls } = await verifyRun('resumedRun', run, expectedReplacedState(profile), interruptedRunBatchID, SESSION_ID.INTERRUPTED_RUN, []);

      expect(runFailedChecks('resumedRun', run, expectation), 'every resumed-run check (the same list feeds SUMMARY.passed)').toEqual([]);
      expect(state, 'DELETE-audit rows equal the failed-row total and are all distinct').toEqual(expectedReplacedState(profile));
      expect(controls).toEqual(controlBaseline);
    },
    RUN_TIMEOUT_MS
  );

  it(
    '(4) staging rollback run: the replacement survives a staging failure and the retry runs no replacement transaction (catches: replacement and staging sharing one transaction)',
    async () => {
      const expectation = runExpectations.stagingRollbackRun;
      const preRunMismatches = await reseedCensusThree(stagingRollbackRunBatchID, SESSION_ID.STAGING_ROLLBACK_RUN);
      const replacedAndUnstaged: CensusThreeState = { ...expectedReplacedState(profile), stagedReplacementRows: 0 };

      const result = await runReplacementAndFirstChunk(stagingRollbackRunBatchID, SESSION_ID.STAGING_ROLLBACK_RUN, expectation.injection);
      const run = recordRun('stagingRollbackRun', result);
      const { state, controls } = await verifyRun(
        'stagingRollbackRun',
        run,
        replacedAndUnstaged,
        stagingRollbackRunBatchID,
        SESSION_ID.STAGING_ROLLBACK_RUN,
        preRunMismatches
      );

      const retryResult = await runReplacementAndFirstChunk(stagingRollbackRunBatchID, SESSION_ID.STAGING_ROLLBACK_RUN, null);
      const retryState = await readCensusThreeState(stagingRollbackRunBatchID, SESSION_ID.STAGING_ROLLBACK_RUN);
      const retryTransactionKindCounts = countKinds(retryResult.transactions);
      run.retryAfterRollback = {
        outcome: retryResult.outcome,
        replacementOutcome: retryResult.replacement?.outcome ?? null,
        transactionKindCounts: retryTransactionKindCounts,
        error: retryResult.error,
        stateMismatches: describeMismatches(expectedReplacedState(profile), retryState)
      };
      console.log(`[census-replacement-rehearsal] stagingRollbackRun retry ${JSON.stringify(run.retryAfterRollback)} state=${JSON.stringify(retryState)}`);

      expect(runFailedChecks('stagingRollbackRun', run, expectation), 'every staging-rollback-run check (the same list feeds SUMMARY.passed)').toEqual([]);
      expect(state).toEqual(replacedAndUnstaged);
      expect(controls).toEqual(controlBaseline);
      expect(retryState).toEqual(expectedReplacedState(profile));
    },
    RUN_TIMEOUT_MS
  );

  it(
    '(5) recovery run: the failed-first-census recovery commits bounded windows outside setup within budget, flat per window, with exact state (catches: recovery inside setup; a window cost that grows with the census)',
    async () => {
      const batchID = generateShortBatchID();
      const preRunMismatches = await reseedForRecovery(batchID);
      const result = await runRecoveryIngestion(batchID, null);
      const run = recordRecoveryRun('recoveryRun', result, null);
      run.verification = await verifyRecoveredRun(batchID, preRunMismatches, []);
      expect(recoveryRunFailedChecks('recoveryRun', run, recoveryShape), 'every recovery-run check (the same list feeds SUMMARY.passed)').toEqual([]);
    },
    RUN_TIMEOUT_MS
  );

  it(
    '(6) interrupted recovery run: a failure at the middle window leaves exactly the committed windows deleted and audited and setup unstarted; the retry finishes within budget with no double audit (catches: a recovery that rolls back or over-deletes; a resume that starts over)',
    async () => {
      const batchID = generateShortBatchID();
      const preRunMismatches = await reseedForRecovery(batchID);
      const prefix = await readInterruptionPrefix(recoveryShape.rowsGoneWhenInterrupted);
      const injection: FailureInjection = { phase: STATEMENT_PHASE.COREMEASUREMENT_DELETE, occurrence: recoveryShape.interruptedWindow };
      console.log(
        `[census-replacement-rehearsal] interruptedRecoveryRun expects prefix ${JSON.stringify(prefix)} (window ${recoveryShape.interruptedWindow} fails)`
      );

      const result = await runRecoveryIngestion(batchID, injection);
      const run = recordRecoveryRun('interruptedRecoveryRun', result, null);
      const interruptedState = await readCensusThreeState(batchID, RECOVERY_NO_SESSION, RECOVERY_INCOMING_FILE);
      run.verification = {
        preRunMismatches,
        stateMismatches: [
          ...describeMismatches({ ...expectedInterruptedState(prefix), stagedReplacementRows: RECOVERY_INCOMING_ROWS }, interruptedState),
          ...(await describePrefixMismatches(prefix))
        ],
        controlCensusMismatches: describeMismatches(controlBaseline, await readControlFingerprints())
      };

      const retryResult = await runRecoveryIngestion(batchID, null);
      run.retry = summarizeRecoveryRun(retryResult, null);
      run.retry.verification = await verifyRecoveredRun(batchID, [], []);
      console.log(`[census-replacement-rehearsal] interruptedRecoveryRun retry ${JSON.stringify(run.retry)}`);

      expect(
        recoveryRunFailedChecks('interruptedRecoveryRun', run, recoveryShape),
        'every interrupted-recovery check (the same list feeds SUMMARY.passed)'
      ).toEqual([]);
    },
    RUN_TIMEOUT_MS
  );

  it(
    '(7) residual recovery run: legacy residual trees, stems and stale staged rows of the supported size go in a final transaction within budget (catches: a census-sized final transaction past the Goal 3 limit)',
    async () => {
      const batchID = generateShortBatchID();
      const preRunMismatches = await reseedForRecovery(batchID);
      await seedResidualCensusThree();
      const residualRows = 2 * profile.residualTreeRows + profile.residualStagedRows;
      const result = await runRecoveryIngestion(batchID, null);
      const run = recordRecoveryRun('residualRecoveryRun', result, residualRows);
      const residualMismatches = describeMismatches({ trees: 0, stems: 0, staleStaged: 0 }, await readResidualCounts());
      run.verification = await verifyRecoveredRun(batchID, preRunMismatches, residualMismatches);
      console.log(`[census-replacement-rehearsal] residualRecoveryRun finalTransactionMs=${run.finalTransactionMs} perResidualRowMs=${run.residualRowCostMs}`);
      expect(recoveryRunFailedChecks('residualRecoveryRun', run, recoveryShape), 'every residual-recovery check (the same list feeds SUMMARY.passed)').toEqual(
        []
      );
    },
    RUN_TIMEOUT_MS
  );
});
