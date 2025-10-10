/**
 * Quick script to check what validations exist in the database
 */

import mysql from 'mysql2/promise';

const dbConfig = {
  host: process.env.AZURE_SQL_SERVER || 'forestgeo-mysqldataserver.mysql.database.azure.com',
  user: process.env.AZURE_SQL_USER || 'azureroot',
  password: process.env.AZURE_SQL_PASSWORD || 'P@ssw0rd',
  port: parseInt(process.env.AZURE_SQL_PORT || '3306'),
  database: process.env.AZURE_SQL_SCHEMA || 'forestgeo_testing'
};

async function checkValidations() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    const [validations] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT ValidationID, ProcedureName, Description, IsEnabled
       FROM ${dbConfig.database}.sitespecificvalidations
       ORDER BY ValidationID`
    );

    console.log('\n Current Validations in Database:\n');
    console.log('  ID | Enabled | Procedure Name');
    console.log('  ---|---------|' + '-'.repeat(60));

    validations.forEach((v: any) => {
      const enabled = v.IsEnabled ? '✓' : '✗';
      console.log(`  ${String(v.ValidationID).padStart(2)} | ${enabled}       | ${v.ProcedureName}`);
    });

    console.log('\n');
  } finally {
    await connection.end();
  }
}

checkValidations();
