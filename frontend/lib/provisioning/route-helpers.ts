import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { HTTPResponses } from '@/config/macros';
import { ProvisioningError, errorToClientMessage, errorToHttpStatus } from './errors';

const RUN_ID_PATTERN = /^[1-9]\d*$/;

export function parseRunId(raw: string): number | null {
  if (!RUN_ID_PATTERN.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function requireGlobalAdmin(session: Session | null): NextResponse | null {
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: HTTPResponses.UNAUTHORIZED });
  }
  if ((session.user as any)?.userStatus !== 'global') {
    return NextResponse.json({ error: 'Forbidden — global role required' }, { status: HTTPResponses.FORBIDDEN });
  }
  return null;
}

export function provisioningErrorResponse(err: unknown): NextResponse {
  if (err instanceof ProvisioningError) {
    return NextResponse.json({ error: errorToClientMessage(err), kind: err.kind }, { status: errorToHttpStatus(err.kind) });
  }
  return NextResponse.json({ error: 'Internal provisioning error' }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
}
