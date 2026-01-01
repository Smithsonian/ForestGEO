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
// These defaults match docker-compose.yml for seamless local development
export const DEFAULT_TEST_CONFIG: TestDatabaseConfig = {
  host: process.env.TEST_DB_HOST || 'localhost',
  user: process.env.TEST_DB_USER || 'root',
  password: process.env.TEST_DB_PASSWORD || 'testpassword',
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
  await connection.query(`CREATE DATABASE \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
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

  // Disable foreign key checks during schema loading
  await connection.query('SET FOREIGN_KEY_CHECKS = 0');

  // Execute schema in chunks to handle multiple statements
  const statements = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let createdTables = 0;
  let errors = 0;

  for (const statement of statements) {
    try {
      await connection.query(statement);
      if (statement.toLowerCase().includes('create table')) {
        createdTables++;
      }
    } catch (error: any) {
      // Ignore "doesn't exist" errors from DROP statements and "already exists"
      if (!error.message.includes("doesn't exist") && !error.message.includes('already exists')) {
        errors++;
        // Only show first 100 chars of error to avoid noise
        const shortMsg = error.message.substring(0, 100);
        console.warn(`Schema error: ${shortMsg}`);
      }
    }
  }

  // Re-enable foreign key checks
  await connection.query('SET FOREIGN_KEY_CHECKS = 1');

  console.log(`✅ Schema loaded: ${createdTables} tables created${errors > 0 ? `, ${errors} errors` : ''}`);
}

/**
 * Loads validation definitions from corequeries.sql into sitespecificvalidations table.
 * These are the SQL definitions for post-ingestion validations executed via the API.
 */
export async function loadValidationDefinitions(connection: mysql.Connection): Promise<void> {
  const coreQueriesPath = path.join(process.cwd(), 'sqlscripting', 'corequeries.sql');

  if (!fs.existsSync(coreQueriesPath)) {
    console.warn(`Core queries file not found: ${coreQueriesPath} - skipping validation definitions`);
    return;
  }

  const fileContent = fs.readFileSync(coreQueriesPath, 'utf-8');

  // Extract INSERT statements for sitespecificvalidations
  // The file contains multi-line INSERT statements, so we need to parse carefully
  const lines = fileContent.split('\n');
  let currentStatement = '';
  let inInsert = false;
  let insertedCount = 0;
  let errorCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines when not in an INSERT
    if (!inInsert && (trimmed.startsWith('--') || trimmed === '')) {
      continue;
    }

    // Start of INSERT statement for sitespecificvalidations
    if (trimmed.toLowerCase().includes('insert into sitespecificvalidations')) {
      inInsert = true;
      currentStatement = line;
      continue;
    }

    if (inInsert) {
      currentStatement += '\n' + line;

      // Check if statement is complete (ends with semicolon outside of quotes)
      // Simple heuristic: line ends with ); or just ;
      if (trimmed.endsWith(');') || (trimmed === ';')) {
        try {
          await connection.query(currentStatement);
          insertedCount++;
        } catch (err: any) {
          errorCount++;
          if (errorCount <= 2) {
            console.warn(`Validation insert error: ${err.message.substring(0, 80)}`);
          }
        }
        currentStatement = '';
        inInsert = false;
      }
    }
  }

  if (errorCount > 2) {
    console.warn(`  ... and ${errorCount - 2} more validation insert errors`);
  }

  console.log(`✅ Loaded ${insertedCount} validation definitions${errorCount > 0 ? ` (${errorCount} errors)` : ''}`);
}

/**
 * Loads stored procedures from SQL file
 *
 * The stored procedures file uses DELIMITER $$ which is a MySQL client command,
 * not valid SQL. We need to:
 * 1. Remove DELIMITER statements
 * 2. Split on $$ to get individual procedures
 * 3. Execute each procedure separately
 */
export async function loadStoredProcedures(connection: mysql.Connection): Promise<void> {
  const proceduresPath = path.join(process.cwd(), 'sqlscripting', 'storedprocedures.sql');

  if (!fs.existsSync(proceduresPath)) {
    throw new Error(`Stored procedures file not found: ${proceduresPath}`);
  }

  const fileContent = fs.readFileSync(proceduresPath, 'utf-8');

  try {
    // Remove DELIMITER statements (they're MySQL client commands, not SQL)
    let content = fileContent
      .replace(/DELIMITER\s+\$\$/gi, '')
      .replace(/DELIMITER\s+;/gi, '');

    // Split on $$ to get individual statements
    const statements = content.split('$$');

    let loadedCount = 0;
    let dropCount = 0;
    let errorCount = 0;

    for (const statement of statements) {
      const trimmed = statement.trim();
      if (!trimmed || trimmed.length < 10) continue;

      // Remove the definer clause (azureroot won't exist locally)
      let cleaned = trimmed.replace(
        /definer\s*=\s*`?[^`\s]+`?@`?[^`\s]+`?\s*/gi,
        ''
      );

      // Check if it's a DROP statement (these should succeed)
      const isDrop = cleaned.toLowerCase().startsWith('drop');

      try {
        await connection.query(cleaned);
        if (isDrop) {
          dropCount++;
        } else {
          loadedCount++;
        }
      } catch (err: any) {
        // Ignore "already exists" and "does not exist" errors
        if (!err.message.includes('already exists') && !err.message.includes('does not exist')) {
          errorCount++;
          // Show more detail for debugging
          if (errorCount <= 3) {
            const preview = cleaned.substring(0, 80).replace(/\n/g, ' ');
            console.warn(`Procedure error: ${err.message.substring(0, 60)}... | SQL: ${preview}...`);
          }
        }
      }
    }

    if (errorCount > 3) {
      console.warn(`  ... and ${errorCount - 3} more procedure errors`);
    }

    console.log(`✅ Loaded ${loadedCount} stored procedures (${dropCount} drops executed)`);

    // Verify bulkingestionprocess exists
    try {
      const [rows] = await connection.query<mysql.RowDataPacket[]>('SHOW CREATE PROCEDURE bulkingestionprocess');

      if (rows.length > 0) {
        const procedureContent = rows[0]['Create Procedure'];
        if (procedureContent.includes('GROUP_CONCAT')) {
          console.log('✅ Verified: bulkingestionprocess uses GROUP_CONCAT');
        } else {
          console.warn('⚠️  Warning: bulkingestionprocess may not use GROUP_CONCAT');
        }
      }
    } catch (err: any) {
      console.warn('⚠️  Could not verify bulkingestionprocess:', err.message);
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
 * Seeds database with test data
 * Creates inline test data since external sample files may not exist
 */
export async function seedSampleData(connection: mysql.Connection): Promise<TestData> {
  const testData: TestData = {
    sites: [],
    plots: [],
    census: [],
    species: [],
    quadrats: [],
    attributes: []
  };

  // Create test species inline
  const testSpecies = [
    { code: 'ACERRU', name: 'Acer rubrum', idLevel: 'species' },
    { code: 'QUERCO', name: 'Quercus alba', idLevel: 'species' },
    { code: 'PINUST', name: 'Pinus strobus', idLevel: 'species' },
    { code: 'FAGUGR', name: 'Fagus grandifolia', idLevel: 'species' },
    { code: 'BETUAL', name: 'Betula alleghaniensis', idLevel: 'species' },
    { code: 'TILIAA', name: 'Tilia americana', idLevel: 'species' },
    { code: 'FRAXAM', name: 'Fraxinus americana', idLevel: 'species' },
    { code: 'ULMUSA', name: 'Ulmus americana', idLevel: 'species' },
    { code: 'CARYAG', name: 'Carya glabra', idLevel: 'species' },
    { code: 'LIQUIS', name: 'Liquidambar styraciflua', idLevel: 'species' }
  ];

  for (const species of testSpecies) {
    try {
      await connection.query(
        `INSERT INTO species (SpeciesCode, SpeciesName, IDLevel, IsActive)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE SpeciesName = VALUES(SpeciesName)`,
        [species.code, species.name, species.idLevel]
      );
      testData.species.push({ SpeciesCode: species.code, SpeciesName: species.name, Mnemonic: species.code });
    } catch (err: any) {
      console.warn(`Warning inserting species: ${err.message}`);
    }
  }
  console.log(`✅ Loaded ${testData.species.length} species`);

  // Create test attributes inline
  const testAttributes = [
    { code: 'A', description: 'Alive', status: 'alive' },
    { code: 'D', description: 'Dead', status: 'dead' },
    { code: 'M', description: 'Missing', status: 'missing' },
    { code: 'B', description: 'Broken below', status: 'broken below' },
    { code: 'R', description: 'Resprout', status: 'alive' }
  ];

  for (const attr of testAttributes) {
    try {
      await connection.query(
        `INSERT INTO attributes (Code, Description, Status, IsActive)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE Description = VALUES(Description)`,
        [attr.code, attr.description, attr.status]
      );
      testData.attributes.push(attr);
    } catch (err: any) {
      console.warn(`Warning inserting attribute: ${err.message}`);
    }
  }
  console.log(`✅ Loaded ${testData.attributes.length} attributes`);

  // Create test plot (no sites table in schema)
  try {
    await connection.query(
      `INSERT INTO plots (PlotName, LocationName, CountryName, DimensionX, DimensionY, Area, GlobalX, GlobalY, GlobalZ, PlotShape, PlotDescription)
       VALUES ('Test Plot', 'Test Location', 'Panama', 500, 500, 250000, 0, 0, 0, 'square', 'Test plot for integration testing')`
    );

    const [plotRows] = await connection.query<mysql.RowDataPacket[]>('SELECT PlotID FROM plots WHERE PlotName = ?', ['Test Plot']);
    const plotID = plotRows[0].PlotID;
    testData.plots = [{ plotID, plotName: 'Test Plot', num_quadrats: 10 }];
    console.log(`✅ Created test plot (ID: ${plotID})`);

    // Create test quadrats
    for (let i = 0; i < 10; i++) {
      const quadratName = `Q${String(i + 1).padStart(2, '0')}`;
      const startX = (i % 5) * 20;
      const startY = Math.floor(i / 5) * 20;

      await connection.query(
        `INSERT INTO quadrats (PlotID, QuadratName, StartX, StartY, DimensionX, DimensionY, Area, QuadratShape)
         VALUES (?, ?, ?, ?, 20, 20, 400, 'square')`,
        [plotID, quadratName, startX, startY]
      );
      testData.quadrats.push({ QuadratName: quadratName, Quadrat: quadratName, StartX: startX, StartY: startY });
    }
    console.log(`✅ Created ${testData.quadrats.length} quadrats`);

    // Create test census
    await connection.query(
      `INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate)
       VALUES (?, 1, '2024-01-01', '2024-12-31')`,
      [plotID]
    );

    const [censusRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT CensusID FROM census WHERE PlotID = ? AND PlotCensusNumber = 1',
      [plotID]
    );
    const censusID = censusRows[0].CensusID;
    testData.census = [
      {
        censusID,
        plotCensusNumber: 1,
        plotID,
        startDate: '2024-01-01',
        endDate: '2024-12-31'
      }
    ];
    console.log(`✅ Created test census (ID: ${censusID})`);
  } catch (err: any) {
    console.error(`Error creating test data: ${err.message}`);
    throw err;
  }

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
  await loadValidationDefinitions(connection);
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
  }>,
  options: {
    censusID?: number;
    fileID?: string;
    batchID?: string;
  } = {}
): Promise<{ fileID: string; batchID: string }> {
  const fileID = options.fileID || `test_${uuidv4().substring(0, 8)}`;
  const batchID = options.batchID || `batch_${uuidv4().substring(0, 8)}`;

  const plotID = testData.plots[0].plotID;
  const censusID = options.censusID || testData.census[0].censusID;

  for (const meas of measurements) {
    await connection.query(
      `INSERT INTO temporarymeasurements
       (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName,
        LocalX, LocalY, DBH, HOM, MeasurementDate, Codes, Comments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fileID,
        batchID,
        plotID,
        censusID,
        meas.treeTag,
        meas.stemTag,
        meas.speciesCode,
        meas.quadratName,
        meas.x,
        meas.y,
        meas.dbh,
        meas.hom,
        meas.date,
        meas.codes || null,
        meas.comments || null
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
    const [results] = await connection.query<mysql.RowDataPacket[]>('CALL bulkingestionprocess(?, ?)', [fileID, batchID]);

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

// =============================================================================
// MULTI-CENSUS TEST HELPERS
// =============================================================================

/**
 * Census info returned by createAdditionalCensus
 */
export interface CensusInfo {
  censusID: number;
  plotCensusNumber: number;
  startDate: string;
  endDate: string;
}

/**
 * Creates an additional census for multi-census validation testing.
 * This allows testing cross-census validations like DBH growth/shrinkage,
 * species mismatch, and status transitions.
 */
export async function createAdditionalCensus(
  connection: mysql.Connection,
  testData: TestData,
  options: {
    plotCensusNumber: number;
    startDate: string;
    endDate: string;
  }
): Promise<CensusInfo> {
  const plotID = testData.plots[0].plotID;

  await connection.query(
    `INSERT INTO census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive)
     VALUES (?, ?, ?, ?, 1)`,
    [plotID, options.plotCensusNumber, options.startDate, options.endDate]
  );

  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    'SELECT CensusID FROM census WHERE PlotID = ? AND PlotCensusNumber = ?',
    [plotID, options.plotCensusNumber]
  );

  const censusInfo: CensusInfo = {
    censusID: rows[0].CensusID,
    plotCensusNumber: options.plotCensusNumber,
    startDate: options.startDate,
    endDate: options.endDate
  };

  // Add to testData for reference
  testData.census.push(censusInfo);

  return censusInfo;
}

/**
 * Measurement record for direct insertion into coremeasurements
 */
export interface DirectMeasurement {
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
}

/**
 * Inserts measurements directly into coremeasurements (bypassing bulk ingestion).
 * Use this to set up historical data for cross-census validation testing.
 *
 * This creates:
 * - Trees (if not exist)
 * - Stems (if not exist)
 * - CoreMeasurements for the specified census
 * - CMAttributes if codes are provided
 */
export async function insertDirectMeasurements(
  connection: mysql.Connection,
  testData: TestData,
  censusID: number,
  measurements: DirectMeasurement[]
): Promise<{ coreMeasurementIDs: number[] }> {
  const plotID = testData.plots[0].plotID;
  const coreMeasurementIDs: number[] = [];

  for (const meas of measurements) {
    // Get or create quadrat
    const [quadratRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ?',
      [meas.quadratName, plotID]
    );

    if (quadratRows.length === 0) {
      throw new Error(`Quadrat not found: ${meas.quadratName}`);
    }
    const quadratID = quadratRows[0].QuadratID;

    // Get species
    const [speciesRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT SpeciesID FROM species WHERE SpeciesCode = ?',
      [meas.speciesCode]
    );

    if (speciesRows.length === 0) {
      throw new Error(`Species not found: ${meas.speciesCode}`);
    }
    const speciesID = speciesRows[0].SpeciesID;

    // Get or create tree for this census
    // Trees are unique per (TreeTag, SpeciesID, CensusID) - each census has its own tree record
    let treeID: number;
    const [treeRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT TreeID FROM trees WHERE TreeTag = ? AND SpeciesID = ? AND CensusID = ?',
      [meas.treeTag, speciesID, censusID]
    );

    if (treeRows.length > 0) {
      treeID = treeRows[0].TreeID;
    } else {
      await connection.query(
        'INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)',
        [meas.treeTag, speciesID, censusID]
      );
      const [newTreeRows] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT LAST_INSERT_ID() as TreeID'
      );
      treeID = newTreeRows[0].TreeID;
    }

    // Get or create stem for this census (StemGUID is auto-increment INT, not UUID)
    // Stems are unique per (TreeID, StemTag, CensusID) - each census has its own stem record
    let stemGUID: number;
    const [stemRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT StemGUID FROM stems WHERE StemTag = ? AND TreeID = ? AND CensusID = ?',
      [meas.stemTag, treeID, censusID]
    );

    if (stemRows.length > 0) {
      stemGUID = stemRows[0].StemGUID;
    } else {
      await connection.query(
        `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [treeID, quadratID, censusID, meas.stemTag, meas.x, meas.y]
      );
      const [newStemRows] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT LAST_INSERT_ID() as StemGUID'
      );
      stemGUID = newStemRows[0].StemGUID;
    }

    // Insert core measurement (CoreMeasurementID is auto-increment)
    await connection.query(
      `INSERT INTO coremeasurements
       (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
       VALUES (?, ?, ?, ?, ?, 1, 1)`,
      [stemGUID, censusID, meas.dbh, meas.hom, meas.date]
    );

    const [cmRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT LAST_INSERT_ID() as CoreMeasurementID'
    );
    const coreMeasurementID = cmRows[0].CoreMeasurementID;
    coreMeasurementIDs.push(coreMeasurementID);

    // Insert attributes if provided
    if (meas.codes) {
      const codes = meas.codes.split(';').map(c => c.trim()).filter(c => c);
      for (const code of codes) {
        await connection.query(
          'INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, ?)',
          [coreMeasurementID, code]
        );
      }
    }
  }

  return { coreMeasurementIDs };
}

/**
 * Helper to get validation errors for specific measurements
 */
export async function getValidationErrors(
  connection: mysql.Connection,
  options: {
    censusID?: number;
    validationID?: number;
    treeTag?: string;
  } = {}
): Promise<
  Array<{
    CMVErrorID: number;
    ValidationErrorID: number;
    CoreMeasurementID: number;
    ProcedureName: string;
    Description: string;
  }>
> {
  let query = `
    SELECT cmv.CMVErrorID, cmv.ValidationErrorID, cmv.CoreMeasurementID,
           ssv.ProcedureName, ssv.Description
    FROM cmverrors cmv
    LEFT JOIN sitespecificvalidations ssv ON cmv.ValidationErrorID = ssv.ValidationID
    LEFT JOIN coremeasurements cm ON cm.CoreMeasurementID = cmv.CoreMeasurementID
    LEFT JOIN stems s ON s.StemGUID = cm.StemGUID
    LEFT JOIN trees t ON t.TreeID = s.TreeID
    WHERE 1=1
  `;
  const params: any[] = [];

  if (options.censusID) {
    query += ' AND cm.CensusID = ?';
    params.push(options.censusID);
  }
  if (options.validationID) {
    query += ' AND cmv.ValidationErrorID = ?';
    params.push(options.validationID);
  }
  if (options.treeTag) {
    query += ' AND t.TreeTag = ?';
    params.push(options.treeTag);
  }

  const [rows] = await connection.query<mysql.RowDataPacket[]>(query, params);
  return rows as any[];
}

/**
 * Helper to get failed measurements
 */
export async function getFailedMeasurements(
  connection: mysql.Connection,
  options: {
    fileID?: string;
    batchID?: string;
  } = {}
): Promise<
  Array<{
    FailedMeasurementID: number;
    FileID: string;
    BatchID: string;
    Tag: string;
    StemTag: string;
    FailureReasons: string;
  }>
> {
  let query = 'SELECT * FROM failedmeasurements WHERE 1=1';
  const params: any[] = [];

  if (options.fileID) {
    query += ' AND FileID = ?';
    params.push(options.fileID);
  }
  if (options.batchID) {
    query += ' AND BatchID = ?';
    params.push(options.batchID);
  }

  const [rows] = await connection.query<mysql.RowDataPacket[]>(query, params);
  return rows as any[];
}

// =============================================================================
// ATTRIBUTE AND SPECIES SEEDING HELPERS
// =============================================================================

/**
 * Ensures common attribute codes exist with proper status designations.
 * These are needed for validation tests involving alive/dead status.
 */
export async function seedStatusAttributes(connection: mysql.Connection): Promise<void> {
  const statusCodes = [
    { code: 'A', description: 'Alive - normal', status: 'alive' },
    { code: 'AS', description: 'Alive - stem broken', status: 'alive' },
    { code: 'AB', description: 'Alive - buttressed', status: 'alive' },
    { code: 'D', description: 'Dead - standing', status: 'dead' },
    { code: 'DS', description: 'Dead - stem fallen', status: 'dead' },
    { code: 'DC', description: 'Dead - cut down', status: 'dead' },
    { code: 'DN', description: 'Dead - no longer present', status: 'dead' },
    { code: 'M', description: 'Missing - not found', status: 'missing' },
    { code: 'P', description: 'Prior - measured in prior census only', status: 'alive' },
    { code: 'R', description: 'Resprout', status: 'alive' }
  ];

  for (const attr of statusCodes) {
    await connection.query(
      `INSERT INTO attributes (Code, Description, Status, IsActive)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE Description = VALUES(Description), Status = VALUES(Status)`,
      [attr.code, attr.description, attr.status]
    );
  }

  console.log(`✅ Seeded ${statusCodes.length} status attribute codes`);
}

/**
 * Species with DBH limits for testing ValidateScreenMeasuredDiameterMinMax
 */
export interface SpeciesWithLimits {
  speciesCode: string;
  speciesName: string;
  minDBH: number | null;
  maxDBH: number | null;
}

/**
 * Seeds species with DBH min/max limits for validation testing.
 * DBH limits are stored in the specieslimits table, not in species directly.
 */
export async function seedSpeciesWithLimits(
  connection: mysql.Connection,
  species: SpeciesWithLimits[],
  testData: TestData
): Promise<void> {
  const plotID = testData.plots[0]?.plotID;
  const censusID = testData.census[0]?.censusID;

  for (const sp of species) {
    // First insert the species
    await connection.query(
      `INSERT INTO species (SpeciesCode, SpeciesName, IDLevel, IsActive)
       VALUES (?, ?, 'species', 1)
       ON DUPLICATE KEY UPDATE SpeciesName = VALUES(SpeciesName)`,
      [sp.speciesCode, sp.speciesName]
    );

    // Get the SpeciesID
    const [speciesRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT SpeciesID FROM species WHERE SpeciesCode = ?',
      [sp.speciesCode]
    );

    if (speciesRows.length > 0 && (sp.minDBH !== null || sp.maxDBH !== null)) {
      const speciesID = speciesRows[0].SpeciesID;

      // Insert into specieslimits table
      await connection.query(
        `INSERT INTO specieslimits (SpeciesID, PlotID, CensusID, LimitType, LowerBound, UpperBound, IsActive)
         VALUES (?, ?, ?, 'DBH', ?, ?, 1)
         ON DUPLICATE KEY UPDATE LowerBound = VALUES(LowerBound), UpperBound = VALUES(UpperBound)`,
        [speciesID, plotID, censusID, sp.minDBH, sp.maxDBH]
      );
    }

    // Also add to testData for reference
    testData.species.push({ SpeciesCode: sp.speciesCode, SpeciesName: sp.speciesName, Mnemonic: sp.speciesCode });
  }

  console.log(`✅ Seeded ${species.length} species with DBH limits`);
}

// =============================================================================
// TEST DATA FACTORY HELPERS
// =============================================================================

/**
 * Options for generating test measurement data
 */
export interface MeasurementFactoryOptions {
  count?: number;
  treeTagPrefix?: string;
  speciesCode?: string;
  quadratName?: string;
  dbhRange?: { min: number; max: number };
  dateRange?: { start: string; end: string };
}

/**
 * Generates an array of test measurements for bulk testing.
 */
export function generateTestMeasurements(
  testData: TestData,
  options: MeasurementFactoryOptions = {}
): DirectMeasurement[] {
  const {
    count = 10,
    treeTagPrefix = 'T',
    speciesCode = testData.species[0]?.SpeciesCode || testData.species[0]?.Mnemonic || 'TESTSP',
    quadratName = testData.quadrats[0]?.QuadratName || testData.quadrats[0]?.Quadrat || 'Q001',
    dbhRange = { min: 50, max: 500 },
    dateRange = { start: '2024-01-01', end: '2024-12-31' }
  } = options;

  const measurements: DirectMeasurement[] = [];

  for (let i = 1; i <= count; i++) {
    const dbh = dbhRange.min + Math.random() * (dbhRange.max - dbhRange.min);
    const x = Math.random() * 20; // Within typical quadrat dimensions
    const y = Math.random() * 20;

    // Generate a date within the range
    const startMs = new Date(dateRange.start).getTime();
    const endMs = new Date(dateRange.end).getTime();
    const dateMs = startMs + Math.random() * (endMs - startMs);
    const date = new Date(dateMs).toISOString().split('T')[0];

    measurements.push({
      treeTag: `${treeTagPrefix}${String(i).padStart(4, '0')}`,
      stemTag: 'S001', // Main stem
      speciesCode,
      quadratName,
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      dbh: Math.round(dbh * 10) / 10,
      hom: 1.3,
      date,
      codes: 'A' // Default alive
    });
  }

  return measurements;
}

// =============================================================================
// POST-INGESTION VALIDATION HELPERS
// =============================================================================

/**
 * Fetches a validation definition from sitespecificvalidations table.
 */
export async function getValidationDefinition(
  connection: mysql.Connection,
  validationID: number
): Promise<{ ProcedureName: string; Definition: string } | null> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    'SELECT ProcedureName, Definition FROM sitespecificvalidations WHERE ValidationID = ? AND IsEnabled = 1',
    [validationID]
  );
  return rows.length > 0 ? (rows[0] as { ProcedureName: string; Definition: string }) : null;
}

/**
 * Runs a validation query against the test database.
 * This is a test-specific version of the API's runValidation function.
 *
 * @param connection - Test database connection
 * @param validationID - The ValidationID to run
 * @param params - Optional census/plot filters
 * @returns true if validation ran successfully
 */
export async function runValidationForTest(
  connection: mysql.Connection,
  validationID: number,
  params: { censusID?: number; plotID?: number } = {}
): Promise<boolean> {
  const validation = await getValidationDefinition(connection, validationID);
  if (!validation) {
    console.warn(`Validation ${validationID} not found or not enabled`);
    return false;
  }

  const { ProcedureName, Definition } = validation;

  // Clear stale validation errors for this validation
  const cleanupQuery = `
    DELETE cme FROM cmverrors cme
    JOIN coremeasurements cm ON cme.CoreMeasurementID = cm.CoreMeasurementID
    JOIN census c ON cm.CensusID = c.CensusID
    WHERE cme.ValidationErrorID = ?
      AND cm.IsValidated IS NULL
      AND cm.IsActive = TRUE
      ${params.censusID ? 'AND cm.CensusID = ?' : ''}
      ${params.plotID ? 'AND c.PlotID = ?' : ''}
  `;
  const cleanupParams: (number | undefined)[] = [validationID];
  if (params.censusID) cleanupParams.push(params.censusID);
  if (params.plotID) cleanupParams.push(params.plotID);
  await connection.query(cleanupQuery, cleanupParams);

  // Format the validation query with parameter replacements
  // We're already connected to the test database, so no schema prefix is needed
  const formattedQuery = Definition.replace(/@p_CensusID/g, params.censusID?.toString() ?? 'NULL')
    .replace(/@p_PlotID/g, params.plotID?.toString() ?? 'NULL')
    .replace(/@validationProcedureID/g, validationID.toString());

  try {
    await connection.query(formattedQuery);
    return true;
  } catch (error: any) {
    console.error(`Validation ${ProcedureName} failed:`, error.message);
    return false;
  }
}

/**
 * Runs all enabled validations for a census.
 * Returns array of validation IDs that were run.
 */
export async function runAllValidationsForTest(
  connection: mysql.Connection,
  params: { censusID?: number; plotID?: number } = {}
): Promise<number[]> {
  const [validations] = await connection.query<mysql.RowDataPacket[]>(
    'SELECT ValidationID FROM sitespecificvalidations WHERE IsEnabled = 1 ORDER BY ValidationID'
  );

  const ranValidations: number[] = [];
  for (const v of validations) {
    const success = await runValidationForTest(connection, v.ValidationID, params);
    if (success) {
      ranValidations.push(v.ValidationID);
    }
  }

  return ranValidations;
}

/**
 * Cross-census measurement data for validation testing.
 * This properly shares stems across censuses as required by validation queries.
 */
export interface CrossCensusMeasurement {
  treeTag: string;
  stemTag: string;
  speciesCode: string;
  quadratName: string;
  x: number;
  y: number;
  census1DBH: number;
  census2DBH: number;
  hom: number;
  census1Date: string;
  census2Date: string;
  codes?: string;
}

/**
 * Inserts measurements that span two censuses with SHARED StemGUID.
 * This is required for cross-census validations (1, 2) which compare
 * measurements across censuses by matching on StemGUID.
 *
 * Key differences from insertDirectMeasurements:
 * - Creates tree/stem ONCE, reuses SAME StemGUID for both census measurements
 * - Census 1 measurement: IsValidated = true
 * - Census 2 measurement: IsValidated = null
 * - Adds cmattributes for both measurements
 *
 * The validation queries join on StemGUID across censuses:
 *   `cm_present.StemGUID = cm_past.StemGUID and cm_present.CensusID <> cm_past.CensusID`
 */
export async function insertCrossCensusMeasurements(
  connection: mysql.Connection,
  testData: TestData,
  census1ID: number,
  census2ID: number,
  measurements: CrossCensusMeasurement[]
): Promise<{ census1MeasurementIDs: number[]; census2MeasurementIDs: number[]; stemGUIDs: number[] }> {
  const plotID = testData.plots[0].plotID;
  const census1MeasurementIDs: number[] = [];
  const census2MeasurementIDs: number[] = [];
  const stemGUIDs: number[] = [];

  for (const meas of measurements) {
    // Get quadrat
    const [quadratRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ?',
      [meas.quadratName, plotID]
    );
    if (quadratRows.length === 0) {
      throw new Error(`Quadrat not found: ${meas.quadratName}`);
    }
    const quadratID = quadratRows[0].QuadratID;

    // Get species
    const [speciesRows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT SpeciesID FROM species WHERE SpeciesCode = ?',
      [meas.speciesCode]
    );
    if (speciesRows.length === 0) {
      throw new Error(`Species not found: ${meas.speciesCode}`);
    }
    const speciesID = speciesRows[0].SpeciesID;

    // Create tree (we'll use census 1 as the "home" census for the tree)
    await connection.query(
      'INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)',
      [meas.treeTag, speciesID, census1ID]
    );
    const [treeRows] = await connection.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() as TreeID');
    const treeID = treeRows[0].TreeID;

    // Create stem ONCE - this StemGUID will be used for measurements in BOTH censuses
    await connection.query(
      `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [treeID, quadratID, census1ID, meas.stemTag, meas.x, meas.y]
    );
    const [stemRows] = await connection.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() as StemGUID');
    const stemGUID = stemRows[0].StemGUID;
    stemGUIDs.push(stemGUID);

    // Insert census 1 measurement (validated = true, as if already processed)
    await connection.query(
      `INSERT INTO coremeasurements
       (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
       VALUES (?, ?, ?, ?, ?, 1, 1)`,
      [stemGUID, census1ID, meas.census1DBH, meas.hom, meas.census1Date]
    );
    const [cm1Rows] = await connection.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() as CoreMeasurementID');
    const cm1ID = cm1Rows[0].CoreMeasurementID;
    census1MeasurementIDs.push(cm1ID);

    // Insert census 2 measurement using SAME StemGUID (validated = null, as if newly ingested)
    await connection.query(
      `INSERT INTO coremeasurements
       (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
       VALUES (?, ?, ?, ?, ?, NULL, 1)`,
      [stemGUID, census2ID, meas.census2DBH, meas.hom, meas.census2Date]
    );
    const [cm2Rows] = await connection.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() as CoreMeasurementID');
    const cm2ID = cm2Rows[0].CoreMeasurementID;
    census2MeasurementIDs.push(cm2ID);

    // Add cmattributes for both (alive status required for DBH validations)
    const attrCode = meas.codes || 'A';
    await connection.query('INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, ?)', [cm1ID, attrCode]);
    await connection.query('INSERT INTO cmattributes (CoreMeasurementID, Code) VALUES (?, ?)', [cm2ID, attrCode]);
  }

  return { census1MeasurementIDs, census2MeasurementIDs, stemGUIDs };
}

/**
 * Creates a standard two-census test scenario.
 * Returns testData with two censuses and helper functions for the scenario.
 */
export async function setupTwoCensusScenario(
  connection: mysql.Connection,
  testData: TestData
): Promise<{
  census1: CensusInfo;
  census2: CensusInfo;
}> {
  // First census is already created during seedSampleData
  const census1: CensusInfo = {
    censusID: testData.census[0].censusID,
    plotCensusNumber: testData.census[0].plotCensusNumber,
    startDate: testData.census[0].startDate,
    endDate: testData.census[0].endDate
  };

  // Create second census (the "current" census for ingestion)
  const census2 = await createAdditionalCensus(connection, testData, {
    plotCensusNumber: 2,
    startDate: '2025-01-01',
    endDate: '2025-12-31'
  });

  return { census1, census2 };
}
