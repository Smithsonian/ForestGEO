import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';

function isDeadlockError(error: any) {
  return error?.code === 'ER_LOCK_DEADLOCK' || error?.errno === 1213;
}

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
  const maxAttempts = 1000;

  const connectionManager = ConnectionManager.getInstance();
  let attempt = 0;
  const delay = 100;

  while (attempt <= maxAttempts) {
    let transactionID: string = '';

    try {
      attempt++;
      transactionID = await connectionManager.beginTransaction();
      await connectionManager.executeQuery(`CALL ${schema}.bulkingestionprocess(?, ?);`, [fileID, batchID]);
      await connectionManager.commitTransaction(transactionID);

      return new NextResponse(JSON.stringify({ responseMessage: 'Processing procedure executed' }), { status: HTTPResponses.OK });
    } catch (e: any) {
      if (isDeadlockError(e)) {
        console.log(`Attempt ${attempt}: Deadlock encountered (error code: ${e.code || e.errno}). Retrying after ${delay}ms...`);
        try {
          await connectionManager.rollbackTransaction(transactionID);
        } catch (rollbackError) {
          console.error('Rollback error:', rollbackError);
        }
        // Wait for an exponentially increasing delay before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        try {
          await connectionManager.rollbackTransaction(transactionID);
        } catch (rollbackError) {
          console.error('Rollback error:', rollbackError);
        }
        return new NextResponse(JSON.stringify({ error: e.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
      }
    }
  }
}
