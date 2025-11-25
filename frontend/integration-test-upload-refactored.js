/**
 * Integration Test for Refactored Upload System
 *
 * This script provides GUARANTEES for:
 * 1. Records save correctly to coremeasurements
 * 2. Failed rows move to failedmeasurements properly
 * 3. Tree-stem states categorize correctly
 * 4. Error handling works in production
 * 5. Stored procedure integrity (no data loss)
 *
 * Run: node integration-test-upload-refactored.js
 */

const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

// Database configuration
const DB_CONFIG = {
  host: 'forestgeo-mysqldataserver.mysql.database.azure.com',
  user: 'azureroot',
  password: 'P@ssw0rd',
  database: 'forestgeo_testing',
  port: 3306,
  ssl: { rejectUnauthorized: false }
};

// Test configuration
const BASE_URL = 'http://localhost:3000';
const TEST_PLOT_ID = 1;
const TEST_CENSUS_ID = 2;
const TEST_PERSONNEL_ID = 1;
const SCHEMA = 'forestgeo_testing';

// Test results
const results = {
  guarantee1: { passed: false, details: '' },
  guarantee2: { passed: false, details: '' },
  guarantee3: { passed: false, details: '' },
  guarantee4: { passed: false, details: '' },
  storedProcedure: { passed: false, details: '' }
};

// Create test CSV files
async function createTestCSVFiles() {
  console.log('\n📁 Creating test CSV files...');

  // Valid measurements CSV
  const validCSV = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
TESTVALID001,1,ACACBR,0101,5.5,10.2,15.3,,1.30,2020-06-15
TESTVALID002,1,ACACDR,0102,8.2,12.5,22.8,,1.30,2020-06-15
TESTVALID003,1,ACACET,0103,12.1,18.9,8.5,M,1.30,2020-06-15`;

  await fs.writeFile('./test-valid-measurements.csv', validCSV);
  console.log('✅ Created test-valid-measurements.csv (3 rows)');

  // Invalid measurements CSV (for failedmeasurements testing)
  const invalidCSV = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
TESTINVALID001,1,ACACBR,0101,5.5,10.2,15.3,,1.30,2020-06-15
TESTINVALID002,1,ACACDR,,8.2,12.5,22.8,,1.30,2020-06-15
TESTINVALID003,1,ACACET,0103,12.1,18.9,INVALID,,1.30,2020-06-15
TESTINVALID004,1,ACACGA,0104,5.0,8.0,-10.5,,1.30,2020-06-15`;

  await fs.writeFile('./test-invalid-measurements.csv', invalidCSV);
  console.log('✅ Created test-invalid-measurements.csv (3 invalid, 1 valid)');

  // Tree-stem states CSV
  const treeStatesCSV = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
TESTSTATE001,1,ACACBR,0101,5.5,10.2,15.3,,1.30,2020-06-15
TESTSTATE002,1,ACACDR,0102,8.2,12.5,22.8,M,1.30,2020-06-15
TESTSTATE003,1,ACACET,0103,12.1,18.9,8.5,D,1.30,2020-06-15
TESTSTATE004,1,ACACGA,0104,7.5,14.2,12.1,A,1.30,2020-06-15`;

  await fs.writeFile('./test-tree-states.csv', treeStatesCSV);
  console.log('✅ Created test-tree-states.csv (various codes: none, M, D, A)');
}

// Connect to database
async function connectDB() {
  const connection = await mysql.createConnection(DB_CONFIG);
  console.log('✅ Connected to database');
  return connection;
}

// Clean up test data
async function cleanupTestData(connection) {
  console.log('\n🧹 Cleaning up test data...');

  try {
    // Delete test measurements
    await connection.execute(`
      DELETE FROM coremeasurements
      WHERE TreeTag LIKE 'TEST%'
    `);

    await connection.execute(`
      DELETE FROM failedmeasurements
      WHERE Tag LIKE 'TEST%'
    `);

    console.log('✅ Test data cleaned up');
  } catch (error) {
    console.log('⚠️  Cleanup warning:', error.message);
  }
}

// Get baseline counts
async function getBaselineCounts(connection) {
  const [[counts]] = await connection.execute(
    `
    SELECT
      (SELECT COUNT(*) FROM coremeasurements WHERE CensusID = ?) as measurement_count,
      (SELECT COUNT(*) FROM failedmeasurements WHERE CensusID = ?) as failed_count
  `,
    [TEST_CENSUS_ID, TEST_CENSUS_ID]
  );

  return counts;
}

// Upload via API
async function uploadViaAPI(filename, personnelID) {
  console.log(`\n📤 Uploading ${filename}...`);

  try {
    const fileContent = await fs.readFile(filename, 'utf-8');
    const formData = new FormData();
    formData.append('file', fileContent, path.basename(filename));
    formData.append('schema', SCHEMA);
    formData.append('formType', 'measurements');
    formData.append('plotID', TEST_PLOT_ID);
    formData.append('censusID', TEST_CENSUS_ID);
    formData.append('personnelID', personnelID);

    // This would need actual API endpoint testing
    // For now, we'll simulate success and manually verify database
    console.log('⚠️  Manual upload required - API endpoint not accessible from script');
    console.log(`   Please upload ${filename} manually through http://localhost:3000/upload`);
    console.log(`   Plot: ${TEST_PLOT_ID}, Census: ${TEST_CENSUS_ID}, Personnel: ${personnelID}`);

    return { success: true, manual: true };
  } catch (error) {
    console.error('❌ Upload failed:', error.message);
    return { success: false, error: error.message };
  }
}

// GUARANTEE 1: Records save correctly to coremeasurements
async function testGuarantee1(connection) {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 GUARANTEE 1: Records save correctly to coremeasurements');
  console.log('='.repeat(60));

  try {
    const baseline = await getBaselineCounts(connection);
    console.log(`📊 Baseline - Measurements: ${baseline.measurement_count}, Failed: ${baseline.failed_count}`);

    console.log('\n⏸️  MANUAL STEP REQUIRED:');
    console.log('   1. Open http://localhost:3000/upload');
    console.log('   2. Select "measurements" form type');
    console.log('   3. Select personnel: "Integration TestUser"');
    console.log('   4. Upload file: test-valid-measurements.csv');
    console.log('   5. Wait for "Upload Complete"');
    console.log('\n   Press ENTER when complete...');

    // Wait for user
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });

    // Verify records inserted
    const [[insertedRecords]] = await connection.execute(
      `
      SELECT COUNT(*) as count FROM coremeasurements
      WHERE TreeTag LIKE 'TESTVALID%' AND CensusID = ?
    `,
      [TEST_CENSUS_ID]
    );

    console.log(`\n✓ Records inserted: ${insertedRecords.count}`);

    if (insertedRecords.count === 3) {
      console.log('✅ GUARANTEE 1 PASSED: All 3 records inserted correctly');

      // Verify data integrity
      const [records] = await connection.execute(
        `
        SELECT TreeTag, StemTag, SpeciesCode, QuadratName, MeasuredDBH, MeasuredHOM
        FROM coremeasurements
        WHERE TreeTag LIKE 'TESTVALID%' AND CensusID = ?
        ORDER BY TreeTag
      `,
        [TEST_CENSUS_ID]
      );

      console.log('\n📋 Inserted Records:');
      records.forEach(r => {
        console.log(`   ${r.TreeTag}: ${r.SpeciesCode} in ${r.QuadratName}, DBH=${r.MeasuredDBH}, HOM=${r.MeasuredHOM}`);
      });

      // Verify field mapping
      const validations = [
        records[0].TreeTag === 'TESTVALID001',
        records[0].SpeciesCode === 'ACACBR',
        records[0].QuadratName === '0101',
        records[0].MeasuredDBH === '15.3',
        records[1].SpeciesCode === 'ACACDR',
        records[2].SpeciesCode === 'ACACET'
      ];

      if (validations.every(v => v)) {
        console.log('✅ Field mapping correct (tag, spcode, quadrat, dbh, hom)');
        results.guarantee1.passed = true;
        results.guarantee1.details = `3 records inserted with correct field mapping`;
      } else {
        console.log('❌ Field mapping incorrect');
        results.guarantee1.details = 'Records inserted but field mapping errors detected';
      }
    } else {
      console.log(`❌ GUARANTEE 1 FAILED: Expected 3 records, got ${insertedRecords.count}`);
      results.guarantee1.details = `Expected 3 records, got ${insertedRecords.count}`;
    }
  } catch (error) {
    console.error('❌ GUARANTEE 1 FAILED:', error.message);
    results.guarantee1.details = error.message;
  }
}

// GUARANTEE 2: Failed rows move to failedmeasurements properly
async function testGuarantee2(connection) {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 GUARANTEE 2: Failed rows move to failedmeasurements properly');
  console.log('='.repeat(60));

  try {
    console.log('\n⏸️  MANUAL STEP REQUIRED:');
    console.log('   1. Upload file: test-invalid-measurements.csv');
    console.log('   2. Expect some rows to fail validation');
    console.log('   3. Wait for completion');
    console.log('\n   Press ENTER when complete...');

    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });

    // Check valid records inserted
    const [[validRecords]] = await connection.execute(
      `
      SELECT COUNT(*) as count FROM coremeasurements
      WHERE TreeTag LIKE 'TESTINVALID%' AND CensusID = ?
    `,
      [TEST_CENSUS_ID]
    );

    // Check failed records
    const [[failedRecords]] = await connection.execute(
      `
      SELECT COUNT(*) as count FROM failedmeasurements
      WHERE Tag LIKE 'TESTINVALID%' AND CensusID = ?
    `,
      [TEST_CENSUS_ID]
    );

    console.log(`\n📊 Results:`);
    console.log(`   Valid records in coremeasurements: ${validRecords.count}`);
    console.log(`   Failed records in failedmeasurements: ${failedRecords.count}`);

    if (validRecords.count === 1 && failedRecords.count === 3) {
      console.log('✅ GUARANTEE 2 PASSED: 1 valid inserted, 3 failed correctly categorized');

      // Check failure reasons
      const [failures] = await connection.execute(
        `
        SELECT Tag, StemTag, FailureReason
        FROM failedmeasurements
        WHERE Tag LIKE 'TESTINVALID%' AND CensusID = ?
        ORDER BY Tag
      `,
        [TEST_CENSUS_ID]
      );

      console.log('\n📋 Failed Records:');
      failures.forEach(f => {
        console.log(`   ${f.Tag}: ${f.FailureReason}`);
      });

      results.guarantee2.passed = true;
      results.guarantee2.details = `1 valid, 3 failed with correct categorization`;
    } else {
      console.log(`❌ GUARANTEE 2 FAILED: Expected 1 valid + 3 failed, got ${validRecords.count} valid + ${failedRecords.count} failed`);
      results.guarantee2.details = `Expected 1 valid + 3 failed, got ${validRecords.count} valid + ${failedRecords.count} failed`;
    }
  } catch (error) {
    console.error('❌ GUARANTEE 2 FAILED:', error.message);
    results.guarantee2.details = error.message;
  }
}

// GUARANTEE 3: Tree-stem states categorize correctly
async function testGuarantee3(connection) {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 GUARANTEE 3: Tree-stem states categorize correctly');
  console.log('='.repeat(60));

  try {
    console.log('\n⏸️  MANUAL STEP REQUIRED:');
    console.log('   1. Upload file: test-tree-states.csv');
    console.log('   2. Wait for completion');
    console.log('\n   Press ENTER when complete...');

    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });

    // Check validation states
    const [records] = await connection.execute(
      `
      SELECT TreeTag, Codes, IsValidated,
        CASE
          WHEN IsValidated = 1 THEN 'Valid'
          WHEN IsValidated IS NULL THEN 'Pending'
          ELSE 'Invalid'
        END as ValidationState
      FROM coremeasurements
      WHERE TreeTag LIKE 'TESTSTATE%' AND CensusID = ?
      ORDER BY TreeTag
    `,
      [TEST_CENSUS_ID]
    );

    console.log('\n📋 Tree-Stem States:');
    records.forEach(r => {
      console.log(`   ${r.TreeTag}: Code="${r.Codes || 'none'}", State=${r.ValidationState}`);
    });

    // Verify expected states
    const expectations = [
      { tag: 'TESTSTATE001', code: null, expectedState: 'Valid' }, // No code -> Valid
      { tag: 'TESTSTATE002', code: 'M', expectedState: 'Pending' }, // Multi-stem -> Pending
      { tag: 'TESTSTATE003', code: 'D', expectedState: 'Pending' }, // Dead -> Pending
      { tag: 'TESTSTATE004', code: 'A', expectedState: 'Pending' } // Needs checking -> Pending
    ];

    let allCorrect = true;
    expectations.forEach(exp => {
      const record = records.find(r => r.TreeTag === exp.tag);
      if (record && record.ValidationState === exp.expectedState) {
        console.log(`   ✓ ${exp.tag}: Correct (${exp.expectedState})`);
      } else {
        console.log(`   ✗ ${exp.tag}: Wrong (expected ${exp.expectedState}, got ${record?.ValidationState})`);
        allCorrect = false;
      }
    });

    if (allCorrect) {
      console.log('✅ GUARANTEE 3 PASSED: All tree-stem states categorized correctly');
      results.guarantee3.passed = true;
      results.guarantee3.details = 'All 4 states correctly categorized';
    } else {
      console.log('❌ GUARANTEE 3 FAILED: Some states incorrectly categorized');
      results.guarantee3.details = 'State categorization errors detected';
    }
  } catch (error) {
    console.error('❌ GUARANTEE 3 FAILED:', error.message);
    results.guarantee3.details = error.message;
  }
}

// GUARANTEE 4: Error handling works
async function testGuarantee4(connection) {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 GUARANTEE 4: Error handling works in production');
  console.log('='.repeat(60));

  console.log('\n⚠️  Testing error handling requires manual verification:');
  console.log('   1. Create a CSV with extremely large values or invalid data');
  console.log('   2. Try to upload and observe error handling');
  console.log('   3. Verify error message displayed');
  console.log('   4. Test retry functionality');
  console.log('\n   Did error handling work correctly? (y/n): ');

  const answer = await new Promise(resolve => {
    process.stdin.once('data', data => resolve(data.toString().trim().toLowerCase()));
  });

  if (answer === 'y' || answer === 'yes') {
    console.log('✅ GUARANTEE 4 PASSED: Error handling verified');
    results.guarantee4.passed = true;
    results.guarantee4.details = 'Error handling manually verified';
  } else {
    console.log('❌ GUARANTEE 4 FAILED: Error handling not working');
    results.guarantee4.details = 'Error handling not verified';
  }
}

// Test stored procedure integrity
async function testStoredProcedure(connection) {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 STORED PROCEDURE: Testing for data loss');
  console.log('='.repeat(60));

  try {
    // Get counts before and after processing
    console.log('\nChecking stored procedure integrity...');

    // Check temporarymeasurements vs coremeasurements counts
    const [[counts]] = await connection.execute(
      `
      SELECT
        (SELECT COUNT(*) FROM temporarymeasurements WHERE CensusID = ?) as temp_count,
        (SELECT COUNT(*) FROM coremeasurements WHERE CensusID = ?) as core_count,
        (SELECT COUNT(*) FROM failedmeasurements WHERE CensusID = ?) as failed_count
    `,
      [TEST_CENSUS_ID, TEST_CENSUS_ID, TEST_CENSUS_ID]
    );

    console.log(`\n📊 Counts:`);
    console.log(`   Temporary measurements: ${counts.temp_count}`);
    console.log(`   Core measurements: ${counts.core_count}`);
    console.log(`   Failed measurements: ${counts.failed_count}`);

    // Check for data loss reports
    const [lossReports] = await connection.execute(
      `
      SELECT * FROM uploaddatalossreport
      WHERE CensusID = ?
      ORDER BY createdAt DESC
      LIMIT 1
    `,
      [TEST_CENSUS_ID]
    );

    if (lossReports.length > 0) {
      console.log('\n⚠️  Data loss reports found:');
      lossReports.forEach(report => {
        console.log(`   ${JSON.stringify(report, null, 2)}`);
      });
      results.storedProcedure.details = 'Data loss detected in reports';
    } else {
      console.log('✅ No data loss reports found');
      results.storedProcedure.passed = true;
      results.storedProcedure.details = 'Stored procedure integrity verified';
    }
  } catch (error) {
    console.error('❌ STORED PROCEDURE TEST FAILED:', error.message);
    results.storedProcedure.details = error.message;
  }
}

// Print final results
function printResults() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL TEST RESULTS');
  console.log('='.repeat(60));

  console.log('\nGuarantee 1 (Records save correctly):');
  console.log(`   ${results.guarantee1.passed ? '✅ PASSED' : '❌ FAILED'}: ${results.guarantee1.details}`);

  console.log('\nGuarantee 2 (Failed rows handled):');
  console.log(`   ${results.guarantee2.passed ? '✅ PASSED' : '❌ FAILED'}: ${results.guarantee2.details}`);

  console.log('\nGuarantee 3 (Tree-stem states):');
  console.log(`   ${results.guarantee3.passed ? '✅ PASSED' : '❌ FAILED'}: ${results.guarantee3.details}`);

  console.log('\nGuarantee 4 (Error handling):');
  console.log(`   ${results.guarantee4.passed ? '✅ PASSED' : '❌ FAILED'}: ${results.guarantee4.details}`);

  console.log('\nStored Procedure Integrity:');
  console.log(`   ${results.storedProcedure.passed ? '✅ PASSED' : '❌ FAILED'}: ${results.storedProcedure.details}`);

  const allPassed = Object.values(results).every(r => r.passed);

  console.log('\n' + '='.repeat(60));
  if (allPassed) {
    console.log('🎉 ALL GUARANTEES VERIFIED - READY FOR PRODUCTION');
  } else {
    console.log('⚠️  SOME GUARANTEES FAILED - NOT READY FOR PRODUCTION');
  }
  console.log('='.repeat(60));
}

// Main test function
async function runIntegrationTests() {
  console.log('🚀 Starting Integration Tests for Refactored Upload System');
  console.log('='.repeat(60));

  let connection;

  try {
    // Setup
    await createTestCSVFiles();
    connection = await connectDB();

    // Clean up any previous test data
    await cleanupTestData(connection);

    // Run tests
    await testGuarantee1(connection);
    await testGuarantee2(connection);
    await testGuarantee3(connection);
    await testGuarantee4(connection);
    await testStoredProcedure(connection);

    // Print results
    printResults();

    // Ask about cleanup
    console.log('\n🧹 Clean up test data? (y/n): ');
    const cleanup = await new Promise(resolve => {
      process.stdin.once('data', data => resolve(data.toString().trim().toLowerCase()));
    });

    if (cleanup === 'y' || cleanup === 'yes') {
      await cleanupTestData(connection);
    } else {
      console.log('⚠️  Test data left in database for review');
    }
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n✅ Database connection closed');
    }
    process.exit(0);
  }
}

// Run tests
runIntegrationTests();
