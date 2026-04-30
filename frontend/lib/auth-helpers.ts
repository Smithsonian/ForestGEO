import { NextResponse } from 'next/server';
import type { UserAuthRoles } from '@/config/macros';
import type { Session } from 'next-auth';

// Inline HTTP status codes so this helper stays Edge-runtime-safe. The
// @/config/macros barrel transitively pulls in @microsoft/applicationinsights-web
// (via ConnectionManager → ailogger), which would poison any Edge bundle that
// imports auth-helpers. Keep these numeric literals matched to HTTPResponses
// in @/config/macros.
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

const ADMIN_ROLES = new Set<UserAuthRoles>(['global', 'db admin']);

export function requireSession(session: Session | null): NextResponse | null {
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: HTTP_UNAUTHORIZED });
  }
  return null;
}

export function requireAdmin(session: Session | null): NextResponse | null {
  const sessionError = requireSession(session);
  if (sessionError) return sessionError;
  const role = session!.user.userStatus;
  if (!role || !ADMIN_ROLES.has(role)) {
    return NextResponse.json({ error: 'forbidden — admin role required' }, { status: HTTP_FORBIDDEN });
  }
  return null;
}
