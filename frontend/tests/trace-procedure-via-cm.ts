/**
 * Trace script: uses the actual ConnectionManager to call bulkingestionprocess
 * to reproduce the exact code path setupbulkprocedure uses.
 */

// Load env vars
process.env.AZURE_SQL_SERVER = 'forestgeo-mysqldataserver.mysql.database.azure.com';
process.env.AZURE_SQL_USER = 'azureroot';
// AZURE_SQL_PASSWORD must be set in environment
process.env.AZURE_SQL_SCHEMA = 'forestgeo_testing_mason';

import ConnectionManager from '../config/connectionmanager';
import { safeFormatQuery } from '../config/utils/sqlsecurity';

const SCHEMA = 'forestgeo_testing_mason';

async function main() {
  const cm = ConnectionManager.getInstance();

  // Clean up from previous runs
  try {
    await cm.executeQuery(
      `DELETE FROM ${SCHEMA}.measurement_error_log WHERE MeasurementID IN (SELECT CoreMeasurementID FROM ${SCHEMA}.coremeasurements WHERE UploadFileID = 'trace_test')`
    );
    await cm.executeQuery(`DELETE FROM ${SCHEMA}.coremeasurements WHERE UploadFileID = 'trace_test'`);
    await cm.executeQuery(`DELETE FROM ${SCHEMA}.stems WHERE CensusID = 14`);
    await cm.executeQuery(`DELETE FROM ${SCHEMA}.trees WHERE CensusID = 14`);
    await cm.executeQuery(`DELETE FROM ${SCHEMA}.uploadmetrics WHERE fileID = 'trace_test'`);
    await cm.executeQuery(`DELETE FROM ${SCHEMA}.temporarymeasurements WHERE FileID = 'trace_test'`);
  } catch (e: any) {
    console.log('Cleanup error (ok):', e.message);
  }

  // Insert test data
  const insertSQL = `INSERT INTO ${SCHEMA}.temporarymeasurements
    (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate)
    VALUES
    ('trace_test', 'trace_001', 1, 14, '010001', '010001', 'DICHGL', '0101', 3.55675, 1.01151, 18, 1.3, '2010-06-22'),
    ('trace_test', 'trace_001', 1, 14, '010002', '010002', 'AMANST', '0101', 2.88782, 0.47993, 350, 1.55, '2010-06-22'),
    ('trace_test', 'trace_001', 1, 14, '010003', '010003', 'DICHGL', '0101', 2.95882, 1.14843, 30, 1.3, '2010-06-22')`;
  await cm.executeQuery(insertSQL);
  console.log('Inserted 3 test rows');

  // === Test A: Direct executeQuery (no transaction) - matches the fixed processSubBatch ===
  console.log('\n=== Test A: executeQuery with safeFormatQuery (no transaction) ===');
  const procedureSQL = safeFormatQuery(SCHEMA, 'CALL ??.bulkingestionprocess(?, ?)');
  console.log('Formatted SQL:', procedureSQL);

  try {
    const result = await cm.executeQuery(procedureSQL, ['trace_test', 'trace_001']);
    console.log('Result type:', typeof result, Array.isArray(result));
    if (Array.isArray(result)) {
      console.log('result[0] type:', typeof result[0], Array.isArray(result[0]));
      if (Array.isArray(result[0]) && result[0].length > 0) {
        console.log('result[0][0]:', result[0][0]);
      } else {
        console.log('result[0]:', result[0]);
      }
    } else {
      console.log('Result:', result);
    }
    console.log('SUCCESS');
  } catch (err: any) {
    console.error('FAILED:', err.message);
    console.error('Code:', err.code, 'Errno:', err.errno, 'SQLState:', err.sqlState);
  }

  // Check result
  const countResult = await cm.executeQuery(`SELECT COUNT(*) as cnt FROM ${SCHEMA}.coremeasurements WHERE UploadFileID = 'trace_test'`);
  console.log('Core measurements:', countResult[0]?.cnt);

  // === Test B: executeQuery within withTransaction ===
  // Reset
  await cm.executeQuery(`DELETE FROM ${SCHEMA}.coremeasurements WHERE UploadFileID = 'trace_test'`);
  await cm.executeQuery(`DELETE FROM ${SCHEMA}.stems WHERE CensusID = 14`);
  await cm.executeQuery(`DELETE FROM ${SCHEMA}.trees WHERE CensusID = 14`);
  await cm.executeQuery(`DELETE FROM ${SCHEMA}.uploadmetrics WHERE fileID = 'trace_test'`);
  await cm.executeQuery(insertSQL.replace('trace_001', 'trace_002'));

  console.log('\n=== Test B: executeQuery within withTransaction ===');
  try {
    const txResult = await cm.withTransaction(
      async (transactionID: string) => {
        console.log('Transaction started:', transactionID);
        const procedureResult = await cm.executeQuery(procedureSQL, ['trace_test', 'trace_002'], transactionID);
        console.log('Procedure returned within transaction');
        if (Array.isArray(procedureResult) && Array.isArray(procedureResult[0]) && procedureResult[0].length > 0) {
          console.log('Result row:', procedureResult[0][0]);
        }
        return procedureResult;
      },
      { timeoutMs: 60000 }
    );
    console.log('withTransaction completed successfully');
  } catch (err: any) {
    console.error('withTransaction FAILED:', err.message);
    console.error('Code:', err.code, 'Errno:', err.errno);
  }

  await cm.closeConnection();
  console.log('\nDone');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
