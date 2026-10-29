/**
 * U4 (#560). Manifest migration 2026-10-28-01 and its hand-run twin 62 must trim the same
 * indexes behind the same successor check: run-migrations.sh and run-branch-refresh.sh
 * re-apply migration 28 (which re-creates idx_cm_census_active), and 62 runs after it.
 * The two files cannot be one file (the mysql client needs DELIMITER, which the Node runner
 * cannot load), so this test keeps their lists identical to each other and to an
 * independent oracle, and keeps 62 last in both runner lists.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCanonicalSchemaContract } from '@/lib/db/schema-contract';

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');
const MANIFEST_TRIM_FILE = 'schema-contract-repair/2026-10-28-01-trim-coremeasurements-redundant-indexes.sql';
const TWIN_TRIM_FILE_NAME = '62_trim_coremeasurements_redundant_indexes.sql';
const TWIN_TRIM_FILE = `unified-measurements-migrations/${TWIN_TRIM_FILE_NAME}`;
const MIGRATION_28_FILE_NAME = '28_add_bulk_ingestion_performance_indexes.sql';
const RUNNER_LISTS = [
  { script: 'unified-measurements-migrations/run-migrations.sh', arrayName: 'ORDERED_MIGRATIONS' },
  { script: 'unified-measurements-migrations/run-branch-refresh.sh', arrayName: 'POST_STORED_PROCEDURE_MIGRATIONS' }
] as const;
const COREMEASUREMENTS_TABLE = 'coremeasurements';
const REFUSAL_MESSAGE_PREFIX = "'coremeasurements index trim refused, missing or reshaped: '";
const ONLINE_ALTER_CLAUSE = "', ALGORITHM=INPLACE, LOCK=NONE'";
/** Plan review C1: a successor only counts when it is visible, has no prefix length, and (ux_measure_unique) is unique. */
const USABLE_SUCCESSOR_FILTER = "AND IS_VISIBLE = 'YES' AND SUB_PART IS NULL";
const UNIQUE_SUCCESSOR_CLAUSE = 'AND (expected.unique_required = 0 OR live.non_unique = 0)';

/** Oracle, from section 4 of the #560 design: the eight names the trim drops. */
const EXPECTED_DROP_NAMES = [
  'idx_cm_census_active',
  'idx_cm_stem_cid_date_dbh_hom',
  'idx_coremeasurements_census_plot',
  'idx_coremeasurements_census_plot_validation',
  'idx_coremeasurements_census_validation',
  'idx_description',
  'idx_measurementdate',
  'idx_stemid'
];
interface SuccessorRequirement {
  columns: string;
  uniqueRequired: boolean;
}
/** Oracle: the four successors, their ordered columns, and whether the successor must be unique. */
const EXPECTED_SUCCESSORS: Record<string, SuccessorRequirement> = {
  idx_censusid: { columns: 'CensusID', uniqueRequired: false },
  idx_cm_census_validated_stem: { columns: 'CensusID,IsValidated,IsActive,StemGUID', uniqueRequired: false },
  idx_cm_stemguid_active: { columns: 'StemGUID,IsActive', uniqueRequired: false },
  ux_measure_unique: { columns: 'StemGUID,CensusID,MeasurementDate,MeasuredDBH,MeasuredHOM', uniqueRequired: true }
};
const UNIQUE_REQUIRED_FLAG = '1';

const DROP_LIST_PATTERN = /INDEX_NAME IN \(([^)]*)\)/;
const QUOTED_NAME_PATTERN = /'(\w+)'/g;
const SUCCESSOR_ROW_PATTERN = /SELECT '(\w+)'(?: AS index_name)?, '([^']+)'(?: AS columns_csv)?, ([01])/g;

class MigrationSourceShapeError extends Error {
  constructor(file: string, what: string) {
    super(`${file}: ${what}`);
    this.name = 'MigrationSourceShapeError';
  }
}

function readMigrationFile(relativePath: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, relativePath), 'utf-8');
}

function parseDropNames(file: string): string[] {
  const match = readMigrationFile(file).match(DROP_LIST_PATTERN);
  if (!match) throw new MigrationSourceShapeError(file, 'no INDEX_NAME IN (...) drop list');
  return [...match[1].matchAll(QUOTED_NAME_PATTERN)].map(name => name[1]).sort();
}

function parseSuccessors(file: string): Record<string, SuccessorRequirement> {
  return Object.fromEntries(
    [...readMigrationFile(file).matchAll(SUCCESSOR_ROW_PATTERN)].map(row => [row[1], { columns: row[2], uniqueRequired: row[3] === UNIQUE_REQUIRED_FLAG }])
  );
}

function parseRunnerList(script: string, arrayName: string): string[] {
  const match = readMigrationFile(script).match(new RegExp(`${arrayName}=\\(([\\s\\S]*?)\\n\\)`));
  if (!match) throw new MigrationSourceShapeError(script, `no ${arrayName}=( ... ) array`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map(entry => entry[1]);
}

describe('manifest trim migration and its hand-run twin 62 stay identical (#560)', () => {
  const canonicalIndexes = loadCanonicalSchemaContract().tables[COREMEASUREMENTS_TABLE].indexes;

  it.each([MANIFEST_TRIM_FILE, TWIN_TRIM_FILE])('%s drops exactly the eight names of the design', file => {
    const dropNames = parseDropNames(file);
    console.log(`[U4] ${file} drop list: ${JSON.stringify(dropNames)}`);
    expect(dropNames).toEqual(EXPECTED_DROP_NAMES);
  });

  it.each([MANIFEST_TRIM_FILE, TWIN_TRIM_FILE])('%s requires exactly the four successors with their ordered columns and uniqueness', file => {
    const successors = parseSuccessors(file);
    console.log(`[U4] ${file} successors: ${JSON.stringify(successors)}`);
    expect(successors).toEqual(EXPECTED_SUCCESSORS);
  });

  it('both files raise the same refusal message, ignore unusable successors, and demand the same online ALTER', () => {
    for (const file of [MANIFEST_TRIM_FILE, TWIN_TRIM_FILE]) {
      const contents = readMigrationFile(file);
      expect(contents, `${file} refusal message`).toContain(REFUSAL_MESSAGE_PREFIX);
      expect(contents, `${file} must not count an invisible or prefix-length successor`).toContain(USABLE_SUCCESSOR_FILTER);
      expect(contents, `${file} must not count a non-unique ux_measure_unique`).toContain(UNIQUE_SUCCESSOR_CLAUSE);
      expect(contents, `${file} online ALTER clause`).toContain(ONLINE_ALTER_CLAUSE);
    }
  });

  it('agrees with tablestructures.sql: no dropped name is canonical, every successor is canonical with those columns', () => {
    const canonicalDropped = EXPECTED_DROP_NAMES.filter(name => canonicalIndexes[name.toLowerCase()]);
    const successorColumns = Object.fromEntries(
      Object.keys(EXPECTED_SUCCESSORS).map(name => {
        const canonical = canonicalIndexes[name.toLowerCase()];
        return [name, canonical ? { columns: canonical.columns.join(','), uniqueRequired: canonical.unique } : null];
      })
    );
    console.log(`[U4] dropped yet canonical: ${JSON.stringify(canonicalDropped)}; canonical successor columns: ${JSON.stringify(successorColumns)}`);
    expect(canonicalDropped, 'an index re-added to the canonical DDL while still on the drop list').toEqual([]);
    expect(successorColumns).toEqual(EXPECTED_SUCCESSORS);
  });

  it('lists 62 last, after 28, in both hand-run runners', () => {
    for (const { script, arrayName } of RUNNER_LISTS) {
      const list = parseRunnerList(script, arrayName);
      console.log(`[U4] ${script} ${arrayName} tail: ${JSON.stringify(list.slice(-3))}`);
      expect(list.at(-1), `${script}: 62 must be the last entry`).toBe(TWIN_TRIM_FILE_NAME);
      expect(list.indexOf(MIGRATION_28_FILE_NAME), `${script}: 28 must run before 62`).toBeLessThan(list.indexOf(TWIN_TRIM_FILE_NAME));
      expect(list.indexOf(MIGRATION_28_FILE_NAME), `${script}: 28 must be listed`).toBeGreaterThanOrEqual(0);
    }
  });
});
