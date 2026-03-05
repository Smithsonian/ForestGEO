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

// Logging configuration
// Set TEST_LOG_LEVEL=debug for verbose output, otherwise only errors are shown
const LOG_LEVEL = process.env.TEST_LOG_LEVEL || 'error';

export const log = {
  debug: (msg: string) => {
    if (LOG_LEVEL === 'debug') console.log(msg);
  },
  info: (msg: string) => {
    if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'info') console.log(msg);
  },
  warn: (msg: string) => {
    if (LOG_LEVEL !== 'silent') console.warn(msg);
  },
  error: (msg: string) => {
    if (LOG_LEVEL !== 'silent') console.error(msg);
  }
};

// Configuration
export interface TestDatabaseConfig {
  host: string;
  user: string;
  password: string;
  port: number;
  database: string;
  multipleStatements: boolean;
}

// Type definitions for test data entities
export interface TestSite {
  siteID: number;
  siteName: string;
}

export interface TestPlot {
  plotID: number;
  plotName: string;
  num_quadrats: number;
}

export interface TestCensus {
  censusID: number;
  plotCensusNumber: number;
  plotID: number;
  startDate: string;
  endDate: string;
}

export interface TestSpecies {
  SpeciesCode: string;
  SpeciesName: string;
  Mnemonic: string;
}

export interface TestQuadrat {
  QuadratName: string;
  Quadrat: string;
  StartX: number;
  StartY: number;
}

export interface TestAttribute {
  code: string;
  description: string;
  status: string;
}

export interface TestData {
  sites: TestSite[];
  plots: TestPlot[];
  census: TestCensus[];
  species: TestSpecies[];
  quadrats: TestQuadrat[];
  attributes: TestAttribute[];
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

// Retry configuration for database connections
const CONNECTION_RETRY_CONFIG = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2
} as const;

/**
 * Delays execution for the specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Attempts to create a MySQL connection with retry logic.
 * Uses exponential backoff to handle cases where MySQL is still starting up.
 *
 * @param config - Database configuration
 * @param retryConfig - Optional retry configuration overrides
 * @returns A MySQL connection
 * @throws Error if all retry attempts fail
 */
async function connectWithRetry(
  config: TestDatabaseConfig,
  retryConfig = CONNECTION_RETRY_CONFIG
): Promise<mysql.Connection> {
  let lastError: Error | null = null;
  let currentDelay: number = retryConfig.initialDelayMs;

  for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      const connection = await mysql.createConnection({
        host: config.host,
        user: config.user,
        password: config.password,
        port: config.port,
        multipleStatements: true,
        charset: 'UTF8MB4_0900_AI_CI'
      });

      // Verify connection is actually working
      await connection.ping();

      if (attempt > 1) {
        log.debug(`Database connection established on attempt ${attempt}`);
      }

      return connection;
    } catch (error: any) {
      lastError = error;

      const isRetryable =
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ER_CON_COUNT_ERROR' ||
        error.message?.includes('Too many connections') ||
        error.message?.includes('Connection lost');

      if (!isRetryable || attempt === retryConfig.maxRetries) {
        throw new Error(
          `Failed to connect to MySQL after ${attempt} attempt(s): ${error.message}. ` +
            `Ensure MySQL is running: docker compose up -d mysql`
        );
      }

      log.warn(
        `Connection attempt ${attempt}/${retryConfig.maxRetries} failed: ${error.code || error.message}. ` +
          `Retrying in ${currentDelay}ms...`
      );

      await delay(currentDelay);
      currentDelay = Math.min(currentDelay * retryConfig.backoffMultiplier, retryConfig.maxDelayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error('Connection failed for unknown reason');
}

/**
 * Creates a new test database with unique name.
 * Ensures connection is closed on failure to prevent resource leaks.
 * Uses retry logic to handle MySQL startup timing issues.
 */
export async function createTestDatabase(config: TestDatabaseConfig = DEFAULT_TEST_CONFIG): Promise<mysql.Connection> {
  let connection: mysql.Connection | null = null;

  try {
    connection = await connectWithRetry(config);

    await connection.query(`DROP DATABASE IF EXISTS \`${config.database}\``);
    await connection.query(`CREATE DATABASE \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await connection.query(`USE \`${config.database}\``);

    log.debug(` Test database created: ${config.database}`);

    return connection;
  } catch (error) {
    if (connection) {
      try {
        await connection.end();
      } catch (closeError) {
        // Ignore close errors during cleanup
      }
    }
    throw error;
  }
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
  const criticalErrors: string[] = [];

  for (const statement of statements) {
    try {
      await connection.query(statement);
      if (statement.toLowerCase().includes('create table')) {
        createdTables++;
      }
    } catch (error: any) {
      // Ignore expected errors: DROP on non-existent tables, CREATE on existing tables
      const isExpectedError =
        error.message.includes("doesn't exist") ||
        error.message.includes('already exists');

      if (!isExpectedError) {
        // Collect critical errors - these indicate broken schema
        criticalErrors.push(`${error.message.substring(0, 100)}`);
      }
    }
  }

  // Re-enable foreign key checks
  await connection.query('SET FOREIGN_KEY_CHECKS = 1');

  // FAIL FAST: Critical errors mean the schema is broken
  if (criticalErrors.length > 0) {
    const errorSummary = criticalErrors.slice(0, 3).join('\n  ');
    const moreErrors = criticalErrors.length > 3 ? `\n  ... and ${criticalErrors.length - 3} more` : '';
    throw new Error(`Schema loading failed with ${criticalErrors.length} critical errors:\n  ${errorSummary}${moreErrors}`);
  }

  log.debug(` Schema loaded: ${createdTables} tables created`);
}

/**
 * Loads validation definitions from corequeries.sql into sitespecificvalidations table.
 * These are the SQL definitions for post-ingestion validations executed via the API.
 */
export async function loadValidationDefinitions(connection: mysql.Connection): Promise<void> {
  const coreQueriesPath = path.join(process.cwd(), 'sqlscripting', 'corequeries.sql');

  if (!fs.existsSync(coreQueriesPath)) {
    log.warn(`Core queries file not found: ${coreQueriesPath} - skipping validation definitions`);
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

      // Check if statement is complete
      // The INSERT statements end with one of these patterns:
      // 1. ", true);" or ", false);" - the IsEnabled value at end of VALUES clause
      // 2. "VALUES(IsEnabled);" - end of ON DUPLICATE KEY UPDATE clause
      // Simple "); check doesn't work because SQL definitions contain "...WHERE x = @p_PlotID);"
      const isEndOfStatement =
        /,\s*(true|false)\);$/.test(trimmed) ||  // End of VALUES clause: , true); or , false);
        /VALUES\s*\(\s*IsEnabled\s*\)\s*;$/.test(trimmed);  // End of ON DUPLICATE KEY UPDATE

      if (isEndOfStatement) {
        try {
          // Normalize escaping: convert backslash-escaped quotes (\') to standard SQL escaping ('')
          // This handles inconsistent escaping in the SQL file (some validations use \', others use '')
          const normalizedStatement = currentStatement.replace(/\\'/g, "''");
          await connection.query(normalizedStatement);
          insertedCount++;
        } catch (err: any) {
          errorCount++;
          if (errorCount <= 2) {
            log.warn(`Validation insert error: ${err.message.substring(0, 80)}`);
          }
        }
        currentStatement = '';
        inInsert = false;
      }
    }
  }

  if (errorCount > 2) {
    log.warn(`  ... and ${errorCount - 2} more validation insert errors`);
  }

  // Add inline validation definitions (used by stored procedure during ingestion, not via API)
  // These are required because measurement_error_log references error codes from sitespecificvalidations.
  // IMPORTANT: IsEnabled = false because these are INLINE validations executed during
  // bulkingestionprocess, NOT post-ingestion API validations. The Definition is empty
  // because the validation logic is embedded in the stored procedure itself.
  const inlineValidations = [
    {
      id: 20,
      name: 'SpeciesMismatchCrossCensus',
      desc: 'Tree recorded with different species than previous census (inline validation)'
    },
    {
      id: 21,
      name: 'SameBatchSpeciesConflict',
      desc: 'Same tree tag with different species in same batch (inline validation)'
    }
  ];

  for (const v of inlineValidations) {
    try {
      await connection.query(
        `INSERT IGNORE INTO sitespecificvalidations (ValidationID, ProcedureName, Description, Definition, IsEnabled)
         VALUES (?, ?, ?, '', false)`,
        [v.id, v.name, v.desc]
      );
      insertedCount++;
    } catch (err: any) {
      // Ignore duplicate key errors
      if (!err.message.includes('Duplicate')) {
        log.warn(`Inline validation insert error: ${err.message}`);
      }
    }
  }

  log.debug(` Loaded ${insertedCount} validation definitions${errorCount > 0 ? ` (${errorCount} errors)` : ''}`);
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
    const criticalErrors: Array<{ error: string; sql: string }> = [];

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
        // Ignore expected errors: DROP on non-existent, CREATE on existing
        const isExpectedError =
          err.message.includes('already exists') ||
          err.message.includes('does not exist');

        if (!isExpectedError) {
          const preview = cleaned.substring(0, 60).replace(/\n/g, ' ');
          criticalErrors.push({ error: err.message.substring(0, 80), sql: preview });
        }
      }
    }

    // FAIL FAST: Critical errors mean stored procedures are broken
    if (criticalErrors.length > 0) {
      const errorSummary = criticalErrors
        .slice(0, 3)
        .map(e => `${e.error}\n    SQL: ${e.sql}...`)
        .join('\n  ');
      const moreErrors = criticalErrors.length > 3 ? `\n  ... and ${criticalErrors.length - 3} more` : '';
      throw new Error(`Stored procedure loading failed with ${criticalErrors.length} critical errors:\n  ${errorSummary}${moreErrors}`);
    }

    log.debug(` Loaded ${loadedCount} stored procedures (${dropCount} drops executed)`);

    // Verify bulkingestionprocess exists
    try {
      const [rows] = await connection.query<mysql.RowDataPacket[]>('SHOW CREATE PROCEDURE bulkingestionprocess');

      if (rows.length > 0) {
        const procedureContent = rows[0]['Create Procedure'];
        if (procedureContent.includes('GROUP_CONCAT')) {
          log.debug(' Verified: bulkingestionprocess uses GROUP_CONCAT');
        } else {
          log.warn('bulkingestionprocess may not use GROUP_CONCAT');
        }
      }
    } catch (err: any) {
      log.warn(`Could not verify bulkingestionprocess: ${err.message}`);
    }
  } catch (error: any) {
    log.error(`Error loading stored procedures: ${error.message}`);
    throw error;
  }
}

/**
 * Parses sample data files from sampledata folder
 */
export function parseSampleDataFile(filePath: string): any[] {
  if (!fs.existsSync(filePath)) {
    log.warn(`Sample data file not found: ${filePath}`);
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
      log.warn(`Warning inserting species: ${err.message}`);
    }
  }
  log.debug(` Loaded ${testData.species.length} species`);

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
      log.warn(`Warning inserting attribute: ${err.message}`);
    }
  }
  log.debug(` Loaded ${testData.attributes.length} attributes`);

  // Create test plot (no sites table in schema)
  try {
    await connection.query(
      `INSERT INTO plots (PlotName, LocationName, CountryName, DimensionX, DimensionY, Area, GlobalX, GlobalY, GlobalZ, PlotShape, PlotDescription)
       VALUES ('Test Plot', 'Test Location', 'Panama', 500, 500, 250000, 0, 0, 0, 'square', 'Test plot for integration testing')`
    );

    const [plotRows] = await connection.query<mysql.RowDataPacket[]>('SELECT PlotID FROM plots WHERE PlotName = ?', ['Test Plot']);
    const plotID = plotRows[0].PlotID;
    testData.plots = [{ plotID, plotName: 'Test Plot', num_quadrats: 10 }];
    log.debug(` Created test plot (ID: ${plotID})`);

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
    log.debug(` Created ${testData.quadrats.length} quadrats`);

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
    log.debug(` Created test census (ID: ${censusID})`);
  } catch (err: any) {
    log.error(`Error creating test data: ${err.message}`);
    throw err;
  }

  log.debug(' Sample data seeded successfully');

  return testData;
}

/**
 * Seeds the measurement_errors catalog table with all known error codes.
 *
 * This must run BEFORE any validation SQL or bulkingestionprocess call, because:
 * - Validation definitions INSERT into measurement_error_log with ErrorID looked up
 *   from measurement_errors via (ErrorSource='validation', ErrorCode=ValidationID)
 * - bulkingestionprocess also seeds this table, but tests that bypass ingestion
 *   (e.g. post-ingestion validation tests using insertDirectMeasurements) need it
 *   pre-populated
 *
 * The ingestion error codes match storedprocedures.sql lines 1168-1183.
 * The validation error codes are generated from sitespecificvalidations rows.
 */
export async function seedMeasurementErrors(connection: mysql.Connection): Promise<void> {
  // Seed ingestion error codes (same as bulkingestionprocess)
  await connection.query(`
    INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage) VALUES
      ('ingestion', 'MISSING_FIELD_TREETAG',    'Missing required field: TreeTag'),
      ('ingestion', 'MISSING_FIELD_STEMTAG',     'Missing required field: StemTag'),
      ('ingestion', 'MISSING_FIELD_SPECIESCODE', 'Missing required field: SpeciesCode'),
      ('ingestion', 'MISSING_FIELD_QUADRATNAME', 'Missing required field: QuadratName'),
      ('ingestion', 'MISSING_FIELD_DATE',        'Missing required field: MeasurementDate'),
      ('ingestion', 'INVALID_QUADRAT',           'Invalid quadrat reference'),
      ('ingestion', 'INVALID_SPECIES',           'Invalid species reference'),
      ('ingestion', 'QUADRAT_MISMATCH',          'Quadrat mismatch across censuses'),
      ('ingestion', 'COORDINATE_DRIFT',          'Coordinate drift exceeds allowed threshold'),
      ('ingestion', 'DUPLICATE_ENTRY',           'Duplicate measurement row detected'),
      ('ingestion', 'NEGATIVE_DBH',              'DBH must be non-negative'),
      ('ingestion', 'NEGATIVE_HOM',              'HOM must be non-negative'),
      ('ingestion', 'FIELD_TOO_LONG',            'One or more fields exceed column length limits'),
      ('ingestion', 'MISSING_MEASUREMENT_DATA',  'Missing measurement data'),
      ('ingestion', 'SQL_EXCEPTION',             'Ingestion SQL exception')
  `);

  // Seed validation error codes — one row per sitespecificvalidations entry.
  // ErrorCode stores the ValidationID as a string (e.g. '1', '2', '14').
  // Validation SQL definitions look up ErrorID via:
  //   SELECT ErrorID FROM measurement_errors WHERE ErrorSource='validation' AND ErrorCode=CAST(@validationProcedureID AS CHAR)
  const [validations] = await connection.query<mysql.RowDataPacket[]>(
    'SELECT ValidationID, ProcedureName, Description FROM sitespecificvalidations ORDER BY ValidationID'
  );

  for (const v of validations) {
    const errorMessage = `Validation ${v.ValidationID}: ${v.Description || v.ProcedureName}`;
    await connection.query(
      `INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
       VALUES ('validation', CAST(? AS CHAR), ?)`,
      [v.ValidationID, errorMessage]
    );
  }

  log.debug(` Seeded measurement_errors: 15 ingestion + ${validations.length} validation error codes`);
}

/**
 * Backfills UploadFileID and UploadBatchID from legacy uploadSession JSON.
 *
 * Tests that seed legacy successful rows can call this helper before exercising
 * verification or retry flows that now treat the direct upload tracking
 * columns as canonical.
 */
export async function backfillLegacyUploadTrackingColumns(
  connection: mysql.Connection
): Promise<{
  backfilledRows: number;
  remainingRowsWithMetadataGaps: number;
  conflictingRows: number;
}> {
  const [updateResult] = await connection.query<mysql.ResultSetHeader>(`
    UPDATE coremeasurements
    SET UploadFileID = COALESCE(
          UploadFileID,
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(UserDefinedFields, '$.uploadSession.fileID')), 'null')
        ),
        UploadBatchID = COALESCE(
          UploadBatchID,
          NULLIF(JSON_UNQUOTE(JSON_EXTRACT(UserDefinedFields, '$.uploadSession.batchID')), 'null')
        )
    WHERE JSON_EXTRACT(UserDefinedFields, '$.uploadSession') IS NOT NULL
      AND (UploadFileID IS NULL OR UploadBatchID IS NULL)
  `);

  const [remainingRows] = await connection.query<mysql.RowDataPacket[]>(`
    SELECT COUNT(*) AS count
    FROM coremeasurements
    WHERE JSON_EXTRACT(UserDefinedFields, '$.uploadSession') IS NOT NULL
      AND (UploadFileID IS NULL OR UploadBatchID IS NULL)
  `);

  const [conflictingRows] = await connection.query<mysql.RowDataPacket[]>(`
    SELECT COUNT(*) AS count
    FROM coremeasurements
    WHERE JSON_EXTRACT(UserDefinedFields, '$.uploadSession') IS NOT NULL
      AND (
        (UploadFileID IS NOT NULL AND UploadFileID <> NULLIF(JSON_UNQUOTE(JSON_EXTRACT(UserDefinedFields, '$.uploadSession.fileID')), 'null'))
        OR
        (UploadBatchID IS NOT NULL AND UploadBatchID <> NULLIF(JSON_UNQUOTE(JSON_EXTRACT(UserDefinedFields, '$.uploadSession.batchID')), 'null'))
      )
  `);

  return {
    backfilledRows: updateResult.affectedRows,
    remainingRowsWithMetadataGaps: Number(remainingRows[0]?.count || 0),
    conflictingRows: Number(conflictingRows[0]?.count || 0)
  };
}

/**
 * Complete setup of test database with schema, procedures, and data.
 * Ensures cleanup on any failure during setup to prevent resource leaks.
 */
export async function setupTestDatabase(config: TestDatabaseConfig = DEFAULT_TEST_CONFIG): Promise<{
  connection: mysql.Connection;
  testData: TestData;
  config: TestDatabaseConfig;
}> {
  log.info('Setting up test database...');

  let connection: mysql.Connection | null = null;

  try {
    connection = await createTestDatabase(config);
    await loadSchema(connection);
    await loadStoredProcedures(connection);
    await loadValidationDefinitions(connection);
    await seedMeasurementErrors(connection);
    const testData = await seedSampleData(connection);

    log.debug(' Test database setup complete\n');

    return { connection, testData, config };
  } catch (error) {
    log.error('Test database setup failed, cleaning up...');
    if (connection) {
      try {
        await connection.query(`DROP DATABASE IF EXISTS \`${config.database}\``);
      } catch (dropError) {
        // Ignore drop errors during cleanup
      }
      try {
        await connection.end();
      } catch (closeError) {
        // Ignore close errors during cleanup
      }
    }
    throw error;
  }
}

/**
 * Teardown and cleanup test database.
 * Handles all edge cases: null connection, already-closed connection, missing database.
 *
 * @param connection - The database connection (can be null/undefined if setup failed)
 * @param config - Only needs `database` field; other fields use defaults
 */
export async function teardownTestDatabase(
  connection: mysql.Connection | null | undefined,
  config: Pick<TestDatabaseConfig, 'database'> = DEFAULT_TEST_CONFIG
): Promise<void> {
  log.info('Cleaning up test database...');

  if (!connection) {
    log.warn('No connection to clean up');
    return;
  }

  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${config.database}\``);
    log.debug(` Test database dropped: ${config.database}`);
  } catch (error: any) {
    // Connection may already be closed or database may not exist
    if (!error.message.includes('PROTOCOL_CONNECTION_LOST') && !error.message.includes("doesn't exist")) {
      log.warn(`Warning during database drop: ${error.message}`);
    }
  }

  try {
    await connection.end();
    log.debug(' Connection closed\n');
  } catch (error: any) {
    // Connection may already be closed
    if (!error.message.includes('PROTOCOL_CONNECTION_LOST') && !error.message.includes('already been closed')) {
      log.warn(`Warning during connection close: ${error.message}`);
    } else {
      log.debug(' Connection already closed\n');
    }
  }
}

/**
 * Tables to clean between tests, in FK-safe deletion order.
 * Order: leaf tables first (no children), then parent tables.
 *
 * FK chain:
 *   measurement_error_log → coremeasurements, measurement_errors
 *   cmattributes → coremeasurements
 *   coremeasurements → stems → trees
 *   stems → quadrats (preserved)
 *   trees → species (preserved), census
 */
const MEASUREMENT_TABLES_DELETE_ORDER = [
  'measurement_error_log', // Leaf: depends on coremeasurements + measurement_errors
  'cmattributes',          // Leaf: depends on coremeasurements
  'coremeasurements',      // Parent of measurement_error_log, cmattributes; child of stems
  'stems',                 // Parent of coremeasurements; child of trees, quadrats
  'trees',                 // Parent of stems; child of species, census
  'temporarymeasurements'  // Standalone (no FKs)
] as const;

/**
 * Cleans up measurement-related tables between tests.
 * Preserves seed data: plots, quadrats, species, attributes.
 *
 * Use this in beforeEach() to ensure test isolation:
 * ```typescript
 * beforeEach(async () => {
 *   await cleanupTestMeasurements(connection, testData);
 * });
 * ```
 *
 * @param connection - Database connection
 * @param testData - Test data containing initial census to preserve
 * @param options - Optional configuration:
 *   - additionalTables: extra tables to delete
 *   - preserveCensusCount: number of census records to keep (default: all from testData.census)
 */
export async function cleanupTestMeasurements(
  connection: mysql.Connection,
  testData?: TestData,
  options: {
    additionalTables?: string[];
    preserveCensusCount?: number;
  } = {}
): Promise<void> {
  const { additionalTables = [] } = options;

  // Delete from measurement tables in FK-safe order
  for (const table of MEASUREMENT_TABLES_DELETE_ORDER) {
    await connection.query(`DELETE FROM ${table}`);
  }

  // Delete any additional tables specified
  for (const table of additionalTables) {
    await connection.query(`DELETE FROM ${table}`);
  }

  // Clean up dynamically created census records if testData is provided
  // This prevents test isolation issues when tests create census records mid-test
  if (testData?.plots?.[0]?.plotID) {
    const plotID = testData.plots[0].plotID;

    // Determine how many census records to preserve
    const preserveCount = options.preserveCensusCount ?? testData.census?.length ?? 1;

    if (preserveCount > 0 && testData.census?.length > 0) {
      // Get the IDs of census records we want to keep (the first N from testData)
      const censusIDsToKeep = testData.census
        .slice(0, preserveCount)
        .map(c => c.censusID)
        .filter(id => id != null);

      if (censusIDsToKeep.length > 0) {
        // Delete any census records not in our preserve list
        await connection.query(
          `DELETE FROM census WHERE PlotID = ? AND CensusID NOT IN (${censusIDsToKeep.join(',')})`,
          [plotID]
        );
      }
    }
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

    // If stored procedure caught an error internally, fetch full error details
    if (row?.batch_failed) {
      const [metrics] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT errorMessage FROM uploadmetrics WHERE batchID = ? ORDER BY endTime DESC LIMIT 1',
        [batchID]
      );
      const fullMessage = metrics?.[0]?.errorMessage || row?.message || 'Unknown error';
      return {
        success: false,
        message: fullMessage,
        batch_failed: row.batch_failed
      };
    }

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
  plotID: number;
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
    plotID,
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
 * Helper to get validation errors for specific measurements.
 * Queries the unified measurement_error_log + measurement_errors tables.
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
    MeasurementID: number;
    ErrorID: number;
    ValidationErrorID: number;
    CoreMeasurementID: number;
    ProcedureName: string;
    Description: string;
  }>
> {
  let query = `
    SELECT mel.MeasurementID, mel.ErrorID,
           CAST(me.ErrorCode AS UNSIGNED) AS ValidationErrorID,
           mel.MeasurementID AS CoreMeasurementID,
           ssv.ProcedureName, ssv.Description
    FROM measurement_error_log mel
    JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
    LEFT JOIN sitespecificvalidations ssv ON me.ErrorCode = CAST(ssv.ValidationID AS CHAR)
    LEFT JOIN coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
    LEFT JOIN stems s ON s.StemGUID = cm.StemGUID
    LEFT JOIN trees t ON t.TreeID = s.TreeID
    WHERE me.ErrorSource = 'validation'
      AND mel.IsResolved = FALSE
  `;
  const params: any[] = [];

  if (options.censusID) {
    query += ' AND cm.CensusID = ?';
    params.push(options.censusID);
  }
  if (options.validationID) {
    query += ' AND me.ErrorCode = CAST(? AS CHAR)';
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
 * Helper to get failed measurements (unresolved ingestion errors).
 * Queries coremeasurements WHERE StemGUID IS NULL with measurement_error_log join.
 */
export async function getFailedMeasurements(
  connection: mysql.Connection,
  options: {
    fileID?: string;
    batchID?: string;
    tag?: string;
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
  let query = `
    SELECT
      cm.CoreMeasurementID AS FailedMeasurementID,
      cm.UploadFileID AS FileID,
      cm.UploadBatchID AS BatchID,
      cm.RawTreeTag AS Tag,
      cm.RawStemTag AS StemTag,
      GROUP_CONCAT(DISTINCT me.ErrorMessage ORDER BY me.ErrorCode SEPARATOR '; ') AS FailureReasons
    FROM coremeasurements cm
    JOIN measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
    JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
    WHERE cm.StemGUID IS NULL
      AND me.ErrorSource = 'ingestion'
      AND mel.IsResolved = FALSE
  `;
  const params: any[] = [];

  if (options.fileID) {
    query += ' AND cm.UploadFileID = ?';
    params.push(options.fileID);
  }
  if (options.batchID) {
    query += ' AND cm.UploadBatchID = ?';
    params.push(options.batchID);
  }
  if (options.tag) {
    query += ' AND cm.RawTreeTag = ?';
    params.push(options.tag);
  }

  query += ' GROUP BY cm.CoreMeasurementID, cm.UploadFileID, cm.UploadBatchID, cm.RawTreeTag, cm.RawStemTag';

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

  log.debug(` Seeded ${statusCodes.length} status attribute codes`);
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

  log.debug(` Seeded ${species.length} species with DBH limits`);
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
  /** Seed for deterministic random generation. Default: 12345 */
  seed?: number;
}

/**
 * Simple seeded pseudo-random number generator (Mulberry32).
 * Provides deterministic "random" values for reproducible tests.
 */
function seededRandom(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates an array of test measurements for bulk testing.
 *
 * IMPORTANT: Uses a seeded random generator for DETERMINISTIC results.
 * This ensures tests are reproducible and don't become flaky due to
 * DBH/date values drifting into failure thresholds.
 *
 * @param testData - Test data containing species and quadrats
 * @param options - Generation options including optional seed for reproducibility
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
    dateRange = { start: '2024-01-01', end: '2024-12-31' },
    seed = 12345 // Default seed for reproducibility
  } = options;

  // Use seeded random for deterministic test data
  const random = seededRandom(seed);

  const measurements: DirectMeasurement[] = [];

  for (let i = 1; i <= count; i++) {
    const dbh = dbhRange.min + random() * (dbhRange.max - dbhRange.min);
    const x = random() * 20; // Within typical quadrat dimensions
    const y = random() * 20;

    // Generate a date within the range
    const startMs = new Date(dateRange.start).getTime();
    const endMs = new Date(dateRange.end).getTime();
    const dateMs = startMs + random() * (endMs - startMs);
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
    log.warn(`Validation ${validationID} not found or not enabled`);
    return false;
  }

  const { ProcedureName, Definition } = validation;

  // Safety check: Skip validations with empty definitions
  // (Inline validations 20/21 have empty Definition because they run during ingestion, not via API)
  if (!Definition || Definition.trim() === '') {
    log.warn(`Validation ${ProcedureName} has empty Definition - skipping (this is an inline validation)`);
    return false;
  }

  // Clear stale validation errors for this validation
  const cleanupQuery = `
    DELETE mel FROM measurement_error_log mel
    JOIN measurement_errors me ON me.ErrorID = mel.ErrorID
    JOIN coremeasurements cm ON cm.CoreMeasurementID = mel.MeasurementID
    JOIN census c ON cm.CensusID = c.CensusID
    WHERE me.ErrorSource = 'validation'
      AND me.ErrorCode = CAST(? AS CHAR)
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
    log.error(`Validation ${ProcedureName} failed: ${error.message}`);
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
  /** Census 2 x-coordinate (defaults to x if omitted) */
  x2?: number;
  /** Census 2 y-coordinate (defaults to y if omitted) */
  y2?: number;
  /** Census 2 quadrat name (defaults to quadratName if omitted) */
  quadratName2?: string;
}

/**
 * Inserts measurements that span two censuses with census-versioned tree/stem records.
 * This is required for cross-census validations (1, 2) which compare
 * measurements across censuses by matching on TreeTag/StemTag.
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

    // Census-versioned records: validation queries join stems/trees with CensusID,
    // e.g. `s_present.StemGUID = cm_present.StemGUID AND s_present.CensusID = cm_present.CensusID`
    // so each census needs its own tree and stem records.

    // Census 1 tree + stem
    await connection.query(
      'INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)',
      [meas.treeTag, speciesID, census1ID]
    );
    const [tree1Rows] = await connection.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() as TreeID');
    const tree1ID = tree1Rows[0].TreeID;

    await connection.query(
      `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [tree1ID, quadratID, census1ID, meas.stemTag, meas.x, meas.y]
    );
    const [stem1Rows] = await connection.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() as StemGUID');
    const stemGUID1 = stem1Rows[0].StemGUID;

    // Census 2 tree + stem (same TreeTag/StemTag, different CensusID and StemGUID)
    // Use census2-specific coordinates if provided, otherwise use census1 coordinates
    const x2 = meas.x2 ?? meas.x;
    const y2 = meas.y2 ?? meas.y;
    const quadratID2 = meas.quadratName2
      ? (await connection.query<mysql.RowDataPacket[]>(
          'SELECT QuadratID FROM quadrats WHERE QuadratName = ? AND PlotID = ?',
          [meas.quadratName2, plotID]
        ))[0][0]?.QuadratID ?? quadratID
      : quadratID;

    await connection.query(
      'INSERT INTO trees (TreeTag, SpeciesID, CensusID, IsActive) VALUES (?, ?, ?, 1)',
      [meas.treeTag, speciesID, census2ID]
    );
    const [tree2Rows] = await connection.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() as TreeID');
    const tree2ID = tree2Rows[0].TreeID;

    await connection.query(
      `INSERT INTO stems (TreeID, QuadratID, CensusID, StemTag, LocalX, LocalY, IsActive)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [tree2ID, quadratID2, census2ID, meas.stemTag, x2, y2]
    );
    const [stem2Rows] = await connection.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() as StemGUID');
    const stemGUID2 = stem2Rows[0].StemGUID;
    stemGUIDs.push(stemGUID1, stemGUID2);

    // Census 1 measurement (validated = true, as if already processed)
    await connection.query(
      `INSERT INTO coremeasurements
       (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
       VALUES (?, ?, ?, ?, ?, 1, 1)`,
      [stemGUID1, census1ID, meas.census1DBH, meas.hom, meas.census1Date]
    );
    const [cm1Rows] = await connection.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() as CoreMeasurementID');
    const cm1ID = cm1Rows[0].CoreMeasurementID;
    census1MeasurementIDs.push(cm1ID);

    // Census 2 measurement (validated = null, as if newly ingested)
    await connection.query(
      `INSERT INTO coremeasurements
       (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate, IsValidated, IsActive)
       VALUES (?, ?, ?, ?, ?, NULL, 1)`,
      [stemGUID2, census2ID, meas.census2DBH, meas.hom, meas.census2Date]
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
    plotID: testData.census[0].plotID,
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
