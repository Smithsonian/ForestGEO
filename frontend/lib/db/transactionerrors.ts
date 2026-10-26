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
