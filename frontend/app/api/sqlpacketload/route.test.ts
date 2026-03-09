import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import ConnectionManager from '@/config/connectionmanager';

const { getCookieMock, authMock } = vi.hoisted(() => ({
  getCookieMock: vi.fn(),
  authMock: vi.fn()
}));

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
    generateShortBatchID: () => 'test-batch-id'
  };
});

vi.mock('@/config/measurementerrors', () => ({
  insertIngestionFailureRows: vi.fn().mockResolvedValue([])
}));

vi.mock('@/components/processors/processbulkspecies', () => ({
  processBulkSpecies: vi.fn().mockResolvedValue(undefined)
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

function makeMeasurementRequest(overrides: Partial<Record<string, unknown>> = {}) {
  const body = {
    schema: 'forestgeo_testing',
    formType: 'measurements',
    fileName: 'SERC_census1_2025.csv',
    plot: { plotID: 22 },
    census: { dateRanges: [{ censusID: 32 }] },
    user: 'Test User',
    batchID: 'batch-1',
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
    headers: { 'content-type': 'application/json' },
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
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    getCookieMock.mockResolvedValue(undefined);
    mockConnectionManager.beginTransaction.mockResolvedValue('tx-test');
    mockConnectionManager.commitTransaction.mockResolvedValue(undefined);
    mockConnectionManager.rollbackTransaction.mockResolvedValue(undefined);
  });

  it('prefers request body over mismatched cookies', async () => {
    getCookieMock.mockImplementation(async (name: string) => {
      if (name === 'plotID') return '22';
      if (name === 'censusID') return '99';
      return undefined;
    });

    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ PlotID: 22 }])
      .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    const res = await POST(makeMeasurementRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insertedCount).toBe(1);

    const insertCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('INSERT IGNORE INTO forestgeo_testing.temporarymeasurements')
    );
    expect(insertCall[1].slice(0, 4)).toEqual(['SERC_census1_2025.csv', 'batch-1', 22, 32]);
  });

  it('rejects when census does not belong to the provided plot', async () => {
    mockConnectionManager.executeQuery.mockResolvedValueOnce([{ PlotID: 99 }]);

    const res = await POST(makeMeasurementRequest());

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/does not belong to the provided plotID/i);
    expect(mockConnectionManager.beginTransaction).not.toHaveBeenCalled();
  });

  it('rejects when an existing batch already has a different census scope', async () => {
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ PlotID: 22 }])
      .mockResolvedValueOnce([{ distinctPlotCount: 1, distinctCensusCount: 1, plotID: 22, censusID: 99 }]);

    const res = await POST(makeMeasurementRequest());

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Existing batch scope does not match incoming plot\/census/i);
    expect(mockConnectionManager.beginTransaction).not.toHaveBeenCalled();
  });

  it('accepts valid scope and inserts temporary rows using the resolved plot/census IDs', async () => {
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ PlotID: 22 }])
      .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    const res = await POST(makeMeasurementRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insertedCount).toBe(1);

    const insertCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('INSERT IGNORE INTO forestgeo_testing.temporarymeasurements')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[1].slice(0, 4)).toEqual(['SERC_census1_2025.csv', 'batch-1', 22, 32]);
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
      .mockResolvedValueOnce([{ PlotID: 22 }])
      .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ count: 1001 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    const res = await POST(makeMeasurementRequest({ fileRowSet: largeRowSet }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insertedCount).toBe(1001);

    const insertCalls = mockConnectionManager.executeQuery.mock.calls.filter((call: any[]) =>
      String(call[0]).includes('INSERT IGNORE INTO forestgeo_testing.temporarymeasurements')
    );
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0][1]).toHaveLength(1000 * 15);
    expect(insertCalls[1][1]).toHaveLength(15);
  });

  it('cleans up stale temporarymeasurements rows from older batches before starting a new batch', async () => {
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce([{ PlotID: 22 }])
      .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 10605 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    const res = await POST(makeMeasurementRequest());

    expect(res.status).toBe(200);

    const cleanupCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
      String(call[0]).includes('DELETE FROM forestgeo_testing.temporarymeasurements')
    );
    expect(cleanupCall).toBeDefined();
    expect(cleanupCall[1]).toEqual(['SERC_census1_2025.csv', 22, 32, 'batch-1']);
  });

  it('cleans up previous upload data and allows re-upload of the same file', async () => {
    mockConnectionManager.executeQuery
      // census scope check
      .mockResolvedValueOnce([{ PlotID: 22 }])
      // batch scope check
      .mockResolvedValueOnce([{ distinctPlotCount: 0, distinctCensusCount: 0, plotID: null, censusID: null }])
      // pre-insert count
      .mockResolvedValueOnce([{ count: 0 }])
      // cleanupPreviousFileUploads: find old batches
      .mockResolvedValueOnce([{ batchID: 'completed-batch-1' }])
      // cleanupPreviousFileUploads: delete cmverrors
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

    const res = await POST(makeMeasurementRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.insertedCount).toBe(1);
    expect(mockConnectionManager.commitTransaction).toHaveBeenCalledWith('tx-test');

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
});
