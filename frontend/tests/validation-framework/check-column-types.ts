/**
 * Check specific column types in the database
 */

import mysql from 'mysql2/promise';

const dbConfig = {
  host: process.env.AZURE_SQL_SERVER || 'forestgeo-mysqldataserver.mysql.database.azure.com',
  user: process.env.AZURE_SQL_USER || 'azureroot',
  password: process.env.AZURE_SQL_PASSWORD || 'P@ssw0rd',
  port: parseInt(process.env.AZURE_SQL_PORT || '3306'),
  database: process.env.AZURE_SQL_SCHEMA || 'forestgeo_testing'
};

async function checkColumnTypes() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log('\n Column Type Check\n');

    // Check StemGUID type
    const [stemCols] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = 'stems'
         AND COLUMN_NAME IN ('StemGUID', 'StemCrossID')`,
      [dbConfig.database]
    );

    console.log(' Stems table columns:');
    stemCols.forEach((c: any) => {
      console.log(`   ${c.COLUMN_NAME.padEnd(20)} ${c.DATA_TYPE.padEnd(15)} ${c.COLUMN_TYPE}`);
    });

    // Check  CoreMeasurementID type
    const [cmCols] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = 'coremeasurements'
         AND COLUMN_NAME IN ('CoreMeasurementID', 'StemGUID')`,
      [dbConfig.database]
    );

    console.log('\n CoreMeasurements table columns:');
    cmCols.forEach((c: any) => {
      console.log(`   ${c.COLUMN_NAME.padEnd(20)} ${c.DATA_TYPE.padEnd(15)} ${c.COLUMN_TYPE}`);
    });

    console.log('\n');
  } finally {
    await connection.end();
  }
}

checkColumnTypes();
