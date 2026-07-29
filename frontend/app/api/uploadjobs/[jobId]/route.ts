import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireSession, getSessionUserId } from '@/lib/auth-helpers';
import { HTTPResponses } from '@/config/macros';
import { getPoolMonitorInstance } from '@/lib/db/poolmonitorsingleton';
import { cancelBackgroundJob, getBackgroundJobWithDetails, requestBackgroundJobCancel } from '@/lib/background-jobs/repository';
import { cleanupCancelledUnclaimedJobArtifacts } from '@/lib/background-jobs/worker';
import { parseJobID, requireJobAccess } from '@/lib/background-jobs/route-helpers';
import type { BackgroundJobWithDetails } from '@/lib/background-jobs/types';
import ConnectionManager from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';
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
 *
 * Case-insensitive to match lib/authz.ts:hasSchemaAccess, which is the check
 * withRouteAuthz already ran to authorize `authorizedSchema` — a
 * differently-cased but membership-valid schema must not fail this
 * secondary check after already clearing that one.
 */
function jobBelongsToAuthorizedSchema(job: BackgroundJobWithDetails, authorizedSchema: string): boolean {
  return job.schemaName?.toLowerCase() === authorizedSchema.toLowerCase();
}

async function getHandler(request: NextRequest, context: RouteContext) {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  // withRouteAuthz already resolved and authorized `schema` before this
  // handler ran; re-checked here (rather than asserted with `!`) purely as
  // defense-in-depth, matching the sibling-route idiom (e.g.
  // setupbulkcollapser/[censusID]/route.ts).
  const schema = request.nextUrl.searchParams.get('schema');
  const { jobId } = (await context.params) as { jobId: string };
  const parsedJobID = parseJobID(jobId);
  if (!schema || parsedJobID === null) {
    return NextResponse.json({ error: 'Missing or invalid parameters' }, { status: HTTPResponses.INVALID_REQUEST });
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

  // withRouteAuthz already resolved and authorized `schema` before this
  // handler ran; re-checked here (rather than asserted with `!`) purely as
  // defense-in-depth, matching the sibling-route idiom (e.g.
  // setupbulkcollapser/[censusID]/route.ts).
  const schema = request.nextUrl.searchParams.get('schema');
  const { jobId } = (await context.params) as { jobId: string };
  const parsedJobID = parseJobID(jobId);
  if (!schema || parsedJobID === null) {
    return NextResponse.json({ error: 'Missing or invalid parameters' }, { status: HTTPResponses.INVALID_REQUEST });
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
    // A waiting_retry job's dead attempt may have left staged rows and parse
    // rejects behind; with no worker to finalize this cancel, clean them here.
    // Best-effort: the cancel itself is already durable, and the cleanup is
    // idempotent hygiene — a failure here must not turn the cancel into a 500.
    try {
      await cleanupCancelledUnclaimedJobArtifacts(ConnectionManager.getInstance(), job);
    } catch (cleanupError) {
      ailogger.warn(
        `[uploadjobs] Cancelled job ${parsedJobID} but artifact cleanup failed (residue remains until next attempt): ` +
          `${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
      );
    }
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
