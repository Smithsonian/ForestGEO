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
import { processBulkIngestionCollapser, processBulkIngestionProcessor, TemporaryMeasurement } from './processbulkingestion';
import ConnectionManager from '@/config/connectionmanager';
import { insertIngestionFailureRows } from '@/config/measurementerrors';

// Mock dependencies
vi.mock('@/config/connectionmanager');
vi.mock('@/config/utils/sqlsecurity', () => ({
  safeFormatQuery: vi.fn((schema, query) => query.replace(/\?\?/g, schema))
}));
vi.mock('@/config/measurementerrors', () => ({
  insertIngestionFailureRows: vi.fn(async () => undefined)
}));
vi.mock('@/config/utils', async importOriginal => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    createError: vi.fn((message: string, error?: any) => {
      const err = new Error(message);
      if (error) {
        Object.assign(err, error);
      }
      return err;
    })
  };
});

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
        .mockResolvedValueOnce([{ PlotID: 1 }]) // SELECT PlotID
        .mockResolvedValueOnce([{ count: 0 }]) // COUNT StemGUID+Date dups
        .mockResolvedValueOnce([]) // DELETE duplicates (StemGUID+Date)
        .mockResolvedValueOnce([{ count: 0 }]) // COUNT TreeTag+StemTag dups
        .mockResolvedValueOnce([]) // DELETE duplicates (TreeTag+StemTag)
        .mockResolvedValueOnce([]); // DELETE validation errors

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      // Should call 9 queries (no orphaned trees UPDATE)
      expect(mockConnectionManager.executeQuery).toHaveBeenCalledTimes(9);

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
      const deleteQuery = calls.find((call: any) => call[0].includes('DELETE') && call[0].includes('StemGUID') && call[0].includes('MeasurementDate'));

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
        (call: any) => call[0].includes('DELETE') && call[0].includes('measurement_error_log') && call[0].includes("me.ErrorCode = '5'")
      );

      expect(clearErrorsQuery).toBeDefined();
      expect(clearErrorsQuery[1]).toEqual([100, 100]); // censusID parameters
    });

    it('should only clear errors for records that are no longer duplicates', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const clearErrorsQuery = calls.find((call: any) => call[0].includes('measurement_error_log') && call[0].includes('still_duplicates'));

      // Verify it uses LEFT JOIN to find records that are NO LONGER duplicates
      expect(clearErrorsQuery[0]).toMatch(/LEFT\s+JOIN.*AS\s+still_duplicates/is);
      expect(clearErrorsQuery[0]).toMatch(/WHERE.*me\.ErrorCode\s*=\s*'5'/is);
      expect(clearErrorsQuery[0]).toMatch(/AND.*still_duplicates\.CoreMeasurementID\s+IS\s+NULL/is);
    });

    it('should check for duplicates using same logic as validation', async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const clearErrorsQuery = calls.find((call: any) => call[0].includes('still_duplicates'));

      // Verify it uses the same duplicate detection logic
      // Note: The query uses cm3.CensusID for grouping since it's checking coremeasurements duplicates
      expect(clearErrorsQuery[0]).toMatch(/GROUP BY cm3\.CensusID, t2\.TreeTag, s2\.StemTag/);
      expect(clearErrorsQuery[0]).toMatch(/HAVING count\(distinct cm3\.CoreMeasurementID\) > 1/);
    });

    it("should only clear validation error code '5' (duplicate tree/stem tag)", async () => {
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      await processBulkIngestionCollapser(mockConnectionManager, 'forestgeo_test', 100);

      const calls = mockConnectionManager.executeQuery.mock.calls;
      const clearErrorsQuery = calls.find((call: any) => call[0].includes('measurement_error_log'));

      expect(clearErrorsQuery[0]).toMatch(/me\.ErrorCode = '5'/);
      expect(clearErrorsQuery[0]).not.toMatch(/me\.ErrorCode != '5'/);
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

      // 4. SELECT PlotID for alert logging
      expect(calls[3][0]).toMatch(/SELECT PlotID FROM.*census/i);

      // 5. COUNT StemGUID+MeasurementDate duplicates
      expect(calls[4][0]).toMatch(/SELECT COUNT.*StemGUID.*MeasurementDate/is);

      // 6. DELETE duplicates (StemGUID+MeasurementDate)
      expect(calls[5][0]).toMatch(/DELETE.*StemGUID.*MeasurementDate/is);

      // 7. COUNT TreeTag+StemTag duplicates
      expect(calls[6][0]).toMatch(/SELECT COUNT.*TreeTag.*StemTag/is);

      // 8. DELETE duplicates (TreeTag+StemTag)
      expect(calls[7][0]).toMatch(/DELETE.*TreeTag.*StemTag/is);

      // 9. DELETE validation errors
      expect(calls[8][0]).toMatch(/DELETE.*measurement_error_log/is);
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
        throw new Error('Should have thrown error');
      } catch (error: any) {
        if (error.message === 'Should have thrown error') throw error;
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

      // Each call executes 9 queries (no orphaned trees, no dups found)
      expect(mockConnectionManager.executeQuery).toHaveBeenCalledTimes(27);
    });
  });
});

describe('processBulkIngestionProcessor - false duplicate spot-check', () => {
  let mockConnectionManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionManager = {
      executeQuery: vi.fn(() => Promise.resolve([]))
    };
  });

  it('should NOT flag rows with same TreeTag/StemTag but different DBH and Date as duplicates', async () => {
    // Two measurements for the same tree/stem but different measurement dates and DBH values.
    // This is a legitimate scenario (e.g. re-measurement in same upload batch with corrected data,
    // or two distinct measurement events). They must NOT be flagged as duplicates.
    const measurements: TemporaryMeasurement[] = [
      {
        id: 1,
        FileID: 'test.csv',
        BatchID: 'batch-1',
        PlotID: 1,
        CensusID: 10,
        TreeTag: 'T100',
        StemTag: 'S1',
        SpeciesCode: 'queral',
        QuadratName: 'Q0101',
        LocalX: 5.0,
        LocalY: 10.0,
        DBH: 15.5,
        HOM: 1.3,
        MeasurementDate: new Date('2024-01-15'),
        Codes: '',
        Comments: ''
      },
      {
        id: 2,
        FileID: 'test.csv',
        BatchID: 'batch-1',
        PlotID: 1,
        CensusID: 10,
        TreeTag: 'T100',
        StemTag: 'S1',
        SpeciesCode: 'queral',
        QuadratName: 'Q0101',
        LocalX: 5.0,
        LocalY: 10.0,
        DBH: 18.2, // Different DBH
        HOM: 1.3,
        MeasurementDate: new Date('2024-06-20'), // Different date
        Codes: '',
        Comments: ''
      }
    ];

    // Mock DB calls in order for 2 valid measurements:
    // For each measurement: validateQuadrat (1) + validateSpecies (1) = 2 per row = 4 total
    // Then categorizeMeasurements: oldTree (1) + multiStem (1) per row = 2 per row = 4 total
    // Then processTreeInsertions: species lookup (1) + bulk upsert (1) = 2
    // Then processStemInsertions: tree lookup (1) + quadrat lookup (1) + bulk upsert (1) + cleanup (1) = 4
    // Then processCoreMeasurementInsertions: stem lookup (1) + bulk upsert (1) + cleanup (1) = 3
    // Then processCMAttributeInsertions: cm lookup (1) = 1
    // Total: 4 + 4 + 2 + 4 + 3 + 1 = 18

    mockConnectionManager.executeQuery
      // validateQuadrat (row 1) - found
      .mockResolvedValueOnce([{ count: 1 }])
      // validateSpecies (row 1) - found
      .mockResolvedValueOnce([{ count: 1 }])
      // validateQuadrat (row 2) - found
      .mockResolvedValueOnce([{ count: 1 }])
      // validateSpecies (row 2) - found
      .mockResolvedValueOnce([{ count: 1 }])
      // categorizeMeasurements - oldTree check (row 1) - not old
      .mockResolvedValueOnce([])
      // categorizeMeasurements - multiStem check (row 1) - not multi
      .mockResolvedValueOnce([])
      // categorizeMeasurements - oldTree check (row 2) - not old
      .mockResolvedValueOnce([])
      // categorizeMeasurements - multiStem check (row 2) - not multi
      .mockResolvedValueOnce([])
      // processTreeInsertions - species lookup
      .mockResolvedValueOnce([{ SpeciesCode: 'queral', SpeciesID: 42 }])
      // processTreeInsertions - bulk upsert
      .mockResolvedValueOnce([])
      // processStemInsertions - tree lookup
      .mockResolvedValueOnce([{ TreeTag: 'T100', TreeID: 1 }])
      // processStemInsertions - quadrat lookup
      .mockResolvedValueOnce([{ QuadratName: 'Q0101', QuadratID: 5 }])
      // processStemInsertions - bulk upsert
      .mockResolvedValueOnce([])
      // processStemInsertions - cleanup
      .mockResolvedValueOnce([])
      // processCoreMeasurementInsertions - stem lookup
      .mockResolvedValueOnce([{ StemGUID: 'guid-1', StemTag: 'S1', TreeTag: 'T100', QuadratName: 'Q0101' }])
      // processCoreMeasurementInsertions - bulk upsert
      .mockResolvedValueOnce([])
      // processCoreMeasurementInsertions - cleanup
      .mockResolvedValueOnce([])
      // processCMAttributeInsertions - cm lookup
      .mockResolvedValueOnce([]);

    await processBulkIngestionProcessor(mockConnectionManager as any, 'forestgeo_test', 'test.csv', 'batch-1', measurements);

    // KEY ASSERTION: insertFailedMeasurements should NOT have been called.
    // If the dedup key matched on TreeTag+StemTag alone, row 2 would be flagged.
    // Since the key includes DBH and Date, both rows pass through.
    const failedInsertCalls = mockConnectionManager.executeQuery.mock.calls.filter(
      (call: any) => typeof call[0] === 'string' && call[0].includes('measurement_error_log')
    );
    expect(failedInsertCalls).toHaveLength(0);
  });

  it('should correctly flag exact duplicate rows as duplicates', async () => {
    // Two measurements that are truly identical — same TreeTag, StemTag, DBH, Date, everything.
    // The second one should be flagged as a duplicate.
    const measurements: TemporaryMeasurement[] = [
      {
        id: 1,
        FileID: 'test.csv',
        BatchID: 'batch-1',
        PlotID: 1,
        CensusID: 10,
        TreeTag: 'T100',
        StemTag: 'S1',
        SpeciesCode: 'queral',
        QuadratName: 'Q0101',
        LocalX: 5.0,
        LocalY: 10.0,
        DBH: 15.5,
        HOM: 1.3,
        MeasurementDate: new Date('2024-01-15'),
        Codes: '',
        Comments: ''
      },
      {
        id: 2,
        FileID: 'test.csv',
        BatchID: 'batch-1',
        PlotID: 1,
        CensusID: 10,
        TreeTag: 'T100',
        StemTag: 'S1',
        SpeciesCode: 'queral',
        QuadratName: 'Q0101',
        LocalX: 5.0,
        LocalY: 10.0,
        DBH: 15.5, // Same DBH
        HOM: 1.3,
        MeasurementDate: new Date('2024-01-15'), // Same date
        Codes: '',
        Comments: ''
      }
    ];

    // The duplicate is routed through insertIngestionFailureRows, then only
    // the deduped valid measurement continues through the pipeline.
    mockConnectionManager.executeQuery
      // validateQuadrat (row 1 only — row 2 was deduped)
      .mockResolvedValueOnce([{ count: 1 }])
      // validateSpecies (row 1)
      .mockResolvedValueOnce([{ count: 1 }])
      // categorizeMeasurements - oldTree check (row 1)
      .mockResolvedValueOnce([])
      // categorizeMeasurements - multiStem check (row 1)
      .mockResolvedValueOnce([])
      // processTreeInsertions - species lookup
      .mockResolvedValueOnce([{ SpeciesCode: 'queral', SpeciesID: 42 }])
      // processTreeInsertions - bulk upsert
      .mockResolvedValueOnce([])
      // processStemInsertions - tree lookup
      .mockResolvedValueOnce([{ TreeTag: 'T100', TreeID: 1 }])
      // processStemInsertions - quadrat lookup
      .mockResolvedValueOnce([{ QuadratName: 'Q0101', QuadratID: 5 }])
      // processStemInsertions - bulk upsert
      .mockResolvedValueOnce([])
      // processStemInsertions - cleanup
      .mockResolvedValueOnce([])
      // processCoreMeasurementInsertions - stem lookup
      .mockResolvedValueOnce([{ StemGUID: 'guid-1', StemTag: 'S1', TreeTag: 'T100', QuadratName: 'Q0101' }])
      // processCoreMeasurementInsertions - bulk upsert
      .mockResolvedValueOnce([])
      // processCoreMeasurementInsertions - cleanup
      .mockResolvedValueOnce([])
      // processCMAttributeInsertions - cm lookup
      .mockResolvedValueOnce([]);

    await processBulkIngestionProcessor(mockConnectionManager as any, 'forestgeo_test', 'test.csv', 'batch-1', measurements);

    expect(insertIngestionFailureRows).toHaveBeenCalledTimes(1);
    expect(insertIngestionFailureRows).toHaveBeenCalledWith(
      mockConnectionManager,
      'forestgeo_test',
      expect.arrayContaining([
        expect.objectContaining({
          tag: 'T100',
          stemTag: 'S1',
          fileID: 'test.csv',
          batchID: 'batch-1'
        })
      ])
    );
  });
});
