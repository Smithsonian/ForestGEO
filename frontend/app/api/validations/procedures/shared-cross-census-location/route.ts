import { NextRequest } from 'next/server';
import { runCombinedCrossCensusLocationValidations } from '@/components/processors/processorhelperfunctions';
import { streamWithHeartbeats, STREAMING_RESPONSE_HEADERS } from '@/components/processors/streamingvalidation';
import { fromBody, withRouteAuthz } from '@/lib/route-authz';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

// Cross-census validations JOIN across large tables and can legitimately
// take well over 10 minutes on 200K+ row datasets. What actually survives
// Azure App Service's ~240s load-balancer idle timeout is streamWithHeartbeats
// below — the periodic bytes keep the connection non-idle. maxDuration is
// advisory: Next.js only records it in the build manifest and Vercel is what
// enforces it, so it is inert here. It is kept as documentation of the intended
// budget, set slightly above the MySQL statement limit so the database fails
// first and the client gets an error rather than an abrupt disconnect.
export const maxDuration = 1500;

async function handler(request: NextRequest) {
  try {
    const body = await request.json();
    const { schema, p_CensusID, p_PlotID } = body;

    if (!schema) {
      throw new Error('schema not provided');
    }

    const stream = streamWithHeartbeats(() => runCombinedCrossCensusLocationValidations(schema, { p_CensusID, p_PlotID }));

    return new Response(stream, { headers: STREAMING_RESPONSE_HEADERS });
  } catch (error: any) {
    ailogger.error('Error during combined cross-census location validation:', error.message);
    return Response.json({ error: error.message, success: false }, { status: 500 });
  }
}

export const POST = withRouteAuthz('validations/procedures/shared-cross-census-location', handler, { schema: fromBody('schema') });
