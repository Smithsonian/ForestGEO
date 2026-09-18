import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseSiteValidationSeeds, ValidationSeedParseError } from './validation-seed-parser';

const COREQUERIES_PATH = path.join(process.cwd(), 'db/sql/corequeries.sql');
const LEGACY_ROLLBACK_SEEDS_PATH = path.join(process.cwd(), 'db/rollback/2026-09-02-dbh-legacy-rules-corequeries.sql');

describe('parseSiteValidationSeeds', () => {
  it('unescapes doubled quotes and backslash escapes, and keeps semicolons and parentheses inside strings', () => {
    const seeds = parseSiteValidationSeeds(`
      INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition, ChangelogDefinition, IsEnabled)
      VALUES (7, 'ValidateQuoted', 'Quadrat''s name; with \\'escapes\\' (and parens)', 'a;b', 'SELECT ''x''; CALL p(1, 2);', '', true);
    `);

    expect(seeds, 'every literal must round-trip exactly as MySQL would store it').toEqual([
      {
        validationID: 7,
        procedureName: 'ValidateQuoted',
        description: "Quadrat's name; with 'escapes' (and parens)",
        criteria: 'a;b',
        definition: "SELECT 'x'; CALL p(1, 2);"
      }
    ]);
  });

  it('maps values by the statement column list rather than by position', () => {
    const seeds = parseSiteValidationSeeds(`
      INSERT INTO sitespecificvalidations (Definition, Criteria, ValidationID, Description, ProcedureName)
      VALUES ('CALL q();', 'measuredDBH', 2, 'Reordered', 'ValidateReordered');
    `);

    expect(seeds).toEqual([
      { validationID: 2, procedureName: 'ValidateReordered', description: 'Reordered', criteria: 'measuredDBH', definition: 'CALL q();' }
    ]);
  });

  it('ignores comments, other statements, and an ON DUPLICATE KEY UPDATE tail', () => {
    const seeds = parseSiteValidationSeeds(`
      -- INSERT INTO sitespecificvalidations (ValidationID) VALUES (99);
      /* INSERT INTO sitespecificvalidations (ValidationID) VALUES (98); */
      truncate sitespecificvalidations;
      INSERT INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Criteria, Definition)
      VALUES (1, 'ValidateOne', 'one', 'c', 'CALL one();')
      ON DUPLICATE KEY UPDATE Description = VALUES(Description), Definition = 'not; a value';
      INSERT INTO othertable (ValidationID) VALUES (97);
    `);

    expect(seeds.map(seed => seed.validationID)).toEqual([1]);
  });

  it('fails loudly on an unterminated string or a non-literal value instead of guessing', () => {
    expect(() => parseSiteValidationSeeds(`INSERT INTO sitespecificvalidations (ValidationID, Description) VALUES (1, 'never closed);`)).toThrow(
      ValidationSeedParseError
    );
    expect(() => parseSiteValidationSeeds(`INSERT INTO sitespecificvalidations (ValidationID, Description) VALUES (1, CONCAT('a', 'b'));`)).toThrow(
      /unsupported value/i
    );
    expect(() => parseSiteValidationSeeds(`INSERT INTO sitespecificvalidations (ValidationID, Description) VALUES (1);`)).toThrow(/2 columns but 1 values/);
  });

  it('parses every seed in the canonical corequeries.sql, including rules whose text uses backslash escapes', () => {
    const seeds = parseSiteValidationSeeds(readFileSync(COREQUERIES_PATH, 'utf8'));
    const ids = seeds.map(seed => seed.validationID);

    expect(new Set(ids).size, `duplicate ValidationIDs parsed: ${ids.join(', ')}`).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([1, 2, 3]));
    const quadratRule = seeds.find(seed => seed.description.startsWith('Quadrat'));
    expect(quadratRule?.description, 'the backslash-escaped apostrophe must be unescaped').toMatch(/^Quadrat's name matches/);
  });

  it('parses the legacy rollback seed patch', () => {
    const seeds = parseSiteValidationSeeds(readFileSync(LEGACY_ROLLBACK_SEEDS_PATH, 'utf8'));

    expect(seeds.map(seed => [seed.validationID, seed.procedureName])).toEqual([
      [1, 'ValidateDBHGrowthExceedsMax'],
      [2, 'ValidateDBHShrinkageExceedsMax']
    ]);
  });
});
