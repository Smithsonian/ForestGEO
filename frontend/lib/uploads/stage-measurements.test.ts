import { beforeEach, describe, expect, it, vi } from 'vitest';
import ailogger from '@/ailogger';
import { SourceFormat } from '@/config/macros/formdetails';
import { UploadMode } from '@/config/uploadmodes';
import { UploadSessionOwnershipError, UploadSessionState } from '@/config/uploadsessiontracker';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { resolveMeasurementChunk } from '@/lib/column-mapping/measurement-rows';
import { CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE } from '@/lib/ingestion/temporary-measurements';
import {
  getIngestionBatchSize,
  MAX_ORIGINAL_BATCH_ID_LENGTH,
  MAX_SUB_BATCH_ORDINAL,
  OriginalBatchIDTooLongError,
  SubBatchOrdinalOverflowError
} from '@/lib/uploads/batch-family';
import {
  CENSUS_REPLACEMENT_COMPLETED_EVENT,
  CENSUS_REPLACEMENT_REAPER_HEADROOM_FACTOR,
  CENSUS_REPLACEMENT_STARTED_EVENT,
  CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS,
  CensusReplacementIncompleteError,
  EmptyMeasurementUploadError,
  InvalidFirstRowOrdinalError,
  MeasurementChunkResolutionError,
  parseFirstRowOrdinal,
  replaceCensusForCleanReupload,
  stageMeasurementChunk,
  type CensusReplacementParams
} from './stage-measurements';
import { CensusReplacementMarkerColumnMissingError, resetUploadSessionReplacementMarkerCacheForTests } from './upload-session-replacement-marker';
import { CENSUS_REPLACEMENT_STATEMENT, SESSION_LOCK_CLAUSE } from '@/tests/setup/census-replacement-statement-patterns';

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/column-mapping/measurement-rows', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/column-mapping/measurement-rows')>();
  return { ...actual, resolveMeasurementChunk: vi.fn(actual.resolveMeasurementChunk) };
});

beforeEach(() => {
  vi.clearAllMocks();
  resetUploadSessionReplacementMarkerCacheForTests();
});

const INVALID_FIRST_ROW_ORDINAL_CODE = 'INVALID_FIRST_ROW_ORDINAL';

describe('parseFirstRowOrdinal', () => {
  it.each([
    ['undefined', undefined, null],
    ['null', null, null],
    ['zero', 0, 0],
    ['a positive integer', 7, 7]
  ])('accepts %s', (_label, value, expected) => {
    const parsed = parseFirstRowOrdinal(value);
    console.log(`[parseFirstRowOrdinal] ${String(value)} -> ${String(parsed)}`);
    expect(parsed).toBe(expected);
  });

  it.each([
    ['a negative integer', -1],
    ['a fraction', 1.5],
    ['a numeric string', '3'],
    ['NaN', Number.NaN],
    ['2**53, past the safe-integer range', 2 ** 53],
    ['1e300', 1e300]
  ])('rejects %s with InvalidFirstRowOrdinalError', (_label, value) => {
    let thrown: unknown;
    try {
      parseFirstRowOrdinal(value);
    } catch (error) {
      thrown = error;
    }
    console.log(`[parseFirstRowOrdinal] ${typeof value} ${String(value)} threw:`, thrown instanceof Error ? thrown.message : thrown);
    expect(thrown).toBeInstanceOf(InvalidFirstRowOrdinalError);
    expect((thrown as InvalidFirstRowOrdinalError).code).toBe(INVALID_FIRST_ROW_ORDINAL_CODE);
    expect((thrown as Error).message).toContain(typeof value === 'string' ? JSON.stringify(value) : String(value));
  });
});

const SCHEMA = 'forestgeo_testing';
const PLOT_ID = 22;
const CENSUS_ID = 32;
const SESSION_ID = 'replacement-unit-session';
const BATCH_ID = 'incoming-batch-0001';
const FILE_NAME = 'replacement.csv';
const W = CENSUS_REPLACEMENT_DELETE_CHUNK_SIZE;
const ID_STRIDE = 1_000_000;
const SHORT_WINDOW_ROWS = 5;
const METRICS_TAIL_ROWS = 7;
const MARKER_COLUMN = 'census_replacement_completed_at';
const CSV_HEADERS = ['treetag', 'stemtag', 'speciescode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'];
const VALID_ROW = {
  treetag: 'T1',
  stemtag: '1',
  speciescode: 'ACERRU',
  quadrat: 'Q01',
  lx: '1',
  ly: '1',
  dbh: '10',
  hom: '1.3',
  date: '2026-06-01',
  codes: 'A'
};
const BLANK_ROW = Object.fromEntries(CSV_HEADERS.map(header => [header, '']));
const ACTIVE_STATE = UploadSessionState.UPLOADING;

const STATEMENT = {
  MARKER_COLUMN_STATE: 'markerColumnState',
  MARKER_PROBE: 'markerProbe',
  FAMILY_PROBE: 'familyProbe',
  SESSION_LOCK: 'sessionLock',
  MEASUREMENT_ID_SELECT: 'measurementIdSelect',
  ERROR_LINK_DELETE: 'errorLinkDelete',
  DELETE_AUDIT: 'deleteAudit',
  MEASUREMENT_DELETE: 'measurementDelete',
  LEGACY_DELETE: 'legacyDelete',
  METRICS_DELETE: 'metricsDelete',
  MARKER_UPDATE: 'markerUpdate'
} as const;
type StatementKind = (typeof STATEMENT)[keyof typeof STATEMENT];

const STATEMENT_PATTERNS: ReadonlyArray<[StatementKind, RegExp]> = [
  [STATEMENT.MARKER_COLUMN_STATE, CENSUS_REPLACEMENT_STATEMENT.MARKER_COLUMN_STATE],
  [STATEMENT.SESSION_LOCK, CENSUS_REPLACEMENT_STATEMENT.SESSION_LOCK],
  [STATEMENT.MARKER_PROBE, CENSUS_REPLACEMENT_STATEMENT.MARKER_PROBE],
  [STATEMENT.MARKER_UPDATE, CENSUS_REPLACEMENT_STATEMENT.MARKER_UPDATE],
  [STATEMENT.FAMILY_PROBE, CENSUS_REPLACEMENT_STATEMENT.FAMILY_PROBE],
  [STATEMENT.MEASUREMENT_ID_SELECT, CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_ID_SELECT],
  [STATEMENT.ERROR_LINK_DELETE, CENSUS_REPLACEMENT_STATEMENT.ERROR_LINK_DELETE],
  [STATEMENT.DELETE_AUDIT, CENSUS_REPLACEMENT_STATEMENT.DELETE_AUDIT],
  [STATEMENT.MEASUREMENT_DELETE, CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_DELETE],
  [STATEMENT.LEGACY_DELETE, CENSUS_REPLACEMENT_STATEMENT.LEGACY_DELETE],
  [STATEMENT.METRICS_DELETE, CENSUS_REPLACEMENT_STATEMENT.METRICS_DELETE]
];

function classify(sql: string): StatementKind {
  const match = STATEMENT_PATTERNS.find(([, pattern]) => pattern.test(sql));
  if (!match) throw new Error(`Unscripted statement reached the fake: ${sql.replace(/\s+/g, ' ').slice(0, 160)}`);
  return match[0];
}

interface MeasurementPage {
  cursor: 'zero' | 'previous_last_id';
  rows: number;
}
interface SessionRow {
  state: string;
  plot_id: number;
  census_id: number;
  census_replacement_completed_at: string | null;
}
type SessionLockAnswer = SessionRow | 'no_row' | 'table_missing' | 'marker_column_missing';
interface ReplacementScript {
  measurementPages: MeasurementPage[];
  legacy: 'missing' | number[];
  metrics: number[];
  /** Answer for the n-th session-lock statement (0-based); default: active, matching scope, marker unset. */
  sessionLock?: (lockIndex: number) => SessionLockAnswer;
  failOn?: { kind: typeof STATEMENT.MEASUREMENT_DELETE | typeof STATEMENT.METRICS_DELETE; occurrence: number };
  preliminaryMarkerSet?: boolean;
  familyStaged?: boolean;
}
interface RecordedStatement {
  kind: StatementKind;
  sql: string;
  params: unknown[];
}
interface RecordedTransaction {
  id: string;
  timeoutMs: number | undefined;
  statements: RecordedStatement[];
  outcome: 'open' | 'committed' | 'rolled_back';
}

class InjectedStatementFailure extends Error {}

function missingTableError(table: string): Error {
  return Object.assign(new Error(`Table '${SCHEMA}.${table}' doesn't exist`), { code: 'ER_NO_SUCH_TABLE' });
}

const ACTIVE_SESSION: SessionRow = { state: ACTIVE_STATE, plot_id: PLOT_ID, census_id: CENSUS_ID, census_replacement_completed_at: null };
const MARKER_SET_SESSION: SessionRow = { ...ACTIVE_SESSION, census_replacement_completed_at: '2026-10-27 00:00:00' };

function makeReplacementConnectionManager(script: ReplacementScript) {
  const transactions: RecordedTransaction[] = [];
  const outsideTransactions: RecordedStatement[] = [];
  let current: RecordedTransaction | null = null;
  let pageIndex = 0;
  let previousLastID = 0;
  let lastIDs: number[] = [];
  let lockIndex = 0;
  let legacyIndex = 0;
  let metricsIndex = 0;
  const occurrences = new Map<StatementKind, number>();

  const executeQuery = async (sql: string, params: unknown[] = [], transactionID?: string) => {
    const kind = classify(String(sql));
    const target = current && transactionID === current.id ? current.statements : outsideTransactions;
    target.push({ kind, sql: String(sql), params });
    const occurrence = (occurrences.get(kind) ?? 0) + 1;
    occurrences.set(kind, occurrence);
    if (script.failOn && script.failOn.kind === kind && script.failOn.occurrence === occurrence) {
      throw new InjectedStatementFailure(`injected failure at ${kind} #${occurrence}`);
    }
    switch (kind) {
      case STATEMENT.MARKER_COLUMN_STATE:
        return [{ tableCount: 1, columnCount: 1 }];
      case STATEMENT.MARKER_PROBE:
        return [{ census_replacement_completed_at: script.preliminaryMarkerSet ? '2026-10-27 00:00:00' : null }];
      case STATEMENT.FAMILY_PROBE:
        return script.familyStaged ? [{ staged: 1 }] : [];
      case STATEMENT.SESSION_LOCK: {
        const answer = (script.sessionLock ?? (() => ACTIVE_SESSION))(lockIndex++);
        if (answer === 'table_missing') throw missingTableError('upload_sessions');
        if (answer === 'marker_column_missing') return [{ state: ACTIVE_STATE, plot_id: PLOT_ID, census_id: CENSUS_ID }];
        return answer === 'no_row' ? [] : [answer];
      }
      case STATEMENT.MEASUREMENT_ID_SELECT: {
        const page = script.measurementPages[pageIndex];
        if (!page)
          throw new Error(`Measurement page ${pageIndex + 1} requested; the script has ${script.measurementPages.length}. Unit A did not end where expected.`);
        const expectedCursor = page.cursor === 'zero' ? 0 : previousLastID;
        const requestedCursor = params[params.length - 1];
        if (requestedCursor !== expectedCursor)
          throw new Error(`Page ${pageIndex + 1} requested at cursor ${String(requestedCursor)}; the script expects ${expectedCursor}.`);
        lastIDs = Array.from({ length: page.rows }, (_, index) => (pageIndex + 1) * ID_STRIDE + index);
        if (lastIDs.length > 0) previousLastID = lastIDs[lastIDs.length - 1];
        pageIndex += 1;
        return lastIDs.map(id => ({ CoreMeasurementID: id }));
      }
      case STATEMENT.ERROR_LINK_DELETE:
      case STATEMENT.DELETE_AUDIT:
      case STATEMENT.MEASUREMENT_DELETE:
        return { affectedRows: lastIDs.length };
      case STATEMENT.LEGACY_DELETE: {
        if (script.legacy === 'missing') throw missingTableError('failedmeasurements');
        const affectedRows = script.legacy[legacyIndex++];
        if (affectedRows === undefined) throw new Error('Legacy pass requested past the script: unit B did not end where expected.');
        return { affectedRows };
      }
      case STATEMENT.METRICS_DELETE: {
        const affectedRows = script.metrics[metricsIndex++];
        if (affectedRows === undefined) throw new Error('Metrics window requested past the script: unit C did not end where expected.');
        return { affectedRows };
      }
      case STATEMENT.MARKER_UPDATE:
        return { affectedRows: 1 };
    }
  };

  const withTransaction = async <T>(
    fn: (tx: { id: string; query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<T>,
    opts?: { timeoutMs?: number }
  ) => {
    const transaction: RecordedTransaction = { id: `tx-${transactions.length + 1}`, timeoutMs: opts?.timeoutMs, statements: [], outcome: 'open' };
    transactions.push(transaction);
    current = transaction;
    try {
      const result = await fn({ id: transaction.id, query: (sql, params) => executeQuery(sql, params, transaction.id) });
      transaction.outcome = 'committed';
      return result;
    } catch (error) {
      transaction.outcome = 'rolled_back';
      throw error;
    } finally {
      current = null;
    }
  };

  return { connectionManager: { executeQuery, withTransaction } as unknown as ConnectionManager, transactions, outsideTransactions };
}

type TransactionKind = 'measurement_window' | 'legacy_pass' | 'metrics_window' | 'completion' | 'session_check_only';
function transactionKind(transaction: RecordedTransaction): TransactionKind {
  const kinds = new Set(transaction.statements.map(statement => statement.kind));
  if (kinds.has(STATEMENT.MEASUREMENT_ID_SELECT)) return 'measurement_window';
  if (kinds.has(STATEMENT.LEGACY_DELETE)) return 'legacy_pass';
  if (kinds.has(STATEMENT.METRICS_DELETE)) return 'metrics_window';
  if (kinds.has(STATEMENT.MARKER_UPDATE)) return 'completion';
  return 'session_check_only';
}

function describeTransactions(transactions: RecordedTransaction[]): string[] {
  return transactions.map(
    transaction =>
      `${transaction.id} ${transaction.outcome} ${transactionKind(transaction)}: ${transaction.statements.map(statement => statement.kind).join(',')}`
  );
}

function replacementParams(overrides: Partial<CensusReplacementParams> = {}): CensusReplacementParams {
  return {
    schema: SCHEMA,
    fileName: FILE_NAME,
    batchID: BATCH_ID,
    plotID: PLOT_ID,
    censusID: CENSUS_ID,
    uploadMode: UploadMode.CLEAN_REUPLOAD,
    sourceFormat: SourceFormat.csv,
    rawRows: [VALID_ROW],
    csvHeaders: CSV_HEADERS,
    delimiter: ',',
    uploadSessionID: SESSION_ID,
    firstRowOrdinal: 0,
    changedBy: 'unit-test@forestgeo.test',
    ...overrides
  };
}

const SINGLE_SHORT_WINDOW_SCRIPT: ReplacementScript = {
  measurementPages: [{ cursor: 'zero', rows: SHORT_WINDOW_ROWS }],
  legacy: [0],
  metrics: [0]
};

const REPLACEMENT_UNIT_OF_STATEMENT: Partial<Record<StatementKind, 'A' | 'B' | 'C' | 'D'>> = {
  [STATEMENT.MEASUREMENT_ID_SELECT]: 'A',
  [STATEMENT.ERROR_LINK_DELETE]: 'A',
  [STATEMENT.DELETE_AUDIT]: 'A',
  [STATEMENT.MEASUREMENT_DELETE]: 'A',
  [STATEMENT.LEGACY_DELETE]: 'B',
  [STATEMENT.METRICS_DELETE]: 'C',
  [STATEMENT.MARKER_UPDATE]: 'D'
};

const MEASUREMENT = 'measurement_window';
const LEGACY = 'legacy_pass';
const METRICS = 'metrics_window';
const COMPLETION = 'completion';

async function runReplacement(script: ReplacementScript, overrides: Partial<CensusReplacementParams> = {}) {
  const harness = makeReplacementConnectionManager(script);
  let result: Awaited<ReturnType<typeof replaceCensusForCleanReupload>> | undefined;
  let error: unknown;
  try {
    result = await replaceCensusForCleanReupload(harness.connectionManager, replacementParams(overrides));
  } catch (thrown) {
    error = thrown;
  }
  console.log(
    `[replaceCensusForCleanReupload] result=${JSON.stringify(result)} error=${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`
  );
  console.log(describeTransactions(harness.transactions));
  return { ...harness, result, error };
}

function allStatements(transactions: RecordedTransaction[]): RecordedStatement[] {
  return transactions.flatMap(transaction => transaction.statements);
}

const loggedEvents = (event: string) => vi.mocked(ailogger.info).mock.calls.filter(([message]) => message === event);

describe('replaceCensusForCleanReupload', () => {
  it('U3: commits each unit in its own transaction, marker last (catches: one transaction for everything; marker in an earlier transaction; no confirming window; metrics inside a measurement window; session lock taken with a plain read)', async () => {
    const { result, error, transactions } = await runReplacement({
      measurementPages: [
        { cursor: 'zero', rows: W },
        { cursor: 'previous_last_id', rows: W },
        { cursor: 'previous_last_id', rows: W - 1 },
        { cursor: 'zero', rows: 0 }
      ],
      legacy: 'missing',
      metrics: [3]
    });

    expect(error).toBeUndefined();
    expect(result).toEqual({ outcome: 'replaced', deletedRows: 3 * W - 1, windowCount: 4 });
    expect(transactions.map(transactionKind)).toEqual([MEASUREMENT, MEASUREMENT, MEASUREMENT, MEASUREMENT, LEGACY, METRICS, COMPLETION]);
    expect(transactions.map(transaction => transaction.outcome)).toEqual(Array(7).fill('committed'));
    for (const transaction of transactions) {
      expect(transaction.statements[0]?.kind, `${transaction.id} must start with the session lock`).toBe(STATEMENT.SESSION_LOCK);
      expect(transaction.statements[0]?.sql, `${transaction.id} must lock the session row with FOR UPDATE, not read it`).toMatch(SESSION_LOCK_CLAUSE);
      const unitKinds = new Set(transaction.statements.map(statement => REPLACEMENT_UNIT_OF_STATEMENT[statement.kind]).filter(Boolean));
      expect(unitKinds.size, `${transaction.id} mixes units: ${[...unitKinds].join(',')}`).toBeLessThanOrEqual(1);
      expect(transaction.timeoutMs).toBe(CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS);
    }
    const markerUpdateTransactions = transactions.filter(transaction => transaction.statements.some(statement => statement.kind === STATEMENT.MARKER_UPDATE));
    expect(markerUpdateTransactions.map(transaction => transaction.id)).toEqual(['tx-7']);

    const logKeys = { schema: SCHEMA, plotID: PLOT_ID, censusID: CENSUS_ID, uploadSessionID: SESSION_ID, batchID: BATCH_ID };
    const started = loggedEvents(CENSUS_REPLACEMENT_STARTED_EVENT);
    const completed = loggedEvents(CENSUS_REPLACEMENT_COMPLETED_EVENT);
    console.log('[U3] started log', JSON.stringify(started), 'completed log', JSON.stringify(completed));
    expect(started).toHaveLength(1);
    expect(started[0][1]).toEqual(logKeys);
    expect(completed).toHaveLength(1);
    expect(completed[0][1]).toEqual({
      ...logKeys,
      outcome: 'replaced',
      deletedRows: 3 * W - 1,
      windowCount: 4,
      slowestWindowMs: expect.any(Number),
      elapsedMs: expect.any(Number)
    });
    const completedContext = completed[0][1] as { slowestWindowMs: number; elapsedMs: number };
    expect(completedContext.slowestWindowMs).toBeGreaterThanOrEqual(0);
    expect(completedContext.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  describe('U4: unit A ends on the confirming pass', () => {
    it('a) full, full, empty at the cursor, then an empty confirming pass: 4 measurement windows + legacy + metrics + completion (catches: ending unit A on an empty cursor window)', async () => {
      const { result, transactions } = await runReplacement({
        measurementPages: [
          { cursor: 'zero', rows: W },
          { cursor: 'previous_last_id', rows: W },
          { cursor: 'previous_last_id', rows: 0 },
          { cursor: 'zero', rows: 0 }
        ],
        legacy: 'missing',
        metrics: [0]
      });
      expect(transactions).toHaveLength(7);
      expect(result).toEqual({ outcome: 'replaced', deletedRows: 2 * W, windowCount: 4 });
    });

    it('b) an empty census ends on its first window, which already covered the whole scope (catches: an extra confirming pass at cursor 0)', async () => {
      const { result, transactions } = await runReplacement({ measurementPages: [{ cursor: 'zero', rows: 0 }], legacy: 'missing', metrics: [0] });
      expect(transactions.map(transactionKind)).toEqual([MEASUREMENT, LEGACY, METRICS, COMPLETION]);
      expect(result).toEqual({ outcome: 'replaced', deletedRows: 0, windowCount: 1 });
    });

    it('c) a short first window ends unit A with no confirming pass (catches: a loop that never ends or skips completion)', async () => {
      const { result, transactions } = await runReplacement({
        measurementPages: [{ cursor: 'zero', rows: SHORT_WINDOW_ROWS }],
        legacy: 'missing',
        metrics: [0]
      });
      expect(transactions.map(transactionKind)).toEqual([MEASUREMENT, LEGACY, METRICS, COMPLETION]);
      expect(result).toEqual({ outcome: 'replaced', deletedRows: SHORT_WINDOW_ROWS, windowCount: 1 });
    });
  });

  it('U5: a failing window propagates and nothing after it runs (catches: marker set on a partial replacement; errors swallowed)', async () => {
    const { error, transactions } = await runReplacement({
      measurementPages: [
        { cursor: 'zero', rows: W },
        { cursor: 'previous_last_id', rows: W }
      ],
      legacy: [0],
      metrics: [0],
      failOn: { kind: STATEMENT.MEASUREMENT_DELETE, occurrence: 2 }
    });

    expect(error).toBeInstanceOf(InjectedStatementFailure);
    expect(transactions.map(transaction => transaction.outcome)).toEqual(['committed', 'rolled_back']);
    expect(transactions.map(transactionKind)).toEqual([MEASUREMENT, MEASUREMENT]);
    expect(allStatements(transactions).some(statement => statement.kind === STATEMENT.MARKER_UPDATE)).toBe(false);
    expect(loggedEvents(CENSUS_REPLACEMENT_STARTED_EVENT)).toHaveLength(1);
    expect(loggedEvents(CENSUS_REPLACEMENT_COMPLETED_EVENT)).toHaveLength(0);
  });

  describe('U6: every unit re-checks the session under its lock', () => {
    const UNITS = [
      { unit: 'A (measurements)', lockIndex: 0 },
      { unit: 'B (legacy failures)', lockIndex: 1 },
      { unit: 'C (metrics)', lockIndex: 2 },
      { unit: 'D (marker)', lockIndex: 3 }
    ] as const;
    const REFUSALS: ReadonlyArray<[string, SessionLockAnswer]> = [
      ['an abandoned session', { ...ACTIVE_SESSION, state: UploadSessionState.ABANDONED }],
      ['a session of another census', { ...ACTIVE_SESSION, census_id: CENSUS_ID + 1 }],
      ['a session of another plot', { ...ACTIVE_SESSION, plot_id: PLOT_ID + 1 }],
      ['no session row', 'no_row'],
      ['no upload_sessions table', 'table_missing']
    ];

    function lockAnswerAt(lockIndex: number, answer: SessionLockAnswer): ReplacementScript['sessionLock'] {
      return index => (index === lockIndex ? answer : ACTIVE_SESSION);
    }

    function expectNoWorkInTransactionAndNoLaterTransaction(transactions: RecordedTransaction[], lockIndex: number) {
      expect(transactions, `no transaction after the refusing one (lock #${lockIndex})`).toHaveLength(lockIndex + 1);
      expect(transactions[lockIndex].statements.map(statement => statement.kind)).toEqual([STATEMENT.SESSION_LOCK]);
    }

    it.each(UNITS.flatMap(({ unit, lockIndex }) => REFUSALS.map(([refusal, answer]) => [unit, refusal, lockIndex, answer] as const)))(
      'unit %s refuses %s with UploadSessionOwnershipError and deletes nothing (catches: removing a section 4 check from a unit)',
      async (_unit, _refusal, lockIndex, answer) => {
        const { error, transactions } = await runReplacement({ ...SINGLE_SHORT_WINDOW_SCRIPT, sessionLock: lockAnswerAt(lockIndex, answer) });
        expect(error).toBeInstanceOf(UploadSessionOwnershipError);
        expectNoWorkInTransactionAndNoLaterTransaction(transactions, lockIndex);
        expect(transactions[lockIndex].outcome).toBe('rolled_back');
      }
    );

    it.each(UNITS.map(({ unit, lockIndex }) => [unit, lockIndex] as const))(
      'unit %s yields to a peer that already set the marker: completed_by_peer, nothing deleted (catches: running a window after the peer finished)',
      async (_unit, lockIndex) => {
        const { result, error, transactions } = await runReplacement({
          ...SINGLE_SHORT_WINDOW_SCRIPT,
          sessionLock: lockAnswerAt(lockIndex, MARKER_SET_SESSION)
        });
        expect(error).toBeUndefined();
        expect(result?.outcome).toBe('completed_by_peer');
        expectNoWorkInTransactionAndNoLaterTransaction(transactions, lockIndex);
        expect(transactions[lockIndex].outcome).toBe('committed');
        expect(loggedEvents(CENSUS_REPLACEMENT_COMPLETED_EVENT)).toHaveLength(1);
      }
    );

    it.each(UNITS.map(({ unit, lockIndex }) => [unit, lockIndex] as const))(
      'unit %s refuses a lock row without the marker column (catches: an absent column read as "set", review P3-2)',
      async (_unit, lockIndex) => {
        const { error, transactions } = await runReplacement({ ...SINGLE_SHORT_WINDOW_SCRIPT, sessionLock: lockAnswerAt(lockIndex, 'marker_column_missing') });
        expect(error).toBeInstanceOf(CensusReplacementMarkerColumnMissingError);
        expect((error as Error).message).toContain(MARKER_COLUMN);
        expectNoWorkInTransactionAndNoLaterTransaction(transactions, lockIndex);
      }
    );
  });

  describe('U7: input is validated before anything is deleted (catches: the replacement running before input validation, the #504 regression)', () => {
    const MISALIGNED = 'a column-count mismatch';
    it.each([
      ['no rows', { rawRows: [] }, EmptyMeasurementUploadError],
      ['only blank rows', { rawRows: [BLANK_ROW] }, EmptyMeasurementUploadError],
      [MISALIGNED, {}, MeasurementChunkResolutionError],
      [
        'a batch id too long to take a sub-batch suffix',
        { batchID: 'b'.repeat(MAX_ORIGINAL_BATCH_ID_LENGTH + 1), firstRowOrdinal: 0 },
        OriginalBatchIDTooLongError
      ],
      [
        'a first row ordinal past the last nameable sub-batch',
        { firstRowOrdinal: getIngestionBatchSize() * MAX_SUB_BATCH_ORDINAL },
        SubBatchOrdinalOverflowError
      ],
      [
        'a first row ordinal at the largest safe integer, whose second row would not be a safe integer',
        { firstRowOrdinal: Number.MAX_SAFE_INTEGER, rawRows: [VALID_ROW, VALID_ROW] },
        SubBatchOrdinalOverflowError
      ]
    ])('%s throws before any replacement transaction opens', async (label, overrides, expectedError) => {
      if (label === MISALIGNED) {
        const { resolveMeasurementChunk: realResolve } =
          await vi.importActual<typeof import('@/lib/column-mapping/measurement-rows')>('@/lib/column-mapping/measurement-rows');
        vi.mocked(resolveMeasurementChunk).mockImplementationOnce((...args) => ({ ...realResolve(...args), columnCountMismatch: true }));
      }
      const { error, transactions, outsideTransactions } = await runReplacement(SINGLE_SHORT_WINDOW_SCRIPT, overrides);
      expect(error).toBeInstanceOf(expectedError);
      expect(transactions).toHaveLength(0);
      const deletes = outsideTransactions.filter(
        statement => statement.kind !== STATEMENT.MARKER_COLUMN_STATE && statement.kind !== STATEMENT.MARKER_PROBE && statement.kind !== STATEMENT.FAMILY_PROBE
      );
      expect(deletes.map(statement => statement.kind)).toEqual([]);
    });
  });

  describe('U8: only a CLEAN_REUPLOAD that still owes the replacement opens a transaction (catches: replacing on every chunk)', () => {
    it.each([
      ['REVISIONS mode', { uploadMode: UploadMode.REVISIONS }, {}, 'not_applicable'],
      ['suppressCensusReplacementCleanup', { suppressCensusReplacementCleanup: true }, {}, 'not_applicable'],
      ['a session that already completed its replacement', {}, { preliminaryMarkerSet: true }, 'already_completed'],
      ['a family that already has staged rows', {}, { familyStaged: true }, 'upload_in_progress']
    ])('%s answers without a transaction', async (_label, overrides, scriptOverrides, expectedOutcome) => {
      const { result, error, transactions, outsideTransactions } = await runReplacement({ ...SINGLE_SHORT_WINDOW_SCRIPT, ...scriptOverrides }, overrides);
      expect(error).toBeUndefined();
      expect(result).toEqual({ outcome: expectedOutcome, deletedRows: 0, windowCount: 0 });
      expect(transactions).toHaveLength(0);
      if (expectedOutcome === 'not_applicable') expect(outsideTransactions, 'not applicable must issue no statement at all').toHaveLength(0);
    });

    it('a missing upload session id is refused with UploadSessionOwnershipError and no statement', async () => {
      const { error, transactions, outsideTransactions } = await runReplacement(SINGLE_SHORT_WINDOW_SCRIPT, { uploadSessionID: null });
      expect(error).toBeInstanceOf(UploadSessionOwnershipError);
      expect(transactions).toHaveLength(0);
      expect(outsideTransactions).toHaveLength(0);
    });
  });

  describe('U10: the confirming pass follows the cursor rules', () => {
    it('a) full, short at a cursor, then a confirming window with rows: 3 windows (catches: ending on a short cursor window without the full-scope pass)', async () => {
      const { result, transactions } = await runReplacement({
        measurementPages: [
          { cursor: 'zero', rows: W },
          { cursor: 'previous_last_id', rows: W - 1 },
          { cursor: 'zero', rows: 3 }
        ],
        legacy: 'missing',
        metrics: [0]
      });
      expect(transactions.map(transactionKind)).toEqual([MEASUREMENT, MEASUREMENT, MEASUREMENT, LEGACY, METRICS, COMPLETION]);
      expect(result).toEqual({ outcome: 'replaced', deletedRows: W + W - 1 + 3, windowCount: 3 });
    });

    it('b) a full confirming window moves the cursor on and needs its own confirmation: 5 windows (catches: ending on a full confirming window; resetting the cursor on every window)', async () => {
      const { result, transactions } = await runReplacement({
        measurementPages: [
          { cursor: 'zero', rows: W },
          { cursor: 'previous_last_id', rows: W - 1 },
          { cursor: 'zero', rows: W },
          { cursor: 'previous_last_id', rows: 0 },
          { cursor: 'zero', rows: 0 }
        ],
        legacy: 'missing',
        metrics: [0]
      });
      expect(transactions.map(transactionKind)).toEqual([MEASUREMENT, MEASUREMENT, MEASUREMENT, MEASUREMENT, MEASUREMENT, LEGACY, METRICS, COMPLETION]);
      expect(result).toEqual({ outcome: 'replaced', deletedRows: W + W - 1 + W, windowCount: 5 });
    });
  });

  describe('U11: metrics are deleted one window per transaction', () => {
    it('three windows are three transactions, each with the session lock, before the completion (catches: all metrics in one transaction; the marker before the last metrics window; a metrics window without the session lock)', async () => {
      const { transactions } = await runReplacement({
        measurementPages: [{ cursor: 'zero', rows: SHORT_WINDOW_ROWS }],
        legacy: 'missing',
        metrics: [W, W, METRICS_TAIL_ROWS]
      });
      expect(transactions.map(transactionKind)).toEqual([MEASUREMENT, LEGACY, METRICS, METRICS, METRICS, COMPLETION]);
      for (const metricsTransaction of transactions.filter(transaction => transactionKind(transaction) === METRICS)) {
        expect(metricsTransaction.statements.map(statement => statement.kind)).toEqual([STATEMENT.SESSION_LOCK, STATEMENT.METRICS_DELETE]);
      }
    });

    it('a failing second window stops the sequence: no third window, no completion', async () => {
      const { error, transactions } = await runReplacement({
        measurementPages: [{ cursor: 'zero', rows: SHORT_WINDOW_ROWS }],
        legacy: 'missing',
        metrics: [W, W, METRICS_TAIL_ROWS],
        failOn: { kind: STATEMENT.METRICS_DELETE, occurrence: 2 }
      });
      expect(error).toBeInstanceOf(InjectedStatementFailure);
      const metricsTransactions = transactions.filter(transaction => transactionKind(transaction) === METRICS);
      expect(metricsTransactions.map(transaction => transaction.outcome)).toEqual(['committed', 'rolled_back']);
      expect(transactions.map(transactionKind)).not.toContain(COMPLETION);
    });
  });
});

describe('U9: staging refuses a clean re-upload whose census replacement is incomplete', () => {
  const STAGING_TRANSACTION_ID = 'staging-tx';
  const SOURCE_FORMAT_COLUMN_CHECK = /information_schema\.COLUMNS[\s\S]*SourceFormat/;
  const STAGING_INSERT = /INSERT IGNORE INTO\s+\S+\.temporarymeasurements/;
  const ANY_DELETE = /^\s*DELETE\b/i;

  function makeStagingConnectionManager(markerValue: string | null) {
    const issuedSQL: string[] = [];
    const executeQuery = async (sql: string) => {
      const statement = String(sql);
      issuedSQL.push(statement);
      if (SOURCE_FORMAT_COLUMN_CHECK.test(statement)) return [{ count: 1 }];
      if (CENSUS_REPLACEMENT_STATEMENT.MARKER_COLUMN_STATE.test(statement)) return [{ tableCount: 1, columnCount: 1 }];
      if (CENSUS_REPLACEMENT_STATEMENT.MARKER_PROBE.test(statement)) return [{ census_replacement_completed_at: markerValue }];
      if (CENSUS_REPLACEMENT_STATEMENT.FAMILY_PROBE.test(statement)) return [];
      throw new Error(`Staging reached a statement the guard should have prevented: ${statement.replace(/\s+/g, ' ').slice(0, 160)}`);
    };
    const connectionManager = { executeQuery, acquireApplicationLock: async () => true } as unknown as ConnectionManager;
    return { connectionManager, issuedSQL };
  }

  it.each([
    ['a session whose marker is unset', SESSION_ID],
    ['no upload session at all', null]
  ])(
    'a CLEAN first chunk with %s throws CensusReplacementIncompleteError before any INSERT or DELETE (catches: leaving the inline cleanup in staging; silently appending to the old census)',
    async (_label, uploadSessionID) => {
      const { connectionManager, issuedSQL } = makeStagingConnectionManager(null);
      let thrown: unknown;
      try {
        await stageMeasurementChunk(connectionManager, { ...replacementParams({ uploadSessionID }), transactionID: STAGING_TRANSACTION_ID });
      } catch (error) {
        thrown = error;
      }
      console.log(`[U9] session=${String(uploadSessionID)} threw=${thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown)}`);
      console.log(
        '[U9] statements issued',
        issuedSQL.map(sql => sql.replace(/\s+/g, ' ').slice(0, 100))
      );

      expect(thrown).toBeInstanceOf(CensusReplacementIncompleteError);
      const incomplete = thrown as CensusReplacementIncompleteError;
      expect([incomplete.fileName, incomplete.batchID, incomplete.uploadSessionID]).toEqual([FILE_NAME, BATCH_ID, uploadSessionID]);
      expect(issuedSQL.filter(sql => STAGING_INSERT.test(sql))).toEqual([]);
      expect(issuedSQL.filter(sql => ANY_DELETE.test(sql))).toEqual([]);
    }
  );
});

describe('CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS', () => {
  it('stays a quarter of the real reaper threshold (catches: one value changed without the other)', async () => {
    const { default: RealConnectionManager } = await vi.importActual<typeof import('@/lib/db/connectionmanager')>('@/lib/db/connectionmanager');
    console.log(
      `[timeout drift] callback deadline=${CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS}ms, headroom factor=${CENSUS_REPLACEMENT_REAPER_HEADROOM_FACTOR}, ` +
        `reaper threshold=${RealConnectionManager.DEFAULT_STALE_TRANSACTION_THRESHOLD_MS}ms`
    );
    expect(CENSUS_REPLACEMENT_TRANSACTION_TIMEOUT_MS * CENSUS_REPLACEMENT_REAPER_HEADROOM_FACTOR).toBe(
      RealConnectionManager.DEFAULT_STALE_TRANSACTION_THRESHOLD_MS
    );
  });
});
