import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const dbConfig = {
  host: process.env.AZURE_SQL_SERVER || 'forestgeo-mysqldataserver.mysql.database.azure.com',
  user: process.env.AZURE_SQL_USER || 'azureroot',
  password: process.env.AZURE_SQL_PASSWORD,
  database: process.env.AZURE_SQL_SCHEMA || 'forestgeo_testing',
  port: parseInt(process.env.AZURE_SQL_PORT || '3306'),
  multipleStatements: true
};

async function reloadValidations() {
  console.log('🔄 Reloading validation queries...\n');

  const connection = await mysql.createConnection(dbConfig);

  try {
    // Read corequeries.sql
    const sqlPath = path.join(process.cwd(), 'sqlscripting', 'corequeries.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('📄 Read corequeries.sql');

    // Clear existing validations
    console.log('🗑️  Clearing existing validations...');
    await connection.query(`DELETE FROM ${dbConfig.database}.sitespecificvalidations WHERE ValidationID IN (7, 8, 11)`);
    console.log('✓ Cleared validations 7, 8, 11\n');

    // Execute the SQL file to reload validations
    console.log('⚙️  Executing SQL to reload validations...');

    // Use multipleStatements to execute the entire file
    try {
      await connection.query(sql);
      console.log('✓ Validations reloaded\n');
    } catch (err: any) {
      if (err.code !== 'ER_DUP_ENTRY') {
        console.error('Warning:', err.message.substring(0, 100));
        console.log('Continuing...\n');
      }
    }

    // Verify
    const [validations] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT ValidationID, ProcedureName, Description
       FROM ${dbConfig.database}.sitespecificvalidations
       WHERE ValidationID IN (7, 8, 11)
       ORDER BY ValidationID`
    );

    console.log('✓ Verified reloaded validations:');
    for (const v of validations) {
      console.log(`  [${v.ValidationID}] ${v.ProcedureName}`);
      console.log(`      ${v.Description.substring(0, 80)}...`);
    }
  } finally {
    await connection.end();
  }

  console.log('\n✓ Reload complete!');
}

reloadValidations().catch(console.error);
