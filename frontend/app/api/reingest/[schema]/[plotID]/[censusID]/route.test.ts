// app/api/reingest/[schema]/[plotID]/[censusID]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
import ConnectionManager from '@/config/connectionmanager';

vi.mock('@/config/connectionmanager', () => {
  const executeQuery = vi.fn();
  const closeConnection = vi.fn();
  const cleanupStaleTransactions = vi.fn();
  const withTransaction = vi.fn(async (fn: (transactionID: string) => Promise<unknown>) => fn('test-transaction-id'));
  const instance = {
    executeQuery,
    closeConnection,
    cleanupStaleTransactions,
    withTransaction
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

vi.mock('@/lib/contextvalidation', () => ({
  validateContextualValues: vi.fn()
}));

function makeRequest(method = 'GET') {
  return new Request(`http://localhost/api/reingest/forestgeo_testing/1/1`, {
    method,
    headers: { 'content-type': 'application/json' }
  }) as any;
}

function makeParams() {
  return {
    params: Promise.resolve({
      schema: 'forestgeo_testing',
      plotID: '1',
      censusID: '1'
    })
  } as any;
}

function mockUnresolvedRows(count: number) {
  return Array.from({ length: count }, (_, idx) => ({
    CoreMeasurementID: idx + 1,
    PlotID: 1,
    CensusID: 1,
    RawTreeTag: `T-${idx + 1}`,
    RawStemTag: '1',
    RawSpCode: 'ACRU',
    RawQuadrat: 'Q01',
    RawX: 1.23,
    RawY: 4.56,
    MeasuredDBH: 12.3,
    MeasuredHOM: 1.3,
    MeasurementDate: '2024-01-01',
    RawCodes: idx === 0 ? 'AL' : null,
    RawComments: null
  }));
}

describe('reingest API routes', () => {
  let mockConnectionManager: any;
  let mockValidateContextualValues: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockConnectionManager = ConnectionManager.getInstance();
    mockConnectionManager.cleanupStaleTransactions.mockResolvedValue(undefined);
    mockConnectionManager.closeConnection.mockResolvedValue(undefined);
    mockConnectionManager.withTransaction.mockImplementation(async (fn: (transactionID: string) => Promise<unknown>) => fn('test-transaction-id'));

    const { validateContextualValues } = await import('@/lib/contextvalidation');
    mockValidateContextualValues = validateContextualValues as any;
    mockValidateContextualValues.mockResolvedValue({
      success: true,
      values: {
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 1
      }
    });
  });

  describe('POST route (stage only)', () => {
    it('stages unresolved ingestion rows and retains originals', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce(mockUnresolvedRows(2)) // unresolved source rows
        .mockResolvedValueOnce(undefined) // clear stale reingestion rows in temp
        .mockResolvedValueOnce([{ maxId: 100 }]) // max temp id
        .mockResolvedValueOnce({ affectedRows: 2 }); // insert into temp

      const req = makeRequest('POST');
      const res = await POST(req, makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rowsMoved).toBe(2);
      expect(body.fileID).toBe('reingestion.csv');
      expect(body.batchID).toBe('test-batch-id-12345');
      expect(body.originalsRetained).toBe(true);

      expect(mockConnectionManager.withTransaction).toHaveBeenCalledTimes(1);
      expect(mockConnectionManager.closeConnection).toHaveBeenCalledTimes(1);
    });

    it('returns 200 with rowsMoved=0 when no unresolved rows exist', async () => {
      mockConnectionManager.executeQuery.mockResolvedValueOnce([]);

      const req = makeRequest('POST');
      const res = await POST(req, makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rowsMoved).toBe(0);
      expect(body.responseMessage).toMatch(/No unresolved ingestion-error rows/i);
    });
  });

  describe('GET route (full reingestion + reconciliation)', () => {
    it('reprocesses rows and reconciles onto original CoreMeasurementIDs', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce(mockUnresolvedRows(10)) // move: unresolved source rows
        .mockResolvedValueOnce(undefined) // move: clear stale reingestion rows
        .mockResolvedValueOnce([{ maxId: 500 }]) // move: max temp id
        .mockResolvedValueOnce({ affectedRows: 10 }) // move: insert temp rows
        .mockResolvedValueOnce(undefined) // call bulkingestionprocess
        .mockResolvedValueOnce(undefined) // reconcile: drop temp map table
        .mockResolvedValueOnce(undefined) // reconcile: create temp map table
        .mockResolvedValueOnce(undefined) // reconcile: insert map chunk
        .mockResolvedValueOnce(undefined) // reconcile: resolve existing ingestion errors
        .mockResolvedValueOnce(undefined) // reconcile: transfer error logs from transient rows
        .mockResolvedValueOnce(undefined) // reconcile: sync original rows
        .mockResolvedValueOnce([{ count: 8 }]) // reconcile: successful reingestions
        .mockResolvedValueOnce([{ count: 2 }]) // reconcile: remaining failures
        .mockResolvedValueOnce(undefined) // reconcile: delete transient rows
        .mockResolvedValueOnce(undefined); // reconcile: final drop temp map table

      const req = makeRequest('GET');
      const res = await GET(req, makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalProcessed).toBe(10);
      expect(body.successfulReingestions).toBe(8);
      expect(body.remainingFailures).toBe(2);

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const bulkProcessCall = calls.find((call: any[]) => String(call[0]).includes('bulkingestionprocess'));
      expect(bulkProcessCall).toBeDefined();

      const syncCall = calls.find((call: any[]) => String(call[0]).includes('SET orig.CensusID'));
      expect(syncCall).toBeDefined();
      expect(String(syncCall?.[0])).not.toContain('orig.UploadFileID');
      expect(String(syncCall?.[0])).not.toContain('orig.UploadBatchID');
      expect(String(syncCall?.[0])).not.toContain('orig.SourceRowIndex');

      expect(mockConnectionManager.withTransaction).toHaveBeenCalledTimes(2); // stage + reconcile
    });

    it('returns 200 with 0 processed when no unresolved rows exist', async () => {
      mockConnectionManager.executeQuery.mockResolvedValueOnce([]);

      const req = makeRequest('GET');
      const res = await GET(req, makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalProcessed).toBe(0);
      expect(body.successfulReingestions).toBe(0);
      expect(body.remainingFailures).toBe(0);
    });

    it('returns 500 when batch ingestion fails', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce(mockUnresolvedRows(1)) // move: unresolved source rows
        .mockResolvedValueOnce(undefined) // move: clear stale reingestion rows
        .mockResolvedValueOnce([{ maxId: 10 }]) // move: max temp id
        .mockResolvedValueOnce({ affectedRows: 1 }) // move: insert temp rows
        .mockRejectedValueOnce(new Error('Bulk ingestion failed'));

      const req = makeRequest('GET');
      const res = await GET(req, makeParams());

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Bulk ingestion failed');
      expect(mockConnectionManager.closeConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe('regression coverage', () => {
    it('preserves RawCodes values when staging failed rows to temporarymeasurements', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce(mockUnresolvedRows(1))
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ maxId: 0 }])
        .mockResolvedValueOnce({ affectedRows: 1 });

      const req = makeRequest('POST');
      const res = await POST(req, makeParams());
      expect(res.status).toBe(200);

      const insertCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) =>
        String(call[0]).includes('INSERT INTO') && String(call[0]).includes('temporarymeasurements')
      );

      expect(insertCall).toBeDefined();
      expect(insertCall[0]).toContain('Codes');
      const valuesParam = insertCall[1]?.[0];
      expect(Array.isArray(valuesParam)).toBe(true);
      expect(valuesParam[0][14]).toBe('AL'); // Codes value preserved in insert payload
    });
  });
});
