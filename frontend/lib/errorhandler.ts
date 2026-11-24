import ConnectionManager from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';
import { HTTPResponses } from '@/config/macros';
import { hasErrorCode, INTERNAL_SERVER_ERROR_MESSAGE } from '@/lib/errorhelpers';

const MYSQL_DUPLICATE_ENTRY_CODE = 'ER_DUP_ENTRY';
export const DUPLICATE_ENTRY_MESSAGE = 'A record with the same unique values already exists.';

export async function handleError(error: unknown, conn: ConnectionManager, row: unknown, transactionID?: string) {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  ailogger.error('SQL Error:', normalizedError);

  if (transactionID) {
    try {
      await conn.rollbackTransaction(transactionID);
    } catch (rollbackError) {
      ailogger.error('Failed to rollback transaction:', rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)));
    }
  }

  if (hasErrorCode(error, MYSQL_DUPLICATE_ENTRY_CODE)) {
    return new Response(JSON.stringify({ message: DUPLICATE_ENTRY_MESSAGE, row }), { status: HTTPResponses.CONFLICT });
  }

  return new Response(JSON.stringify({ message: INTERNAL_SERVER_ERROR_MESSAGE, row }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
}
