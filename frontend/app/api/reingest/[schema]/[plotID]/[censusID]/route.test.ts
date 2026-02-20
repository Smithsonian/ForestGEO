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

/** Helper: generate mock CoreMeasurementID rows (unresolved ingestion-error rows) */
function mockUnresolvedIds(count: number) {
  return Array.from({ length: count }, (_, i) => ({ CoreMeasurementID: i + 1 }));
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
    it('moves unresolved ingestion-error rows to temporarymeasurements', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ total: 5 }]) // 1. COUNT(DISTINCT cm.CoreMeasurementID) for unresolved rows
        .mockResolvedValueOnce(mockUnresolvedIds(5)) // 2. SELECT DISTINCT cm.CoreMeasurementID
        .mockResolvedValueOnce(undefined) // 3. DELETE FROM temporarymeasurements
        .mockResolvedValueOnce(undefined) // 4. INSERT INTO temporarymeasurements FROM coremeasurements
        .mockResolvedValueOnce(undefined) // 5. UPDATE measurement_error_log SET IsResolved = TRUE
        .mockResolvedValueOnce(undefined); // 6. DELETE FROM coremeasurements WHERE StemGUID IS NULL

      const req = makeRequest('POST');
      const res = await POST(req, makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rowsMoved).toBe(5);
      expect(body.fileID).toBe('reingestion.csv');
      expect(body.batchID).toBe('test-batch-id-12345');

      expect(mockConnectionManager.closeConnection).toHaveBeenCalledTimes(1);
      expect(mockConnectionManager.executeQuery).toHaveBeenCalledTimes(6);
    });

    it('returns 200 with rowsMoved=0 when no unresolved rows exist', async () => {
      mockConnectionManager.executeQuery.mockResolvedValueOnce([{ total: 0 }]);

      const req = makeRequest('POST');
      const res = await POST(req, makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rowsMoved).toBe(0);
      expect(body.responseMessage).toMatch(/No unresolved ingestion-error rows/i);
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
        .mockResolvedValueOnce([{ total: 10 }]) // 1. COUNT unresolved rows
        .mockResolvedValueOnce(mockUnresolvedIds(10)) // 2. SELECT CoreMeasurementID
        .mockResolvedValueOnce(undefined) // 3. DELETE FROM temporarymeasurements
        .mockResolvedValueOnce(undefined) // 4. INSERT INTO temporarymeasurements
        .mockResolvedValueOnce(undefined) // 5. CALL bulkingestionprocess
        .mockResolvedValueOnce(undefined) // 6. UPDATE measurement_error_log (resolve)
        .mockResolvedValueOnce(undefined) // 7. DELETE FROM coremeasurements (old unresolved)
        .mockResolvedValueOnce([{ remaining: 2 }]); // 8. COUNT remaining unresolved

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
    });

    it('returns 200 with 0 processed when no unresolved rows exist', async () => {
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
        .mockResolvedValueOnce([{ total: 5 }]) // 1. COUNT unresolved
        .mockResolvedValueOnce(mockUnresolvedIds(5)) // 2. SELECT CoreMeasurementID
        .mockResolvedValueOnce(undefined) // 3. DELETE FROM temporarymeasurements
        .mockResolvedValueOnce(undefined) // 4. INSERT INTO temporarymeasurements
        .mockResolvedValueOnce(undefined) // 5. CALL bulkingestionprocess
        .mockResolvedValueOnce(undefined) // 6. UPDATE measurement_error_log (resolve)
        .mockResolvedValueOnce(undefined) // 7. DELETE FROM coremeasurements
        .mockResolvedValueOnce([{ remaining: 0 }]); // 8. All successful

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
        .mockResolvedValueOnce([{ total: 5 }]) // 1. COUNT unresolved
        .mockResolvedValueOnce(mockUnresolvedIds(5)) // 2. SELECT CoreMeasurementID
        .mockResolvedValueOnce(undefined) // 3. DELETE FROM temporarymeasurements
        .mockRejectedValueOnce(new Error('Bulk ingestion failed')); // 4. INSERT fails

      const req = makeRequest('GET');
      const res = await GET(req, makeParams());

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Bulk ingestion failed');
      expect(mockConnectionManager.closeConnection).toHaveBeenCalledTimes(1);
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
    it('should preserve RawCodes field when moving to temporarymeasurements', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ total: 1 }]) // 1. COUNT unresolved
        .mockResolvedValueOnce(mockUnresolvedIds(1)) // 2. SELECT CoreMeasurementID
        .mockResolvedValueOnce(undefined) // 3. DELETE FROM temporarymeasurements
        .mockResolvedValueOnce({ insertId: 1, affectedRows: 1 }) // 4. INSERT INTO temporarymeasurements
        .mockResolvedValueOnce(undefined) // 5. UPDATE measurement_error_log (resolve)
        .mockResolvedValueOnce(undefined); // 6. DELETE FROM coremeasurements

      const req = makeRequest('POST');
      const res = await POST(req, makeParams());

      expect(res.status).toBe(200);

      // Verify the INSERT query includes the Codes field mapped from RawCodes
      const insertCall = mockConnectionManager.executeQuery.mock.calls.find(
        (call: any) => call[0]?.includes('INSERT IGNORE INTO') && call[0]?.includes('temporarymeasurements')
      );

      expect(insertCall).toBeDefined();
      expect(insertCall[0]).toContain('Codes');
      expect(insertCall[0]).toContain('cm.RawCodes'); // Maps from coremeasurements.RawCodes
    });

    it('should complete GET reingestion end-to-end', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ total: 5 }]) // 1. COUNT unresolved
        .mockResolvedValueOnce(mockUnresolvedIds(5)) // 2. SELECT CoreMeasurementID
        .mockResolvedValueOnce(undefined) // 3. DELETE FROM temporarymeasurements
        .mockResolvedValueOnce(undefined) // 4. INSERT INTO temporarymeasurements
        .mockResolvedValueOnce(undefined) // 5. CALL bulkingestionprocess
        .mockResolvedValueOnce(undefined) // 6. UPDATE measurement_error_log (resolve)
        .mockResolvedValueOnce(undefined) // 7. DELETE FROM coremeasurements
        .mockResolvedValueOnce([{ remaining: 0 }]); // 8. Count remaining

      const req = makeRequest('GET');
      const res = await GET(req, makeParams());

      expect(res.status).toBe(200);
    });

    it('should handle rows with codes correctly in bulk ingestion', async () => {
      // This test verifies the complete flow:
      // coremeasurements (StemGUID IS NULL, with RawCodes) → temporarymeasurements → bulkingestionprocess → cmattributes

      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ total: 1 }]) // 1. COUNT unresolved
        .mockResolvedValueOnce(mockUnresolvedIds(1)) // 2. SELECT CoreMeasurementID
        .mockResolvedValueOnce(undefined) // 3. DELETE FROM temporarymeasurements
        .mockResolvedValueOnce(undefined) // 4. INSERT INTO temporarymeasurements
        .mockResolvedValueOnce(undefined) // 5. CALL bulkingestionprocess
        .mockResolvedValueOnce(undefined) // 6. UPDATE measurement_error_log (resolve)
        .mockResolvedValueOnce(undefined) // 7. DELETE FROM coremeasurements
        .mockResolvedValueOnce([{ remaining: 0 }]); // 8. All succeeded

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
