/**
 * Detect Schema Columns
 *
 * This script detects which columns exist in the test database tables
 * to make the test framework schema-version agnostic
 */

import mysql from 'mysql2/promise';

const dbConfig = {
  host: process.env.AZURE_SQL_SERVER || 'forestgeo-mysqldataserver.mysql.database.azure.com',
  user: process.env.AZURE_SQL_USER || 'azureroot',
  password: process.env.AZURE_SQL_PASSWORD || 'P@ssw0rd',
  port: parseInt(process.env.AZURE_SQL_PORT || '3306'),
  database: process.env.AZURE_SQL_SCHEMA || 'forestgeo_testing'
};

async function detectSchema() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    const tables = ['plots', 'census', 'quadrats', 'species', 'trees', 'stems', 'coremeasurements', 'attributes'];

    console.log('\n Schema Column Detection\n');
    console.log(' Checking for IsActive column in tables...\n');

    for (const table of tables) {
      const [columns] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME = ?`,
        [dbConfig.database, table]
      );

      const columnNames = columns.map((c: any) => c.COLUMN_NAME);
      const hasIsActive = columnNames.includes('IsActive');

      console.log(`  ${table.padEnd(20)} ${hasIsActive ? '✓ Has IsActive' : '✗ No IsActive'}`);
    }

    console.log('\n');
  } finally {
    await connection.end();
  }
}

detectSchema();
