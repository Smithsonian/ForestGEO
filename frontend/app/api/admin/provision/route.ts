import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireGlobalAdmin, provisioningErrorResponse } from '@/lib/provisioning/route-helpers';
import { ProvisioningError } from '@/lib/provisioning/errors';
import { getPoolMonitorInstance } from '@/config/poolmonitorsingleton';
import { ProvisioningInputSchema } from '@/lib/provisioning/input-schema';
import { startRun } from '@/lib/provisioning/orchestrator';
import { HTTPResponses } from '@/config/macros';

// Force Node.js runtime — mysql2 is not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await auth();
  const adminError = requireGlobalAdmin(session);
  if (adminError) return adminError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const parsed = ProvisioningInputSchema.safeParse(body);
  if (!parsed.success) {
    const errors = parsed.error.issues.map(issue => ({
      field: issue.path.join('.'),
      message: issue.message
    }));
    return NextResponse.json({ error: 'Validation failed', errors }, { status: HTTPResponses.INVALID_REQUEST });
  }

  let catalogPool;
  try {
    catalogPool = getPoolMonitorInstance().pool;
  } catch (err) {
    return provisioningErrorResponse(new ProvisioningError('Database unavailable', 'database_unavailable', { cause: err }));
  }

  try {
    const { runId } = await startRun({
      input: parsed.data,
      startedBy: session!.user?.email ?? 'unknown',
      catalogPool
    });
    return NextResponse.json({ runId }, { status: HTTPResponses.ACCEPTED });
  } catch (err) {
    return provisioningErrorResponse(err);
  }
}
