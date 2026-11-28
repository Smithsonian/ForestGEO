// POST /api/validations/override — overrides validation for every eligible measurement of one census (issue #465).
import { NextRequest } from 'next/server';
import { fromBody, withRouteAuthz, type RouteContext } from '@/lib/route-authz';
import { overrideCensusValidations } from '@/lib/validations/override';
import { handleValidationScopeAction } from '@/app/api/validations/_scopeaction';

export const runtime = 'nodejs';

const ACTION_LABEL = 'Validation override';

async function handler(request: NextRequest, _context: RouteContext) {
  return handleValidationScopeAction(request, ACTION_LABEL, overrideCensusValidations);
}

export const POST = withRouteAuthz('validations/override', handler, { schema: fromBody('schema') });
