import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireGlobalAdmin, provisioningErrorResponse } from '@/lib/provisioning/route-helpers';
import { ProvisioningError } from '@/lib/provisioning/errors';
import { getPoolMonitorInstance } from '@/config/poolmonitorsingleton';
import { listRuns } from '@/lib/provisioning/orchestrator';
import { HTTPResponses } from '@/config/macros';

// Force Node.js runtime — mysql2 is not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function GET(_req: Request) {
  const session = await auth();
  const adminError = requireGlobalAdmin(session);
  if (adminError) return adminError;

  let catalogPool;
  try {
    catalogPool = getPoolMonitorInstance().pool;
  } catch (err) {
    return provisioningErrorResponse(new ProvisioningError('Database unavailable', 'database_unavailable', { cause: err }));
  }

  try {
    const runs = await listRuns(catalogPool);
    return NextResponse.json(runs, { status: HTTPResponses.OK, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return provisioningErrorResponse(err);
  }
}
