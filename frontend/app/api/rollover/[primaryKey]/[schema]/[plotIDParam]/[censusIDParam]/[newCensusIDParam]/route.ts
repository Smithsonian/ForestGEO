import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { fromPath, withRouteAuthz, type RouteContext } from '@/lib/route-authz';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

async function handler(_request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const { primaryKey, schema, plotIDParam, censusIDParam, newCensusIDParam } = params;
  if (!schema || !plotIDParam || !censusIDParam || !newCensusIDParam || !primaryKey) throw new Error('Missing core slugs from rollover op');
  return NextResponse.json({ message: 'rollover is not needed for this table!' }, { status: HTTPResponses.OK });
}

export const GET = withRouteAuthz('rollover/[primaryKey]/[schema]/[plotIDParam]/[censusIDParam]/[newCensusIDParam]', handler, { schema: fromPath('schema') });
