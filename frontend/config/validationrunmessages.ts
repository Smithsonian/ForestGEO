/** Retained for old migration records even after the one-time re-score tool is removed. */
export const DBH_RESCORE_ATTEMPT_PREFIX = 'dbh-rescore-attempt:';

/** Internal commit evidence must stay in the database, not in user-facing notices. */
export function publicValidationRunMessages(messages: string[] | null | undefined): string[] | null | undefined {
  return messages?.filter(message => !message.startsWith(DBH_RESCORE_ATTEMPT_PREFIX)) ?? messages;
}
