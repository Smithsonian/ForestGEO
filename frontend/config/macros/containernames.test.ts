import { describe, it, expect } from 'vitest';
import {
  getContainerName,
  getLegacyContainerName,
  validateContainerName,
  parseContainerName,
  getContainerNameWithFallback,
  isIdBasedContainerName
} from './containernames';

describe('Container Naming Utilities', () => {
  describe('getContainerName', () => {
    it('should generate valid ID-based container names', () => {
      expect(getContainerName(1, 1)).toBe('plot1-census1');
      expect(getContainerName(42, 3)).toBe('plot42-census3');
      expect(getContainerName(999, 10)).toBe('plot999-census10');
    });

    it('should throw error for invalid plotID', () => {
      expect(() => getContainerName(0, 1)).toThrow('Invalid plotID');
      expect(() => getContainerName(-1, 1)).toThrow('Invalid plotID');
      expect(() => getContainerName(NaN, 1)).toThrow('Invalid plotID');
    });

    it('should throw error for invalid censusNumber', () => {
      expect(() => getContainerName(1, 0)).toThrow('Invalid censusNumber');
      expect(() => getContainerName(1, -1)).toThrow('Invalid censusNumber');
      expect(() => getContainerName(1, NaN)).toThrow('Invalid censusNumber');
    });
  });

  describe('getLegacyContainerName', () => {
    it('should generate sanitized legacy container names', () => {
      expect(getLegacyContainerName('Test Plot', 1)).toBe('test-plot-1');
      expect(getLegacyContainerName('Barro Colorado Island', 2)).toBe('barro-colorado-island-2');
      expect(getLegacyContainerName('Plot #5A', 1)).toBe('plot-5a-1'); // # gets replaced with hyphen, consecutive hyphens removed
    });

    it('should handle names with special characters', () => {
      expect(getLegacyContainerName('Plot-A/B', 1)).toBe('plot-a-b-1');
      expect(getLegacyContainerName('Site_Name', 1)).toBe('site-name-1');
    });

    it('should remove consecutive hyphens', () => {
      expect(getLegacyContainerName('Plot  Name', 1)).toBe('plot-name-1');
      expect(getLegacyContainerName('Plot---Name', 1)).toBe('plot-name-1');
    });

    it('should throw error for empty plot name', () => {
      expect(() => getLegacyContainerName('', 1)).toThrow('Invalid plotName');
      expect(() => getLegacyContainerName('   ', 1)).toThrow('Invalid plotName');
    });

    it('should throw error for invalid censusNumber', () => {
      expect(() => getLegacyContainerName('Plot', 0)).toThrow('Invalid censusNumber');
    });
  });

  describe('validateContainerName', () => {
    it('should validate correct container names', () => {
      expect(validateContainerName('plot1-census1')).toBe(true);
      expect(validateContainerName('test-plot-1')).toBe(true);
      expect(validateContainerName('abc')).toBe(true); // minimum length
      expect(validateContainerName('a'.repeat(63))).toBe(true); // maximum length
    });

    it('should reject invalid container names', () => {
      expect(validateContainerName('ab')).toBe(false); // too short
      expect(validateContainerName('a'.repeat(64))).toBe(false); // too long
      expect(validateContainerName('Plot-1')).toBe(false); // uppercase
      expect(validateContainerName('-plot-1')).toBe(false); // starts with hyphen
      expect(validateContainerName('plot-1-')).toBe(false); // ends with hyphen
      expect(validateContainerName('plot--1')).toBe(false); // consecutive hyphens
      expect(validateContainerName('plot_1')).toBe(false); // underscore
      expect(validateContainerName('')).toBe(false); // empty
    });

    it('should reject non-string inputs', () => {
      expect(validateContainerName(null as any)).toBe(false);
      expect(validateContainerName(undefined as any)).toBe(false);
      expect(validateContainerName(123 as any)).toBe(false);
    });
  });

  describe('parseContainerName', () => {
    it('should parse valid ID-based container names', () => {
      expect(parseContainerName('plot1-census1')).toEqual({ plotID: 1, censusNumber: 1 });
      expect(parseContainerName('plot42-census3')).toEqual({ plotID: 42, censusNumber: 3 });
      expect(parseContainerName('plot999-census10')).toEqual({ plotID: 999, censusNumber: 10 });
    });

    it('should return null for invalid formats', () => {
      expect(parseContainerName('test-plot-1')).toBeNull();
      expect(parseContainerName('plot1-2')).toBeNull();
      expect(parseContainerName('plot-census1')).toBeNull();
      expect(parseContainerName('invalid')).toBeNull();
    });
  });

  describe('isIdBasedContainerName', () => {
    it('should identify ID-based container names', () => {
      expect(isIdBasedContainerName('plot1-census1')).toBe(true);
      expect(isIdBasedContainerName('plot42-census3')).toBe(true);
      expect(isIdBasedContainerName('plot999-census10')).toBe(true);
    });

    it('should reject legacy container names', () => {
      expect(isIdBasedContainerName('test-plot-1')).toBe(false);
      expect(isIdBasedContainerName('barro-colorado-island-2')).toBe(false);
      expect(isIdBasedContainerName('invalid')).toBe(false);
    });
  });

  describe('getContainerNameWithFallback', () => {
    it('should prefer ID-based naming when plotID is available', () => {
      const result = getContainerNameWithFallback(1, 'Test Plot', 1);
      expect(result.primary).toBe('plot1-census1');
      expect(result.legacy).toBe('test-plot-1');
      expect(result.usesLegacy).toBe(false);
    });

    it('should fall back to legacy when plotID is not available', () => {
      const result = getContainerNameWithFallback(undefined, 'Test Plot', 1);
      expect(result.primary).toBe('test-plot-1');
      expect(result.usesLegacy).toBe(true);
    });

    it('should not generate legacy fallback if plot name is not available', () => {
      const result = getContainerNameWithFallback(1, undefined, 1);
      expect(result.primary).toBe('plot1-census1');
      expect(result.legacy).toBeUndefined();
      expect(result.usesLegacy).toBe(false);
    });

    it('should throw error when neither plotID nor plotName is available', () => {
      expect(() => getContainerNameWithFallback(undefined, undefined, 1)).toThrow('Cannot generate container name');
    });

    it('should throw error when census number is invalid', () => {
      expect(() => getContainerNameWithFallback(1, undefined, undefined)).toThrow('Cannot generate container name');
      // When censusNumber is 0, the function catches the error and throws a more specific message
      expect(() => getContainerNameWithFallback(1, 'Test', 0)).toThrow('Cannot generate container name');
    });

    it('should handle edge cases gracefully', () => {
      // Empty plot name should fall back to ID-based
      const result1 = getContainerNameWithFallback(1, '', 1);
      expect(result1.primary).toBe('plot1-census1');
      expect(result1.legacy).toBeUndefined();

      // Whitespace-only plot name should fall back to ID-based
      const result2 = getContainerNameWithFallback(1, '   ', 1);
      expect(result2.primary).toBe('plot1-census1');
      expect(result2.legacy).toBeUndefined();
    });
  });

  describe('Azure Container Naming Compliance', () => {
    it('should generate names that meet all Azure requirements', () => {
      const testCases = [
        { plotID: 1, census: 1 },
        { plotID: 999, census: 99 },
        { plotID: 12345, census: 10 }
      ];

      testCases.forEach(({ plotID, census }) => {
        const name = getContainerName(plotID, census);

        // Length: 3-63 characters
        expect(name.length).toBeGreaterThanOrEqual(3);
        expect(name.length).toBeLessThanOrEqual(63);

        // Only lowercase, numbers, hyphens
        expect(name).toMatch(/^[a-z0-9-]+$/);

        // No consecutive hyphens
        expect(name).not.toMatch(/--/);

        // Start and end with letter or number
        expect(name).toMatch(/^[a-z0-9].*[a-z0-9]$/);
      });
    });
  });

  describe('Real-world Examples', () => {
    it('should handle typical plot names from production', () => {
      const examples = [
        { name: 'Barro Colorado Island', expected: 'barro-colorado-island-1' },
        { name: 'Luquillo', expected: 'luquillo-1' },
        { name: 'SERC Plot 1', expected: 'serc-plot-1-1' },
        { name: 'La Selva', expected: 'la-selva-1' }
      ];

      examples.forEach(({ name, expected }) => {
        const result = getLegacyContainerName(name, 1);
        expect(result).toBe(expected);
        expect(validateContainerName(result)).toBe(true);
      });
    });

    it('should handle ID-based names for all plots', () => {
      // Test a range of realistic plot IDs
      for (let plotID = 1; plotID <= 100; plotID++) {
        for (let census = 1; census <= 5; census++) {
          const name = getContainerName(plotID, census);
          expect(validateContainerName(name)).toBe(true);
          expect(isIdBasedContainerName(name)).toBe(true);

          const parsed = parseContainerName(name);
          expect(parsed).toEqual({ plotID, censusNumber: census });
        }
      }
    });
  });
});
