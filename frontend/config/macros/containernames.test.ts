import { describe, it, expect } from 'vitest';
import {
  getContainerName,
  SchemaContainerNameError,
  getLegacyIdBasedContainerName,
  getLegacyPlotNameContainerName,
  validateContainerName,
  parseContainerName,
  parseLegacyIdBasedContainerName,
  isSchemaScopedContainerName,
  isLegacyIdBasedContainerName
} from './containernames';
import { KNOWN_SCHEMAS } from '@/lib/db/sqlsecurity';

describe('Container Naming Utilities', () => {
  describe('getContainerName (schema-scoped, F19)', () => {
    it('scopes container names by schema (F19)', () => {
      expect(getContainerName('forestgeo_testing', 1, 1)).toBe('forestgeo-testing-plot1-census1');
    });

    it('generates distinct names for different schemas sharing plot/census IDs', () => {
      expect(getContainerName('forestgeo_alpha', 1, 1)).toBe('forestgeo-alpha-plot1-census1');
      expect(getContainerName('forestgeo_beta', 1, 1)).toBe('forestgeo-beta-plot1-census1');
      expect(getContainerName('forestgeo_alpha', 1, 1)).not.toBe(getContainerName('forestgeo_beta', 1, 1));
    });

    it('maps underscores to hyphens injectively', () => {
      expect(getContainerName('forestgeo_testing_mason', 42, 3)).toBe('forestgeo-testing-mason-plot42-census3');
    });

    it('rejects consecutive underscores instead of collapsing them into a colliding prefix', () => {
      // forestgeo__x would otherwise collapse to the same prefix as forestgeo_x
      expect(() => getContainerName('forestgeo__x', 1, 1)).toThrow(SchemaContainerNameError);
      expect(() => getContainerName('forestgeo__x', 1, 1)).toThrow('collision-free');
      // ...while the well-formed sibling still maps cleanly.
      expect(getContainerName('forestgeo_x', 1, 1)).toBe('forestgeo-x-plot1-census1');
    });

    it('rejects leading/trailing underscores instead of trimming them into a colliding prefix', () => {
      // forestgeo_x_ would otherwise trim to the same prefix as forestgeo_x
      expect(() => getContainerName('forestgeo_x_', 1, 1)).toThrow(SchemaContainerNameError);
      expect(() => getContainerName('_forestgeo_x', 1, 1)).toThrow(SchemaContainerNameError);
    });

    it('rejects uppercase and non-alphanumeric characters instead of lossy sanitization', () => {
      expect(() => getContainerName('ForestGEO_Testing', 1, 1)).toThrow(SchemaContainerNameError);
      expect(() => getContainerName('site.name@2024', 5, 2)).toThrow(SchemaContainerNameError);
      expect(() => getContainerName('site-name', 1, 1)).toThrow(SchemaContainerNameError); // hyphen would collide with an underscore sibling
      expect(() => getContainerName('___', 1, 1)).toThrow(SchemaContainerNameError);
    });

    it('rejects schemas whose combined name exceeds 63 chars instead of truncating (F19)', () => {
      const sixtyCharSchema = 'a'.repeat(60);
      expect(() => getContainerName(sixtyCharSchema, 1, 1)).toThrow(SchemaContainerNameError);
      expect(() => getContainerName(sixtyCharSchema, 1, 1)).toThrow('refusing to truncate');
    });

    it('accepts a schema that lands exactly on the 63-char Azure limit', () => {
      const suffix = '-plot1-census1';
      const schema = 'a'.repeat(63 - suffix.length); // 49 chars
      const name = getContainerName(schema, 1, 1);
      expect(name.length).toBe(63);
      expect(validateContainerName(name)).toBe(true);
      // One char longer tips over the limit and is rejected.
      expect(() => getContainerName('a'.repeat(63 - suffix.length + 1), 1, 1)).toThrow(SchemaContainerNameError);
    });

    it('rejects empty or whitespace-only schemas like every other shape failure', () => {
      expect(() => getContainerName('', 1, 1)).toThrow(SchemaContainerNameError);
      expect(() => getContainerName('   ', 1, 1)).toThrow(SchemaContainerNameError);
    });

    it('accepts every KNOWN_SCHEMAS entry (drift guard against VALID_SCHEMA_PATTERN)', () => {
      // INJECTIVE_SCHEMA_PATTERN is strictly narrower than sqlsecurity's
      // VALID_SCHEMA_PATTERN; this pins that no schema we actually ship
      // falls into the gap where SQL access works but file operations 400.
      for (const schema of KNOWN_SCHEMAS) {
        const name = getContainerName(schema, 1, 1);
        expect(validateContainerName(name), `KNOWN_SCHEMAS entry "${schema}" must map to a valid container name`).toBe(true);
      }
    });

    it('throws for invalid plotID', () => {
      expect(() => getContainerName('forestgeo_testing', 0, 1)).toThrow('Invalid plotID');
      expect(() => getContainerName('forestgeo_testing', -1, 1)).toThrow('Invalid plotID');
      expect(() => getContainerName('forestgeo_testing', NaN, 1)).toThrow('Invalid plotID');
    });

    it('throws for invalid censusNumber', () => {
      expect(() => getContainerName('forestgeo_testing', 1, 0)).toThrow('Invalid censusNumber');
      expect(() => getContainerName('forestgeo_testing', 1, -1)).toThrow('Invalid censusNumber');
      expect(() => getContainerName('forestgeo_testing', 1, NaN)).toThrow('Invalid censusNumber');
    });
  });

  describe('getLegacyIdBasedContainerName (migration-only)', () => {
    it('reproduces the pre-F19 shared ID-based names', () => {
      expect(getLegacyIdBasedContainerName(1, 1)).toBe('plot1-census1');
      expect(getLegacyIdBasedContainerName(42, 3)).toBe('plot42-census3');
    });

    it('throws for invalid inputs', () => {
      expect(() => getLegacyIdBasedContainerName(0, 1)).toThrow('Invalid plotID');
      expect(() => getLegacyIdBasedContainerName(1, 0)).toThrow('Invalid censusNumber');
    });
  });

  describe('getLegacyPlotNameContainerName (migration-only)', () => {
    it('generates sanitized legacy plot-name container names', () => {
      expect(getLegacyPlotNameContainerName('Test Plot', 1)).toBe('test-plot-1');
      expect(getLegacyPlotNameContainerName('Barro Colorado Island', 2)).toBe('barro-colorado-island-2');
      expect(getLegacyPlotNameContainerName('Plot #5A', 1)).toBe('plot-5a-1');
    });

    it('handles names with special characters and consecutive hyphens', () => {
      expect(getLegacyPlotNameContainerName('Plot-A/B', 1)).toBe('plot-a-b-1');
      expect(getLegacyPlotNameContainerName('Site_Name', 1)).toBe('site-name-1');
      expect(getLegacyPlotNameContainerName('Plot---Name', 1)).toBe('plot-name-1');
    });

    it('throws for empty plot name or invalid census', () => {
      expect(() => getLegacyPlotNameContainerName('', 1)).toThrow('Invalid plotName');
      expect(() => getLegacyPlotNameContainerName('   ', 1)).toThrow('Invalid plotName');
      expect(() => getLegacyPlotNameContainerName('Plot', 0)).toThrow('Invalid censusNumber');
    });
  });

  describe('validateContainerName', () => {
    it('validates correct container names', () => {
      expect(validateContainerName('forestgeo-testing-plot1-census1')).toBe(true);
      expect(validateContainerName('plot1-census1')).toBe(true);
      expect(validateContainerName('abc')).toBe(true); // minimum length
      expect(validateContainerName('a'.repeat(63))).toBe(true); // maximum length
    });

    it('rejects invalid container names', () => {
      expect(validateContainerName('ab')).toBe(false); // too short
      expect(validateContainerName('a'.repeat(64))).toBe(false); // too long
      expect(validateContainerName('Plot-1')).toBe(false); // uppercase
      expect(validateContainerName('-plot-1')).toBe(false); // starts with hyphen
      expect(validateContainerName('plot-1-')).toBe(false); // ends with hyphen
      expect(validateContainerName('plot--1')).toBe(false); // consecutive hyphens
      expect(validateContainerName('plot_1')).toBe(false); // underscore
      expect(validateContainerName('')).toBe(false); // empty
    });

    it('rejects non-string inputs', () => {
      expect(validateContainerName(null as any)).toBe(false);
      expect(validateContainerName(undefined as any)).toBe(false);
      expect(validateContainerName(123 as any)).toBe(false);
    });
  });

  describe('parseContainerName (schema-scoped)', () => {
    it('round-trips schema-scoped names produced by getContainerName', () => {
      const name = getContainerName('forestgeo_testing', 42, 3);
      const parsed = parseContainerName(name);
      expect(parsed).toEqual({ schemaPrefix: 'forestgeo-testing', plotID: 42, censusNumber: 3 });
      // The sanitized prefix reverses bijectively to the MySQL schema name.
      expect(parsed?.schemaPrefix.replace(/-/g, '_')).toBe('forestgeo_testing');
    });

    it('parses schema-scoped container names', () => {
      expect(parseContainerName('luquillo-plot1-census5')).toEqual({ schemaPrefix: 'luquillo', plotID: 1, censusNumber: 5 });
    });

    it('returns null for legacy or malformed names', () => {
      expect(parseContainerName('plot1-census1')).toBeNull(); // legacy ID-based, no schema
      expect(parseContainerName('test-plot-1')).toBeNull();
      expect(parseContainerName('invalid')).toBeNull();
    });
  });

  describe('parseLegacyIdBasedContainerName (migration-only)', () => {
    it('parses pre-F19 shared ID-based names', () => {
      expect(parseLegacyIdBasedContainerName('plot1-census1')).toEqual({ plotID: 1, censusNumber: 1 });
      expect(parseLegacyIdBasedContainerName('plot42-census3')).toEqual({ plotID: 42, censusNumber: 3 });
    });

    it('returns null for schema-scoped or malformed names', () => {
      expect(parseLegacyIdBasedContainerName('luquillo-plot1-census5')).toBeNull();
      expect(parseLegacyIdBasedContainerName('invalid')).toBeNull();
    });
  });

  describe('name-kind discriminators', () => {
    it('identifies schema-scoped names', () => {
      expect(isSchemaScopedContainerName('forestgeo-testing-plot1-census1')).toBe(true);
      expect(isSchemaScopedContainerName('luquillo-plot42-census3')).toBe(true);
      expect(isSchemaScopedContainerName('plot1-census1')).toBe(false); // legacy ID-based
      expect(isSchemaScopedContainerName('invalid')).toBe(false);
    });

    it('identifies legacy ID-based names', () => {
      expect(isLegacyIdBasedContainerName('plot1-census1')).toBe(true);
      expect(isLegacyIdBasedContainerName('plot42-census3')).toBe(true);
      expect(isLegacyIdBasedContainerName('forestgeo-testing-plot1-census1')).toBe(false);
      expect(isLegacyIdBasedContainerName('test-plot-1')).toBe(false);
    });
  });

  describe('Azure Container Naming Compliance', () => {
    it('generates schema-scoped names that meet all Azure requirements', () => {
      const testCases = [
        { schema: 'forestgeo_testing', plotID: 1, census: 1 },
        { schema: 'forestgeo_cocoli_2024', plotID: 999, census: 99 },
        { schema: 'a'.repeat(40), plotID: 12345, census: 10 }
      ];

      testCases.forEach(({ schema, plotID, census }) => {
        const name = getContainerName(schema, plotID, census);

        expect(name.length).toBeGreaterThanOrEqual(3);
        expect(name.length).toBeLessThanOrEqual(63);
        expect(name).toMatch(/^[a-z0-9-]+$/);
        expect(name).not.toMatch(/--/);
        expect(name).toMatch(/^[a-z0-9].*[a-z0-9]$/);
        expect(validateContainerName(name)).toBe(true);
      });
    });
  });
});
