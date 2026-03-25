export interface PermanentChunkFailureControls {
  clearQueue: () => void;
  abortParser: () => void;
  markFatalUploadError: (error: Error) => Error;
}

export function abortChunkProcessingAfterPermanentUploadFailure(error: Error, controls: PermanentChunkFailureControls): Error {
  const fatalError = controls.markFatalUploadError(error);
  controls.clearQueue();
  controls.abortParser();
  return fatalError;
}

export function shouldTimeoutPausedParser(
  pendingQueueSize: number,
  pauseThreshold: number,
  activeOperationCount: number,
  stalledMs: number,
  stallTimeoutMs: number
): boolean {
  return pendingQueueSize >= pauseThreshold && activeOperationCount === 0 && stalledMs > stallTimeoutMs;
}
