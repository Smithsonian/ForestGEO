/**
 * Bulk Ingestion Performance Benchmark
 *
 * Measures the stored-procedure ingest path (stage -> bulkingestionprocess -> bulkingestioncollapser)
 * for a second census of varying sizes, after preloading a first census.
 *
 * Usage:
 *   cd frontend
 *   npx tsx tests/benchmarks/ingest-benchmark.ts [rowCount]
 *
 * Requires: local MySQL via docker compose (port 3306, root/testpassword)
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DB_CONFIG = {
  host: process.env.TEST_DB_HOST || 'localhost',
  port: Number(process.env.TEST_DB_PORT || 3306),
  user: process.env.TEST_DB_USER || 'root',
  password: process.env.TEST_DB_PASSWORD || 'testpassword',
  multipleStatements: true
};

const SPECIES_CODES = ['ACERRU', 'QUERCO', 'PINUST', 'FAGUGR', 'BETUAL', 'TILIAA', 'FRAXAM', 'ULMUSA', 'CARYAG', 'LIQUIS'];
const QUADRAT_COUNT = 100;
const BULK_INSERT_CHUNK = 1000;

// ---------------------------------------------------------------------------
// Schema / stored procedure loading (mirrors local-db-setup.ts)
// ---------------------------------------------------------------------------

async function loadSchema(conn: mysql.Connection): Promise<void> {
  const schemaPath = path.join(process.cwd(), 'sqlscripting', 'tablestructures.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const stmt of schema.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'))) {
    try {
      await conn.query(stmt);
    } catch (err: any) {
      if (!err.message.includes("doesn't exist") && !err.message.includes('already exists')) {
        throw err;
      }
    }
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
}

async function loadStoredProcedures(conn: mysql.Connection): Promise<void> {
  const procPath = path.join(process.cwd(), 'sqlscripting', 'storedprocedures.sql');
  const content = fs.readFileSync(procPath, 'utf-8')
    .replace(/DELIMITER\s+\$\$/gi, '')
    .replace(/DELIMITER\s+;/gi, '');

  for (const stmt of content.split('$$').map(s => s.trim()).filter(s => s.length >= 10)) {
    const cleaned = stmt.replace(/definer\s*=\s*`?[^`\s]+`?@`?[^`\s]+`?\s*/gi, '');
    try {
      await conn.query(cleaned);
    } catch (err: any) {
      if (!err.message.includes('already exists') && !err.message.includes('does not exist')) {
        console.error(`  proc load error: ${err.message.substring(0, 120)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

interface SeedMeta {
  plotID: number;
  census1ID: number;
  census2ID: number;
  speciesByCode: Record<string, number>;
  quadratByName: Record<string, number>;
  quadratNames: string[];
}

async function seedBaseData(conn: mysql.Connection): Promise<SeedMeta> {
  // Species
  for (const code of SPECIES_CODES) {
    await conn.query(
      `INSERT INTO species (SpeciesCode, SpeciesName, IDLevel, IsActive)
       VALUES (?, ?, 'species', 1)
       ON DUPLICATE KEY UPDATE SpeciesName = VALUES(SpeciesName)`,
      [code, `${code} species`]
    );
  }

  // Attributes
  await conn.query(
    `INSERT INTO attributes (Code, Description, Status, IsActive)
     VALUES ('A','Alive','alive',1) ON DUPLICATE KEY UPDATE Description = VALUES(Description)`
  );

  // Plot
  await conn.query(
    `INSERT INTO plots (PlotName, LocationName, CountryName, DimensionX, DimensionY, Area,
       GlobalX, GlobalY, GlobalZ, PlotShape, PlotDescription)
     VALUES ('Benchmark Plot','Benchmark','Panama',1000,1000,100000,0,0,0,'square','Benchmark')`
  );
  const [[plotRow]] = await conn.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() AS PlotID');
  const plotID = plotRow.PlotID;

  // Quadrats
  const quadratNames: string[] = [];
  for (let i = 0; i < QUADRAT_COUNT; i++) {
    const name = `Q${String(i + 1).padStart(3, '0')}`;
    quadratNames.push(name);
    await conn.query(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape)
       VALUES (?, ?, ?, ?, 10, 10, 100, 'square')`,
      [plotID, name, (i % 10) * 10, Math.floor(i / 10) * 10]
    );
  }

  // Census 1 & 2
  await conn.query(`INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive) VALUES (?,1,'2024-01-01','2024-12-31',1)`, [plotID]);
  const [[c1]] = await conn.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() AS CensusID');
  await conn.query(`INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive) VALUES (?,2,'2025-01-01','2025-12-31',1)`, [plotID]);
  const [[c2]] = await conn.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() AS CensusID');

  // Lookup maps
  const [speciesRows] = await conn.query<mysql.RowDataPacket[]>('SELECT SpeciesID, SpeciesCode FROM species WHERE SpeciesCode IN (?)', [SPECIES_CODES]);
  const [quadratRows] = await conn.query<mysql.RowDataPacket[]>('SELECT QuadratID, QuadratName FROM quadrats WHERE PlotID = ?', [plotID]);

  return {
    plotID,
    census1ID: c1.CensusID,
    census2ID: c2.CensusID,
    speciesByCode: Object.fromEntries(speciesRows.map((r: any) => [r.SpeciesCode, r.SpeciesID])),
    quadratByName: Object.fromEntries(quadratRows.map((r: any) => [r.QuadratName, r.QuadratID])),
    quadratNames
  };
}

interface MeasurementRow {
  treeTag: string;
  stemTag: string;
  speciesCode: string;
  quadratName: string;
  x: number;
  y: number;
  dbh: number;
  hom: number;
  date: string;
  codes: string;
}

function generateMeasurements(rowCount: number, quadratNames: string[], censusNum: number): MeasurementRow[] {
  const date = censusNum === 1 ? '2024-06-15' : '2025-06-15';
  const rows: MeasurementRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    const base = i % QUADRAT_COUNT;
    rows.push({
      treeTag: `TREE${String(i + 1).padStart(6, '0')}`,
      stemTag: '1',
      speciesCode: SPECIES_CODES[i % SPECIES_CODES.length],
      quadratName: quadratNames[i % quadratNames.length],
      x: Number(((base % 10) + 0.25).toFixed(2)),
      y: Number((Math.floor(base / 10) + 0.25).toFixed(2)),
      dbh: Number((10 + (i % 50) * 0.1 + (censusNum === 2 ? 0.5 : 0)).toFixed(2)),
      hom: 1.3,
      date,
      codes: 'A'
    });
  }
  return rows;
}

/**
 * Directly insert first-census data (trees + stems + coremeasurements)
 * bypassing the stored procedure for speed.
 */
async function seedFirstCensus(conn: mysql.Connection, meta: SeedMeta, rows: MeasurementRow[]): Promise<void> {
  // Trees
  for (let start = 0; start < rows.length; start += BULK_INSERT_CHUNK) {
    const chunk = rows.slice(start, start + BULK_INSERT_CHUNK);
    const values: any[] = [];
    const placeholders = chunk.map(m => {
      values.push(m.treeTag, meta.speciesByCode[m.speciesCode], meta.census1ID);
      return '(?, ?, ?, 1)';
    }).join(',');
    await conn.query(`INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES ${placeholders}`, values);
  }

  // Tree lookup
  const [treeRows] = await conn.query<mysql.RowDataPacket[]>('SELECT TreeID, TreeTag FROM trees WHERE CensusID = ?', [meta.census1ID]);
  const treeByTag: Record<string, number> = {};
  for (const r of treeRows as any[]) treeByTag[r.TreeTag] = r.TreeID;

  // Stems
  for (let start = 0; start < rows.length; start += BULK_INSERT_CHUNK) {
    const chunk = rows.slice(start, start + BULK_INSERT_CHUNK);
    const values: any[] = [];
    const placeholders = chunk.map(m => {
      values.push(treeByTag[m.treeTag], meta.quadratByName[m.quadratName], meta.census1ID, m.stemTag, m.x, m.y);
      return '(?, ?, ?, ?, ?, ?, 1)';
    }).join(',');
    await conn.query(`INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive) VALUES ${placeholders}`, values);
  }

  // Stem lookup
  const [stemRows] = await conn.query<mysql.RowDataPacket[]>(
    'SELECT s.StemGUID, t.TreeTag FROM stems s JOIN trees t ON t.TreeID = s.TreeID WHERE s.CensusID = ?',
    [meta.census1ID]
  );
  const stemByTag: Record<string, number> = {};
  for (const r of stemRows as any[]) stemByTag[r.TreeTag] = r.StemGUID;

  // CoreMeasurements
  for (let start = 0; start < rows.length; start += BULK_INSERT_CHUNK) {
    const chunk = rows.slice(start, start + BULK_INSERT_CHUNK);
    const values: any[] = [];
    const placeholders = chunk.map(m => {
      values.push(stemByTag[m.treeTag], meta.census1ID, m.dbh, m.hom, m.date);
      return '(?, ?, ?, ?, ?, 1, 1)';
    }).join(',');
    await conn.query(
      `INSERT INTO coremeasurements (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
       VALUES ${placeholders}`,
      values
    );
  }
}

/**
 * Stage second-census rows into temporarymeasurements.
 */
async function stageSecondCensus(
  conn: mysql.Connection,
  meta: SeedMeta,
  rows: MeasurementRow[],
  fileID: string,
  batchID: string
): Promise<void> {
  for (let start = 0; start < rows.length; start += BULK_INSERT_CHUNK) {
    const chunk = rows.slice(start, start + BULK_INSERT_CHUNK);
    const values: any[] = [];
    const placeholders = chunk.map(m => {
      values.push(fileID, batchID, meta.plotID, meta.census2ID,
        m.treeTag, m.stemTag, m.speciesCode, m.quadratName,
        m.x, m.y, m.dbh, m.hom, m.date, m.codes, null);
      return '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    }).join(',');
    await conn.query(
      `INSERT INTO temporarymeasurements
       (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName,
        LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
       VALUES ${placeholders}`,
      values
    );
  }
}

// ---------------------------------------------------------------------------
// Timing helper
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`;
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

interface BenchmarkResult {
  rowCount: number;
  seedMs: number;
  stageMs: number;
  ingestMs: number;
  collapserMs: number;
  totalMs: number;
  insertedRows: number;
}

async function runBenchmark(rowCount: number): Promise<BenchmarkResult> {
  const dbName = `bench_ingest_${rowCount}_${Date.now()}`;
  const conn = await mysql.createConnection({ ...DB_CONFIG, database: undefined });

  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await conn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await conn.query(`USE \`${dbName}\``);

    console.log(`\n--- ${rowCount} rows ---`);
    console.log(`  loading schema + procs...`);
    await loadSchema(conn);
    await loadStoredProcedures(conn);

    // Seed measurement_errors for ingestion error tracking
    await conn.query(
      `INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
       VALUES ('ingestion', 'SQL_EXCEPTION', 'Ingestion SQL exception'),
              ('ingestion', 'EARLY_VALIDATION', 'Early validation failure'),
              ('ingestion', 'DUPLICATE', 'Duplicate row'),
              ('ingestion', 'SPECIES_MISMATCH', 'Species mismatch with prior census'),
              ('ingestion', 'QUADRAT_MISMATCH', 'Quadrat mismatch'),
              ('ingestion', 'COORDINATE_DRIFT', 'Coordinate drift')`
    );

    const meta = await seedBaseData(conn);

    // Seed first census
    console.log(`  seeding first census (${rowCount} rows)...`);
    const seedStart = Date.now();
    const census1Rows = generateMeasurements(rowCount, meta.quadratNames, 1);
    await seedFirstCensus(conn, meta, census1Rows);
    const seedMs = Date.now() - seedStart;
    console.log(`  first census seeded in ${formatDuration(seedMs)}`);

    // Stage second census
    const fileID = `benchmark_${rowCount}.csv`;
    const batchID = `batch_001`;
    console.log(`  staging second census...`);
    const stageStart = Date.now();
    const census2Rows = generateMeasurements(rowCount, meta.quadratNames, 2);
    await stageSecondCensus(conn, meta, census2Rows, fileID, batchID);
    const stageMs = Date.now() - stageStart;
    console.log(`  staged in ${formatDuration(stageMs)}`);

    // Run bulkingestionprocess
    console.log(`  running bulkingestionprocess...`);
    const ingestStart = Date.now();
    const [ingestResult] = await conn.query<mysql.RowDataPacket[]>('CALL bulkingestionprocess(?, ?)', [fileID, batchID]);
    const ingestMs = Date.now() - ingestStart;
    // Extract message from result (procedure returns a SELECT)
    const resultSets = ingestResult as any;
    const message = Array.isArray(resultSets) && resultSets.length > 0
      ? (resultSets[resultSets.length - 1]?.[0]?.message || 'no message')
      : 'no message';
    console.log(`  bulkingestionprocess: ${formatDuration(ingestMs)} - ${message}`);

    // Run bulkingestioncollapser
    console.log(`  running bulkingestioncollapser...`);
    const collapserStart = Date.now();
    await conn.query('CALL bulkingestioncollapser(?)', [meta.census2ID]);
    const collapserMs = Date.now() - collapserStart;
    console.log(`  bulkingestioncollapser: ${formatDuration(collapserMs)}`);

    // Verify
    const [[countRow]] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS cnt FROM coremeasurements WHERE CensusID = ? AND StemGUID IS NOT NULL',
      [meta.census2ID]
    );
    const insertedRows = countRow.cnt;
    console.log(`  result: ${insertedRows}/${rowCount} rows ingested`);

    const totalMs = stageMs + ingestMs + collapserMs;
    console.log(`  TOTAL (stage+ingest+collapser): ${formatDuration(totalMs)}`);

    return { rowCount, seedMs, stageMs, ingestMs, collapserMs, totalMs, insertedRows };
  } finally {
    try {
      await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    } catch { /* ignore */ }
    await conn.end();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const requestedSize = parseInt(process.argv[2] || '0', 10);
  const sizes = requestedSize > 0 ? [requestedSize] : [2000, 10000];

  console.log('=== Bulk Ingestion Benchmark ===');
  console.log(`MySQL: ${DB_CONFIG.host}:${DB_CONFIG.port}`);
  console.log(`Stored procedures from: sqlscripting/storedprocedures.sql`);
  console.log(`Sizes: ${sizes.join(', ')} rows`);

  const results: BenchmarkResult[] = [];

  for (const size of sizes) {
    results.push(await runBenchmark(size));
  }

  // Summary table
  console.log('\n=== Summary ===');
  console.log('Rows     | Stage      | Ingest     | Collapser  | Total      | Ingested');
  console.log('---------|------------|------------|------------|------------|--------');
  for (const r of results) {
    console.log(
      `${String(r.rowCount).padEnd(9)}| ` +
      `${formatDuration(r.stageMs).padEnd(11)}| ` +
      `${formatDuration(r.ingestMs).padEnd(11)}| ` +
      `${formatDuration(r.collapserMs).padEnd(11)}| ` +
      `${formatDuration(r.totalMs).padEnd(11)}| ` +
      `${r.insertedRows}/${r.rowCount}`
    );
  }

  // Extrapolation for 100k if we have 2 data points
  if (results.length >= 2) {
    const r1 = results[0];
    const r2 = results[1];
    // Use power-law extrapolation: time = a * rows^b
    const b = Math.log(r2.ingestMs / r1.ingestMs) / Math.log(r2.rowCount / r1.rowCount);
    const a = r1.ingestMs / Math.pow(r1.rowCount, b);
    const extrapolated100k = a * Math.pow(100000, b);
    console.log(`\nScaling exponent (ingest): b = ${b.toFixed(2)} (1.0 = linear, 2.0 = quadratic)`);
    console.log(`Extrapolated 100k ingest time: ~${formatDuration(extrapolated100k)}`);
  }
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
