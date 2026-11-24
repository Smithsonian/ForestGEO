/**
 * Runs a stored procedure that normally opens and commits its own transaction inside a
 * transaction the caller already holds (#527, #507).
 *
 * Such a procedure's START TRANSACTION would silently commit the caller's work. A
 * procedure-specific session flag switches it to caller-owned mode instead. The flag must be
 * cleared on every outcome: a flag left set on a pooled connection would make the next,
 * unrelated CALL skip its own COMMIT. When the flag cannot be cleared, the connection is
 * discarded rather than returned to the pool.
 */
import type { TxExecutor } from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';

export type CallerTransactionExecutor = Pick<TxExecutor, 'query'> & {
  /** Synchronous, idempotent and non-throwing (ConnectionManager.discardTransaction). */
  discard(reason: string): void;
};

export interface CallerOwnedTransactionFlag {
  setSQL: string;
  clearSQL: string;
  /** Passed to `discard` and logged when `clearSQL` fails. */
  clearFailedReason: string;
}

type FlagClearOutcome = { cleared: true } | { cleared: false; error: unknown };

async function clearCallerFlag(tx: CallerTransactionExecutor, flag: CallerOwnedTransactionFlag): Promise<FlagClearOutcome> {
  try {
    await tx.query(flag.clearSQL);
    return { cleared: true };
  } catch (cleanupError: unknown) {
    tx.discard(flag.clearFailedReason);
    ailogger.error(`${flag.clearFailedReason}; connection discarded`, cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)));
    return { cleared: false, error: cleanupError };
  }
}

/**
 * SET, CALL and CLEAR are each awaited so the flag is never cleared while the CALL is
 * still running and the caller cannot commit before cleanup settles. CLEAR also follows
 * a rejected SET: a lost response does not prove the server never applied it.
 */
export async function callProcedureInCallerTransaction<T = unknown>(
  tx: CallerTransactionExecutor,
  flag: CallerOwnedTransactionFlag,
  callSQL: string,
  params: unknown[]
): Promise<T> {
  let result: T;
  try {
    await tx.query(flag.setSQL);
    result = await tx.query<T>(callSQL, params);
  } catch (operationError: unknown) {
    await clearCallerFlag(tx, flag);
    throw operationError;
  }

  const cleanup = await clearCallerFlag(tx, flag);
  if (!cleanup.cleared) throw cleanup.error;
  return result;
}
