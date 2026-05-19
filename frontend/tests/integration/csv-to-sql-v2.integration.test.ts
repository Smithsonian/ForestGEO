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

// ---------------------------------------------------------------------------
// Task 19: failure rollback scenarios.
//
// Each test boots a fresh DB with the canonical DDL + base seed, captures
// destination-table row counts (Tree/Stem/DBH/DBHAttributes), generates a `.sql`
// file from a CSV crafted to violate a specific Stage 0/Stage 5 check, executes
// it, and asserts both (a) the execution throws with a specific error message
// and (b) all destination table counts are unchanged (i.e. the procedure's
// EXIT HANDLER FOR SQLEXCEPTION rolled back the transaction).
// ---------------------------------------------------------------------------

interface DestinationCounts {
  tree: number;
  stem: number;
  dbh: number;
  dbhAttributes: number;
}

async function captureDestinationCounts(conn: mysql.Connection): Promise<DestinationCounts> {
  return {
    tree: await countRows(conn, 'Tree'),
    stem: await countRows(conn, 'Stem'),
    dbh: await countRows(conn, 'DBH'),
    dbhAttributes: await countRows(conn, 'DBHAttributes')
  };
}

function expectCountsUnchanged(after: DestinationCounts, before: DestinationCounts): void {
  expect(after.tree).toBe(before.tree);
  expect(after.stem).toBe(before.stem);
  expect(after.dbh).toBe(before.dbh);
  expect(after.dbhAttributes).toBe(before.dbhAttributes);
}

function generateSqlWithReload(inputCsv: string, outSql: string, censusNumber: string): void {
  execSync(
    [
      'npx tsx lib/csv-to-sql-v2.ts',
      `--input ${inputCsv}`,
      `--site ${TEST_SITE_NAME}`,
      `--plot-id ${TEST_PLOT_ID}`,
      `--census-number ${censusNumber}`,
      `--output ${outSql}`,
      '--allow-reload'
    ].join(' '),
    { cwd: PROJECT_ROOT, stdio: 'pipe' }
  );
}

describe('csv-to-sql-v2 integration — failure rollback scenarios (Task 19)', () => {
  let connection: mysql.Connection;
  const dbName = `forestgeo_csv_v2_failure_${process.pid}_${Date.now()}`;
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

  it('Scenario 1 — rollback on unknown species mnemonic', async () => {
    const before = await captureDestinationCounts(connection);

    const tmp = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-f1-'));
    const inputCsv = writeCsv(tmp, ['1,1,ZZZ,A1,1,1,10,1.3,2024-01-01,']);
    const outSql = path.join(tmp, 'out.sql');
    generateSql(inputCsv, outSql, TEST_CENSUS_NUMBER);

    await expect(executeGeneratedSql(connection, readFileSync(outSql, 'utf8'))).rejects.toThrow(/Unknown species mnemonics/);

    expectCountsUnchanged(await captureDestinationCounts(connection), before);
  });

  it('Scenario 2 — rollback on unknown quadrat name', async () => {
    const before = await captureDestinationCounts(connection);

    const tmp = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-f2-'));
    const inputCsv = writeCsv(tmp, ['1,1,FOO,Z99,1,1,10,1.3,2024-01-01,']);
    const outSql = path.join(tmp, 'out.sql');
    generateSql(inputCsv, outSql, TEST_CENSUS_NUMBER);

    await expect(executeGeneratedSql(connection, readFileSync(outSql, 'utf8'))).rejects.toThrow(/Unknown quadrats/);

    expectCountsUnchanged(await captureDestinationCounts(connection), before);
  });

  it('Scenario 3 — rollback on unknown TSMCode token', async () => {
    const before = await captureDestinationCounts(connection);

    const tmp = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-f3-'));
    const inputCsv = writeCsv(tmp, ['1,1,FOO,A1,1,1,10,1.3,2024-01-01,ZZ;LI']);
    const outSql = path.join(tmp, 'out.sql');
    generateSql(inputCsv, outSql, TEST_CENSUS_NUMBER);

    await expect(executeGeneratedSql(connection, readFileSync(outSql, 'utf8'))).rejects.toThrow(/Unknown TSMCodes/);

    expectCountsUnchanged(await captureDestinationCounts(connection), before);
  });

  it('Scenario 4 — rollback on duplicate (StemID, CensusID) DBH destination', async () => {
    await loadSeedFile(connection, SEED_WITH_PRIORS_PATH);
    const before = await captureDestinationCounts(connection);

    // Two CSV rows both reference the prior (Tag=1, StemTag=1) which resolves to
    // StemID=1. Both rows therefore target (StemID=1, CensusID=2) — check 8 fires.
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-f4-'));
    const inputCsv = writeCsv(tmp, ['1,1,FOO,A1,1,1,11,1.3,2025-01-15,', '1,1,FOO,A1,1,1,13,1.3,2025-01-15,']);
    const outSql = path.join(tmp, 'out.sql');
    generateSql(inputCsv, outSql, TEST_CENSUS_NUMBER_2);

    await expect(executeGeneratedSql(connection, readFileSync(outSql, 'utf8'))).rejects.toThrow(/Duplicate \(StemID, CensusID\) DBH destinations/);

    expectCountsUnchanged(await captureDestinationCounts(connection), before);
  });

  it('Scenario 5 — rollback on ambiguous tree lookup', async () => {
    // Seed two Tree rows with Tag='X' on the same plot. Both need at least one
    // Stem joined through a Quadrat on PlotID=1 so tree_lookup picks them up.
    await connection.query("INSERT INTO Tree (TreeID, Tag, SpeciesID) VALUES (10, 'X', 1), (11, 'X', 1)");
    await connection.query(
      'INSERT INTO Stem (StemID, TreeID, StemTag, QuadratID, StemNumber, QX, QY) VALUES ' + "(10, 10, '1', 1, 0, 1.0, 1.0), (11, 11, '1', 1, 0, 2.0, 2.0)"
    );

    const before = await captureDestinationCounts(connection);

    const tmp = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-f5-'));
    const inputCsv = writeCsv(tmp, ['X,1,FOO,A1,1,1,10,1.3,2024-01-15,']);
    const outSql = path.join(tmp, 'out.sql');
    generateSql(inputCsv, outSql, TEST_CENSUS_NUMBER);

    await expect(executeGeneratedSql(connection, readFileSync(outSql, 'utf8'))).rejects.toThrow(/Ambiguous tree tags/);

    expectCountsUnchanged(await captureDestinationCounts(connection), before);
  });

  it('Scenario 6 — rollback on ambiguous stem lookup', async () => {
    // Seed one Tree (Tag='Y') with two stems sharing the same (TreeID, StemTag).
    // tree_lookup resolves uniquely to TreeID=20, but stem_lookup has
    // StemCount=2 for (TreeID=20, StemTag='S1') so check 5 fires.
    await connection.query("INSERT INTO Tree (TreeID, Tag, SpeciesID) VALUES (20, 'Y', 1)");
    await connection.query(
      'INSERT INTO Stem (StemID, TreeID, StemTag, QuadratID, StemNumber, QX, QY) VALUES ' + "(20, 20, 'S1', 1, 0, 1.0, 1.0), (21, 20, 'S1', 1, 0, 2.0, 2.0)"
    );

    const before = await captureDestinationCounts(connection);

    const tmp = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-f6-'));
    const inputCsv = writeCsv(tmp, ['Y,S1,FOO,A1,1,1,10,1.3,2024-01-15,']);
    const outSql = path.join(tmp, 'out.sql');
    generateSql(inputCsv, outSql, TEST_CENSUS_NUMBER);

    await expect(executeGeneratedSql(connection, readFileSync(outSql, 'utf8'))).rejects.toThrow(/Ambiguous stem lookup/);

    expectCountsUnchanged(await captureDestinationCounts(connection), before);
  });

  it('Scenario 7 — rollback on missing Census row (--census-number=99)', async () => {
    const before = await captureDestinationCounts(connection);

    const tmp = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-f7-'));
    const inputCsv = writeCsv(tmp, ['1,1,FOO,A1,1,1,10,1.3,2024-01-01,']);
    const outSql = path.join(tmp, 'out.sql');
    // census-number 99 does not exist in the seed — Stage 0 SIGNALs immediately.
    generateSql(inputCsv, outSql, '99');

    await expect(executeGeneratedSql(connection, readFileSync(outSql, 'utf8'))).rejects.toThrow(/Expected exactly one Census row/);

    expectCountsUnchanged(await captureDestinationCounts(connection), before);
  });

  it('Scenario 8 — rollback on already-loaded census without --allow-reload', async () => {
    // First load: populate census 1 successfully.
    const tmpFirst = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-f8a-'));
    const firstCsv = writeCsv(tmpFirst, ['1,1,FOO,A1,1,1,10,1.3,2024-01-01,']);
    const firstSql = path.join(tmpFirst, 'out.sql');
    generateSql(firstCsv, firstSql, TEST_CENSUS_NUMBER);
    await executeGeneratedSql(connection, readFileSync(firstSql, 'utf8'));

    // Capture post-first-load counts — these are what the rolled-back retry must preserve.
    const afterFirstLoad = await captureDestinationCounts(connection);
    expect(afterFirstLoad.dbh).toBe(1);

    // Second load (same census, no --allow-reload) must SIGNAL at Stage 0b.
    const tmpSecond = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-f8b-'));
    const secondCsv = writeCsv(tmpSecond, ['2,1,BAR,A1,2,2,12,1.3,2024-01-01,']);
    const secondSql = path.join(tmpSecond, 'out.sql');
    generateSql(secondCsv, secondSql, TEST_CENSUS_NUMBER);

    await expect(executeGeneratedSql(connection, readFileSync(secondSql, 'utf8'))).rejects.toThrow(/Census already loaded/);

    expectCountsUnchanged(await captureDestinationCounts(connection), afterFirstLoad);
  });

  it('Scenario 9 — --allow-reload replaces target-census rows and leaves other censuses intact', async () => {
    // Prior-census seed adds CensusID=2 + 3 trees/stems/DBH rows for CensusID=1.
    // We load CensusID=2 with one CSV, then reload with --allow-reload using a
    // different DBH value, and verify (a) the new value replaces the old,
    // (b) the other census's DBH rows are untouched.
    await loadSeedFile(connection, SEED_WITH_PRIORS_PATH);

    // Snapshot Census-1 DBH rows BEFORE the target-census load — these must
    // survive both the load and the reload byte-for-byte.
    const [census1Before] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT MeasureID, StemID, DBH, HOM, ExactDate FROM DBH WHERE CensusID = 1 ORDER BY StemID'
    );
    expect(census1Before.length).toBe(3);

    // First load into CensusID=2 — three O-rows reusing prior trees/stems.
    const tmpFirst = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-r9a-'));
    const firstCsv = writeCsv(tmpFirst, ['1,1,FOO,A1,1,1,11,1.3,2025-01-15,', '2,1,BAR,A1,2,2,19,2.0,2025-01-15,', '3,OLD,BAZ,A2,3,3,16,1.3,2025-01-15,']);
    const firstSql = path.join(tmpFirst, 'out.sql');
    generateSql(firstCsv, firstSql, TEST_CENSUS_NUMBER_2);
    await executeGeneratedSql(connection, readFileSync(firstSql, 'utf8'));

    expect(await countRows(connection, 'DBH', 'CensusID = 2')).toBe(3);
    const [firstDbhValues] = await connection.query<mysql.RowDataPacket[]>('SELECT StemID, DBH FROM DBH WHERE CensusID = 2 ORDER BY StemID');
    expect(firstDbhValues.map(r => Number(r.DBH))).toEqual([11, 19, 16]);

    // Reload CensusID=2 with --allow-reload and different DBH values.
    const tmpReload = mkdtempSync(path.join(os.tmpdir(), 'csv-v2-r9b-'));
    const reloadCsv = writeCsv(tmpReload, ['1,1,FOO,A1,1,1,99,1.3,2025-01-15,', '2,1,BAR,A1,2,2,88,2.0,2025-01-15,', '3,OLD,BAZ,A2,3,3,77,1.3,2025-01-15,']);
    const reloadSql = path.join(tmpReload, 'out.sql');
    generateSqlWithReload(reloadCsv, reloadSql, TEST_CENSUS_NUMBER_2);

    await executeGeneratedSql(connection, readFileSync(reloadSql, 'utf8'));

    // Target census shows replaced — not merged — values.
    expect(await countRows(connection, 'DBH', 'CensusID = 2')).toBe(3);
    const [reloadDbhValues] = await connection.query<mysql.RowDataPacket[]>('SELECT StemID, DBH FROM DBH WHERE CensusID = 2 ORDER BY StemID');
    expect(reloadDbhValues.map(r => Number(r.DBH))).toEqual([99, 88, 77]);

    // Old DBH values for CensusID=2 are gone (not merged in alongside the new ones).
    const [staleRows] = await connection.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM DBH WHERE CensusID = 2 AND DBH IN (11, 19, 16)');
    expect(Number(staleRows[0].n)).toBe(0);

    // Unrelated census DBH rows must be byte-for-byte unchanged.
    const [census1After] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT MeasureID, StemID, DBH, HOM, ExactDate FROM DBH WHERE CensusID = 1 ORDER BY StemID'
    );
    expect(census1After.length).toBe(3);
    for (let i = 0; i < census1Before.length; i++) {
      expect(census1After[i].StemID).toBe(census1Before[i].StemID);
      expect(Number(census1After[i].DBH)).toBeCloseTo(Number(census1Before[i].DBH), 5);
      expect(String(census1After[i].HOM)).toBe(String(census1Before[i].HOM));
    }

    // Tree count is preserved (reload deletes orphaned trees but every prior
    // tree still has the reloaded stem attached, so none should be orphaned).
    expect(await countRows(connection, 'Tree')).toBe(3);
    expect(await countRows(connection, 'Stem')).toBe(3);
  });
});
