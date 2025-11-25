/**
 * Setup Validations for Testing
 *
 * This script loads validation queries from corequeries.sql into the database
 * before running validation tests. It should be called in the beforeAll hook
 * of validation test suites.
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

export interface DatabaseConfig {
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
}

/**
 * Load validations from corequeries.sql into the database
 */
export async function setupValidations(connection: mysql.Connection, schema: string): Promise<void> {
  try {
    console.log('🔄 Loading validation queries...');

    // Read corequeries.sql
    const sqlPath = path.join(process.cwd(), 'sqlscripting', 'corequeries.sql');

    if (!fs.existsSync(sqlPath)) {
      console.warn(`⚠ corequeries.sql not found at ${sqlPath}`);
      console.warn('  Validation queries may not be loaded. Tests may fail.');
      return;
    }

    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('  ✓ Read corequeries.sql');

    // Create a new connection with multipleStatements enabled
    // This is needed because corequeries.sql contains multiple INSERT statements
    const multiStmtConnection = await mysql.createConnection({
      host: connection.config.host,
      user: connection.config.user,
      password: connection.config.password,
      database: connection.config.database,
      port: connection.config.port as number,
      multipleStatements: true
    });

    try {
      // Execute the entire SQL file
      await multiStmtConnection.query(sql);
      console.log('  ✓ Executed SQL statements');
    } catch (err: any) {
      // Ignore duplicate key errors (validations may already exist)
      if (err.code !== 'ER_DUP_ENTRY') {
        console.warn(`  ⚠ Warning executing SQL: ${err.message.substring(0, 100)}`);
      }
    } finally {
      await multiStmtConnection.end();
    }

    // Verify validations were loaded
    const [validations] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT ValidationID, ProcedureName FROM ${schema}.sitespecificvalidations ORDER BY ValidationID`
    );

    console.log(`  ✓ Loaded ${validations.length} validation queries`);

    // Log which validations are available
    const validationIds = validations.map(v => v.ValidationID);
    console.log(`  ✓ Available validations: ${validationIds.join(', ')}`);
  } catch (error: any) {
    console.error('❌ Error loading validation queries:', error.message);
    throw error;
  }
}

/**
 * Check if validations are already loaded in the database
 */
export async function checkValidations(connection: mysql.Connection, schema: string): Promise<boolean> {
  try {
    const [validations] = await connection.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) as count FROM ${schema}.sitespecificvalidations`);

    const count = validations[0].count;
    console.log(`  Found ${count} validations in database`);

    return count > 0;
  } catch (error: any) {
    console.error('❌ Error checking validations:', error.message);
    return false;
  }
}
