import ConnectionManager from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';

export async function handleError(error: unknown, conn: ConnectionManager, row: unknown, transactionID?: string) {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  ailogger.error('SQL Error:', normalizedError);

  if (transactionID) {
    try {
      await conn.rollbackTransaction(transactionID);
    } catch (rollbackError) {
      ailogger.error('Failed to rollback transaction:', rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)));
    }
    return new Response(
      JSON.stringify({
        message: 'SQL Transaction Error: ' + (normalizedError.message || 'Unknown error'),
        row
      }),
      { status: 500 }
    );
  }

  return new Response(
    JSON.stringify({
      message: 'SQL Error: ' + (normalizedError.message || 'Unknown error'),
      row
    }),
    { status: 500 }
  );
}
