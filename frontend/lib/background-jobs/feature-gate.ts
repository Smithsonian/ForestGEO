/**
 * Rollout gate for the async upload worker.
 *
 * The allow-lists are NOT symmetric, and deliberately so:
 *
 *   - `ASYNC_UPLOAD_ALLOWED_USERS` / `ASYNC_UPLOAD_ALLOWED_SCHEMAS` are
 *     fail-CLOSED. An unset or empty list means NOBODY / NOWHERE. Opening the
 *     feature up to everyone requires writing `*` on purpose. The stated rollout
 *     is "one schema, one user", and an empty list previously meant "everyone,
 *     everywhere" the moment ASYNC_UPLOAD_ENABLED flipped to true — a
 *     misconfiguration and a full rollout were the same state.
 *   - `ASYNC_UPLOAD_ALLOWED_FORMS` is fail-OPEN and stays that way. It selects
 *     WHICH upload forms may go async once a user/schema is already permitted;
 *     it is not the blast-radius control. Making it fail-closed would silently
 *     disable the feature for a correctly-allow-listed operator.
 */

const WILDCARD = '*';

function parseAllowList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

function matches(entries: string[], value: string | undefined | null): boolean {
  if (entries.includes(WILDCARD)) return true;
  if (!value) return false;
  return entries.includes(value.trim().toLowerCase());
}

/** Empty list = nobody. Only an explicit `*` opens it up. */
function allowsWhenListed(raw: string | undefined, value: string | undefined | null): boolean {
  const entries = parseAllowList(raw);
  if (entries.length === 0) return false;
  return matches(entries, value);
}

/** Empty list = no restriction on this dimension. */
function allowsUnlessRestricted(raw: string | undefined, value: string | undefined | null): boolean {
  const entries = parseAllowList(raw);
  if (entries.length === 0) return true;
  return matches(entries, value);
}

export function isAsyncUploadEnabledFor({ schema, formType, userIds }: { schema?: string | null; formType?: string | null; userIds?: string[] }): boolean {
  if (process.env.ASYNC_UPLOAD_ENABLED !== 'true') return false;

  const allowedUsers = parseAllowList(process.env.ASYNC_UPLOAD_ALLOWED_USERS);
  const matchesUser =
    allowedUsers.length > 0 && (allowedUsers.includes(WILDCARD) || (userIds ?? []).some(userID => allowedUsers.includes(userID.trim().toLowerCase())));

  return (
    allowsWhenListed(process.env.ASYNC_UPLOAD_ALLOWED_SCHEMAS, schema) &&
    allowsUnlessRestricted(process.env.ASYNC_UPLOAD_ALLOWED_FORMS, formType) &&
    matchesUser
  );
}
