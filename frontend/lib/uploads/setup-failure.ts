export const SETUP_FAILURE_CODES = {
  callbackTimeout: 'SETUP_CALLBACK_TIMEOUT',
  oversizedSubBatch: 'SETUP_OVERSIZED_SUB_BATCH',
  membershipChanged: 'SETUP_MEMBERSHIP_CHANGED',
  lockUnavailable: 'SETUP_LOCK_UNAVAILABLE'
} as const;

type SetupFailureCode = (typeof SETUP_FAILURE_CODES)[keyof typeof SETUP_FAILURE_CODES];

const SETUP_FAILURE_SUMMARIES: Record<SetupFailureCode, string> = {
  [SETUP_FAILURE_CODES.callbackTimeout]: 'The file uploaded, but preparing its measurements took too long.',
  [SETUP_FAILURE_CODES.oversizedSubBatch]: 'The file uploaded, but one of its batches is larger than allowed. Upload the file again.',
  [SETUP_FAILURE_CODES.membershipChanged]: "The file's staged rows changed while it was being prepared.",
  [SETUP_FAILURE_CODES.lockUnavailable]: 'Another upload of this file was still being prepared, so this attempt stopped.'
};

const DEFAULT_SETUP_FAILURE_SUMMARY = 'Upload setup failed while preparing measurements.';

export function setupFailureSummary(code: string | undefined): string {
  if (code !== undefined && Object.hasOwn(SETUP_FAILURE_SUMMARIES, code)) return SETUP_FAILURE_SUMMARIES[code as SetupFailureCode];
  return DEFAULT_SETUP_FAILURE_SUMMARY;
}
