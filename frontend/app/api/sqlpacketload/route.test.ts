import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import ConnectionManager from '@/lib/db/connectionmanager';
import { insertIngestionFailureRows } from '@/config/measurementerrors';
import { resetTemporaryMeasurementsSourceFormatColumnCacheForTests, TEMP_MEASUREMENT_INSERT_BATCH_SIZE } from '@/lib/ingestion/temporary-measurements';
import { SourceFormat } from '@/config/macros/formdetails';
import { headerSignature } from '@/lib/column-mapping/mapping';
import type { ColumnMapping } from '@/lib/column-mapping/types';
import { MAX_GENERATED_QUADRATS } from '@/lib/provisioning/grid-generator';
import ailogger from '@/ailogger';
import {
  buildQuadratOverlapAcknowledgment,
  QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT,
  validateQuadratCollectionDetailed
} from '@/lib/provisioning/quadrat-collection-validation';

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
  const instance = { executeQuery, beginTransaction, commitTransaction, rollbackTransaction };
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
    UPLOADING: 'uploading'
  }
}));

vi.mock('@/config/measurementerrors', () => ({
  insertIngestionFailureRows: vi.fn().mockResolvedValue([])
}));

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
const TEMP_MEASUREMENT_COLUMNS_PER_ROW = 18;

const TEST_SESSION_ID = 'session-1';
const TEST_PLOT_ID = 22;
const TEST_CENSUS_ID = 32;
const TEST_BATCH_ID = 'batch-1';
const TEST_FILE_NAME = 'SERC_census1_2025.csv';

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
function primeMeasurementQueries(manager: any, options: { stagedRowsAfterInsert?: number } = {}): void {
  // insertedCount is measured as the staged-row delta across the INSERT(s).
  // stagedRowsAfterInsert lets a chunk-splitting test declare the post-insert
  // total without depending on how many INSERT statements it was split into.
  const stagedRowsAfterInsert = options.stagedRowsAfterInsert ?? 1;
  let insertSeen = false;
  manager.executeQuery.mockImplementation(async (sql: string) => {
    const text = String(sql);
    if (text.includes('SELECT PlotID')) return [{ PlotID: TEST_PLOT_ID }];
    if (text.includes('distinctPlotCount')) return [{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }];
    if (text.includes('COUNT(') && text.includes('temporarymeasurements')) return [{ count: insertSeen ? stagedRowsAfterInsert : 0 }];
    if (text.includes('COUNT(')) return [{ count: 0 }];
    if (text.trimStart().toUpperCase().startsWith('DELETE')) return { affectedRows: 0 };
    if (text.trimStart().toUpperCase().startsWith('INSERT')) {
      if (text.includes('temporarymeasurements')) insertSeen = true;
      return { affectedRows: 1, insertId: 1 };
    }
    return [];
  });
}

describe('sqlpacketload measurement scope validation', () => {
  let mockConnectionManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionManager = ConnectionManager.getInstance();
    vi.mocked(insertIngestionFailureRows).mockResolvedValue([]);
    handleUpsertMock.mockResolvedValue({ id: 1, operation: 'inserted' });
    // Phase-3 inline membership guard (assertSchemaAccess) now runs after auth();
    // a 'global' admin session clears it so these behavioral tests reach the handler body.
    authMock.mockResolvedValue({ user: { id: 'user-1', userStatus: 'global', sites: [] } });
    getCookieMock.mockResolvedValue(undefined);
    requireUploadSessionOwnershipMock.mockResolvedValue(undefined);
    resetTemporaryMeasurementsSourceFormatColumnCacheForTests();
    mockConnectionManager.beginTransaction.mockResolvedValue('tx-test');
    mockConnectionManager.commitTransaction.mockResolvedValue(undefined);
    mockConnectionManager.rollbackTransaction.mockResolvedValue(undefined);
  });

  it('rejects invalid sourceFormat before touching measurement scope data', async () => {
    const res = (await POST(makeMeasurementRequest({ sourceFormat: 'spoofed_arcgis' })))!;

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'sourceFormat must be csv'
    });
    expect(mockConnectionManager.executeQuery).not.toHaveBeenCalled();
    expect(requireUploadSessionOwnershipMock).not.toHaveBeenCalled();
  });

  it('rejects arcgis_xlsx sourceFormat for measurement uploads (route is csv-only)', async () => {
    const res = (await POST(makeMeasurementRequest({ sourceFormat: 'arcgis_xlsx' })))!;

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'sourceFormat must be csv'
    });
    expect(mockConnectionManager.executeQuery).not.toHaveBeenCalled();
    expect(requireUploadSessionOwnershipMock).not.toHaveBeenCalled();
  });

  it('prefers request body over mismatched cookies', async () => {
    getCookieMock.mockImplementation(async (name: string) => {
      if (name === 'plotID') return String(TEST_PLOT_ID);
      if (name === 'censusID') return '99';
      return undefined;
    });

    primeMeasurementQueries(mockConnectionManager);

    const res = (await POST(makeMeasurementRequest()))!;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insertedCount).toBe(1);

    const insertCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('INSERT IGNORE INTO `forestgeo_testing`.temporarymeasurements')
    );
    expect(insertCall[1].slice(0, 6)).toEqual([TEST_FILE_NAME, TEST_BATCH_ID, TEST_SESSION_ID, 'csv', TEST_PLOT_ID, TEST_CENSUS_ID]);
  });

  it('rejects when census does not belong to the provided plot', async () => {
    mockConnectionManager.executeQuery.mockResolvedValueOnce([{ PlotID: 99 }]);

    const res = (await POST(makeMeasurementRequest()))!;

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/does not belong to the provided plotID/i);
    expect(mockConnectionManager.beginTransaction).not.toHaveBeenCalled();
  });

  it('rejects when an existing batch already has a different census scope', async () => {
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ PlotID: TEST_PLOT_ID }])
      .mockResolvedValueOnce([{ distinctPlotCount: 1, distinctCensusCount: 1, plotID: TEST_PLOT_ID, censusID: 99 }]);

    const res = (await POST(makeMeasurementRequest()))!;

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Existing batch scope does not match incoming plot\/census/i);
    expect(mockConnectionManager.beginTransaction).not.toHaveBeenCalled();
  });

  it('accepts valid scope and inserts temporary rows using the resolved plot/census IDs', async () => {
    primeMeasurementQueries(mockConnectionManager);

    const res = (await POST(makeMeasurementRequest()))!;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insertedCount).toBe(1);

    const insertCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('INSERT IGNORE INTO `forestgeo_testing`.temporarymeasurements')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1].slice(0, 6)).toEqual([TEST_FILE_NAME, TEST_BATCH_ID, TEST_SESSION_ID, 'csv', TEST_PLOT_ID, TEST_CENSUS_ID]);
  });

  it('rejects measurement uploads when the upload session does not own the scope', async () => {
    requireUploadSessionOwnershipMock.mockRejectedValueOnce(new MockUploadSessionOwnershipError('Upload session expired before measurement chunk upload', 409));

    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ PlotID: TEST_PLOT_ID }])
      .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }]);

    const res = (await POST(makeMeasurementRequest()))!;

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Upload session expired before measurement chunk upload',
      fileName: TEST_FILE_NAME,
      batchID: TEST_BATCH_ID
    });
  });

  it('splits large measurement chunks into multiple temporarymeasurements inserts', async () => {
    const largeRowSet = Object.fromEntries(
      Array.from({ length: 1001 }, (_, idx) => [
        `row-${idx + 1}`,
        {
          tag: String(100000 + idx),
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
      ])
    );

    primeMeasurementQueries(mockConnectionManager, { stagedRowsAfterInsert: 1001 });

    const res = (await POST(makeMeasurementRequest({ fileRowSet: largeRowSet })))!;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insertedCount).toBe(1001);

    const insertCalls = mockConnectionManager.executeQuery.mock.calls.filter((call: any[]) =>
      String(call[0]).includes('INSERT IGNORE INTO `forestgeo_testing`.temporarymeasurements')
    );
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0][1]).toHaveLength(TEMP_MEASUREMENT_INSERT_BATCH_SIZE * TEMP_MEASUREMENT_COLUMNS_PER_ROW);
    expect(insertCalls[1][1]).toHaveLength(TEMP_MEASUREMENT_COLUMNS_PER_ROW);
  });

  it('cleans up stale temporarymeasurements rows from older batches before starting a new batch', async () => {
    primeMeasurementQueries(mockConnectionManager);

    const res = (await POST(makeMeasurementRequest()))!;

    expect(res.status).toBe(200);

    const cleanupCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('DELETE FROM `forestgeo_testing`.temporarymeasurements')
    );
    expect(cleanupCall).toBeDefined();
    expect(cleanupCall[1]).toEqual([TEST_FILE_NAME, TEST_PLOT_ID, TEST_CENSUS_ID, TEST_BATCH_ID]);
  });

  it('cleans up previous census upload data by census scope, not by filename or uploadmetrics', async () => {
    primeMeasurementQueries(mockConnectionManager);

    const res = (await POST(makeMeasurementRequest()))!;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insertedCount).toBe(1);
    expect(mockConnectionManager.commitTransaction).toHaveBeenCalledWith('tx-test');

    const executedSql = mockConnectionManager.executeQuery.mock.calls.map((call: any[]) => String(call[0]));

    // The cleanup must NOT enumerate victims from uploadmetrics. A sub-batch
    // whose ingestion died before the procedure wrote its metric row has no
    // entry there, so a metrics-driven list silently under-deletes (measured on
    // live forestgeo_harvard: 96,227 of 106,227 rows stranded).
    expect(executedSql.some((sql: string) => sql.includes('SELECT batchID FROM `forestgeo_testing`.uploadmetrics'))).toBe(false);

    const deleteCmCall = executedSql.find((sql: string) => sql.includes('DELETE FROM `forestgeo_testing`.coremeasurements'));
    expect(deleteCmCall).toBeDefined();
    // Scoped to the census, excluding the incoming batch FAMILY.
    expect(deleteCmCall).toContain('WHERE CensusID = ?');
    expect(deleteCmCall).toContain('NOT (UploadBatchID <=> ?)');
    // Both arms NULL-safe: a bare `NOT (col LIKE ?)` yields NULL for the
    // nullable UploadBatchID, which would spare every CTFS-migrated row.
    expect(deleteCmCall).toContain('(UploadBatchID IS NULL OR UploadBatchID NOT LIKE ?');
    // Bounded so one statement never locks a whole 100k-row census.
    expect(deleteCmCall).toContain('LIMIT');
    // Census replacement, not filename replacement.
    expect(deleteCmCall).not.toContain('UploadFileID');
    // And never a batch id list sourced from metrics.
    expect(deleteCmCall).not.toContain('UploadBatchID IN');

    const deleteValidationErrorsCall = executedSql.find((sql: string) => sql.includes('DELETE FROM `forestgeo_testing`.measurement_error_log'));
    expect(deleteValidationErrorsCall).toBeDefined();
    expect(deleteValidationErrorsCall).toContain('WHERE cm.CensusID = ?');
    expect(deleteValidationErrorsCall).not.toContain('cm.UploadFileID');
    // Single-table DELETE over a subquery: MySQL rejects LIMIT on a
    // multi-table DELETE ... JOIN, and this delete must stay bounded too.
    expect(deleteValidationErrorsCall).toContain('LIMIT');

    const deleteMetricsCall = executedSql.find((sql: string) => sql.includes('DELETE FROM `forestgeo_testing`.uploadmetrics'));
    expect(deleteMetricsCall).toBeDefined();
    expect(deleteMetricsCall).toContain('WHERE plotID = ? AND censusID = ?');
    expect(deleteMetricsCall).toContain('NOT (batchID <=> ?)');

    const deleteFailedCall = executedSql.find((sql: string) => sql.includes('DELETE FROM `forestgeo_testing`.failedmeasurements'));
    expect(deleteFailedCall).toBeDefined();
    expect(deleteFailedCall).toContain('WHERE CensusID = ?');
  });

  it('skips previous-upload cleanup for measurement revisions uploads', async () => {
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ PlotID: TEST_PLOT_ID }])
      .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    const res = (await POST(makeMeasurementRequest({ uploadMode: 'revisions' })))!;

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      uploadMode: 'revisions',
      insertedCount: 1
    });

    const cleanupCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('DELETE FROM `forestgeo_testing`.coremeasurements')
    );
    expect(cleanupCall).toBeUndefined();

    const staleBatchCleanupCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('DELETE FROM `forestgeo_testing`.temporarymeasurements')
    );
    expect(staleBatchCleanupCall).toBeDefined();
  });

  it('falls back past missing legacy cleanup tables during re-upload', async () => {
    const missingError: NodeJS.ErrnoException & { code?: string } = new Error("Table 'forestgeo_testing.measurement_error_log' doesn't exist");
    (missingError as any).code = 'ER_NO_SUCH_TABLE';

    // Statement-driven: the unified error-log delete fails as missing, and the
    // route must fall back to the legacy cmverrors delete rather than 500.
    let stagedRowCount = 0;
    mockConnectionManager.executeQuery.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes('DELETE FROM') && text.includes('measurement_error_log')) throw missingError;
      if (text.includes('SELECT PlotID')) return [{ PlotID: TEST_PLOT_ID }];
      if (text.includes('distinctPlotCount')) return [{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }];
      if (text.includes('COUNT(') && text.includes('temporarymeasurements')) return [{ count: stagedRowCount }];
      if (text.includes('COUNT(')) return [{ count: 0 }];
      if (text.trimStart().toUpperCase().startsWith('DELETE')) return { affectedRows: 1 };
      if (text.trimStart().toUpperCase().startsWith('INSERT')) {
        if (text.includes('temporarymeasurements')) stagedRowCount += 1;
        return { affectedRows: 1, insertId: 1 };
      }
      return [];
    });

    const res = (await POST(makeMeasurementRequest()))!;

    expect(res.status).toBe(200);
    const executedSql = mockConnectionManager.executeQuery.mock.calls.map((call: any[]) => String(call[0]));
    const legacyCall = executedSql.find((sql: string) => sql.includes('DELETE FROM `forestgeo_testing`.cmverrors'));
    expect(legacyCall).toBeDefined();
    expect(legacyCall).toContain('WHERE cm.CensusID = ?');
  });

  it('logs dropped-row alert metadata with a bounded uploadId when unresolved-ingestion persistence fails twice', async () => {
    const twoRowSet = {
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
      },
      'row-2': {
        tag: '100002',
        stemtag: '1',
        spcode: 'FAGR',
        quadrat: '1011',
        lx: '203',
        ly: '105.5',
        dbh: '4.5',
        hom: '1.40',
        date: '2010-03-17',
        codes: 'LI',
        comments: ''
      }
    };

    vi.mocked(insertIngestionFailureRows)
      .mockRejectedValueOnce(new Error('first persistence failure'))
      .mockRejectedValueOnce(new Error('second persistence failure'));

    // Statement-driven, plus the dropped-row candidate the scenario needs.
    let insertSeen = false;
    mockConnectionManager.executeQuery.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes('SELECT PlotID')) return [{ PlotID: TEST_PLOT_ID }];
      if (text.includes('distinctPlotCount')) return [{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }];
      if (text.includes('dropped_row_candidates') && text.trimStart().toUpperCase().startsWith('SELECT')) {
        return [{ rowOrdinal: 2, existingBatch: null }];
      }
      if (text.includes('COUNT(') && text.includes('temporarymeasurements')) return [{ count: insertSeen ? 1 : 0 }];
      if (text.includes('COUNT(')) return [{ count: 0 }];
      if (text.trimStart().toUpperCase().startsWith('DELETE')) return { affectedRows: 0 };
      if (text.trimStart().toUpperCase().startsWith('INSERT')) {
        if (text.includes('temporarymeasurements')) insertSeen = true;
        return { affectedRows: 1, insertId: 1 };
      }
      return [];
    });

    const res = (await POST(makeMeasurementRequest({ fileRowSet: twoRowSet })))!;

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      insertedCount: 1,
      droppedCount: 1,
      dataIntegrityWarning: true
    });

    const alertCall = mockConnectionManager.executeQuery.mock.calls.find(
      (call: any[]) =>
        String(call[0]).includes('INSERT INTO `forestgeo_testing`.uploadintegrityalerts') &&
        String(call[0]).includes('FAILED_INSERT_TO_UNRESOLVED_COREMEASUREMENTS')
    );

    expect(alertCall).toBeDefined();
    expect(String(alertCall[0])).toContain('uploadId, fileID, batchID, plotID, censusID');
    expect(String(alertCall[0])).toContain('sourceRecords, processedRecords, failedRecords, missingRecords');
    expect(alertCall[1]).toHaveLength(10);
    expect(alertCall[1][0]).toMatch(/^[a-f0-9]{40}$/);
    expect(alertCall[1].slice(1, 5)).toEqual([TEST_FILE_NAME, TEST_BATCH_ID, TEST_PLOT_ID, TEST_CENSUS_ID]);
    expect(alertCall[1][6]).toBe(2);
    expect(alertCall[1][7]).toBe(1);
    expect(alertCall[1][8]).toBe(1);
    expect(alertCall[1][9]).toBe(0);
  });
});

describe('sqlpacketload fixed-data upload modes', () => {
  let mockConnectionManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionManager = ConnectionManager.getInstance();
    // Phase-3 inline membership guard (assertSchemaAccess) now runs after auth();
    // a 'global' admin session clears it so these behavioral tests reach the handler body.
    authMock.mockResolvedValue({ user: { id: 'user-1', userStatus: 'global', sites: [] } });
    resetTemporaryMeasurementsSourceFormatColumnCacheForTests();
    mockConnectionManager.beginTransaction.mockResolvedValue('tx-fixed');
    mockConnectionManager.commitTransaction.mockResolvedValue(undefined);
    mockConnectionManager.rollbackTransaction.mockResolvedValue(undefined);
    handleUpsertMock.mockResolvedValue({ id: 1, operation: 'inserted' });
  });

  it('rejects arcgis_xlsx sourceFormat for fixed-data uploads (route is csv-only)', async () => {
    const res = await POST(
      makeFixedDataRequest(
        'attributes',
        {
          'row-1': { code: 'alive', description: 'Alive', status: 'alive' }
        },
        { sourceFormat: 'arcgis_xlsx' }
      )
    );

    expect(res?.status).toBe(400);
    await expect(res?.json()).resolves.toMatchObject({
      error: 'sourceFormat must be csv'
    });
    expect(mockConnectionManager.executeQuery).not.toHaveBeenCalled();
  });

  it('rejects an unknown upload mode instead of silently falling back to destructive clean re-upload', async () => {
    const res = await POST(
      makeFixedDataRequest(
        'quadrats',
        {
          'row-1': { quadrat: 'Q01', startx: 0, starty: 0, dimx: 20, dimy: 20 }
        },
        { uploadMode: 'revision' }
      )
    );

    expect(res?.status).toBe(400);
    await expect(res?.json()).resolves.toMatchObject({ code: 'INVALID_UPLOAD_MODE' });
    expect(mockConnectionManager.beginTransaction).not.toHaveBeenCalled();
    expect(mockConnectionManager.executeQuery).not.toHaveBeenCalled();
  });

  it('re-runs the chunk instead of phantom-committing when the changelog write deadlocks', async () => {
    // The changelog shares the data transaction. A deadlock on the changelog statement rolls
    // the WHOLE transaction back server-side; if it were swallowed like a benign logging
    // failure, the commit would no-op "succeed" and the response would claim 200 while the
    // chunk's data rows were silently lost. It must instead propagate into the retry loop.
    let changelogInsertAttempts = 0;
    mockConnectionManager.executeQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('unifiedchangelog')) {
        if (text.includes('INSERT INTO')) {
          changelogInsertAttempts += 1;
          if (changelogInsertAttempts === 1) {
            throw new Error('Deadlock found when trying to get lock; try restarting transaction');
          }
          return { insertId: 9 };
        }
        return []; // changelog lookup: no existing file_upload entry
      }
      if (text.startsWith('SELECT')) return []; // no existing attribute rows
      return { insertId: 1 };
    });

    const res = await POST(
      makeFixedDataRequest('attributes', { 'row-1': { code: 'alive', description: 'Alive', status: 'alive' } }, { uploadMode: 'revisions' })
    );

    expect(res?.status).toBe(200);
    expect(changelogInsertAttempts, 'the chunk must have been retried after the deadlock').toBe(2);
    // The deadlocked attempt was rolled back -- never committed as an empty shell.
    expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(mockConnectionManager.beginTransaction).toHaveBeenCalledTimes(2);
    expect(mockConnectionManager.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('updates existing attributes and inserts new codes in revisions mode', async () => {
    mockConnectionManager.executeQuery
      // Row 1: SELECT existing (case-insensitive match found)
      .mockResolvedValueOnce([{ Code: 'EXISTING' }])
      // Row 1: UPDATE existing row
      .mockResolvedValueOnce({ affectedRows: 1 })
      // Row 2: SELECT existing (no match)
      .mockResolvedValueOnce([])
      // Row 2: INSERT new row
      .mockResolvedValueOnce({ insertId: 9 })
      // changelog: SELECT existing entry
      .mockResolvedValueOnce([])
      // changelog: INSERT new entry
      .mockResolvedValueOnce({ insertId: 10 });

    const res = await POST(
      makeFixedDataRequest(
        'attributes',
        {
          'row-1': { code: 'EXISTING', description: 'Updated description', status: 'alive' },
          'row-2': { code: 'NEWCODE', description: 'Brand new code', status: 'dead' }
        },
        { uploadMode: 'revisions' }
      )
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toMatchObject({
      uploadMode: 'revisions',
      insertedCount: 1,
      updatedCount: 1,
      skippedCount: 0,
      transactionCompleted: true
    });
  });

  it('deletes existing personnel and inserts fresh in clean re-upload mode', async () => {
    handleUpsertMock.mockResolvedValueOnce({ id: 77, operation: 'inserted' });
    mockConnectionManager.executeQuery
      // DELETE censusactivepersonnel for this census
      .mockResolvedValueOnce({ affectedRows: 2 })
      // DELETE orphaned personnel
      .mockResolvedValueOnce({ affectedRows: 1 })
      // INSERT new personnel row
      .mockResolvedValueOnce({ insertId: 501 })
      // INSERT IGNORE censusactivepersonnel link
      .mockResolvedValueOnce({ affectedRows: 1 })
      // changelog: SELECT existing entry
      .mockResolvedValueOnce([])
      // changelog: INSERT new entry
      .mockResolvedValueOnce({ insertId: 3 });

    const res = await POST(
      makeFixedDataRequest(
        'personnel',
        {
          'row-1': { firstname: 'Ada', lastname: 'Lovelace', role: 'Lead Tech', roledescription: 'Lead technician' }
        },
        { uploadMode: 'clean_reupload' }
      )
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toMatchObject({
      uploadMode: 'clean_reupload',
      insertedCount: 1,
      updatedCount: 0,
      skippedCount: 0,
      transactionCompleted: true
    });

    // Verify the DELETE happened before the INSERT
    const deleteCalls = mockConnectionManager.executeQuery.mock.calls.filter((call: any[]) =>
      String(call[0]).includes('DELETE FROM `forestgeo_testing`.censusactivepersonnel')
    );
    expect(deleteCalls.length).toBeGreaterThan(0);

    expect(mockConnectionManager.executeQuery.mock.calls.some((call: any[]) => String(call[0]).includes('INSERT INTO `forestgeo_testing`.personnel'))).toBe(
      true
    );
  });

  it('normalizes camelCase personnel roles before upserting', async () => {
    handleUpsertMock.mockResolvedValueOnce({ id: 77, operation: 'inserted' });
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 501 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 3 });

    const res = await POST(
      makeFixedDataRequest(
        'personnel',
        {
          'row-1': { firstname: 'Ada', lastname: 'Lovelace', role: 'LeadTech', roledescription: 'Lead technician' }
        },
        { uploadMode: 'clean_reupload' }
      )
    );

    expect(res?.status).toBe(200);
    expect(handleUpsertMock).toHaveBeenCalledWith(
      mockConnectionManager,
      'forestgeo_testing',
      'roles',
      { RoleName: 'lead tech', RoleDescription: 'Lead technician' },
      'RoleID',
      'tx-fixed'
    );
  });

  it('rejects duplicate SpeciesCode values within a species upload file', async () => {
    const res = await POST(
      makeFixedDataRequest(
        'species',
        {
          'row-1': { spcode: 'swars1', species: 'simplex ochnacea' },
          'row-2': { spcode: 'SWARS1', species: 'swarzia simplex' }
        },
        { uploadMode: 'clean_reupload' }
      )
    );

    expect(res?.status).toBe(503);
    await expect(res?.json()).resolves.toMatchObject({
      error: 'Species upload contains duplicate SpeciesCode values: swars1'
    });
    expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalledWith('tx-fixed');
    expect(mockConnectionManager.executeQuery).not.toHaveBeenCalled();
  });

  it('refuses species clean re-upload when active species rows are already referenced', async () => {
    // The dependency lookup is the FIRST executeQuery call in the species CLEAN_REUPLOAD
    // path, returning every active SpeciesCode that is already referenced by trees or
    // species limits. Once a SpeciesID is in use, deleting the active species list would
    // still cascade-delete dependent data even if the upload includes the same code again.
    mockConnectionManager.executeQuery.mockResolvedValueOnce([{ SpeciesCode: 'querc1' }, { SpeciesCode: 'fagr2' }]);

    const res = await POST(
      makeFixedDataRequest(
        'species',
        {
          'row-1': { spcode: 'querc1', species: 'alba' },
          'row-2': { spcode: 'fagr2', species: 'grandifolia' }
        },
        { uploadMode: 'clean_reupload' }
      )
    );

    expect(res?.status).toBe(503);
    const body = await res?.json();
    expect(body.error).toContain('Clean re-upload refused');
    expect(body.error).toContain('querc1');
    expect(body.error).toContain('fagr2');
    expect(body.error).toContain('same codes appear in the upload');
    expect(body.error).toContain('Use Revisions Upload instead');
    expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalledWith('tx-fixed');
    // The DELETE FROM species must NOT have run. The precheck itself should mention
    // both trees and specieslimits in the dependency SQL so this guard covers every
    // current ON DELETE CASCADE path hanging off species.
    const deleteCalls = mockConnectionManager.executeQuery.mock.calls.filter((call: any[]) =>
      String(call[0]).includes('DELETE FROM `forestgeo_testing`.species')
    );
    expect(deleteCalls.length).toBe(0);
    expect(String(mockConnectionManager.executeQuery.mock.calls[0]?.[0])).toContain('specieslimits');
  });

  it('allows species clean re-upload on a fresh site with no dependent references', async () => {
    // No trees or species limits reference the current active species rows, so the
    // wipe-and-reload remains safe.
    mockConnectionManager.executeQuery
      // 1: dependency precheck returns nothing
      .mockResolvedValueOnce([])
      // 2: DELETE FROM species
      .mockResolvedValueOnce({ affectedRows: 0 })
      // 3: INSERT new species
      .mockResolvedValueOnce({ insertId: 1 });

    const res = await POST(
      makeFixedDataRequest(
        'species',
        {
          'row-1': { spcode: 'newspc', species: 'novel' }
        },
        { uploadMode: 'clean_reupload' }
      )
    );

    expect(res?.status).toBe(200);
    expect(String(mockConnectionManager.executeQuery.mock.calls[0]?.[0])).toContain('specieslimits');
    // Positive anchor for the refusal test's zero-DELETE filter above: the wipe
    // must run here with exactly this SQL text, so a quoting change that would
    // make the negative filter vacuous fails loudly instead.
    const speciesDeleteCalls = mockConnectionManager.executeQuery.mock.calls.filter((call: any[]) =>
      String(call[0]).includes('DELETE FROM `forestgeo_testing`.species')
    );
    expect(speciesDeleteCalls.length).toBe(1);
  });

  it('refuses quadrat clean re-upload when active quadrats are already referenced by stems', async () => {
    mockConnectionManager.executeQuery
      // 1: authoritative plot bounds lookup
      .mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }])
      // 2: stem-safety blocking query
      .mockResolvedValueOnce([
        { QuadratID: 11, QuadratName: '1011' },
        { QuadratID: 12, QuadratName: '1012' }
      ]);

    const res = await POST(
      makeFixedDataRequest(
        'quadrats',
        {
          'row-1': { quadrat: '1011', startx: 0, starty: 0, dimx: 20, dimy: 20 }
        },
        { uploadMode: 'clean_reupload' }
      )
    );

    expect(res?.status).toBe(503);
    const body = await res?.json();
    expect(body.error).toContain('Clean re-upload refused');
    expect(body.error).toContain('1011');
    expect(body.error).toContain('1012');
    expect(body.error).toContain('stems and downstream measurements');
    expect(body.error).toContain('Use Revisions Upload instead');
    const guardSQL = String(mockConnectionManager.executeQuery.mock.calls[1]?.[0]);
    expect(guardSQL).toContain('FROM `forestgeo_testing`.stems');
    // Soft-deleted stems must not block the wipe; only live stems count.
    expect(guardSQL).toContain('s.IsActive = 1');
    // NULL-named quadrats still cascade stems away, so the guard must not
    // exclude them at the SQL level.
    expect(guardSQL).not.toContain('QuadratName IS NOT NULL');
    const deleteCalls = mockConnectionManager.executeQuery.mock.calls.filter((call: any[]) =>
      String(call[0]).includes('DELETE FROM `forestgeo_testing`.quadrats')
    );
    expect(deleteCalls.length).toBe(0);
  });

  it('refuses quadrat clean re-upload even when the blocking quadrat has a whitespace-only name', async () => {
    // Regression: the guard previously trimmed and filtered out blank names
    // before deciding whether to refuse, so a stem-referenced quadrat named
    // ' ' slipped past the check and the DELETE cascade destroyed its stems.
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }])
      .mockResolvedValueOnce([{ QuadratID: 42, QuadratName: '   ' }]);

    const res = await POST(
      makeFixedDataRequest(
        'quadrats',
        {
          'row-1': { quadrat: '1011', startx: 0, starty: 0, dimx: 20, dimy: 20 }
        },
        { uploadMode: 'clean_reupload' }
      )
    );

    expect(res?.status).toBe(503);
    const body = await res?.json();
    expect(body.error).toContain('Clean re-upload refused');
    expect(body.error).toContain('(unnamed QuadratID 42)');
    const deleteCalls = mockConnectionManager.executeQuery.mock.calls.filter((call: any[]) =>
      String(call[0]).includes('DELETE FROM `forestgeo_testing`.quadrats')
    );
    expect(deleteCalls.length).toBe(0);
  });

  it('allows quadrat clean re-upload when the plot has no stems on active quadrats', async () => {
    mockConnectionManager.executeQuery
      // 1: authoritative plot bounds lookup
      .mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }])
      // 2: dependency precheck returns nothing
      .mockResolvedValueOnce([])
      // 3: DELETE FROM quadrats
      .mockResolvedValueOnce({ affectedRows: 0 })
      // 4: INSERT new quadrat
      .mockResolvedValueOnce({ insertId: 1 });

    const res = await POST(
      makeFixedDataRequest(
        'quadrats',
        {
          'row-1': { quadrat: '1011', startx: 0, starty: 0, dimx: 20, dimy: 20 }
        },
        { uploadMode: 'clean_reupload' }
      )
    );

    expect(res?.status).toBe(200);
    expect(String(mockConnectionManager.executeQuery.mock.calls[1]?.[0])).toContain('FROM `forestgeo_testing`.stems');
    // Positive anchor for the refusal test's zero-DELETE filter above: the wipe
    // must run here with exactly this SQL text, so a quoting change that would
    // make the negative filter vacuous fails loudly instead.
    const quadratDeleteCalls = mockConnectionManager.executeQuery.mock.calls.filter((call: any[]) =>
      String(call[0]).includes('DELETE FROM `forestgeo_testing`.quadrats')
    );
    expect(quadratDeleteCalls.length).toBe(1);
  });

  it('allows a revisions upload to add a new quadrat to a real layout', async () => {
    mockConnectionManager.executeQuery
      // 1: authoritative plot bounds lookup
      .mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }])
      // 2: existing active quadrats (geometry) -- also feeds the divergent-placeholder guard.
      // Real (non-placeholder) names, non-overlapping with the incoming E01 row.
      .mockResolvedValueOnce([
        { QuadratName: 'C01', StartX: 0, StartY: 0, DimensionX: 20, DimensionY: 20 },
        { QuadratName: 'D01', StartX: 20, StartY: 0, DimensionX: 20, DimensionY: 20 }
      ])
      // 3: the incoming quadrat does not exist yet
      .mockResolvedValueOnce([])
      // 4: INSERT new quadrat
      .mockResolvedValueOnce({ insertId: 3 })
      // 5: changelog lookup
      .mockResolvedValueOnce([])
      // 6: changelog insert
      .mockResolvedValueOnce({ insertId: 4 });

    const res = await POST(
      makeFixedDataRequest(
        'quadrats',
        {
          'row-1': { quadrat: 'E01', startx: 40, starty: 0, dimx: 20, dimy: 20, area: 400 }
        },
        { uploadMode: 'revisions' }
      )
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toMatchObject({
      uploadMode: 'revisions',
      insertedCount: 1,
      updatedCount: 0,
      transactionCompleted: true
    });
    // No QuadratName IS NOT NULL filter: an unnamed quadrat still occupies plot area, so it
    // must be fetched and participate in the prospective-layout overlap check.
    const existingQuadratsSelect = String(mockConnectionManager.executeQuery.mock.calls[1]?.[0]);
    expect(existingQuadratsSelect).toContain('SELECT QuadratID, QuadratName, StartX, StartY, DimensionX, DimensionY FROM `forestgeo_testing`.quadrats');
    expect(existingQuadratsSelect).not.toContain('QuadratName IS NOT NULL');
    expect(String(mockConnectionManager.executeQuery.mock.calls[3]?.[0])).toContain('INSERT INTO `forestgeo_testing`.quadrats');
  });

  it('holds a revisions upload that overlaps an unnamed (NULL QuadratName) existing quadrat for acknowledgment', async () => {
    // An unnamed quadrat occupies real plot area. Excluding it from the prospective layout
    // would let an overlapping upload commit silently with no confirmation at all.
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }])
      .mockResolvedValueOnce([{ QuadratID: 7, QuadratName: null, StartX: 0, StartY: 0, DimensionX: 20, DimensionY: 20 }]);

    const res = await POST(
      makeFixedDataRequest('quadrats', { 'row-1': { quadrat: 'Q01', startx: '0', starty: '0', dimx: '20', dimy: '20' } }, { uploadMode: 'revisions' })
    );

    expect(res?.status).toBe(400);
    const body = await res?.json();
    expect(body.code).toBe('QUADRAT_OVERLAPS_REQUIRE_ACKNOWLEDGMENT');
    expect(body.error).toContain('overlaps');
    expect(body.error).toContain('(unnamed QuadratID 7)');
    expect(mockConnectionManager.executeQuery).toHaveBeenCalledTimes(2);
  });

  it('does not reject a revisions upload because an UNRELATED existing quadrat has malformed stored geometry', async () => {
    // Legacy rows written before the write boundary can hold NULL geometry. Throwing on them
    // would make quadrat revisions permanently impossible for the whole plot; instead they are
    // excluded from geometry validation with a logged warning.
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }])
      .mockResolvedValueOnce([
        { QuadratID: 9, QuadratName: 'LEGACY', StartX: null, StartY: null, DimensionX: null, DimensionY: null },
        { QuadratID: 10, QuadratName: 'C01', StartX: 0, StartY: 0, DimensionX: 20, DimensionY: 20 }
      ])
      // incoming E01 does not exist yet
      .mockResolvedValueOnce([])
      // INSERT + changelog lookup + changelog insert
      .mockResolvedValueOnce({ insertId: 3 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 4 });

    const res = await POST(
      makeFixedDataRequest('quadrats', { 'row-1': { quadrat: 'E01', startx: '40', starty: '0', dimx: '20', dimy: '20' } }, { uploadMode: 'revisions' })
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toMatchObject({ insertedCount: 1, updatedCount: 0 });
    expect(ailogger.warn).toHaveBeenCalledWith(expect.stringContaining('malformed stored geometry'));
  });

  it('allows a revisions upload to repair the very quadrat whose stored geometry is malformed', async () => {
    // The malformed row is named BY the upload, so its stored geometry is irrelevant -- it is
    // being replaced. Parsing it anyway (and throwing) would make that row unfixable in-app.
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }])
      .mockResolvedValueOnce([{ QuadratID: 9, QuadratName: 'LEGACY', StartX: null, StartY: null, DimensionX: null, DimensionY: null }])
      // per-row lookup finds the row to update
      .mockResolvedValueOnce([{ QuadratID: 9 }])
      // UPDATE + changelog lookup + changelog insert
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 4 });

    const res = await POST(
      makeFixedDataRequest('quadrats', { 'row-1': { quadrat: 'LEGACY', startx: '0', starty: '0', dimx: '20', dimy: '20' } }, { uploadMode: 'revisions' })
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toMatchObject({ insertedCount: 0, updatedCount: 1 });
    expect(ailogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('malformed stored geometry'));
  });

  it('does not reject a revisions upload because two UNRELATED existing quadrats already overlap', async () => {
    // Pre-existing layout defects among rows the upload never names are database state the
    // uploader cannot repair in this file (any repair is itself a Revisions upload that re-runs
    // this check). They are logged, and only defects the upload INTRODUCES are blocking.
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }])
      .mockResolvedValueOnce([
        { QuadratID: 1, QuadratName: 'C01', StartX: 0, StartY: 0, DimensionX: 20, DimensionY: 20 },
        { QuadratID: 2, QuadratName: 'C02', StartX: 10, StartY: 10, DimensionX: 20, DimensionY: 20 }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 3 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 4 });

    const res = await POST(
      makeFixedDataRequest('quadrats', { 'row-1': { quadrat: 'E01', startx: '100', starty: '0', dimx: '20', dimy: '20' } }, { uploadMode: 'revisions' })
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toMatchObject({ insertedCount: 1 });
    expect(ailogger.warn).toHaveBeenCalledWith(expect.stringContaining('pre-existing quadrat layout defects'));
  });

  it('still rejects an introduced overlap when pre-existing overlaps saturate the reporting cap', async () => {
    // Real production case: a plot where every existing quadrat is stacked at the same
    // coordinates, yielding thousands of pre-existing overlap pairs. The shared validator
    // caps reported pairs, so those pre-existing pairs could exhaust the cap and mask the
    // one NEW overlap this upload introduces. The supplemental incoming-only sweep must
    // catch it regardless.
    const STACKED_ROW_COUNT = 30; // 30 choose 2 = 435 pre-existing pairs, far past the 25-pair cap
    const stackedExisting = Array.from({ length: STACKED_ROW_COUNT }, (_, i) => ({
      QuadratID: i + 1,
      QuadratName: `STACK${String(i + 1).padStart(2, '0')}`,
      StartX: 0,
      StartY: 0,
      DimensionX: 20,
      DimensionY: 20
    }));
    const farExisting = { QuadratID: 99, QuadratName: 'FAR', StartX: 400, StartY: 400, DimensionX: 20, DimensionY: 20 };

    mockConnectionManager.executeQuery.mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }]).mockResolvedValueOnce([...stackedExisting, farExisting]);

    const res = await POST(
      makeFixedDataRequest('quadrats', { 'row-1': { quadrat: 'NEWOVL', startx: '410', starty: '410', dimx: '20', dimy: '20' } }, { uploadMode: 'revisions' })
    );

    expect(res?.status).toBe(400);
    const body = await res?.json();
    expect(body.code).toBe('QUADRAT_OVERLAPS_REQUIRE_ACKNOWLEDGMENT');
    expect(body.error).toContain('NEWOVL');
    expect(body.error).toContain('FAR');
  });

  it('accepts a clean revision on a plot whose pre-existing overlaps saturate the reporting cap', async () => {
    const STACKED_ROW_COUNT = 30;
    const stackedExisting = Array.from({ length: STACKED_ROW_COUNT }, (_, i) => ({
      QuadratID: i + 1,
      QuadratName: `STACK${String(i + 1).padStart(2, '0')}`,
      StartX: 0,
      StartY: 0,
      DimensionX: 20,
      DimensionY: 20
    }));

    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }])
      .mockResolvedValueOnce(stackedExisting)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 100 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 101 });

    const res = await POST(
      makeFixedDataRequest('quadrats', { 'row-1': { quadrat: 'CLEANADD', startx: '400', starty: '400', dimx: '20', dimy: '20' } }, { uploadMode: 'revisions' })
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toMatchObject({ insertedCount: 1 });
    expect(ailogger.warn).toHaveBeenCalledWith(expect.stringContaining('pre-existing quadrat layout defects'));
  });

  it('commits an overlapping upload when the acknowledgment is present and records the text in the changelog', async () => {
    const overlapSummary = validateQuadratCollectionDetailed(
      [
        { quadratName: 'Q01', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 },
        { quadratName: 'Q02', startX: 10, startY: 10, dimensionX: 20, dimensionY: 20 }
      ],
      { dimensionX: 500, dimensionY: 500 }
    ).overlapSummary;
    if (!overlapSummary) throw new Error('expected overlap summary');
    const acknowledgment = buildQuadratOverlapAcknowledgment([overlapSummary.layoutSignature]);
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }])
      // stem-safety precheck + DELETE + two INSERTs
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce({ insertId: 1 })
      .mockResolvedValueOnce({ insertId: 2 })
      // changelog lookup + insert
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 3 });

    const res = await POST(
      makeFixedDataRequest(
        'quadrats',
        {
          'row-1': { quadrat: 'Q01', startx: '0', starty: '0', dimx: '20', dimy: '20' },
          'row-2': { quadrat: 'Q02', startx: '10', starty: '10', dimx: '20', dimy: '20' }
        },
        { uploadMode: 'clean_reupload', quadratOverlapAcknowledgment: acknowledgment }
      )
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toMatchObject({ insertedCount: 2 });

    const fileUploadInsertCall = mockConnectionManager.executeQuery.mock.calls.find(
      (call: any[]) => String(call[0]).includes('unifiedchangelog') && call[1]?.[0] === 'file_upload'
    );
    expect(fileUploadInsertCall, 'the file_upload changelog entry must have been written').toBeDefined();
    expect(JSON.parse(fileUploadInsertCall![1][3])).not.toHaveProperty('overlapAcknowledgment');

    const acknowledgmentInsertCall = mockConnectionManager.executeQuery.mock.calls.find(
      (call: any[]) => String(call[0]).includes('unifiedchangelog') && call[1]?.[0] === 'quadrat_overlap_acknowledgment'
    );
    expect(acknowledgmentInsertCall, 'the immutable acknowledgment event must have been written').toBeDefined();
    expect(String(acknowledgmentInsertCall![0])).toContain('WHERE NOT EXISTS');
    expect(acknowledgmentInsertCall![1][1]).toMatch(/^[a-f0-9]{40}$/);
    expect(acknowledgmentInsertCall![1][1]).toBe(acknowledgmentInsertCall![1][6]);
    const storedEvent = JSON.parse(acknowledgmentInsertCall![1][2]);
    expect(storedEvent.statement).toBe(QUADRAT_OVERLAP_ACKNOWLEDGMENT_STATEMENT);
    expect(storedEvent.summaries[0].pairs.some((pair: { message: string }) => pair.message.includes('overlaps'))).toBe(true);
    expect(storedEvent.acknowledgedBy).toBe('user-1');
    expect(storedEvent.uploadSessionId).toBe(TEST_SESSION_ID);
  });

  it('does not treat a coerced false value as an overlap acknowledgment', async () => {
    mockConnectionManager.executeQuery.mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }]);

    const res = await POST(
      makeFixedDataRequest(
        'quadrats',
        {
          'row-1': { quadrat: 'Q01', startx: '0', starty: '0', dimx: '20', dimy: '20' },
          'row-2': { quadrat: 'Q02', startx: '10', starty: '10', dimx: '20', dimy: '20' }
        },
        { uploadMode: 'clean_reupload', quadratOverlapAcknowledgment: false }
      )
    );

    expect(res?.status).toBe(400);
    const body = await res?.json();
    expect(body.code).toBe('QUADRAT_OVERLAPS_REQUIRE_ACKNOWLEDGMENT');
    expect(body.overlapSummaries[0].layoutSignature).toMatch(/^quadrat-layout-v1-[0-9a-f]{16}$/);
    expect(mockConnectionManager.executeQuery).toHaveBeenCalledTimes(1);
  });

  it('requires re-acknowledgment when the submitted layout signature is stale', async () => {
    mockConnectionManager.executeQuery.mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }]);

    const res = await POST(
      makeFixedDataRequest(
        'quadrats',
        {
          'row-1': { quadrat: 'Q01', startx: '0', starty: '0', dimx: '20', dimy: '20' },
          'row-2': { quadrat: 'Q02', startx: '10', starty: '10', dimx: '20', dimy: '20' }
        },
        {
          uploadMode: 'clean_reupload',
          quadratOverlapAcknowledgment: buildQuadratOverlapAcknowledgment(['quadrat-layout-v1-0000000000000000'])
        }
      )
    );

    expect(res?.status).toBe(400);
    const body = await res?.json();
    expect(body.code).toBe('QUADRAT_OVERLAPS_REQUIRE_ACKNOWLEDGMENT');
    expect(body.overlapSummaries[0].layoutSignature).not.toBe('quadrat-layout-v1-0000000000000000');
    expect(mockConnectionManager.executeQuery).toHaveBeenCalledTimes(1);
  });

  it('rolls acknowledged quadrat writes back when their provenance record cannot be stored', async () => {
    const overlapSummary = validateQuadratCollectionDetailed(
      [
        { quadratName: 'Q01', startX: 0, startY: 0, dimensionX: 20, dimensionY: 20 },
        { quadratName: 'Q02', startX: 10, startY: 10, dimensionX: 20, dimensionY: 20 }
      ],
      { dimensionX: 500, dimensionY: 500 }
    ).overlapSummary;
    if (!overlapSummary) throw new Error('expected overlap summary');

    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce({ insertId: 1 })
      .mockResolvedValueOnce({ insertId: 2 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 3 })
      .mockRejectedValueOnce(new Error('acknowledgment changelog unavailable'));

    const res = await POST(
      makeFixedDataRequest(
        'quadrats',
        {
          'row-1': { quadrat: 'Q01', startx: '0', starty: '0', dimx: '20', dimy: '20' },
          'row-2': { quadrat: 'Q02', startx: '10', starty: '10', dimx: '20', dimy: '20' }
        },
        {
          uploadMode: 'clean_reupload',
          quadratOverlapAcknowledgment: buildQuadratOverlapAcknowledgment([overlapSummary.layoutSignature])
        }
      )
    );

    expect(res?.status).toBe(503);
    expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalledWith('tx-fixed');
    expect(mockConnectionManager.commitTransaction).not.toHaveBeenCalled();
  });

  it('acknowledgment does NOT bypass non-overlap defects: an out-of-bounds row still rejects', async () => {
    // The acknowledgment covers exactly one condition. A file that is both overlapping AND
    // out of bounds must still fail on the bounds defect even with the acknowledgment set.
    mockConnectionManager.executeQuery.mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }]);

    const res = await POST(
      makeFixedDataRequest(
        'quadrats',
        {
          'row-1': { quadrat: 'Q01', startx: '490', starty: '0', dimx: '20', dimy: '20' },
          'row-2': { quadrat: 'Q02', startx: '495', starty: '5', dimx: '20', dimy: '20' }
        },
        {
          uploadMode: 'clean_reupload',
          quadratOverlapAcknowledgment: buildQuadratOverlapAcknowledgment(['quadrat-layout-v1-0000000000000000'])
        }
      )
    );

    expect(res?.status).toBe(400);
    const body = await res?.json();
    expect(body.code).toBe('INVALID_QUADRAT_GEOMETRY');
    expect(body.error).toContain('extends past plot');
  });

  it('surfaces the divergent-placeholder guidance INSTEAD of raw overlap errors for a replacement grid', async () => {
    // A real replacement grid always geometrically overlaps the placeholder grid it replaces,
    // so if geometry validation ran first the guard's actionable message would be unreachable
    // in exactly its primary scenario (the Cooks Branch doubling).
    mockConnectionManager.executeQuery.mockResolvedValueOnce([{ DimensionX: 40, DimensionY: 40 }]).mockResolvedValueOnce([
      { QuadratID: 1, QuadratName: 'Q00001', StartX: 0, StartY: 0, DimensionX: 20, DimensionY: 20 },
      { QuadratID: 2, QuadratName: 'Q00002', StartX: 20, StartY: 0, DimensionX: 20, DimensionY: 20 },
      { QuadratID: 3, QuadratName: 'Q00003', StartX: 0, StartY: 20, DimensionX: 20, DimensionY: 20 },
      { QuadratID: 4, QuadratName: 'Q00004', StartX: 20, StartY: 20, DimensionX: 20, DimensionY: 20 }
    ]);

    const res = await POST(
      makeFixedDataRequest(
        'quadrats',
        {
          'row-1': { quadrat: 'C01', startx: '0', starty: '0', dimx: '20', dimy: '20' },
          'row-2': { quadrat: 'C02', startx: '20', starty: '0', dimx: '20', dimy: '20' },
          'row-3': { quadrat: 'C03', startx: '0', starty: '20', dimx: '20', dimy: '20' }
        },
        { uploadMode: 'revisions' }
      )
    );

    expect(res?.status).toBe(503);
    const body = await res?.json();
    expect(body.error).toContain('appears to replace the generated placeholder grid');
    expect(body.error).not.toContain('overlaps quadrat');
  });

  it('skips entirely-blank padding rows instead of rejecting the upload, and reports the skip count', async () => {
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce({ insertId: 1 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 2 });

    const res = await POST(
      makeFixedDataRequest(
        'quadrats',
        {
          'row-1': { quadrat: 'Q01', startx: '0', starty: '0', dimx: '20', dimy: '20' },
          'row-2': { quadrat: '', startx: '', starty: '', dimx: '', dimy: '' }
        },
        { uploadMode: 'clean_reupload' }
      )
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toMatchObject({ insertedCount: 1, skippedCount: 1 });
  });

  it('rejects a quadrat upload whose rows are ALL blank padding before deleting anything', async () => {
    // Falling through with zero usable rows would validate an empty layout and then, in
    // CLEAN_REUPLOAD, wipe the plot's quadrats without inserting anything.
    const res = await POST(
      makeFixedDataRequest('quadrats', { 'row-1': { quadrat: '', startx: '', starty: '', dimx: '', dimy: '' } }, { uploadMode: 'clean_reupload' })
    );

    expect(res?.status).toBe(400);
    const body = await res?.json();
    expect(body.code).toBe('INVALID_QUADRAT_GEOMETRY');
    expect(body.error).toContain('contains no usable rows (1 blank row(s) skipped)');
    expect(mockConnectionManager.executeQuery).not.toHaveBeenCalled();
  });

  it('reports every unconvertible row in a rejected quadrat upload, not just the first', async () => {
    // Two rows are bad for two DIFFERENT reasons (blank name vs. non-numeric coordinate) and
    // one row is entirely valid. A fail-fast implementation would only ever mention row 1.
    const res = await POST(
      makeFixedDataRequest(
        'quadrats',
        {
          'row-1': { quadrat: '', startx: '0', starty: '0', dimx: '20', dimy: '20' },
          'row-2': { quadrat: 'BAD02', startx: 'not-a-number', starty: '0', dimx: '20', dimy: '20' },
          'row-3': { quadrat: 'GOOD03', startx: '40', starty: '0', dimx: '20', dimy: '20' }
        },
        { uploadMode: 'clean_reupload' }
      )
    );

    expect(res?.status).toBe(400);
    const body = await res?.json();
    expect(body.code).toBe('INVALID_QUADRAT_GEOMETRY');
    expect(body.error).toContain('row 1');
    expect(body.error).toContain('row 2');
    expect(body.error).toContain('BAD02');
    // The valid third row must not be reported.
    expect(body.error).not.toContain('GOOD03');
    // Nothing was ever written: the failure happens before the stem-safety check or delete.
    expect(mockConnectionManager.executeQuery).not.toHaveBeenCalled();
    expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalledWith('tx-fixed');
  });

  it('rejects an empty quadrat clean re-upload before reading bounds or deleting existing rows', async () => {
    const res = await POST(makeFixedDataRequest('quadrats', {}, { uploadMode: 'clean_reupload' }));

    expect(res?.status).toBe(400);
    await expect(res?.json()).resolves.toMatchObject({
      code: 'INVALID_QUADRAT_GEOMETRY',
      error: 'Quadrat upload must contain at least one row.'
    });
    expect(mockConnectionManager.executeQuery).not.toHaveBeenCalled();
    expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalledWith('tx-fixed');
  });

  it('caps quadrat rows per request before running collection validation', async () => {
    const fileRowSet: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_GENERATED_QUADRATS; i++) {
      fileRowSet[`row-${i}`] = { quadrat: `Q${i}`, startx: i, starty: 0, dimx: 1, dimy: 1 };
    }

    const res = await POST(makeFixedDataRequest('quadrats', fileRowSet, { uploadMode: 'revisions' }));

    expect(res?.status).toBe(400);
    const body = await res?.json();
    expect(body.code).toBe('INVALID_QUADRAT_GEOMETRY');
    expect(body.error).toContain(`maximum allowed per request is ${MAX_GENERATED_QUADRATS}`);
    expect(mockConnectionManager.executeQuery).not.toHaveBeenCalled();
  });

  it('preserves a geometry validation response when rollback itself fails', async () => {
    mockConnectionManager.rollbackTransaction.mockRejectedValueOnce(new Error('rollback connection lost'));

    const res = await POST(makeFixedDataRequest('quadrats', {}, { uploadMode: 'clean_reupload' }));

    expect(res?.status).toBe(400);
    await expect(res?.json()).resolves.toMatchObject({
      code: 'INVALID_QUADRAT_GEOMETRY',
      error: 'Quadrat upload must contain at least one row.'
    });
  });

  it('caps the aggregated row-failure message and states how many more rows failed', async () => {
    const TOTAL_BAD_ROWS = 25;
    const MAX_LISTED_ROW_FAILURES = 20;
    mockConnectionManager.executeQuery.mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }]);

    const fileRowSet: Record<string, unknown> = {};
    for (let i = 0; i < TOTAL_BAD_ROWS; i++) {
      fileRowSet[`row-${i + 1}`] = { quadrat: '', startx: '0', starty: '0', dimx: '20', dimy: '20' };
    }

    const res = await POST(makeFixedDataRequest('quadrats', fileRowSet, { uploadMode: 'clean_reupload' }));

    expect(res?.status).toBe(400);
    const body = await res?.json();
    expect(body.error).toContain(`...and ${TOTAL_BAD_ROWS - MAX_LISTED_ROW_FAILURES} more`);
    expect(body.error).toContain(`row ${MAX_LISTED_ROW_FAILURES}`);
    expect(body.error).not.toContain(`row ${MAX_LISTED_ROW_FAILURES + 1}`);
  });

  it('distinguishes a blank quadrat name from bad coordinates in the row-failure message', async () => {
    mockConnectionManager.executeQuery.mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }]);

    const res = await POST(
      makeFixedDataRequest('quadrats', { 'row-1': { quadrat: '   ', startx: '0', starty: '0', dimx: '20', dimy: '20' } }, { uploadMode: 'clean_reupload' })
    );

    expect(res?.status).toBe(400);
    const body = await res?.json();
    expect(body.error).toContain('missing or blank QuadratName');
    expect(body.error).not.toContain('missing, blank, or non-numeric');
  });

  it('accepts a quadrat upload with bounds checks skipped (and logged) when the plot has null dimensions on record', async () => {
    // Plots recorded without dimensions accepted quadrat uploads before the write boundary
    // existed; rejecting them would lock those sites out of quadrat management entirely.
    // The row below extends to x=100000, which would fail any real plot-bounds check --
    // proving the bounds check was skipped rather than run against coerced-to-zero bounds.
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ DimensionX: null, DimensionY: null }])
      // stem-safety precheck: nothing blocking
      .mockResolvedValueOnce([])
      // DELETE FROM quadrats
      .mockResolvedValueOnce({ affectedRows: 0 })
      // INSERT new quadrat
      .mockResolvedValueOnce({ insertId: 1 })
      // changelog lookup + insert
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 2 });

    const res = await POST(
      makeFixedDataRequest('quadrats', { 'row-1': { quadrat: 'Q01', startx: '99980', starty: '0', dimx: '20', dimy: '20' } }, { uploadMode: 'clean_reupload' })
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toMatchObject({ insertedCount: 1 });
    expect(ailogger.warn).toHaveBeenCalledWith(expect.stringContaining('quadrat plot-bounds checks are skipped'));
  });

  it('still holds overlapping rows for acknowledgment when the plot has non-positive dimensions on record', async () => {
    // Degraded (bounds-less) validation is not NO validation: unacknowledged overlaps must
    // still stop the file even when the plot record is unusable.
    mockConnectionManager.executeQuery.mockResolvedValueOnce([{ DimensionX: 0, DimensionY: 500 }]);

    const res = await POST(
      makeFixedDataRequest(
        'quadrats',
        {
          'row-1': { quadrat: 'Q01', startx: '0', starty: '0', dimx: '20', dimy: '20' },
          'row-2': { quadrat: 'Q02', startx: '10', starty: '10', dimx: '20', dimy: '20' }
        },
        { uploadMode: 'clean_reupload' }
      )
    );

    expect(res?.status).toBe(400);
    const body = await res?.json();
    expect(body.code).toBe('QUADRAT_OVERLAPS_REQUIRE_ACKNOWLEDGMENT');
    expect(body.error).toContain('overlap');
    expect(mockConnectionManager.executeQuery).toHaveBeenCalledTimes(1);
  });

  it('parses numeric JSON geometry values (not just strings) for a quadrat upload', async () => {
    // FileRow is documented as Record<string, string | null>, but a non-browser caller can send
    // raw JSON numbers. `0` is falsy, so a naive coercion could wrongly treat it as missing.
    mockConnectionManager.executeQuery
      // authoritative plot bounds lookup
      .mockResolvedValueOnce([{ DimensionX: 500, DimensionY: 500 }])
      // stem-safety precheck: nothing blocking
      .mockResolvedValueOnce([])
      // DELETE FROM quadrats
      .mockResolvedValueOnce({ affectedRows: 0 })
      // INSERT new quadrat
      .mockResolvedValueOnce({ insertId: 1 });

    const res = await POST(
      makeFixedDataRequest('quadrats', { 'row-1': { quadrat: 'NUM01', startx: 0, starty: 0, dimx: 20, dimy: 20 } }, { uploadMode: 'clean_reupload' })
    );

    expect(res?.status).toBe(200);
    const insertCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('INSERT INTO `forestgeo_testing`.quadrats')
    );
    expect(insertCall).toBeDefined();
    const insertParams = insertCall![1];
    expect(insertParams).toEqual(expect.arrayContaining(['NUM01', 0, 0, 20, 20]));
  });

  it('rejects revisions when multiple active species rows already exist for one SpeciesCode', async () => {
    mockConnectionManager.executeQuery.mockResolvedValueOnce([{ SpeciesID: 11 }, { SpeciesID: 19 }]);

    const res = await POST(
      makeFixedDataRequest(
        'species',
        {
          'row-1': { spcode: 'swars1', species: 'simplex ochnacea' }
        },
        { uploadMode: 'revisions' }
      )
    );

    expect(res?.status).toBe(503);
    await expect(res?.json()).resolves.toMatchObject({
      error: 'Duplicate active species rows already exist for SpeciesCode "swars1". Remove the duplicates before uploading revisions.'
    });
    expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalledWith('tx-fixed');
  });

  it('keeps species family and genus upserts on the active transaction', async () => {
    handleUpsertMock.mockResolvedValueOnce({ id: 15, operation: 'inserted' }).mockResolvedValueOnce({ id: 27, operation: 'inserted' });

    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 44 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 5 });

    const res = await POST(
      makeFixedDataRequest(
        'species',
        {
          'row-1': { spcode: 'querc1', family: 'Fagaceae', genus: 'Quercus', species: 'alba' }
        },
        { uploadMode: 'revisions' }
      )
    );

    expect(res?.status).toBe(200);
    expect(handleUpsertMock).toHaveBeenNthCalledWith(1, mockConnectionManager, 'forestgeo_testing', 'family', { Family: 'Fagaceae' }, 'FamilyID', 'tx-fixed');
    expect(handleUpsertMock).toHaveBeenNthCalledWith(
      2,
      mockConnectionManager,
      'forestgeo_testing',
      'genus',
      { Genus: 'Quercus', FamilyID: 15 },
      'GenusID',
      'tx-fixed'
    );
  });

  it('retries transient lock wait failures for species revisions uploads', async () => {
    const immediateSetTimeout = vi.spyOn(global, 'setTimeout').mockImplementation((callback, _delay, ...args) => {
      if (typeof callback === 'function') callback(...args);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    mockConnectionManager.executeQuery
      .mockRejectedValueOnce(new Error('Lock wait timeout exceeded; try restarting transaction'))
      .mockResolvedValueOnce([{ SpeciesID: 11 }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 5 });

    const res = await POST(
      makeFixedDataRequest(
        'species',
        {
          'row-1': { spcode: 'swars1', species: 'simplex ochnacea' }
        },
        { uploadMode: 'revisions' }
      )
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toMatchObject({
      uploadMode: 'revisions',
      updatedCount: 1,
      transactionCompleted: true
    });
    expect(mockConnectionManager.beginTransaction).toHaveBeenCalledTimes(2);
    expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(mockConnectionManager.commitTransaction).toHaveBeenCalledWith('tx-fixed');

    immediateSetTimeout.mockRestore();
  });
});

describe('sqlpacketload server-side CSV resolution (rawRows path)', () => {
  let mockConnectionManager: any;

  // A complete, trusted CSV mapping that renames the canonical `lx` field to a source column `MyX`.
  // Every required field is named, so chooseEffectiveCsvMapping trusts it. The literal `lx` header is
  // intentionally left unclaimed so the server-side keying (not the raw header) is what produces `lx`.
  function lxRenamedMapping(csvHeaders: string[]): ColumnMapping {
    const field = (canonicalField: string, sourceColumns: string[]): ColumnMapping['fields'][number] => ({ canonicalField, sourceColumns, scope: 'file' });
    return {
      version: 1,
      format: SourceFormat.csv,
      fields: [
        field('tag', ['tag']),
        field('spcode', ['spcode']),
        field('quadrat', ['quadrat']),
        field('lx', ['MyX']),
        field('ly', ['ly']),
        field('date', ['date'])
      ],
      headerSignature: headerSignature(csvHeaders)
    };
  }

  const RESOLUTION_CSV_HEADERS = ['MyX', 'tag', 'spcode', 'quadrat', 'ly', 'date'];

  function makeRawRowsRequest(rawRows: Record<string, string>[], overrides: Partial<Record<string, unknown>> = {}) {
    const body: Record<string, unknown> = {
      schema: 'forestgeo_testing',
      formType: 'measurements',
      fileName: TEST_FILE_NAME,
      plot: { plotID: TEST_PLOT_ID },
      census: { dateRanges: [{ censusID: TEST_CENSUS_ID }] },
      user: 'Test User',
      batchID: TEST_BATCH_ID,
      // Deliberately empty: the rawRows path must NOT trust a client-keyed fileRowSet.
      fileRowSet: {},
      rawRows,
      csvHeaders: RESOLUTION_CSV_HEADERS,
      mapping: lxRenamedMapping(RESOLUTION_CSV_HEADERS),
      delimiter: ',',
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

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionManager = ConnectionManager.getInstance();
    vi.mocked(insertIngestionFailureRows).mockResolvedValue([]);
    handleUpsertMock.mockResolvedValue({ id: 1, operation: 'inserted' });
    // Phase-3 inline membership guard (assertSchemaAccess) now runs after auth();
    // a 'global' admin session clears it so these behavioral tests reach the handler body.
    authMock.mockResolvedValue({ user: { id: 'user-1', userStatus: 'global', sites: [] } });
    getCookieMock.mockResolvedValue(undefined);
    requireUploadSessionOwnershipMock.mockResolvedValue(undefined);
    resetTemporaryMeasurementsSourceFormatColumnCacheForTests();
    mockConnectionManager.beginTransaction.mockResolvedValue('tx-test');
    mockConnectionManager.commitTransaction.mockResolvedValue(undefined);
    mockConnectionManager.rollbackTransaction.mockResolvedValue(undefined);
  });

  it('rejects a malformed mapping at the wire boundary when rawRows are present', async () => {
    const rawRow = { MyX: '12.5', tag: 'T1', spcode: 'abc', quadrat: 'q1', ly: '3.0', date: '2023-05-17' };

    // Scope validation runs before the resolution stage; provide the two scope queries so we reach it.
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ PlotID: TEST_PLOT_ID }])
      .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }]);

    const res = (await POST(makeRawRowsRequest([rawRow], { mapping: { version: 99 } })))!;

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      responseMessage: 'Invalid mapping payload',
      fileName: TEST_FILE_NAME
    });
    // The malformed mapping must be rejected BEFORE any transaction work.
    expect(mockConnectionManager.beginTransaction).not.toHaveBeenCalled();
  });

  it('server-resolves raw rows into canonically-keyed rows and inserts them (not the raw header)', async () => {
    // 'lx' is sourced from 'MyX'; the server must key the inserted row as `lx`, never `MyX`.
    const rawRow = { MyX: '12.5', tag: 'T1', spcode: 'abc', quadrat: 'q1', ly: '3.0', date: '2023-05-17' };

    primeMeasurementQueries(mockConnectionManager);

    const res = (await POST(makeRawRowsRequest([rawRow])))!;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insertedCount).toBe(1);

    const insertCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('INSERT IGNORE INTO `forestgeo_testing`.temporarymeasurements')
    );
    expect(insertCall).toBeDefined();
    // The INSERT params must carry the canonical lx value (12.5) sourced from MyX, never the raw header.
    expect(insertCall[1]).toContain(12.5);
    expect(insertCall[1]).not.toContain('MyX');
  });

  it('surfaces an invalid raw row in failingRows while a valid sibling is still inserted', async () => {
    const validRow = { MyX: '12.5', tag: 'T1', spcode: 'abc', quadrat: 'q1', ly: '3.0', date: '2023-05-17' };
    // Missing a required field (tag empty) -> resolution classifies this as an invalid row.
    const invalidRow = { MyX: '13.0', tag: '', spcode: 'def', quadrat: 'q2', ly: '4.0', date: '2023-05-18' };

    primeMeasurementQueries(mockConnectionManager);

    const res = (await POST(makeRawRowsRequest([validRow, invalidRow])))!;

    expect(res.status).toBe(200);
    const body = await res.json();
    // Only the valid row reaches the insert path.
    expect(body.insertedCount).toBe(1);
    // The invalid row is surfaced to the client as a failing row, the valid one is not.
    expect(body.failingRows).toHaveLength(1);
    // Empty tag collapses to null via the transform, so identify the failing row by its species code.
    const failingSpcodes = body.failingRows.map((row: any) => row.spcode);
    expect(failingSpcodes).toContain('def');
    expect(failingSpcodes).not.toContain('abc');
    expect(body.failingRows[0].failureReason).toMatch(/Missing required fields/i);
  });

  it('rejects a ragged raw row (papaparse __parsed_extra) instead of injecting a phantom column into the insert', async () => {
    const validRow = { MyX: '12.5', tag: 'T1', spcode: 'abc', quadrat: 'q1', ly: '3.0', date: '2023-05-17' };
    // papaparse parks an over-wide line's leftover cell under `__parsed_extra` (an array). The server
    // must reject this row, not key the leftover as a normalized `parsedextra` column on the upload.
    const raggedRow = {
      MyX: '13.0',
      tag: 'T9',
      spcode: 'def',
      quadrat: 'q2',
      ly: '4.0',
      date: '2023-05-18',
      __parsed_extra: ['leftover']
    } as unknown as Record<string, string>;

    primeMeasurementQueries(mockConnectionManager);

    const res = (await POST(makeRawRowsRequest([validRow, raggedRow])))!;

    expect(res.status).toBe(200);
    const body = await res.json();
    // Only the well-formed sibling reaches the insert path.
    expect(body.insertedCount).toBe(1);
    expect(body.failingRows).toHaveLength(1);
    expect(body.failingRows[0].spcode).toBe('def');
    expect(body.failingRows[0].failureReason).toMatch(/too many columns/i);

    const insertCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('INSERT IGNORE INTO `forestgeo_testing`.temporarymeasurements')
    );
    expect(insertCall).toBeDefined();
    // The leftover cell and any normalized __parsed_extra key must never reach the insert params.
    const insertedParams = JSON.stringify(insertCall[1]);
    expect(insertedParams).not.toContain('leftover');
    expect(insertedParams).not.toContain('parsedextra');
    expect(insertedParams).not.toContain('__parsed_extra');
  });

  it('surfaces dropped-column diagnostics in the response so mis-mapped columns are not silent (M4)', async () => {
    // The mapping sources lx from MyX, so the literal 'lx' header is diverted to an inert ignored key
    // and dropped. The response must report that a column was dropped rather than swallowing it.
    const rawRow = { MyX: '12.5', tag: 'T1', spcode: 'abc', quadrat: 'q1', ly: '3.0', date: '2023-05-17', lx: '9.9' };
    const headersWithIgnoredLx = ['MyX', 'tag', 'spcode', 'quadrat', 'ly', 'date', 'lx'];

    primeMeasurementQueries(mockConnectionManager);

    const res = (await POST(makeRawRowsRequest([rawRow], { csvHeaders: headersWithIgnoredLx, mapping: lxRenamedMapping(headersWithIgnoredLx) })))!;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mappingDiagnostics).toBeDefined();
    expect(body.mappingDiagnostics.ignoredColumnCount).toBe(1);
  });

  it('leaves the legacy fileRowSet path byte-identical when rawRows is absent', async () => {
    // Same shape as the existing happy-path test; no rawRows -> the new stage must not run.
    primeMeasurementQueries(mockConnectionManager);

    const res = (await POST(makeMeasurementRequest()))!;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insertedCount).toBe(1);
    expect(body.failingRows).toEqual([]);

    const insertCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('INSERT IGNORE INTO `forestgeo_testing`.temporarymeasurements')
    );
    expect(insertCall[1].slice(0, 6)).toEqual([TEST_FILE_NAME, TEST_BATCH_ID, TEST_SESSION_ID, 'csv', TEST_PLOT_ID, TEST_CENSUS_ID]);
  });

  it('raises an INVALID_PUBLISHED_STEMID warning alert when a present PublishedStemID cannot be parsed (ingests NULL, not silent)', async () => {
    // The row is otherwise valid, so it ingests; its StemID value "5,001" is unparseable and is coerced
    // to NULL. The upload must record a visible warning rather than silently discarding the SI identifier.
    const field = (canonicalField: string, sourceColumns: string[]): ColumnMapping['fields'][number] => ({ canonicalField, sourceColumns, scope: 'file' });
    const headersWithStemId = [...RESOLUTION_CSV_HEADERS, 'StemID'];
    const mappingWithPublishedStemId: ColumnMapping = {
      version: 1,
      format: SourceFormat.csv,
      fields: [
        field('tag', ['tag']),
        field('spcode', ['spcode']),
        field('quadrat', ['quadrat']),
        field('lx', ['MyX']),
        field('ly', ['ly']),
        field('date', ['date']),
        field('publishedstemid', ['StemID'])
      ],
      headerSignature: headerSignature(headersWithStemId)
    };
    const rawRow = { MyX: '12.5', tag: 'T1', spcode: 'abc', quadrat: 'q1', ly: '3.0', date: '2023-05-17', StemID: '5,001' };

    primeMeasurementQueries(mockConnectionManager);

    const res = (await POST(makeRawRowsRequest([rawRow], { csvHeaders: headersWithStemId, mapping: mappingWithPublishedStemId })))!;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insertedCount).toBe(1);

    const alertCall = mockConnectionManager.executeQuery.mock.calls.find(
      (call: any[]) => String(call[0]).includes('uploadintegrityalerts') && String(call[0]).includes('INVALID_PUBLISHED_STEMID')
    );
    expect(alertCall).toBeDefined();
    // Severity is a warning (row still ingested) and the offending value is captured in the message.
    expect(String(alertCall[0])).toContain("'warning'");
    const alertMessage = String(alertCall[1].find((param: unknown) => typeof param === 'string' && param.includes('coercedToNullCount')));
    expect(alertMessage).toContain('5,001');
  });
});
