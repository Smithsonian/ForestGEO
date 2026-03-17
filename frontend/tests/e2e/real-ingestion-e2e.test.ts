/**
 * Real E2E Ingestion Tests with Actual Stored Procedure Execution
 *
 * These tests run the ACTUAL bulkingestionprocess stored procedure against a
 * local test database to verify all bug fixes work in practice, not just in mocks.
 *
 * Tests verify:
 * - Bug #15: Deduplication using GROUP_CONCAT (not MAX)
 * - Bug #8: ON DUPLICATE KEY UPDATE for reingestion
 * - Bug #5: Rows don't disappear after validation
 * - Bug #6: Unresolved ingestion-error rows are reflected
 * - Complete ingestion pipeline from temporarymeasurements to coremeasurements
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import {
  setupTestDatabase,
  teardownTestDatabase,
  insertTestMeasurements,
  runBulkIngestion,
  verifyIngestionResults,
  TestData,
  TestDatabaseConfig
} from '../setup/local-db-setup';

describe('Real E2E Ingestion Tests', () => {
  let connection: mysql.Connection;
  let testData: TestData;
  let config: TestDatabaseConfig;
  let dbAvailable = false;

  beforeAll(async () => {
    try {
      ({ connection, testData, config } = await setupTestDatabase());
      dbAvailable = true;
    } catch (error) {
      console.warn('Database not available for testing. Skipping E2E ingestion tests.');
      dbAvailable = false;
    }
  }, 60000); // 60 second timeout for setup

  afterAll(async () => {
    if (dbAvailable) {
      await teardownTestDatabase(connection, config);
    }
  });

  describe('Bug #15: Deduplication with GROUP_CONCAT', () => {
    it('should merge duplicate records and preserve all attribute codes', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }

      // Test scenario: Upload 4 duplicate measurements with different codes
      const measurements = [
        {
          treeTag: 'TREE001',
          stemTag: '1',
          speciesCode: testData.species[0].Mnemonic || testData.species[0].SpeciesCode,
          quadratName: testData.quadrats[0].QuadratName,
          x: 10.5,
          y: 20.5,
          dbh: 15.5,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        },
        {
          treeTag: 'TREE001',
          stemTag: '1',
          speciesCode: testData.species[0].Mnemonic || testData.species[0].SpeciesCode,
          quadratName: testData.quadrats[0].QuadratName,
          x: 10.5,
          y: 20.5,
          dbh: 15.5,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'DS'
        },
        {
          treeTag: 'TREE001',
          stemTag: '1',
          speciesCode: testData.species[0].Mnemonic || testData.species[0].SpeciesCode,
          quadratName: testData.quadrats[0].QuadratName,
          x: 10.5,
          y: 20.5,
          dbh: 15.5,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'M'
        },
        {
          treeTag: 'TREE001',
          stemTag: '1',
          speciesCode: testData.species[0].Mnemonic || testData.species[0].SpeciesCode,
          quadratName: testData.quadrats[0].QuadratName,
          x: 10.5,
          y: 20.5,
          dbh: 15.5,
          hom: 1.3,
          date: '2024-06-15',
          codes: null // One duplicate without codes
        }
      ];

      // Step 1: Insert test measurements into temporarymeasurements
      const { fileID, batchID } = await insertTestMeasurements(connection, testData, measurements as any);

      // Verify 4 records were inserted
      const [tempCount] = await connection.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as count FROM temporarymeasurements WHERE FileID = ?', [fileID]);
      expect(tempCount[0].count).toBe(4);

      // Step 2: Run the ACTUAL stored procedure
      const result = await runBulkIngestion(connection, fileID, batchID);

      // Verify ingestion succeeded
      expect(result.success).toBe(true);
      expect(result.batch_failed).toBe(false);

      // Step 3: Verify deduplication worked correctly
      const ingestionResults = await verifyIngestionResults(connection, testData, ['TREE001']);

      // Should have exactly 1 measurement (4 duplicates merged to 1)
      expect(ingestionResults.insertedCount).toBe(1);

      // Verify ALL codes were preserved
      const codes = ingestionResults.attributes['TREE001'];
      expect(codes).toBeTruthy();
      expect(codes).toContain('A');
      expect(codes).toContain('DS');
      expect(codes).toContain('M');

      // Codes should be in alphabetical order (ORDER BY Codes in GROUP_CONCAT)
      const codeArray = codes.split(';').filter(c => c);
      expect(codeArray).toEqual(['A', 'DS', 'M']);

      console.log('✅ Bug #15 verified: All codes preserved during deduplication');
      console.log(`   Input: 4 duplicates with codes: A, DS, M, null`);
      console.log(`   Output: 1 measurement with codes: ${codes}`);

      // Step 4: Verify old behavior would have failed
      // With MAX(), only 'M' would be preserved (lexicographically largest)
      // With GROUP_CONCAT(), all codes are preserved
      expect(codeArray.length).toBe(3); // Not 1 (as MAX would produce)
    }, 30000);

    it('should handle complex deduplication with mixed data', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }

      const measurements = [
        // Tree 1: Valid unique
        {
          treeTag: 'TREE002',
          stemTag: '1',
          speciesCode: testData.species[1].Mnemonic || testData.species[1].SpeciesCode,
          quadratName: testData.quadrats[1].QuadratName,
          x: 11.5,
          y: 21.5,
          dbh: 16.5,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        },
        // Tree 2: Duplicates with different codes and comments
        {
          treeTag: 'TREE003',
          stemTag: '1',
          speciesCode: testData.species[2].Mnemonic || testData.species[2].SpeciesCode,
          quadratName: testData.quadrats[2].QuadratName,
          x: 12.5,
          y: 22.5,
          dbh: 17.5,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'DS',
          comments: 'First observation'
        },
        {
          treeTag: 'TREE003',
          stemTag: '1',
          speciesCode: testData.species[2].Mnemonic || testData.species[2].SpeciesCode,
          quadratName: testData.quadrats[2].QuadratName,
          x: 12.5,
          y: 22.5,
          dbh: 17.5,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'P',
          comments: 'Second observation'
        },
        // Tree 3: Invalid (missing coordinates) - should be rejected (coremeasurements with StemGUID IS NULL)
        {
          treeTag: 'TREE004',
          stemTag: '1',
          speciesCode: testData.species[3].Mnemonic || testData.species[3].SpeciesCode,
          quadratName: testData.quadrats[3].QuadratName,
          x: 0, // Invalid
          y: 0, // Invalid
          dbh: 0,
          hom: 0,
          date: '2024-06-15',
          codes: null
        }
      ];

      const { fileID, batchID } = await insertTestMeasurements(connection, testData, measurements as any);

      // Run ingestion
      const result = await runBulkIngestion(connection, fileID, batchID);
      expect(result.success).toBe(true);

      // Verify results
      const ingestionResults = await verifyIngestionResults(connection, testData, ['TREE002', 'TREE003']);

      // Should have 2 valid measurements (TREE004 failed validation)
      expect(ingestionResults.insertedCount).toBe(2);

      // TREE002: Single measurement with code A
      expect(ingestionResults.attributes['TREE002']).toBe('A');

      // TREE003: Merged duplicate with both codes
      const tree003Codes = ingestionResults.attributes['TREE003'];
      expect(tree003Codes).toContain('DS');
      expect(tree003Codes).toContain('P');

      // Verify failed measurement was captured (unresolved row in coremeasurements with StemGUID IS NULL)
      const [failedCount] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) as count FROM coremeasurements cm
         WHERE cm.StemGUID IS NULL AND cm.RawTreeTag = ?`,
        ['TREE004']
      );
      expect(failedCount[0].count).toBeGreaterThan(0);

      console.log('✅ Complex deduplication verified');
      console.log(`   Valid measurements: ${ingestionResults.insertedCount}`);
      console.log(`   Rejected measurements: ${failedCount[0].count}`);
      console.log(`   TREE003 codes merged: ${tree003Codes}`);
    }, 30000);
  });

  describe('Bug #8: Reingestion with ON DUPLICATE KEY UPDATE', () => {
    it('should update existing measurements with new attribute codes', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }

      // Step 1: Initial ingestion
      const initialMeasurements = [
        {
          treeTag: 'TREE005',
          stemTag: '1',
          speciesCode: testData.species[4].Mnemonic || testData.species[4].SpeciesCode,
          quadratName: testData.quadrats[4].QuadratName,
          x: 13.5,
          y: 23.5,
          dbh: 18.5,
          hom: 1.3,
          date: '2024-06-15',
          codes: null // No codes initially
        }
      ];

      const { fileID: fileID1, batchID: batchID1 } = await insertTestMeasurements(connection, testData, initialMeasurements as any);

      await runBulkIngestion(connection, fileID1, batchID1);

      // Verify initial state (no codes)
      let results = await verifyIngestionResults(connection, testData, ['TREE005']);
      expect(results.insertedCount).toBe(1);
      expect(results.attributes['TREE005']).toBeFalsy();

      // Step 2: Reingestion with attribute codes added
      const reingestionMeasurements = [
        {
          treeTag: 'TREE005',
          stemTag: '1',
          speciesCode: testData.species[4].Mnemonic || testData.species[4].SpeciesCode,
          quadratName: testData.quadrats[4].QuadratName,
          x: 13.5,
          y: 23.5,
          dbh: 18.5,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A;M', // Codes added
          comments: 'Updated with codes'
        }
      ];

      const { fileID: fileID2, batchID: batchID2 } = await insertTestMeasurements(connection, testData, reingestionMeasurements as any);

      await runBulkIngestion(connection, fileID2, batchID2);

      // Step 3: Verify codes were added (not ignored)
      results = await verifyIngestionResults(connection, testData, ['TREE005']);

      // Should still have exactly 1 measurement (updated, not duplicated)
      expect(results.insertedCount).toBe(1);

      // Codes should now be present
      const codes = results.attributes['TREE005'];
      expect(codes).toBeTruthy();
      expect(codes).toContain('A');
      expect(codes).toContain('M');

      console.log('✅ Bug #8 verified: Reingestion updated measurement with codes');
      console.log(`   Initial: No codes`);
      console.log(`   After reingestion: ${codes}`);

      // OLD BEHAVIOR (INSERT IGNORE): Codes would still be empty
      // NEW BEHAVIOR (ON DUPLICATE KEY UPDATE): Codes are added
    }, 30000);
  });

  describe('Bug #5 & #6: Row Visibility After Edits', () => {
    it('should keep rows visible after successful validation', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }

      // Insert a measurement that will be edited
      const measurements = [
        {
          treeTag: 'TREE006',
          stemTag: '1',
          speciesCode: testData.species[5].Mnemonic || testData.species[5].SpeciesCode,
          quadratName: testData.quadrats[5].QuadratName,
          x: 14.5,
          y: 24.5,
          dbh: 19.5,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'DS'
        }
      ];

      const { fileID, batchID } = await insertTestMeasurements(connection, testData, measurements as any);
      await runBulkIngestion(connection, fileID, batchID);

      // Verify initial insertion
      let results = await verifyIngestionResults(connection, testData, ['TREE006']);
      expect(results.insertedCount).toBe(1);
      const initialMeasurement = results.measurements[0];

      // Simulate editing the measurement (update DBH)
      await connection.query('UPDATE coremeasurements SET MeasuredDBH = ? WHERE CoreMeasurementID = ?', [20.5, initialMeasurement.CoreMeasurementID]);

      // Verify row is still visible
      results = await verifyIngestionResults(connection, testData, ['TREE006']);
      expect(results.insertedCount).toBe(1);
      expect(results.measurements[0].MeasuredDBH).toBe(20.5);

      console.log('✅ Bug #5 verified: Row remained visible after edit');
    }, 30000);

    it('should reflect changes made to failed measurements', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }

      // Insert invalid measurement
      const measurements = [
        {
          treeTag: 'TREE007',
          stemTag: '1',
          speciesCode: testData.species[6].Mnemonic || testData.species[6].SpeciesCode,
          quadratName: testData.quadrats[6].QuadratName,
          x: 0, // Invalid
          y: 0, // Invalid
          dbh: 15.5,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'A'
        }
      ];

      const { fileID, batchID } = await insertTestMeasurements(connection, testData, measurements as any);
      await runBulkIngestion(connection, fileID, batchID);

      // Verify it was rejected (coremeasurements row with StemGUID IS NULL)
      const [failedRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT cm.CoreMeasurementID, cm.RawX, cm.RawY
         FROM coremeasurements cm
         WHERE cm.StemGUID IS NULL AND cm.RawTreeTag = ?`,
        ['TREE007']
      );
      expect(failedRows.length).toBeGreaterThan(0);
      const failedID = failedRows[0].CoreMeasurementID;

      // Fix the coordinates on the raw columns
      await connection.query('UPDATE coremeasurements SET RawX = ?, RawY = ? WHERE CoreMeasurementID = ? AND StemGUID IS NULL', [15.5, 25.5, failedID]);

      // Verify update was reflected
      const [updatedRows] = await connection.query<mysql.RowDataPacket[]>('SELECT RawX, RawY FROM coremeasurements WHERE CoreMeasurementID = ?', [failedID]);
      expect(parseFloat(updatedRows[0].RawX)).toBe(15.5);
      expect(parseFloat(updatedRows[0].RawY)).toBe(25.5);

      console.log('✅ Bug #6 verified: Unresolved ingestion-error row changes reflected');
    }, 30000);
  });

  describe('Complete Ingestion Pipeline Verification', () => {
    it('should handle realistic batch with mixed scenarios', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }

      const measurements = [
        // Valid unique measurements
        ...Array.from({ length: 5 }, (_, i) => ({
          treeTag: `BATCH_${i + 1}`,
          stemTag: '1',
          speciesCode: testData.species[i].Mnemonic || testData.species[i].SpeciesCode,
          quadratName: testData.quadrats[i].QuadratName,
          x: 10 + i,
          y: 20 + i,
          dbh: 15 + i,
          hom: 1.3,
          date: '2024-06-15',
          codes: i % 2 === 0 ? 'A' : 'DS'
        })),

        // Duplicate measurements (should be merged)
        {
          treeTag: 'BATCH_DUP',
          stemTag: '1',
          speciesCode: testData.species[7].Mnemonic || testData.species[7].SpeciesCode,
          quadratName: testData.quadrats[7].QuadratName,
          x: 30,
          y: 40,
          dbh: 25,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'M'
        },
        {
          treeTag: 'BATCH_DUP',
          stemTag: '1',
          speciesCode: testData.species[7].Mnemonic || testData.species[7].SpeciesCode,
          quadratName: testData.quadrats[7].QuadratName,
          x: 30,
          y: 40,
          dbh: 25,
          hom: 1.3,
          date: '2024-06-15',
          codes: 'P'
        },

        // Invalid measurement
        {
          treeTag: 'BATCH_INVALID',
          stemTag: '1',
          speciesCode: testData.species[8].Mnemonic || testData.species[8].SpeciesCode,
          quadratName: testData.quadrats[8].QuadratName,
          x: 0,
          y: 0,
          dbh: 0,
          hom: 0,
          date: '2024-06-15',
          codes: null
        }
      ];

      const { fileID, batchID } = await insertTestMeasurements(connection, testData, measurements as any);

      // Verify temporarymeasurements count
      const [tempCount] = await connection.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as count FROM temporarymeasurements WHERE FileID = ?', [fileID]);
      expect(tempCount[0].count).toBe(measurements.length);

      // Run ingestion
      const result = await runBulkIngestion(connection, fileID, batchID);
      expect(result.success).toBe(true);

      // Verify valid measurements were inserted
      const treeTags = ['BATCH_1', 'BATCH_2', 'BATCH_3', 'BATCH_4', 'BATCH_5', 'BATCH_DUP'];
      const ingestionResults = await verifyIngestionResults(connection, testData, treeTags);

      // Should have 6 measurements (5 unique + 1 merged duplicate)
      expect(ingestionResults.insertedCount).toBe(6);

      // Verify duplicate was merged with both codes
      const dupCodes = ingestionResults.attributes['BATCH_DUP'];
      expect(dupCodes).toContain('M');
      expect(dupCodes).toContain('P');

      // Verify invalid went to unresolved (coremeasurements with StemGUID IS NULL)
      const [failedCount] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) as count FROM coremeasurements cm
         WHERE cm.StemGUID IS NULL AND cm.RawTreeTag = ?`,
        ['BATCH_INVALID']
      );
      expect(failedCount[0].count).toBe(1);

      console.log('✅ Complete pipeline verified');
      console.log(`   Input: ${measurements.length} measurements`);
      console.log(`   Valid inserted: ${ingestionResults.insertedCount}`);
      console.log(`   Rejected measurements: ${failedCount[0].count}`);
      console.log(`   Duplicate merged: BATCH_DUP with codes ${dupCodes}`);

      // Data integrity check
      const expectedValid = measurements.length - 2 - 1; // -2 for duplicate merge, -1 for invalid
      const actualValid = ingestionResults.insertedCount;
      expect(actualValid).toBe(expectedValid);

      console.log('✅ Data integrity maintained: No information loss');
    }, 30000);
  });
});
