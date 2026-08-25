import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import { updateValidatedRows } from '@/components/processors/processorhelperfunctions';
import { fromBody, fromQuery, withRouteAuthz } from '@/lib/route-authz';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

async function postHandler(request: NextRequest) {
  try {
    const { schema, plotID, censusID } = await request.json();
    if (!schema) throw new Error('no schema variable provided!');

    await updateValidatedRows(schema, { p_CensusID: censusID ?? null, p_PlotID: plotID ?? null });
    return new NextResponse(JSON.stringify({}), {
      status: HTTPResponses.OK
    });
  } catch (error: any) {
    ailogger.error('Error in update operation:', error.message);
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  }
}

// POST reads the schema from the JSON body; GET (deprecated) reads it from the
// query string. Each method enforces per-site authz via its own resolver.
export const POST = withRouteAuthz('validations/updatepassedvalidations', postHandler, { schema: fromBody('schema') });

/** @deprecated Use POST instead. Kept for backward compatibility with old validation path. */
async function getHandler(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  const plotIDParam = request.nextUrl.searchParams.get('plotID');
  const censusIDParam = request.nextUrl.searchParams.get('censusID');
  const plotID = plotIDParam ? parseInt(plotIDParam) : null;
  const censusID = censusIDParam ? parseInt(censusIDParam) : null;

  try {
    await updateValidatedRows(schema, { p_CensusID: censusID, p_PlotID: plotID });
    return new NextResponse(JSON.stringify({}), {
      status: HTTPResponses.OK
    });
  } catch (error: any) {
    ailogger.error('Error in update operation:', error.message);
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  }
}

export const GET = withRouteAuthz('validations/updatepassedvalidations', getHandler, { schema: fromQuery('schema') });
