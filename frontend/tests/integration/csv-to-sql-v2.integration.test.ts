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
const SEED_WITH_PRIORS_PATH = path.join(FIXTURE_DIR, 'seed-with-priors.sql');
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const TEST_SITE_NAME = 'TEST';
const TEST_PLOT_ID = 1;
const TEST_CENSUS_NUMBER = '1';
const TEST_CENSUS_NUMBER_2 = '2';

/**
 * Production-only objects referenced by `DBCHANGES2014f.sql` that do not
 * exist in a bootstrap schema. ALTER / RENAME statements touching these are
 * the only DDL errors we tolerate — any other ER_NO_SUCH_TABLE means a real
 * bug (e.g. a typo in canonical-ddl.sql) and must not be swallowed.
 */
const PRODUCTION_ONLY_OBJECTS = ['ViewTaxonomy', 'ViewFullTable', 'TAX1temp'];

function isTolerableDdlError(errCode: string, stmt: string): boolean {
  if (errCode !== 'ER_NO_SUCH_TABLE') return false;
  return PRODUCTION_ONLY_OBJECTS.some(obj => stmt.includes(obj));
}

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
      if (isTolerableDdlError(err.code, stmt.sql)) continue;
      const preview = stmt.sql.slice(0, 200).replace(/\s+/g, ' ');
      throw new Error(`Canonical DDL load failed at ${filePath}:${stmt.lineNumber}: ${err.message}\nStatement: ${preview}`);
    }
  }
}

/** Strict: any SQL error fails the test (no error swallowing — seed files are hand-authored). */
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

// ---------------------------------------------------------------------------
// Task 18: end-to-end success scenarios.
//
// Each test bootstraps a fresh DB with the canonical DDL + base seed, optionally
// applies a scenario-specific seed, runs csv-to-sql-v2 to render a `.sql` file,
// executes it through `splitSqlFile` (which understands `DELIMITER //`), and
// asserts the destination tables (Tree, Stem, DBH, DBHAttributes) reflect the
// expected post-ingestion state.
// ---------------------------------------------------------------------------

interface ExecuteSqlResult {
  warnings: mysql.RowDataPacket[];
}

async function executeGeneratedSql(connection: mysql.Connection, sql: string): Promise<ExecuteSqlResult> {
  const statements = splitSqlFile(sql);
  for (const stmt of statements) {
    if (!stmt.sql.trim()) continue;
    await connection.query(stmt.sql);
  }
  const [warnings] = await connection.query<mysql.RowDataPacket[]>('SHOW WARNINGS');
  return { warnings };
}

function writeCsv(dir: string, rows: string[]): string {
  const inputCsv = path.join(dir, 'in.csv');
  const header = 'tag,stemtag,spcode,quadrat,lx,ly,dbh,hom,date,codes\n';
  writeFileSync(inputCsv, header + rows.join('\n') + '\n', 'utf8');
  return inputCsv;
}

function generateSql(inputCsv: string, outSql: string, censusNumber: string): void {
  execSync(
    [
      'npx tsx lib/csv-to-sql-v2.ts',
      `--input ${inputCsv}`,
      `--site ${TEST_SITE_NAME}`,
      `--plot-id ${TEST_PLOT_ID}`,
      `--census-number ${censusNumber}`,
      `--output ${outSql}`
    ].join(' '),
    { cwd: PROJECT_ROOT, stdio: 'pipe' }
  );
}

async function countRows(connection: mysql.Connection, table: string, where = ''): Promise<number> {
  const sql = `SELECT COUNT(*) AS n FROM \`${table}\`${where ? ` WHERE ${where}` : ''}`;
  const [rows] = await connection.query<mysql.RowDataPacket[]>(sql);
  return Number(rows[0].n);
}

describe('csv-to-sql-v2 integration — success scenarios (Task 18)', () => {
  let connection: mysql.Connection;
  const dbName = `forestgeo_csv_v2_success_${process.pid}_${Date.now()}`;
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

  it('Scenario 1 — Census 1 all-new load (4 distinct tags, no codes)', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-s1-'));
    const inputCsv = writeCsv(tmp, [
      '1,1,FOO,A1,1,1,10,1.3,2024-01-01,',
      '2,1,FOO,A1,2,2,12,1.3,2024-01-01,',
      '3,1,BAR,A2,3,3,15,1.3,2024-01-01,',
      '4,1,BAZ,B1,4,4,8,1.3,2024-01-01,'
    ]);
    const outSql = path.join(tmp, 'out.sql');
    generateSql(inputCsv, outSql, TEST_CENSUS_NUMBER);

    await executeGeneratedSql(connection, readFileSync(outSql, 'utf8'));

    expect(await countRows(connection, 'Tree')).toBe(4);
    expect(await countRows(connection, 'Stem')).toBe(4);
    expect(await countRows(connection, 'DBH', 'CensusID = 1')).toBe(4);
    expect(await countRows(connection, 'DBHAttributes')).toBe(0);
  });

  it('Scenario 2 — Census 2 mixed O/M/N (existing tree reused for O and M; new tree+stem for N)', async () => {
    await loadSeedFile(connection, SEED_WITH_PRIORS_PATH);

    const tmp = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-s2-'));
    const inputCsv = writeCsv(tmp, [
      // O: known (Tag=1, StemTag=1) — must reuse StemID=1, TreeID=1
      '1,1,FOO,A1,1,1,11,1.3,2025-01-15,',
      // M: known Tag=1 but new StemTag=2 — must reuse TreeID=1, insert new Stem
      '1,2,FOO,A1,1.5,1.5,9,1.3,2025-01-15,',
      // N: brand-new Tag=99 — must insert new Tree + Stem
      '99,1,BAZ,B1,5,5,20,1.3,2025-01-15,'
    ]);
    const outSql = path.join(tmp, 'out.sql');
    generateSql(inputCsv, outSql, TEST_CENSUS_NUMBER_2);

    await executeGeneratedSql(connection, readFileSync(outSql, 'utf8'));

    // Tree: 3 priors (TreeID 1,2,3) + 1 new for Tag=99 = 4
    expect(await countRows(connection, 'Tree')).toBe(4);
    // Stem: 3 priors + 1 new (Tag=1/StemTag=2) + 1 new (Tag=99/StemTag=1) = 5
    expect(await countRows(connection, 'Stem')).toBe(5);
    // DBH: 3 priors (CensusID=1) + 3 new (CensusID=2) = 6
    expect(await countRows(connection, 'DBH')).toBe(6);
    expect(await countRows(connection, 'DBH', 'CensusID = 2')).toBe(3);

    // O-row reuses StemID=1 (no new stem created for Tag=1/StemTag=1)
    const [oRows] = await connection.query<mysql.RowDataPacket[]>('SELECT StemID FROM DBH WHERE CensusID = 2 AND DBH = 11');
    expect(oRows.length).toBe(1);
    expect(oRows[0].StemID).toBe(1);

    // M-row attaches a new Stem to existing TreeID=1
    const [mStems] = await connection.query<mysql.RowDataPacket[]>("SELECT StemID, TreeID FROM Stem WHERE TreeID = 1 AND StemTag = '2'");
    expect(mStems.length).toBe(1);
    expect(mStems[0].TreeID).toBe(1);

    // N-row creates a new Tree
    const [nTrees] = await connection.query<mysql.RowDataPacket[]>("SELECT TreeID FROM Tree WHERE Tag = '99'");
    expect(nTrees.length).toBe(1);
  });

  it('Scenario 3 — HOM inheritance (blank HOM on O row picks up prior census HOM=2.0)', async () => {
    await loadSeedFile(connection, SEED_WITH_PRIORS_PATH);

    const tmp = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-s3-'));
    const inputCsv = writeCsv(tmp, [
      // O-row for Tag=2/StemTag=1 (prior census stem with HOM=2.0); leave HOM blank
      '2,1,BAR,A1,2,2,19,,2025-01-15,'
    ]);
    const outSql = path.join(tmp, 'out.sql');
    generateSql(inputCsv, outSql, TEST_CENSUS_NUMBER_2);

    await executeGeneratedSql(connection, readFileSync(outSql, 'utf8'));

    const [dbhRows] = await connection.query<mysql.RowDataPacket[]>('SELECT HOM, DBH FROM DBH WHERE CensusID = 2 AND StemID = 2');
    expect(dbhRows.length).toBe(1);
    expect(String(dbhRows[0].HOM)).toBe('2.0');
    expect(Number(dbhRows[0].DBH)).toBeCloseTo(19, 5);
  });

  it('Scenario 4 — HOM fallback to 1.3 (new tree, no priors)', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-s4-'));
    const inputCsv = writeCsv(tmp, [
      // N-row, blank HOM, fresh Census 1 (no priors)
      '7,1,QUX,A1,1,1,11,,2024-01-15,'
    ]);
    const outSql = path.join(tmp, 'out.sql');
    generateSql(inputCsv, outSql, TEST_CENSUS_NUMBER);

    await executeGeneratedSql(connection, readFileSync(outSql, 'utf8'));

    const [dbhRows] = await connection.query<mysql.RowDataPacket[]>('SELECT HOM, DBH FROM DBH WHERE CensusID = 1');
    expect(dbhRows.length).toBe(1);
    expect(String(dbhRows[0].HOM)).toBe('1.3');
  });

  it('Scenario 5 — DBH=0 normalizes to NULL', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-s5-'));
    const inputCsv = writeCsv(tmp, ['5,1,FOO,A1,1,1,0,1.3,2024-01-15,']);
    const outSql = path.join(tmp, 'out.sql');
    generateSql(inputCsv, outSql, TEST_CENSUS_NUMBER);

    await executeGeneratedSql(connection, readFileSync(outSql, 'utf8'));

    const [dbhRows] = await connection.query<mysql.RowDataPacket[]>('SELECT DBH FROM DBH WHERE CensusID = 1');
    expect(dbhRows.length).toBe(1);
    expect(dbhRows[0].DBH).toBeNull();
  });

  it('Scenario 6 — Marker code derives PrimaryStem; non-marker codes go to DBHAttributes', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-s6-'));
    const inputCsv = writeCsv(tmp, [
      // Codes: M (main marker) ; LI (living) ; A (alive)
      '6,1,FOO,A1,1,1,14,1.3,2024-01-15,M;LI;A'
    ]);
    const outSql = path.join(tmp, 'out.sql');
    generateSql(inputCsv, outSql, TEST_CENSUS_NUMBER);

    await executeGeneratedSql(connection, readFileSync(outSql, 'utf8'));

    const [dbhRows] = await connection.query<mysql.RowDataPacket[]>('SELECT DBHID, PrimaryStem FROM DBH WHERE CensusID = 1');
    expect(dbhRows.length).toBe(1);
    expect(dbhRows[0].PrimaryStem).toBe('main');

    const dbhId = dbhRows[0].DBHID;
    const [attrRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT tsm.TSMCode
         FROM DBHAttributes da
         JOIN TSMAttributes tsm ON tsm.TSMID = da.TSMID
        WHERE da.DBHID = ?
        ORDER BY tsm.TSMCode`,
      [dbhId]
    );
    const codes = attrRows.map(r => r.TSMCode as string);
    expect(codes).toEqual(['A', 'LI']);
    expect(codes).not.toContain('M');
  });

  it('Scenario 7 — Resprout reuse (different StemTag on known tree picks up the single prior stem)', async () => {
    await loadSeedFile(connection, SEED_WITH_PRIORS_PATH);

    const tmp = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-s7-'));
    const inputCsv = writeCsv(tmp, [
      // Tag=3 exists (TreeID=3) with one prior stem StemTag='OLD', DBH=15 (>=10), no dead/resprout code.
      // CSV references Tag=3 with StemTag='NEW' — Stage 2 won't match StemTag, so Stage 2b
      // should reuse StemID=3 instead of inserting a new Stem.
      '3,NEW,BAZ,A2,3,3,16,1.3,2025-01-15,'
    ]);
    const outSql = path.join(tmp, 'out.sql');
    generateSql(inputCsv, outSql, TEST_CENSUS_NUMBER_2);

    await executeGeneratedSql(connection, readFileSync(outSql, 'utf8'));

    // No new Stem inserted — 3 prior stems remain
    expect(await countRows(connection, 'Stem')).toBe(3);

    // The new DBH row references the prior StemID=3
    const [dbhRows] = await connection.query<mysql.RowDataPacket[]>('SELECT StemID FROM DBH WHERE CensusID = 2');
    expect(dbhRows.length).toBe(1);
    expect(dbhRows[0].StemID).toBe(3);
  });
});
