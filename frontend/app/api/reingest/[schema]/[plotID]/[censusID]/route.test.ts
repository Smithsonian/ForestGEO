// app/api/reingest/[schema]/[plotID]/[censusID]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
import ConnectionManager from '@/config/connectionmanager';

vi.mock('@/config/connectionmanager', () => {
  const executeQuery = vi.fn();
  const closeConnection = vi.fn();
  const cleanupStaleTransactions = vi.fn();
  const acquireApplicationLock = vi.fn();
  const withTransaction = vi.fn(async (fn: (transactionID: string) => Promise<unknown>) => fn('test-transaction-id'));
  const instance = {
    executeQuery,
    closeConnection,
    cleanupStaleTransactions,
    acquireApplicationLock,
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
    mockConnectionManager.acquireApplicationLock.mockResolvedValue(true);
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
        .mockResolvedValueOnce({ affectedRows: 2, insertId: 101 }); // insert into temp

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

      const selectCall = mockConnectionManager.executeQuery.mock.calls[0];
      expect(String(selectCall[0])).toContain('EXISTS (');
      expect(String(selectCall[0])).not.toContain('mel.IsResolved = FALSE');
      expect(mockConnectionManager.executeQuery.mock.calls.some((call: any[]) => String(call[0]).includes('SELECT COALESCE(MAX(id), 0) as maxId'))).toBe(false);
    });

    it('returns 200 with rowsMoved=0 when no unresolved rows exist', async () => {
      mockConnectionManager.executeQuery.mockResolvedValueOnce([]);

      const req = makeRequest('POST');
      const res = await POST(req, makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rowsMoved).toBe(0);
      expect(body.responseMessage).toMatch(/No failed measurement rows/i);
    });
  });

  describe('GET route (full reingestion + reconciliation)', () => {
    it('reprocesses rows and reconciles onto original CoreMeasurementIDs', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce(mockUnresolvedRows(10)) // move: unresolved source rows
        .mockResolvedValueOnce(undefined) // move: clear stale reingestion rows
        .mockResolvedValueOnce({ affectedRows: 10, insertId: 501 }) // move: insert temp rows
        .mockResolvedValueOnce([[{ message: 'Batch test-batch-id-12345 processed successfully: 8 records', batch_failed: false, records_failed: 0 }]]) // call bulkingestionprocess
        .mockResolvedValueOnce(undefined) // reconcile: drop temp map table
        .mockResolvedValueOnce(undefined) // reconcile: create temp map table
        .mockResolvedValueOnce(undefined) // reconcile: insert map chunk
        .mockResolvedValueOnce(undefined) // reconcile: resolve existing ingestion errors
        .mockResolvedValueOnce(undefined) // reconcile: transfer error logs from transient rows
        .mockResolvedValueOnce(undefined) // reconcile: drop temp reingestion_results
        .mockResolvedValueOnce(undefined) // reconcile: drop temp reingestion_attributes
        .mockResolvedValueOnce(undefined) // reconcile: create temp reingestion_results
        .mockResolvedValueOnce(undefined) // reconcile: snapshot transient rows
        .mockResolvedValueOnce(undefined) // reconcile: create temp reingestion_attributes
        .mockResolvedValueOnce(undefined) // reconcile: snapshot transient attributes
        .mockResolvedValueOnce(undefined) // reconcile: delete transient rows
        .mockResolvedValueOnce(undefined) // reconcile: sync original rows
        .mockResolvedValueOnce(undefined) // reconcile: clear original attributes
        .mockResolvedValueOnce(undefined) // reconcile: restore attributes
        .mockResolvedValueOnce([{ count: 8 }]) // reconcile: successful reingestions
        .mockResolvedValueOnce([{ count: 2 }]) // reconcile: remaining failures
        .mockResolvedValueOnce(undefined) // reconcile: final drop temp reingestion_attributes
        .mockResolvedValueOnce(undefined) // reconcile: final drop temp reingestion_results
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
      expect(calls.some((call: any[]) => String(call[0]).includes('SELECT COALESCE(MAX(id), 0) as maxId'))).toBe(false);

      const syncCall = calls.find((call: any[]) => String(call[0]).includes('SET orig.CensusID'));
      expect(syncCall).toBeDefined();
      expect(String(syncCall?.[0])).not.toContain('orig.UploadFileID');
      expect(String(syncCall?.[0])).not.toContain('orig.UploadBatchID');
      expect(String(syncCall?.[0])).not.toContain('orig.SourceRowIndex');

      expect(mockConnectionManager.withTransaction).toHaveBeenCalledTimes(1);
    });

    it('still reconciles rows when the ingestion procedure reports partial failures', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce(mockUnresolvedRows(3)) // move: unresolved source rows
        .mockResolvedValueOnce(undefined) // move: clear stale reingestion rows
        .mockResolvedValueOnce({ affectedRows: 3, insertId: 41 }) // move: insert temp rows
        .mockResolvedValueOnce([[{ message: 'Batch test-batch-id-12345 processed: 2 valid, 1 failed', batch_failed: false, records_failed: 1 }]]) // call bulkingestionprocess
        .mockResolvedValueOnce(undefined) // reconcile: drop temp map table
        .mockResolvedValueOnce(undefined) // reconcile: create temp map table
        .mockResolvedValueOnce(undefined) // reconcile: insert map chunk
        .mockResolvedValueOnce(undefined) // reconcile: resolve existing ingestion errors
        .mockResolvedValueOnce(undefined) // reconcile: transfer error logs from transient rows
        .mockResolvedValueOnce(undefined) // reconcile: drop temp reingestion_results
        .mockResolvedValueOnce(undefined) // reconcile: drop temp reingestion_attributes
        .mockResolvedValueOnce(undefined) // reconcile: create temp reingestion_results
        .mockResolvedValueOnce(undefined) // reconcile: snapshot transient rows
        .mockResolvedValueOnce(undefined) // reconcile: create temp reingestion_attributes
        .mockResolvedValueOnce(undefined) // reconcile: snapshot transient attributes
        .mockResolvedValueOnce(undefined) // reconcile: delete transient rows
        .mockResolvedValueOnce(undefined) // reconcile: sync original rows
        .mockResolvedValueOnce(undefined) // reconcile: clear original attributes
        .mockResolvedValueOnce(undefined) // reconcile: restore attributes
        .mockResolvedValueOnce([{ count: 2 }]) // reconcile: successful reingestions
        .mockResolvedValueOnce([{ count: 1 }]) // reconcile: remaining failures
        .mockResolvedValueOnce(undefined) // reconcile: final drop temp reingestion_attributes
        .mockResolvedValueOnce(undefined) // reconcile: final drop temp reingestion_results
        .mockResolvedValueOnce(undefined); // reconcile: final drop temp map table

      const req = makeRequest('GET');
      const res = await GET(req, makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalProcessed).toBe(3);
      expect(body.successfulReingestions).toBe(2);
      expect(body.remainingFailures).toBe(1);

      const syncCall = mockConnectionManager.executeQuery.mock.calls.find((call: any[]) => String(call[0]).includes('SET orig.CensusID'));
      expect(syncCall).toBeDefined();
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
        .mockResolvedValueOnce({ affectedRows: 1, insertId: 11 }) // move: insert temp rows
        .mockRejectedValueOnce(new Error('Bulk ingestion failed')); // call bulkingestionprocess

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
        .mockResolvedValueOnce({ affectedRows: 1, insertId: 1 });

      const req = makeRequest('POST');
      const res = await POST(req, makeParams());
      expect(res.status).toBe(200);

      const insertCall = mockConnectionManager.executeQuery.mock.calls.find(
        (call: any[]) => String(call[0]).includes('INSERT INTO') && String(call[0]).includes('temporarymeasurements')
      );

      expect(insertCall).toBeDefined();
      expect(insertCall[0]).toContain('Codes');
      const valuesParam = insertCall[1]?.[0];
      expect(Array.isArray(valuesParam)).toBe(true);
      expect(valuesParam[0][13]).toBe('AL'); // Codes value preserved in insert payload
    });
  });
});
