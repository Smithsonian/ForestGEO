import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { parseRunId, requireGlobalAdmin, provisioningErrorResponse } from '@/lib/provisioning/route-helpers';
import { ProvisioningError } from '@/lib/provisioning/errors';
import { getPoolMonitorInstance } from '@/config/poolmonitorsingleton';
import { getRunWithSteps, STUCK_THRESHOLD_MS } from '@/lib/provisioning/orchestrator';
import { HTTPResponses } from '@/config/macros';

// Force Node.js runtime — mysql2 is not compatible with Edge Runtime
export const runtime = 'nodejs';

type StepLike = { stepIndex: number; status: string; startedAt: Date | string | null };

function computeStuckStepIndex(steps: StepLike[]): number | null {
  const now = Date.now();
  for (const step of steps) {
    if (step.status === 'running' && step.startedAt != null) {
      const startedAtMs = step.startedAt instanceof Date ? step.startedAt.getTime() : new Date(step.startedAt).getTime();
      if (now - startedAtMs > STUCK_THRESHOLD_MS) {
        return step.stepIndex;
      }
    }
  }
  return null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const session = await auth();
  const adminError = requireGlobalAdmin(session);
  if (adminError) return adminError;

  const { runId: runIdStr } = await params;
  const runId = parseRunId(runIdStr);
  if (runId == null) {
    return NextResponse.json({ error: 'Invalid runId — must be a positive integer' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  let catalogPool;
  try {
    catalogPool = getPoolMonitorInstance().pool;
  } catch (err) {
    return provisioningErrorResponse(new ProvisioningError('Database unavailable', 'database_unavailable', { cause: err }));
  }

  try {
    // Reconciliation is now a separate POST /reconcile endpoint that the UI
    // calls (throttled) when a step is stuck. GET is read-only.
    const result = await getRunWithSteps(runId, catalogPool);
    if (!result) {
      return provisioningErrorResponse(new ProvisioningError(`Run ${runId} not found`, 'not_found', { runId }));
    }

    const stuckStepIndex = computeStuckStepIndex(result.steps);

    const sanitizedSteps = result.steps.map(step => {
      const { errorStack: _ignored, ...rest } = step;
      return rest;
    });

    return NextResponse.json(
      { run: result.run, steps: sanitizedSteps, stuckStepIndex },
      { status: HTTPResponses.OK, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return provisioningErrorResponse(err);
  }
}
