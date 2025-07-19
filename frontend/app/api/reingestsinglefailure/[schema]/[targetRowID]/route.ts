// api/reingestsinglefailure/[schema]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { v4 } from 'uuid';

export async function GET(
  _request: NextRequest,
  props: {
    params: Promise<{ schema: string; targetRowID: string }>;
  }
) {
  const { schema, targetRowID } = await props.params;
  if (!schema || !targetRowID) throw new Error('core parameters not provided');
  const staticBatchID = v4();
  const shiftQuery = `insert into ${schema}.temporarymeasurements (FileID, BatchID, PlotID,
  CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes)
  select 'single_row_file.csv' as FileID, ? as BatchID, PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes
  from ${schema}.failedmeasurements where FailedMeasurementID = ?;`;
  const clearQuery = `delete from ${schema}.failedmeasurements where FailedMeasurementID = ?`;
  const connectionManager = ConnectionManager.getInstance();
  let transactionID = '';
  try {
    transactionID = await connectionManager.beginTransaction();
    await connectionManager.executeQuery(shiftQuery, [staticBatchID, targetRowID]);
    await connectionManager.executeQuery(clearQuery, [targetRowID]);
    await connectionManager.executeQuery(`CALL ${schema}.bulkingestionprocess(?, ?);`, ['single_row_file.csv', staticBatchID]);
    await connectionManager.commitTransaction(transactionID);
    return NextResponse.json({ message: 'Success' }, { status: 200 });
  } catch (e) {
    await connectionManager.rollbackTransaction(transactionID);
    // reinsert into table in case removed
    await connectionManager.executeQuery(`CALL ${schema}.reviewfailed();`);
    throw e;
  }
}
