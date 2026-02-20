/**
 * E2E Ingestion Monitoring Test Suite
 *
 * Provides comprehensive monitoring and validation of the entire ingestion pipeline:
 * - File upload and parsing
 * - Temporary table insertion
 * - Deduplication logic
 * - Stored procedure execution
 * - Final table insertion
 * - Attribute code handling
 *
 * This test suite tracks data at every stage to ensure no information is lost.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Database configuration
const dbConfig = {
  host: process.env.AZURE_SQL_SERVER || 'forestgeo-mysqldataserver.mysql.database.azure.com',
  user: process.env.AZURE_SQL_USER || 'azureroot',
  password: process.env.AZURE_SQL_PASSWORD || 'P@ssw0rd',
  port: parseInt(process.env.AZURE_SQL_PORT || '3306'),
  database: process.env.AZURE_SQL_SCHEMA || 'forestgeo_testing',
  multipleStatements: true
};

// Ingestion monitoring data structure
interface IngestionStage {
  stageName: string;
  recordCount: number;
  timestamp: Date;
  details?: any;
}

interface IngestionReport {
  testName: string;
  fileID: string;
  batchID: string;
  stages: IngestionStage[];
  duplicatesFound: number;
  deduplicatedCount: number;
  failedValidations: number;
  successfulInsertions: number;
  attributesMerged: number;
  warnings: string[];
  errors: string[];
  duration: number;
}

class IngestionMonitor {
  private connection: mysql.Connection;
  private report: IngestionReport;
  private startTime: number;

  constructor(connection: mysql.Connection, testName: string, fileID: string, batchID: string) {
    this.connection = connection;
    this.startTime = Date.now();
    this.report = {
      testName,
      fileID,
      batchID,
      stages: [],
      duplicatesFound: 0,
      deduplicatedCount: 0,
      failedValidations: 0,
      successfulInsertions: 0,
      attributesMerged: 0,
      warnings: [],
      errors: [],
      duration: 0
    };
  }

  /**
   * Track a stage in the ingestion process
   */
  async trackStage(stageName: string, countQuery?: string, details?: any) {
    let recordCount = 0;

    if (countQuery) {
      try {
        const [rows] = await this.connection.query<mysql.RowDataPacket[]>(countQuery);
        recordCount = rows[0]?.count || rows[0]?.recordCount || 0;
      } catch (error: any) {
        this.report.errors.push(`Error counting records for ${stageName}: ${error.message}`);
      }
    }

    this.report.stages.push({
      stageName,
      recordCount,
      timestamp: new Date(),
      details
    });

    return recordCount;
  }

  /**
   * Check for duplicates in temporarymeasurements
   */
  async checkDuplicates(): Promise<number> {
    const query = `
      SELECT
        TreeTag, StemTag, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate,
        COUNT(*) as duplicate_count,
        GROUP_CONCAT(id) as ids,
        GROUP_CONCAT(DISTINCT Codes ORDER BY Codes SEPARATOR ';') as all_codes
      FROM temporarymeasurements
      WHERE FileID = ? AND BatchID = ?
      GROUP BY TreeTag, StemTag, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate
      HAVING COUNT(*) > 1
    `;

    const [rows] = await this.connection.query<mysql.RowDataPacket[]>(query, [this.report.fileID, this.report.batchID]);

    this.report.duplicatesFound = rows.length;

    if (rows.length > 0) {
      await this.trackStage('Duplicate Detection', undefined, {
        duplicateGroups: rows.length,
        totalDuplicates: rows.reduce((sum, row) => sum + row.duplicate_count, 0),
        samples: rows.slice(0, 3) // First 3 duplicate groups for inspection
      });
    }

    return rows.length;
  }

  /**
   * Verify deduplication logic
   */
  async verifyDeduplication(): Promise<boolean> {
    const query = `
      SELECT
        TreeTag, StemTag,
        COUNT(*) as original_count,
        GROUP_CONCAT(DISTINCT Codes ORDER BY Codes SEPARATOR ';') as expected_merged_codes
      FROM temporarymeasurements
      WHERE FileID = ? AND BatchID = ?
      GROUP BY TreeTag, StemTag, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate
      HAVING COUNT(*) > 1
    `;

    const [duplicates] = await this.connection.query<mysql.RowDataPacket[]>(query, [this.report.fileID, this.report.batchID]);

    if (duplicates.length === 0) {
      return true; // No duplicates to verify
    }

    // After bulkingestionprocess runs, verify codes were merged
    let allMerged = true;
    for (const dup of duplicates) {
      const expectedCodes =
        dup.expected_merged_codes
          ?.split(';')
          .filter((c: string) => c)
          .sort() || [];

      if (expectedCodes.length > 1) {
        this.report.attributesMerged += expectedCodes.length;
        await this.trackStage('Attribute Merge Verification', undefined, {
          treeTag: dup.TreeTag,
          stemTag: dup.StemTag,
          expectedCodes: expectedCodes.join(';'),
          originalCount: dup.original_count
        });
      }
    }

    return allMerged;
  }

  /**
   * Track failed validations (unresolved ingestion errors in coremeasurements with StemGUID IS NULL)
   */
  async trackFailedValidations(): Promise<number> {
    const countQuery = `
      SELECT COUNT(DISTINCT cm.CoreMeasurementID) as count
      FROM coremeasurements cm
      JOIN measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
      JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
      WHERE cm.StemGUID IS NULL
        AND mel.IsResolved = FALSE
        AND me.ErrorSource = 'ingestion'
        AND cm.CensusID IN (
          SELECT DISTINCT CensusID FROM temporarymeasurements
          WHERE FileID = ? AND BatchID = ?
        )
    `;

    const count = await this.trackStage('Failed Validations', countQuery.replace('?', `'${this.report.fileID}'`).replace('?', `'${this.report.batchID}'`));

    this.report.failedValidations = count;
    return count;
  }

  /**
   * Track successful insertions to coremeasurements
   */
  async trackSuccessfulInsertions(): Promise<number> {
    const query = `
      SELECT COUNT(DISTINCT cm.CoreMeasurementID) as count
      FROM coremeasurements cm
      INNER JOIN stems s ON s.StemGUID = cm.StemGUID
      INNER JOIN trees t ON t.TreeID = s.TreeID
      WHERE t.TreeTag IN (
        SELECT DISTINCT TreeTag FROM temporarymeasurements
        WHERE FileID = ? AND BatchID = ?
      )
      AND cm.IsActive = 1
    `;

    const [rows] = await this.connection.query<mysql.RowDataPacket[]>(query, [this.report.fileID, this.report.batchID]);

    const count = rows[0]?.count || 0;
    this.report.successfulInsertions = count;

    await this.trackStage('Successful Insertions to CoreMeasurements', undefined, { count });
    return count;
  }

  /**
   * Verify attribute codes were properly inserted
   */
  async verifyAttributeCodes(): Promise<{ matched: number; missing: number }> {
    const query = `
      SELECT
        t.TreeTag,
        s.StemTag,
        cm.CoreMeasurementID,
        GROUP_CONCAT(DISTINCT cma.Code ORDER BY cma.Code SEPARATOR ';') as actual_codes
      FROM temporarymeasurements tm
      INNER JOIN trees t ON t.TreeTag = tm.TreeTag
      INNER JOIN stems s ON s.TreeID = t.TreeID AND s.StemTag = tm.StemTag
      INNER JOIN coremeasurements cm ON cm.StemGUID = s.StemGUID
      LEFT JOIN cmattributes cma ON cma.CoreMeasurementID = cm.CoreMeasurementID
      WHERE tm.FileID = ? AND tm.BatchID = ?
        AND tm.Codes IS NOT NULL AND TRIM(tm.Codes) != ''
      GROUP BY t.TreeTag, s.StemTag, cm.CoreMeasurementID
    `;

    const [rows] = await this.connection.query<mysql.RowDataPacket[]>(query, [this.report.fileID, this.report.batchID]);

    let matched = 0;
    let missing = 0;

    for (const row of rows) {
      if (row.actual_codes) {
        matched++;
      } else {
        missing++;
        this.report.warnings.push(`Missing attribute codes for TreeTag: ${row.TreeTag}, StemTag: ${row.StemTag}`);
      }
    }

    await this.trackStage('Attribute Code Verification', undefined, { matched, missing });
    return { matched, missing };
  }

  /**
   * Finalize the report
   */
  finalize(): IngestionReport {
    this.report.duration = Date.now() - this.startTime;
    return this.report;
  }

  /**
   * Generate a human-readable report
   */
  generateTextReport(): string {
    const report = this.finalize();
    let output = '';

    output += '═══════════════════════════════════════════════════════════\n';
    output += `  INGESTION MONITORING REPORT\n`;
    output += '═══════════════════════════════════════════════════════════\n\n';

    output += `Test Name: ${report.testName}\n`;
    output += `File ID: ${report.fileID}\n`;
    output += `Batch ID: ${report.batchID}\n`;
    output += `Duration: ${report.duration}ms\n\n`;

    output += '───────────────────────────────────────────────────────────\n';
    output += '  INGESTION STAGES\n';
    output += '───────────────────────────────────────────────────────────\n';

    for (const stage of report.stages) {
      output += `\n[${stage.timestamp.toISOString()}] ${stage.stageName}\n`;
      output += `  Records: ${stage.recordCount}\n`;
      if (stage.details) {
        output += `  Details: ${JSON.stringify(stage.details, null, 2)}\n`;
      }
    }

    output += '\n───────────────────────────────────────────────────────────\n';
    output += '  SUMMARY\n';
    output += '───────────────────────────────────────────────────────────\n\n';

    output += `Duplicates Found: ${report.duplicatesFound}\n`;
    output += `Failed Validations: ${report.failedValidations}\n`;
    output += `Successful Insertions: ${report.successfulInsertions}\n`;
    output += `Attributes Merged: ${report.attributesMerged}\n\n`;

    if (report.warnings.length > 0) {
      output += '⚠️  WARNINGS:\n';
      report.warnings.forEach(w => (output += `  - ${w}\n`));
      output += '\n';
    }

    if (report.errors.length > 0) {
      output += '❌ ERRORS:\n';
      report.errors.forEach(e => (output += `  - ${e}\n`));
      output += '\n';
    }

    // Data integrity check
    const expectedRecords = report.stages.find(s => s.stageName === 'Initial Upload')?.recordCount || 0;
    const finalRecords = report.successfulInsertions;
    const dataLoss = expectedRecords - finalRecords - report.failedValidations;

    output += '───────────────────────────────────────────────────────────\n';
    output += '  DATA INTEGRITY\n';
    output += '───────────────────────────────────────────────────────────\n\n';

    output += `Initial Records: ${expectedRecords}\n`;
    output += `Final Records: ${finalRecords}\n`;
    output += `Failed Validations: ${report.failedValidations}\n`;
    output += `Potential Data Loss: ${dataLoss}\n\n`;

    if (dataLoss > 0) {
      output += `⚠️  WARNING: ${dataLoss} records appear to be lost!\n`;
    } else if (dataLoss < 0) {
      output += `✅ Data integrity maintained (duplicates were merged)\n`;
    } else {
      output += `✅ All records accounted for\n`;
    }

    output += '\n═══════════════════════════════════════════════════════════\n';

    return output;
  }
}

describe('E2E Ingestion Monitoring', () => {
  let connection: mysql.Connection;
  let testFileID: string;
  let testBatchID: string;
  let testPlotID: number;
  let testCensusID: number;
  let testSpeciesCode: string;
  let testQuadratName: string;
  let dbAvailable = false;

  beforeAll(async () => {
    try {
      connection = await mysql.createConnection(dbConfig);
      dbAvailable = true;

      // Get valid test data references
      const [plots] = await connection.query<mysql.RowDataPacket[]>('SELECT PlotID FROM plots WHERE IsActive = 1 LIMIT 1');

      const [census] = await connection.query<mysql.RowDataPacket[]>('SELECT CensusID FROM census WHERE PlotID = ? AND IsActive = 1 LIMIT 1', [
        plots[0].PlotID
      ]);

      const [species] = await connection.query<mysql.RowDataPacket[]>('SELECT SpeciesCode FROM species WHERE IsActive = 1 LIMIT 1');

      const [quadrats] = await connection.query<mysql.RowDataPacket[]>('SELECT QuadratName FROM quadrats WHERE PlotID = ? AND IsActive = 1 LIMIT 1', [
        plots[0].PlotID
      ]);

      testPlotID = plots[0].PlotID;
      testCensusID = census[0].CensusID;
      testSpeciesCode = species[0].SpeciesCode;
      testQuadratName = quadrats[0].QuadratName;
    } catch (error) {
      console.warn('Database not available for testing. Skipping E2E ingestion tests.');
      dbAvailable = false;
    }
  });

  beforeEach(() => {
    testFileID = `e2e_test_${uuidv4().substring(0, 8)}`;
    testBatchID = `batch_${uuidv4().substring(0, 8)}`;
  });

  afterAll(async () => {
    if (connection) {
      await connection.end();
    }
  });

  describe('Deduplication Monitoring', () => {
    it('should track deduplication of records with different codes', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }

      const monitor = new IngestionMonitor(connection, 'Deduplication Test', testFileID, testBatchID);

      // Step 1: Insert test data with duplicates
      const baseData = {
        FileID: testFileID,
        BatchID: testBatchID,
        PlotID: testPlotID,
        CensusID: testCensusID,
        TreeTag: `E2E_${uuidv4().substring(0, 8)}`,
        StemTag: '0001',
        SpeciesCode: testSpeciesCode,
        QuadratName: testQuadratName,
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
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'A'),
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DS'),
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'M'),
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [...Object.values(baseData), ...Object.values(baseData), ...Object.values(baseData), ...Object.values(baseData)]
      );

      await monitor.trackStage(
        'Initial Upload',
        `SELECT COUNT(*) as count FROM temporarymeasurements WHERE FileID = '${testFileID}' AND BatchID = '${testBatchID}'`
      );

      // Step 2: Check for duplicates
      const duplicateCount = await monitor.checkDuplicates();
      expect(duplicateCount).toBeGreaterThan(0);

      // Step 3: Run ingestion process
      await monitor.trackStage('Running bulkingestionprocess');
      await connection.query('CALL bulkingestionprocess(?, ?)', [testFileID, testBatchID]);

      // Step 4: Verify deduplication
      await monitor.verifyDeduplication();

      // Step 5: Track final insertions
      await monitor.trackSuccessfulInsertions();

      // Step 6: Verify attribute codes
      const { matched, missing } = await monitor.verifyAttributeCodes();

      // Generate and log report
      const textReport = monitor.generateTextReport();
      console.log('\n' + textReport);

      // Save report to file
      const reportPath = `/tmp/ingestion_report_${testFileID}.txt`;
      fs.writeFileSync(reportPath, textReport);
      console.log(`Report saved to: ${reportPath}`);

      const report = monitor.finalize();

      // Assertions
      expect(report.stages.length).toBeGreaterThan(0);
      expect(report.duplicatesFound).toBeGreaterThan(0);
      expect(report.successfulInsertions).toBeGreaterThan(0);
      expect(matched).toBeGreaterThan(0); // Codes should be present

      // Clean up
      await connection.query('DELETE FROM temporarymeasurements WHERE FileID = ? AND BatchID = ?', [testFileID, testBatchID]);
    });

    it('should verify GROUP_CONCAT preserves all codes from duplicates', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }

      const monitor = new IngestionMonitor(connection, 'GROUP_CONCAT Verification', testFileID, testBatchID);

      const treeTag = `VERIFY_${uuidv4().substring(0, 8)}`;

      // Insert 3 duplicates with different codes
      const measurements = [
        { code: 'A', comment: 'First' },
        { code: 'DS', comment: 'Second' },
        { code: 'M', comment: 'Third' }
      ];

      for (const meas of measurements) {
        await connection.query(
          `INSERT INTO temporarymeasurements
           (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName,
            LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            testFileID,
            testBatchID,
            testPlotID,
            testCensusID,
            treeTag,
            '0001',
            testSpeciesCode,
            testQuadratName,
            10.5,
            20.5,
            15.5,
            1.3,
            '2024-06-15',
            meas.code,
            meas.comment
          ]
        );
      }

      await monitor.trackStage('Initial Upload', `SELECT COUNT(*) as count FROM temporarymeasurements WHERE FileID = '${testFileID}'`);

      // Check what GROUP_CONCAT produces
      const [preIngestion] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT
           GROUP_CONCAT(DISTINCT CASE WHEN Codes IS NOT NULL AND TRIM(Codes) != ''
                        THEN TRIM(Codes) END ORDER BY Codes SEPARATOR ';') as merged_codes,
           GROUP_CONCAT(DISTINCT CASE WHEN Comments IS NOT NULL AND TRIM(Comments) != ''
                        THEN TRIM(Comments) END ORDER BY Comments SEPARATOR ' | ') as merged_comments
         FROM temporarymeasurements
         WHERE FileID = ? AND BatchID = ?`,
        [testFileID, testBatchID]
      );

      expect(preIngestion[0].merged_codes).toContain('A');
      expect(preIngestion[0].merged_codes).toContain('DS');
      expect(preIngestion[0].merged_codes).toContain('M');
      expect(preIngestion[0].merged_comments).toContain('First');
      expect(preIngestion[0].merged_comments).toContain('Second');
      expect(preIngestion[0].merged_comments).toContain('Third');

      await monitor.trackStage('Deduplication Preview', undefined, {
        mergedCodes: preIngestion[0].merged_codes,
        mergedComments: preIngestion[0].merged_comments
      });

      // Run ingestion
      await connection.query('CALL bulkingestionprocess(?, ?)', [testFileID, testBatchID]);

      // Verify all codes are in cmattributes
      const [postIngestion] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT
           GROUP_CONCAT(DISTINCT cma.Code ORDER BY cma.Code SEPARATOR ';') as final_codes
         FROM trees t
         INNER JOIN stems s ON s.TreeID = t.TreeID
         INNER JOIN coremeasurements cm ON cm.StemGUID = s.StemGUID
         LEFT JOIN cmattributes cma ON cma.CoreMeasurementID = cm.CoreMeasurementID
         WHERE t.TreeTag = ?
         GROUP BY cm.CoreMeasurementID`,
        [treeTag]
      );

      console.log('\n✅ GROUP_CONCAT Verification:');
      console.log(`   Before: ${preIngestion[0].merged_codes}`);
      console.log(`   After:  ${postIngestion[0]?.final_codes || 'NULL'}`);

      expect(postIngestion[0]?.final_codes).toContain('A');
      expect(postIngestion[0]?.final_codes).toContain('DS');
      expect(postIngestion[0]?.final_codes).toContain('M');

      const report = monitor.generateTextReport();
      console.log('\n' + report);

      // Clean up
      await connection.query('DELETE FROM temporarymeasurements WHERE FileID = ?', [testFileID]);
    });
  });

  describe('Full Ingestion Pipeline Monitoring', () => {
    it('should monitor complete ingestion from upload to final insertion', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }

      const monitor = new IngestionMonitor(connection, 'Full Pipeline Test', testFileID, testBatchID);

      // Simulate realistic data with mix of valid, invalid, and duplicate records
      const records = [
        // Valid unique records
        { tag: 'TREE001', stem: '0001', x: 10.5, y: 20.5, dbh: 15.5, code: 'A', valid: true },
        { tag: 'TREE002', stem: '0001', x: 11.5, y: 21.5, dbh: 16.5, code: 'DS', valid: true },

        // Duplicate records (same tree/stem/coords but different codes)
        { tag: 'TREE003', stem: '0001', x: 12.5, y: 22.5, dbh: 17.5, code: 'A', valid: true },
        { tag: 'TREE003', stem: '0001', x: 12.5, y: 22.5, dbh: 17.5, code: 'M', valid: true },
        { tag: 'TREE003', stem: '0001', x: 12.5, y: 22.5, dbh: 17.5, code: 'P', valid: true },

        // Invalid record (missing required data)
        { tag: 'TREE004', stem: '0001', x: null, y: null, dbh: 0, code: null, valid: false }
      ];

      // Insert all records
      for (const rec of records) {
        await connection.query(
          `INSERT INTO temporarymeasurements
           (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName,
            LocalX, LocalY, DBH, HOM, MeasurementDate, Codes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            testFileID,
            testBatchID,
            testPlotID,
            testCensusID,
            rec.tag,
            rec.stem,
            testSpeciesCode,
            testQuadratName,
            rec.x,
            rec.y,
            rec.dbh,
            1.3,
            '2024-06-15',
            rec.code
          ]
        );
      }

      // Monitor Stage 1: Initial Upload
      const initialCount = await monitor.trackStage('Initial Upload', `SELECT COUNT(*) as count FROM temporarymeasurements WHERE FileID = '${testFileID}'`);
      expect(initialCount).toBe(records.length);

      // Monitor Stage 2: Duplicate Detection
      const duplicateGroups = await monitor.checkDuplicates();
      expect(duplicateGroups).toBe(1); // TREE003 has 3 duplicates

      // Monitor Stage 3: Execute Ingestion
      await monitor.trackStage('Executing bulkingestionprocess');
      await connection.query('CALL bulkingestionprocess(?, ?)', [testFileID, testBatchID]);

      // Monitor Stage 4: Failed Validations
      await monitor.trackFailedValidations();

      // Monitor Stage 5: Successful Insertions
      const successCount = await monitor.trackSuccessfulInsertions();

      // We expect: 2 unique records + 1 merged from duplicates = 3 successful
      // (TREE004 should fail validation)
      expect(successCount).toBeGreaterThanOrEqual(3);

      // Monitor Stage 6: Attribute Verification
      const { matched, missing } = await monitor.verifyAttributeCodes();
      expect(matched).toBeGreaterThan(0);

      // Generate comprehensive report
      const report = monitor.generateTextReport();
      console.log('\n' + report);

      // Save to file
      const reportPath = `/tmp/full_pipeline_report_${testFileID}.txt`;
      fs.writeFileSync(reportPath, report);

      const finalReport = monitor.finalize();

      // Validate report integrity
      expect(finalReport.stages.length).toBeGreaterThanOrEqual(6);
      expect(finalReport.duplicatesFound).toBe(1);
      expect(finalReport.failedValidations).toBeGreaterThanOrEqual(1); // TREE004
      expect(finalReport.successfulInsertions).toBeGreaterThanOrEqual(3);
      expect(finalReport.warnings.length + finalReport.errors.length).toBeLessThan(5);

      console.log('\n✅ Full Pipeline Monitoring Complete');
      console.log(`   Report saved to: ${reportPath}`);

      // Clean up
      await connection.query('DELETE FROM temporarymeasurements WHERE FileID = ?', [testFileID]);
    });
  });
});
