import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import { getPoolMonitorInstance } from '@/config/poolmonitorsingleton';
import { listRuns } from '@/lib/provisioning/orchestrator';

// Force Node.js runtime — mysql2 is not compatible with Edge Runtime
export const runtime = 'nodejs';

const HTTP_SERVICE_UNAVAILABLE = 503;

export async function GET(_req: Request) {
  const session = await auth();

  const adminError = requireAdmin(session);
  if (adminError) return adminError;

  if (session!.user.userStatus !== 'global') {
    return NextResponse.json({ error: 'Forbidden — global role required' }, { status: 403 });
  }

  let catalogPool;
  try {
    catalogPool = getPoolMonitorInstance().pool;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Database unavailable: ${message}` }, { status: HTTP_SERVICE_UNAVAILABLE });
  }

  const runs = await listRuns(catalogPool);
  return NextResponse.json(runs);
}
