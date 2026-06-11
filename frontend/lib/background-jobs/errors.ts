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
