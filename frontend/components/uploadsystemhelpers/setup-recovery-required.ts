export const SETUP_COMMIT_OUTCOME_UNKNOWN = 'SETUP_COMMIT_OUTCOME_UNKNOWN';

export class SetupRecoveryRequiredUploadError extends Error {
  readonly code = SETUP_COMMIT_OUTCOME_UNKNOWN;
  readonly recoveryRequired = true;
  constructor(
    message: string,
    readonly jobID?: number,
    readonly step?: string,
    readonly detail?: string
  ) {
    super(message);
    this.name = 'SetupRecoveryRequiredUploadError';
  }
}

export function isSetupRecoveryRequiredUploadError(error: unknown): error is SetupRecoveryRequiredUploadError {
  return (
    error instanceof SetupRecoveryRequiredUploadError ||
    (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === SETUP_COMMIT_OUTCOME_UNKNOWN)
  );
}

export function parseSetupRecoveryRequired(payload: unknown): SetupRecoveryRequiredUploadError | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  const recovery = value.recoveryRequired === true || value.code === SETUP_COMMIT_OUTCOME_UNKNOWN;
  if (!recovery) return null;
  const jobID = Number.isSafeInteger(value.jobID) ? (value.jobID as number) : undefined;
  const step = typeof value.step === 'string' ? value.step.slice(0, 64) : undefined;
  const detail = typeof value.detail === 'string' ? value.detail.slice(0, 300) : undefined;
  const message =
    typeof value.error === 'string'
      ? value.error
      : typeof value.message === 'string'
        ? value.message
        : 'Setup commit outcome is unknown. Contact support before retrying this upload.';
  return new SetupRecoveryRequiredUploadError(message.slice(0, 500), jobID, step, detail);
}
