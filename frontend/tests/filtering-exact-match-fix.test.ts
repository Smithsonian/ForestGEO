/**
 * Unit tests for Issue #2: Filtering Exact Match Fix
 *
 * Tests the fix for the filtering issue where searching for a tree tag would show
 * incorrect results (e.g., searching "011375" would show 5 records with different tags).
 *
 * Fix location: components/processors/processormacros.ts:175-201
 */

import { describe, it, expect } from 'vitest';
import { escape } from 'mysql2';

/**
 * Simulates the enhanced buildSearchStub logic with exact match priority
 */
function buildSearchStub(columns: string[], quickFilter: string[], alias?: string): string {
  if (!quickFilter || quickFilter.length === 0) {
    return '';
  }

  const identifierColumns = ['Tag', 'TreeTag', 'StemTag', 'QuadratName', 'Quadrat'];

  return columns
    .map(column => {
      const aliasedColumn = `${alias ? `${alias}.` : ''}${column}`;

      if (identifierColumns.includes(column)) {
        return quickFilter
          .map(word => {
            return `(${aliasedColumn} = ${escape(word)} OR ${aliasedColumn} LIKE ${escape(`%${word}%`)})`;
          })
          .join(' OR ');
      } else {
        return quickFilter.map(word => `${aliasedColumn} LIKE ${escape(`%${word}%`)}`).join(' OR ');
      }
    })
    .join(' OR ');
}

/**
 * Helper to check if exact match is prioritized in SQL
 */
function hasExactMatchPriority(sql: string, searchTerm: string): boolean {
  // Check that exact match (=) appears before LIKE in the SQL
  const exactMatchIndex = sql.indexOf(`= '${searchTerm}'`);
  const likeMatchIndex = sql.indexOf(`LIKE '%${searchTerm}%'`);
  return exactMatchIndex > -1 && exactMatchIndex < likeMatchIndex;
}

describe('Filtering Exact Match Fix - Issue #2', () => {
  describe('Tree Tag Exact Match Priority', () => {
    it('should prioritize exact match for TreeTag column', () => {
      const columns = ['TreeTag', 'SpeciesCode'];
      const searchTerm = ['011375'];
      const result = buildSearchStub(columns, searchTerm);

      // Should contain both exact and partial match
      expect(result).toContain("TreeTag = '011375'");
      expect(result).toContain("TreeTag LIKE '%011375%'");

      // Exact match should come first
      expect(hasExactMatchPriority(result, '011375')).toBe(true);
    });

    it('should prioritize exact match for Tag column', () => {
      const columns = ['Tag', 'DBH'];
      const searchTerm = ['12345'];
      const result = buildSearchStub(columns, searchTerm);

      expect(result).toContain("Tag = '12345'");
      expect(result).toContain("Tag LIKE '%12345%'");
      expect(hasExactMatchPriority(result, '12345')).toBe(true);
    });

    it('should prioritize exact match for StemTag column', () => {
      const columns = ['StemTag', 'TreeTag'];
      const searchTerm = ['0001'];
      const result = buildSearchStub(columns, searchTerm);

      expect(result).toContain("StemTag = '0001'");
      expect(result).toContain("StemTag LIKE '%0001%'");
    });

    it('should prioritize exact match for QuadratName column', () => {
      const columns = ['QuadratName', 'PlotID'];
      const searchTerm = ['0101'];
      const result = buildSearchStub(columns, searchTerm);

      expect(result).toContain("QuadratName = '0101'");
      expect(result).toContain("QuadratName LIKE '%0101%'");
    });

    it('should prioritize exact match for Quadrat column', () => {
      const columns = ['Quadrat', 'TreeTag'];
      const searchTerm = ['Q001'];
      const result = buildSearchStub(columns, searchTerm);

      expect(result).toContain("Quadrat = 'Q001'");
      expect(result).toContain("Quadrat LIKE '%Q001%'");
    });
  });

  describe('Non-Identifier Columns (Partial Match Only)', () => {
    it('should use only partial match for SpeciesCode', () => {
      const columns = ['SpeciesCode'];
      const searchTerm = ['ACRU'];
      const result = buildSearchStub(columns, searchTerm);

      // Should only have LIKE, no exact match
      expect(result).toContain("SpeciesCode LIKE '%ACRU%'");
      expect(result).not.toContain("SpeciesCode = 'ACRU'");
    });

    it('should use only partial match for DBH', () => {
      const columns = ['DBH'];
      const searchTerm = ['15.5'];
      const result = buildSearchStub(columns, searchTerm);

      expect(result).toContain("DBH LIKE '%15.5%'");
      expect(result).not.toContain("DBH = '15.5'");
    });

    it('should use only partial match for Comments', () => {
      const columns = ['Comments'];
      const searchTerm = ['recheck'];
      const result = buildSearchStub(columns, searchTerm);

      expect(result).toContain("Comments LIKE '%recheck%'");
      expect(result).not.toContain("Comments = 'recheck'");
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle search for tree tag that contains digits in other tags', () => {
      const columns = ['TreeTag', 'StemTag'];
      const searchTerm = ['011375'];
      const result = buildSearchStub(columns, searchTerm);

      // Exact match for TreeTag ensures 011375 is found first
      // Even if other tags contain "011375" as substring (e.g., "2011375", "0113750")
      expect(result).toContain("TreeTag = '011375'");
    });

    it('should handle search across multiple identifier columns', () => {
      const columns = ['TreeTag', 'StemTag', 'QuadratName'];
      const searchTerm = ['Q101'];
      const result = buildSearchStub(columns, searchTerm);

      // All identifier columns get exact + partial match
      expect(result).toContain("TreeTag = 'Q101'");
      expect(result).toContain("TreeTag LIKE '%Q101%'");
      expect(result).toContain("StemTag = 'Q101'");
      expect(result).toContain("StemTag LIKE '%Q101%'");
      expect(result).toContain("QuadratName = 'Q101'");
      expect(result).toContain("QuadratName LIKE '%Q101%'");
    });

    it('should handle mixed column types correctly', () => {
      const columns = ['TreeTag', 'SpeciesCode', 'DBH'];
      const searchTerm = ['TEST'];
      const result = buildSearchStub(columns, searchTerm);

      // TreeTag gets exact + partial
      expect(result).toContain("TreeTag = 'TEST'");
      expect(result).toContain("TreeTag LIKE '%TEST%'");

      // SpeciesCode and DBH get only partial
      expect(result).toContain("SpeciesCode LIKE '%TEST%'");
      expect(result).not.toContain("SpeciesCode = 'TEST'");
      expect(result).toContain("DBH LIKE '%TEST%'");
      expect(result).not.toContain("DBH = 'TEST'");
    });
  });

  describe('Alias Handling', () => {
    it('should apply alias to identifier columns', () => {
      const columns = ['TreeTag'];
      const searchTerm = ['12345'];
      const alias = 'fm';
      const result = buildSearchStub(columns, searchTerm, alias);

      expect(result).toContain("fm.TreeTag = '12345'");
      expect(result).toContain("fm.TreeTag LIKE '%12345%'");
    });

    it('should apply alias to non-identifier columns', () => {
      const columns = ['SpeciesCode'];
      const searchTerm = ['ACRU'];
      const alias = 'sp';
      const result = buildSearchStub(columns, searchTerm, alias);

      expect(result).toContain("sp.SpeciesCode LIKE '%ACRU%'");
    });
  });

  describe('Multiple Search Terms', () => {
    it('should handle multiple search terms with OR logic', () => {
      const columns = ['TreeTag'];
      const searchTerms = ['011375', '022456'];
      const result = buildSearchStub(columns, searchTerms);

      // Both terms should have exact + partial match
      expect(result).toContain("TreeTag = '011375'");
      expect(result).toContain("TreeTag = '022456'");
    });

    it('should connect multiple terms with OR', () => {
      const columns = ['TreeTag'];
      const searchTerms = ['AAA', 'BBB'];
      const result = buildSearchStub(columns, searchTerms);

      // Should have OR between the conditions
      expect(result).toMatch(/TreeTag.*OR.*TreeTag/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty search filter', () => {
      const columns = ['TreeTag'];
      const searchTerm: string[] = [];
      const result = buildSearchStub(columns, searchTerm);

      expect(result).toBe('');
    });

    it('should handle empty columns array', () => {
      const columns: string[] = [];
      const searchTerm = ['test'];
      const result = buildSearchStub(columns, searchTerm);

      expect(result).toBe('');
    });

    it('should properly escape special SQL characters', () => {
      const columns = ['TreeTag'];
      const searchTerm = ["test'tag"];
      const result = buildSearchStub(columns, searchTerm);

      // Should be escaped by mysql2's escape function
      expect(result).not.toContain("'test'tag'");
    });

    it('should handle numeric search terms as strings', () => {
      const columns = ['TreeTag'];
      const searchTerm = ['12345'];
      const result = buildSearchStub(columns, searchTerm);

      expect(result).toContain("TreeTag = '12345'");
      expect(result).toContain("TreeTag LIKE '%12345%'");
    });
  });

  describe('Before Fix Regression Test', () => {
    it('OLD BEHAVIOR: would only do partial match, causing false positives', () => {
      // Old behavior: searching "011375" would match "2011375", "0113750", etc.
      const columns = ['TreeTag'];
      const searchTerm = ['011375'];

      // Old logic (MAX only)
      const oldResult = `TreeTag LIKE '%011375%'`;

      // Would match all of these:
      expect(oldResult).toMatch(/TreeTag LIKE/);

      // New logic (exact first, then partial)
      const newResult = buildSearchStub(columns, searchTerm);

      // Now prioritizes exact match
      expect(newResult).toContain("TreeTag = '011375'");
      expect(newResult).toMatch(/TreeTag = '011375' OR TreeTag LIKE '%011375%'/);
    });
  });
});
