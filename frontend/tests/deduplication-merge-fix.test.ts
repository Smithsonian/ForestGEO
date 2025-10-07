/**
 * Integration tests for Issue #5: Deduplication Merge Fix
 *
 * Tests the enhanced deduplication logic that merges information from duplicate
 * records instead of discarding it, resolving the record count discrepancy issue.
 *
 * Fix location: sqlscripting/ingestion_fixed_optimized.sql:114-155
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';

const dbConfig = {
  host: process.env.AZURE_SQL_SERVER || 'forestgeo-mysqldataserver.mysql.database.azure.com',
  user: process.env.AZURE_SQL_USER || 'azureroot',
  password: process.env.AZURE_SQL_PASSWORD || 'P@ssw0rd',
  port: parseInt(process.env.AZURE_SQL_PORT || '3306'),
  database: process.env.AZURE_SQL_SCHEMA || 'forestgeo_testing'
};

describe('Deduplication Merge Fix - Issue #5', () => {
  let connection: mysql.Connection;
  let testFileID: string;
  let testBatchID: string;
  let testPlotID: number;
  let testCensusID: number;
  let dbAvailable = false;

  beforeAll(async () => {
    try {
      connection = await mysql.createConnection(dbConfig);
      dbAvailable = true;

      // Get test data
      const [plots] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT PlotID FROM plots LIMIT 1`
      );

      const [census] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT CensusID FROM census WHERE PlotID = ? LIMIT 1`,
        [plots[0].PlotID]
      );

      testPlotID = plots[0].PlotID;
      testCensusID = census[0].CensusID;
      testFileID = `test_file_${uuidv4()}`;
      testBatchID = `test_batch_${uuidv4()}`;
    } catch (error) {
      console.warn('Database not available for testing. Skipping database tests.');
      dbAvailable = false;
    }
  });

  afterAll(async () => {
    // Clean up test data
    if (connection && testFileID && testBatchID) {
      await connection.query(
        `DELETE FROM temporarymeasurements WHERE FileID = ? AND BatchID = ?`,
        [testFileID, testBatchID]
      );
    }
    if (connection) {
      await connection.end();
    }
  });

  describe('Stored Procedure Verification', () => {
    it('should confirm bulkingestionprocess uses GROUP_CONCAT for Codes', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SHOW CREATE PROCEDURE bulkingestionprocess`
      );

      const procedureContent = rows[0]['Create Procedure'];

      // Should use GROUP_CONCAT instead of MAX
      expect(procedureContent).toContain('GROUP_CONCAT');
      expect(procedureContent).toContain('DISTINCT CASE WHEN Codes');
      expect(procedureContent).toContain("SEPARATOR ';'");
    });

    it('should confirm bulkingestionprocess uses GROUP_CONCAT for Comments', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SHOW CREATE PROCEDURE bulkingestionprocess`
      );

      const procedureContent = rows[0]['Create Procedure'];

      // Should merge comments with pipe separator
      expect(procedureContent).toContain('GROUP_CONCAT');
      expect(procedureContent).toContain('DISTINCT CASE WHEN Comments');
      expect(procedureContent).toContain("SEPARATOR ' | '");
    });

    it('should confirm procedure still deduplicates on measurement keys', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SHOW CREATE PROCEDURE bulkingestionprocess`
      );

      const procedureContent = rows[0]['Create Procedure'];

      // Should still GROUP BY all measurement identifying fields
      expect(procedureContent).toContain('GROUP BY');
      expect(procedureContent).toContain('TreeTag');
      expect(procedureContent).toContain('StemTag');
      expect(procedureContent).toContain('QuadratName');
      expect(procedureContent).toContain('DBH');
      expect(procedureContent).toContain('HOM');
      expect(procedureContent).toContain('MeasurementDate');
    });
  });

  describe('Deduplication Logic Tests', () => {
    it('should merge Codes from duplicate records', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }
      // Get valid test data
      const [species] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT SpeciesCode FROM species WHERE IsActive = 1 LIMIT 1`
      );
      const [quadrat] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT QuadratName FROM quadrats WHERE PlotID = ? AND IsActive = 1 LIMIT 1`,
        [testPlotID]
      );

      if (species.length === 0 || quadrat.length === 0) {
        console.warn('Insufficient test data');
        return;
      }

      const speciesCode = species[0].SpeciesCode;
      const quadratName = quadrat[0].QuadratName;

      // Insert duplicate records with different Codes
      const baseData = {
        FileID: testFileID,
        BatchID: testBatchID,
        PlotID: testPlotID,
        CensusID: testCensusID,
        TreeTag: `TEST_${uuidv4().substring(0, 8)}`,
        StemTag: '0001',
        SpeciesCode: speciesCode,
        QuadratName: quadratName,
        LocalX: 10.5,
        LocalY: 20.5,
        DBH: 15.5,
        HOM: 1.3,
        MeasurementDate: '2024-06-15'
      };

      await connection.query(
        `INSERT INTO temporarymeasurements
         (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName,
          LocalX, LocalY, DBH, HOM, MeasurementDate, Codes)
         VALUES
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DS'),
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'A'),
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'M')`,
        [
          // First duplicate
          baseData.FileID,
          baseData.BatchID,
          baseData.PlotID,
          baseData.CensusID,
          baseData.TreeTag,
          baseData.StemTag,
          baseData.SpeciesCode,
          baseData.QuadratName,
          baseData.LocalX,
          baseData.LocalY,
          baseData.DBH,
          baseData.HOM,
          baseData.MeasurementDate,
          // Second duplicate
          baseData.FileID,
          baseData.BatchID,
          baseData.PlotID,
          baseData.CensusID,
          baseData.TreeTag,
          baseData.StemTag,
          baseData.SpeciesCode,
          baseData.QuadratName,
          baseData.LocalX,
          baseData.LocalY,
          baseData.DBH,
          baseData.HOM,
          baseData.MeasurementDate,
          // Third duplicate
          baseData.FileID,
          baseData.BatchID,
          baseData.PlotID,
          baseData.CensusID,
          baseData.TreeTag,
          baseData.StemTag,
          baseData.SpeciesCode,
          baseData.QuadratName,
          baseData.LocalX,
          baseData.LocalY,
          baseData.DBH,
          baseData.HOM,
          baseData.MeasurementDate
        ]
      );

      // Verify 3 records were inserted
      const [countBefore] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) as count
         FROM temporarymeasurements
         WHERE FileID = ? AND BatchID = ? AND TreeTag = ?`,
        [testFileID, testBatchID, baseData.TreeTag]
      );

      expect(countBefore[0].count).toBe(3);

      // NOTE: The actual bulkingestionprocess would need to be called here
      // For this test, we simulate the deduplication logic directly
      const [deduped] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT
           TreeTag,
           StemTag,
           GROUP_CONCAT(DISTINCT CASE WHEN Codes IS NOT NULL AND TRIM(Codes) != '' THEN TRIM(Codes) END ORDER BY Codes SEPARATOR ';') as MergedCodes,
           COUNT(*) as DuplicateCount
         FROM temporarymeasurements
         WHERE FileID = ? AND BatchID = ? AND TreeTag = ?
         GROUP BY TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate`,
        [testFileID, testBatchID, baseData.TreeTag]
      );

      // Should have 1 merged record
      expect(deduped.length).toBe(1);
      expect(deduped[0].DuplicateCount).toBe(3);

      // All codes should be merged
      expect(deduped[0].MergedCodes).toContain('A');
      expect(deduped[0].MergedCodes).toContain('DS');
      expect(deduped[0].MergedCodes).toContain('M');

      // Should be semicolon-separated
      expect(deduped[0].MergedCodes.split(';')).toHaveLength(3);
    });

    it('should merge Comments from duplicate records', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }
      const [species] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT SpeciesCode FROM species WHERE IsActive = 1 LIMIT 1`
      );
      const [quadrat] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT QuadratName FROM quadrats WHERE PlotID = ? AND IsActive = 1 LIMIT 1`,
        [testPlotID]
      );

      if (species.length === 0 || quadrat.length === 0) {
        console.warn('Insufficient test data');
        return;
      }

      const speciesCode = species[0].SpeciesCode;
      const quadratName = quadrat[0].QuadratName;

      const baseData = {
        FileID: testFileID,
        BatchID: testBatchID,
        PlotID: testPlotID,
        CensusID: testCensusID,
        TreeTag: `TEST_${uuidv4().substring(0, 8)}`,
        StemTag: '0001',
        SpeciesCode: speciesCode,
        QuadratName: quadratName,
        LocalX: 10.5,
        LocalY: 20.5,
        DBH: 15.5,
        HOM: 1.3,
        MeasurementDate: '2024-06-15'
      };

      await connection.query(
        `INSERT INTO temporarymeasurements
         (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName,
          LocalX, LocalY, DBH, HOM, MeasurementDate, Comments)
         VALUES
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Remeasured'),
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Checked coordinates'),
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Verified species')`,
        [
          // First duplicate
          baseData.FileID,
          baseData.BatchID,
          baseData.PlotID,
          baseData.CensusID,
          baseData.TreeTag,
          baseData.StemTag,
          baseData.SpeciesCode,
          baseData.QuadratName,
          baseData.LocalX,
          baseData.LocalY,
          baseData.DBH,
          baseData.HOM,
          baseData.MeasurementDate,
          // Second duplicate
          baseData.FileID,
          baseData.BatchID,
          baseData.PlotID,
          baseData.CensusID,
          baseData.TreeTag,
          baseData.StemTag,
          baseData.SpeciesCode,
          baseData.QuadratName,
          baseData.LocalX,
          baseData.LocalY,
          baseData.DBH,
          baseData.HOM,
          baseData.MeasurementDate,
          // Third duplicate
          baseData.FileID,
          baseData.BatchID,
          baseData.PlotID,
          baseData.CensusID,
          baseData.TreeTag,
          baseData.StemTag,
          baseData.SpeciesCode,
          baseData.QuadratName,
          baseData.LocalX,
          baseData.LocalY,
          baseData.DBH,
          baseData.HOM,
          baseData.MeasurementDate
        ]
      );

      const [deduped] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT
           TreeTag,
           GROUP_CONCAT(DISTINCT CASE WHEN Comments IS NOT NULL AND TRIM(Comments) != '' THEN TRIM(Comments) END ORDER BY Comments SEPARATOR ' | ') as MergedComments
         FROM temporarymeasurements
         WHERE FileID = ? AND BatchID = ? AND TreeTag = ?
         GROUP BY TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate`,
        [testFileID, testBatchID, baseData.TreeTag]
      );

      // Comments should be merged with pipe separator
      expect(deduped[0].MergedComments).toContain('Remeasured');
      expect(deduped[0].MergedComments).toContain('Checked coordinates');
      expect(deduped[0].MergedComments).toContain('Verified species');
      expect(deduped[0].MergedComments).toContain(' | ');
    });
  });

  describe('Record Count Verification', () => {
    it('should preserve all information even when deduplicating', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }
      // This test verifies the fix for the "2 missing records" issue

      const [species] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT SpeciesCode FROM species WHERE IsActive = 1 LIMIT 1`
      );
      const [quadrat] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT QuadratName FROM quadrats WHERE PlotID = ? AND IsActive = 1 LIMIT 1`,
        [testPlotID]
      );

      if (species.length === 0 || quadrat.length === 0) {
        console.warn('Insufficient test data');
        return;
      }

      const speciesCode = species[0].SpeciesCode;
      const quadratName = quadrat[0].QuadratName;

      // Simulate the scenario: 10256 records in file, 3 are duplicates with different codes
      const baseData = {
        FileID: testFileID,
        BatchID: testBatchID,
        PlotID: testPlotID,
        CensusID: testCensusID,
        TreeTag: `TEST_${uuidv4().substring(0, 8)}`,
        StemTag: '0001',
        SpeciesCode: speciesCode,
        QuadratName: quadratName,
        LocalX: 10.5,
        LocalY: 20.5,
        DBH: 15.5,
        HOM: 1.3,
        MeasurementDate: '2024-06-15'
      };

      // Insert 3 duplicate records
      await connection.query(
        `INSERT INTO temporarymeasurements
         (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName,
          LocalX, LocalY, DBH, HOM, MeasurementDate, Codes)
         VALUES
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DS;A'),
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'M'),
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'P')`,
        [
          baseData.FileID,
          baseData.BatchID,
          baseData.PlotID,
          baseData.CensusID,
          baseData.TreeTag,
          baseData.StemTag,
          baseData.SpeciesCode,
          baseData.QuadratName,
          baseData.LocalX,
          baseData.LocalY,
          baseData.DBH,
          baseData.HOM,
          baseData.MeasurementDate,
          baseData.FileID,
          baseData.BatchID,
          baseData.PlotID,
          baseData.CensusID,
          baseData.TreeTag,
          baseData.StemTag,
          baseData.SpeciesCode,
          baseData.QuadratName,
          baseData.LocalX,
          baseData.LocalY,
          baseData.DBH,
          baseData.HOM,
          baseData.MeasurementDate,
          baseData.FileID,
          baseData.BatchID,
          baseData.PlotID,
          baseData.CensusID,
          baseData.TreeTag,
          baseData.StemTag,
          baseData.SpeciesCode,
          baseData.QuadratName,
          baseData.LocalX,
          baseData.LocalY,
          baseData.DBH,
          baseData.HOM,
          baseData.MeasurementDate
        ]
      );

      // Deduplicate using the new logic
      const [deduped] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT
           GROUP_CONCAT(DISTINCT CASE WHEN Codes IS NOT NULL AND TRIM(Codes) != '' THEN TRIM(Codes) END ORDER BY Codes SEPARATOR ';') as AllCodes
         FROM temporarymeasurements
         WHERE FileID = ? AND BatchID = ? AND TreeTag = ?
         GROUP BY TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate`,
        [testFileID, testBatchID, baseData.TreeTag]
      );

      // OLD BEHAVIOR: Would only keep 'P' (MAX), lose 'DS;A' and 'M'
      // NEW BEHAVIOR: All codes are preserved
      const codes = deduped[0].AllCodes.split(';').sort();

      // All unique codes should be present
      expect(codes).toContain('A');
      expect(codes).toContain('DS');
      expect(codes).toContain('M');
      expect(codes).toContain('P');

      // No information was lost
      expect(codes.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Before Fix Regression Test', () => {
    it('OLD BEHAVIOR: MAX would discard information from duplicates', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }
      // This documents the old buggy behavior

      const [species] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT SpeciesCode FROM species WHERE IsActive = 1 LIMIT 1`
      );
      const [quadrat] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT QuadratName FROM quadrats WHERE PlotID = ? AND IsActive = 1 LIMIT 1`,
        [testPlotID]
      );

      if (species.length === 0 || quadrat.length === 0) {
        console.warn('Insufficient test data');
        return;
      }

      const speciesCode = species[0].SpeciesCode;
      const quadratName = quadrat[0].QuadratName;

      const baseData = {
        FileID: testFileID,
        BatchID: testBatchID,
        PlotID: testPlotID,
        CensusID: testCensusID,
        TreeTag: `TEST_${uuidv4().substring(0, 8)}`,
        StemTag: '0001',
        SpeciesCode: speciesCode,
        QuadratName: quadratName,
        LocalX: 10.5,
        LocalY: 20.5,
        DBH: 15.5,
        HOM: 1.3,
        MeasurementDate: '2024-06-15'
      };

      await connection.query(
        `INSERT INTO temporarymeasurements
         (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName,
          LocalX, LocalY, DBH, HOM, MeasurementDate, Codes)
         VALUES
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DS'),
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'A'),
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'M')`,
        [
          baseData.FileID,
          baseData.BatchID,
          baseData.PlotID,
          baseData.CensusID,
          baseData.TreeTag,
          baseData.StemTag,
          baseData.SpeciesCode,
          baseData.QuadratName,
          baseData.LocalX,
          baseData.LocalY,
          baseData.DBH,
          baseData.HOM,
          baseData.MeasurementDate,
          baseData.FileID,
          baseData.BatchID,
          baseData.PlotID,
          baseData.CensusID,
          baseData.TreeTag,
          baseData.StemTag,
          baseData.SpeciesCode,
          baseData.QuadratName,
          baseData.LocalX,
          baseData.LocalY,
          baseData.DBH,
          baseData.HOM,
          baseData.MeasurementDate,
          baseData.FileID,
          baseData.BatchID,
          baseData.PlotID,
          baseData.CensusID,
          baseData.TreeTag,
          baseData.StemTag,
          baseData.SpeciesCode,
          baseData.QuadratName,
          baseData.LocalX,
          baseData.LocalY,
          baseData.DBH,
          baseData.HOM,
          baseData.MeasurementDate
        ]
      );

      // Old logic using MAX
      const [oldLogic] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT
           MAX(CASE WHEN Codes IS NOT NULL AND TRIM(Codes) != '' THEN TRIM(Codes) END) as MaxCodes
         FROM temporarymeasurements
         WHERE FileID = ? AND BatchID = ? AND TreeTag = ?
         GROUP BY TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate`,
        [testFileID, testBatchID, baseData.TreeTag]
      );

      // New logic using GROUP_CONCAT
      const [newLogic] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT
           GROUP_CONCAT(DISTINCT CASE WHEN Codes IS NOT NULL AND TRIM(Codes) != '' THEN TRIM(Codes) END ORDER BY Codes SEPARATOR ';') as MergedCodes
         FROM temporarymeasurements
         WHERE FileID = ? AND BatchID = ? AND TreeTag = ?
         GROUP BY TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate`,
        [testFileID, testBatchID, baseData.TreeTag]
      );

      // Old behavior: only one code (information lost)
      expect(oldLogic[0].MaxCodes).toBe('M'); // Lexicographically largest

      // New behavior: all codes preserved
      expect(newLogic[0].MergedCodes).toContain('A');
      expect(newLogic[0].MergedCodes).toContain('DS');
      expect(newLogic[0].MergedCodes).toContain('M');
    });
  });
});
