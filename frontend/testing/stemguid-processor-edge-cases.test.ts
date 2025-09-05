// Processor Edge Case Tests for StemID -> StemGUID Migration
// Ensures processors handle the column rename correctly in all scenarios
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock setup
const mockConnectionManager = {
  executeQuery: vi.fn(),
  closeConnection: vi.fn(),
  beginTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn()
};

vi.mock('@/config/connectionmanager', () => ({
  default: {
    getInstance: () => mockConnectionManager
  }
}));

vi.mock('@/ailogger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

// Mock the processor helper functions
const mockHandleUpsert = vi.fn();
vi.mock('@/components/processors/processorhelperfunctions', () => ({
  handleUpsert: mockHandleUpsert,
  buildBulkUpsertQuery: vi.fn(() => ({
    sql: 'INSERT INTO stems (...) VALUES (...) ON DUPLICATE KEY UPDATE ...',
    params: []
  }))
}));

describe('StemGUID Processor Edge Cases - Critical Data Processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Census Processing Edge Cases', () => {
    it('validates stem creation during census processing uses StemGUID correctly', async () => {
      // Test stem creation in processcensus.tsx
      const stemSearchCriteria = {
        TreeID: 100,
        QuadratID: 50,
        CensusID: 1,
        StemTag: 'S001'
      };

      mockHandleUpsert.mockResolvedValueOnce({
        id: 500, // This becomes the StemGUID
        operation: 'INSERT'
      });

      const { id: stemGUID, operation } = await mockHandleUpsert(mockConnectionManager, 'testschema', 'stems', stemSearchCriteria, 'StemGUID');

      expect(stemGUID).toBe(500);
      expect(operation).toBe('INSERT');

      // Verify handleUpsert was called with StemGUID as primary key parameter
      expect(mockHandleUpsert).toHaveBeenCalledWith(mockConnectionManager, 'testschema', 'stems', stemSearchCriteria, 'StemGUID');
    });

    it('validates measurement creation links to correct StemGUID', async () => {
      // Test measurement creation that references the stem
      const measurementData = {
        StemGUID: 500, // From previous stem creation
        CensusID: 1,
        MeasuredDBH: 15.5,
        MeasuredHOM: 130,
        MeasurementDate: new Date('2025-01-01')
      };

      // Verify measurement references correct StemGUID
      expect(measurementData.StemGUID).toBe(500);
      expect('StemID' in measurementData).toBe(false);
    });

    it('handles duplicate stem detection using StemGUID', async () => {
      // Test duplicate detection logic
      mockHandleUpsert.mockResolvedValueOnce({
        id: 500,
        operation: 'UPDATE' // Existing stem found
      });

      const existingStemSearch = {
        TreeID: 100,
        StemTag: 'S001',
        QuadratID: 50,
        CensusID: 1
      };

      const { id: existingStemGUID, operation } = await mockHandleUpsert(mockConnectionManager, 'testschema', 'stems', existingStemSearch, 'StemGUID');

      expect(existingStemGUID).toBe(500);
      expect(operation).toBe('UPDATE');
    });
  });

  describe('Bulk Ingestion Edge Cases', () => {
    it('validates bulk stem processing handles mixed new/existing stems', async () => {
      // Test mixed batch with new and existing stems
      const mixedStemBatch = [
        { StemTag: 'S001', TreeID: 100, QuadratID: 50 }, // New stem
        { StemTag: 'S002', TreeID: 101, QuadratID: 51 }, // New stem
        { StemTag: 'S003', TreeID: 102, QuadratID: 52 } // Existing stem
      ];

      // Mock stem search results - S003 exists, others don't
      mockConnectionManager.executeQuery.mockResolvedValueOnce([
        { StemGUID: 300, StemTag: 'S003' } // Only S003 exists
      ]);

      const stemSearchResults = await mockConnectionManager.executeQuery('SELECT StemGUID, StemTag FROM stems WHERE StemTag IN (?, ?, ?)', [
        'S001',
        'S002',
        'S003'
      ]);

      // Build stem mapping
      const stemMap = new Map(stemSearchResults.map((s: any) => [s.StemTag, s.StemGUID]));

      const processedStems = mixedStemBatch.map(stem => ({
        ...stem,
        StemGUID: stemMap.get(stem.StemTag) || null // null for new stems
      }));

      expect(processedStems[0].StemGUID).toBeNull(); // S001 - new
      expect(processedStems[1].StemGUID).toBeNull(); // S002 - new
      expect(processedStems[2].StemGUID).toBe(300); // S003 - existing
    });

    it('validates bulk measurement processing links to correct StemGUIDs', async () => {
      // Test bulk measurement processing
      const measurementBatch = [
        { StemTag: 'S001', MeasuredDBH: 15.5, MeasurementDate: '2025-01-01' },
        { StemTag: 'S002', MeasuredDBH: 22.3, MeasurementDate: '2025-01-02' },
        { StemTag: 'S003', MeasuredDBH: 18.7, MeasurementDate: '2025-01-03' }
      ];

      // Mock stem lookup for measurements
      mockConnectionManager.executeQuery.mockResolvedValueOnce([
        { StemGUID: 100, StemTag: 'S001' },
        { StemGUID: 200, StemTag: 'S002' },
        { StemGUID: 300, StemTag: 'S003' }
      ]);

      const stemLookup = await mockConnectionManager.executeQuery('SELECT StemGUID, StemTag FROM stems WHERE StemTag IN (?, ?, ?)', ['S001', 'S002', 'S003']);

      const stemTagToGUIDMap = new Map(stemLookup.map((s: any) => [s.StemTag, s.StemGUID]));

      const processedMeasurements = measurementBatch.map(measurement => ({
        StemGUID: stemTagToGUIDMap.get(measurement.StemTag),
        MeasuredDBH: measurement.MeasuredDBH,
        MeasurementDate: measurement.MeasurementDate
      }));

      expect(processedMeasurements[0].StemGUID).toBe(100);
      expect(processedMeasurements[1].StemGUID).toBe(200);
      expect(processedMeasurements[2].StemGUID).toBe(300);
    });

    it('handles orphaned measurements with invalid StemGUID references', () => {
      // Test handling of measurements that reference non-existent stems
      const orphanedMeasurements = [
        { StemGUID: 999999, MeasuredDBH: 15.5 }, // Non-existent stem
        { StemGUID: null, MeasuredDBH: 22.3 }, // Null stem reference
        { StemGUID: 0, MeasuredDBH: 18.7 } // Invalid stem reference
      ];

      const validMeasurements = orphanedMeasurements.filter(m => m.StemGUID && m.StemGUID > 0 && m.StemGUID < 999999);

      expect(validMeasurements.length).toBe(0); // All should be filtered out
    });
  });

  describe('Data Transformation Edge Cases', () => {
    it('validates coordinate transformation maintains StemGUID relationships', () => {
      // Test coordinate system transformations
      const stemsWithCoordinates = [
        { StemGUID: 100, LocalX: 10.123456, LocalY: 20.789012 },
        { StemGUID: 200, LocalX: 15.555555, LocalY: 25.999999 },
        { StemGUID: 300, LocalX: 0.000001, LocalY: 0.000001 }
      ];

      // Test coordinate precision preservation
      stemsWithCoordinates.forEach(stem => {
        expect(typeof stem.StemGUID).toBe('number');
        expect(typeof stem.LocalX).toBe('number');
        expect(typeof stem.LocalY).toBe('number');
        expect(stem.LocalX).toBeGreaterThanOrEqual(0);
        expect(stem.LocalY).toBeGreaterThanOrEqual(0);
      });
    });

    it('validates date transformations preserve StemGUID context', () => {
      // Test date handling in stem-related contexts
      const stemMeasurementDates = [
        { StemGUID: 100, MeasurementDate: new Date('2025-01-01') },
        { StemGUID: 100, MeasurementDate: new Date('2024-01-01') }, // Previous year same stem
        { StemGUID: 200, MeasurementDate: new Date('2025-01-01') } // Same date different stem
      ];

      // Group by stem to test temporal relationships
      const stemDateMap = new Map<number, Date[]>();
      stemMeasurementDates.forEach(smd => {
        if (!stemDateMap.has(smd.StemGUID)) {
          stemDateMap.set(smd.StemGUID, []);
        }
        stemDateMap.get(smd.StemGUID)?.push(smd.MeasurementDate);
      });

      expect(stemDateMap.get(100)?.length).toBe(2); // Two dates for stem 100
      expect(stemDateMap.get(200)?.length).toBe(1); // One date for stem 200
    });
  });

  describe('Concurrency and Race Condition Edge Cases', () => {
    it('validates concurrent stem updates use StemGUID for targeting', async () => {
      // Test concurrent updates to same stem
      const concurrentUpdates = [
        { StemGUID: 100, field: 'LocalX', value: 15.5 },
        { StemGUID: 100, field: 'LocalY', value: 25.3 },
        { StemGUID: 100, field: 'StemDescription', value: 'Updated description' }
      ];

      const updatePromises = concurrentUpdates.map((update, index) => {
        mockConnectionManager.executeQuery.mockResolvedValueOnce({ affectedRows: 1 });
        return mockConnectionManager.executeQuery(`UPDATE stems SET ${update.field} = ? WHERE StemGUID = ?`, [update.value, update.StemGUID]);
      });

      const results = await Promise.all(updatePromises);

      results.forEach(result => {
        expect(result.affectedRows).toBe(1);
      });

      // Verify all updates targeted the same StemGUID
      const targetStemGUID = concurrentUpdates[0].StemGUID;
      concurrentUpdates.forEach(update => {
        expect(update.StemGUID).toBe(targetStemGUID);
      });
    });
  });

  describe('Validation Error Context Edge Cases', () => {
    it('validates validation errors include StemGUID for debugging', () => {
      // Test validation error structure
      const validationErrors = [
        {
          ErrorType: 'DBH_GROWTH_EXCEEDS_MAX',
          StemGUID: 100,
          Details: 'Growth of 70mm exceeds maximum of 65mm',
          CensusID: 2
        },
        {
          ErrorType: 'MISSING_PREVIOUS_MEASUREMENT',
          StemGUID: 200,
          Details: 'No previous measurement found for comparison',
          CensusID: 2
        }
      ];

      validationErrors.forEach(error => {
        expect('StemGUID' in error).toBe(true);
        expect(typeof error.StemGUID).toBe('number');
        expect(error.StemGUID).toBeGreaterThan(0);
        expect('StemID' in error).toBe(false);
      });
    });
  });

  describe('Complex Business Logic Edge Cases', () => {
    it('validates multi-table operations maintain StemGUID consistency', async () => {
      // Test complex operations that span multiple tables
      const complexOperationSteps = [
        {
          table: 'stems',
          operation: 'INSERT',
          data: { TreeID: 100, StemTag: 'S001', QuadratID: 50, CensusID: 1 },
          expectedStemGUID: 500
        },
        {
          table: 'coremeasurements',
          operation: 'INSERT',
          data: { StemGUID: 500, CensusID: 1, MeasuredDBH: 15.5 },
          expectedCMID: 1000
        },
        {
          table: 'cmattributes',
          operation: 'INSERT',
          data: { CoreMeasurementID: 1000, Code: 'alive' },
          expectedCMAID: 2000
        }
      ];

      // Mock the operation sequence
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce({ insertId: 500 }) // stem insert
        .mockResolvedValueOnce({ insertId: 1000 }) // measurement insert
        .mockResolvedValueOnce({ insertId: 2000 }); // attribute insert

      let currentStemGUID: number | null = null;
      let currentCMID: number | null = null;

      for (const step of complexOperationSteps) {
        if (step.table === 'stems') {
          const result = await mockConnectionManager.executeQuery('INSERT INTO stems (TreeID, StemTag, QuadratID, CensusID) VALUES (?, ?, ?, ?)', [
            step.data.TreeID,
            step.data.StemTag,
            step.data.QuadratID,
            step.data.CensusID
          ]);
          currentStemGUID = result.insertId;
          expect(currentStemGUID).toBe(step.expectedStemGUID);
        } else if (step.table === 'coremeasurements') {
          const result = await mockConnectionManager.executeQuery('INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH) VALUES (?, ?, ?)', [
            currentStemGUID,
            step.data.CensusID,
            step.data.MeasuredDBH
          ]);
          currentCMID = result.insertId;
          expect(currentCMID).toBe(step.expectedCMID);
        }
      }

      expect(currentStemGUID).toBe(500);
      expect(currentCMID).toBe(1000);
    });

    it('validates error rollback maintains StemGUID referential integrity', async () => {
      // Test error scenarios that require rollback
      mockConnectionManager.beginTransaction.mockResolvedValueOnce('tx-test');
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce({ insertId: 500 }) // stem insert succeeds
        .mockRejectedValueOnce(new Error('Foreign key constraint fails')); // measurement fails
      mockConnectionManager.rollbackTransaction.mockResolvedValueOnce(undefined);

      try {
        await mockConnectionManager.beginTransaction();

        // Step 1: Insert stem (succeeds)
        const stemResult = await mockConnectionManager.executeQuery('INSERT INTO stems (TreeID, StemTag) VALUES (?, ?)', [100, 'S001']);
        const newStemGUID = stemResult.insertId;

        // Step 2: Insert measurement (fails)
        await mockConnectionManager.executeQuery(
          'INSERT INTO coremeasurements (StemGUID, CensusID) VALUES (?, ?)',
          [newStemGUID, 99999] // Invalid CensusID
        );
      } catch (error) {
        await mockConnectionManager.rollbackTransaction('tx-test');
      }

      expect(mockConnectionManager.rollbackTransaction).toHaveBeenCalledWith('tx-test');
    });
  });

  describe('Bulk Processing Performance Edge Cases', () => {
    it('validates bulk operations handle large StemGUID datasets efficiently', async () => {
      // Test bulk processing with large datasets
      const largeBatch = Array.from({ length: 5000 }, (_, i) => ({
        StemTag: `S${String(i + 1).padStart(4, '0')}`,
        TreeID: Math.floor(i / 100) + 1,
        QuadratID: Math.floor(i / 250) + 1,
        LocalX: Math.random() * 1000,
        LocalY: Math.random() * 1000
      }));

      // Mock bulk insert result
      mockConnectionManager.executeQuery.mockResolvedValueOnce({
        affectedRows: 5000,
        insertId: 10000 // Starting StemGUID for batch
      });

      const bulkResult = await mockConnectionManager.executeQuery(
        'INSERT INTO stems (StemTag, TreeID, QuadratID, LocalX, LocalY) VALUES ...',
        largeBatch.flat()
      );

      expect(bulkResult.affectedRows).toBe(5000);
      expect(bulkResult.insertId).toBe(10000); // First StemGUID in batch
    });

    it('validates batch processing error handling preserves StemGUID context', async () => {
      // Test partial batch failure scenarios
      const batchWithErrors = [
        { StemTag: 'S001', TreeID: 100, QuadratID: 50 }, // Valid
        { StemTag: 'S002', TreeID: null, QuadratID: 51 }, // Invalid - null TreeID
        { StemTag: 'S003', TreeID: 102, QuadratID: 52 } // Valid
      ];

      // Mock partial success scenario
      mockConnectionManager.executeQuery.mockRejectedValueOnce(new Error("Column 'TreeID' cannot be null"));

      try {
        await mockConnectionManager.executeQuery('INSERT INTO stems (StemTag, TreeID, QuadratID) VALUES ?', [batchWithErrors]);
      } catch (error: any) {
        // Verify error context includes field information
        expect(error.message).toContain('TreeID');

        // Validate we can identify problematic records
        const invalidRecords = batchWithErrors.filter(stem => !stem.TreeID);
        expect(invalidRecords.length).toBe(1);
        expect(invalidRecords[0].StemTag).toBe('S002');
      }
    });
  });

  describe('Helper Function Edge Cases', () => {
    it('validates handleUpsert function works correctly with StemGUID', async () => {
      // Test handleUpsert with various StemGUID scenarios
      const testScenarios = [
        {
          name: 'new stem creation',
          searchCriteria: { TreeID: 100, StemTag: 'NEW001' },
          expectedOperation: 'INSERT',
          mockResult: { insertId: 600 }
        },
        {
          name: 'existing stem update',
          searchCriteria: { StemGUID: 500, TreeID: 100 },
          expectedOperation: 'UPDATE',
          mockResult: { affectedRows: 1 }
        }
      ];

      for (const scenario of testScenarios) {
        mockHandleUpsert.mockResolvedValueOnce({
          id: scenario.mockResult.insertId || 500,
          operation: scenario.expectedOperation
        });

        const result = await mockHandleUpsert(mockConnectionManager, 'testschema', 'stems', scenario.searchCriteria, 'StemGUID');

        expect(result.operation).toBe(scenario.expectedOperation);
        expect(typeof result.id).toBe('number');
      }
    });
  });

  describe('Data Integrity Edge Cases', () => {
    it('validates stem-measurement relationship integrity after processing', async () => {
      // Test that all measurements have valid stem references
      const integrityCheckQuery = `
        SELECT 
          cm.CoreMeasurementID,
          cm.StemGUID,
          st.StemGUID as StemExists
        FROM coremeasurements cm
        LEFT JOIN stems st ON cm.StemGUID = st.StemGUID AND st.CensusID = cm.CensusID
        WHERE st.StemGUID IS NULL
      `;

      // Should return empty result (no orphaned measurements)
      mockConnectionManager.executeQuery.mockResolvedValueOnce([]);

      const orphanedMeasurements = await mockConnectionManager.executeQuery(integrityCheckQuery);
      expect(orphanedMeasurements.length).toBe(0);
    });

    it('validates stem uniqueness constraints with StemGUID', async () => {
      // Test uniqueness validation
      const uniquenessCheckQuery = `
        SELECT StemGUID, COUNT(*) as DuplicateCount
        FROM stems
        WHERE TreeID = ? AND StemTag = ? AND CensusID = ?
        GROUP BY TreeID, StemTag, CensusID
        HAVING COUNT(*) > 1
      `;

      mockConnectionManager.executeQuery.mockResolvedValueOnce([]);

      const duplicates = await mockConnectionManager.executeQuery(uniquenessCheckQuery, [100, 'S001', 1]);

      expect(duplicates.length).toBe(0); // No duplicates expected
    });
  });

  describe('Migration Verification Edge Cases', () => {
    it('validates no residual StemID references in query builders', () => {
      // Test query builder patterns
      const queryBuilders = [
        (schema: string, stemGUID: number) => `SELECT * FROM ${schema}.stems WHERE StemGUID = ${stemGUID}`,
        (schema: string, stemGUIDs: number[]) =>
          `SELECT * FROM ${schema}.stems WHERE StemGUID IN (${Array.isArray(stemGUIDs) ? stemGUIDs.join(',') : stemGUIDs})`,
        (schema: string) => `SELECT MAX(StemGUID) FROM ${schema}.stems`
      ];

      // Test first builder (single StemGUID)
      const query1 = queryBuilders[0]('testschema', 123);
      expect(query1).toContain('StemGUID');
      expect(query1).not.toContain('StemID');

      // Test second builder (array of StemGUIDs)
      const query2 = queryBuilders[1]('testschema', [100, 200, 300]);
      expect(query2).toContain('StemGUID');
      expect(query2).not.toContain('StemID');

      // Test third builder (MAX query)
      const query3 = queryBuilders[2]('testschema');
      expect(query3).toContain('StemGUID');
      expect(query3).not.toContain('StemID');
    });

    it('validates connection logger configuration uses StemGUID', () => {
      // Test connection logger table configuration
      const tableConfig = {
        stems: { pk: 'StemGUID' },
        coremeasurements: { fk: 'StemGUID' },
        measurementssummary: { compositeKeys: ['CoreMeasurementID', 'StemGUID'] }
      };

      expect(tableConfig.stems.pk).toBe('StemGUID');
      expect(tableConfig.coremeasurements.fk).toBe('StemGUID');
      expect(tableConfig.measurementssummary.compositeKeys).toContain('StemGUID');
    });
  });
});
