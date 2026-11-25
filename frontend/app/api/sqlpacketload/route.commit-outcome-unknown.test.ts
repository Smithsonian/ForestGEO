import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { insertIngestionFailureRows } from '@/config/measurementerrors';
import { resetTemporaryMeasurementsSourceFormatColumnCacheForTests, TEMPORARY_MEASUREMENT_INSERT_COLUMNS } from '@/lib/ingestion/temporary-measurements';
import { resetUploadSessionReplacementMarkerCacheForTests } from '@/lib/uploads/upload-session-replacement-marker';
import { HTTPResponses } from '@/config/macros';
import { CENSUS_REPLACEMENT_STATEMENT } from '@/tests/setup/census-replacement-statement-patterns';
import { TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE, TransactionCommitOutcomeUnknownError } from '@/lib/db/transactionerrors';
import { parseUploadSessionConflict } from '@/components/uploadsystemhelpers/uploadsessionconflicts';
import { findRetryClassifierSubstrings } from '@/tests/setup/retry-classifier-substrings';

const { getCookieMock, authMock, handleUpsertMock } = vi.hoisted(() => ({
  getCookieMock: vi.fn(),
  authMock: vi.fn(),
  handleUpsertMock: vi.fn()
}));

const { requireUploadSessionOwnershipMock, MockUploadSessionOwnershipError } = vi.hoisted(() => {
  class MockUploadSessionOwnershipError extends Error {
    status: number;

    constructor(message: string, status: number = 409) {
      super(message);
      this.status = status;
    }
  }

  return {
    requireUploadSessionOwnershipMock: vi.fn(),
    MockUploadSessionOwnershipError
  };
});

vi.mock('@/lib/db/connectionmanager', () => {
  const executeQuery = vi.fn();
  const beginTransaction = vi.fn().mockResolvedValue('tx-test');
  const commitTransaction = vi.fn().mockResolvedValue(undefined);
  const rollbackTransaction = vi.fn().mockResolvedValue(undefined);
  const acquireApplicationLock = vi.fn().mockResolvedValue(true);
  let replacementTransactionCount = 0;
  const withTransaction = vi.fn(async (work: (tx: { id: string; query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<unknown>) => {
    replacementTransactionCount += 1;
    const id = `tx-replacement-${replacementTransactionCount}`;
    return work({ id, query: (sql, params) => executeQuery(sql, params, id) });
  });
  const instance = { executeQuery, beginTransaction, commitTransaction, rollbackTransaction, acquireApplicationLock, withTransaction };
  return {
    default: {
      getInstance: () => instance
    }
  };
});

vi.mock('@/app/actions/cookiemanager', () => ({
  getCookie: getCookieMock
}));

vi.mock('@/auth', () => ({
  auth: authMock
}));

vi.mock('@/config/utils', async importOriginal => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    generateShortBatchID: () => 'test-batch-id',
    handleUpsert: handleUpsertMock
  };
});

vi.mock('@/config/uploadsessiontracker', () => ({
  requireUploadSessionOwnership: requireUploadSessionOwnershipMock,
  UploadSessionOwnershipError: MockUploadSessionOwnershipError,
  UploadSessionState: {
    INITIALIZED: 'initialized',
    UPLOADING: 'uploading',
    UPLOADED: 'uploaded',
    PROCESSING: 'processing',
    COLLAPSING: 'collapsing',
    ABANDONED: 'abandoned'
  },
  ACTIVE_UPLOAD_SESSION_STATES: ['initialized', 'uploading', 'uploaded', 'processing', 'collapsing']
}));

vi.mock('@/config/measurementerrors', async importOriginal => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    insertIngestionFailureRows: vi.fn().mockResolvedValue([])
  };
});

vi.mock('@/components/processors/processorhelperfunctions', () => ({
  insertOrUpdate: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@/ailogger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('mysql2/promise', async importOriginal => {
  const actual = (await importOriginal()) as typeof import('mysql2/promise');
  // Use the REAL format(): it fills ?? and ? strictly left-to-right, each
  // placeholder consuming the next param regardless of type. An earlier
  // hand-rolled mock filled all ?? before any ?, which masked a production
  // placeholder-misfill bug in queries mixing ?? and ?. Do not re-fake this.
  return { format: actual.format };
});

/** Number of columns in the temporarymeasurements INSERT (FileID through PublishedStemID) */
const TEMP_MEASUREMENT_COLUMNS_PER_ROW = TEMPORARY_MEASUREMENT_INSERT_COLUMNS.length;
/** Position of the first staged row's BatchID among the INSERT params. */
const STAGED_BATCH_ID_PARAM_INDEX = TEMPORARY_MEASUREMENT_INSERT_COLUMNS.indexOf('BatchID');

const TEST_SESSION_ID = 'session-1';
const TEST_PLOT_ID = 22;
const TEST_CENSUS_ID = 32;
const TEST_BATCH_ID = 'batch-1';
const TEST_FILE_NAME = 'SERC_census1_2025.csv';
const SERVER_RESOLUTION_CSV_HEADERS = ['tag', 'stemtag', 'spcode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'];
const VALID_RAW_ROW = {
  tag: '100001',
  stemtag: '1',
  spcode: 'FAGR',
  quadrat: '1011',
  lx: '202',
  ly: '104.5',
  dbh: '3.5',
  hom: '1.30',
  date: '2010-03-17',
  codes: 'LI'
};
/** The per-chunk scope check: one sampled row of the batch family, never an aggregate over it. */
const FAMILY_SCOPE_SAMPLE_SQL = /SELECT PlotID AS plotID, CensusID AS censusID\s+FROM\s+\S*temporarymeasurements[\s\S]*LIMIT 1/;

interface FakeUploadSession {
  state: string;
  markerSetAt: string | null;
}
const CENSUS_REPLACEMENT_MARKER_TIMESTAMP = '2026-10-27 12:00:00';
const ABANDONED_SESSION_STATE = 'abandoned';
const STAGING_TRANSACTION_ID = 'tx-test';

function freshUploadSession(): FakeUploadSession {
  return { state: 'uploading', markerSetAt: null };
}

/** Answers the census replacement's session statements; returns undefined for anything else. */
function answerUploadSessionStatement(session: FakeUploadSession, sql: string): unknown {
  if (CENSUS_REPLACEMENT_STATEMENT.MARKER_COLUMN_STATE.test(sql)) return [{ tableCount: 1, columnCount: 1 }];
  if (CENSUS_REPLACEMENT_STATEMENT.SESSION_LOCK.test(sql))
    return [{ state: session.state, plot_id: TEST_PLOT_ID, census_id: TEST_CENSUS_ID, census_replacement_completed_at: session.markerSetAt }];
  if (CENSUS_REPLACEMENT_STATEMENT.MARKER_PROBE.test(sql)) return [{ census_replacement_completed_at: session.markerSetAt }];
  if (CENSUS_REPLACEMENT_STATEMENT.MARKER_UPDATE.test(sql)) {
    session.markerSetAt = CENSUS_REPLACEMENT_MARKER_TIMESTAMP;
    return { affectedRows: 1 };
  }
  return undefined;
}

function makeMeasurementRequest(overrides: Partial<Record<string, unknown>> = {}) {
  const body = {
    schema: 'forestgeo_testing',
    formType: 'measurements',
    fileName: TEST_FILE_NAME,
    plot: { plotID: TEST_PLOT_ID },
    census: { dateRanges: [{ censusID: TEST_CENSUS_ID }] },
    user: 'Test User',
    batchID: TEST_BATCH_ID,
    fileRowSet: {
      'row-1': {
        tag: '100001',
        stemtag: '1',
        spcode: 'FAGR',
        quadrat: '1011',
        lx: '202',
        ly: '104.5',
        dbh: '3.5',
        hom: '1.30',
        date: '2010-03-17',
        codes: 'LI',
        comments: ''
      }
    },
    ...overrides
  };

  const req = new Request('http://localhost/api/sqlpacketload', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-upload-session-id': TEST_SESSION_ID
    },
    body: JSON.stringify(body)
  }) as any;
  req.json = async () => body;
  req.nextUrl = new URL('http://localhost/api/sqlpacketload');
  return req;
}

function makeFixedDataRequest(
  formType: 'attributes' | 'quadrats' | 'personnel' | 'species',
  fileRowSet: Record<string, unknown>,
  overrides: Partial<Record<string, unknown>> = {}
) {
  const body = {
    schema: 'forestgeo_testing',
    formType,
    fileName: `${formType}.csv`,
    plot: { plotID: TEST_PLOT_ID },
    census: { dateRanges: [{ censusID: TEST_CENSUS_ID }] },
    user: 'Test User',
    fileRowSet,
    ...overrides
  };

  const req = new Request('http://localhost/api/sqlpacketload', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-upload-session-id': TEST_SESSION_ID
    },
    body: JSON.stringify(body)
  }) as any;
  req.json = async () => body;
  req.nextUrl = new URL('http://localhost/api/sqlpacketload');
  return req;
}

/**
 * formType values outside the attributes/quadrats/personnel/species allowlist
 * fall through to the generic per-row `insertOrUpdate` loop in route.ts's
 * fixed-data `else` branch (#507) rather than one of the dedicated
 * reference-data-writers. Named `coordinates` only as a plausible example —
 * insertOrUpdate itself is mocked, so this request never reaches real table
 * logic.
 */
function makeGenericFormTypeRequest(fileRowSet: Record<string, unknown>, overrides: Partial<Record<string, unknown>> = {}) {
  const body = {
    schema: 'forestgeo_testing',
    formType: 'coordinates',
    fileName: 'coordinates.csv',
    plot: { plotID: TEST_PLOT_ID },
    census: { dateRanges: [{ censusID: TEST_CENSUS_ID }] },
    user: 'Test User',
    fileRowSet,
    ...overrides
  };

  const req = new Request('http://localhost/api/sqlpacketload', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-upload-session-id': TEST_SESSION_ID
    },
    body: JSON.stringify(body)
  }) as any;
  req.json = async () => body;
  req.nextUrl = new URL('http://localhost/api/sqlpacketload');
  return req;
}

const PRIOR_CORE_MEASUREMENT_IDS_FOR_OVERFLOW_TEST = [501, 502];

/**
 * Primes the measurement-staging query mocks by STATEMENT rather than by call
 * order.
 *
 * The previous form was a fixed .mockResolvedValueOnce chain, which encoded the
 * exact number and sequence of queries the staging path happened to issue. Any
 * change to that pipeline — for instance clean re-upload dropping its
 * uploadmetrics enumeration query — shifted every later mock by one, handing
 * `undefined` to a downstream call and surfacing as an unrelated 500. Keying on
 * the SQL keeps these tests about the behaviour they name.
 */
function primeMeasurementQueries(manager: any, session: FakeUploadSession = freshUploadSession(), priorCoreMeasurementIDs: number[] = []): void {
  let priorIDsStillToServe = [...priorCoreMeasurementIDs];
  // insertedCount is the INSERT IGNORE affectedRows sum, so a staging INSERT
  // reports one affected row per VALUES tuple, as MySQL does when nothing is ignored.
  manager.executeQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    const text = String(sql);
    const sessionAnswer = answerUploadSessionStatement(session, text);
    if (sessionAnswer !== undefined) return sessionAnswer;
    if (CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_ID_SELECT.test(text)) {
      const servedIDs = priorIDsStillToServe;
      priorIDsStillToServe = [];
      return servedIDs.map(id => ({ CoreMeasurementID: id }));
    }
    if (CENSUS_REPLACEMENT_STATEMENT.DELETE_AUDIT.test(text) || CENSUS_REPLACEMENT_STATEMENT.MEASUREMENT_DELETE.test(text)) {
      return { affectedRows: priorCoreMeasurementIDs.length };
    }
    // Must stay before the broader includes('SELECT PlotID') branch, which would also match it.
    if (FAMILY_SCOPE_SAMPLE_SQL.test(text)) return [];
    if (text.includes('SELECT PlotID')) return [{ PlotID: TEST_PLOT_ID }];
    if (text.includes('COUNT(')) return [{ count: 0 }];
    if (text.trimStart().toUpperCase().startsWith('DELETE')) return { affectedRows: 0 };
    if (text.trimStart().toUpperCase().startsWith('INSERT')) {
      const stagedTupleCount = text.includes('temporarymeasurements') && Array.isArray(params) ? params.length / TEMP_MEASUREMENT_COLUMNS_PER_ROW : 1;
      return { affectedRows: stagedTupleCount, insertId: 1 };
    }
    return [];
  });
}

const INJECTED_COMMIT_DEADLINE_MS = 30_000;
const SPECIES_REVISION_ROW = { 'row-1': { spcode: 'swars1', species: 'simplex ochnacea' } };
const FIXED_DATA_TRANSACTION_ID = 'tx-fixed';

function unknownCommitOutcome(transactionID: string): TransactionCommitOutcomeUnknownError {
  const transportLoss = Object.assign(new Error('Connection lost: The server closed the connection.'), {
    code: 'PROTOCOL_CONNECTION_LOST',
    sqlMessage: undefined
  });
  return new TransactionCommitOutcomeUnknownError(transactionID, 'connection_lost', INJECTED_COMMIT_DEADLINE_MS, { cause: transportLoss });
}

/** Runs retry back-off timers at once so a (wrong) server-side retry shows up as extra calls instead of a slow test. */
function runRetryDelaysImmediately() {
  return vi.spyOn(global, 'setTimeout').mockImplementation((callback, _delay, ...args) => {
    if (typeof callback === 'function') callback(...args);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });
}

function expectTerminalConflictBody(body: Record<string, unknown>): void {
  const classifierMatches = findRetryClassifierSubstrings(JSON.stringify(body));
  console.log('[C2] response body:', body, 'classifier matches:', classifierMatches);
  expect(body.code).toBe(TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE);
  expect(typeof body.responseMessage).toBe('string');
  expect(parseUploadSessionConflict(body), 'must not be mistaken for an upload-session conflict').toBeNull();
  expect(classifierMatches, 'the client retries on these substrings').toEqual([]);
}

describe('sqlpacketload after an unknown COMMIT outcome (#563 §5.2, C2)', () => {
  let mockConnectionManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionManager = ConnectionManager.getInstance();
    vi.mocked(insertIngestionFailureRows).mockResolvedValue([]);
    handleUpsertMock.mockResolvedValue({ id: 1, operation: 'inserted' });
    authMock.mockResolvedValue({ user: { id: 'user-1', userStatus: 'global', sites: [] } });
    getCookieMock.mockResolvedValue(undefined);
    requireUploadSessionOwnershipMock.mockResolvedValue(undefined);
    resetTemporaryMeasurementsSourceFormatColumnCacheForTests();
    resetUploadSessionReplacementMarkerCacheForTests();
    mockConnectionManager.commitTransaction.mockResolvedValue(undefined);
    mockConnectionManager.rollbackTransaction.mockResolvedValue(undefined);
    mockConnectionManager.acquireApplicationLock.mockResolvedValue(true);
  });

  it('measurements: answers 409 with the code after ONE attempt; neither the server nor the browser retries it', async () => {
    const immediateTimers = runRetryDelaysImmediately();
    mockConnectionManager.beginTransaction.mockResolvedValue(STAGING_TRANSACTION_ID);
    primeMeasurementQueries(mockConnectionManager);
    mockConnectionManager.commitTransaction.mockRejectedValueOnce(unknownCommitOutcome(STAGING_TRANSACTION_ID));

    const res = (await POST(makeMeasurementRequest()))!;
    const body = await res.json();
    immediateTimers.mockRestore();

    expect(res.status, 'a 5xx is retried by the browser (uploadfiresql.tsx:651-653)').toBe(HTTPResponses.CONFLICT);
    expectTerminalConflictBody(body);
    expect(body.fileName).toBe(TEST_FILE_NAME);
    expect(body.batchID).toBe(TEST_BATCH_ID);
    expect(mockConnectionManager.beginTransaction, 'staging a chunk is not idempotent: no server-side replay').toHaveBeenCalledTimes(1);
  });

  it('fixed-data: answers 409 with the code after ONE attempt (no batchID exists in this branch)', async () => {
    const immediateTimers = runRetryDelaysImmediately();
    mockConnectionManager.beginTransaction.mockResolvedValue(FIXED_DATA_TRANSACTION_ID);
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ SpeciesID: 11 }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 5 });
    mockConnectionManager.commitTransaction.mockRejectedValueOnce(unknownCommitOutcome(FIXED_DATA_TRANSACTION_ID));

    const res = (await POST(makeFixedDataRequest('species', SPECIES_REVISION_ROW, { uploadMode: 'revisions' })))!;
    const body = await res.json();
    immediateTimers.mockRestore();

    expect(res.status).toBe(HTTPResponses.CONFLICT);
    expectTerminalConflictBody(body);
    expect(body.fileName).toBe('species.csv');
    expect(mockConnectionManager.beginTransaction).toHaveBeenCalledTimes(1);
  });
});
