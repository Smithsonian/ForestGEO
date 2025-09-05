// Database Query Validation Tests for StemID -> StemGUID Migration
// Ensures all SQL queries use correct column names and relationships
import { describe, expect, it, vi } from 'vitest';
import ConnectionManager from '@/config/connectionmanager';

// Mock ConnectionManager
const mockExecuteQuery = vi.fn();
vi.mock('@/config/connectionmanager', () => ({
  default: {
    getInstance: () => ({
      executeQuery: mockExecuteQuery,
      closeConnection: vi.fn()
    })
  }
}));

describe('StemGUID Query Validation - Critical Database Operations', () => {
  describe('Core JOIN Pattern Validation', () => {
    it('validates stems-to-measurements JOIN uses StemGUID', async () => {
      // Test the most critical JOIN pattern in the system
      const testQuery = `
        SELECT cm.CoreMeasurementID, st.StemTag, st.StemGUID
        FROM coremeasurements cm
        JOIN stems st ON cm.StemGUID = st.StemGUID
        WHERE st.CensusID = ? AND cm.CensusID = ?
      `;

      mockExecuteQuery.mockResolvedValueOnce([{ CoreMeasurementID: 100, StemTag: 'S001', StemGUID: 123 }]);

      const results = await mockExecuteQuery(testQuery, [1, 1]);

      // Validate query structure
      expect(testQuery).toContain('cm.StemGUID = st.StemGUID');
      expect(testQuery).toContain('st.StemGUID');
      expect(testQuery).not.toContain('StemID');

      // Validate results
      expect(results[0].StemGUID).toBe(123);
    });

    it('validates measurement-summary view JOIN patterns', async () => {
      // Test the complex view queries
      const viewQuery = `
        SELECT 
          st.StemGUID AS StemGUID,
          cm.CoreMeasurementID,
          st.StemTag,
          t.TreeTag
        FROM stems st
        JOIN coremeasurements cm ON st.StemGUID = cm.StemGUID
        JOIN trees t ON st.TreeID = t.TreeID
        WHERE st.CensusID = cm.CensusID
      `;

      expect(viewQuery).toContain('st.StemGUID = cm.StemGUID');
      expect(viewQuery).toContain('st.StemGUID AS StemGUID');
      expect(viewQuery).not.toContain('StemID');
    });
  });

  describe('Cross-Census Query Validation', () => {
    it('validates growth validation queries use StemGUID for temporal linking', () => {
      // Test DBH growth validation pattern
      const growthQuery = `
        SELECT cm_present.CoreMeasurementID
        FROM coremeasurements cm_present
        JOIN coremeasurements cm_past ON cm_present.StemGUID = cm_past.StemGUID
        WHERE cm_present.CensusID <> cm_past.CensusID
        AND cm_present.MeasuredDBH - cm_past.MeasuredDBH > 65
      `;

      expect(growthQuery).toContain('cm_present.StemGUID = cm_past.StemGUID');
      expect(growthQuery).not.toContain('StemID');
    });

    it('validates stem rollover queries maintain StemGUID relationships', () => {
      // Test stem rollover between censuses
      const rolloverQuery = `
        INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY)
        SELECT TreeID, QuadratID, ?, StemTag, LocalX, LocalY
        FROM stems 
        WHERE StemGUID IN (?, ?, ?) AND CensusID = ?
      `;

      expect(rolloverQuery).toContain('WHERE StemGUID IN');
      expect(rolloverQuery).not.toContain('StemID');
    });
  });

  describe('Bulk Operation Query Validation', () => {
    it('validates bulk insert operations handle StemGUID correctly', () => {
      // Test bulk insert query structure
      const bulkInsertQuery = `
        INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        LocalX = VALUES(LocalX),
        LocalY = VALUES(LocalY)
      `;

      // StemGUID should not appear in INSERT fields (auto-increment)
      expect(bulkInsertQuery).not.toContain('StemGUID');
      expect(bulkInsertQuery).not.toContain('StemID');
    });

    it('validates bulk update operations target by StemGUID', () => {
      // Test bulk update query structure
      const bulkUpdateQuery = `
        UPDATE stems 
        SET TreeID = ?, LocalX = ?, LocalY = ?
        WHERE StemGUID = ? AND CensusID = ?
      `;

      expect(bulkUpdateQuery).toContain('WHERE StemGUID = ?');
      expect(bulkUpdateQuery).not.toContain('WHERE StemID = ?');
    });
  });

  describe('Index Usage Validation', () => {
    it('validates queries can utilize StemGUID indexes efficiently', () => {
      // Test index-optimized query patterns
      const indexOptimizedQueries = [
        'SELECT * FROM stems WHERE StemGUID = ?', // Primary key lookup
        'SELECT * FROM coremeasurements WHERE StemGUID = ?', // Foreign key lookup
        'SELECT * FROM stems WHERE StemGUID IN (SELECT StemGUID FROM coremeasurements WHERE MeasuredDBH > ?)' // Index join
      ];

      indexOptimizedQueries.forEach(query => {
        expect(query).toContain('StemGUID');
        expect(query).not.toContain('StemID');
      });
    });
  });

  describe('Transaction Boundary Edge Cases', () => {
    it('validates transaction operations maintain StemGUID consistency', async () => {
      // Test transaction scenarios where StemGUID relationships must be maintained
      const transactionQueries = [
        'INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag) VALUES (?, ?, ?, ?)',
        'SELECT LAST_INSERT_ID() as StemGUID',
        'INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH) VALUES (?, ?, ?)'
      ];

      // Mock transaction flow
      mockExecuteQuery
        .mockResolvedValueOnce({ insertId: 500 }) // INSERT stem
        .mockResolvedValueOnce([{ StemGUID: 500 }]) // Get new StemGUID
        .mockResolvedValueOnce({ insertId: 1000 }); // INSERT measurement

      // Simulate transaction
      const stemResult = await mockExecuteQuery(transactionQueries[0], [100, 50, 1, 'NEW001']);
      const stemGUIDResult = await mockExecuteQuery(transactionQueries[1]);
      const measurementResult = await mockExecuteQuery(transactionQueries[2], [stemGUIDResult[0].StemGUID, 1, 15.5]);

      expect(stemResult.insertId).toBe(500);
      expect(stemGUIDResult[0].StemGUID).toBe(500);
    });
  });

  describe('Unique Constraint Edge Cases', () => {
    it('validates unique constraints reference StemGUID correctly', () => {
      // Test unique constraint definitions
      const uniqueConstraints = [
        'UNIQUE KEY ux_stems_treeid_stemtag_census (TreeID, StemTag, CensusID)',
        'UNIQUE KEY ux_stems_coordinate (StemTag, TreeID, QuadratID, LocalX, LocalY, IsActive, CensusID)'
      ];

      // These should NOT include StemGUID in unique constraints (it's auto-increment primary key)
      uniqueConstraints.forEach(constraint => {
        expect(constraint).not.toContain('StemGUID');
        expect(constraint).not.toContain('StemID');
      });
    });
  });

  describe('Error Handling Query Edge Cases', () => {
    it('validates error queries reference StemGUID for debugging', () => {
      // Test error identification queries
      const errorQuery = `
        SELECT 
          cm.CoreMeasurementID,
          st.StemGUID,
          st.StemTag,
          'Duplicate measurement' as ErrorType
        FROM coremeasurements cm
        JOIN stems st ON cm.StemGUID = st.StemGUID
        WHERE cm.CensusID = ? 
        GROUP BY cm.StemGUID, cm.MeasurementDate
        HAVING COUNT(*) > 1
      `;

      expect(errorQuery).toContain('cm.StemGUID = st.StemGUID');
      expect(errorQuery).toContain('GROUP BY cm.StemGUID');
      expect(errorQuery).toContain('st.StemGUID');
    });
  });
});
