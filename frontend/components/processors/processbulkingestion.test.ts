/**
 * @fileoverview Unit tests for bulk ingestion processor functions
 *
 * This test suite validates the processBulkIngestionCollapser function which handles:
 * - Orphaned trees cleanup
 * - Zero value normalization
 * - Duplicate record removal (StemGUID+MeasurementDate)
 * - Duplicate record removal (TreeTag+StemTag)
 * - Validation error cleanup after deduplication
 *
 * @see /components/processors/processbulkingestion.tsx
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processBulkIngestionCollapser } from './processbulkingestion';
import ConnectionManager from '@/config/connectionmanager';

// Mock dependencies
vi.mock('@/config/connectionmanager');
vi.mock('@/config/utils/sqlsecurity', () => ({
  safeFormatQuery: vi.fn((schema, query) => query.replace(/\?\?/g, schema))
}));
vi.mock('@/config/utils', () => ({
  createError: vi.fn((message: string, error?: any) => {
    const err = new Error(message);
    if (error) {
      Object.assign(err, error);
    }
    return err;
  })
}));

describe('processBulkIngestionCollapser', () => {
  let mockConnectionManager: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock ConnectionManager
    mockConnectionManager = {
      executeQuery: vi.fn(() => Promise.resolve([]))
    };

    (ConnectionManager as any).getInstance = vi.fn(() => mockConnectionManager);
  });

  describe('Orphaned Trees Handling', () => {
    it('should update orphaned trees with census ID', async () => {
      // Mock: Found 2 orphaned trees
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ TreeID: 101 }, { TreeID: 102 }]) // SELECT orphaned trees
        .mockResolvedValueOnce([]) // UPDATE orphaned trees
        .mockResolvedValueOnce([]) // UPDATE MeasuredDBH
        .mockResolvedValueOnce([]) // UPDATE MeasuredHOM
        .mockResolvedValueOnce([]) // DELETE duplicates (StemGUID)
        .mockResolvedValueOnce([]) // DELETE duplicates (TreeTag+StemTag)
        .mockResolvedValueOnce([]); // DELETE validation errors

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      // Verify orphaned trees query was executed
      const orphanedTreesQuery = mockConnectionManager.executeQuery.mock.calls[0][0];
      expect(orphanedTreesQuery).toMatch(/SELECT.*TreeID.*FROM.*trees.*WHERE.*CensusID\s+IS\s+NULL/is);

      // Verify update query was called with correct parameters
      const updateOrphanedQuery = mockConnectionManager.executeQuery.mock.calls[1][0];
      expect(updateOrphanedQuery).toMatch(/UPDATE.*trees.*SET\s+CensusID/is);
      expect(mockConnectionManager.executeQuery.mock.calls[1][1]).toEqual([100, 101, 102]);
    });

    it('should skip update when no orphaned trees exist', async () => {
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([]) // No orphaned trees
        .mockResolvedValueOnce([]) // UPDATE MeasuredDBH
        .mockResolvedValueOnce([]) // UPDATE MeasuredHOM
        .mockResolvedValueOnce([]) // DELETE duplicates (StemGUID)
        .mockResolvedValueOnce([]) // DELETE duplicates (TreeTag+StemTag)
        .mockResolvedValueOnce([]); // DELETE validation errors

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      // Should only call 6 queries (no orphaned trees UPDATE)
      expect(mockConnectionManager.executeQuery).toHaveBeenCalledTimes(6);

      // Verify no UPDATE for orphaned trees was called
      const calls = mockConnectionManager.executeQuery.mock.calls;
      const hasOrphanedUpdate = calls.some((call: any) => call[0].includes('UPDATE') && call[0].includes('trees') && call[0].includes('CensusID'));
      expect(hasOrphanedUpdate).toBe(false);
    });

    it('should handle large number of orphaned trees', async () => {
      const manyOrphanedTrees = Array.from({ length: 1000 }, (_, i) => ({ TreeID: i + 1 }));

      mockConnectionManager.executeQuery
        .mockResolvedValueOnce(manyOrphanedTrees)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      const updateCall = mockConnectionManager.executeQuery.mock.calls[1];
      expect(updateCall[1].length).toBe(1001); // censusID + 1000 treeIDs
      expect(updateCall[0]).toMatch(/IN \(/);
    });
  });

  describe('Zero Value Cleanup', () => {
    it('should set MeasuredDBH=0 to NULL', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const dbhUpdateQuery = calls.find((call: any) => call[0].includes('UPDATE') && call[0].includes('coremeasurements') && call[0].includes('MeasuredDBH'));

      expect(dbhUpdateQuery).toBeDefined();
      expect(dbhUpdateQuery[0]).toMatch(/SET MeasuredDBH = NULL WHERE MeasuredDBH = 0/i);
    });

    it('should set MeasuredHOM=0 to NULL', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const homUpdateQuery = calls.find((call: any) => call[0].includes('UPDATE') && call[0].includes('coremeasurements') && call[0].includes('MeasuredHOM'));

      expect(homUpdateQuery).toBeDefined();
      expect(homUpdateQuery[0]).toMatch(/SET MeasuredHOM = NULL WHERE MeasuredHOM = 0/i);
    });

    it('should apply zero cleanup to correct schema', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_panama', 200);

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const dbhUpdate = calls.find((call: any) => call[0].includes('MeasuredDBH'));
      const homUpdate = calls.find((call: any) => call[0].includes('MeasuredHOM'));

      expect(dbhUpdate[0]).toMatch(/forestgeo_panama\.coremeasurements/i);
      expect(homUpdate[0]).toMatch(/forestgeo_panama\.coremeasurements/i);
    });
  });

  describe('Duplicate Removal - StemGUID + MeasurementDate', () => {
    it('should remove duplicates based on StemGUID and MeasurementDate', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const deleteQuery = calls.find(
        (call: any) =>
          call[0].includes('DELETE') &&
          call[0].includes('cm1') &&
          call[0].includes('cm2') &&
          call[0].includes('StemGUID') &&
          call[0].includes('MeasurementDate')
      );

      expect(deleteQuery).toBeDefined();
      expect(deleteQuery[0]).toMatch(/cm1\.CoreMeasurementID > cm2\.CoreMeasurementID/);
      expect(deleteQuery[0]).toMatch(/cm1\.StemGUID = cm2\.StemGUID/);
      expect(deleteQuery[0]).toMatch(/cm1\.MeasurementDate = cm2\.MeasurementDate/);
      expect(deleteQuery[1]).toEqual([100]); // censusID parameter
    });

    it('should only delete from specified census', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 250);

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const deleteQuery = calls.find((call: any) => call[0].includes('StemGUID') && call[0].includes('MeasurementDate'));

      expect(deleteQuery[0]).toMatch(/cm1\.CensusID = \?/);
      expect(deleteQuery[1]).toEqual([250]);
    });

    it('should keep record with lower CoreMeasurementID', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const deleteQuery = calls.find((call: any) => call[0].includes('StemGUID') && call[0].includes('MeasurementDate'));

      // Verify it deletes cm1 when cm1.ID > cm2.ID (keeps the older record)
      expect(deleteQuery[0]).toMatch(/DELETE cm1/);
      expect(deleteQuery[0]).toMatch(/WHERE cm1\.CoreMeasurementID > cm2\.CoreMeasurementID/);
    });
  });

  describe('Duplicate Removal - TreeTag + StemTag', () => {
    it('should remove duplicates based on TreeTag and StemTag combinations', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const deleteQuery = calls.find(
        (call: any) =>
          call[0].includes('DELETE') &&
          call[0].includes('stems s1') &&
          call[0].includes('stems s2') &&
          call[0].includes('trees t1') &&
          call[0].includes('trees t2') &&
          call[0].includes('TreeTag') &&
          call[0].includes('StemTag')
      );

      expect(deleteQuery).toBeDefined();
      expect(deleteQuery[0]).toMatch(/t1\.TreeTag = t2\.TreeTag/);
      expect(deleteQuery[0]).toMatch(/s1\.StemTag = s2\.StemTag/);
      expect(deleteQuery[1]).toEqual([100, 100, 100]); // 3 censusID parameters
    });

    it('should join through stems and trees tables correctly', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const deleteQuery = calls.find((call: any) => call[0].includes('TreeTag') && call[0].includes('StemTag'));

      // Verify proper joins
      expect(deleteQuery[0]).toMatch(/cm1\.StemGUID = s1\.StemGUID/);
      expect(deleteQuery[0]).toMatch(/s1\.TreeID = t1\.TreeID/);
      expect(deleteQuery[0]).toMatch(/s1\.CensusID = t1\.CensusID/);
      expect(deleteQuery[0]).toMatch(/cm2\.StemGUID = s2\.StemGUID/);
      expect(deleteQuery[0]).toMatch(/s2\.TreeID = t2\.TreeID/);
      expect(deleteQuery[0]).toMatch(/s2\.CensusID = t2\.CensusID/);
    });

    it('should filter by census ID correctly', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 300);

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const deleteQuery = calls.find((call: any) => call[0].includes('TreeTag') && call[0].includes('StemTag'));

      expect(deleteQuery[0]).toMatch(/cm1\.CensusID = \?/);
      expect(deleteQuery[0]).toMatch(/t1\.CensusID = \?/);
      expect(deleteQuery[0]).toMatch(/s1\.CensusID = \?/);
      expect(deleteQuery[1]).toEqual([300, 300, 300]);
    });
  });

  describe('Validation Error Cleanup', () => {
    it('should clear duplicate validation errors after deduplication', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const clearErrorsQuery = calls.find(
        (call: any) => call[0].includes('DELETE') && call[0].includes('cmverrors') && call[0].includes('ValidationErrorID = 5')
      );

      expect(clearErrorsQuery).toBeDefined();
      expect(clearErrorsQuery[1]).toEqual([100, 100]); // censusID parameters
    });

    it('should only clear errors for records that are no longer duplicates', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const clearErrorsQuery = calls.find((call: any) => call[0].includes('cmverrors') && call[0].includes('still_duplicates'));

      // Verify it uses LEFT JOIN to find records that are NO LONGER duplicates
      expect(clearErrorsQuery[0]).toMatch(/LEFT\s+JOIN.*AS\s+still_duplicates/is);
      expect(clearErrorsQuery[0]).toMatch(/WHERE.*e\.ValidationErrorID\s*=\s*5/is);
      expect(clearErrorsQuery[0]).toMatch(/AND.*still_duplicates\.CoreMeasurementID\s+IS\s+NULL/is);
    });

    it('should check for duplicates using same logic as validation', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const clearErrorsQuery = calls.find((call: any) => call[0].includes('still_duplicates'));

      // Verify it uses the same duplicate detection logic
      expect(clearErrorsQuery[0]).toMatch(/GROUP BY t2\.CensusID, t2\.TreeTag, s2\.StemTag/);
      expect(clearErrorsQuery[0]).toMatch(/HAVING count\(distinct s2\.StemGUID\) > 1/);
    });

    it('should only clear ValidationErrorID 5 (duplicate tree/stem tag)', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const clearErrorsQuery = calls.find((call: any) => call[0].includes('cmverrors'));

      expect(clearErrorsQuery[0]).toMatch(/ValidationErrorID = 5/);
      expect(clearErrorsQuery[0]).not.toMatch(/ValidationErrorID != 5/);
    });
  });

  describe('Query Execution Order', () => {
    it('should execute queries in correct order', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      const calls = mockConnectionManager.executeQuery.mock.calls;

      // 1. SELECT orphaned trees
      expect(calls[0][0]).toMatch(/SELECT.*TreeID.*FROM.*trees/is);

      // 2. UPDATE MeasuredDBH
      expect(calls[1][0]).toMatch(/UPDATE.*MeasuredDBH/i);

      // 3. UPDATE MeasuredHOM
      expect(calls[2][0]).toMatch(/UPDATE.*MeasuredHOM/i);

      // 4. DELETE duplicates (StemGUID)
      expect(calls[3][0]).toMatch(/DELETE.*StemGUID.*MeasurementDate/is);

      // 5. DELETE duplicates (TreeTag+StemTag)
      expect(calls[4][0]).toMatch(/DELETE.*TreeTag.*StemTag/is);

      // 6. DELETE validation errors
      expect(calls[5][0]).toMatch(/DELETE.*cmverrors/is);
    });
  });

  describe('Error Handling', () => {
    it('should throw error with context on database failure', async () => {
      mockConnectionManager.executeQuery.mockRejectedValue(new Error('Connection timeout'));

      await expect(processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100)).rejects.toThrow(
        /Bulk ingestion collapser failed.*Connection timeout/
      );
    });

    it('should include original error details in thrown error', async () => {
      const originalError = new Error('Deadlock detected');
      (originalError as any).code = 'ER_LOCK_DEADLOCK';

      mockConnectionManager.executeQuery.mockRejectedValue(originalError);

      try {
        await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toMatch(/Bulk ingestion collapser failed/);
        expect(error.message).toMatch(/Deadlock detected/);
      }
    });

    it('should handle null schema gracefully', async () => {
      mockConnectionManager.executeQuery.mockRejectedValue(new Error('Schema is required'));

      await expect(processBulkIngestionCollapser(mockConnectionManager, null as any, 100)).rejects.toThrow(/Schema is required/);
    });

    it('should handle invalid census ID', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      // Should still execute without error (database constraints will handle invalid IDs)
      await expect(processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', -1)).resolves.not.toThrow();
    });
  });

  describe('Schema-specific Behavior', () => {
    const schemas = ['forestgeo_harvard', 'forestgeo_mpala', 'forestgeo_panama', 'forestgeo_serc', 'forestgeo_testing'];

    schemas.forEach(schema => {
      it(`should work correctly for ${schema}`, async () => {
        mockConnectionManager.executeQuery.mockResolvedValue([]);

        await processBulkIngestionCollapser(mockConnectionManager, schema, 100);

        const calls = mockConnectionManager.executeQuery.mock.calls;

        // Verify all queries use correct schema
        calls.forEach((call: any) => {
          if (typeof call[0] === 'string' && call[0].includes('FROM')) {
            expect(call[0]).toMatch(new RegExp(schema, 'i'));
          }
        });
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle census with no measurements', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 999);

      // Should execute all queries without error even if no records match
      expect(mockConnectionManager.executeQuery).toHaveBeenCalled();
    });

    it('should handle very large census ID', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 2147483647); // Max INT

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const stemGuidDelete = calls.find((call: any) => call[0].includes('StemGUID'));

      expect(stemGuidDelete[1]).toEqual([2147483647]);
    });

    it('should handle concurrent calls to different censuses', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      // Simulate concurrent calls
      await Promise.all([
        processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100),
        processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 200),
        processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 300)
      ]);

      // Each call should have executed 6 queries
      expect(mockConnectionManager.executeQuery).toHaveBeenCalledTimes(18);
    });
  });
});
