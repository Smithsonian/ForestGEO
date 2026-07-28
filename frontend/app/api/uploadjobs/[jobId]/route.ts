import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireSession, getSessionUserId } from '@/lib/auth-helpers';
import { HTTPResponses } from '@/config/macros';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import { cancelBackgroundJob, getBackgroundJobWithDetails, requestBackgroundJobCancel } from '@/lib/background-jobs/repository';
import { parseJobID, requireJobAccess } from '@/lib/background-jobs/route-helpers';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  props: {
    params: Promise<{ jobId: string }>;
  }
) {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const { jobId } = await props.params;
  const parsedJobID = parseJobID(jobId);
  if (parsedJobID === null) {
    return NextResponse.json({ error: 'Invalid job ID' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const job = await getBackgroundJobWithDetails(getPoolMonitorInstance().pool, parsedJobID);
  if (!job) {
    return NextResponse.json({ error: 'Upload job not found' }, { status: HTTPResponses.NOT_FOUND });
  }

  const accessError = requireJobAccess(session!, job);
  if (accessError) return accessError;

  return NextResponse.json({ job }, { status: HTTPResponses.OK });
}

export async function POST(
  request: NextRequest,
  props: {
    params: Promise<{ jobId: string }>;
  }
) {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const { jobId } = await props.params;
  const parsedJobID = parseJobID(jobId);
  if (parsedJobID === null) {
    return NextResponse.json({ error: 'Invalid job ID' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const job = await getBackgroundJobWithDetails(getPoolMonitorInstance().pool, parsedJobID);
  if (!job) {
    return NextResponse.json({ error: 'Upload job not found' }, { status: HTTPResponses.NOT_FOUND });
  }

  const accessError = requireJobAccess(session!, job);
  if (accessError) return accessError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const action = typeof body === 'object' && body !== null && 'action' in body ? (body as { action?: unknown }).action : undefined;
  if (action !== 'cancel') {
    return NextResponse.json({ error: 'Unsupported job action' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  // Idempotent cancel: a job already flipped to cancel_requested needs no
  // further write — the owning worker will finalize it. Report the same
  // pending shape the original cancel returned instead of a 409.
  if (job.status === 'cancel_requested') {
    return NextResponse.json({ success: true, pending: true }, { status: HTTPResponses.OK });
  }

  const userID = getSessionUserId(session!) ?? 'unknown';
  const catalogPool = getPoolMonitorInstance().pool;

  // queued/waiting_retry jobs have no worker and are cancelled directly.
  const cancelled = await cancelBackgroundJob(catalogPool, parsedJobID, userID);
  if (cancelled) {
    return NextResponse.json({ success: true }, { status: HTTPResponses.OK });
  }

  // Running jobs flip to cancel_requested; the owning worker finalizes the
  // terminal 'cancelled' state cooperatively at its next stage boundary.
  const cancelPending = await requestBackgroundJobCancel(catalogPool, parsedJobID, userID);
  if (cancelPending) {
    return NextResponse.json({ success: true, pending: true }, { status: HTTPResponses.OK });
  }

  return NextResponse.json({ error: 'Upload job cannot be cancelled from its current state' }, { status: HTTPResponses.CONFLICT });
}
