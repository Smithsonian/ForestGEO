import { NextRequest } from 'next/server';
import { runCombinedDBHValidations } from '@/components/processors/processorhelperfunctions';
import { streamWithHeartbeats, STREAMING_RESPONSE_HEADERS } from '@/components/processors/streamingvalidation';
import { fromBody, withRouteAuthz } from '@/lib/route-authz';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

// DBH growth/shrinkage validations JOIN across large tables and can take
// several minutes on 200K+ row datasets. streamWithHeartbeats below is what
// keeps Azure from killing the request early — not this value. maxDuration is
// advisory (Next.js records it in the build manifest; only Vercel enforces it)
// and documents the intended 10-minute budget alongside the cross-census
// location route.
export const maxDuration = 600;

async function handler(request: NextRequest) {
  try {
    const body = await request.json();
    const { schema, p_CensusID, p_PlotID } = body;

    if (!schema) {
      throw new Error('schema not provided');
    }

    const stream = streamWithHeartbeats(() => runCombinedDBHValidations(schema, { p_CensusID, p_PlotID }));

    return new Response(stream, { headers: STREAMING_RESPONSE_HEADERS });
  } catch (error: any) {
    ailogger.error('Error during combined DBH validation:', error.message);
    return Response.json({ error: error.message, success: false }, { status: 500 });
  }
}

export const POST = withRouteAuthz('validations/procedures/shared-dbh', handler, { schema: fromBody('schema') });
