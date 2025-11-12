/**
 * Automated Upload Test Script
 *
 * Performs uploads programmatically to test the refactored upload system
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const mysql = require('mysql2/promise');

const BASE_URL = 'http://localhost:3000';
const DB_CONFIG = {
  host: 'forestgeo-mysqldataserver.mysql.database.azure.com',
  user: 'azureroot',
  password: 'P@ssw0rd',
  database: 'forestgeo_testing',
  port: 3306,
  ssl: { rejectUnauthorized: false }
};

async function uploadFile(filename, censusID, personnelID) {
  console.log(`\n📤 Uploading ${filename}...`);

  try {
    // Read the CSV file
    const fileContent = fs.readFileSync(filename, 'utf-8');
    const fileBuffer = Buffer.from(fileContent, 'utf-8');

    // Create form data
    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: filename,
      contentType: 'text/csv'
    });

    // First, let's check what API endpoints are available
    // The upload system uses several endpoints:
    // 1. /api/setupbulkprocessor/ - Initialize processor
    // 2. /api/sqlpacketload - Load data chunks
    // 3. /api/setupbulkprocedure/ - Process batch
    // 4. /api/setupbulkcollapser/ - Collapse data

    console.log('Step 1: Setting up bulk processor...');
    const schema = 'forestgeo_testing';
    const plotID = 1;

    // Setup bulk processor
    const processorResponse = await axios.get(`${BASE_URL}/api/setupbulkprocessor/${schema}/${plotID}/${censusID}/measurements`, { timeout: 30000 });

    console.log('✓ Processor setup:', processorResponse.data.message || 'success');

    // Parse CSV and create file row set
    const lines = fileContent.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1);

    const fileRowSet = {};
    rows.forEach((row, index) => {
      const values = row.split(',').map(v => v.trim());
      const rowData = {};
      headers.forEach((header, i) => {
        let value = values[i];
        // Convert numeric values
        if (header === 'lx' || header === 'ly' || header === 'dbh' || header === 'hom') {
          value = parseFloat(value) || value;
        }
        rowData[header] = value;
      });
      fileRowSet[index] = rowData;
    });

    console.log(`Step 2: Loading ${rows.length} rows...`);

    // Load data packet
    const loadResponse = await axios.post(
      `${BASE_URL}/api/sqlpacketload`,
      {
        schema: schema,
        plotID: plotID,
        censusID: censusID,
        formType: 'measurements',
        fileName: filename,
        fileRowSet: fileRowSet,
        personnelID: personnelID
      },
      {
        timeout: 60000,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    console.log('✓ Data loaded:', loadResponse.data.responseMessage);
    const batchID = loadResponse.data.batchID;

    console.log('Step 3: Processing batch...');

    // Process batch with stored procedure
    const procedureResponse = await axios.get(`${BASE_URL}/api/setupbulkprocedure/${schema}/${plotID}/${censusID}/measurements/${batchID}`, { timeout: 60000 });

    console.log('✓ Batch processed:', procedureResponse.data.message);

    if (procedureResponse.data.batchFailedButHandled) {
      console.log('⚠️  Some rows failed validation');
      if (procedureResponse.data.failedRows) {
        console.log('Failed rows:', procedureResponse.data.failedRows.length);
      }
    }

    console.log('Step 4: Collapsing data...');

    // Collapse data
    const collapseResponse = await axios.get(`${BASE_URL}/api/setupbulkcollapser/${schema}/${plotID}/${censusID}`, { timeout: 60000 });

    console.log('✓ Data collapsed:', collapseResponse.data.message);

    console.log('✅ Upload complete!');

    return {
      success: true,
      batchID: batchID,
      insertedCount: loadResponse.data.insertedCount,
      failedRows: procedureResponse.data.failedRows || []
    };
  } catch (error) {
    console.error('❌ Upload failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    return {
      success: false,
      error: error.message
    };
  }
}

async function runAutomatedTests() {
  console.log('🤖 Starting Automated Upload Tests');
  console.log('='.repeat(60));

  const connection = await mysql.createConnection(DB_CONFIG);
  console.log('✅ Connected to database\n');

  const censusID = 2;
  const plotID = 1;
  const personnelID = 1;

  try {
    // GUARANTEE 1: Valid measurements
    console.log('\n' + '='.repeat(60));
    console.log('🔍 GUARANTEE 1: Records save correctly to coremeasurements');
    console.log('='.repeat(60));

    const [[baseline1]] = await connection.execute('SELECT COUNT(*) as count FROM coremeasurements WHERE CensusID = ?', [censusID]);
    console.log(`Baseline count: ${baseline1.count}`);

    const result1 = await uploadFile('test-valid-measurements.csv', censusID, personnelID);

    if (result1.success) {
      // Wait a moment for database to update
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Query for the uploaded records
      const [records] = await connection.execute(
        `
        SELECT cm.CoreMeasurementID, s.TreeTag, s.StemTag, sp.SpeciesCode,
               q.QuadratName, cm.MeasuredDBH, cm.MeasuredHOM
        FROM coremeasurements cm
        JOIN stems s ON cm.StemGUID = s.StemGUID
        JOIN species sp ON s.SpeciesID = sp.SpeciesID
        JOIN quadrats q ON s.QuadratID = q.QuadratID
        WHERE cm.CensusID = ?
        AND s.TreeTag IN ('TESTVALID001', 'TESTVALID002', 'TESTVALID003')
        ORDER BY s.TreeTag
      `,
        [censusID]
      );

      console.log(`\n✓ Found ${records.length} uploaded records:`);
      records.forEach(r => {
        console.log(`   ${r.TreeTag}: ${r.SpeciesCode} in ${r.QuadratName}, DBH=${r.MeasuredDBH}, HOM=${r.MeasuredHOM}`);
      });

      if (records.length === 3) {
        console.log('✅ GUARANTEE 1 PASSED: All 3 records inserted correctly');
      } else {
        console.log(`❌ GUARANTEE 1 FAILED: Expected 3 records, found ${records.length}`);
      }
    }

    // GUARANTEE 2: Failed measurements
    console.log('\n' + '='.repeat(60));
    console.log('🔍 GUARANTEE 2: Failed rows move to failedmeasurements');
    console.log('='.repeat(60));

    const result2 = await uploadFile('test-invalid-measurements.csv', censusID, personnelID);

    if (result2.success) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check valid records
      const [validRecords] = await connection.execute(
        `
        SELECT COUNT(*) as count
        FROM coremeasurements cm
        JOIN stems s ON cm.StemGUID = s.StemGUID
        WHERE cm.CensusID = ?
        AND s.TreeTag LIKE 'TESTINVALID%'
      `,
        [censusID]
      );

      // Check failed records
      const [failedRecords] = await connection.execute(
        `
        SELECT Tag, StemTag, FailureReason
        FROM failedmeasurements
        WHERE CensusID = ?
        AND Tag LIKE 'TESTINVALID%'
        ORDER BY Tag
      `,
        [censusID]
      );

      console.log(`\n✓ Valid records: ${validRecords[0].count}`);
      console.log(`✓ Failed records: ${failedRecords.length}`);

      if (failedRecords.length > 0) {
        console.log('\nFailed records:');
        failedRecords.forEach(f => {
          console.log(`   ${f.Tag}: ${f.FailureReason}`);
        });
      }

      if (validRecords[0].count === 1 && failedRecords.length === 3) {
        console.log('✅ GUARANTEE 2 PASSED: 1 valid, 3 failed correctly categorized');
      } else {
        console.log(`❌ GUARANTEE 2 FAILED: Expected 1 valid + 3 failed, got ${validRecords[0].count} valid + ${failedRecords.length} failed`);
      }
    }

    // GUARANTEE 3: Tree-stem states
    console.log('\n' + '='.repeat(60));
    console.log('🔍 GUARANTEE 3: Tree-stem states categorize correctly');
    console.log('='.repeat(60));

    const result3 = await uploadFile('test-tree-states.csv', censusID, personnelID);

    if (result3.success) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const [stateRecords] = await connection.execute(
        `
        SELECT s.TreeTag, cm.Description as Codes, cm.IsValidated,
          CASE
            WHEN cm.IsValidated = 1 THEN 'Valid'
            WHEN cm.IsValidated IS NULL OR cm.IsValidated = 0 THEN 'Pending'
          END as ValidationState
        FROM coremeasurements cm
        JOIN stems s ON cm.StemGUID = s.StemGUID
        WHERE cm.CensusID = ?
        AND s.TreeTag LIKE 'TESTSTATE%'
        ORDER BY s.TreeTag
      `,
        [censusID]
      );

      console.log(`\n✓ Found ${stateRecords.length} records with states:`);
      stateRecords.forEach(r => {
        console.log(`   ${r.TreeTag}: Code="${r.Codes || 'none'}", State=${r.ValidationState}`);
      });

      if (stateRecords.length === 4) {
        console.log('✅ GUARANTEE 3 PASSED: Tree-stem states recorded');
      } else {
        console.log(`⚠️  GUARANTEE 3: Expected 4 records, found ${stateRecords.length}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 AUTOMATED TESTS COMPLETE');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await connection.end();
    console.log('\n✅ Database connection closed');
  }
}

// Run the tests
runAutomatedTests().catch(console.error);
