export const SETUP_FAILURE_CODES = {
  callbackTimeout: 'SETUP_CALLBACK_TIMEOUT',
  oversizedSubBatch: 'SETUP_OVERSIZED_SUB_BATCH',
  membershipChanged: 'SETUP_MEMBERSHIP_CHANGED',
  lockUnavailable: 'SETUP_LOCK_UNAVAILABLE'
} as const;

const SETUP_FAILURE_SUMMARIES: Record<string, string> = {
  [SETUP_FAILURE_CODES.callbackTimeout]: 'The file uploaded, but preparing its measurements took too long.',
  [SETUP_FAILURE_CODES.oversizedSubBatch]: 'The file uploaded, but one of its batches is larger than allowed. Upload the file again.',
  [SETUP_FAILURE_CODES.membershipChanged]: "The file's staged rows changed while it was being prepared. Upload the file again.",
  [SETUP_FAILURE_CODES.lockUnavailable]: 'Another upload for this file is still being prepared. Try again in a few minutes.'
};

const DEFAULT_SETUP_FAILURE_SUMMARY = 'Upload setup failed while preparing measurements.';

export function setupFailureSummary(code: string | undefined): string {
  return (code && SETUP_FAILURE_SUMMARIES[code]) || DEFAULT_SETUP_FAILURE_SUMMARY;
}
