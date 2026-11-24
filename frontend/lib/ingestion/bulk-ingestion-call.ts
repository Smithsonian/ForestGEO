/**
 * Runs bulkingestionprocess inside a transaction the caller already holds (#527).
 *
 * The procedure normally opens and commits its own transaction, which silently
 * commits the caller's. The session flag @bulkingestion_caller_owns_transaction
 * switches it to a savepoint instead. The flag must be cleared on every outcome:
 * a flag left set on a pooled connection would make the next, unrelated CALL
 * skip its own COMMIT. When the flag cannot be cleared, the connection is
 * discarded rather than returned to the pool (lib/db/caller-owned-procedure-call.ts).
 *
 * lib/uploads/ingest-batch.ts does not hold a transaction and calls the
 * procedure directly so that it keeps its own transaction.
 */
import type ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import { callProcedureInCallerTransaction, type CallerOwnedTransactionFlag, type CallerTransactionExecutor } from '@/lib/db/caller-owned-procedure-call';

export const CALLER_OWNS_TRANSACTION_SQL = 'SET @bulkingestion_caller_owns_transaction = 1';
export const CLEAR_CALLER_TRANSACTION_SQL = 'SET @bulkingestion_caller_owns_transaction = NULL';
export const BULK_INGESTION_CALL_TEMPLATE = 'CALL ??.bulkingestionprocess(?, ?)';
export const MISSING_TRANSACTION_ID_MESSAGE = 'Bulk ingestion requires an active transaction ID';
export const FLAG_CLEAR_FAILED_REASON = 'Failed to clear the bulk-ingestion caller transaction flag';

const BULK_INGESTION_CALLER_FLAG: CallerOwnedTransactionFlag = {
  setSQL: CALLER_OWNS_TRANSACTION_SQL,
  clearSQL: CLEAR_CALLER_TRANSACTION_SQL,
  clearFailedReason: FLAG_CLEAR_FAILED_REASON
};

export type BulkIngestionExecutor = CallerTransactionExecutor;

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

export async function callBulkIngestionInCallerTransaction<T = unknown>(
  tx: BulkIngestionExecutor,
  schema: string,
  fileID: string,
  batchID: string
): Promise<T> {
  return callProcedureInCallerTransaction<T>(tx, BULK_INGESTION_CALLER_FLAG, safeFormatQuery(schema, BULK_INGESTION_CALL_TEMPLATE), [fileID, batchID]);
}
