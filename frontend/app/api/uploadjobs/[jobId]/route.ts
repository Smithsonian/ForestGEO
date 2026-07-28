import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireSession, getSessionUserId } from '@/lib/auth-helpers';
import { HTTPResponses } from '@/config/macros';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import { cancelBackgroundJob, getBackgroundJobWithDetails, requestBackgroundJobCancel } from '@/lib/background-jobs/repository';
import { parseJobID, requireJobAccess } from '@/lib/background-jobs/route-helpers';
import type { BackgroundJobWithDetails } from '@/lib/background-jobs/types';
import { fromQuery, withRouteAuthz, type RouteContext } from '@/lib/route-authz';

export const runtime = 'nodejs';

/**
 * The `schema` query param authorizes the request (withRouteAuthz already
 * confirmed the caller is a member of it, or an admin). A job lookup by
 * numeric ID alone would otherwise let a member of one schema probe/cancel a
 * job that belongs to a different schema, so every loaded job's SchemaName
 * must be checked against it before any details are returned or a mutation
 * runs. A mismatch is reported as 404 (not 403) to avoid confirming the job
 * exists in a schema the caller didn't ask about.
 */
function jobBelongsToAuthorizedSchema(job: BackgroundJobWithDetails, authorizedSchema: string): boolean {
  return job.schemaName === authorizedSchema;
}

async function getHandler(request: NextRequest, context: RouteContext) {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const schema = request.nextUrl.searchParams.get('schema')!;
  const { jobId } = (await context.params) as { jobId: string };
  const parsedJobID = parseJobID(jobId);
  if (parsedJobID === null) {
    return NextResponse.json({ error: 'Invalid job ID' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const job = await getBackgroundJobWithDetails(getPoolMonitorInstance().pool, parsedJobID);
  if (!job || !jobBelongsToAuthorizedSchema(job, schema)) {
    return NextResponse.json({ error: 'Upload job not found' }, { status: HTTPResponses.NOT_FOUND });
  }

  const accessError = requireJobAccess(session!, job);
  if (accessError) return accessError;

  return NextResponse.json({ job }, { status: HTTPResponses.OK });
}

async function postHandler(request: NextRequest, context: RouteContext) {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  const schema = request.nextUrl.searchParams.get('schema')!;
  const { jobId } = (await context.params) as { jobId: string };
  const parsedJobID = parseJobID(jobId);
  if (parsedJobID === null) {
    return NextResponse.json({ error: 'Invalid job ID' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const job = await getBackgroundJobWithDetails(getPoolMonitorInstance().pool, parsedJobID);
  if (!job || !jobBelongsToAuthorizedSchema(job, schema)) {
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

export const GET = withRouteAuthz('uploadjobs/[jobId]', getHandler, { schema: fromQuery('schema') });
export const POST = withRouteAuthz('uploadjobs/[jobId]', postHandler, { schema: fromQuery('schema') });
