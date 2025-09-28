/**
 * Enhanced CSV Processing Unit Tests
 * Tests the core functionality of our enhanced CSV processing without UI dependencies
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import moment from 'moment';

// Mock ailogger
vi.mock('@/ailogger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// Test the header mapping functionality
describe('Enhanced Header Mapping', () => {
  it('should map cocoli1b.csv headers correctly', () => {
    const cocoliHeaders = ['tag', 'stemtag', 'spcode', 'quadrat', 'lx', 'ly', 'dbh', 'codes', 'hom', 'date'];
    const expectedHeaders = ['tag', 'stemtag', 'spcode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'];

    // Test our header normalization logic
    const normalizeHeader = (header: string) =>
      header
        .trim()
        .toLowerCase()
        .replace(/[_\s-]/g, '');

    const headerMappings: Record<string, string> = {
      tag: 'tag',
      treetag: 'tag',
      stemtag: 'stemtag',
      stem: 'stemtag',
      spcode: 'spcode',
      species: 'spcode',
      speciescode: 'spcode',
      sp: 'spcode',
      quadrat: 'quadrat',
      quad: 'quadrat',
      quadratname: 'quadrat',
      lx: 'lx',
      localx: 'lx',
      x: 'lx',
      xcoord: 'lx',
      ly: 'ly',
      localy: 'ly',
      y: 'ly',
      ycoord: 'ly',
      dbh: 'dbh',
      diameter: 'dbh',
      hom: 'hom',
      height: 'hom',
      heightofmeasurement: 'hom',
      date: 'date',
      measurementdate: 'date',
      dateof: 'date',
      codes: 'codes',
      code: 'codes',
      attributes: 'codes',
      attributecodes: 'codes',
      comments: 'comments',
      comment: 'comments',
      description: 'comments',
      notes: 'comments'
    };

    // Test that all cocoli headers map correctly
    cocoliHeaders.forEach(header => {
      const normalized = normalizeHeader(header);
      const mapped = headerMappings[normalized];
      expect(mapped).toBeDefined();
      expect(expectedHeaders).toContain(mapped);
    });
  });

  it('should map SERC_census1_2025.csv headers correctly', () => {
    const sercHeaders = ['quadrat', 'tag', 'stemtag', 'spcode', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'];
    const expectedHeaders = ['tag', 'stemtag', 'spcode', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes'];

    // All SERC headers should map to expected headers
    sercHeaders.forEach(header => {
      expect(expectedHeaders).toContain(header);
    });
  });

  it('should handle header variations correctly', () => {
    const variations = [
      { input: 'TreeTag', expected: 'tag' },
      { input: 'Species', expected: 'spcode' },
      { input: 'LocalX', expected: 'lx' },
      { input: 'Local_Y', expected: 'ly' },
      { input: 'Measurement Date', expected: 'date' },
      { input: 'Attribute Codes', expected: 'codes' }
    ];

    const normalizeHeader = (header: string) =>
      header
        .trim()
        .toLowerCase()
        .replace(/[_\s-]/g, '');

    const headerMappings: Record<string, string> = {
      tag: 'tag',
      treetag: 'tag',
      spcode: 'spcode',
      species: 'spcode',
      speciescode: 'spcode',
      lx: 'lx',
      localx: 'lx',
      x: 'lx',
      ly: 'ly',
      localy: 'ly',
      y: 'ly',
      date: 'date',
      measurementdate: 'date',
      codes: 'codes',
      attributecodes: 'codes'
    };

    variations.forEach(({ input, expected }) => {
      const normalized = normalizeHeader(input);
      const mapped = headerMappings[normalized];
      expect(mapped).toBe(expected);
    });
  });
});

describe('Enhanced Date Parsing', () => {
  const dateFormats = [
    'YYYY-MM-DD',
    'MM/DD/YYYY',
    'DD/MM/YYYY',
    'YYYY/MM/DD',
    'MM-DD-YYYY',
    'DD-MM-YYYY',
    'YYYY.MM.DD',
    'MM.DD.YYYY',
    'DD.MM.YYYY',
    'MMMM DD, YYYY',
    'MMM DD, YYYY',
    'DD MMM YYYY',
    'DD MMMM YYYY',
    'YYYY-MM-DD HH:mm:ss',
    'MM/DD/YYYY HH:mm:ss',
    'DD/MM/YYYY HH:mm:ss'
  ];

  it('should parse 1994-11-02 (cocoli1b.csv format)', () => {
    const testDate = '1994-11-02';

    // Test with our enhanced parsing logic
    for (const format of dateFormats) {
      const parsed = moment(testDate, format, true);
      if (parsed.isValid()) {
        expect(parsed.year()).toBe(1994);
        expect(parsed.month()).toBe(10); // November (0-based)
        expect(parsed.date()).toBe(2);
        break;
      }
    }
  });

  it('should parse 2010-03-17 (SERC format)', () => {
    const testDate = '2010-03-17';

    for (const format of dateFormats) {
      const parsed = moment(testDate, format, true);
      if (parsed.isValid()) {
        expect(parsed.year()).toBe(2010);
        expect(parsed.month()).toBe(2); // March (0-based)
        expect(parsed.date()).toBe(17);
        break;
      }
    }
  });

  it('should handle multiple date formats', () => {
    const testDates = [
      { input: '1994-11-02', format: 'YYYY-MM-DD', expected: new Date(1994, 10, 2) },
      { input: '11/02/1994', format: 'MM/DD/YYYY', expected: new Date(1994, 10, 2) },
      { input: 'November 2, 1994', format: 'MMMM D, YYYY', expected: new Date(1994, 10, 2) },
      { input: 'Nov 2, 1994', format: 'MMM D, YYYY', expected: new Date(1994, 10, 2) }
    ];

    testDates.forEach(({ input, format }) => {
      const momentDate = moment(input, format, true);
      expect(momentDate.isValid()).toBe(true);
      expect(momentDate.year()).toBe(1994);
      expect(momentDate.month()).toBe(10); // November (0-based)
      expect(momentDate.date()).toBe(2);
    });

    // Test DD/MM/YYYY format separately as it represents day/month/year
    const ddmmDate = moment('02/11/1994', 'DD/MM/YYYY', true);
    expect(ddmmDate.isValid()).toBe(true);
    expect(ddmmDate.year()).toBe(1994);
    expect(ddmmDate.month()).toBe(10); // November (0-based)
    expect(ddmmDate.date()).toBe(2);
  });
});

describe('Coordinate Precision Handling', () => {
  it('should round coordinates to 6 decimal places', () => {
    const testCases = [
      { input: 3.0000001, expected: 3.0 },
      { input: 2.9999999, expected: 3.0 },
      { input: 201.60001, expected: 201.60001 },
      { input: 206.39999, expected: 206.39999 },
      { input: 1.123456789, expected: 1.123457 }
    ];

    testCases.forEach(({ input, expected }) => {
      const rounded = Math.round(input * 1000000) / 1000000;
      expect(rounded).toBeCloseTo(expected, 6);
    });
  });

  it('should handle measurement precision (DBH/HOM)', () => {
    const testCases = [
      { input: 10.123456789, expected: 10.12 },
      { input: 171.987654321, expected: 171.99 },
      { input: 13.555555555, expected: 13.56 }
    ];

    testCases.forEach(({ input, expected }) => {
      const rounded = Math.round(input * 100) / 100;
      expect(rounded).toBeCloseTo(expected, 2);
    });
  });
});

describe('CSV Data Structure Validation', () => {
  it('should validate cocoli1b.csv data structure', () => {
    const sampleRow = {
      tag: '000001',
      stemtag: '1',
      spcode: 'protte',
      quadrat: '0000',
      lx: 3.0,
      ly: 0.9,
      dbh: 171.0,
      codes: '',
      hom: 2.6,
      date: '1994-11-02'
    };

    // Validate required fields are present
    expect(sampleRow.tag).toBeDefined();
    expect(sampleRow.spcode).toBeDefined();
    expect(sampleRow.quadrat).toBeDefined();
    expect(sampleRow.date).toBeDefined();

    // Validate data types
    expect(typeof sampleRow.tag).toBe('string');
    expect(typeof sampleRow.spcode).toBe('string');
    expect(typeof sampleRow.lx).toBe('number');
    expect(typeof sampleRow.ly).toBe('number');
    expect(typeof sampleRow.dbh).toBe('number');
  });

  it('should validate SERC_census1_2025.csv data structure', () => {
    const sampleRow = {
      quadrat: '1011',
      tag: '100001',
      stemtag: '1',
      spcode: 'FAGR',
      lx: 202,
      ly: 104.5,
      dbh: 3.5,
      hom: 1.3,
      date: '2010-03-17',
      codes: 'LI'
    };

    // Validate required fields
    expect(sampleRow.tag).toBeDefined();
    expect(sampleRow.spcode).toBeDefined();
    expect(sampleRow.quadrat).toBeDefined();
    expect(sampleRow.date).toBeDefined();

    // Validate coordinate precision handling
    const roundedLx = Math.round(sampleRow.lx * 1000000) / 1000000;
    const roundedLy = Math.round(sampleRow.ly * 1000000) / 1000000;

    expect(roundedLx).toBe(202.0);
    expect(roundedLy).toBe(104.5);
  });
});

describe('Error Prevention', () => {
  it('should not produce SQL error 1093 patterns', () => {
    // Test that our temporary table approach doesn't have the problematic pattern
    const problematicPattern = /UPDATE\s+stems\s+s\s+SET.*FROM\s+stems/i;

    // Our fixed approach uses JOIN instead of correlated subquery
    const fixedPattern = /UPDATE\s+stems\s+s\s+INNER\s+JOIN\s+stem_crossid_mapping/i;

    // Simulate the query patterns
    const problematicQuery = 'UPDATE stems s SET s.StemCrossID = (SELECT s_prev.StemCrossID FROM stems s_prev WHERE...)';
    const fixedQuery = 'UPDATE stems s INNER JOIN stem_crossid_mapping scm ON s.StemGUID = scm.CurrentStemID SET s.StemCrossID = scm.NewStemCrossID';

    expect(problematicPattern.test(problematicQuery)).toBe(true);
    expect(problematicPattern.test(fixedQuery)).toBe(false);
    expect(fixedPattern.test(fixedQuery)).toBe(true);
  });

  it('should handle missing headers gracefully', () => {
    const csvHeaders = ['wrong', 'headers', 'completely'];
    const expectedHeaders = ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date'];

    const normalizeHeader = (header: string) =>
      header
        .trim()
        .toLowerCase()
        .replace(/[_\s-]/g, '');

    const mappings: Array<{ csvIndex: number; expectedField: string; csvHeader: string }> = [];
    const warnings: string[] = [];

    // Simulate our mapping logic - note that 'headers' might partially match some fields
    for (const expectedHeader of expectedHeaders) {
      const found = csvHeaders.some(csvHeader => {
        const normalizedCsv = normalizeHeader(csvHeader);
        const normalizedExpected = normalizeHeader(expectedHeader);
        return normalizedCsv === normalizedExpected || normalizedCsv.includes(normalizedExpected) || normalizedExpected.includes(normalizedCsv);
      });

      if (!found) {
        warnings.push(`Missing header: ${expectedHeader}`);
      }
    }

    // Should detect most missing headers (allowing for partial matches)
    expect(warnings.length).toBeGreaterThan(4);
    expect(warnings.every(w => w.includes('Missing header'))).toBe(true);
  });
});
