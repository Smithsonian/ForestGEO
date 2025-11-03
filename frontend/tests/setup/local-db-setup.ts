/**
 * Local In-Memory Database Setup for E2E Testing
 *
 * This module provides a complete local database environment for testing:
 * - Creates test database schema
 * - Loads stored procedures
 * - Seeds with sample data from sampledata folder
 * - Supports running actual stored procedures
 * - Cleans up after tests
 *
 * Usage:
 *   import { setupTestDatabase, teardownTestDatabase } from '@/tests/setup/local-db-setup';
 *
 *   beforeAll(async () => {
 *     connection = await setupTestDatabase();
 *   });
 *
 *   afterAll(async () => {
 *     await teardownTestDatabase(connection);
 *   });
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Configuration
export interface TestDatabaseConfig {
  host: string;
  user: string;
  password: string;
  port: number;
  database: string;
  multipleStatements: boolean;
}

export interface TestData {
  sites: any[];
  plots: any[];
  census: any[];
  species: any[];
  quadrats: any[];
  attributes: any[];
}

// Default configuration for local testing
export const DEFAULT_TEST_CONFIG: TestDatabaseConfig = {
  host: process.env.TEST_DB_HOST || 'localhost',
  user: process.env.TEST_DB_USER || 'root',
  password: process.env.TEST_DB_PASSWORD || '',
  port: parseInt(process.env.TEST_DB_PORT || '3306'),
  database: `forestgeo_test_${process.env.VITEST_POOL_ID || 'default'}`,
  multipleStatements: true
};

/**
 * Creates a new test database with unique name
 */
export async function createTestDatabase(config: TestDatabaseConfig = DEFAULT_TEST_CONFIG): Promise<mysql.Connection> {
  // Connect without database to create it
  const connection = await mysql.createConnection({
    host: config.host,
    user: config.user,
    password: config.password,
    port: config.port,
    multipleStatements: true
  });

  // Create test database
  await connection.query(`DROP DATABASE IF EXISTS \`${config.database}\``);
  await connection.query(`CREATE DATABASE \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE \`${config.database}\``);

  console.log(`✅ Test database created: ${config.database}`);

  return connection;
}

/**
 * Loads database schema from SQL file
 */
export async function loadSchema(connection: mysql.Connection): Promise<void> {
  const schemaPath = path.join(process.cwd(), 'sqlscripting', 'tablestructures.sql');

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }

  const schema = fs.readFileSync(schemaPath, 'utf-8');

  // Execute schema in chunks to handle multiple statements
  const statements = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const statement of statements) {
    try {
      await connection.query(statement);
    } catch (error: any) {
      if (!error.message.includes('already exists')) {
        console.warn(`Warning executing schema statement: ${error.message}`);
      }
    }
  }

  console.log('✅ Schema loaded successfully');
}

/**
 * Loads stored procedures from SQL file
 */
export async function loadStoredProcedures(connection: mysql.Connection): Promise<void> {
  const proceduresPath = path.join(process.cwd(), 'sqlscripting', 'storedprocedures.sql');

  if (!fs.existsSync(proceduresPath)) {
    throw new Error(`Stored procedures file not found: ${proceduresPath}`);
  }

  const procedures = fs.readFileSync(proceduresPath, 'utf-8');

  try {
    // Execute the entire stored procedures file
    await connection.query(procedures);
    console.log('✅ Stored procedures loaded successfully');

    // Verify bulkingestionprocess exists and uses GROUP_CONCAT
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      'SHOW CREATE PROCEDURE bulkingestionprocess'
    );

    if (rows.length > 0) {
      const procedureContent = rows[0]['Create Procedure'];
      if (procedureContent.includes('GROUP_CONCAT')) {
        console.log('✅ Verified: bulkingestionprocess uses GROUP_CONCAT');
      } else {
        console.warn('⚠️  Warning: bulkingestionprocess may not use GROUP_CONCAT');
      }
    }
  } catch (error: any) {
    console.error('Error loading stored procedures:', error.message);
    throw error;
  }
}

/**
 * Parses sample data files from sampledata folder
 */
export function parseSampleDataFile(filePath: string): any[] {
  if (!fs.existsSync(filePath)) {
    console.warn(`Sample data file not found: ${filePath}`);
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim().length > 0);

  if (lines.length === 0) return [];

  // First line is header
  const headers = lines[0].split('\t').map(h => h.trim());
  const data: any[] = [];

  // Parse each data line
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split('\t');
    const row: any = {};

    headers.forEach((header, index) => {
      const value = values[index]?.trim() || null;
      row[header] = value === '' || value === 'NULL' ? null : value;
    });

    data.push(row);
  }

  return data;
}

/**
 * Seeds database with sample data from sampledata folder
 */
export async function seedSampleData(connection: mysql.Connection): Promise<TestData> {
  const sampleDataPath = path.join(process.cwd(), 'sampledata', 'cocoli');

  const testData: TestData = {
    sites: [],
    plots: [],
    census: [],
    species: [],
    quadrats: [],
    attributes: []
  };

  // Load species data
  const speciesFile = path.join(sampleDataPath, 'species.txt');
  const speciesData = parseSampleDataFile(speciesFile);

  for (const species of speciesData.slice(0, 50)) { // Limit to 50 for testing
    await connection.query(
      `INSERT INTO species (SpeciesCode, SpeciesName, SubspeciesName, IDLevel, SpeciesAuthority, SubspeciesAuthority, IsActive)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE SpeciesName = VALUES(SpeciesName)`,
      [
        species.Mnemonic || species.SpeciesCode || `SP${Math.random().toString(36).substr(2, 6)}`,
        species.Latin || species.SpeciesName || 'Unknown Species',
        species.SubspeciesName || null,
        species.IDLevel || species.GenusID || 'species',
        species.Authority || species.SpeciesAuthority || null,
        species.SubspeciesAuthority || null
      ]
    );
  }

  testData.species = speciesData.slice(0, 50);
  console.log(`✅ Loaded ${testData.species.length} species`);

  // Load attributes data
  const attributesFile = path.join(sampleDataPath, 'TSMAttributes.txt');
  const attributesData = parseSampleDataFile(attributesFile);

  for (const attr of attributesData) {
    await connection.query(
      `INSERT INTO attributes (Code, Description, Status, IsActive)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE Description = VALUES(Description)`,
      [
        attr.Code || attr.TSMCode,
        attr.Description || attr.Meaning || 'Unknown',
        attr.Status || 'alive'
      ]
    );
  }

  testData.attributes = attributesData;
  console.log(`✅ Loaded ${testData.attributes.length} attributes`);

  // Load quadrat data
  const quadratsFile = path.join(sampleDataPath, 'Quadrat.txt');
  const quadratsData = parseSampleDataFile(quadratsFile);

  // Create test site
  await connection.query(
    `INSERT INTO sites (SiteName, LocationName, CountryName, SchemaName, IsActive)
     VALUES ('Test Site', 'Cocoli', 'Panama', ?, 1)`,
    [DEFAULT_TEST_CONFIG.database]
  );

  const [siteRows] = await connection.query<mysql.RowDataPacket[]>(
    'SELECT SiteID FROM sites WHERE SchemaName = ?',
    [DEFAULT_TEST_CONFIG.database]
  );
  const siteID = siteRows[0].SiteID;
  testData.sites = [{ siteID, siteName: 'Test Site', schemaName: DEFAULT_TEST_CONFIG.database }];

  // Create test plot
  await connection.query(
    `INSERT INTO plots (SiteID, PlotName, LocationName, CountryName, DimensionX, DimensionY, Area, GlobalX, GlobalY, GlobalZ, PlotShape, PlotDescription, IsActive, NumQuadrats)
     VALUES (?, 'Test Plot', 'Cocoli', 'Panama', 500, 500, 250000, 0, 0, 0, 'square', 'Test plot', 1, ?)`,
    [siteID, quadratsData.length]
  );

  const [plotRows] = await connection.query<mysql.RowDataPacket[]>(
    'SELECT PlotID FROM plots WHERE SiteID = ?',
    [siteID]
  );
  const plotID = plotRows[0].PlotID;
  testData.plots = [{ plotID, plotName: 'Test Plot', siteID, num_quadrats: quadratsData.length }];

  // Insert quadrats
  for (const quadrat of quadratsData) {
    await connection.query(
      `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape, IsActive)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'square', 1)`,
      [
        plotID,
        quadrat.QuadratName || quadrat.Quadrat,
        parseFloat(quadrat.StartX || quadrat.X || '0'),
        parseFloat(quadrat.StartY || quadrat.Y || '0'),
        parseFloat(quadrat.DimX || quadrat.DimensionX || '20'),
        parseFloat(quadrat.DimY || quadrat.DimensionY || '20'),
        parseFloat(quadrat.Area || '400')
      ]
    );
  }

  testData.quadrats = quadratsData;
  console.log(`✅ Loaded ${testData.quadrats.length} quadrats`);

  // Create test census
  await connection.query(
    `INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive)
     VALUES (?, 1, '2024-01-01', '2024-12-31', 1)`,
    [plotID]
  );

  const [censusRows] = await connection.query<mysql.RowDataPacket[]>(
    'SELECT CensusID FROM census WHERE PlotID = ? AND PlotCensusNumber = 1',
    [plotID]
  );
  const censusID = censusRows[0].CensusID;
  testData.census = [{
    censusID,
    plotCensusNumber: 1,
    plotID,
    startDate: '2024-01-01',
    endDate: '2024-12-31'
  }];

  console.log('✅ Sample data seeded successfully');

  return testData;
}

/**
 * Complete setup of test database with schema, procedures, and data
 */
export async function setupTestDatabase(config: TestDatabaseConfig = DEFAULT_TEST_CONFIG): Promise<{
  connection: mysql.Connection;
  testData: TestData;
  config: TestDatabaseConfig;
}> {
  console.log('\n🔧 Setting up test database...');

  const connection = await createTestDatabase(config);
  await loadSchema(connection);
  await loadStoredProcedures(connection);
  const testData = await seedSampleData(connection);

  console.log('✅ Test database setup complete\n');

  return { connection, testData, config };
}

/**
 * Teardown and cleanup test database
 */
export async function teardownTestDatabase(connection: mysql.Connection, config: TestDatabaseConfig = DEFAULT_TEST_CONFIG): Promise<void> {
  console.log('\n🧹 Cleaning up test database...');

  // If connection is undefined (failed to establish), skip cleanup
  if (!connection) {
    console.log('⚠️  No connection to clean up (database was not available)\n');
    return;
  }

  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${config.database}\``);
    console.log(`✅ Test database dropped: ${config.database}`);
  } catch (error: any) {
    console.warn(`Warning during cleanup: ${error.message}`);
  } finally {
    await connection.end();
    console.log('✅ Connection closed\n');
  }
}

/**
 * Helper to insert test measurement data
 */
export async function insertTestMeasurements(
  connection: mysql.Connection,
  testData: TestData,
  measurements: Array<{
    treeTag: string;
    stemTag: string;
    speciesCode: string;
    quadratName: string;
    x: number;
    y: number;
    dbh: number;
    hom: number;
    date: string;
    codes?: string;
    comments?: string;
  }>
): Promise<{ fileID: string; batchID: string }> {
  const fileID = `test_${uuidv4().substring(0, 8)}`;
  const batchID = `batch_${uuidv4().substring(0, 8)}`;

  const plotID = testData.plots[0].plotID;
  const censusID = testData.census[0].censusID;

  for (const meas of measurements) {
    await connection.query(
      `INSERT INTO temporarymeasurements
       (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName,
        LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fileID, batchID, plotID, censusID,
        meas.treeTag, meas.stemTag, meas.speciesCode, meas.quadratName,
        meas.x, meas.y, meas.dbh, meas.hom, meas.date,
        meas.codes || null, meas.comments || null
      ]
    );
  }

  return { fileID, batchID };
}

/**
 * Helper to run bulkingestionprocess and return results
 */
export async function runBulkIngestion(
  connection: mysql.Connection,
  fileID: string,
  batchID: string
): Promise<{
  success: boolean;
  message: string;
  batch_failed: boolean;
}> {
  try {
    const [results] = await connection.query<mysql.RowDataPacket[]>(
      'CALL bulkingestionprocess(?, ?)',
      [fileID, batchID]
    );

    // Get the result message
    const result = Array.isArray(results) ? results[0] : results;
    const row = Array.isArray(result) ? result[0] : result;

    return {
      success: !row?.batch_failed,
      message: row?.message || 'Ingestion completed',
      batch_failed: row?.batch_failed || false
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Error: ${error.message}`,
      batch_failed: true
    };
  }
}

/**
 * Helper to verify ingestion results
 */
export async function verifyIngestionResults(
  connection: mysql.Connection,
  testData: TestData,
  treeTags: string[]
): Promise<{
  insertedCount: number;
  measurements: any[];
  attributes: Record<string, string>;
}> {
  const censusID = testData.census[0].censusID;

  // Get inserted measurements
  const [measurements] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT
       cm.CoreMeasurementID,
       t.TreeTag,
       s.StemTag,
       cm.MeasuredDBH,
       cm.MeasuredHOM,
       cm.MeasurementDate,
       GROUP_CONCAT(DISTINCT cma.Code ORDER BY cma.Code SEPARATOR ';') as Codes
     FROM coremeasurements cm
     INNER JOIN stems s ON s.StemGUID = cm.StemGUID
     INNER JOIN trees t ON t.TreeID = s.TreeID
     LEFT JOIN cmattributes cma ON cma.CoreMeasurementID = cm.CoreMeasurementID
     WHERE t.TreeTag IN (?) AND cm.CensusID = ?
     GROUP BY cm.CoreMeasurementID, t.TreeTag, s.StemTag, cm.MeasuredDBH, cm.MeasuredHOM, cm.MeasurementDate`,
    [treeTags, censusID]
  );

  // Build attributes map
  const attributes: Record<string, string> = {};
  measurements.forEach(m => {
    attributes[m.TreeTag] = m.Codes || '';
  });

  return {
    insertedCount: measurements.length,
    measurements,
    attributes
  };
}
