/**
 * Test Database Cleanup Utility
 *
 * Provides comprehensive cleanup functions to ensure a clean state
 * before and after test runs. Prevents duplicate entry errors and
 * ensures test isolation.
 */

import mysql from 'mysql2/promise';

/**
 * Clean up all test data from the database
 * This should be called before test suites run to ensure clean state
 */
export async function cleanupAllTestData(connection: mysql.Connection, schema: string): Promise<void> {
  console.log('🧹 Cleaning up test data from previous runs...');

  try {
    // Disable foreign key checks temporarily for faster cleanup
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    // Delete test data in reverse dependency order
    // Use LIKE patterns to catch test data that might have been left behind

    // 1. Clean up measurement-related data
    // First get test tree IDs
    const [testTrees] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT TreeID FROM ${schema}.trees
      WHERE TreeTag LIKE 'TEST_%' OR TreeTag LIKE '%\\_TEST\\_%'
    `);
    const testTreeIDs = testTrees.map(row => row.TreeID);

    if (testTreeIDs.length > 0) {
      const treeIDList = testTreeIDs.join(',');

      await connection.query(`
        DELETE FROM ${schema}.cmattributes
        WHERE CoreMeasurementID IN (
          SELECT CoreMeasurementID FROM ${schema}.coremeasurements
          WHERE TreeID IN (${treeIDList})
        )
      `);

      await connection.query(`
        DELETE FROM ${schema}.cmverrors
        WHERE CoreMeasurementID IN (
          SELECT CoreMeasurementID FROM ${schema}.coremeasurements
          WHERE TreeID IN (${treeIDList})
        )
      `);

      await connection.query(`
        DELETE FROM ${schema}.coremeasurements
        WHERE TreeID IN (${treeIDList})
      `);

      // 2. Clean up stems
      await connection.query(`
        DELETE FROM ${schema}.stems
        WHERE TreeID IN (${treeIDList})
      `);
    }

    // Also clean up orphaned measurements and stems
    await connection.query(`
      DELETE FROM ${schema}.coremeasurements
      WHERE IsActive IS NULL
    `);

    await connection.query(`
      DELETE FROM ${schema}.stems
      WHERE StemTag LIKE 'S%' OR StemTag = '0001'
    `);

    // 3. Clean up trees (use test naming pattern)
    await connection.query(`
      DELETE FROM ${schema}.trees
      WHERE TreeTag LIKE 'TEST_%' OR TreeTag LIKE '%\_TEST\_%'
    `);

    // 4. Clean up quadrats (test quadrats often named Q1, Q2, etc.)
    await connection.query(`
      DELETE FROM ${schema}.quadrats
      WHERE QuadratName IN ('Q1', 'Q2', 'Q3', 'Q4', 'Q5')
        OR QuadratName LIKE 'TEST_%'
    `);

    // 5. Clean up species limits (test limits for test species)
    await connection.query(`
      DELETE FROM ${schema}.specieslimits
      WHERE SpeciesID IN (
        SELECT SpeciesID FROM ${schema}.species
        WHERE SpeciesCode IN ('ACRU', 'QURU', 'TEST_SP')
          OR SpeciesCode LIKE 'TEST_%'
      )
    `);

    // 6. Clean up test species
    await connection.query(`
      DELETE FROM ${schema}.species
      WHERE SpeciesCode IN ('ACRU', 'QURU', 'TEST_SP')
        OR SpeciesCode LIKE 'TEST_%'
    `);

    // 7. Clean up test attributes
    await connection.query(`
      DELETE FROM ${schema}.attributes
      WHERE Code IN ('A', 'D', 'DS', 'M', 'P', 'MX')
        OR Code LIKE 'TEST_%'
    `);

    // 8. Clean up census records (be careful - only clean test census)
    await connection.query(`
      DELETE FROM ${schema}.census
      WHERE PlotID IN (
        SELECT PlotID FROM ${schema}.plots
        WHERE DimensionX = 100 AND DimensionY = 100
          OR PlotName LIKE 'TEST_%'
      )
    `);

    // 9. Clean up test plots (careful - only test plots)
    await connection.query(`
      DELETE FROM ${schema}.plots
      WHERE (DimensionX = 100 AND DimensionY = 100)
        OR PlotName LIKE 'TEST_%'
    `);

    // Re-enable foreign key checks
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log('  ✓ Test data cleanup complete\n');
  } catch (error: any) {
    // Re-enable foreign key checks even if error occurred
    await connection.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    console.error('  ⚠️  Error during cleanup:', error.message);
    console.error('     This may indicate leftover data, but tests will continue.\n');
  }
}

/**
 * Clean up specific test data by table
 * Useful for targeted cleanup between individual tests
 */
export async function cleanupTestDataByTable(connection: mysql.Connection, schema: string, tables: string[]): Promise<void> {
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const table of tables) {
      switch (table) {
        case 'quadrats':
          await connection.query(`
            DELETE FROM ${schema}.quadrats
            WHERE QuadratName IN ('Q1', 'Q2', 'Q3', 'Q4', 'Q5')
              OR QuadratName LIKE 'TEST_%'
          `);
          break;

        case 'trees':
          await connection.query(`
            DELETE FROM ${schema}.trees
            WHERE TreeTag LIKE 'TEST_%' OR TreeTag LIKE '%\_TEST\_%'
          `);
          break;

        case 'stems':
          // Get test tree IDs first
          const [stemTestTrees] = await connection.query<mysql.RowDataPacket[]>(`
            SELECT TreeID FROM ${schema}.trees
            WHERE TreeTag LIKE 'TEST_%' OR TreeTag LIKE '%\\_TEST\\_%'
          `);
          const stemTreeIDs = stemTestTrees.map((row: any) => row.TreeID);
          if (stemTreeIDs.length > 0) {
            await connection.query(`
              DELETE FROM ${schema}.stems
              WHERE TreeID IN (${stemTreeIDs.join(',')})
            `);
          }
          await connection.query(`
            DELETE FROM ${schema}.stems
            WHERE StemTag LIKE 'S%' OR StemTag = '0001'
          `);
          break;

        case 'coremeasurements':
          // Get test tree IDs first
          const [cmTestTrees] = await connection.query<mysql.RowDataPacket[]>(`
            SELECT TreeID FROM ${schema}.trees
            WHERE TreeTag LIKE 'TEST_%' OR TreeTag LIKE '%\\_TEST\\_%'
          `);
          const cmTreeIDs = cmTestTrees.map((row: any) => row.TreeID);
          if (cmTreeIDs.length > 0) {
            await connection.query(`
              DELETE FROM ${schema}.coremeasurements
              WHERE TreeID IN (${cmTreeIDs.join(',')})
            `);
          }
          await connection.query(`
            DELETE FROM ${schema}.coremeasurements
            WHERE IsActive IS NULL
          `);
          break;

        case 'species':
          await connection.query(`
            DELETE FROM ${schema}.species
            WHERE SpeciesCode IN ('ACRU', 'QURU', 'TEST_SP')
              OR SpeciesCode LIKE 'TEST_%'
          `);
          break;

        case 'attributes':
          await connection.query(`
            DELETE FROM ${schema}.attributes
            WHERE Code IN ('A', 'D', 'DS', 'M', 'P', 'MX')
              OR Code LIKE 'TEST_%'
          `);
          break;
      }
    }

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } catch (error: any) {
    await connection.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    console.error(`Error cleaning up tables ${tables.join(', ')}:`, error.message);
  }
}

/**
 * Verify database is in clean state
 * Returns counts of potential test data
 */
export async function verifyCleanState(
  connection: mysql.Connection,
  schema: string
): Promise<{
  clean: boolean;
  counts: Record<string, number>;
}> {
  const counts: Record<string, number> = {};

  try {
    // Check for test data in various tables
    const [testTrees] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM ${schema}.trees
       WHERE TreeTag LIKE 'TEST_%' OR TreeTag LIKE '%\\_TEST\\_%'`
    );
    counts.testTrees = testTrees[0].count;

    const [testQuadrats] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM ${schema}.quadrats
       WHERE QuadratName IN ('Q1', 'Q2', 'Q3', 'Q4', 'Q5')
         OR QuadratName LIKE 'TEST_%'`
    );
    counts.testQuadrats = testQuadrats[0].count;

    const [testSpecies] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM ${schema}.species
       WHERE SpeciesCode IN ('ACRU', 'QURU', 'TEST_SP')
         OR SpeciesCode LIKE 'TEST_%'`
    );
    counts.testSpecies = testSpecies[0].count;

    const clean = Object.values(counts).every(count => count === 0);

    return { clean, counts };
  } catch (error: any) {
    console.error('Error verifying clean state:', error.message);
    return { clean: false, counts };
  }
}
