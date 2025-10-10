/**
 * Setup Test Database
 *
 * This script checks if the test database has validation queries populated
 * and optionally loads them from corequeries.sql
 *
 * Usage:
 * ```bash
 * npx tsx tests/validation-framework/setup-test-database.ts
 * ```
 */

import mysql from 'mysql2/promise';
import * as fs from 'fs';
import * as path from 'path';

const dbConfig = {
  host: process.env.AZURE_SQL_SERVER || 'forestgeo-mysqldataserver.mysql.database.azure.com',
  user: process.env.AZURE_SQL_USER || 'azureroot',
  password: process.env.AZURE_SQL_PASSWORD || 'P@ssw0rd',
  port: parseInt(process.env.AZURE_SQL_PORT || '3306'),
  database: process.env.AZURE_SQL_SCHEMA || 'forestgeo_testing',
  multipleStatements: true // Allow running multiple SQL statements
};

async function checkDatabase() {
  console.log('\n════════════════════════════════════════════════════');
  console.log('       Test Database Validation Setup');
  console.log('════════════════════════════════════════════════════\n');

  let connection: mysql.Connection | null = null;

  try {
    // Connect to database
    console.log('🔍 Connecting to database...');
    console.log(`  Host: ${dbConfig.host}`);
    console.log(`  Database: ${dbConfig.database}\n`);

    connection = await mysql.createConnection(dbConfig);
    console.log('✓ Connected successfully!\n');

    // Check if sitespecificvalidations table exists
    console.log('🔍 Checking sitespecificvalidations table...');
    const [tables] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) as count
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'sitespecificvalidations'`,
      [dbConfig.database]
    );

    if (tables[0].count === 0) {
      console.log('✗ Table sitespecificvalidations does not exist!\n');
      console.log('💡 You need to create the schema first:');
      console.log('   1. Run sqlscripting/tablestructures.sql');
      console.log('   2. Then run this script again\n');
      process.exit(1);
    }

    console.log('✓ Table sitespecificvalidations exists\n');

    // Check how many validations are loaded
    console.log('🔍 Checking existing validations...');
    const [validations] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT ValidationID, ProcedureName, IsEnabled
       FROM ${dbConfig.database}.sitespecificvalidations
       ORDER BY ValidationID`
    );

    console.log(`✓ Found ${validations.length} validations in database\n`);

    if (validations.length > 0) {
      console.log('Existing validations:');
      validations.forEach((v: any) => {
        const status = v.IsEnabled ? '✓' : '✗';
        console.log(`  ${status} [${v.ValidationID}] ${v.ProcedureName}`);
      });
      console.log('');
    }

    // Check if we need to load validations
    if (validations.length === 0) {
      console.log('⚠️  No validations found. Would you like to load them from corequeries.sql?');
      console.log('   This will populate the sitespecificvalidations table.\n');

      // Check if corequeries.sql exists
      const corequeriesPath = path.join(process.cwd(), 'sqlscripting', 'corequeries.sql');

      if (!fs.existsSync(corequeriesPath)) {
        console.log(`✗ corequeries.sql not found at: ${corequeriesPath}\n`);
        process.exit(1);
      }

      console.log(`✓ Found corequeries.sql at: ${corequeriesPath}\n`);
      console.log('Loading validations...');

      // Read and execute corequeries.sql
      const sql = fs.readFileSync(corequeriesPath, 'utf8');
      await connection.query(sql);

      console.log('✓ Validations loaded successfully!\n');

      // Re-check count
      const [newValidations] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) as count FROM ${dbConfig.database}.sitespecificvalidations`
      );

      console.log(`✓ Database now has ${newValidations[0].count} validations\n`);
    } else if (validations.length < 15) {
      console.log('⚠️  Warning: Expected 15 validations, found ' + validations.length);
      console.log('   Some validations may be missing.\n');
    }

    // Check for specific validations needed by tests
    const requiredValidations = [1, 2, 3, 6, 8, 14, 15];
    const existingIDs = validations.map((v: any) => v.ValidationID);
    const missingIDs = requiredValidations.filter(id => !existingIDs.includes(id));

    if (missingIDs.length > 0) {
      console.log('⚠️  Missing validations required for tests:');
      missingIDs.forEach(id => console.log(`   - Validation ${id}`));
      console.log('\n💡 You may need to reload corequeries.sql\n');
    } else {
      console.log('✓ All required validations present for testing!\n');
    }

    // Check other required tables
    console.log('🔍 Checking other required tables...');
    const requiredTables = [
      'plots',
      'census',
      'quadrats',
      'species',
      'trees',
      'stems',
      'coremeasurements',
      'cmattributes',
      'attributes',
      'cmverrors'
    ];

    const [existingTables] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME IN (${requiredTables.map(() => '?').join(',')})`,
      [dbConfig.database, ...requiredTables]
    );

    const existingTableNames = existingTables.map((t: any) => t.TABLE_NAME);
    const missingTables = requiredTables.filter(t => !existingTableNames.includes(t));

    if (missingTables.length > 0) {
      console.log('✗ Missing required tables:');
      missingTables.forEach(t => console.log(`   - ${t}`));
      console.log('\n💡 Run sqlscripting/tablestructures.sql to create all tables\n');
    } else {
      console.log('✓ All required tables exist\n');
    }

    console.log('════════════════════════════════════════════════════');
    console.log('                 Setup Complete!');
    console.log('════════════════════════════════════════════════════\n');

    console.log('✓ You can now run validation tests with:');
    console.log('  npm run test:validations\n');
  } catch (error: any) {
    console.error('\n✗ Error:', error.message);
    console.error('  Stack:', error.stack);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkDatabase();
