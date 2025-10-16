/**
 * Deploy Validation Queries to All ForestGEO Schemas
 *
 * This script applies the latest validation queries from corequeries.sql
 * to all forestgeo_* schemas in the database.
 *
 * Usage: npx tsx scripts/deploy-validations-to-all-schemas.ts
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

async function deployValidationsToAllSchemas() {
  console.log('🚀 Starting validation deployment to all ForestGEO schemas...\n');

  // Check for required environment variables
  if (!process.env.AZURE_SQL_PASSWORD) {
    console.error('❌ Error: AZURE_SQL_PASSWORD environment variable not set');
    console.error('Please set the password in your environment or .env.local file');
    process.exit(1);
  }

  // Create database connection
  const connection = await mysql.createConnection({
    host: 'forestgeo-mysqldataserver.mysql.database.azure.com',
    user: 'azureroot',
    password: process.env.AZURE_SQL_PASSWORD,
    port: 3306,
    multipleStatements: false // We'll handle statements manually
  });

  try {
    // Step 1: Get all forestgeo_* schemas
    console.log('📋 Step 1: Finding all ForestGEO schemas...');
    const [schemas] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT SCHEMA_NAME as schema_name
       FROM INFORMATION_SCHEMA.SCHEMATA
       WHERE SCHEMA_NAME LIKE 'forestgeo_%'
       ORDER BY SCHEMA_NAME`
    );

    if (schemas.length === 0) {
      console.log('⚠️  No forestgeo_* schemas found!');
      return;
    }

    console.log(`✓ Found ${schemas.length} ForestGEO schemas:`);
    schemas.forEach((row: any) => console.log(`  - ${row.schema_name}`));
    console.log();

    // Step 2: Read corequeries.sql
    console.log('📖 Step 2: Reading corequeries.sql...');
    const sqlPath = path.join(process.cwd(), 'sqlscripting', 'corequeries.sql');

    if (!fs.existsSync(sqlPath)) {
      throw new Error(`corequeries.sql not found at: ${sqlPath}`);
    }

    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    console.log(`✓ Read ${sqlContent.length} characters from corequeries.sql\n`);

    // Step 3: Apply to each schema
    console.log('🔄 Step 3: Applying validations to each schema...\n');

    const results = {
      successful: [] as string[],
      failed: [] as { schema: string; error: string }[]
    };

    for (const row of schemas) {
      const schema = (row as any).schema_name;
      console.log(`📦 Processing schema: ${schema}`);

      try {
        // Create a new connection with multipleStatements enabled for this schema
        const schemaConnection = await mysql.createConnection({
          host: 'forestgeo-mysqldataserver.mysql.database.azure.com',
          user: 'azureroot',
          password: process.env.AZURE_SQL_PASSWORD!,
          database: schema,
          port: 3306,
          multipleStatements: true
        });

        // Execute the SQL
        await schemaConnection.query(sqlContent);

        // Verify validations were loaded
        const [validations] = await schemaConnection.query<mysql.RowDataPacket[]>(
          'SELECT ValidationID, ProcedureName, IsEnabled FROM sitespecificvalidations ORDER BY ValidationID'
        );

        // Count enabled validations (handle Buffer values from MySQL)
        const enabledCount = validations.filter((v: any) => {
          const enabled = v.IsEnabled;
          return enabled === 1 || enabled === true ||
                 (Buffer.isBuffer(enabled) && enabled[0] === 1);
        }).length;

        await schemaConnection.end();

        console.log(`  ✓ Successfully loaded ${validations.length} validations (${enabledCount} enabled)`);
        results.successful.push(schema);

      } catch (error: any) {
        console.log(`  ✗ Failed: ${error.message}`);
        results.failed.push({ schema, error: error.message });
      }

      console.log();
    }

    // Step 4: Summary
    console.log('═══════════════════════════════════════════════════');
    console.log('📊 Deployment Summary');
    console.log('═══════════════════════════════════════════════════');
    console.log(`Total schemas: ${schemas.length}`);
    console.log(`✓ Successful: ${results.successful.length}`);
    console.log(`✗ Failed: ${results.failed.length}`);
    console.log();

    if (results.successful.length > 0) {
      console.log('✓ Successfully deployed to:');
      results.successful.forEach(s => console.log(`  - ${s}`));
      console.log();
    }

    if (results.failed.length > 0) {
      console.log('✗ Failed schemas:');
      results.failed.forEach(f => console.log(`  - ${f.schema}: ${f.error}`));
      console.log();
    }

    if (results.failed.length === 0) {
      console.log('🎉 All schemas updated successfully!');
    } else {
      console.log('⚠️  Some schemas failed to update. Please review errors above.');
      process.exit(1);
    }

  } catch (error: any) {
    console.error('❌ Fatal error:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

// Run the deployment
deployValidationsToAllSchemas()
  .then(() => {
    console.log('\n✅ Deployment complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Deployment failed:', error);
    process.exit(1);
  });
