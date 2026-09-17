import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import { fromBody, withRouteAuthz } from '@/lib/route-authz';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/lib/db/connectionmanager';
import { ScopeAccessError, ScopeBusyError } from '@/config/editplan/scopeguard';
import { overrideValidationScope } from '@/lib/validations/override';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

async function postHandler(request: NextRequest) {
  // Preserve the former /api/query write restriction in addition to site/quarantine checks.
  const denied = requireAdmin(await auth());
  if (denied) return denied;
  let body: { schema: string; plotID: number; censusID: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: HTTPResponses.BAD_REQUEST });
  }
  const { schema, plotID, censusID } = body;
  if (!Number.isSafeInteger(plotID) || plotID <= 0 || !Number.isSafeInteger(censusID) || censusID <= 0) {
    return NextResponse.json({ error: 'A positive plot and census ID are required' }, { status: HTTPResponses.BAD_REQUEST });
  }
  try {
    const affectedRows = await overrideValidationScope(ConnectionManager.getInstance(), { schema, plotID, censusID });
    return NextResponse.json({ affectedRows }, { status: HTTPResponses.OK });
  } catch (error) {
    if (error instanceof ScopeAccessError) return NextResponse.json({ error: error.message }, { status: HTTPResponses.BAD_REQUEST });
    if (error instanceof ScopeBusyError) return NextResponse.json({ error: error.message }, { status: HTTPResponses.CONFLICT });
    ailogger.error('Validation override failed', error instanceof Error ? error : undefined);
    return NextResponse.json({ error: 'Validation override failed; refresh the census before retrying' }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}

export const POST = withRouteAuthz('validations/override', postHandler, { schema: fromBody('schema') });
