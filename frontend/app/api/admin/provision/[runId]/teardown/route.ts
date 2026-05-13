import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { parseRunId, requireGlobalAdmin, provisioningErrorResponse } from '@/lib/provisioning/route-helpers';
import { ProvisioningError } from '@/lib/provisioning/errors';
import { getPoolMonitorInstance } from '@/config/poolmonitorsingleton';
import { teardownProvisionedSite } from '@/lib/provisioning/orchestrator';
import { HTTPResponses } from '@/config/macros';

// Force Node.js runtime — mysql2 is not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function DELETE(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const session = await auth();
  const adminError = requireGlobalAdmin(session);
  if (adminError) return adminError;

  const { runId: runIdStr } = await params;
  const runId = parseRunId(runIdStr);
  if (runId == null) {
    return NextResponse.json({ error: 'Invalid runId — must be a positive integer' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const confirmSchemaName =
    typeof body === 'object' && body !== null && 'confirmSchemaName' in body ? (body as { confirmSchemaName?: unknown }).confirmSchemaName : undefined;
  if (typeof confirmSchemaName !== 'string' || confirmSchemaName.length === 0) {
    return NextResponse.json({ error: 'confirmSchemaName is required' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  let catalogPool;
  try {
    catalogPool = getPoolMonitorInstance().pool;
  } catch (err) {
    return provisioningErrorResponse(new ProvisioningError('Database unavailable', 'database_unavailable', { cause: err }));
  }

  try {
    await teardownProvisionedSite(runId, confirmSchemaName, catalogPool, session!.user?.email ?? 'unknown');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return provisioningErrorResponse(err);
  }
}
