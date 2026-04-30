import { NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import type { Session } from 'next-auth';

const ADMIN_ROLES = new Set(['global', 'db admin']);

export function requireSession(session: Session | null): NextResponse | null {
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: HTTPResponses.UNAUTHORIZED });
  }
  return null;
}

export function requireAdmin(session: Session | null): NextResponse | null {
  const sessionError = requireSession(session);
  if (sessionError) return sessionError;
  const role = session!.user.userStatus;
  if (!ADMIN_ROLES.has(role)) {
    return NextResponse.json({ error: 'forbidden — admin role required' }, { status: HTTPResponses.FORBIDDEN });
  }
  return null;
}
