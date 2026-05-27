/**
 * Seed SERC Metadata into a ForestGEO Schema
 *
 * Populates the reference/metadata tables needed to upload SERC census CSV files.
 * Reads species, quadrats, and attributes from exported CSV files.
 *
 * Usage:
 *   AZURE_SQL_PASSWORD=xxx npx tsx scripts/seed-serc-metadata.ts <schema_name>
 *
 * Environment variables:
 *   AZURE_SQL_PASSWORD  - MySQL password (required)
 *   DB_HOST             - MySQL host (default: forestgeo-mysqldataserver.mysql.database.azure.com)
 *   DB_USER             - MySQL user (default: azureroot)
 *   DB_PORT             - MySQL port (default: 3306)
 *   SERC_DATA_DIR       - Path to SERC CSV exports (default: ~/Documents/fgeo_sample_data/SERC)
 */

import mysql, { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const SCHEMA = process.argv[2];

if (!SCHEMA) {
  console.error('Usage: npx tsx scripts/seed-serc-metadata.ts <schema_name>');
  console.error('Example: npx tsx scripts/seed-serc-metadata.ts forestgeo_testing_mason');
  process.exit(1);
}

const DB_HOST = process.env.DB_HOST || 'forestgeo-mysqldataserver.mysql.database.azure.com';
const DB_USER = process.env.DB_USER || 'azureroot';
const DB_PORT = parseInt(process.env.DB_PORT || '3306', 10);
const DB_PASSWORD = process.env.AZURE_SQL_PASSWORD;

if (!DB_PASSWORD) {
  console.error('Error: AZURE_SQL_PASSWORD environment variable is required');
  process.exit(1);
}

const SERC_DATA_DIR = process.env.SERC_DATA_DIR || path.join(os.homedir(), 'Documents', 'fgeo_sample_data', 'SERC');

// ---------------------------------------------------------------------------
// CSV parsing (minimal, no external deps)
// ---------------------------------------------------------------------------
function parseCSV(filePath: string): Record<string, string>[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(line => line.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h.trim().toLowerCase()] = (values[i] || '').trim();
    });
    return row;
  });
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// Seed functions
// ---------------------------------------------------------------------------

async function seedPlot(conn: mysql.Connection): Promise<number> {
  console.log('  Seeding plot...');

  await conn.execute(
    `INSERT INTO plots (PlotName, LocationName, CountryName, DimensionX, DimensionY, Area,
                        GlobalX, GlobalY, GlobalZ, PlotShape, PlotDescription,
                        DefaultDimensionUnits, DefaultCoordinateUnits, DefaultAreaUnits,
                        DefaultDBHUnits, DefaultHOMUnits)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE PlotName = PlotName`,
    [
      'SERC',
      'Smithsonian Environmental Research Center',
      'USA',
      400,
      400,
      160000,
      -76.56,
      38.89,
      10,
      'square',
      'SERC ForestGEO permanent plot - 16ha',
      'm',
      'm',
      'm2',
      'mm',
      'm'
    ]
  );

  const [rows] = await conn.execute<RowDataPacket[]>(`SELECT PlotID FROM plots WHERE PlotName = 'SERC' LIMIT 1`);
  const plotID = rows[0].PlotID;
  console.log(`    PlotID = ${plotID}`);
  return plotID;
}

interface CensusIDs {
  census1: number;
  census2: number;
  census3: number;
  census4: number;
}

async function seedCensuses(conn: mysql.Connection, plotID: number): Promise<CensusIDs> {
  console.log('  Seeding censuses...');

  const censusData = [
    { num: 1, start: '2008-01-01', end: '2011-12-31', desc: 'SERC Census 1' },
    { num: 2, start: '2013-01-01', end: '2016-12-31', desc: 'SERC Census 2' },
    { num: 3, start: '2018-01-01', end: '2021-12-31', desc: 'SERC Census 3' },
    { num: 4, start: '2023-01-01', end: '2026-12-31', desc: 'SERC Census 4' }
  ];

  for (const c of censusData) {
    await conn.execute(
      `INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, Description)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE Description = VALUES(Description)`,
      [plotID, c.num, c.start, c.end, c.desc]
    );
  }

  const ids: Record<string, number> = {};
  for (const c of censusData) {
    const [rows] = await conn.execute<RowDataPacket[]>(`SELECT CensusID FROM census WHERE PlotID = ? AND PlotCensusNumber = ? LIMIT 1`, [plotID, c.num]);
    ids[`census${c.num}`] = rows[0].CensusID;
  }

  console.log(`    CensusIDs: ${Object.values(ids).join(', ')}`);
  return ids as unknown as CensusIDs;
}

async function seedPersonnel(conn: mysql.Connection, censusIDs: CensusIDs): Promise<void> {
  console.log('  Seeding roles & personnel...');

  await conn.execute(
    `INSERT INTO roles (RoleName, RoleDescription)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE RoleName = RoleName`,
    ['Field Technician', 'Collects field measurements']
  );

  const [roleRows] = await conn.execute<RowDataPacket[]>(`SELECT RoleID FROM roles WHERE RoleName = 'Field Technician' LIMIT 1`);
  const roleID = roleRows[0].RoleID;

  await conn.execute(
    `INSERT INTO personnel (FirstName, LastName, RoleID)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE FirstName = FirstName`,
    ['Test', 'User', roleID]
  );

  const [persRows] = await conn.execute<RowDataPacket[]>(`SELECT PersonnelID FROM personnel WHERE FirstName = 'Test' AND LastName = 'User' LIMIT 1`);
  const personnelID = persRows[0].PersonnelID;

  for (const censusID of Object.values(censusIDs)) {
    await conn.execute(`INSERT IGNORE INTO censusactivepersonnel (PersonnelID, CensusID) VALUES (?, ?)`, [personnelID, censusID]);
  }
  console.log('    Done.');
}

async function seedAttributes(conn: mysql.Connection): Promise<number> {
  console.log('  Seeding attributes...');

  const csvPath = path.join(SERC_DATA_DIR, 'attributesform_forestgeo_serc_serc_1.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Attributes CSV not found: ${csvPath}`);
  }

  const rows = parseCSV(csvPath);

  for (const r of rows) {
    await conn.execute(
      `INSERT INTO attributes (Code, Description, Status)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE Description = VALUES(Description), Status = VALUES(Status)`,
      [r.code, r.description || null, r.status || null]
    );
  }

  console.log(`    ${rows.length} attribute codes processed.`);
  return rows.length;
}

async function seedSpecies(conn: mysql.Connection): Promise<number> {
  console.log('  Seeding families, genera, and species...');

  const csvPath = path.join(SERC_DATA_DIR, 'speciesform_forestgeo_serc_serc_1.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Species CSV not found: ${csvPath}`);
  }

  const rows = parseCSV(csvPath);

  // Step 1: Insert unique families
  const families = [...new Set(rows.map(r => r.family).filter(Boolean))];
  for (const fam of families) {
    await conn.execute(`INSERT INTO family (Family) VALUES (?) ON DUPLICATE KEY UPDATE Family = Family`, [fam]);
  }
  console.log(`    ${families.length} families.`);

  // Step 2: Insert unique genera (linked to families)
  const seenGenera = new Set<string>();
  for (const r of rows) {
    const genusKey = `${r.genus}|${r.family}`;
    if (!r.genus || !r.family || seenGenera.has(genusKey)) continue;
    seenGenera.add(genusKey);

    const [famRows] = await conn.execute<RowDataPacket[]>(`SELECT FamilyID FROM family WHERE Family = ? LIMIT 1`, [r.family]);
    if (famRows.length === 0) continue;

    await conn.execute(
      `INSERT INTO genus (FamilyID, Genus, GenusAuthority)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE GenusAuthority = VALUES(GenusAuthority)`,
      [famRows[0].FamilyID, r.genus, r.authority || null]
    );
  }
  console.log(`    ${seenGenera.size} genera.`);

  // Step 3: Insert species (linked to genera)
  let speciesCount = 0;
  for (const r of rows) {
    if (!r.spcode || !r.genus) continue;

    const [genRows] = await conn.execute<RowDataPacket[]>(`SELECT GenusID FROM genus WHERE Genus = ? LIMIT 1`, [r.genus]);
    if (genRows.length === 0) {
      console.warn(`    Warning: genus not found for ${r.spcode} (${r.genus}), skipping.`);
      continue;
    }

    const speciesName = r.species ? `${r.genus} ${r.species}` : r.genus;

    await conn.execute(
      `INSERT INTO species (GenusID, SpeciesCode, SpeciesName, SubspeciesName, IDLevel,
                            SpeciesAuthority, SubspeciesAuthority)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE SpeciesAuthority = VALUES(SpeciesAuthority)`,
      [genRows[0].GenusID, r.spcode, speciesName, r.subspecies || null, r.idlevel || 'species', r.authority || null, r.subspeciesauthority || null]
    );
    speciesCount++;
  }

  console.log(`    ${speciesCount} species.`);
  return speciesCount;
}

async function seedQuadrats(conn: mysql.Connection, plotID: number): Promise<number> {
  console.log('  Seeding quadrats...');

  const csvPath = path.join(SERC_DATA_DIR, 'quadratsform_forestgeo_serc_serc_1.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Quadrats CSV not found: ${csvPath}`);
  }

  const rows = parseCSV(csvPath);
  console.log(`    Parsed ${rows.length} quadrats from CSV.`);

  const BATCH_SIZE = 100;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(',');
    const values = batch.flatMap(r => [
      plotID,
      r.quadrat,
      parseFloat(r.startx) || 0,
      parseFloat(r.starty) || 0,
      parseInt(r.dimx) || 10,
      parseInt(r.dimy) || 10,
      parseFloat(r.area) || 100,
      r.quadratshape || null
    ]);

    await conn.execute<ResultSetHeader>(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE StartX = VALUES(StartX), StartY = VALUES(StartY)`,
      values
    );

    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= rows.length) {
      console.log(`    ... ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length}`);
    }
  }

  console.log(`    ${rows.length} quadrats processed.`);
  return rows.length;
}

async function seedMeasurementErrors(conn: mysql.Connection): Promise<void> {
  console.log('  Seeding measurement error catalog...');

  // Check if table exists (only on unified-measurements branch)
  const [tables] = await conn.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'measurement_errors'`,
    [SCHEMA]
  );

  if (tables[0].cnt === 0) {
    console.log('    measurement_errors table not found (pre-migration schema). Skipping.');
    return;
  }

  const errors = [
    ['ingestion', 'MISSING_FIELD_TREETAG', 'Missing required field: TreeTag'],
    ['ingestion', 'MISSING_FIELD_STEMTAG', 'Missing required field: StemTag'],
    ['ingestion', 'MISSING_FIELD_SPECIESCODE', 'Missing required field: SpeciesCode'],
    ['ingestion', 'MISSING_FIELD_QUADRATNAME', 'Missing required field: QuadratName'],
    ['ingestion', 'MISSING_FIELD_DATE', 'Missing required field: MeasurementDate'],
    ['ingestion', 'INVALID_QUADRAT', 'Invalid quadrat reference'],
    ['ingestion', 'INVALID_SPECIES', 'Invalid species reference'],
    ['ingestion', 'DUPLICATE_ENTRY', 'Duplicate measurement row detected'],
    ['ingestion', 'NEGATIVE_DBH', 'DBH must be non-negative'],
    ['ingestion', 'NEGATIVE_HOM', 'HOM must be non-negative'],
    ['ingestion', 'INVALID_COORDINATE', 'Coordinate value is negative'],
    ['ingestion', 'FIELD_TOO_LONG', 'One or more fields exceed column length limits'],
    ['ingestion', 'MISSING_MEASUREMENT_DATA', 'Missing measurement data'],
    ['ingestion', 'QUADRAT_MISMATCH', 'Quadrat mismatch across censuses'],
    ['ingestion', 'COORDINATE_DRIFT', 'Coordinate drift exceeds allowed threshold'],
    ['ingestion', 'SQL_EXCEPTION', 'Ingestion SQL exception']
  ];

  for (const [source, code, message] of errors) {
    await conn.execute(
      `INSERT INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE ErrorMessage = VALUES(ErrorMessage)`,
      [source, code, message]
    );
  }

  console.log(`    ${errors.length} error codes seeded.`);
}

async function seedValidations(conn: mysql.Connection): Promise<void> {
  console.log('  Checking validation definitions...');

  const [rows] = await conn.execute<RowDataPacket[]>(`SELECT COUNT(*) as cnt FROM sitespecificvalidations`);

  if (rows[0].cnt > 0) {
    console.log(`    ${rows[0].cnt} validations already present. Skipping.`);
    console.log('    Run "npm run deploy:validations" to update them from corequeries.sql.');
    return;
  }

  // Load from corequeries.sql
  const coreQueriesPath = path.join(process.cwd(), 'sqlscripting', 'corequeries.sql');
  if (!fs.existsSync(coreQueriesPath)) {
    console.log('    corequeries.sql not found. Skipping validation seeding.');
    return;
  }

  console.log('    Loading validations from corequeries.sql...');
  const sqlContent = fs.readFileSync(coreQueriesPath, 'utf8');

  // Split on semicolons, execute each statement
  const statements = sqlContent
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    try {
      await conn.execute(stmt);
    } catch (err: any) {
      // Skip errors from statements that reference missing tables/schemas
      if (!err.message.includes('already exists')) {
        console.log(`    Warning: skipped statement (${err.message.slice(0, 80)})`);
      }
    }
  }

  const [after] = await conn.execute<RowDataPacket[]>(`SELECT COUNT(*) as cnt FROM sitespecificvalidations`);
  console.log(`    ${after[0].cnt} validations loaded.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nSERC Metadata Seed`);
  console.log(`${'='.repeat(50)}`);
  console.log(`Schema:  ${SCHEMA}`);
  console.log(`Host:    ${DB_HOST}:${DB_PORT}`);
  console.log(`User:    ${DB_USER}`);
  console.log(`Data:    ${SERC_DATA_DIR}`);
  console.log(`${'='.repeat(50)}\n`);

  // Verify data files exist
  const requiredFiles = ['speciesform_forestgeo_serc_serc_1.csv', 'quadratsform_forestgeo_serc_serc_1.csv', 'attributesform_forestgeo_serc_serc_1.csv'];

  for (const file of requiredFiles) {
    const fullPath = path.join(SERC_DATA_DIR, file);
    if (!fs.existsSync(fullPath)) {
      console.error(`Missing required file: ${fullPath}`);
      process.exit(1);
    }
  }
  console.log('All required CSV files found.\n');

  const conn = await mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    port: DB_PORT,
    database: SCHEMA,
    multipleStatements: false,
    ssl: DB_HOST.includes('azure') ? { rejectUnauthorized: true } : undefined
  });

  try {
    console.log('Connected to database.\n');

    const plotID = await seedPlot(conn);
    const censusIDs = await seedCensuses(conn, plotID);
    await seedPersonnel(conn, censusIDs);
    await seedAttributes(conn);
    await seedSpecies(conn);
    await seedQuadrats(conn, plotID);
    await seedMeasurementErrors(conn);
    await seedValidations(conn);

    // Print summary
    console.log(`\n${'='.repeat(50)}`);
    console.log('Seed complete! Summary:\n');

    const counts = [
      ['plots', `SELECT COUNT(*) as cnt FROM plots`],
      ['census', `SELECT COUNT(*) as cnt FROM census`],
      ['species', `SELECT COUNT(*) as cnt FROM species`],
      ['quadrats', `SELECT COUNT(*) as cnt FROM quadrats`],
      ['attributes', `SELECT COUNT(*) as cnt FROM attributes`],
      ['family', `SELECT COUNT(*) as cnt FROM family`],
      ['genus', `SELECT COUNT(*) as cnt FROM genus`],
      ['personnel', `SELECT COUNT(*) as cnt FROM personnel`]
    ];

    for (const [table, query] of counts) {
      const [rows] = await conn.execute<RowDataPacket[]>(query);
      console.log(`  ${table.padEnd(20)} ${rows[0].cnt} rows`);
    }

    console.log(`\nReady to upload SERC census CSVs via the UI.`);
    console.log(`  Census 1: SERC_census1_2025.csv`);
    console.log(`  Census 2: SERC_c2_no_priors.csv`);
    console.log(`  Census 3: SERC_c3_no_priors.csv`);
    console.log(`  Census 4: SERC_census4_2025(1).csv`);
  } finally {
    await conn.end();
    console.log('\nConnection closed.');
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
