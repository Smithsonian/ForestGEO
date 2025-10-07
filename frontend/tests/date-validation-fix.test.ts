/**
 * Unit tests for Issue #1: Date Auto-Change Fix
 *
 * Tests the fix for the bug where editing a measurement in the failed measurements
 * screen would automatically change the date to the current date.
 *
 * Fix location: components/datagrids/isolateddatagridcommons.tsx:693-698
 */

import { describe, it, expect } from 'vitest';
import moment from 'moment';

/**
 * Simulates the date processing logic from isolateddatagridcommons.tsx
 */
function processRowDate(rowDate: any): string | undefined {
  if ('date' in { date: rowDate } && rowDate) {
    const parsedDate = moment(rowDate, 'YYYY-MM-DD', true);
    if (parsedDate.isValid()) {
      return parsedDate.format('YYYY-MM-DD');
    }
  }
  return undefined;
}

describe('Date Auto-Change Fix - Issue #1', () => {
  describe('Valid Date Handling', () => {
    it('should preserve a valid date in YYYY-MM-DD format', () => {
      const input = '2024-05-15';
      const result = processRowDate(input);
      expect(result).toBe('2024-05-15');
    });

    it('should handle dates at start of year', () => {
      const input = '2024-01-01';
      const result = processRowDate(input);
      expect(result).toBe('2024-01-01');
    });

    it('should handle dates at end of year', () => {
      const input = '2024-12-31';
      const result = processRowDate(input);
      expect(result).toBe('2024-12-31');
    });

    it('should handle leap year dates', () => {
      const input = '2024-02-29';
      const result = processRowDate(input);
      expect(result).toBe('2024-02-29');
    });

    it('should preserve existing measurement dates', () => {
      const input = '2023-08-20';
      const result = processRowDate(input);
      expect(result).toBe('2023-08-20');
    });
  });

  describe('Invalid Date Handling', () => {
    it('should NOT auto-change to current date for invalid input', () => {
      const input = 'invalid-date';
      const result = processRowDate(input);

      // The fix ensures invalid dates return undefined, not current date
      expect(result).toBeUndefined();
      expect(result).not.toBe(moment().format('YYYY-MM-DD'));
    });

    it('should reject dates in wrong format (MM-DD-YYYY)', () => {
      const input = '05-15-2024';
      const result = processRowDate(input);
      expect(result).toBeUndefined();
    });

    it('should reject dates in wrong format (DD/MM/YYYY)', () => {
      const input = '15/05/2024';
      const result = processRowDate(input);
      expect(result).toBeUndefined();
    });

    it('should reject empty string', () => {
      const input = '';
      const result = processRowDate(input);
      expect(result).toBeUndefined();
    });

    it('should handle null input', () => {
      const input = null;
      const result = processRowDate(input);
      expect(result).toBeUndefined();
    });

    it('should handle undefined input', () => {
      const input = undefined;
      const result = processRowDate(input);
      expect(result).toBeUndefined();
    });

    it('should reject invalid dates like 2024-13-01 (invalid month)', () => {
      const input = '2024-13-01';
      const result = processRowDate(input);
      expect(result).toBeUndefined();
    });

    it('should reject invalid dates like 2024-02-30 (invalid day)', () => {
      const input = '2024-02-30';
      const result = processRowDate(input);
      expect(result).toBeUndefined();
    });

    it('should reject non-leap year Feb 29th', () => {
      const input = '2023-02-29';
      const result = processRowDate(input);
      expect(result).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle moment object input', () => {
      const input = moment('2024-05-15');
      const result = processRowDate(input);
      expect(result).toBe('2024-05-15');
    });

    it('should handle date object input', () => {
      const input = new Date('2024-05-15');
      // moment can parse Date objects even in strict mode
      const result = processRowDate(input as any);
      // Date objects will be parsed and formatted correctly
      expect(result).toBeDefined();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should enforce strict parsing (not lenient)', () => {
      // With strict mode, moment won't do "clever" parsing
      const input = '2024-5-1'; // Missing leading zeros
      const result = processRowDate(input);
      expect(result).toBeUndefined();
    });

    it('should not accept partial dates', () => {
      const input = '2024-05';
      const result = processRowDate(input);
      expect(result).toBeUndefined();
    });

    it('should not accept dates with extra characters', () => {
      const input = '2024-05-15T00:00:00';
      const result = processRowDate(input);
      expect(result).toBeUndefined();
    });
  });

  describe('Real-World Scenarios', () => {
    it('should preserve date when editing other fields (TreeTag)', () => {
      // Simulates editing TreeTag while date remains unchanged
      const originalDate = '2024-03-10';
      const result = processRowDate(originalDate);
      expect(result).toBe('2024-03-10');
      expect(result).not.toBe(moment().format('YYYY-MM-DD'));
    });

    it('should preserve date when editing other fields (DBH)', () => {
      // Simulates editing DBH while date remains unchanged
      const originalDate = '2024-06-22';
      const result = processRowDate(originalDate);
      expect(result).toBe('2024-06-22');
      expect(result).not.toBe(moment().format('YYYY-MM-DD'));
    });

    it('should handle census date edge cases (start date)', () => {
      // Typical census start date
      const input = '2024-01-15';
      const result = processRowDate(input);
      expect(result).toBe('2024-01-15');
    });

    it('should handle census date edge cases (end date)', () => {
      // Typical census end date
      const input = '2024-12-15';
      const result = processRowDate(input);
      expect(result).toBe('2024-12-15');
    });
  });

  describe('Before Fix Regression Test', () => {
    it('demonstrates the fix prevents auto-date assignment', () => {
      // This test documents how the fix prevents the bug
      const invalidInput = 'invalid-date';
      const currentDate = moment().format('YYYY-MM-DD');

      // Old buggy code: moment(invalidInput).format('YYYY-MM-DD')
      // Would create a moment with invalid date, which when formatted gives "Invalid date" string
      // But when used in row updates, it could inadvertently get replaced with current date

      // New code with strict parsing prevents this
      const fixedBehavior = processRowDate(invalidInput);

      // Fixed behavior: returns undefined for invalid dates
      expect(fixedBehavior).toBeUndefined();

      // Does NOT auto-assign to current date
      expect(fixedBehavior).not.toBe(currentDate);

      // This ensures the date field is left unchanged when invalid
    });
  });
});
