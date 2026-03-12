/**
 * Seed Rabi plot metadata into the forestgeo_testing_mason schema on Azure MySQL.
 *
 * This loads the extracted rabi-seed-data.sql (plots, quadrats, species chain,
 * attributes, personnel, roles) into the testing schema so you can manually
 * upload census data through the app.
 *
 * Usage:
 *   cd frontend && npx tsx tests/setup/seed-rabi-metadata-to-testing.ts
 *
 * Prerequisites:
 *   - rabi-seed-data.sql exists (run extract-rabi-metadata.ts first)
 *   - .env.local has AZURE_SQL_USER, AZURE_SQL_PASSWORD, AZURE_SQL_SERVER
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const TARGET_SCHEMA = 'forestgeo_testing_mason';
const SEED_FILE = path.join(__dirname, 'rabi-seed-data.sql');

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(__dirname, '../../.env.local'));

// Tables to clear before seeding (in FK-safe order, leaf tables first)
const TABLES_TO_CLEAR = [
  'specieslimits',
  'censusactivepersonnel',
  'personnel',
  'roles',
  'census',
  'quadrats',
  'plots',
  'species',
  'genus',
  'family',
  'reference',
  'attributes'
];

async function main() {
  const host = process.env.AZURE_SQL_SERVER;
  const user = process.env.AZURE_SQL_USER;
  const password = process.env.AZURE_SQL_PASSWORD;
  const port = parseInt(process.env.AZURE_SQL_PORT || '3306');

  if (!host || !user || !password) {
    console.error('Missing env vars: AZURE_SQL_SERVER, AZURE_SQL_USER, AZURE_SQL_PASSWORD');
    process.exit(1);
  }

  if (!fs.existsSync(SEED_FILE)) {
    console.error(`Seed file not found: ${SEED_FILE}`);
    console.error('Run first: npx tsx tests/setup/extract-rabi-metadata.ts');
    process.exit(1);
  }

  console.log(`Connecting to ${host}:${port} as ${user}...`);
  console.log(`Target schema: ${TARGET_SCHEMA}`);

  const conn = await mysql.createConnection({
    host,
    user,
    password,
    port,
    database: TARGET_SCHEMA,
    ssl: { rejectUnauthorized: false },
    multipleStatements: false
  });

  // Check current state
  const [existingPlots] = await conn.query<mysql.RowDataPacket[]>('SELECT PlotID, PlotName FROM plots');
  const [existingSpecies] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as cnt FROM species');
  const [existingQuadrats] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as cnt FROM quadrats');

  console.log(`\nCurrent state of ${TARGET_SCHEMA}:`);
  console.log(`  Plots: ${existingPlots.map((p: any) => `${p.PlotName} (ID: ${p.PlotID})`).join(', ') || 'none'}`);
  console.log(`  Species: ${existingSpecies[0].cnt}`);
  console.log(`  Quadrats: ${existingQuadrats[0].cnt}`);

  // Check for measurement data that would block clearing
  const [measurementCount] = await conn.query<mysql.RowDataPacket[]>(
    'SELECT COUNT(*) as cnt FROM coremeasurements'
  );
  const [treeCount] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as cnt FROM trees');
  const [stemCount] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as cnt FROM stems');

  if (Number(measurementCount[0].cnt) > 0 || Number(treeCount[0].cnt) > 0 || Number(stemCount[0].cnt) > 0) {
    console.log(`\n  WARNING: Schema has existing measurement data:`);
    console.log(`    Trees: ${treeCount[0].cnt}, Stems: ${stemCount[0].cnt}, Measurements: ${measurementCount[0].cnt}`);
    console.log(`  These reference species/quadrats and must be cleared first.`);
    console.log(`  Clearing measurement tables before seeding metadata...`);

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of ['measurement_error_log', 'cmattributes', 'coremeasurements', 'stems', 'trees',
                          'temporarymeasurements', 'failedmeasurements', 'uploadmetrics', 'uploadintegrityalerts']) {
      try {
        const [result] = await conn.query<mysql.ResultSetHeader>(`DELETE FROM ${table}`);
        if (result.affectedRows > 0) {
          console.log(`    Cleared ${table}: ${result.affectedRows} rows`);
        }
      } catch {
        // Table may not exist
      }
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  }

  // Clear metadata tables
  console.log(`\nClearing metadata tables...`);
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of TABLES_TO_CLEAR) {
    try {
      const [result] = await conn.query<mysql.ResultSetHeader>(`DELETE FROM ${table}`);
      if (result.affectedRows > 0) {
        console.log(`  Cleared ${table}: ${result.affectedRows} rows`);
      }
    } catch (err: any) {
      console.warn(`  Warning clearing ${table}: ${err.message.substring(0, 80)}`);
    }
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');

  // Load seed data
  console.log(`\nLoading Rabi seed data...`);
  const content = fs.readFileSync(SEED_FILE, 'utf-8');
  const lines = content.split('\n');

  let insertCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;
    if (!trimmed.endsWith(';')) continue;

    try {
      await conn.query(trimmed);
      if (trimmed.toUpperCase().startsWith('INSERT')) {
        insertCount++;
      }
    } catch (err: any) {
      const isDuplicate = err.message.includes('Duplicate');
      if (!isDuplicate) {
        errorCount++;
        if (errors.length < 5) {
          errors.push(err.message.substring(0, 120));
        }
      }
    }
  }

  // Verify final state
  const [finalPlots] = await conn.query<mysql.RowDataPacket[]>('SELECT PlotID, PlotName FROM plots');
  const [finalSpecies] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as cnt FROM species');
  const [finalQuadrats] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as cnt FROM quadrats');
  const [finalCensus] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as cnt FROM census');
  const [finalAttrs] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as cnt FROM attributes');
  const [finalPersonnel] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as cnt FROM personnel');
  const [finalFamily] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as cnt FROM family');
  const [finalGenus] = await conn.query<mysql.RowDataPacket[]>('SELECT COUNT(*) as cnt FROM genus');

  console.log(`\nSeeding complete: ${insertCount} rows inserted${errorCount > 0 ? ` (${errorCount} errors)` : ''}`);
  if (errors.length > 0) {
    console.log(`\nErrors:`);
    errors.forEach(e => console.log(`  ${e}`));
  }

  console.log(`\nFinal state of ${TARGET_SCHEMA}:`);
  console.log(`  Plots: ${finalPlots.map((p: any) => `${p.PlotName} (ID: ${p.PlotID})`).join(', ')}`);
  console.log(`  Families: ${finalFamily[0].cnt}`);
  console.log(`  Genera: ${finalGenus[0].cnt}`);
  console.log(`  Species: ${finalSpecies[0].cnt}`);
  console.log(`  Quadrats: ${finalQuadrats[0].cnt}`);
  console.log(`  Census: ${finalCensus[0].cnt}`);
  console.log(`  Attributes: ${finalAttrs[0].cnt}`);
  console.log(`  Personnel: ${finalPersonnel[0].cnt}`);
  console.log(`\nYou can now create censuses and upload data through the app.`);

  await conn.end();
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
