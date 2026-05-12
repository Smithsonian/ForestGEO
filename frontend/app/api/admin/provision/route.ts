import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import { getPoolMonitorInstance } from '@/config/poolmonitorsingleton';
import { ProvisioningInputSchema } from '@/lib/provisioning/input-schema';
import { startRun } from '@/lib/provisioning/orchestrator';

// Force Node.js runtime — mysql2 is not compatible with Edge Runtime
export const runtime = 'nodejs';

const HTTP_ACCEPTED = 202;
const HTTP_CONFLICT = 409;
const HTTP_SERVICE_UNAVAILABLE = 503;

export async function POST(req: Request) {
  const session = await auth();

  // requireAdmin handles unauthenticated (401) and non-admin roles (403).
  // Provisioning is restricted to 'global' only (not 'db admin'), so we
  // check userStatus explicitly after the basic admin gate.
  const adminError = requireAdmin(session);
  if (adminError) return adminError;

  if (session!.user.userStatus !== 'global') {
    return NextResponse.json({ error: 'Forbidden — global role required' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = ProvisioningInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        errors: parsed.error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      },
      { status: 400 }
    );
  }

  let catalogPool;
  try {
    catalogPool = getPoolMonitorInstance().pool;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Database unavailable: ${message}` }, { status: HTTP_SERVICE_UNAVAILABLE });
  }

  try {
    const { runId } = await startRun({
      input: parsed.data,
      startedBy: session!.user.email ?? 'unknown',
      catalogPool
    });
    return NextResponse.json({ runId }, { status: HTTP_ACCEPTED });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: HTTP_CONFLICT });
  }
}
