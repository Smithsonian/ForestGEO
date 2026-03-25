import { NextRequest } from 'next/server';
import { runValidation } from '@/components/processors/processorhelperfunctions';
import { streamWithHeartbeats, STREAMING_RESPONSE_HEADERS } from '@/components/processors/streamingvalidation';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function POST(request: NextRequest, props: { params: Promise<{ validationType: string }> }) {
  const params = await props.params;
  try {
    if (!params.validationType) throw new Error('validationProcedureName not provided');
    const body = await request.json();
    const { schema, validationProcedureID, cursorQuery, p_CensusID, p_PlotID } = body;

    const stream = streamWithHeartbeats(() =>
      runValidation(validationProcedureID, params.validationType, schema, cursorQuery, {
        p_CensusID,
        p_PlotID
      })
    );

    return new Response(stream, { headers: STREAMING_RESPONSE_HEADERS });
  } catch (error: any) {
    ailogger.error('Error during validation:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
