import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';

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
  const maxAttempts = 10;

  const connectionManager = ConnectionManager.getInstance();
  let attempt = 0;
  let delay = 100;

  while (attempt <= maxAttempts) {
    let transactionID: string = '';

    try {
      attempt++;
      transactionID = await connectionManager.beginTransaction();
      await connectionManager.executeQuery(`CALL ${schema}.bulkingestionprocess(?, ?);`, [fileID, batchID]);
      await connectionManager.commitTransaction(transactionID);
      return new NextResponse(JSON.stringify({ attemptsNeeded: attempt }), { status: HTTPResponses.OK });
    } catch (e: any) {
      ailogger.error(`Attempt ${attempt}: Error encountered (error code: ${e.code || e.errno}). Retrying after ${delay}ms...`);
      try {
        await connectionManager.rollbackTransaction(transactionID);
      } catch (rollbackError: any) {
        ailogger.error('Rollback error:', rollbackError);
      }
      // Wait for an exponentially increasing delay before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 5000); // ceiling at 5 s
      // if (isDeadlockError(e)) {
      // } else {
      //   try {
      //     await connectionManager.rollbackTransaction(transactionID);
      //   } catch (rollbackError) {
      //     console.error('Rollback error:', rollbackError);
      //   }
      //   return new NextResponse(JSON.stringify({ error: e.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
      // }
    }
  }
}
