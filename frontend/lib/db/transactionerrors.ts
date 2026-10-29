export class TransactionCallbackTimeoutError extends Error {
  readonly code = 'TRANSACTION_CALLBACK_TIMEOUT';
  readonly transactionId: string;
  readonly timeoutMs: number;

  constructor(transactionId: string, timeoutMs: number) {
    super(`Transaction ${transactionId} timed out after ${timeoutMs}ms`);
    this.name = 'TransactionCallbackTimeoutError';
    this.transactionId = transactionId;
    this.timeoutMs = timeoutMs;
  }
}

export const TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE = 'TRANSACTION_COMMIT_OUTCOME_UNKNOWN';
export const TRANSACTION_REAPED_CODE = 'TRANSACTION_REAPED';
export const TRANSACTION_NOT_ACTIVE_CODE = 'TRANSACTION_NOT_ACTIVE';

export type CommitOutcomeUnknownTrigger = 'deadline_exceeded' | 'connection_lost';

/**
 * COMMIT was handed to the driver and no server reply arrived, so the transaction may or may not have
 * committed. Never report it as rolled back; a retrying caller may replay the work only if the replay is
 * idempotent (spec §5.2).
 */
export class TransactionCommitOutcomeUnknownError extends Error {
  readonly code = TRANSACTION_COMMIT_OUTCOME_UNKNOWN_CODE;
  readonly transactionId: string;
  readonly trigger: CommitOutcomeUnknownTrigger;
  readonly deadlineMs: number;

  constructor(transactionId: string, trigger: CommitOutcomeUnknownTrigger, deadlineMs: number, options?: ErrorOptions) {
    super('The database did not confirm whether this transaction committed, so its changes may or may not have been saved', options);
    this.name = 'TransactionCommitOutcomeUnknownError';
    this.transactionId = transactionId;
    this.trigger = trigger;
    this.deadlineMs = deadlineMs;
  }
}

/** The reaper ended this transaction because it sat idle past its own deadline; nothing it wrote was committed. */
export class TransactionReapedError extends Error {
  readonly code = TRANSACTION_REAPED_CODE;
  readonly transactionId: string;
  readonly deadlineAt: number;
  readonly reapedAt: number;

  constructor(transactionId: string, deadlineAt: number, reapedAt: number) {
    super('This transaction was reaped after it sat idle past its deadline; none of its changes were committed');
    this.name = 'TransactionReapedError';
    this.transactionId = transactionId;
    this.deadlineAt = deadlineAt;
    this.reapedAt = reapedAt;
  }
}

/** A commit was requested for a transaction that is not active (never begun, already finished, or discarded). */
export class TransactionNotActiveError extends Error {
  readonly code = TRANSACTION_NOT_ACTIVE_CODE;
  readonly transactionId: string;

  constructor(transactionId: string) {
    super('This transaction is no longer active, so this call committed nothing');
    this.name = 'TransactionNotActiveError';
    this.transactionId = transactionId;
  }
}
