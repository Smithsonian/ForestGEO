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
 *   8 arcgisCommitRun     (#561) fresh seed plus an ArcGIS import session of the profile's replacement row count; commitArcgisImport
 *                         CLEAN; every transaction within budget, exact kind counts, census replaced, import `committed`
 *   9 arcgisInterruptedRun fresh seed; failure injected at the finalize transaction's file_upload changelog INSERT; census replaced and
 *                         audited, all rows staged, import still `committing`
 *  10 arcgisResumedRun    retry of run 9 under a new upload session; clears the staged rows window by window, restages, deletes nothing
 *                         more, finalizes; every transaction within budget, no double audit
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
 * Pass rule: every count, fingerprint and kind-count check holds in every run, every transaction of the budgeted runs
 * (1, 3, 8 and 10) finishes begin-to-end within LOCAL_TRANSACTION_BUDGET_MS, and the SUMMARY line reads "passed":true. Any failure
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
import { buildSubBatchPattern, LIKE_ESCAPE_CLAUSE, SUB_BATCH_ORDINAL_WIDTH, SUB_BATCH_SEPARATOR } from '@/lib/uploads/batch-family';
import { generateShortBatchID } from '@/config/utils';
import { SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { ARCGIS_STAGING_WINDOW_ROWS, commitArcgisImport, type CommitArcgisImportResult } from '@/lib/uploads/arcgis-commit';
import { ARCGIS_IMPORT_SESSION_STATE, ensureArcgisImportTables } from '@/lib/arcgis/import-session';
import { ARCGIS_COMMIT_STATEMENT } from '../setup/arcgis-commit-statement-patterns';
import { seedArcgisImport, type ArcgisImportScope, type SeededArcgisImport } from '../setup/arcgis-commit-fixtures';

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

const ARCGIS_IMPORT_FILE = 'mpala_census3_arcgis.xlsx';
const ARCGIS_IMPORT_TAG_PREFIX = 'A3T';
const ARCGIS_SESSION_ID = {
  COMMIT_RUN: 'rehearsal-arcgis-commit-session',
  INTERRUPTED_RUN: 'rehearsal-arcgis-interrupted-session',
  RESUMED_RUN: 'rehearsal-arcgis-resumed-session'
} as const;
const UPLOAD_SESSION_STATE_FAILED = 'failed';
const FIRST_STATEMENT_OCCURRENCE = 1;

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
  ARCGIS_CLAIM_UPDATE: 'arcgisClaimUpdate',
  STAGED_CLEAR_DELETE: 'stagedClearDelete',
  FAMILY_ID_SELECT: 'familyIdSelect',
  CURSOR_CAS: 'cursorCas',
  IMPORT_MARKER_UPDATE: 'importMarkerUpdate',
  FINALIZE_UPDATE: 'finalizeUpdate',
  FILE_UPLOAD_CHANGELOG_INSERT: 'fileUploadChangelogInsert',
  OTHER: 'other'
} as const;
type StatementPhase = (typeof STATEMENT_PHASE)[keyof typeof STATEMENT_PHASE];

/** Statements only an ArcGIS commit (#561) issues; the CSV runs never match them. */
const ARCGIS_STATEMENT_PHASES: readonly StatementPhase[] = [
  STATEMENT_PHASE.ARCGIS_CLAIM_UPDATE,
  STATEMENT_PHASE.STAGED_CLEAR_DELETE,
  STATEMENT_PHASE.FAMILY_ID_SELECT,
  STATEMENT_PHASE.CURSOR_CAS,
  STATEMENT_PHASE.IMPORT_MARKER_UPDATE,
  STATEMENT_PHASE.FINALIZE_UPDATE
];

/** Every CSV-path phase must match at least one statement in a run that finishes the replacement and commits its staging. */
const NAMED_STATEMENT_PHASES: readonly StatementPhase[] = Object.values(STATEMENT_PHASE).filter(
  phase => phase !== STATEMENT_PHASE.OTHER && phase !== STATEMENT_PHASE.FILE_UPLOAD_CHANGELOG_INSERT && !ARCGIS_STATEMENT_PHASES.includes(phase)
);

/** An ArcGIS commit that deletes a prior census: the CSV replacement phases, minus the upload-session marker (the import row carries it), plus its own. */
const ARCGIS_COMMIT_REQUIRED_PHASES: readonly StatementPhase[] = [
  ...NAMED_STATEMENT_PHASES.filter(phase => phase !== STATEMENT_PHASE.MARKER_UPDATE),
  ...ARCGIS_STATEMENT_PHASES,
  STATEMENT_PHASE.FILE_UPLOAD_CHANGELOG_INSERT
];

/** A retry after the census was already emptied: the windows run but find nothing to delete, so no delete, audit or error-link statement. */
const ARCGIS_RESUME_REQUIRED_PHASES: readonly StatementPhase[] = ARCGIS_COMMIT_REQUIRED_PHASES.filter(
  phase =>
    phase !== STATEMENT_PHASE.ERROR_LINK_DELETE && phase !== STATEMENT_PHASE.COREMEASUREMENT_DELETE_AUDIT && phase !== STATEMENT_PHASE.COREMEASUREMENT_DELETE
);

/** The window's cursor SELECT, with or without the optimizer hint production puts in front of the select list. */
const COREMEASUREMENT_SELECT_FOR_UPDATE_PATTERN =
  /^\s*SELECT\s+(\/\*\+[^*]*\*\/\s+)?(DISTINCT\s+)?\S*CoreMeasurementID\s+FROM\s+\S+\.coremeasurements[\s\S]*FOR UPDATE\s*$/i;
const STAGING_INSERT_PATTERN = /^\s*INSERT IGNORE INTO\s+\S+\.temporarymeasurements\b/i;

/** The ArcGIS statements go before the CSV ones: the family-id select would otherwise be taken for a window cursor SELECT. */
const STATEMENT_PHASE_PATTERNS: ReadonlyArray<{ phase: StatementPhase; pattern: RegExp }> = [
  { phase: STATEMENT_PHASE.ARCGIS_CLAIM_UPDATE, pattern: ARCGIS_COMMIT_STATEMENT.CLAIM_UPDATE },
  { phase: STATEMENT_PHASE.STAGED_CLEAR_DELETE, pattern: ARCGIS_COMMIT_STATEMENT.STAGED_CLEAR_DELETE },
  { phase: STATEMENT_PHASE.FAMILY_ID_SELECT, pattern: ARCGIS_COMMIT_STATEMENT.FAMILY_ID_SELECT },
  { phase: STATEMENT_PHASE.CURSOR_CAS, pattern: ARCGIS_COMMIT_STATEMENT.CURSOR_CAS },
  { phase: STATEMENT_PHASE.IMPORT_MARKER_UPDATE, pattern: ARCGIS_COMMIT_STATEMENT.IMPORT_MARKER_UPDATE },
  { phase: STATEMENT_PHASE.FINALIZE_UPDATE, pattern: ARCGIS_COMMIT_STATEMENT.FINALIZE_UPDATE },
  { phase: STATEMENT_PHASE.SESSION_LOCK, pattern: CENSUS_REPLACEMENT_STATEMENT.SESSION_LOCK },
  { phase: STATEMENT_PHASE.ERROR_LINK_DELETE, pattern: CENSUS_REPLACEMENT_STATEMENT.ERROR_LINK_DELETE },
  { phase: STATEMENT_PHASE.COREMEASUREMENT_SELECT_FOR_UPDATE, pattern: COREMEASUREMENT_SELECT_FOR_UPDATE_PATTERN },
  { phase: STATEMENT_PHASE.COREMEASUREMENT_DELETE_AUDIT, pattern: CENSUS_REPLACEMENT_STATEMENT.DELETE_AUDIT },
  { phase: STATEMENT_PHASE.COREMEASUREMENT_DELETE, pattern: CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_DELETE },
  { phase: STATEMENT_PHASE.LEGACY_DELETE, pattern: CENSUS_REPLACEMENT_STATEMENT.LEGACY_DELETE },
  { phase: STATEMENT_PHASE.UPLOADMETRICS_DELETE, pattern: CENSUS_REPLACEMENT_STATEMENT.METRICS_DELETE },
  { phase: STATEMENT_PHASE.MARKER_UPDATE, pattern: CENSUS_REPLACEMENT_STATEMENT.MARKER_UPDATE },
  { phase: STATEMENT_PHASE.STAGING_INSERT, pattern: STAGING_INSERT_PATTERN },
  { phase: STATEMENT_PHASE.FILE_UPLOAD_CHANGELOG_INSERT, pattern: ARCGIS_COMMIT_STATEMENT.FILE_UPLOAD_CHANGELOG_INSERT }
];

function classifyStatement(sql: string): StatementPhase {
  return STATEMENT_PHASE_PATTERNS.find(candidate => candidate.pattern.test(sql))?.phase ?? STATEMENT_PHASE.OTHER;
}

interface TimedStatement {
  phase: StatementPhase;
  /** Null for statements run outside any transaction (the preliminary probes). */
  transactionID: string | null;
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
        statements.push({ phase, transactionID, durationMs: 0, preview: previewOf(query) });
        throw new InjectedRehearsalFailureError(injection);
      }
    }
    const startedAt = performance.now();
    try {
      return await originalExecuteQuery.call(connectionManager, query, params, transactionId);
    } finally {
      statements.push({ phase, transactionID, durationMs: performance.now() - startedAt, preview: previewOf(query) });
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
  ARCGIS_CLAIM: 'arcgis_claim',
  CLEAR_STAGED_WINDOW: 'clear_staged_window',
  CLEAR_FAMILY_WINDOW: 'clear_family_window',
  STAGING_WINDOW: 'staging_window',
  ARCGIS_FINALIZE: 'arcgis_finalize',
  UNCLASSIFIED: 'unclassified'
} as const;
type TransactionKind = (typeof TRANSACTION_KIND)[keyof typeof TRANSACTION_KIND];

/**
 * What the transaction's statements say it was; the first match wins. The ArcGIS units come first because an ArcGIS staging window also
 * inserts into temporarymeasurements and a clear-family window also selects coremeasurements ids. The finalize transaction is also
 * recognised by its file_upload changelog INSERT, last, so a finalize that fails before its closing UPDATE is still a finalize.
 */
const TRANSACTION_KIND_BY_PHASE: ReadonlyArray<{ phase: StatementPhase; kind: TransactionKind }> = [
  { phase: STATEMENT_PHASE.ARCGIS_CLAIM_UPDATE, kind: TRANSACTION_KIND.ARCGIS_CLAIM },
  { phase: STATEMENT_PHASE.FINALIZE_UPDATE, kind: TRANSACTION_KIND.ARCGIS_FINALIZE },
  { phase: STATEMENT_PHASE.STAGED_CLEAR_DELETE, kind: TRANSACTION_KIND.CLEAR_STAGED_WINDOW },
  { phase: STATEMENT_PHASE.FAMILY_ID_SELECT, kind: TRANSACTION_KIND.CLEAR_FAMILY_WINDOW },
  { phase: STATEMENT_PHASE.CURSOR_CAS, kind: TRANSACTION_KIND.STAGING_WINDOW },
  { phase: STATEMENT_PHASE.STAGING_INSERT, kind: TRANSACTION_KIND.STAGING },
  { phase: STATEMENT_PHASE.COREMEASUREMENT_SELECT_FOR_UPDATE, kind: TRANSACTION_KIND.MEASUREMENT_WINDOW },
  { phase: STATEMENT_PHASE.LEGACY_DELETE, kind: TRANSACTION_KIND.LEGACY_PASS },
  { phase: STATEMENT_PHASE.UPLOADMETRICS_DELETE, kind: TRANSACTION_KIND.METRICS_WINDOW },
  { phase: STATEMENT_PHASE.MARKER_UPDATE, kind: TRANSACTION_KIND.COMPLETION },
  { phase: STATEMENT_PHASE.IMPORT_MARKER_UPDATE, kind: TRANSACTION_KIND.COMPLETION },
  { phase: STATEMENT_PHASE.FILE_UPLOAD_CHANGELOG_INSERT, kind: TRANSACTION_KIND.ARCGIS_FINALIZE }
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
  const finished: Array<{ transactionID: string; end: TransactionEnd; durationMs: number }> = [];

  const finish = (transactionID: string, end: TransactionEnd) => {
    const beganAt = beganAtByTransaction.get(transactionID);
    if (beganAt === undefined) return;
    finished.push({ transactionID, end, durationMs: performance.now() - beganAt });
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

interface KindDurationSummary {
  transactionCount: number;
  p50: number;
  p95: number;
  max: number;
}

function summarizeTransactionDurationsByKind(transactions: TransactionRecord[]): Partial<Record<TransactionKind, KindDurationSummary>> {
  const summaries: Partial<Record<TransactionKind, KindDurationSummary>> = {};
  for (const kind of Object.values(TRANSACTION_KIND)) {
    const ofKind = transactions.filter(transaction => transaction.kind === kind);
    if (ofKind.length === 0) continue;
    const { transactionCount, transactionMs } = summarizeTransactionDurations(ofKind);
    summaries[kind] = { transactionCount, ...transactionMs };
  }
  return summaries;
}

/** The slowest finalize transaction (there is one per attempt), or null when the run had none. */
function finalizeTransactionDurationMs(transactions: TransactionRecord[]): number | null {
  const durations = transactions.filter(transaction => transaction.kind === TRANSACTION_KIND.ARCGIS_FINALIZE).map(transaction => transaction.durationMs);
  return durations.length === 0 ? null : Math.round(Math.max(...durations));
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

/** ArcGIS staging (#561): one transaction per window of `windowSize` import rows. */
function expectedArcgisStagingWindowCount(importRows: number, windowSize: number): number {
  return Math.ceil(importRows / windowSize);
}

/**
 * A retry's clear-staged loop stops on the first window that deletes fewer than `windowSize` rows, so it runs one window more than the
 * full ones: the short remainder, or an empty window when the staged rows divide evenly.
 */
function expectedArcgisRetryClearStagedWindowCount(stagedRows: number, windowSize: number): number {
  return Math.floor(stagedRows / windowSize) + SINGLE_TRANSACTION;
}

/** Unit A against a census with nothing left: the one window that finds no row after the cursor. */
const EMPTY_CENSUS_MEASUREMENT_WINDOW_COUNT = 1;

/** The middle deleting window (1-based): the one whose DELETE run 2 fails. */
function interruptedWindowIndex(rows: number, windowSize: number): number {
  return Math.max(FIRST_WINDOW_ORDINAL, Math.ceil(Math.ceil(rows / windowSize) / 2));
}

/** Rows the replacement has deleted when `windowIndex` (1-based) begins: every earlier window was full. */
function rowsDeletedBeforeWindow(windowIndex: number): number {
  return (windowIndex - FIRST_WINDOW_ORDINAL) * CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE;
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

/** Census 3 as an ArcGIS commit leaves it: the import session's marker and state replace the upload session's marker, and the staged rows are the import's. */
interface ArcgisRunState extends CensusThreeState {
  importSessionState: string;
  importCommittedRowCount: number;
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

type RunOutcome = 'committed' | 'replacement_interrupted' | 'staging_rolled_back' | 'finalize_interrupted' | 'failed';
type ArcgisRunKey = 'arcgisCommitRun' | 'arcgisInterruptedRun' | 'arcgisResumedRun';
const ARCGIS_RUN_KEYS: readonly ArcgisRunKey[] = ['arcgisCommitRun', 'arcgisInterruptedRun', 'arcgisResumedRun'];
type RunKey = 'replacementRun' | 'interruptedRun' | 'resumedRun' | 'stagingRollbackRun' | ArcgisRunKey;
const RUN_KEYS: readonly RunKey[] = ['replacementRun', 'interruptedRun', 'resumedRun', 'stagingRollbackRun', ...ARCGIS_RUN_KEYS];

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

/** What only an ArcGIS run knows: the import it committed and what seeding that import cost (reported, not gated). */
interface ArcgisRunDetails {
  importRowCount: number;
  importSessionSeedMs: number;
  derivedBatchID: string;
}

interface RunSummary extends TransactionDurationSummary {
  outcome: RunOutcome;
  perKindTransactionMs: Partial<Record<TransactionKind, KindDurationSummary>>;
  /** Duration of the ArcGIS finalize transaction, which holds the two aggregate counts that grow with the import (spec F10). */
  finalizeTransactionMs: number | null;
  arcgis: ArcgisRunDetails | null;
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
    },
    ...buildArcgisRunExpectations(profile)
  };
}

/** Rows in the ArcGIS import: the profile's replacement row count (412,427 at the full profile), equal to the prior census-3 rows it replaces. */
function arcgisImportRowCount(profile: RehearsalProfile): number {
  return failedRowTotal(profile);
}

/** The transactions of an ArcGIS commit that claims fresh and replaces `priorRows` census rows; run 9 issues the same ones before its finalize fails. */
function arcgisFreshCommitKindCounts(importRows: number, priorRows: number): Record<TransactionKind, number> {
  return kindCounts({
    [TRANSACTION_KIND.ARCGIS_CLAIM]: SINGLE_TRANSACTION,
    [TRANSACTION_KIND.CLEAR_STAGED_WINDOW]: SINGLE_TRANSACTION,
    [TRANSACTION_KIND.CLEAR_FAMILY_WINDOW]: SINGLE_TRANSACTION,
    [TRANSACTION_KIND.STAGING_WINDOW]: expectedArcgisStagingWindowCount(importRows, ARCGIS_STAGING_WINDOW_ROWS),
    [TRANSACTION_KIND.MEASUREMENT_WINDOW]: expectedMeasurementWindowCount(priorRows, CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE),
    [TRANSACTION_KIND.LEGACY_PASS]: SINGLE_TRANSACTION,
    [TRANSACTION_KIND.METRICS_WINDOW]: SINGLE_TRANSACTION,
    [TRANSACTION_KIND.COMPLETION]: SINGLE_TRANSACTION,
    [TRANSACTION_KIND.ARCGIS_FINALIZE]: SINGLE_TRANSACTION
  });
}

/** The retry of run 9: every staged row is cleared window by window and restaged, and the replacement finds the census already empty. */
function arcgisResumedKindCounts(importRows: number): Record<TransactionKind, number> {
  return kindCounts({
    [TRANSACTION_KIND.ARCGIS_CLAIM]: SINGLE_TRANSACTION,
    [TRANSACTION_KIND.CLEAR_STAGED_WINDOW]: expectedArcgisRetryClearStagedWindowCount(importRows, ARCGIS_STAGING_WINDOW_ROWS),
    [TRANSACTION_KIND.CLEAR_FAMILY_WINDOW]: SINGLE_TRANSACTION,
    [TRANSACTION_KIND.STAGING_WINDOW]: expectedArcgisStagingWindowCount(importRows, ARCGIS_STAGING_WINDOW_ROWS),
    [TRANSACTION_KIND.MEASUREMENT_WINDOW]: EMPTY_CENSUS_MEASUREMENT_WINDOW_COUNT,
    [TRANSACTION_KIND.LEGACY_PASS]: SINGLE_TRANSACTION,
    [TRANSACTION_KIND.METRICS_WINDOW]: SINGLE_TRANSACTION,
    [TRANSACTION_KIND.COMPLETION]: SINGLE_TRANSACTION,
    [TRANSACTION_KIND.ARCGIS_FINALIZE]: SINGLE_TRANSACTION
  });
}

/** Runs 8-10 (#561). The replacement is the ArcGIS owner's, so no run reports a CensusReplacementResult outcome. */
function buildArcgisRunExpectations(profile: RehearsalProfile): Record<ArcgisRunKey, RunExpectation> {
  const importRows = arcgisImportRowCount(profile);
  const priorRows = failedRowTotal(profile);
  return {
    arcgisCommitRun: {
      outcome: 'committed',
      replacementOutcome: null,
      injection: null,
      budgeted: true,
      transactionKindCounts: arcgisFreshCommitKindCounts(importRows, priorRows),
      rolledBackTransactions: 0,
      expectsRetryAfterRollback: false
    },
    arcgisInterruptedRun: {
      outcome: 'finalize_interrupted',
      replacementOutcome: null,
      injection: { phase: STATEMENT_PHASE.FILE_UPLOAD_CHANGELOG_INSERT, occurrence: FIRST_STATEMENT_OCCURRENCE },
      budgeted: false,
      transactionKindCounts: arcgisFreshCommitKindCounts(importRows, priorRows),
      rolledBackTransactions: SINGLE_TRANSACTION,
      expectsRetryAfterRollback: false
    },
    arcgisResumedRun: {
      outcome: 'committed',
      replacementOutcome: null,
      injection: null,
      budgeted: true,
      transactionKindCounts: arcgisResumedKindCounts(importRows),
      rolledBackTransactions: 0,
      expectsRetryAfterRollback: false
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

function rehearsalFailedChecks(summary: RehearsalSummary, expectations: Record<RunKey, RunExpectation>): string[] {
  const failed: string[] = [];
  if (summary.seed === null) failed.push('seed: did not complete');
  else if (summary.seed.mismatches.length > 0) failed.push(`seed: ${summary.seed.mismatches.join('; ')}`);
  for (const key of RUN_KEYS) failed.push(...runFailedChecks(key, summary.runs[key], expectations[key]));
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
  const interruptedRunBatchID = generateShortBatchID();
  const stagingRollbackRunBatchID = generateShortBatchID();
  /** Run 9's import, which run 10 retries. */
  let arcgisInterruptedImport: ArcgisSeededImport | null = null;

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

  function buildReplacementParams(batchID: string, sessionID: string): CensusReplacementParams {
    return {
      schema,
      fileName: REPLACEMENT_FILE,
      batchID,
      plotID,
      censusID: censusIDs.three,
      uploadMode: UploadMode.CLEAN_REUPLOAD,
      sourceFormat: SourceFormat.csv,
      rawRows: buildReplacementChunk(),
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
  function recordRun(key: RunKey, result: ReplacementAndFirstChunkResult, requiredPhases: readonly StatementPhase[] = NAMED_STATEMENT_PHASES): RunSummary {
    const phases = summarizePhases(result.statements);
    const transactionKindCounts = countKinds(result.transactions);
    const run: RunSummary = {
      outcome: result.outcome,
      endToEndMs: Math.round(result.endToEndMs),
      replacementOutcome: result.replacement?.outcome ?? null,
      measurementWindowCount: transactionKindCounts[TRANSACTION_KIND.MEASUREMENT_WINDOW],
      ...summarizeTransactionDurations(result.transactions),
      perKindTransactionMs: summarizeTransactionDurationsByKind(result.transactions),
      finalizeTransactionMs: finalizeTransactionDurationMs(result.transactions),
      arcgis: null,
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
      unmatchedPhases: requiredPhases.filter(phase => phases[phase].statements === 0),
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
    rehearsalSummary.failedChecks = rehearsalFailedChecks(rehearsalSummary, runExpectations);
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

  interface ArcgisCommitRunResult extends ReplacementAndFirstChunkResult {
    commitResult: CommitArcgisImportResult | null;
  }

  /** The import session the ArcGIS runs commit, plus what creating it cost. */
  interface ArcgisSeededImport {
    imported: SeededArcgisImport;
    importSessionSeedMs: number;
  }

  /** Empties census 3 and the ArcGIS import tables, then restores the Mpala-shaped census-3 seed under an active upload session. */
  async function reseedCensusThreeForArcgis(uploadSessionID: string): Promise<string[]> {
    await ensureArcgisImportTables(schema);
    await query(`DELETE FROM arcgis_import_sessions`);
    return reseedCensusThree(generateShortBatchID(), uploadSessionID);
  }

  /** Creates the import session through the product function, on the real pool; its duration is reported, not gated. */
  async function seedTimedArcgisImport(): Promise<ArcgisSeededImport> {
    const importScope: ArcgisImportScope = { schema, plotID, censusID: censusIDs.three, speciesCode: SPECIES_CODE, quadratName: QUADRAT_NAME };
    const seedStartedAt = performance.now();
    const imported = await seedArcgisImport(importScope, ARCGIS_IMPORT_FILE, arcgisImportRowCount(profile), ARCGIS_IMPORT_TAG_PREFIX, SESSION_USER);
    const importSessionSeedMs = Math.round(performance.now() - seedStartedAt);
    console.log(`[census-replacement-rehearsal] seeded ArcGIS import ${JSON.stringify({ ...imported, importSessionSeedMs })}`);
    return { imported, importSessionSeedMs };
  }

  function arcgisOutcomeOf(failure: unknown): RunOutcome {
    if (failure === null) return 'committed';
    return failure instanceof InjectedRehearsalFailureError ? 'finalize_interrupted' : 'failed';
  }

  /**
   * One commitArcgisImport attempt on the real ConnectionManager, timed transaction by transaction. Like
   * runReplacementAndFirstChunk it always returns, recording an unexpected error in `error` for runFailedChecks.
   */
  async function runArcgisCommit(imported: SeededArcgisImport, uploadSessionID: string, injection: FailureInjection | null): Promise<ArcgisCommitRunResult> {
    const statementTimer = installStatementTimer(connectionManager, injection);
    const transactionTimer = installTransactionTimer(connectionManager);
    const startedAt = performance.now();
    let commitResult: CommitArcgisImportResult | null = null;
    let failure: unknown = null;
    try {
      commitResult = await commitArcgisImport(connectionManager, {
        schema,
        plotID,
        censusID: censusIDs.three,
        importSessionId: imported.importSessionId,
        fileName: imported.fileName,
        uploadMode: UploadMode.CLEAN_REUPLOAD,
        userId: SESSION_USER,
        uploadSessionID
      });
    } catch (error) {
      failure = error;
      if (!(error instanceof InjectedRehearsalFailureError)) console.error(`[census-replacement-rehearsal] unexpected error in the ArcGIS commit run`, error);
    } finally {
      statementTimer.restore();
      transactionTimer.restore();
    }
    const endToEndMs = performance.now() - startedAt;
    const outcome = arcgisOutcomeOf(failure);
    return {
      outcome,
      replacement: null,
      endToEndMs,
      injection,
      injectionFired: statementTimer.injectionFired(),
      error: outcome === 'failed' ? errorMessageOf(failure) : null,
      rollbackError: null,
      statements: statementTimer.statements,
      transactions: transactionTimer.records(statementTimer.statements),
      commitResult
    };
  }

  async function readArcgisRunState(imported: SeededArcgisImport, uploadSessionID: string): Promise<ArcgisRunState> {
    const censusState = await readCensusThreeState(imported.batchID, uploadSessionID);
    const importRows = await query(
      `SELECT state, committed_row_count AS committedRowCount, census_replacement_completed_at IS NOT NULL AS markerSet
       FROM arcgis_import_sessions WHERE import_session_id = ?`,
      [imported.importSessionId]
    );
    if (importRows.length !== 1) throw new Error(`expected one arcgis_import_sessions row for ${imported.importSessionId}, found ${importRows.length}`);
    return {
      ...censusState,
      stagedReplacementRows: await countOf(
        `SELECT COUNT(*) AS total FROM temporarymeasurements WHERE FileID = ? AND CensusID = ? AND (BatchID = ? OR BatchID LIKE ? ${LIKE_ESCAPE_CLAUSE})`,
        [imported.fileName, censusIDs.three, imported.batchID, buildSubBatchPattern(imported.batchID)]
      ),
      sessionMarkerSet: Number(importRows[0].markerSet) === 1,
      importSessionState: String(importRows[0].state),
      importCommittedRowCount: Number(importRows[0].committedRowCount)
    };
  }

  /** What census 3, the import session and the staging table hold after an ArcGIS attempt that replaced the census, staged every row and ended in `importSessionState`. */
  function expectedArcgisRunState(importSessionState: string): ArcgisRunState {
    const importRows = arcgisImportRowCount(profile);
    return {
      ...expectedReplacedState(profile),
      stagedReplacementRows: importRows,
      sessionMarkerSet: true,
      importSessionState,
      importCommittedRowCount: importRows
    };
  }

  function attachArcgisDetails(run: RunSummary, seeded: ArcgisSeededImport): void {
    run.arcgis = { importRowCount: seeded.imported.rowCount, importSessionSeedMs: seeded.importSessionSeedMs, derivedBatchID: seeded.imported.batchID };
  }

  /** The ArcGIS twin of verifyRun: reads the import session's state and marker instead of the upload session's. */
  async function verifyArcgisRun(
    key: ArcgisRunKey,
    run: RunSummary,
    expectedState: ArcgisRunState,
    imported: SeededArcgisImport,
    uploadSessionID: string,
    preRunMismatches: string[]
  ): Promise<{ state: ArcgisRunState; controls: ControlCensusFingerprint[] }> {
    const state = await readArcgisRunState(imported, uploadSessionID);
    const controls = await readControlFingerprints();
    run.verification = {
      preRunMismatches,
      statementPlanMismatches: [],
      countMismatches: describeMismatches(expectedState, state),
      controlCensusMismatches: describeMismatches(controlBaseline, controls)
    };
    console.log(`[census-replacement-rehearsal] ${key} verification ${JSON.stringify(run.verification)} state=${JSON.stringify(state)}`);
    return { state, controls };
  }

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
    '(8) ArcGIS commit run: every transaction commits within budget with exact kind counts and the census replaced (catches: an ArcGIS unit that grows with the import)',
    async () => {
      const expectation = runExpectations.arcgisCommitRun;
      const preRunMismatches = await reseedCensusThreeForArcgis(ARCGIS_SESSION_ID.COMMIT_RUN);
      const seeded = await seedTimedArcgisImport();

      const result = await runArcgisCommit(seeded.imported, ARCGIS_SESSION_ID.COMMIT_RUN, expectation.injection);
      const run = recordRun('arcgisCommitRun', result, ARCGIS_COMMIT_REQUIRED_PHASES);
      attachArcgisDetails(run, seeded);
      const { state, controls } = await verifyArcgisRun(
        'arcgisCommitRun',
        run,
        expectedArcgisRunState(ARCGIS_IMPORT_SESSION_STATE.COMMITTED),
        seeded.imported,
        ARCGIS_SESSION_ID.COMMIT_RUN,
        preRunMismatches
      );

      expect(runFailedChecks('arcgisCommitRun', run, expectation), 'every ArcGIS-commit-run check (the same list feeds SUMMARY.passed)').toEqual([]);
      expect(result.commitResult).toEqual({
        rowCount: seeded.imported.rowCount,
        fileName: ARCGIS_IMPORT_FILE,
        alreadyCommitted: false,
        batchID: seeded.imported.batchID
      });
      expect(state).toEqual(expectedArcgisRunState(ARCGIS_IMPORT_SESSION_STATE.COMMITTED));
      expect(controls).toEqual(controlBaseline);
    },
    RUN_TIMEOUT_MS
  );

  it(
    '(9) ArcGIS interrupted run: a failure at the finalize changelog INSERT leaves the census replaced and audited, every row staged, the import still committing (catches: a finalize that commits partially or a replacement that rolls back)',
    async () => {
      const expectation = runExpectations.arcgisInterruptedRun;
      const preRunMismatches = await reseedCensusThreeForArcgis(ARCGIS_SESSION_ID.INTERRUPTED_RUN);
      arcgisInterruptedImport = await seedTimedArcgisImport();

      const result = await runArcgisCommit(arcgisInterruptedImport.imported, ARCGIS_SESSION_ID.INTERRUPTED_RUN, expectation.injection);
      const run = recordRun('arcgisInterruptedRun', result, ARCGIS_COMMIT_REQUIRED_PHASES);
      attachArcgisDetails(run, arcgisInterruptedImport);
      const { state, controls } = await verifyArcgisRun(
        'arcgisInterruptedRun',
        run,
        expectedArcgisRunState(ARCGIS_IMPORT_SESSION_STATE.COMMITTING),
        arcgisInterruptedImport.imported,
        ARCGIS_SESSION_ID.INTERRUPTED_RUN,
        preRunMismatches
      );

      expect(runFailedChecks('arcgisInterruptedRun', run, expectation), 'every ArcGIS-interrupted-run check (the same list feeds SUMMARY.passed)').toEqual([]);
      expect(result.commitResult, 'the interrupted commit returns no result').toBeNull();
      expect(state).toEqual(expectedArcgisRunState(ARCGIS_IMPORT_SESSION_STATE.COMMITTING));
      expect(controls).toEqual(controlBaseline);
    },
    RUN_TIMEOUT_MS
  );

  it(
    '(10) ArcGIS resumed run: the retry under a new upload session clears and restages every row, deletes nothing more and finalizes within budget (catches: a retry that double-audits, keeps stale staged rows or skips a window)',
    async () => {
      const expectation = runExpectations.arcgisResumedRun;
      const interrupted = arcgisInterruptedImport!;
      await query(`UPDATE upload_sessions SET state = ? WHERE session_id = ?`, [UPLOAD_SESSION_STATE_FAILED, ARCGIS_SESSION_ID.INTERRUPTED_RUN]);
      await seedUploadSession(ARCGIS_SESSION_ID.RESUMED_RUN);

      const result = await runArcgisCommit(interrupted.imported, ARCGIS_SESSION_ID.RESUMED_RUN, expectation.injection);
      const run = recordRun('arcgisResumedRun', result, ARCGIS_RESUME_REQUIRED_PHASES);
      attachArcgisDetails(run, interrupted);
      const { state, controls } = await verifyArcgisRun(
        'arcgisResumedRun',
        run,
        expectedArcgisRunState(ARCGIS_IMPORT_SESSION_STATE.COMMITTED),
        interrupted.imported,
        ARCGIS_SESSION_ID.RESUMED_RUN,
        []
      );

      expect(runFailedChecks('arcgisResumedRun', run, expectation), 'every ArcGIS-resumed-run check (the same list feeds SUMMARY.passed)').toEqual([]);
      expect(result.commitResult).toEqual({
        rowCount: interrupted.imported.rowCount,
        fileName: ARCGIS_IMPORT_FILE,
        alreadyCommitted: false,
        batchID: interrupted.imported.batchID
      });
      expect(state, 'DELETE-audit rows equal the prior row count and are all distinct').toEqual(expectedArcgisRunState(ARCGIS_IMPORT_SESSION_STATE.COMMITTED));
      expect(controls).toEqual(controlBaseline);
    },
    RUN_TIMEOUT_MS
  );
});
