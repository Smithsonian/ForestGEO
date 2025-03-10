import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';

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
  let transactionID: string = '';
  const connectionManager = ConnectionManager.getInstance();
  try {
    transactionID = await connectionManager.beginTransaction();
    await connectionManager.executeQuery(`CALL ${schema}.bulkingestionprocess(?, ?);`, [fileID, batchID]);
    await connectionManager.commitTransaction(transactionID);
    return new NextResponse(
      JSON.stringify({
        responseMessage: `Processing procedure executed`
      }),
      { status: HTTPResponses.OK }
    );
  } catch (e: any) {
    console.log('first try failed! rolling back changes and trying again...');
    await connectionManager.rollbackTransaction(transactionID);
    let secondary = '';
    try {
      secondary = await connectionManager.beginTransaction();
      await connectionManager.executeQuery(`CALL ${schema}.bulkingestionprocess(?, ?);`, [fileID, batchID]);
      await connectionManager.commitTransaction(secondary);
      return new NextResponse(
        JSON.stringify({
          responseMessage: `Processing procedure executed`
        }),
        { status: HTTPResponses.OK }
      );
    } catch (e: any) {
      await connectionManager.rollbackTransaction(secondary);
      return new NextResponse(JSON.stringify({ error: e.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
    }
  }
}
