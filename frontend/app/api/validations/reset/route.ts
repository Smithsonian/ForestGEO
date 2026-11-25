// POST /api/validations/reset — sends every measurement of one census back to pending validation (issue #465).
import { NextRequest } from 'next/server';
import { fromBody, withRouteAuthz, type RouteContext } from '@/lib/route-authz';
import { resetCensusValidations } from '@/lib/validations/reset';
import { handleValidationScopeAction } from '@/app/api/validations/_scopeaction';

export const runtime = 'nodejs';

const ACTION_LABEL = 'Validation reset';

async function handler(request: NextRequest, _context: RouteContext) {
  return handleValidationScopeAction(request, ACTION_LABEL, resetCensusValidations);
}

export const POST = withRouteAuthz('validations/reset', handler, { schema: fromBody('schema') });
