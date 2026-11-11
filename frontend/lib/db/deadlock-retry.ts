/**
 * Bounded whole-transaction retry for InnoDB deadlock victims (#562, spec §7).
 *
 * InnoDB breaks a deadlock by rolling one transaction back whole. A caller that
 * owns that transaction can run it again from its first statement; this module
 * does exactly that and nothing else. It deliberately imports nothing from
 * lib/db/primitives.ts: several test files mock that module with closed
 * factories, and keeping out of it keeps #563's merge surface small.
 */
import ailogger from '@/ailogger';

export const MYSQL_DEADLOCK_ERROR_CODE = 'ER_LOCK_DEADLOCK';
export const MYSQL_DEADLOCK_ERRNO = 1213;

/** The values processSubBatch already uses for its own deadlock backoff (lib/uploads/ingest-batch.ts). */
export const DEADLOCK_RETRY_MAX_ATTEMPTS = 3;
export const DEADLOCK_RETRY_INITIAL_DELAY_MS = 100;
export const DEADLOCK_RETRY_BACKOFF_MULTIPLIER = 1.5;
export const DEADLOCK_RETRY_BACKOFF_CAP_MS = 3_000;
export const DEADLOCK_RETRY_JITTER_MAX_MS = 1_000;

export const DEADLOCK_RETRY_EVENT = 'db.transaction.deadlock_retry';

interface DriverErrorFields {
  code?: unknown;
  errno?: unknown;
  cause?: unknown;
}

function carriesDeadlockSignature(candidate: unknown): boolean {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const { code, errno } = candidate as DriverErrorFields;
  return code === MYSQL_DEADLOCK_ERROR_CODE || errno === MYSQL_DEADLOCK_ERRNO;
}

/** A deadlock on the error itself or on its `cause` (ChangelogWriteError wraps the audit statement's driver error there). */
export function isDeadlockError(error: unknown): boolean {
  if (carriesDeadlockSignature(error)) return true;
  return typeof error === 'object' && error !== null && carriesDeadlockSignature((error as DriverErrorFields).cause);
}

function deadlockRetryDelayMs(failedAttempt: number): number {
  const backoffMs = Math.min(DEADLOCK_RETRY_INITIAL_DELAY_MS * DEADLOCK_RETRY_BACKOFF_MULTIPLIER ** (failedAttempt - 1), DEADLOCK_RETRY_BACKOFF_CAP_MS);
  return backoffMs + Math.random() * DEADLOCK_RETRY_JITTER_MAX_MS;
}

/**
 * Runs `attemptTransaction` — which must open, run and end ONE complete transaction — and, when it rejects
 * with a deadlock, runs it again from scratch, at most DEADLOCK_RETRY_MAX_ATTEMPTS times in total. Any other
 * rejection, and the last deadlock, propagate unchanged. Use it only where the caller owns the whole transaction.
 */
export async function retryWholeTransactionOnDeadlock<T>(
  transactionKind: string,
  attemptTransaction: () => Promise<T>,
  onDeadlockRetry: (failedAttempt: number) => void = () => undefined
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptTransaction();
    } catch (error: unknown) {
      if (!isDeadlockError(error) || attempt >= DEADLOCK_RETRY_MAX_ATTEMPTS) throw error;
      const delayMs = deadlockRetryDelayMs(attempt);
      ailogger.warn(DEADLOCK_RETRY_EVENT, {
        transactionKind,
        failedAttempt: attempt,
        nextAttempt: attempt + 1,
        maxAttempts: DEADLOCK_RETRY_MAX_ATTEMPTS,
        delayMs: Math.round(delayMs)
      });
      onDeadlockRetry(attempt);
      await new Promise<void>(resolve => setTimeout(resolve, delayMs));
    }
  }
}
