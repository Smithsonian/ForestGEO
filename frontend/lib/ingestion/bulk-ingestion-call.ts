/**
 * Runs bulkingestionprocess inside a transaction the caller already holds (#527).
 *
 * The procedure normally opens and commits its own transaction, which silently
 * commits the caller's. The session flag @bulkingestion_caller_owns_transaction
 * switches it to a savepoint instead. The flag must be cleared on every outcome:
 * a flag left set on a pooled connection would make the next, unrelated CALL
 * skip its own COMMIT. When the flag cannot be cleared, the connection is
 * discarded rather than returned to the pool.
 *
 * lib/uploads/ingest-batch.ts does not hold a transaction and calls the
 * procedure directly so that it keeps its own transaction.
 */
import type ConnectionManager from '@/lib/db/connectionmanager';
import type { TxExecutor } from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import ailogger from '@/ailogger';

export const CALLER_OWNS_TRANSACTION_SQL = 'SET @bulkingestion_caller_owns_transaction = 1';
export const CLEAR_CALLER_TRANSACTION_SQL = 'SET @bulkingestion_caller_owns_transaction = NULL';
export const BULK_INGESTION_CALL_TEMPLATE = 'CALL ??.bulkingestionprocess(?, ?)';
export const MISSING_TRANSACTION_ID_MESSAGE = 'Bulk ingestion requires an active transaction ID';
export const FLAG_CLEAR_FAILED_REASON = 'Failed to clear the bulk-ingestion caller transaction flag';

export type BulkIngestionExecutor = Pick<TxExecutor, 'query'> & {
  /** Synchronous, idempotent and non-throwing (ConnectionManager.discardTransaction). */
  discard(reason: string): void;
};

export function transactionExecutorFor(
  connectionManager: Pick<ConnectionManager, 'executeQuery' | 'discardTransaction'>,
  transactionID: string
): BulkIngestionExecutor {
  if (!transactionID.trim()) throw new Error(MISSING_TRANSACTION_ID_MESSAGE);
  return {
    query: (sql, params) => connectionManager.executeQuery(sql, params, transactionID),
    discard: reason => connectionManager.discardTransaction(transactionID, reason)
  };
}

type FlagClearOutcome = { cleared: true } | { cleared: false; error: unknown };

async function clearCallerFlag(tx: BulkIngestionExecutor): Promise<FlagClearOutcome> {
  try {
    await tx.query(CLEAR_CALLER_TRANSACTION_SQL);
    return { cleared: true };
  } catch (cleanupError: unknown) {
    tx.discard(FLAG_CLEAR_FAILED_REASON);
    ailogger.error(`${FLAG_CLEAR_FAILED_REASON}; connection discarded`, cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)));
    return { cleared: false, error: cleanupError };
  }
}

/**
 * SET, CALL and CLEAR are each awaited so the flag is never cleared while the CALL is
 * still running and the caller cannot commit before cleanup settles. CLEAR also follows
 * a rejected SET: a lost response does not prove the server never applied it.
 */
export async function callBulkIngestionInCallerTransaction<T = unknown>(
  tx: BulkIngestionExecutor,
  schema: string,
  fileID: string,
  batchID: string
): Promise<T> {
  const sql = safeFormatQuery(schema, BULK_INGESTION_CALL_TEMPLATE);
  let result: T;
  try {
    await tx.query(CALLER_OWNS_TRANSACTION_SQL);
    result = await tx.query<T>(sql, [fileID, batchID]);
  } catch (operationError: unknown) {
    await clearCallerFlag(tx);
    throw operationError;
  }

  const cleanup = await clearCallerFlag(tx);
  if (!cleanup.cleared) throw cleanup.error;
  return result;
}
