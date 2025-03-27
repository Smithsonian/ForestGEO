import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { v4 } from 'uuid';
import { HTTPResponses } from '@/config/macros';

export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{ schema: string; plotID: string; censusID: string }>;
  }
) {
  const { schema, plotID, censusID } = await props.params;
  if (!schema || !plotID || !censusID) throw new Error('schema or plotID or censusID not provided');
  // reingestion steps:
  // transfer from failedmeasurements to temporarymeasurements
  // call ingestion process --> should automatically move any remaining broken rows to failedmeasurements
  const connectionManager = ConnectionManager.getInstance();
  let transactionID = '';
  try {
    transactionID = await connectionManager.beginTransaction();
    const fileID = 'reingestion.csv';
    const batchID = v4();
    const shiftQuery = `
    INSERT INTO ${schema}.temporarymeasurements 
      (FileID, BatchID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes)
    SELECT 
      ? AS FileID, 
      ? AS BatchID, 
      fm.PlotID,
      fm.CensusID,
      fm.Tag,
      fm.StemTag,
      fm.SpCode,
      fm.Quadrat,
      fm.X,
      fm.Y,
      fm.DBH,
      fm.HOM,
      fm.Date,
      fm.Codes
    FROM ${schema}.failedmeasurements fm
    WHERE fm.PlotID = ? AND fm.CensusID = ?;`;
    await connectionManager.executeQuery(shiftQuery, [fileID, batchID, plotID, censusID]);
    await connectionManager.executeQuery(`delete from ${schema}.failedmeasurements where PlotID = ? and CensusID = ?`, [plotID, censusID]);
    await connectionManager.executeQuery(`CALL ${schema}.bulkingestionprocess(?, ?)`, [fileID, batchID]);
    await connectionManager.commitTransaction(transactionID);
    return new NextResponse(JSON.stringify({ responseMessage: 'Processing procedure executed' }), { status: HTTPResponses.OK });
  } catch (e: any) {
    await connectionManager.rollbackTransaction(transactionID);
    return new NextResponse(JSON.stringify({ error: e.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
