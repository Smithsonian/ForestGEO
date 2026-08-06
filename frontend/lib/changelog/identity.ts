/**
 * Session identity resolution for `unifiedchangelog.ChangedBy`.
 *
 * Extracted from app/api/sqlpacketload/route.ts so the upload path and the
 * grid-mutation path attribute changes the same way instead of drifting apart.
 */

/**
 * `unifiedchangelog.ChangedBy` is varchar(64) (db/sql/tablestructures.sql).
 * Long Smithsonian addresses can exceed it, and under STRICT_TRANS_TABLES an
 * over-length insert raises ER_DATA_TOO_LONG — which, because the changelog
 * write shares the mutation's transaction, would roll back the user's edit.
 * Truncating here makes the loss deliberate and keeps the edit intact.
 */
export const CHANGED_BY_MAX_LENGTH = 64;

const ANONYMOUS_CHANGED_BY = 'authenticated-user';
const IDENTITY_KEYS = ['email', 'name', 'id'] as const;

export function authenticatedSessionIdentity(sessionUser: unknown): string {
  if (!sessionUser || typeof sessionUser !== 'object' || Array.isArray(sessionUser)) return ANONYMOUS_CHANGED_BY;
  const record = sessionUser as Record<string, unknown>;
  for (const key of IDENTITY_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim().slice(0, CHANGED_BY_MAX_LENGTH);
  }
  return ANONYMOUS_CHANGED_BY;
}
