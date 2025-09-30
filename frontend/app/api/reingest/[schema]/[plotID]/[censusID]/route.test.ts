// app/api/reingest/[schema]/[plotID]/[censusID]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
import ailogger from '@/ailogger';
import ConnectionManager from '@/config/connectionmanager';

// Mock ConnectionManager
vi.mock('@/config/connectionmanager', () => {
  const executeQuery = vi.fn();
  const beginTransaction = vi.fn();
  const commitTransaction = vi.fn();
  const rollbackTransaction = vi.fn();
  const closeConnection = vi.fn();
  const cleanupStaleTransactions = vi.fn();
  const instance = {
    executeQuery,
    beginTransaction,
    commitTransaction,
    rollbackTransaction,
    closeConnection,
    cleanupStaleTransactions
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

// Mock uuid
vi.mock('uuid', () => ({
  v4: () => 'test-batch-id-12345'
}));

// Mock context validation
vi.mock('@/lib/contextvalidation', () => ({
  validateContextualValues: vi.fn()
}));

function makeRequest(method = 'GET') {
  return new Request(`http://localhost/api/reingest/testschema/1/1`, {
    method,
    headers: { 'content-type': 'application/json' }
  }) as any;
}

function makeParams() {
  return {
    params: Promise.resolve({
      schema: 'testschema',
      plotID: '1',
      censusID: '1'
    })
  } as any;
}

describe('reingest API routes', () => {
  let mockConnectionManager: any;
  let mockValidateContextualValues: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockConnectionManager = ConnectionManager.getInstance();
    mockConnectionManager.cleanupStaleTransactions.mockResolvedValue(undefined);
    mockConnectionManager.beginTransaction.mockResolvedValue('test-transaction-id');
    mockConnectionManager.commitTransaction.mockResolvedValue(undefined);
    mockConnectionManager.rollbackTransaction.mockResolvedValue(undefined);
    mockConnectionManager.closeConnection.mockResolvedValue(undefined);

    // Get the mocked function
    const { validateContextualValues } = await import('@/lib/contextvalidation');
    mockValidateContextualValues = validateContextualValues as any;

    // Set up default successful validation
    mockValidateContextualValues.mockResolvedValue({
      success: true,
      values: {
        schema: 'testschema',
        plotID: 1,
        censusID: 1
      }
    });
  });

  describe('POST route (move rows only)', () => {
    it('moves rows from failedmeasurements to temporarymeasurements', async () => {
      // Mock count query
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ total: 5 }]) // Count query
        .mockResolvedValueOnce(undefined) // DELETE temporarymeasurements
        .mockResolvedValueOnce(undefined) // INSERT INTO temporarymeasurements
        .mockResolvedValueOnce(undefined); // DELETE failedmeasurements

      const req = makeRequest('POST');
      const res = await POST(req, makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rowsMoved).toBe(5);
      expect(body.fileID).toBe('reingestion.csv');
      expect(body.batchID).toBe('test-batch-id-12345');

      // Verify transaction management
      expect(mockConnectionManager.beginTransaction).toHaveBeenCalledTimes(1);
      expect(mockConnectionManager.commitTransaction).toHaveBeenCalledTimes(1);
      expect(mockConnectionManager.closeConnection).toHaveBeenCalledTimes(1);

      // Verify queries were called
      expect(mockConnectionManager.executeQuery).toHaveBeenCalledTimes(4);
    });

    it('returns 200 with rowsMoved=0 when no failed measurements exist', async () => {
      mockConnectionManager.executeQuery.mockResolvedValueOnce([{ total: 0 }]);

      const req = makeRequest('POST');
      const res = await POST(req, makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rowsMoved).toBe(0);
      expect(body.responseMessage).toMatch(/No failed measurements found/i);
    });

    it('rolls back transaction on error', async () => {
      mockConnectionManager.executeQuery.mockRejectedValueOnce(new Error('Database error'));

      const req = makeRequest('POST');
      const res = await POST(req, makeParams());

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Database error');
      expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET route (full reingestion)', () => {
    it('moves rows and runs batch ingestion process', async () => {
      // Mock all queries for full reingestion
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ total: 10 }]) // Count query
        .mockResolvedValueOnce(undefined) // DELETE temporarymeasurements
        .mockResolvedValueOnce(undefined) // INSERT INTO temporarymeasurements
        .mockResolvedValueOnce(undefined) // DELETE failedmeasurements
        .mockResolvedValueOnce(undefined) // CALL bulkingestionprocess
        .mockResolvedValueOnce([{ remaining: 2 }]) // Count remaining failures
        .mockResolvedValueOnce(undefined); // CALL reviewfailed

      const req = makeRequest('GET');
      const res = await GET(req, makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalProcessed).toBe(10);
      expect(body.successfulReingestions).toBe(8);
      expect(body.remainingFailures).toBe(2);

      // Verify bulkingestionprocess was called
      const calls = mockConnectionManager.executeQuery.mock.calls;
      const bulkIngestionCall = calls.find((call: any) => call[0]?.includes('bulkingestionprocess'));
      expect(bulkIngestionCall).toBeDefined();

      // Verify reviewfailed was called
      const reviewFailedCall = calls.find((call: any) => call[0]?.includes('reviewfailed'));
      expect(reviewFailedCall).toBeDefined();
    });

    it('returns 200 with 0 processed when no failed measurements exist', async () => {
      mockConnectionManager.executeQuery.mockResolvedValueOnce([{ total: 0 }]);

      const req = makeRequest('GET');
      const res = await GET(req, makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalProcessed).toBe(0);
      expect(body.successfulReingestions).toBe(0);
      expect(body.remainingFailures).toBe(0);
    });

    it('handles all rows successfully reingested', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ total: 5 }])
        .mockResolvedValueOnce(undefined) // DELETE temporarymeasurements
        .mockResolvedValueOnce(undefined) // INSERT INTO temporarymeasurements
        .mockResolvedValueOnce(undefined) // DELETE failedmeasurements
        .mockResolvedValueOnce(undefined) // CALL bulkingestionprocess
        .mockResolvedValueOnce([{ remaining: 0 }]) // All successful
        .mockResolvedValueOnce(undefined); // CALL reviewfailed

      const req = makeRequest('GET');
      const res = await GET(req, makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalProcessed).toBe(5);
      expect(body.successfulReingestions).toBe(5);
      expect(body.remainingFailures).toBe(0);
    });

    it('rolls back and tries to run reviewfailed on error', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ total: 5 }])
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Bulk ingestion failed'));

      const req = makeRequest('GET');
      const res = await GET(req, makeParams());

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Bulk ingestion failed');
      expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalledTimes(1);

      // Should attempt to run reviewfailed even after error
      const reviewFailedCall = mockConnectionManager.executeQuery.mock.calls.find((call: any) => call[0]?.includes('reviewfailed'));
      expect(reviewFailedCall).toBeDefined();
    });
  });

  describe('Parameter validation', () => {
    it('validates plotID and censusID are numbers', async () => {
      const invalidParams = {
        params: Promise.resolve({
          schema: 'testschema',
          plotID: 'invalid',
          censusID: '1'
        })
      } as any;

      // Mock validation to fail
      mockValidateContextualValues.mockResolvedValueOnce({
        success: false,
        response: new Response(JSON.stringify({ error: 'Invalid parameters' }), { status: 400 })
      });

      const req = makeRequest('POST');
      const res = await POST(req, invalidParams);

      expect(res.status).toBe(400);
    });
  });
});
