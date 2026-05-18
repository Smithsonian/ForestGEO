/**
 * csv-to-sql-v2 integration test scaffolding (Task 17).
 *
 * Stands up a fresh MySQL database, loads the canonical CTFS DDL, seeds
 * minimal reference data, runs the csv-to-sql-v2 CLI against a single-row CSV,
 * and asserts the generated `.sql` contains the procedure envelope.
 *
 * Follow-up tasks (18+) will actually execute the generated SQL and inspect
 * the resulting rows. This scaffolding test verifies the harness wiring only.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import mysql from 'mysql2/promise';
import { createTestDatabase, teardownTestDatabase, DEFAULT_TEST_CONFIG } from '../setup/local-db-setup';
import { splitSqlFile } from '../../lib/provisioning/sql-runner';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/csv-to-sql-v2');
const CANONICAL_DDL_PATH = path.join(FIXTURE_DIR, 'canonical-ddl.sql');
const SEED_CENSUS_1_PATH = path.join(FIXTURE_DIR, 'seed-census-1.sql');
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const TEST_SITE_NAME = 'TEST';
const TEST_PLOT_ID = 1;
const TEST_CENSUS_NUMBER = '1';

/**
 * MySQL error codes for "object does not exist" failures we tolerate when
 * loading the canonical DDL.
 *
 * `DBCHANGES2014f.sql` references three artifacts that exist in production
 * CTFS databases but NOT in a bootstrap schema: the `TAX1temp` table (renamed
 * to `ViewTaxonomy` in a step from a previous migration we don't have) and the
 * `ViewFullTable` view (created elsewhere). Skipping these errors is the
 * standard practice used elsewhere in this repo's test harness (see
 * `loadSchema` in `tests/setup/local-db-setup.ts`).
 *
 * ER_NO_SUCH_TABLE = 1146 (42S02)
 */
const TOLERATED_DDL_ERROR_CODES = new Set<string>(['ER_NO_SUCH_TABLE']);

/**
 * Strips C-style `/* ... *\/` block comments from a SQL file.
 *
 * `splitSqlFile` in `lib/provisioning/sql-runner.ts` understands `--` and `#`
 * line comments but does NOT strip multi-line block comments — they get mixed
 * into the next statement and cause syntax errors. `DBCHANGES2014f.sql` uses
 * block comments to embed prose, so we strip them before splitting.
 *
 * Quotes are not tracked because the canonical DDL has no string literals
 * containing the `/​*` or `*​/` sequences.
 */
function stripBlockComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, '');
}

async function loadCanonicalDdl(connection: mysql.Connection, filePath: string): Promise<void> {
  const content = stripBlockComments(readFileSync(filePath, 'utf8'));
  const statements = splitSqlFile(content);
  for (const stmt of statements) {
    try {
      await connection.query(stmt.sql);
    } catch (err: any) {
      if (TOLERATED_DDL_ERROR_CODES.has(err.code)) continue;
      const preview = stmt.sql.slice(0, 200).replace(/\s+/g, ' ');
      throw new Error(`Canonical DDL load failed at ${filePath}:${stmt.lineNumber}: ${err.message}\nStatement: ${preview}`);
    }
  }
}

async function loadSeedFile(connection: mysql.Connection, filePath: string): Promise<void> {
  const content = readFileSync(filePath, 'utf8');
  const statements = splitSqlFile(content);
  for (const stmt of statements) {
    await connection.query(stmt.sql);
  }
}

describe('csv-to-sql-v2 integration — scaffolding', () => {
  let connection: mysql.Connection;
  const dbName = `forestgeo_csv_v2_scaffold_${process.pid}_${Date.now()}`;
  const config = { ...DEFAULT_TEST_CONFIG, database: dbName };

  beforeEach(async () => {
    connection = await createTestDatabase(config);
    await loadCanonicalDdl(connection, CANONICAL_DDL_PATH);
    await loadSeedFile(connection, SEED_CENSUS_1_PATH);
  });

  afterEach(async () => {
    if (connection) {
      await teardownTestDatabase(connection, config);
    }
  });

  it('seeds the canonical schema with exactly one Census row for the target plot/number', async () => {
    const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM Census WHERE PlotID = ? AND PlotCensusNumber = ?', [
      TEST_PLOT_ID,
      TEST_CENSUS_NUMBER
    ]);
    expect(rows[0].n).toBe(1);
  });

  it('generates a runnable .sql file containing the procedure envelope', () => {
    const tempOutDir = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-scaffold-'));
    const inputCsv = path.join(tempOutDir, 'one-row.csv');
    const outputSql = path.join(tempOutDir, 'out.sql');

    writeFileSync(inputCsv, 'tag,stemtag,spcode,quadrat,lx,ly,dbh,hom,date,codes\n' + '1,1,FOO,A1,1,1,10,1.3,2024-01-01,LI\n', 'utf8');

    execSync(
      [
        'npx tsx lib/csv-to-sql-v2.ts',
        `--input ${inputCsv}`,
        `--site ${TEST_SITE_NAME}`,
        `--plot-id ${TEST_PLOT_ID}`,
        `--census-number ${TEST_CENSUS_NUMBER}`,
        `--output ${outputSql}`
      ].join(' '),
      { cwd: PROJECT_ROOT, stdio: 'pipe' }
    );

    const generated = readFileSync(outputSql, 'utf8');
    expect(generated).toMatch(/CREATE PROCEDURE csv_to_sql_v2_load/);
    expect(generated).toMatch(/CALL csv_to_sql_v2_load\(\);/);
    expect(generated).toMatch(/DROP PROCEDURE IF EXISTS csv_to_sql_v2_load;/);
  });
});
