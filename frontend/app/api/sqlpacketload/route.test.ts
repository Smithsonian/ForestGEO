import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import ConnectionManager from '@/config/connectionmanager';
import { insertIngestionFailureRows } from '@/config/measurementerrors';

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

vi.mock('@/config/connectionmanager', () => {
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

vi.mock('@/config/utils/sqlsecurity', () => ({
  isValidSchema: vi.fn(() => true)
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

vi.mock('mysql2/promise', () => ({
  format: vi.fn((sql: string, params: any[]) => {
    let result = sql;
    params.forEach(param => {
      if (result.includes('??')) {
        result = result.replace('??', String(param));
      } else if (result.includes('?')) {
        result = result.replace('?', String(param));
      }
    });
    return result;
  })
}));

/** Must match TEMP_MEASUREMENT_INSERT_BATCH_SIZE in route.ts */
const TEMP_MEASUREMENT_INSERT_BATCH_SIZE = 1000;

/** Number of columns in the temporarymeasurements INSERT (FileID through Comments) */
const TEMP_MEASUREMENT_COLUMNS_PER_ROW = 16;

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

describe('sqlpacketload measurement scope validation', () => {
  let mockConnectionManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionManager = ConnectionManager.getInstance();
    vi.mocked(insertIngestionFailureRows).mockResolvedValue([]);
    handleUpsertMock.mockResolvedValue({ id: 1, operation: 'inserted' });
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    getCookieMock.mockResolvedValue(undefined);
    requireUploadSessionOwnershipMock.mockResolvedValue(undefined);
    mockConnectionManager.beginTransaction.mockResolvedValue('tx-test');
    mockConnectionManager.commitTransaction.mockResolvedValue(undefined);
    mockConnectionManager.rollbackTransaction.mockResolvedValue(undefined);
  });

  it('prefers request body over mismatched cookies', async () => {
    getCookieMock.mockImplementation(async (name: string) => {
      if (name === 'plotID') return String(TEST_PLOT_ID);
      if (name === 'censusID') return '99';
      return undefined;
    });

    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ PlotID: TEST_PLOT_ID }])
      .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    const res = (await POST(makeMeasurementRequest()))!;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insertedCount).toBe(1);

    const insertCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('INSERT IGNORE INTO forestgeo_testing.temporarymeasurements')
    );
    expect(insertCall[1].slice(0, 5)).toEqual([TEST_FILE_NAME, TEST_BATCH_ID, TEST_SESSION_ID, TEST_PLOT_ID, TEST_CENSUS_ID]);
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
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ PlotID: TEST_PLOT_ID }])
      .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    const res = (await POST(makeMeasurementRequest()))!;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insertedCount).toBe(1);

    const insertCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('INSERT IGNORE INTO forestgeo_testing.temporarymeasurements')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1].slice(0, 5)).toEqual([TEST_FILE_NAME, TEST_BATCH_ID, TEST_SESSION_ID, TEST_PLOT_ID, TEST_CENSUS_ID]);
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

    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ PlotID: TEST_PLOT_ID }])
      .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ count: 1001 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    const res = (await POST(makeMeasurementRequest({ fileRowSet: largeRowSet })))!;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insertedCount).toBe(1001);

    const insertCalls = mockConnectionManager.executeQuery.mock.calls.filter((call: any[]) =>
      String(call[0]).includes('INSERT IGNORE INTO forestgeo_testing.temporarymeasurements')
    );
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0][1]).toHaveLength(TEMP_MEASUREMENT_INSERT_BATCH_SIZE * TEMP_MEASUREMENT_COLUMNS_PER_ROW);
    expect(insertCalls[1][1]).toHaveLength(TEMP_MEASUREMENT_COLUMNS_PER_ROW);
  });

  it('cleans up stale temporarymeasurements rows from older batches before starting a new batch', async () => {
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ PlotID: TEST_PLOT_ID }])
      .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 10605 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    const res = (await POST(makeMeasurementRequest()))!;

    expect(res.status).toBe(200);

    const cleanupCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('DELETE FROM forestgeo_testing.temporarymeasurements')
    );
    expect(cleanupCall).toBeDefined();
    expect(cleanupCall[1]).toEqual([TEST_FILE_NAME, TEST_PLOT_ID, TEST_CENSUS_ID, TEST_BATCH_ID]);
  });

  it('cleans up previous upload data and allows re-upload of the same file', async () => {
    mockConnectionManager.executeQuery
      // census scope check
      .mockResolvedValueOnce([{ PlotID: TEST_PLOT_ID }])
      // batch scope check
      .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }])
      // pre-insert count
      .mockResolvedValueOnce([{ count: 0 }])
      // cleanupPreviousFileUploads: find old batches
      .mockResolvedValueOnce([{ batchID: 'completed-batch-1' }])
      // cleanupPreviousFileUploads: delete measurement_error_log
      .mockResolvedValueOnce({ affectedRows: 5 })
      // cleanupPreviousFileUploads: delete coremeasurements
      .mockResolvedValueOnce({ affectedRows: 131 })
      // cleanupPreviousFileUploads: delete failedmeasurements
      .mockResolvedValueOnce({ affectedRows: 0 })
      // cleanupPreviousFileUploads: delete uploadmetrics
      .mockResolvedValueOnce({ affectedRows: 1 })
      // cleanupStaleMeasurementBatchesForFile
      .mockResolvedValueOnce({ affectedRows: 0 })
      // insert temporary measurements
      .mockResolvedValueOnce(undefined)
      // post-insert count
      .mockResolvedValueOnce([{ count: 1 }])
      // changelog check
      .mockResolvedValueOnce([])
      // changelog insert
      .mockResolvedValueOnce(undefined);

    const res = (await POST(makeMeasurementRequest()))!;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insertedCount).toBe(1);
    expect(mockConnectionManager.commitTransaction).toHaveBeenCalledWith('tx-test');

    const deleteValidationErrorsCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('DELETE mel FROM forestgeo_testing.measurement_error_log')
    );
    expect(deleteValidationErrorsCall).toBeDefined();

    const deleteCmCall = mockConnectionManager.executeQuery.mock.calls.find(
      (call: any[]) => String(call[0]).includes('DELETE FROM forestgeo_testing.coremeasurements') && String(call[0]).includes('UploadFileID')
    );
    expect(deleteCmCall).toBeDefined();

    const deleteFailedCall = mockConnectionManager.executeQuery.mock.calls.find(
      (call: any[]) =>
        String(call[0]).includes('DELETE FROM forestgeo_testing.failedmeasurements') &&
        String(call[0]).includes('WHERE FileID = ?') &&
        String(call[0]).includes('BatchID IN')
    );
    expect(deleteFailedCall).toBeDefined();
  });

  it('skips previous-upload cleanup for measurement revisions uploads', async () => {
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ PlotID: TEST_PLOT_ID }])
      .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }])
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
      String(call[0]).includes('DELETE FROM forestgeo_testing.coremeasurements')
    );
    expect(cleanupCall).toBeUndefined();

    const staleBatchCleanupCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('DELETE FROM forestgeo_testing.temporarymeasurements')
    );
    expect(staleBatchCleanupCall).toBeDefined();
  });

  it('falls back past missing legacy cleanup tables during re-upload', async () => {
    const missingError = Object.assign(new Error("Table 'forestgeo_testing.measurement_error_log' doesn't exist"), {
      code: 'ER_NO_SUCH_TABLE'
    });
    const missingFailedTableError = Object.assign(new Error("Table 'forestgeo_testing.failedmeasurements' doesn't exist"), {
      code: 'ER_NO_SUCH_TABLE'
    });

    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ PlotID: TEST_PLOT_ID }])
      .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ batchID: 'completed-batch-1' }])
      .mockRejectedValueOnce(missingError)
      .mockResolvedValueOnce({ affectedRows: 5 })
      .mockResolvedValueOnce({ affectedRows: 131 })
      .mockRejectedValueOnce(missingFailedTableError)
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    const res = (await POST(makeMeasurementRequest()))!;

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ insertedCount: 1 });

    const legacyDeleteCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('DELETE e FROM forestgeo_testing.cmverrors')
    );
    expect(legacyDeleteCall).toBeDefined();
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

    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ PlotID: TEST_PLOT_ID }])
      .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ rowOrdinal: 2, existingBatch: null }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    const res = (await POST(makeMeasurementRequest({ fileRowSet: twoRowSet })))!;

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      insertedCount: 1,
      droppedCount: 1,
      dataIntegrityWarning: true
    });

    const alertCall = mockConnectionManager.executeQuery.mock.calls.find(
      (call: any[]) =>
        String(call[0]).includes('INSERT INTO forestgeo_testing.uploadintegrityalerts') &&
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
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    mockConnectionManager.beginTransaction.mockResolvedValue('tx-fixed');
    mockConnectionManager.commitTransaction.mockResolvedValue(undefined);
    mockConnectionManager.rollbackTransaction.mockResolvedValue(undefined);
    handleUpsertMock.mockResolvedValue({ id: 1, operation: 'inserted' });
  });

  it('updates existing attributes and skips new codes in revisions mode', async () => {
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ Code: 'EXISTING' }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 9 });

    const res = await POST(
      makeFixedDataRequest(
        'attributes',
        {
          'row-1': { code: 'EXISTING', description: 'Updated description', status: 'alive' },
          'row-2': { code: 'NEWCODE', description: 'Should skip', status: 'dead' }
        },
        { uploadMode: 'revisions' }
      )
    );

    expect(res?.status).toBe(200);
    await expect(res?.json()).resolves.toMatchObject({
      uploadMode: 'revisions',
      insertedCount: 0,
      updatedCount: 1,
      skippedCount: 1,
      transactionCompleted: true
    });
  });

  it('syncs personnel rows in clean mode for the current census', async () => {
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

    expect(mockConnectionManager.executeQuery.mock.calls.some((call: any[]) => String(call[0]).includes('INSERT INTO forestgeo_testing.personnel'))).toBe(true);
    expect(
      mockConnectionManager.executeQuery.mock.calls.some((call: any[]) =>
        String(call[0]).includes('INSERT IGNORE INTO forestgeo_testing.censusactivepersonnel')
      )
    ).toBe(true);
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
      expect.objectContaining({ RoleName: 'lead tech' }),
      'RoleID'
    );
  });
});
