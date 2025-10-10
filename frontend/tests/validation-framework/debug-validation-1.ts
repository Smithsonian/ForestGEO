/**
 * Debug Validation 1: DBH Growth Exceeds Max
 *
 * This script manually runs the validation query to see why it's not detecting excessive growth
 */

import mysql from 'mysql2/promise';

const dbConfig = {
  host: process.env.AZURE_SQL_SERVER || 'forestgeo-mysqldataserver.mysql.database.azure.com',
  user: process.env.AZURE_SQL_USER || 'azureroot',
  password: process.env.AZURE_SQL_PASSWORD || 'P@ssw0rd',
  port: parseInt(process.env.AZURE_SQL_PORT || '3306'),
  database: process.env.AZURE_SQL_SCHEMA || 'forestgeo_testing'
};

async function debugValidation1() {
  const connection = await mysql.createConnection(dbConfig);

  try {
    console.log('\n=== Debugging Validation 1: DBH Growth ===\n');

    // First, let's check what test data exists
    console.log('1. Checking for test measurements...\n');

    const [testMeasurements] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT
        cm.CoreMeasurementID,
        cm.StemGUID,
        cm.CensusID,
        cm.MeasuredDBH,
        cm.IsValidated,
        cm.IsActive,
        c.PlotCensusNumber,
        c.StartDate,
        t.TreeTag
      FROM ${dbConfig.database}.coremeasurements cm
      JOIN ${dbConfig.database}.census c ON cm.CensusID = c.CensusID
      JOIN ${dbConfig.database}.stems s ON cm.StemGUID = s.StemGUID
      JOIN ${dbConfig.database}.trees t ON s.TreeID = t.TreeID
      WHERE t.TreeTag LIKE 'GROWTH_TEST%'
        OR t.TreeTag LIKE 'NORMAL_GROWTH%'
      ORDER BY cm.StemGUID, c.PlotCensusNumber`
    );

    if (testMeasurements.length === 0) {
      console.log('❌ No test measurements found! Test data may have been cleaned up.\n');
      return;
    }

    console.log(`Found ${testMeasurements.length} test measurements:\n`);
    testMeasurements.forEach((m: any) => {
      console.log(`  TreeTag: ${m.TreeTag}`);
      console.log(`  CoreMeasurementID: ${m.CoreMeasurementID}`);
      console.log(`  StemGUID: ${m.StemGUID}`);
      console.log(`  CensusID: ${m.CensusID} (PlotCensusNumber: ${m.PlotCensusNumber})`);
      console.log(`  MeasuredDBH: ${m.MeasuredDBH}`);
      console.log(`  IsValidated: ${m.IsValidated}`);
      console.log(`  IsActive: ${m.IsActive}`);
      console.log('');
    });

    // Check for attributes
    console.log('2. Checking for cmattributes...\n');

    const cmIDs = testMeasurements.map((m: any) => m.CoreMeasurementID);
    const [attrs] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT cma.CoreMeasurementID, cma.Code, a.Status
       FROM ${dbConfig.database}.cmattributes cma
       LEFT JOIN ${dbConfig.database}.attributes a ON cma.Code = a.Code
       WHERE cma.CoreMeasurementID IN (${cmIDs.join(',')})`
    );

    console.log(`Found ${attrs.length} attribute records:\n`);
    attrs.forEach((a: any) => {
      console.log(`  CoreMeasurementID: ${a.CoreMeasurementID}, Code: ${a.Code}, Status: ${a.Status}`);
    });
    console.log('');

    // Now let's try to run parts of the validation query to see where it fails
    console.log('3. Testing validation query components...\n');

    // Test basic join
    console.log('  a) Testing basic census-to-census join...\n');
    const [basicJoin] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT
        cm_present.CoreMeasurementID as present_id,
        cm_present.MeasuredDBH as present_dbh,
        cm_past.CoreMeasurementID as past_id,
        cm_past.MeasuredDBH as past_dbh,
        c_present.PlotCensusNumber as present_census,
        c_past.PlotCensusNumber as past_census,
        (cm_present.MeasuredDBH - cm_past.MeasuredDBH) as growth
      FROM ${dbConfig.database}.coremeasurements cm_present
      JOIN ${dbConfig.database}.coremeasurements cm_past
        ON cm_present.StemGUID = cm_past.StemGUID
        AND cm_present.CensusID <> cm_past.CensusID
        AND cm_past.IsActive IS TRUE
      JOIN ${dbConfig.database}.census c_present
        ON cm_present.CensusID = c_present.CensusID
      JOIN ${dbConfig.database}.census c_past
        ON cm_past.CensusID = c_past.CensusID
      WHERE cm_present.CoreMeasurementID IN (${cmIDs.join(',')})`
    );

    console.log(`    Found ${basicJoin.length} census-to-census matches:\n`);
    basicJoin.forEach((j: any) => {
      console.log(`      Present ID: ${j.present_id}, DBH: ${j.present_dbh}, Census: ${j.present_census}`);
      console.log(`      Past ID: ${j.past_id}, DBH: ${j.past_dbh}, Census: ${j.past_census}`);
      console.log(`      Growth: ${j.growth}mm\n`);
    });

    // Test with PlotCensusNumber filter
    console.log('  b) Testing with PlotCensusNumber filter...\n');
    const [withCensusFilter] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT
        cm_present.CoreMeasurementID,
        c_past.PlotCensusNumber as past_census,
        c_present.PlotCensusNumber as present_census
      FROM ${dbConfig.database}.coremeasurements cm_present
      JOIN ${dbConfig.database}.coremeasurements cm_past
        ON cm_present.StemGUID = cm_past.StemGUID
        AND cm_present.CensusID <> cm_past.CensusID
      JOIN ${dbConfig.database}.census c_present
        ON cm_present.CensusID = c_present.CensusID
      JOIN ${dbConfig.database}.census c_past
        ON cm_past.CensusID = c_past.CensusID
      WHERE cm_present.CoreMeasurementID IN (${cmIDs.join(',')})
        AND c_past.PlotCensusNumber >= 1
        AND c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1`
    );

    console.log(`    Found ${withCensusFilter.length} matches with census filter\n`);
    withCensusFilter.forEach((f: any) => {
      console.log(`      CoreMeasurementID: ${f.CoreMeasurementID}`);
      console.log(`      Past Census: ${f.past_census}, Present Census: ${f.present_census}\n`);
    });

    // Test with IsValidated filter
    console.log('  c) Testing with IsValidated filter...\n');
    const [withValidatedFilter] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT
        cm_present.CoreMeasurementID,
        cm_present.IsValidated as present_validated,
        cm_past.IsValidated as past_validated
      FROM ${dbConfig.database}.coremeasurements cm_present
      JOIN ${dbConfig.database}.coremeasurements cm_past
        ON cm_present.StemGUID = cm_past.StemGUID
        AND cm_present.CensusID <> cm_past.CensusID
      JOIN ${dbConfig.database}.census c_present
        ON cm_present.CensusID = c_present.CensusID
      JOIN ${dbConfig.database}.census c_past
        ON cm_past.CensusID = c_past.CensusID
      WHERE cm_present.CoreMeasurementID IN (${cmIDs.join(',')})
        AND c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1
        AND cm_present.IsValidated IS NULL
        AND cm_past.IsValidated IS TRUE`
    );

    console.log(`    Found ${withValidatedFilter.length} matches with IsValidated filter\n`);

    // Test with attribute joins
    console.log('  d) Testing with attribute joins...\n');
    const [withAttributeJoins] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT
        cm_present.CoreMeasurementID,
        a_present.Code as present_code,
        a_present.Status as present_status,
        a_past.Code as past_code,
        a_past.Status as past_status
      FROM ${dbConfig.database}.coremeasurements cm_present
      JOIN ${dbConfig.database}.coremeasurements cm_past
        ON cm_present.StemGUID = cm_past.StemGUID
        AND cm_present.CensusID <> cm_past.CensusID
      JOIN ${dbConfig.database}.census c_present
        ON cm_present.CensusID = c_present.CensusID
      JOIN ${dbConfig.database}.census c_past
        ON cm_past.CensusID = c_past.CensusID
      JOIN ${dbConfig.database}.cmattributes cma_present
        ON cma_present.CoreMeasurementID = cm_present.CoreMeasurementID
      JOIN ${dbConfig.database}.attributes a_present
        ON a_present.Code = cma_present.Code
      JOIN ${dbConfig.database}.cmattributes cma_past
        ON cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
      JOIN ${dbConfig.database}.attributes a_past
        ON a_past.Code = cma_past.Code
      WHERE cm_present.CoreMeasurementID IN (${cmIDs.join(',')})
        AND c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1`
    );

    console.log(`    Found ${withAttributeJoins.length} matches with attribute joins\n`);
    withAttributeJoins.forEach((a: any) => {
      console.log(`      CoreMeasurementID: ${a.CoreMeasurementID}`);
      console.log(`      Present: Code=${a.present_code}, Status=${a.present_status}`);
      console.log(`      Past: Code=${a.past_code}, Status=${a.past_status}\n`);
    });

    console.log('=== Debug Complete ===\n');
  } finally {
    await connection.end();
  }
}

debugValidation1();
