/**
 * Every SQL file that provisioning (lib/provisioning/steps/sql-steps.ts) or the
 * deploy pipeline (apply-schema-migrations, apply-catalog-migrations,
 * deploy-validations, deploy-taxonomy-views) executes must not name an
 * environment-specific account. CREATE PROCEDURE with a DEFINER that does not
 * exist SUCCEEDS and fails only at CALL time ("The user specified as a definer
 * ('azureroot'@'%') does not exist"), so provisioning reports success and the
 * site breaks at first upload. See #399 and commit 807ed084.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMigrationSources } from '@/scripts/apply-schema-migrations';
import { loadCatalogMigrationSources } from '@/scripts/apply-catalog-migrations';
import { extractViewStatements } from '@/scripts/deploy-taxonomy-views-to-all-schemas';

const EXECUTED_SQL_FILES = ['db/sql/tablestructures.sql', 'db/sql/corequeries.sql', 'db/sql/storedprocedures.sql'] as const;
const FORBIDDEN_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'explicit DEFINER clause', pattern: /\bDEFINER\s*=/i },
  { label: 'azureroot account name', pattern: /\bazureroot\b/i }
];

interface NamedSql {
  name: string;
  contents: string;
}

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

function violations({ name, contents }: NamedSql): string[] {
  const found: string[] = [];
  contents.split('\n').forEach((line, index) => {
    for (const { label, pattern } of FORBIDDEN_PATTERNS) {
      if (pattern.test(line)) found.push(`${name}:${index + 1} ${label}: ${line.trim()}`);
    }
  });
  return found;
}

function collectExecutedSql(): NamedSql[] {
  const files: NamedSql[] = EXECUTED_SQL_FILES.map(name => ({ name, contents: readRepoFile(name) }));
  const siteMigrations = loadMigrationSources().map(source => ({ name: `db/migrations/${source.file}`, contents: source.contents }));
  const catalogMigrations = loadCatalogMigrationSources().map(source => ({ name: `db/migrations/${source.file}`, contents: source.contents }));
  const views = [...extractViewStatements(readRepoFile('db/sql/tablestructures.sql'))].map(([view, sql]) => ({
    name: `tablestructures.sql#${view}`,
    contents: sql
  }));
  return [...files, ...siteMigrations, ...catalogMigrations, ...views];
}

describe('executed DDL is environment-neutral', () => {
  const executed = collectExecutedSql();

  it('covers the three base files, every manifest migration, and both taxonomy views', () => {
    const names = executed.map(entry => entry.name);
    console.log(`[ddl neutrality] ${names.length} sources:\n  ${names.join('\n  ')}`);

    for (const file of EXECUTED_SQL_FILES) expect(names).toContain(file);
    expect(names.filter(name => name.startsWith('db/migrations/')).length).toBe(loadMigrationSources().length + loadCatalogMigrationSources().length);
    expect(names).toContain('tablestructures.sql#alltaxonomiesview');
    expect(names).toContain('tablestructures.sql#stemtaxonomiesview');
  });

  it.each(executed.map(entry => [entry.name, entry] as const))('%s names no DEFINER and no azureroot', (_name, entry) => {
    expect(violations(entry)).toEqual([]);
  });

  it('the checker itself catches an explicit DEFINER (so a green run means something)', () => {
    const poisoned: NamedSql = { name: 'fixture.sql', contents: "DROP PROCEDURE IF EXISTS p;\nCREATE DEFINER = azureroot@'%' PROCEDURE p() BEGIN END" };

    const found = violations(poisoned);
    console.log(`[ddl neutrality] injected-fixture violations: ${JSON.stringify(found)}`);

    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/^fixture\.sql:2 explicit DEFINER clause/);
    expect(found[1]).toMatch(/^fixture\.sql:2 azureroot account name/);
  });
});
