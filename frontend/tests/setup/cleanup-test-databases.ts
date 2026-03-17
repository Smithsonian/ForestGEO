#!/usr/bin/env npx ts-node
/**
 * Cleanup script for orphan test databases.
 *
 * Finds and drops test databases that match the pattern `forestgeo_test_*`.
 * This handles cases where tests crash before teardown runs.
 *
 * Usage:
 *   npx ts-node tests/setup/cleanup-test-databases.ts
 *   npx ts-node tests/setup/cleanup-test-databases.ts --dry-run
 *   npx ts-node tests/setup/cleanup-test-databases.ts --max-age-hours=1
 *
 * Options:
 *   --dry-run          Show what would be deleted without actually deleting
 *   --max-age-hours=N  Only delete databases older than N hours (default: all)
 *   --force            Skip confirmation prompt
 */

import mysql from 'mysql2/promise';

const TEST_DB_PREFIX = 'forestgeo_test_';

interface CleanupOptions {
  dryRun: boolean;
  maxAgeHours: number | null;
  force: boolean;
}

interface DatabaseInfo {
  name: string;
  createdAt: Date | null;
  ageHours: number | null;
}

function parseArgs(): CleanupOptions {
  const args = process.argv.slice(2);
  const options: CleanupOptions = {
    dryRun: false,
    maxAgeHours: null,
    force: false
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg.startsWith('--max-age-hours=')) {
      const value = parseInt(arg.split('=')[1], 10);
      if (!isNaN(value) && value > 0) {
        options.maxAgeHours = value;
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Cleanup script for orphan test databases.

Usage:
  npx ts-node tests/setup/cleanup-test-databases.ts [options]

Options:
  --dry-run          Show what would be deleted without actually deleting
  --max-age-hours=N  Only delete databases older than N hours (default: all)
  --force            Skip confirmation prompt
  --help, -h         Show this help message

Examples:
  # Show all test databases without deleting
  npx ts-node tests/setup/cleanup-test-databases.ts --dry-run

  # Delete all test databases older than 1 hour
  npx ts-node tests/setup/cleanup-test-databases.ts --max-age-hours=1 --force

  # Interactive cleanup of all test databases
  npx ts-node tests/setup/cleanup-test-databases.ts
`);
      process.exit(0);
    }
  }

  return options;
}

async function getTestDatabases(connection: mysql.Connection): Promise<DatabaseInfo[]> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(`SHOW DATABASES LIKE '${TEST_DB_PREFIX}%'`);

  const databases: DatabaseInfo[] = [];

  for (const row of rows) {
    const dbName = Object.values(row)[0] as string;

    // Try to get creation time from information_schema
    // Note: MySQL doesn't directly track database creation time, so we use
    // the oldest table creation time as a proxy
    let createdAt: Date | null = null;
    let ageHours: number | null = null;

    try {
      const [tableRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT MIN(CREATE_TIME) as oldest_table
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ?`,
        [dbName]
      );

      if (tableRows.length > 0 && tableRows[0].oldest_table) {
        createdAt = new Date(tableRows[0].oldest_table);
        ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
      }
    } catch {
      // Ignore errors getting creation time
    }

    databases.push({ name: dbName, createdAt, ageHours });
  }

  return databases;
}

async function dropDatabase(connection: mysql.Connection, dbName: string): Promise<void> {
  // Sanitize database name to prevent injection
  // Only allow alphanumeric, underscore, and hyphen
  if (!/^[a-zA-Z0-9_-]+$/.test(dbName)) {
    throw new Error(`Invalid database name: ${dbName}`);
  }

  await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
}

async function main(): Promise<void> {
  const options = parseArgs();

  console.log('🔍 Connecting to MySQL...');

  const connection = await mysql.createConnection({
    host: process.env.TEST_DB_HOST || 'localhost',
    user: process.env.TEST_DB_USER || 'root',
    password: process.env.TEST_DB_PASSWORD || 'testpassword',
    port: parseInt(process.env.TEST_DB_PORT || '3306', 10)
  });

  try {
    const databases = await getTestDatabases(connection);

    if (databases.length === 0) {
      console.log('✅ No test databases found. Nothing to clean up.');
      return;
    }

    // Filter by age if specified
    const databasesToDelete = options.maxAgeHours !== null ? databases.filter(db => db.ageHours === null || db.ageHours >= options.maxAgeHours!) : databases;

    if (databasesToDelete.length === 0) {
      console.log(`✅ No test databases older than ${options.maxAgeHours} hours found.`);
      return;
    }

    console.log(`\nFound ${databasesToDelete.length} test database(s):\n`);

    for (const db of databasesToDelete) {
      const ageStr = db.ageHours !== null ? `${db.ageHours.toFixed(1)} hours old` : 'age unknown';
      console.log(`  - ${db.name} (${ageStr})`);
    }

    if (options.dryRun) {
      console.log('\n⚠️  DRY RUN: No databases were deleted.');
      console.log('   Remove --dry-run flag to actually delete.');
      return;
    }

    if (!options.force) {
      console.log('\n⚠️  This will permanently delete these databases.');
      console.log('   Use --force to skip this confirmation, or press Ctrl+C to cancel.\n');

      // Simple confirmation using readline
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise<string>(resolve => {
        rl.question('Type "yes" to confirm deletion: ', resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'yes') {
        console.log('❌ Cleanup cancelled.');
        return;
      }
    }

    console.log('\n🗑️  Deleting databases...\n');

    let deletedCount = 0;
    let errorCount = 0;

    for (const db of databasesToDelete) {
      try {
        await dropDatabase(connection, db.name);
        console.log(`  ✅ Dropped: ${db.name}`);
        deletedCount++;
      } catch (error: any) {
        console.error(`  ❌ Failed to drop ${db.name}: ${error.message}`);
        errorCount++;
      }
    }

    console.log(`\n✅ Cleanup complete: ${deletedCount} deleted, ${errorCount} failed.`);
  } finally {
    await connection.end();
  }
}

// Run the script
main().catch(error => {
  console.error('❌ Cleanup failed:', error.message);
  process.exit(1);
});
