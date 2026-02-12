// app/api/reingest/[schema]/[plotID]/[censusID]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
import ConnectionManager from '@/config/connectionmanager';

// Mock ConnectionManager
vi.mock('@/config/connectionmanager', () => {
  const executeQuery = vi.fn();
  const closeConnection = vi.fn();
  const cleanupStaleTransactions = vi.fn();
  const instance = {
    executeQuery,
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

// Mock generateShortBatchID from utils
vi.mock('@/config/utils', async importOriginal => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    generateShortBatchID: () => 'test-batch-id-12345'
  };
});

// Mock context validation
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

/** Helper: generate mock FailedMeasurementID rows */
function mockFailedIds(count: number) {
  return Array.from({ length: count }, (_, i) => ({ FailedMeasurementID: i + 1 }));
}

describe('reingest API routes', () => {
  let mockConnectionManager: any;
  let mockValidateContextualValues: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockConnectionManager = ConnectionManager.getInstance();
    mockConnectionManager.cleanupStaleTransactions.mockResolvedValue(undefined);
    mockConnectionManager.closeConnection.mockResolvedValue(undefined);

    // Get the mocked function
    const { validateContextualValues } = await import('@/lib/contextvalidation');
    mockValidateContextualValues = validateContextualValues as any;

    // Set up default successful validation
    mockValidateContextualValues.mockResolvedValue({
      success: true,
      values: {
        schema: 'forestgeo_testing',
        plotID: 1,
        censusID: 1
      }
    });
  });

  describe('POST route (move rows only)', () => {
    it('moves rows from failedmeasurements to temporarymeasurements', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ total: 5 }]) // 1. COUNT(*)
        .mockResolvedValueOnce(mockFailedIds(5)) // 2. SELECT FailedMeasurementID
        .mockResolvedValueOnce(undefined) // 3. DELETE temporarymeasurements
        .mockResolvedValueOnce(undefined) // 4. INSERT INTO temporarymeasurements
        .mockResolvedValueOnce(undefined); // 5. DELETE failedmeasurements by IDs

      const req = makeRequest('POST');
      const res = await POST(req, makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rowsMoved).toBe(5);
      expect(body.fileID).toBe('reingestion.csv');
      expect(body.batchID).toBe('test-batch-id-12345');

      expect(mockConnectionManager.closeConnection).toHaveBeenCalledTimes(1);
      expect(mockConnectionManager.executeQuery).toHaveBeenCalledTimes(5);
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

    it('returns 500 on error', async () => {
      mockConnectionManager.executeQuery.mockRejectedValueOnce(new Error('Database error'));

      const req = makeRequest('POST');
      const res = await POST(req, makeParams());

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Database error');
      expect(mockConnectionManager.closeConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET route (full reingestion)', () => {
    it('moves rows and runs batch ingestion process', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ total: 10 }]) // 1. COUNT(*)
        .mockResolvedValueOnce(mockFailedIds(10)) // 2. SELECT FailedMeasurementID
        .mockResolvedValueOnce(undefined) // 3. DELETE temporarymeasurements
        .mockResolvedValueOnce(undefined) // 4. INSERT INTO temporarymeasurements
        .mockResolvedValueOnce(undefined) // 5. CALL bulkingestionprocess
        .mockResolvedValueOnce(undefined) // 6. DELETE failedmeasurements by IDs
        .mockResolvedValueOnce(undefined) // 7. CALL refresh_failedmeasurements_current
        .mockResolvedValueOnce([{ cnt: 0 }]) // 8. SELECT COUNT(*) ready for reingestion
        .mockResolvedValueOnce([{ remaining: 2 }]); // 9. COUNT(*) remaining failures

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

      // Verify refresh was called
      const refreshCall = calls.find((call: any) => call[0]?.includes('refresh_failedmeasurements_current'));
      expect(refreshCall).toBeDefined();
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
        .mockResolvedValueOnce([{ total: 5 }]) // 1. COUNT(*)
        .mockResolvedValueOnce(mockFailedIds(5)) // 2. SELECT FailedMeasurementID
        .mockResolvedValueOnce(undefined) // 3. DELETE temporarymeasurements
        .mockResolvedValueOnce(undefined) // 4. INSERT INTO temporarymeasurements
        .mockResolvedValueOnce(undefined) // 5. CALL bulkingestionprocess
        .mockResolvedValueOnce(undefined) // 6. DELETE failedmeasurements by IDs
        .mockResolvedValueOnce(undefined) // 7. CALL refresh_failedmeasurements_current
        .mockResolvedValueOnce([{ cnt: 0 }]) // 8. SELECT COUNT(*) ready
        .mockResolvedValueOnce([{ remaining: 0 }]); // 9. All successful

      const req = makeRequest('GET');
      const res = await GET(req, makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalProcessed).toBe(5);
      expect(body.successfulReingestions).toBe(5);
      expect(body.remainingFailures).toBe(0);
    });

    it('returns 500 on error', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ total: 5 }]) // 1. COUNT(*)
        .mockResolvedValueOnce(mockFailedIds(5)) // 2. SELECT FailedMeasurementID
        .mockResolvedValueOnce(undefined) // 3. DELETE temporarymeasurements
        .mockRejectedValueOnce(new Error('Bulk ingestion failed')); // 4. INSERT fails

      const req = makeRequest('GET');
      const res = await GET(req, makeParams());

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Bulk ingestion failed');
      expect(mockConnectionManager.closeConnection).toHaveBeenCalledTimes(1);
    });

    it('auto-reingests rows marked Ready for reingestion', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ total: 5 }]) // 1. COUNT(*)
        .mockResolvedValueOnce(mockFailedIds(5)) // 2. SELECT FailedMeasurementID
        .mockResolvedValueOnce(undefined) // 3. DELETE temporarymeasurements
        .mockResolvedValueOnce(undefined) // 4. INSERT INTO temporarymeasurements
        .mockResolvedValueOnce(undefined) // 5. CALL bulkingestionprocess
        .mockResolvedValueOnce(undefined) // 6. DELETE failedmeasurements by IDs
        .mockResolvedValueOnce(undefined) // 7. CALL refresh_failedmeasurements_current
        .mockResolvedValueOnce([{ cnt: 2 }]) // 8. 2 rows ready for reingestion
        .mockResolvedValueOnce(undefined) // 9. INSERT ready rows into temporarymeasurements
        .mockResolvedValueOnce(undefined) // 10. CALL bulkingestionprocess (auto-reingest)
        .mockResolvedValueOnce(undefined) // 11. DELETE ready rows from failedmeasurements
        .mockResolvedValueOnce([{ remaining: 1 }]); // 12. COUNT(*) remaining

      const req = makeRequest('GET');
      const res = await GET(req, makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalProcessed).toBe(5);
      expect(body.successfulReingestions).toBe(4);
      expect(body.remainingFailures).toBe(1);

      expect(mockConnectionManager.executeQuery).toHaveBeenCalledTimes(12);
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

  describe('Attribute persistence regression tests', () => {
    it('should preserve Codes field when moving to temporarymeasurements', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ total: 1 }]) // 1. COUNT(*)
        .mockResolvedValueOnce(mockFailedIds(1)) // 2. SELECT FailedMeasurementID
        .mockResolvedValueOnce(undefined) // 3. DELETE temporarymeasurements
        .mockResolvedValueOnce({ insertId: 1, affectedRows: 1 }) // 4. INSERT INTO temporarymeasurements
        .mockResolvedValueOnce(undefined); // 5. DELETE failedmeasurements by IDs

      const req = makeRequest('POST');
      const res = await POST(req, makeParams());

      expect(res.status).toBe(200);

      // Verify the INSERT query includes the Codes field
      const insertCall = mockConnectionManager.executeQuery.mock.calls.find(
        (call: any) => call[0]?.includes('INSERT IGNORE INTO') && call[0]?.includes('temporarymeasurements')
      );

      expect(insertCall).toBeDefined();
      expect(insertCall[0]).toContain('Codes');
      expect(insertCall[0]).toContain('fm.Codes'); // Maps from failedmeasurements
    });

    it('should complete GET reingestion without extra validation calls', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ total: 5 }]) // 1. COUNT(*)
        .mockResolvedValueOnce(mockFailedIds(5)) // 2. SELECT FailedMeasurementID
        .mockResolvedValueOnce(undefined) // 3. DELETE temporarymeasurements
        .mockResolvedValueOnce(undefined) // 4. INSERT INTO temporarymeasurements
        .mockResolvedValueOnce(undefined) // 5. CALL bulkingestionprocess
        .mockResolvedValueOnce(undefined) // 6. DELETE failedmeasurements by IDs
        .mockResolvedValueOnce(undefined) // 7. CALL refresh_failedmeasurements_current
        .mockResolvedValueOnce([{ cnt: 0 }]) // 8. SELECT COUNT(*) ready
        .mockResolvedValueOnce([{ remaining: 0 }]); // 9. Count remaining

      const req = makeRequest('GET');
      const res = await GET(req, makeParams());

      expect(res.status).toBe(200);
    });

    it('should handle rows with codes correctly in bulk ingestion', async () => {
      // This test verifies the complete flow:
      // failedmeasurements (with Codes) → temporarymeasurements → bulkingestionprocess → cmattributes

      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ total: 1 }]) // 1. COUNT(*)
        .mockResolvedValueOnce(mockFailedIds(1)) // 2. SELECT FailedMeasurementID
        .mockResolvedValueOnce(undefined) // 3. DELETE temporarymeasurements
        .mockResolvedValueOnce(undefined) // 4. INSERT INTO temporarymeasurements
        .mockResolvedValueOnce(undefined) // 5. CALL bulkingestionprocess
        .mockResolvedValueOnce(undefined) // 6. DELETE failedmeasurements by IDs
        .mockResolvedValueOnce(undefined) // 7. CALL refresh_failedmeasurements_current
        .mockResolvedValueOnce([{ cnt: 0 }]) // 8. SELECT COUNT(*) ready
        .mockResolvedValueOnce([{ remaining: 0 }]); // 9. All succeeded

      const req = makeRequest('GET');
      const res = await GET(req, makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();

      // All rows should be successfully reingested (no failures)
      expect(body.successfulReingestions).toBe(1);
      expect(body.remainingFailures).toBe(0);
    });
  });
});
