import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import { fromBody, withRouteAuthz } from '@/lib/route-authz';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/lib/db/connectionmanager';
import { ScopeAccessError, ScopeBusyError } from '@/config/editplan/scopeguard';
import { resetValidationScope } from '@/lib/validations/reset';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

interface ResetValidationRequestBody {
  schema: string;
  plotID: number;
  censusID: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function parseResetRequestBody(body: Record<string, unknown>): ResetValidationRequestBody | null {
  const { schema, plotID, censusID } = body;
  if (!isNonEmptyString(schema) || !isPositiveSafeInteger(plotID) || !isPositiveSafeInteger(censusID)) return null;
  return { schema, plotID, censusID };
}

async function postHandler(request: NextRequest) {
  // Preserve the former /api/query write restriction in addition to site/quarantine checks.
  const denied = requireAdmin(await auth());
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: HTTPResponses.BAD_REQUEST });
  }
  if (!isPlainObject(body)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: HTTPResponses.BAD_REQUEST });
  }
  const parsed = parseResetRequestBody(body);
  if (!parsed) {
    return NextResponse.json({ error: 'A positive plot and census ID are required' }, { status: HTTPResponses.BAD_REQUEST });
  }

  try {
    const affectedRows = await resetValidationScope(ConnectionManager.getInstance(), parsed);
    return NextResponse.json({ affectedRows }, { status: HTTPResponses.OK });
  } catch (error) {
    if (error instanceof ScopeAccessError) return NextResponse.json({ error: error.message }, { status: HTTPResponses.BAD_REQUEST });
    if (error instanceof ScopeBusyError) return NextResponse.json({ error: error.message }, { status: HTTPResponses.CONFLICT });
    ailogger.error('Validation reset failed', error instanceof Error ? error : undefined);
    return NextResponse.json({ error: 'Validation reset failed; refresh the census before retrying' }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}

export const POST = withRouteAuthz('validations/reset', postHandler, { schema: fromBody('schema') });
