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
