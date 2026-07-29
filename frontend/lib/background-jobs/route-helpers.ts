import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { HTTPResponses } from '@/config/macros';
import { getSessionUserId } from '@/lib/auth-helpers';
import type { BackgroundJobRecord } from './types';

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

/**
 * Whole-request ceiling for POST /api/uploadjobs, checked against Content-Length
 * before anything reads the body. The per-payload cap can only be measured after
 * parsing, so it cannot stop an oversized request from being buffered — this
 * can. The headroom over the payload cap covers the envelope and up to
 * MAX_UPLOAD_JOB_FILES file descriptors.
 *
 * Lives here rather than in the route because a Next.js route module may only
 * export the framework's recognized fields.
 */
export const MAX_UPLOAD_JOB_REQUEST_BYTES = 4 * 1024 * 1024;

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
