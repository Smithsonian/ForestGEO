/**
 * Trace script: reproduces exactly what setupbulkprocedure does when calling
 * bulkingestionprocess, to isolate why the procedure fails from Node.js
 * but works from the MySQL CLI.
 */
import mysql from 'mysql2/promise';

const SCHEMA = 'forestgeo_testing_mason';

async function main() {
  const pool = mysql.createPool({
    host: 'forestgeo-mysqldataserver.mysql.database.azure.com',
    user: 'azureroot',
    password: process.env.AZURE_SQL_PASSWORD,
    ssl: { rejectUnauthorized: false },
    database: SCHEMA,
    waitForConnections: true,
    connectionLimit: 5
  });

  const conn = await pool.getConnection();

  try {
    // === Test 1: Direct call (no transaction) — like the fixed processSubBatch ===
    console.log('\n=== Test 1: Direct CALL (no outer transaction) ===');
    try {
      const sql = `CALL ${SCHEMA}.bulkingestionprocess(?, ?)`;
      console.log('SQL:', sql);
      console.log('Params:', ['trace_test', 'trace_001']);

      // Use connection.query() like runQuery does for CALL statements
      const [rows] = await conn.query(sql, ['trace_test', 'trace_001']);
      console.log('Result type:', typeof rows, Array.isArray(rows));
      console.log('Result:', JSON.stringify(rows, null, 2));
    } catch (err: any) {
      console.error('Test 1 FAILED:', err.message);
      console.error('Code:', err.code, 'Errno:', err.errno);
      console.error('SQL State:', err.sqlState);
    }

    // Check what happened
    const [countRows] = await conn.execute(
      `SELECT COUNT(*) as cnt FROM ${SCHEMA}.coremeasurements WHERE UploadFileID = 'trace_test'`
    ) as any;
    console.log('Core measurements after test 1:', countRows[0]?.cnt);

    // === Test 2: Within a transaction (simulating old withTransaction) ===
    // Reset first
    await conn.execute(`DELETE FROM ${SCHEMA}.coremeasurements WHERE UploadFileID = 'trace_test'`);
    await conn.execute(`DELETE FROM ${SCHEMA}.stems WHERE CensusID = 14`);
    await conn.execute(`DELETE FROM ${SCHEMA}.trees WHERE CensusID = 14`);
    await conn.execute(`DELETE FROM ${SCHEMA}.uploadmetrics WHERE fileID = 'trace_test'`);

    // Re-insert test rows
    await conn.execute(
      `INSERT INTO ${SCHEMA}.temporarymeasurements
        (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate)
       VALUES
        ('trace_test', 'trace_001', 1, 14, '010001', '010001', 'DICHGL', '0101', 3.55675, 1.01151, 18, 1.3, '2010-06-22'),
        ('trace_test', 'trace_001', 1, 14, '010002', '010002', 'AMANST', '0101', 2.88782, 0.47993, 350, 1.55, '2010-06-22')`
    );

    console.log('\n=== Test 2: CALL within BEGIN TRANSACTION ===');
    try {
      await conn.beginTransaction();
      console.log('Outer transaction started');

      const sql = `CALL ${SCHEMA}.bulkingestionprocess(?, ?)`;
      const [rows] = await conn.query(sql, ['trace_test', 'trace_001']);
      console.log('Result:', JSON.stringify(rows, null, 2));

      await conn.commit();
      console.log('Outer commit succeeded');
    } catch (err: any) {
      console.error('Test 2 FAILED:', err.message);
      console.error('Code:', err.code, 'Errno:', err.errno);
      try { await conn.rollback(); } catch {}
    }

    // === Test 3: Using execute() instead of query() for CALL ===
    // Reset
    await conn.execute(`DELETE FROM ${SCHEMA}.coremeasurements WHERE UploadFileID = 'trace_test'`);
    await conn.execute(`DELETE FROM ${SCHEMA}.stems WHERE CensusID = 14`);
    await conn.execute(`DELETE FROM ${SCHEMA}.trees WHERE CensusID = 14`);
    await conn.execute(`DELETE FROM ${SCHEMA}.uploadmetrics WHERE fileID = 'trace_test'`);

    await conn.execute(
      `INSERT INTO ${SCHEMA}.temporarymeasurements
        (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate)
       VALUES
        ('trace_test', 'trace_001', 1, 14, '010001', '010001', 'DICHGL', '0101', 3.55675, 1.01151, 18, 1.3, '2010-06-22')`
    );

    console.log('\n=== Test 3: CALL using execute() (prepared stmt) ===');
    try {
      const sql = `CALL ${SCHEMA}.bulkingestionprocess(?, ?)`;
      const [rows] = await conn.execute(sql, ['trace_test', 'trace_001']);
      console.log('Result:', JSON.stringify(rows, null, 2));
    } catch (err: any) {
      console.error('Test 3 FAILED:', err.message);
      console.error('Code:', err.code, 'Errno:', err.errno);
    }

  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
