import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';

// utils/errorHandler.ts
export function handleError(error: any, conn: ConnectionManager, row: any, transactionID?: string) {
  ailogger.error('SQL Error:', error);
  if (transactionID) {
    conn.rollbackTransaction(transactionID).then(_ => {
      return new Response(
        JSON.stringify({
          message: 'SQL Transaction Error: ' + (error.message || 'Unknown error'),
          row
        }),
        { status: 500 }
      );
    });
  }

  return new Response(
    JSON.stringify({
      message: 'SQL Error: ' + (error.message || 'Unknown error'),
      row
    }),
    { status: 500 }
  );
}
