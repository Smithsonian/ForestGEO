export class WorkerLeaseLostError extends Error {
  constructor(
    public readonly jobID: number,
    public readonly workerID: string
  ) {
    super(`Worker ${workerID} no longer owns job ${jobID}; aborting`);
    this.name = 'WorkerLeaseLostError';
  }
}

export class JobFileNotFoundError extends Error {
  constructor(
    public readonly jobID: number,
    public readonly jobFileID: number
  ) {
    super(`Job file ${jobFileID} not found for job ${jobID}`);
    this.name = 'JobFileNotFoundError';
  }
}

export class IdempotencyKeyConflictError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super(`Idempotency key "${idempotencyKey}" was already used for a different upload job request`);
    this.name = 'IdempotencyKeyConflictError';
  }
}

export class BackgroundJobScopeUnavailableError extends Error {
  constructor(
    public readonly schemaName: string,
    public readonly reason: 'operation_in_progress' | 'site_not_registered'
  ) {
    super(
      reason === 'operation_in_progress'
        ? `Upload job creation is unavailable while schema "${schemaName}" is being provisioned or torn down`
        : `Upload job creation refused because schema "${schemaName}" is no longer registered`
    );
    this.name = 'BackgroundJobScopeUnavailableError';
  }
}

/**
 * Thrown by the worker when a job can never succeed no matter how many times it
 * is retried (unsupported form-type routing, malformed file content, validation
 * step failures, missing pre-flight references). The worker maps this to a
 * fenced markBackgroundJobFailed instead of a waiting_retry transition.
 */
export class NonRetryableJobError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NonRetryableJobError';
  }
}
