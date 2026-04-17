import { NextRequest } from 'next/server';
import { runCombinedCrossCensusLocationValidations } from '@/components/processors/processorhelperfunctions';
import { streamWithHeartbeats, STREAMING_RESPONSE_HEADERS } from '@/components/processors/streamingvalidation';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

// Cross-census validations JOIN across large tables and can legitimately
// take well over 10 minutes on 200K+ row datasets. Keep the route budget
// slightly above the MySQL statement limit so the database can fail first
// and return an error instead of the client seeing an abrupt disconnect.
export const maxDuration = 1500;

export async function POST(request: NextRequest) {
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
