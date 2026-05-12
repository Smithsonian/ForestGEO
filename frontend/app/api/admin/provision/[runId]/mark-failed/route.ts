import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import { getPoolMonitorInstance } from '@/config/poolmonitorsingleton';
import { markStepFailed } from '@/lib/provisioning/orchestrator';

// Force Node.js runtime — mysql2 is not compatible with Edge Runtime
export const runtime = 'nodejs';

const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;
const HTTP_SERVICE_UNAVAILABLE = 503;

export async function POST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const session = await auth();

  const adminError = requireAdmin(session);
  if (adminError) return adminError;

  if (session!.user.userStatus !== 'global') {
    return NextResponse.json({ error: 'Forbidden — global role required' }, { status: 403 });
  }

  const { runId: runIdStr } = await params;
  const runId = parseInt(runIdStr, 10);
  if (!Number.isInteger(runId) || runId < 1) {
    return NextResponse.json({ error: 'Invalid runId — must be a positive integer' }, { status: HTTP_BAD_REQUEST });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: HTTP_BAD_REQUEST });
  }

  const parsed = body as Record<string, unknown>;
  const stepIndex = parsed?.stepIndex;
  if (typeof stepIndex !== 'number' || !Number.isInteger(stepIndex) || stepIndex < 0) {
    return NextResponse.json({ error: 'Invalid stepIndex — must be a non-negative integer' }, { status: HTTP_BAD_REQUEST });
  }

  let catalogPool;
  try {
    catalogPool = getPoolMonitorInstance().pool;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Database unavailable: ${message}` }, { status: HTTP_SERVICE_UNAVAILABLE });
  }

  try {
    await markStepFailed(runId, stepIndex, catalogPool);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: HTTP_CONFLICT });
  }
}
