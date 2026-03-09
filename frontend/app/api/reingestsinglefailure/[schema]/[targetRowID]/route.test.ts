import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import ConnectionManager from '@/config/connectionmanager';

vi.mock('@/config/connectionmanager', () => {
  const beginTransaction = vi.fn();
  const executeQuery = vi.fn();
  const commitTransaction = vi.fn();
  const rollbackTransaction = vi.fn();
  const closeConnection = vi.fn();
  const instance = {
    beginTransaction,
    executeQuery,
    commitTransaction,
    rollbackTransaction,
    closeConnection
  };
  return {
    default: {
      getInstance: () => instance
    }
  };
});

vi.mock('@/ailogger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('@/config/utils', async importOriginal => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    generateShortBatchID: () => 'test-batch-id-12345'
  };
});

function makeParams(schema = 'forestgeo_testing', targetRowID = '123') {
  return {
    params: Promise.resolve({ schema, targetRowID })
  } as any;
}

describe('reingestsinglefailure API route', () => {
  let mockConnectionManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionManager = ConnectionManager.getInstance();
    mockConnectionManager.beginTransaction.mockResolvedValue('txn-1');
    mockConnectionManager.commitTransaction.mockResolvedValue(undefined);
    mockConnectionManager.rollbackTransaction.mockResolvedValue(undefined);
    mockConnectionManager.closeConnection.mockResolvedValue(undefined);
  });

  it('returns 400 when targetRowID is not a positive integer', async () => {
    const req = new Request('http://localhost/api/reingestsinglefailure/forestgeo_testing/abc') as any;
    const res = await GET(req, makeParams('forestgeo_testing', 'abc'));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/positive integer/i);
    expect(mockConnectionManager.beginTransaction).not.toHaveBeenCalled();
  });

  it('reconciles onto original row without overwriting upload metadata fields', async () => {
    mockConnectionManager.executeQuery
      .mockResolvedValueOnce({ affectedRows: 1, insertId: 501 }) // shift into temporarymeasurements
      .mockResolvedValueOnce(undefined) // bulkingestionprocess
      .mockResolvedValueOnce([
        {
          CensusID: 1,
          StemGUID: 77,
          IsValidated: null,
          MeasurementDate: '2024-06-15',
          MeasuredDBH: 12.3,
          MeasuredHOM: 1.3,
          Description: null,
          UserDefinedFields: null,
          RawTreeTag: 'T-1',
          RawStemTag: '1',
          RawSpCode: 'ACRU',
          RawQuadrat: 'Q01',
          RawX: 1.23,
          RawY: 4.56,
          RawCodes: 'AL',
          RawComments: null,
          IsActive: 1
        }
      ]) // snapshot result row
      .mockResolvedValueOnce([{ Code: 'AL' }]) // snapshot attributes
      .mockResolvedValueOnce(undefined) // resolve ingestion errors
      .mockResolvedValueOnce(undefined) // transfer errors
      .mockResolvedValueOnce(undefined) // delete transient row
      .mockResolvedValueOnce(undefined) // sync original row
      .mockResolvedValueOnce(undefined) // clear original attributes
      .mockResolvedValueOnce(undefined); // restore original attributes

    const req = new Request('http://localhost/api/reingestsinglefailure/forestgeo_testing/123') as any;
    const res = await GET(req, makeParams('forestgeo_testing', '123'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Success');

    const calls = mockConnectionManager.executeQuery.mock.calls;
    const shiftCall = calls.find((call: any[]) => String(call[0]).includes('INSERT INTO') && String(call[0]).includes('temporarymeasurements'));
    expect(shiftCall).toBeDefined();
    expect(String(shiftCall?.[0])).toContain('EXISTS (');
    expect(String(shiftCall?.[0])).not.toContain('mel.IsResolved = FALSE');
    expect(calls.some((call: any[]) => String(call[0]).includes('SELECT COALESCE(MAX(id), 0) as maxId'))).toBe(false);

    const syncCall = calls.find((call: any[]) => String(call[0]).includes('SET orig.CensusID'));
    expect(syncCall).toBeDefined();
    expect(String(syncCall?.[0])).not.toContain('orig.UploadFileID');
    expect(String(syncCall?.[0])).not.toContain('orig.UploadBatchID');
    expect(String(syncCall?.[0])).not.toContain('orig.SourceRowIndex');
  });
});
