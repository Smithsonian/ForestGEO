/**
 * U3 (#560). The hand-run CTFS import scripts (db/migrations/ctfs-migrations/) are not in
 * the migration manifest, so nothing re-checks what they create after an import. Two of
 * them used to create idx_coremeasurements_census_plot and a (CensusID, IsValidated) twin
 * on every imported site: duplicates of canonical indexes, and the reason forestgeo_harvard,
 * forestgeo_mpala and forestgeo_rabi carried 21 coremeasurements indexes. Migration
 * 2026-10-28-01 drops them; this test keeps a later CTFS import from re-creating any
 * coremeasurements index that tablestructures.sql does not define, whatever syntax it uses.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCanonicalSchemaContract } from '@/lib/db/schema-contract';

const CTFS_MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations', 'ctfs-migrations');
const SQL_EXTENSION = '.sql';
const COREMEASUREMENTS_TABLE = 'coremeasurements';
const SQL_LINE_COMMENT_PREFIXES = ['--', '#'] as const;

/** Every way a script can create an index: the add_index_if_not_exists helper, CREATE INDEX, ALTER TABLE ... ADD INDEX/KEY. */
const INDEX_CREATION_PATTERNS: readonly RegExp[] = [
  /add_index_if_not_exists\(\s*'(?<table>\w+)'\s*,\s*'(?<index>\w+)'/gi,
  /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?`?(?<index>\w+)`?\s+on\s+`?(?<table>\w+)`?/gi,
  /alter\s+table\s+`?(?<table>\w+)`?\s+add\s+(?:unique\s+)?(?:index|key)\s+(?:if\s+not\s+exists\s+)?`?(?<index>\w+)`?/gi
];

interface IndexCreation {
  file: string;
  line: number;
  table: string;
  index: string;
}

function findIndexCreations(file: string, contents: string): IndexCreation[] {
  const creations: IndexCreation[] = [];
  contents.split('\n').forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();
    if (SQL_LINE_COMMENT_PREFIXES.some(prefix => line.startsWith(prefix))) return;
    for (const pattern of INDEX_CREATION_PATTERNS) {
      for (const match of line.matchAll(pattern)) {
        creations.push({ file, line: lineIndex + 1, table: match.groups!.table.toLowerCase(), index: match.groups!.index });
      }
    }
  });
  return creations;
}

const POSITIVE_CONTROL_SQL = [
  "CALL add_index_if_not_exists('coremeasurements', 'idx_fixture_call', 'CensusID');",
  'CREATE INDEX idx_fixture_create ON coremeasurements (CensusID);',
  'ALTER TABLE `coremeasurements` ADD INDEX `idx_fixture_alter` (CensusID);',
  "-- CALL add_index_if_not_exists('coremeasurements', 'idx_fixture_commented_out', 'CensusID');",
  "CALL add_index_if_not_exists('stems', 'idx_fixture_other_table', 'CensusID');"
].join('\n');
const POSITIVE_CONTROL_EXPECTED = ['idx_fixture_call', 'idx_fixture_create', 'idx_fixture_alter'];

describe('CTFS import scripts and the canonical coremeasurements index set (#560)', () => {
  it('positive control: recognises every index-creation form on coremeasurements, and skips comments and other tables', () => {
    const found = findIndexCreations('positive-control.sql', POSITIVE_CONTROL_SQL)
      .filter(creation => creation.table === COREMEASUREMENTS_TABLE)
      .map(creation => creation.index);
    console.log(`[U3] positive control found ${JSON.stringify(found)}`);
    expect(found).toEqual(POSITIVE_CONTROL_EXPECTED);
  });

  it('creates no coremeasurements index that tablestructures.sql does not define', () => {
    const canonicalIndexes = loadCanonicalSchemaContract().tables[COREMEASUREMENTS_TABLE].indexes;
    const files = fs
      .readdirSync(CTFS_MIGRATIONS_DIR)
      .filter(name => name.endsWith(SQL_EXTENSION))
      .sort();
    const creations = files.flatMap(file => findIndexCreations(file, fs.readFileSync(path.join(CTFS_MIGRATIONS_DIR, file), 'utf-8')));
    const onCoremeasurements = creations.filter(creation => creation.table === COREMEASUREMENTS_TABLE);
    const nonCanonical = onCoremeasurements
      .filter(creation => !canonicalIndexes[creation.index.toLowerCase()])
      .map(creation => `${creation.file}:${creation.line} creates coremeasurements.${creation.index}, which tablestructures.sql does not define`);
    console.log(`[U3] scanned ${files.length} scripts: ${creations.length} index creations, ${onCoremeasurements.length} on coremeasurements`);

    expect(creations.length, 'the scanner matched nothing at all, so its patterns no longer fit these scripts').toBeGreaterThan(0);
    expect(nonCanonical).toEqual([]);
  });
});
