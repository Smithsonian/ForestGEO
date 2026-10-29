/**
 * Every substring an automatic-retry or conflict classifier matches in an error message (spec §5.1):
 *   - app/api/sqlpacketload/route.ts isRetryableUploadError
 *   - components/processors/processorhelperfunctions.tsx isRetryableValidationConnectionError
 *   - components/uploadsystem/segments/uploadfiresql.tsx client upload retry
 *   - components/uploadsystemhelpers/uploadsessionconflicts.ts parseUploadSessionConflict (lower-cased match)
 * A message that must stay terminal (never retried, never mistaken for a session conflict) may contain none of them.
 */
export const RETRY_CLASSIFIER_SUBSTRINGS = [
  'Connection lost',
  'server has gone away',
  'server closed the connection',
  'Connection was killed',
  'Lock wait timeout',
  'Deadlock',
  'timeout',
  'timed out',
  'ECONNRESET',
  'PROTOCOL_CONNECTION_LOST',
  'Rate limit exceeded',
  'upload session'
] as const;

/** Returns the classifier substrings found in `text`, compared case-insensitively (the strictest of the classifiers). */
export function findRetryClassifierSubstrings(text: string): string[] {
  const normalizedText = text.toLowerCase();
  return RETRY_CLASSIFIER_SUBSTRINGS.filter(substring => normalizedText.includes(substring.toLowerCase()));
}
