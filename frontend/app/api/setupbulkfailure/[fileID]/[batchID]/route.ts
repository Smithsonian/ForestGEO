import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// FAILURE PROCESS -- IF A BATCH EXCEEDS ALLOWED ATTEMPTS, MOVE IT TO FAILED & MOVE ON
export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{ fileID: string; batchID: string }>;
  }
) {
  const schema = request.nextUrl.searchParams.get('schema');
  const { fileID, batchID } = await props.params;
  if (!schema || !fileID || !batchID) {
    return new NextResponse(JSON.stringify({ error: 'Missing parameters' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | null = null;
  try {
    transactionID = await connectionManager.beginTransaction();
    let query = `
    insert into ${schema}.failedmeasurements (PlotID, CensusID, Tag, StemTag, SpCode, Quadrat, X, Y, DBH, HOM, Date, Codes, Comments)
    select distinct PlotID,
                    CensusID,
                    nullif(TreeTag, '')                   as Tag,
                    nullif(StemTag, '')                   as StemTag,
                    nullif(SpeciesCode, '')               as SpCode,
                    nullif(QuadratName, '')               as Quadrat,
                    nullif(LocalX, 0)                     as X,
                    nullif(LocalY, 0)                     as Y,
                    nullif(DBH, 0)                        as DBH,
                    nullif(HOM, 0)                        as HOM,
                    nullif(MeasurementDate, '1900-01-01') as MeasurementDate,
                    nullif(Codes, '')                     as Codes,
                    nullif(Comments, '')                  as Comments
    from ${schema}.temporarymeasurements WHERE FileID = ? AND BatchID = ?
    `;
    await connectionManager.executeQuery(query, [fileID, batchID], transactionID);
    query = `delete from ${schema}.temporarymeasurements WHERE FileID = ? AND BatchID = ?`;
    await connectionManager.executeQuery(query, [fileID, batchID], transactionID);
    await connectionManager.commitTransaction(transactionID);
  } catch (e) {
    await connectionManager.rollbackTransaction(transactionID ?? '');
    throw new Error('failure transfer to failedmeasurements --> error detected.');
  }
  return new NextResponse(JSON.stringify({ temp: true }), { status: HTTPResponses.OK });
}
