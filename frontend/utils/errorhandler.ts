import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';

// utils/errorHandler.ts
export async function handleError(error: any, conn: ConnectionManager, row: any, transactionID?: string) {
  ailogger.error('SQL Error:', error);

  if (transactionID) {
    try {
      await conn.rollbackTransaction(transactionID);
    } catch (rollbackError) {
      ailogger.error('Failed to rollback transaction:', rollbackError);
    }
    return new Response(
      JSON.stringify({
        message: 'SQL Transaction Error: ' + (error.message || 'Unknown error'),
        row
      }),
      { status: 500 }
    );
  }

  return new Response(
    JSON.stringify({
      message: 'SQL Error: ' + (error.message || 'Unknown error'),
      row
    }),
    { status: 500 }
  );
}
