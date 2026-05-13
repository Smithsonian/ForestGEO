import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import { getPoolMonitorInstance } from '@/config/poolmonitorsingleton';
import { getRunWithSteps, reconcileStaleRun } from '@/lib/provisioning/orchestrator';

// Force Node.js runtime — mysql2 is not compatible with Edge Runtime
export const runtime = 'nodejs';

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVICE_UNAVAILABLE = 503;

// A step is considered stuck if it has been in 'running' state for longer than this threshold.
const STUCK_THRESHOLD_MS = 5 * 60 * 1000;

function parseRunId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const session = await auth();

  const adminError = requireAdmin(session);
  if (adminError) return adminError;

  if (session!.user.userStatus !== 'global') {
    return NextResponse.json({ error: 'Forbidden — global role required' }, { status: 403 });
  }

  const { runId: runIdStr } = await params;
  const runId = parseRunId(runIdStr);
  if (runId == null) {
    return NextResponse.json({ error: 'Invalid runId — must be a positive integer' }, { status: HTTP_BAD_REQUEST });
  }

  let catalogPool;
  try {
    catalogPool = getPoolMonitorInstance().pool;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Database unavailable: ${message}` }, { status: HTTP_SERVICE_UNAVAILABLE });
  }

  let result: Awaited<ReturnType<typeof getRunWithSteps>>;
  try {
    result = await getRunWithSteps(runId, catalogPool);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to load run: ${message}` }, { status: 500 });
  }

  if (!result) {
    return NextResponse.json({ error: `Run ${runId} not found` }, { status: HTTP_NOT_FOUND });
  }

  if (result.run.status === 'running') {
    const reconciled = await reconcileStaleRun(runId, catalogPool);
    if (reconciled) {
      result = await getRunWithSteps(runId, catalogPool);
      if (!result) {
        return NextResponse.json({ error: `Run ${runId} not found after reconciliation` }, { status: HTTP_NOT_FOUND });
      }
    }
  }

  const now = Date.now();
  let stuckStepIndex: number | null = null;
  for (const step of result.steps) {
    if (step.status === 'running' && step.startedAt != null) {
      const startedAtMs = step.startedAt instanceof Date ? step.startedAt.getTime() : new Date(step.startedAt).getTime();
      if (now - startedAtMs > STUCK_THRESHOLD_MS) {
        stuckStepIndex = step.stepIndex;
        break;
      }
    }
  }

  return NextResponse.json({ run: result.run, steps: result.steps, stuckStepIndex });
}
