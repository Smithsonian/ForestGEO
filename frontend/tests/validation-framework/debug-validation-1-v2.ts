/**
 * Debug Validation 1: DBH Growth Exceeds Max - Version 2
 *
 * This script creates test data, runs the validation, and debugs why it's not working
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

    // Clean up any existing test data first
    console.log('1. Cleaning up existing test data...\n');

    // Get CoreMeasurementIDs first
    const [existingCMs] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT CoreMeasurementID FROM ${dbConfig.database}.coremeasurements WHERE StemGUID = 999999`
    );
    if (existingCMs.length > 0) {
      const cmIDs = existingCMs.map((r: any) => r.CoreMeasurementID).join(',');
      await connection.query(`DELETE FROM ${dbConfig.database}.cmattributes WHERE CoreMeasurementID IN (${cmIDs})`);
      await connection.query(`DELETE FROM ${dbConfig.database}.cmverrors WHERE CoreMeasurementID IN (${cmIDs})`);
    }

    await connection.query(`DELETE FROM ${dbConfig.database}.coremeasurements WHERE StemGUID = 999999`);
    await connection.query(`DELETE FROM ${dbConfig.database}.stems WHERE StemGUID = 999999`);

    // Get TreeIDs for DEBUG_GROWTH_1
    const [existingTrees] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TreeID FROM ${dbConfig.database}.trees WHERE TreeTag = 'DEBUG_GROWTH_1'`
    );
    if (existingTrees.length > 0) {
      const treeIDs = existingTrees.map((r: any) => r.TreeID).join(',');
      await connection.query(`DELETE FROM ${dbConfig.database}.trees WHERE TreeID IN (${treeIDs})`);
    }

    await connection.query(`DELETE FROM ${dbConfig.database}.quadrats WHERE QuadratName = 'DEBUG_Q1'`);

    // Get CensusIDs for plot 9999 with census numbers 991, 992
    const [existingCensuses] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT CensusID FROM ${dbConfig.database}.census WHERE PlotID = 9999 AND PlotCensusNumber IN (991, 992)`
    );
    if (existingCensuses.length > 0) {
      const censusIDs = existingCensuses.map((r: any) => r.CensusID).join(',');
      await connection.query(`DELETE FROM ${dbConfig.database}.census WHERE CensusID IN (${censusIDs})`);
    }

    await connection.query(`DELETE FROM ${dbConfig.database}.plots WHERE PlotID = 9999`);
    await connection.query(`DELETE FROM ${dbConfig.database}.species WHERE SpeciesCode = 'DEBUG_SP'`);
    await connection.query(`DELETE FROM ${dbConfig.database}.attributes WHERE Code = 'DEBUG_A'`);

    // Create test data
    console.log('2. Creating test data...\n');

    // Attribute
    await connection.query(
      `INSERT INTO ${dbConfig.database}.attributes (Code, Description, Status, IsActive) VALUES (?, ?, ?, ?)`,
      ['DEBUG_A', 'debug alive', 'alive', true]
    );

    // Species
    await connection.query(
      `INSERT INTO ${dbConfig.database}.species (SpeciesCode, SpeciesName, IsActive) VALUES (?, ?, ?)`,
      ['DEBUG_SP', 'Debug Species', true]
    );
    const [speciesRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT SpeciesID FROM ${dbConfig.database}.species WHERE SpeciesCode = 'DEBUG_SP'`
    );
    const speciesID = speciesRows[0].SpeciesID;

    // Plot
    await connection.query(
      `INSERT INTO ${dbConfig.database}.plots (PlotID, DimensionX, DimensionY, DefaultDBHUnits) VALUES (?, ?, ?, ?)`,
      [9999, 100, 100, 'mm']
    );

    // Census 1 and 2
    await connection.query(
      `INSERT INTO ${dbConfig.database}.census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive) VALUES (?, ?, ?, ?, ?)`,
      [9999, 991, new Date('2015-01-01'), new Date('2015-12-31'), true]
    );
    await connection.query(
      `INSERT INTO ${dbConfig.database}.census (PlotID, PlotCensusNumber, StartDate, EndDate, IsActive) VALUES (?, ?, ?, ?, ?)`,
      [9999, 992, new Date('2020-01-01'), new Date('2020-12-31'), true]
    );
    const [census1Rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT CensusID FROM ${dbConfig.database}.census WHERE PlotID = 9999 AND PlotCensusNumber = 991`
    );
    const [census2Rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT CensusID FROM ${dbConfig.database}.census WHERE PlotID = 9999 AND PlotCensusNumber = 992`
    );
    const census1ID = census1Rows[0].CensusID;
    const census2ID = census2Rows[0].CensusID;

    // Quadrat
    await connection.query(
      `INSERT INTO ${dbConfig.database}.quadrats (PlotID, QuadratName, DimensionX, DimensionY, StartX, StartY, IsActive) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [9999, 'DEBUG_Q1', 20, 20, 0, 0, true]
    );
    const [quadratRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT QuadratID FROM ${dbConfig.database}.quadrats WHERE QuadratName = 'DEBUG_Q1'`
    );
    const quadratID = quadratRows[0].QuadratID;

    // Tree (for Census 1) - Trees are also per-census
    await connection.query(
      `INSERT INTO ${dbConfig.database}.trees (CensusID, SpeciesID, TreeTag, IsActive) VALUES (?, ?, ?, ?)`,
      [census1ID, speciesID, 'DEBUG_GROWTH_1', true]
    );
    const [tree1Rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TreeID FROM ${dbConfig.database}.trees WHERE TreeTag = 'DEBUG_GROWTH_1' AND CensusID = ?`,
      [census1ID]
    );
    const tree1ID = tree1Rows[0].TreeID;

    // Tree (for Census 2)
    await connection.query(
      `INSERT INTO ${dbConfig.database}.trees (CensusID, SpeciesID, TreeTag, IsActive) VALUES (?, ?, ?, ?)`,
      [census2ID, speciesID, 'DEBUG_GROWTH_1', true]
    );
    const [tree2Rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT TreeID FROM ${dbConfig.database}.trees WHERE TreeTag = 'DEBUG_GROWTH_1' AND CensusID = ?`,
      [census2ID]
    );
    const tree2ID = tree2Rows[0].TreeID;

    // Stem (for Census 1) - Create stem once for first census, then link to it in subsequent censuses
    await connection.query(
      `INSERT INTO ${dbConfig.database}.stems (StemGUID, CensusID, TreeID, QuadratID, StemTag, LocalX, LocalY, IsActive) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [999999, census1ID, tree1ID, quadratID, 'S1', 10, 10, true]
    );

    // NOTE: We don't create a second stem record - the same StemGUID is used across censuses
    // Measurements for census 2 will reference the same StemGUID

    // CoreMeasurement 1 (Census 1: DBH = 100mm, IsValidated = true)
    await connection.query(
      `INSERT INTO ${dbConfig.database}.coremeasurements (StemGUID, CensusID, MeasurementDate, MeasuredDBH, MeasuredHOM, IsValidated, IsActive) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [999999, census1ID, new Date('2015-06-01'), 100, 130, true, true]
    );
    const [cm1Rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT CoreMeasurementID FROM ${dbConfig.database}.coremeasurements WHERE StemGUID = 999999 AND CensusID = ?`,
      [census1ID]
    );
    const cm1ID = cm1Rows[0].CoreMeasurementID;

    // CoreMeasurement 2 (Census 2: DBH = 200mm, IsValidated = null)
    await connection.query(
      `INSERT INTO ${dbConfig.database}.coremeasurements (StemGUID, CensusID, MeasurementDate, MeasuredDBH, MeasuredHOM, IsValidated, IsActive) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [999999, census2ID, new Date('2020-06-01'), 200, 130, null, true]
    );
    const [cm2Rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT CoreMeasurementID FROM ${dbConfig.database}.coremeasurements WHERE StemGUID = 999999 AND CensusID = ?`,
      [census2ID]
    );
    const cm2ID = cm2Rows[0].CoreMeasurementID;

    // CMAttributes
    await connection.query(
      `INSERT INTO ${dbConfig.database}.cmattributes (CoreMeasurementID, Code) VALUES (?, ?)`,
      [cm1ID, 'DEBUG_A']
    );
    await connection.query(
      `INSERT INTO ${dbConfig.database}.cmattributes (CoreMeasurementID, Code) VALUES (?, ?)`,
      [cm2ID, 'DEBUG_A']
    );

    console.log('  ✓ Test data created:');
    console.log(`    - PlotID: 9999`);
    console.log(`    - Census 1 ID: ${census1ID}, PlotCensusNumber: 991`);
    console.log(`    - Census 2 ID: ${census2ID}, PlotCensusNumber: 992`);
    console.log(`    - TreeID Census 1: ${tree1ID}, TreeTag: DEBUG_GROWTH_1`);
    console.log(`    - TreeID Census 2: ${tree2ID}, TreeTag: DEBUG_GROWTH_1`);
    console.log(`    - StemGUID: 999999`);
    console.log(`    - CoreMeasurement 1 ID: ${cm1ID}, DBH: 100mm, IsValidated: true`);
    console.log(`    - CoreMeasurement 2 ID: ${cm2ID}, DBH: 200mm, IsValidated: null`);
    console.log(`    - Growth: 100mm (exceeds 65mm limit)\n`);

    // Test query step by step
    console.log('3. Testing query components...\n');

    // a) Basic join
    console.log('  a) Basic census-to-census join:');
    const [basicJoin] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT
        cm_present.CoreMeasurementID as present_id,
        cm_present.MeasuredDBH as present_dbh,
        cm_present.IsValidated as present_validated,
        cm_past.CoreMeasurementID as past_id,
        cm_past.MeasuredDBH as past_dbh,
        cm_past.IsValidated as past_validated,
        (cm_present.MeasuredDBH - cm_past.MeasuredDBH) as growth
      FROM ${dbConfig.database}.coremeasurements cm_present
      JOIN ${dbConfig.database}.coremeasurements cm_past
        ON cm_present.StemGUID = cm_past.StemGUID
        AND cm_present.CensusID <> cm_past.CensusID
        AND cm_past.IsActive IS TRUE
      WHERE cm_present.StemGUID = 999999
        AND cm_present.IsActive IS TRUE`
    );
    console.log(`     Found ${basicJoin.length} matches`);
    basicJoin.forEach((j: any) => {
      console.log(`       Present: ID=${j.present_id}, DBH=${j.present_dbh}, Validated=${j.present_validated}`);
      console.log(`       Past: ID=${j.past_id}, DBH=${j.past_dbh}, Validated=${j.past_validated}`);
      console.log(`       Growth: ${j.growth}mm\n`);
    });

    // b) With census joins
    console.log('  b) With census joins and PlotCensusNumber filter:');
    const [withCensus] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT
        cm_present.CoreMeasurementID as present_id,
        c_present.PlotCensusNumber as present_census,
        c_past.PlotCensusNumber as past_census,
        (c_present.PlotCensusNumber - 1 = c_past.PlotCensusNumber) as census_match
      FROM ${dbConfig.database}.coremeasurements cm_present
      JOIN ${dbConfig.database}.coremeasurements cm_past
        ON cm_present.StemGUID = cm_past.StemGUID
        AND cm_present.CensusID <> cm_past.CensusID
        AND cm_past.IsActive IS TRUE
      JOIN ${dbConfig.database}.census c_present
        ON cm_present.CensusID = c_present.CensusID
        AND c_present.IsActive IS TRUE
      JOIN ${dbConfig.database}.census c_past
        ON cm_past.CensusID = c_past.CensusID
        AND c_past.IsActive IS TRUE
      WHERE cm_present.StemGUID = 999999
        AND cm_present.IsActive IS TRUE
        AND c_past.PlotCensusNumber >= 1
        AND c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1`
    );
    console.log(`     Found ${withCensus.length} matches with census filter`);
    withCensus.forEach((c: any) => {
      console.log(`       Present Census: ${c.present_census}, Past Census: ${c.past_census}, Match: ${c.census_match}\n`);
    });

    // c) With attribute joins
    console.log('  c) With attribute joins:');
    const [withAttrs] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT
        cm_present.CoreMeasurementID as present_id,
        a_present.Code as present_code,
        a_present.Status as present_status,
        a_past.Code as past_code,
        a_past.Status as past_status
      FROM ${dbConfig.database}.coremeasurements cm_present
      JOIN ${dbConfig.database}.coremeasurements cm_past
        ON cm_present.StemGUID = cm_past.StemGUID
        AND cm_present.CensusID <> cm_past.CensusID
        AND cm_past.IsActive IS TRUE
      JOIN ${dbConfig.database}.census c_present
        ON cm_present.CensusID = c_present.CensusID AND c_present.IsActive IS TRUE
      JOIN ${dbConfig.database}.census c_past
        ON cm_past.CensusID = c_past.CensusID AND c_past.IsActive IS TRUE
      JOIN ${dbConfig.database}.cmattributes cma_present
        ON cma_present.CoreMeasurementID = cm_present.CoreMeasurementID
      JOIN ${dbConfig.database}.attributes a_present
        ON a_present.Code = cma_present.Code
      JOIN ${dbConfig.database}.cmattributes cma_past
        ON cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
      JOIN ${dbConfig.database}.attributes a_past
        ON a_past.Code = cma_past.Code
      WHERE cm_present.StemGUID = 999999
        AND cm_present.IsActive IS TRUE
        AND c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1`
    );
    console.log(`     Found ${withAttrs.length} matches with attribute joins`);
    withAttrs.forEach((a: any) => {
      console.log(`       Present: Code=${a.present_code}, Status=${a.present_status}`);
      console.log(`       Past: Code=${a.past_code}, Status=${a.past_status}\n`);
    });

    // d) Full validation query simulation
    console.log('  d) Full validation query (without inserting into cmverrors):');
    const [fullQuery] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT DISTINCT
        cm_present.CoreMeasurementID,
        cm_present.MeasuredDBH as present_dbh,
        cm_past.MeasuredDBH as past_dbh,
        (cm_present.MeasuredDBH - cm_past.MeasuredDBH) as growth,
        p.DefaultDBHUnits as units
      FROM ${dbConfig.database}.coremeasurements cm_present
      JOIN ${dbConfig.database}.coremeasurements cm_past
        ON cm_present.StemGUID = cm_past.StemGUID
        AND cm_present.CensusID <> cm_past.CensusID
        AND cm_past.IsActive IS TRUE
      JOIN ${dbConfig.database}.census c_present
        ON cm_present.CensusID = c_present.CensusID AND c_present.IsActive IS TRUE
      JOIN ${dbConfig.database}.census c_past
        ON cm_past.CensusID = c_past.CensusID AND c_past.IsActive IS TRUE
      JOIN ${dbConfig.database}.plots p
        ON c_present.PlotID = p.PlotID AND c_past.PlotID = p.PlotID
      JOIN ${dbConfig.database}.cmattributes cma_present
        ON cma_present.CoreMeasurementID = cm_present.CoreMeasurementID
      JOIN ${dbConfig.database}.attributes a_present
        ON a_present.Code = cma_present.Code
      JOIN ${dbConfig.database}.cmattributes cma_past
        ON cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
      JOIN ${dbConfig.database}.attributes a_past
        ON a_past.Code = cma_past.Code
      WHERE c_past.PlotCensusNumber >= 1
        AND c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1
        AND cm_present.IsActive IS TRUE
        AND a_present.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted')
        AND a_past.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted')
        AND cm_present.IsValidated IS NULL
        AND cm_past.IsValidated IS TRUE
        AND cm_past.MeasuredDBH > 0
        AND (cm_present.MeasuredDBH - cm_past.MeasuredDBH) * (CASE p.DefaultDBHUnits
          WHEN 'km' THEN 1000000
          WHEN 'hm' THEN 100000
          WHEN 'dam' THEN 10000
          WHEN 'm' THEN 1000
          WHEN 'dm' THEN 100
          WHEN 'cm' THEN 10
          WHEN 'mm' THEN 1
          ELSE 1 END) > 65
        AND cm_present.StemGUID = 999999`
    );

    console.log(`     Found ${fullQuery.length} measurements that should be flagged`);
    if (fullQuery.length > 0) {
      fullQuery.forEach((r: any) => {
        console.log(`       ✓ CoreMeasurementID: ${r.CoreMeasurementID}`);
        console.log(`         Present DBH: ${r.present_dbh}mm, Past DBH: ${r.past_dbh}mm`);
        console.log(`         Growth: ${r.growth}mm (units: ${r.units})\n`);
      });
      console.log('     ✅ VALIDATION QUERY IS WORKING! Issue must be elsewhere.\n');
    } else {
      console.log('     ❌ VALIDATION QUERY FAILED! No rows matched.\n');
      console.log('     Checking each condition individually:\n');

      // Check each condition
      const conditions = [
        { name: 'PlotCensusNumber >= 1', where: 'c_past.PlotCensusNumber >= 1' },
        { name: 'Sequential censuses', where: 'c_past.PlotCensusNumber = c_present.PlotCensusNumber - 1' },
        { name: 'Present IsActive', where: 'cm_present.IsActive IS TRUE' },
        { name: 'Present status OK', where: "a_present.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted')" },
        { name: 'Past status OK', where: "a_past.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted')" },
        { name: 'Present IsValidated IS NULL', where: 'cm_present.IsValidated IS NULL' },
        { name: 'Past IsValidated IS TRUE', where: 'cm_past.IsValidated IS TRUE' },
        { name: 'Past DBH > 0', where: 'cm_past.MeasuredDBH > 0' },
        { name: 'Growth > 65mm', where: '(cm_present.MeasuredDBH - cm_past.MeasuredDBH) > 65' }
      ];

      for (const condition of conditions) {
        const [testResult] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) as count
          FROM ${dbConfig.database}.coremeasurements cm_present
          JOIN ${dbConfig.database}.coremeasurements cm_past
            ON cm_present.StemGUID = cm_past.StemGUID
            AND cm_present.CensusID <> cm_past.CensusID
            AND cm_past.IsActive IS TRUE
          JOIN ${dbConfig.database}.census c_present
            ON cm_present.CensusID = c_present.CensusID AND c_present.IsActive IS TRUE
          JOIN ${dbConfig.database}.census c_past
            ON cm_past.CensusID = c_past.CensusID AND c_past.IsActive IS TRUE
          JOIN ${dbConfig.database}.plots p
            ON c_present.PlotID = p.PlotID AND c_past.PlotID = p.PlotID
          JOIN ${dbConfig.database}.cmattributes cma_present
            ON cma_present.CoreMeasurementID = cm_present.CoreMeasurementID
          JOIN ${dbConfig.database}.attributes a_present
            ON a_present.Code = cma_present.Code
          JOIN ${dbConfig.database}.cmattributes cma_past
            ON cma_past.CoreMeasurementID = cm_past.CoreMeasurementID
          JOIN ${dbConfig.database}.attributes a_past
            ON a_past.Code = cma_past.Code
          WHERE cm_present.StemGUID = 999999
            AND ${condition.where}`
        );
        const count = (testResult[0] as any).count;
        const status = count > 0 ? '✅' : '❌';
        console.log(`       ${status} ${condition.name}: ${count} rows`);
      }
    }

    console.log('\n=== Debug Complete ===\n');

    // Clean up
    console.log('4. Cleaning up test data...\n');
    await connection.query(`DELETE FROM ${dbConfig.database}.cmattributes WHERE CoreMeasurementID IN (${cm1ID}, ${cm2ID})`);
    await connection.query(`DELETE FROM ${dbConfig.database}.coremeasurements WHERE CoreMeasurementID IN (${cm1ID}, ${cm2ID})`);
    await connection.query(`DELETE FROM ${dbConfig.database}.stems WHERE StemGUID = 999999`);
    await connection.query(`DELETE FROM ${dbConfig.database}.trees WHERE TreeID IN (${tree1ID}, ${tree2ID})`);
    await connection.query(`DELETE FROM ${dbConfig.database}.quadrats WHERE QuadratID = ${quadratID}`);
    await connection.query(`DELETE FROM ${dbConfig.database}.census WHERE CensusID IN (${census1ID}, ${census2ID})`);
    await connection.query(`DELETE FROM ${dbConfig.database}.plots WHERE PlotID = 9999`);
    await connection.query(`DELETE FROM ${dbConfig.database}.species WHERE SpeciesID = ${speciesID}`);
    await connection.query(`DELETE FROM ${dbConfig.database}.attributes WHERE Code = 'DEBUG_A'`);
    console.log('  ✓ Test data cleaned up\n');

  } finally {
    await connection.end();
  }
}

debugValidation1();
