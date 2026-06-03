import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import type { UserAuthRoles } from '@/config/macros';

// Inline HTTP status codes to keep this module Edge-runtime-safe and free of the
// @/config/macros barrel's transitive Application Insights import (see the same
// rationale in lib/auth-helpers.ts). Keep matched to HTTPResponses.FORBIDDEN /
// HTTPResponses.SERVICE_UNAVAILABLE.
const HTTP_FORBIDDEN = 403;
const HTTP_SERVICE_UNAVAILABLE = 503;

const ADMIN_ROLES = new Set<UserAuthRoles>(['global', 'db admin']);

/**
 * True when the session's role grants cross-schema administrative access.
 */
export function isAdminSession(session: Session): boolean {
  return ADMIN_ROLES.has((session.user.userStatus ?? '') as UserAuthRoles);
}

/**
 * True when the authenticated user is a member of the given site schema.
 * Case-insensitive match against the schemas attached to session.user.sites.
 */
export function hasSchemaAccess(session: Session, schema: string): boolean {
  return (session.user.sites ?? []).some(site => site.schemaName?.toLowerCase() === schema.toLowerCase());
}

/**
 * Reusable guard: returns a 403 NextResponse when the session is not authorized
 * for the given schema, or null when access is permitted. Admins bypass.
 *
 * When `session.user.permissionsUnavailable` is set, the upstream identity
 * provider returned a session but the permissions/sites lookup failed — that
 * is an infra outage, not a user denial. Surface it as 503 so callers can
 * retry instead of mistakenly treating it as access-denied. Mirrors the same
 * branch in `lib/auth-helpers.ts:requireSession`.
 */
export function assertSchemaAccess(session: Session, schema: string): NextResponse | null {
  if (session.user.permissionsUnavailable) {
    return NextResponse.json({ error: 'permissions unavailable', code: 'PERMISSIONS_UNAVAILABLE' }, { status: HTTP_SERVICE_UNAVAILABLE });
  }
  if (isAdminSession(session)) return null;
  if (hasSchemaAccess(session, schema)) return null;
  return NextResponse.json({ error: 'SQL references a schema outside the authenticated user scope' }, { status: HTTP_FORBIDDEN });
}
