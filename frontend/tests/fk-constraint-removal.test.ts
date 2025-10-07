/**
 * Integration tests for Issue #4: FK Constraint Removal
 *
 * Tests that the foreign key constraint CMAttributes_Attributes_Code_fk has been
 * removed, allowing invalid attribute codes to be displayed for correction.
 *
 * Fix location:
 * - db-migrations/11_remove_cmattributes_fk_constraint.sql
 * - sqlscripting/tablestructures.sql:737-740
 *
 * NOTE: These tests require database access. They will be skipped if database is unavailable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';

const dbConfig = {
  host: process.env.AZURE_SQL_SERVER || 'forestgeo-mysqldataserver.mysql.database.azure.com',
  user: process.env.AZURE_SQL_USER || 'azureroot',
  password: process.env.AZURE_SQL_PASSWORD || 'P@ssw0rd',
  port: parseInt(process.env.AZURE_SQL_PORT || '3306'),
  database: process.env.AZURE_SQL_SCHEMA || 'forestgeo_testing'
};

describe('FK Constraint Removal - Issue #4', () => {
  let connection: mysql.Connection;
  let dbAvailable = false;

  beforeAll(async () => {
    try {
      connection = await mysql.createConnection(dbConfig);
      dbAvailable = true;
    } catch (error) {
      console.warn('Database not available for testing. Skipping database tests.');
      dbAvailable = false;
    }
  });

  afterAll(async () => {
    if (connection) {
      await connection.end();
    }
  });

  describe('Constraint Verification', () => {
    it('should confirm FK constraint CMAttributes_Attributes_Code_fk does not exist', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) as count
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = ?
           AND TABLE_NAME = 'cmattributes'
           AND CONSTRAINT_NAME = 'CMAttributes_Attributes_Code_fk'
           AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
        [dbConfig.database]
      );

      expect(rows[0].count).toBe(0);
    });

    it('should confirm cmattributes table exists', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) as count
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME = 'cmattributes'`,
        [dbConfig.database]
      );

      expect(rows[0].count).toBe(1);
    });

    it('should confirm Code column exists in cmattributes', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) as count
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME = 'cmattributes'
           AND COLUMN_NAME = 'Code'`,
        [dbConfig.database]
      );

      expect(rows[0].count).toBe(1);
    });

    it('should confirm other FK constraint (CoreMeasurementID) still exists', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) as count
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = ?
           AND TABLE_NAME = 'cmattributes'
           AND CONSTRAINT_NAME = 'CMAttributes_CoreMeasurements_CoreMeasurementID_fk'
           AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
        [dbConfig.database]
      );

      // This FK should still exist
      expect(rows[0].count).toBe(1);
    });
  });

  describe('Functional Verification', () => {
    it('should allow inserting cmattributes with invalid attribute code', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }
      // This test verifies the fix allows invalid codes to be stored

      // Clean up any existing test data
      await connection.query(
        `DELETE FROM cmattributes WHERE Code = 'INVALID_TEST_CODE'`
      );

      // Get a valid CoreMeasurementID to use
      const [cmRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT CoreMeasurementID
         FROM coremeasurements
         LIMIT 1`
      );

      if (cmRows.length === 0) {
        console.warn('No coremeasurements found for testing');
        return;
      }

      const testCMID = cmRows[0].CoreMeasurementID;

      try {
        // Before the fix, this would fail with FK constraint violation
        // After the fix, this should succeed
        await connection.query(
          `INSERT INTO cmattributes (CoreMeasurementID, Code)
           VALUES (?, ?)`,
          [testCMID, 'INVALID_TEST_CODE']
        );

        // Verify the insert succeeded
        const [rows] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) as count
           FROM cmattributes
           WHERE Code = 'INVALID_TEST_CODE'`
        );

        expect(rows[0].count).toBeGreaterThan(0);
      } finally {
        // Clean up test data
        await connection.query(
          `DELETE FROM cmattributes WHERE Code = 'INVALID_TEST_CODE'`
        );
      }
    });

    it('should still allow valid attribute codes', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }
      // Verify that valid codes still work

      // Get a valid attribute code
      const [attrRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT Code
         FROM attributes
         WHERE IsActive = 1
         LIMIT 1`
      );

      if (attrRows.length === 0) {
        console.warn('No attributes found for testing');
        return;
      }

      const validCode = attrRows[0].Code;

      // Get a valid CoreMeasurementID
      const [cmRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT CoreMeasurementID
         FROM coremeasurements
         LIMIT 1`
      );

      if (cmRows.length === 0) {
        console.warn('No coremeasurements found for testing');
        return;
      }

      const testCMID = cmRows[0].CoreMeasurementID;

      // Clean up any existing test data
      await connection.query(
        `DELETE FROM cmattributes
         WHERE CoreMeasurementID = ? AND Code = ?`,
        [testCMID, validCode]
      );

      try {
        // Insert valid code
        await connection.query(
          `INSERT INTO cmattributes (CoreMeasurementID, Code)
           VALUES (?, ?)`,
          [testCMID, validCode]
        );

        // Verify the insert succeeded
        const [rows] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) as count
           FROM cmattributes
           WHERE CoreMeasurementID = ? AND Code = ?`,
          [testCMID, validCode]
        );

        expect(rows[0].count).toBe(1);
      } finally {
        // Clean up test data
        await connection.query(
          `DELETE FROM cmattributes
           WHERE CoreMeasurementID = ? AND Code = ?`,
          [testCMID, validCode]
        );
      }
    });
  });

  describe('Cross-Schema Verification', () => {
    it('should verify FK removal across all forestgeo_* schemas', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }
      // Get all forestgeo_* schemas
      const [schemas] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT SCHEMA_NAME
         FROM INFORMATION_SCHEMA.SCHEMATA
         WHERE SCHEMA_NAME LIKE 'forestgeo_%'`
      );

      for (const schema of schemas) {
        const schemaName = schema.SCHEMA_NAME;

        const [rows] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) as count
           FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
           WHERE CONSTRAINT_SCHEMA = ?
             AND TABLE_NAME = 'cmattributes'
             AND CONSTRAINT_NAME = 'CMAttributes_Attributes_Code_fk'
             AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
          [schemaName]
        );

        expect(rows[0].count).toBe(0);
      }
    });
  });

  describe('Regression Prevention', () => {
    it('should prevent FK from being accidentally re-added', async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }
      // Document the expected state
      const [constraints] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = ?
           AND TABLE_NAME = 'cmattributes'
         ORDER BY CONSTRAINT_NAME`,
        [dbConfig.database]
      );

      // Should have these constraints but NOT CMAttributes_Attributes_Code_fk
      const constraintNames = constraints.map(c => c.CONSTRAINT_NAME);

      expect(constraintNames).not.toContain('CMAttributes_Attributes_Code_fk');
      expect(constraintNames).toContain('CMAttributes_CoreMeasurements_CoreMeasurementID_fk');
      expect(constraintNames).toContain('unique_cm_attribute');
    });
  });

  describe('Documentation', () => {
    it('should verify migration script exists', async () => {
      const fs = await import('fs/promises');
      const path = '/Users/sambokar/Documents/ForestGEO/frontend/db-migrations/11_remove_cmattributes_fk_constraint.sql';

      const exists = await fs
        .access(path)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });

    it('should verify tablestructures.sql has been updated', async () => {
      const fs = await import('fs/promises');
      const path = '/Users/sambokar/Documents/ForestGEO/frontend/sqlscripting/tablestructures.sql';

      const content = await fs.readFile(path, 'utf-8');

      // Should have the FK constraint commented out or removed
      expect(content).toContain('-- FK constraint removed to allow invalid attribute codes');
    });
  });
});
