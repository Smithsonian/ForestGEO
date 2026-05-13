import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import { getPoolMonitorInstance } from '@/config/poolmonitorsingleton';
import { teardownProvisionedSite } from '@/lib/provisioning/orchestrator';

// Force Node.js runtime — mysql2 is not compatible with Edge Runtime
export const runtime = 'nodejs';

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_SERVICE_UNAVAILABLE = 503;

function parseRunId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isRunNotFound(message: string, runId: number): boolean {
  return message === `Run ${runId} not found`;
}

export async function DELETE(req: Request, { params }: { params: Promise<{ runId: string }> }) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: HTTP_BAD_REQUEST });
  }

  const confirmSchemaName =
    typeof body === 'object' && body !== null && 'confirmSchemaName' in body ? (body as { confirmSchemaName?: unknown }).confirmSchemaName : undefined;
  if (typeof confirmSchemaName !== 'string' || confirmSchemaName.length === 0) {
    return NextResponse.json({ error: 'confirmSchemaName is required' }, { status: HTTP_BAD_REQUEST });
  }

  let catalogPool;
  try {
    catalogPool = getPoolMonitorInstance().pool;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Database unavailable: ${message}` }, { status: HTTP_SERVICE_UNAVAILABLE });
  }

  try {
    await teardownProvisionedSite(runId, confirmSchemaName, catalogPool);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: isRunNotFound(message, runId) ? HTTP_NOT_FOUND : HTTP_CONFLICT });
  }
}
