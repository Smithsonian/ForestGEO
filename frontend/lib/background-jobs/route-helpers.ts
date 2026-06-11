import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { HTTPResponses } from '@/config/macros';
import { getSessionUserId } from '@/lib/auth-helpers';
import type { BackgroundJobRecord } from './types';

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

export function parseJobID(raw: string): number | null {
  if (!POSITIVE_INTEGER_PATTERN.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseOptionalPositiveInteger(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined;
  if (!POSITIVE_INTEGER_PATTERN.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function isPrivilegedSession(session: Session): boolean {
  return session.user?.userStatus === 'global' || session.user?.userStatus === 'db admin';
}

export function requireJobAccess(session: Session, job: BackgroundJobRecord): NextResponse | null {
  if (isPrivilegedSession(session)) return null;
  const userID = getSessionUserId(session);
  if (userID && userID === job.createdBy) return null;
  return NextResponse.json({ error: 'Forbidden - job does not belong to the authenticated user' }, { status: HTTPResponses.FORBIDDEN });
}
