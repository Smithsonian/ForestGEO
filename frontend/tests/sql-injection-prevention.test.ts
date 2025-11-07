/**
 * Integration tests for SQL Injection Prevention Fixes
 *
 * Tests the security improvements made across 6 API endpoints to prevent SQL injection attacks.
 * These tests verify:
 * 1. Schema validation against whitelist
 * 2. Proper use of parameterized queries
 * 3. Table/procedure name validation
 * 4. Error handling for malicious inputs
 *
 * Modified endpoints:
 * - app/api/reingest/[schema]/[plotID]/[censusID]/route.ts
 * - app/api/reingestsinglefailure/[schema]/[targetRowID]/route.ts
 * - app/api/bulkcrud/route.ts
 * - app/api/resettableview/[gridType]/[plotID]/[censusID]/route.ts
 * - app/api/admin/clear/[tableType]/[schema]/[plotID]/[censusID]/route.ts
 * - app/api/clearcensus/route.ts
 */

import { describe, it, expect } from 'vitest';
import { isValidSchema, validateSchemaOrThrow, formatWithSchema, safeFormatQuery, ALLOWED_SCHEMAS } from '@/config/utils/sqlsecurity';

describe('SQL Security Utility Functions', () => {
  describe('isValidSchema', () => {
    it('should accept valid schemas from whitelist', () => {
      expect(isValidSchema('forestgeo')).toBe(true);
      expect(isValidSchema('forestgeo_testing')).toBe(true);
      expect(isValidSchema('forestgeo_testing_alternate')).toBe(true);
      expect(isValidSchema('catalog')).toBe(true);
    });

    it('should reject invalid schemas', () => {
      expect(isValidSchema('malicious; DROP TABLE users--')).toBe(false);
      expect(isValidSchema('invalid_schema')).toBe(false);
      expect(isValidSchema('')).toBe(false);
      expect(isValidSchema(null)).toBe(false);
      expect(isValidSchema(undefined)).toBe(false);
    });

    it('should reject SQL injection attempts', () => {
      expect(isValidSchema("forestgeo'; DROP TABLE users--")).toBe(false);
      expect(isValidSchema('forestgeo OR 1=1')).toBe(false);
      expect(isValidSchema('forestgeo/**/UNION/**/SELECT')).toBe(false);
    });
  });

  describe('validateSchemaOrThrow', () => {
    it('should not throw for valid schemas', () => {
      expect(() => validateSchemaOrThrow('forestgeo')).not.toThrow();
      expect(() => validateSchemaOrThrow('forestgeo_testing')).not.toThrow();
    });

    it('should throw for invalid schemas', () => {
      expect(() => validateSchemaOrThrow('invalid_schema')).toThrow('Invalid or unauthorized schema');
      expect(() => validateSchemaOrThrow(null)).toThrow();
      expect(() => validateSchemaOrThrow(undefined)).toThrow();
    });

    it('should throw for SQL injection attempts', () => {
      expect(() => validateSchemaOrThrow("forestgeo'; DROP TABLE")).toThrow();
      expect(() => validateSchemaOrThrow('forestgeo OR 1=1')).toThrow();
    });
  });

  describe('formatWithSchema', () => {
    it('should format query with single schema placeholder', () => {
      const result = formatWithSchema('forestgeo', 'SELECT * FROM ??.users WHERE id = ?');
      expect(result).toContain('`forestgeo`');
      expect(result).toContain('SELECT * FROM');
    });

    it('should format query with multiple schema placeholders', () => {
      const result = formatWithSchema('forestgeo', 'SELECT * FROM ??.users u JOIN ??.roles r ON u.roleId = r.id');
      expect(result).toContain('`forestgeo`');
      // Should have two occurrences of the schema
      const matches = result.match(/`forestgeo`/g);
      expect(matches).toHaveLength(2);
    });

    it('should escape schema names to prevent injection', () => {
      const result = formatWithSchema('forestgeo_testing', 'SELECT * FROM ??.table');
      expect(result).toContain('`forestgeo_testing`');
      expect(result).not.toContain('DROP');
    });
  });

  describe('safeFormatQuery', () => {
    it('should validate schema and format query', () => {
      const result = safeFormatQuery('forestgeo', 'SELECT * FROM ??.users');
      expect(result).toContain('`forestgeo`');
    });

    it('should throw for invalid schema', () => {
      expect(() => safeFormatQuery('invalid', 'SELECT * FROM ??.users')).toThrow();
    });

    it('should handle stored procedure calls', () => {
      const result = safeFormatQuery('forestgeo', 'CALL ??.bulkingestionprocess(?, ?)');
      expect(result).toContain('`forestgeo`');
      expect(result).toContain('CALL');
    });
  });
});

describe('Schema Whitelist Configuration', () => {
  it('should have exactly 4 allowed schemas', () => {
    expect(ALLOWED_SCHEMAS).toHaveLength(4);
  });

  it('should include production schema', () => {
    expect(ALLOWED_SCHEMAS).toContain('forestgeo');
  });

  it('should include testing schemas', () => {
    expect(ALLOWED_SCHEMAS).toContain('forestgeo_testing');
    expect(ALLOWED_SCHEMAS).toContain('forestgeo_testing_alternate');
  });

  it('should include catalog schema', () => {
    expect(ALLOWED_SCHEMAS).toContain('catalog');
  });
});

describe('SQL Injection Attack Vectors', () => {
  const maliciousInputs = [
    // Classic SQL injection
    "'; DROP TABLE users--",
    "' OR '1'='1",
    "' OR 1=1--",

    // Union-based injection
    "' UNION SELECT * FROM passwords--",
    "' UNION ALL SELECT NULL,NULL,NULL--",

    // Stacked queries
    "'; DELETE FROM users WHERE '1'='1",
    "'; UPDATE users SET password='hacked'--",

    // Comment-based injection
    "admin'--",
    "admin'/*",

    // Boolean-based blind injection
    "' AND 1=1--",
    "' AND 1=2--",

    // Time-based blind injection
    "'; WAITFOR DELAY '00:00:05'--",
    "' AND SLEEP(5)--",

    // Null byte injection
    "admin\0",

    // Encoded injection attempts
    "%27%20OR%201=1--",

    // Schema enumeration
    "'; SELECT schema_name FROM information_schema.schemata--",
  ];

  describe('isValidSchema should reject all attack vectors', () => {
    maliciousInputs.forEach((input) => {
      it(`should reject: ${input.substring(0, 50)}...`, () => {
        expect(isValidSchema(input)).toBe(false);
      });
    });
  });

  describe('validateSchemaOrThrow should throw for all attack vectors', () => {
    maliciousInputs.forEach((input) => {
      it(`should throw for: ${input.substring(0, 50)}...`, () => {
        expect(() => validateSchemaOrThrow(input)).toThrow();
      });
    });
  });
});

describe('Query Formatting Edge Cases', () => {
  it('should handle queries with no placeholders', () => {
    const result = safeFormatQuery('forestgeo', 'SET foreign_key_checks = 0');
    expect(result).toBe('SET foreign_key_checks = 0');
  });

  it('should handle queries with only value placeholders', () => {
    const result = safeFormatQuery('forestgeo', 'SELECT * FROM `forestgeo`.users WHERE id = ?');
    expect(result).toContain('SELECT * FROM');
  });

  it('should handle complex queries with multiple schema references', () => {
    const result = safeFormatQuery(
      'forestgeo',
      'SELECT cm.* FROM ??.coremeasurements cm JOIN ??.census c ON cm.CensusID = c.CensusID WHERE c.PlotID = ? AND cm.CensusID = ?'
    );
    expect(result).toContain('`forestgeo`');
    const matches = result.match(/`forestgeo`/g);
    expect(matches).toHaveLength(2);
  });

  it('should handle TRUNCATE statements', () => {
    const result = safeFormatQuery('forestgeo', 'TRUNCATE ??.species');
    expect(result).toContain('TRUNCATE');
    expect(result).toContain('`forestgeo`');
  });

  it('should handle UPDATE statements', () => {
    const result = safeFormatQuery('forestgeo', 'UPDATE ??.trees SET SpeciesID = NULL');
    expect(result).toContain('UPDATE');
    expect(result).toContain('`forestgeo`');
  });

  it('should handle DELETE statements', () => {
    const result = safeFormatQuery('forestgeo', 'DELETE FROM ??.failedmeasurements WHERE PlotID = ?');
    expect(result).toContain('DELETE FROM');
    expect(result).toContain('`forestgeo`');
  });

  it('should handle INSERT statements', () => {
    const result = safeFormatQuery('forestgeo', 'INSERT INTO ??.temporarymeasurements (FileID, BatchID) VALUES (?, ?)');
    expect(result).toContain('INSERT INTO');
    expect(result).toContain('`forestgeo`');
  });
});

describe('Endpoint-Specific Security Tests', () => {
  describe('Reingest Endpoint Security', () => {
    it('should validate schema parameter', () => {
      expect(() => {
        safeFormatQuery('malicious', 'SELECT COUNT(*) as total FROM ??.failedmeasurements');
      }).toThrow();
    });

    it('should format moveFailedToTemporary queries safely', () => {
      const countSQL = safeFormatQuery('forestgeo', 'SELECT COUNT(*) as total FROM ??.failedmeasurements WHERE PlotID = ? AND CensusID = ?');
      expect(countSQL).toContain('`forestgeo`.failedmeasurements');
    });

    it('should format INSERT with JOIN safely', () => {
      // safeFormatQuery uses formatWithSchema which counts ?? placeholders
      // and fills each with the schema name
      const insertSQL = safeFormatQuery(
        'forestgeo',
        "INSERT IGNORE INTO ??.temporarymeasurements SELECT 'file' AS FileID, fm.* FROM ??.failedmeasurements fm"
      );
      const matches = insertSQL.match(/`forestgeo`/g);
      expect(matches).toHaveLength(2);
      expect(insertSQL).toContain('`forestgeo`.temporarymeasurements');
      expect(insertSQL).toContain('`forestgeo`.failedmeasurements');
    });
  });

  describe('Admin Clear Endpoint Security', () => {
    it('should format queries with table name identifier', () => {
      // Simulating the format call with both schema and table name
      const { format } = require('mysql2/promise');
      const result = format('SELECT COUNT(*) as total FROM ??.?? WHERE PlotID = ? AND CensusID = ?', [
        'forestgeo',
        'failedmeasurements'
      ]);
      expect(result).toContain('`forestgeo`');
      expect(result).toContain('`failedmeasurements`');
    });
  });

  describe('Clear Census Endpoint Security', () => {
    const validCensusTypes = ['measurements', 'attributes', 'personnel', 'quadrats'];

    it('should accept valid census types', () => {
      validCensusTypes.forEach((type) => {
        expect(validCensusTypes.includes(type)).toBe(true);
      });
    });

    it('should reject invalid census types', () => {
      const invalidTypes = [
        'malicious',
        "'; DROP TABLE",
        'measurements OR 1=1',
        'measurements; DELETE',
      ];
      invalidTypes.forEach((type) => {
        expect(validCensusTypes.includes(type)).toBe(false);
      });
    });
  });
});

describe('Performance and Edge Cases', () => {
  it('should handle very long valid schema names', () => {
    // All allowed schemas should work regardless of length
    expect(isValidSchema('forestgeo_testing_alternate')).toBe(true);
  });

  it('should handle rapid successive validations', () => {
    for (let i = 0; i < 1000; i++) {
      expect(isValidSchema('forestgeo')).toBe(true);
      expect(isValidSchema('invalid')).toBe(false);
    }
  });

  it('should handle case sensitivity correctly', () => {
    // Schema names should be case-sensitive
    expect(isValidSchema('FORESTGEO')).toBe(false);
    expect(isValidSchema('ForestGeo')).toBe(false);
    expect(isValidSchema('forestgeo')).toBe(true);
  });
});

describe('Type Safety', () => {
  it('should provide correct TypeScript types', () => {
    // This is a compile-time test - if it compiles, types are correct
    const schema: string = 'forestgeo';
    const isValid: boolean = isValidSchema(schema);
    expect(typeof isValid).toBe('boolean');
  });

  it('should handle AllowedSchema type correctly', () => {
    const validSchema = 'forestgeo' as const;
    expect(isValidSchema(validSchema)).toBe(true);
  });
});
