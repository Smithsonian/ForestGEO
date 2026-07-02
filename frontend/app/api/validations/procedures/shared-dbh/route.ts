import { NextRequest, NextResponse } from 'next/server';
import { runCombinedDBHValidations } from '@/components/processors/processorhelperfunctions';
import { streamWithHeartbeats, STREAMING_RESPONSE_HEADERS } from '@/components/processors/streamingvalidation';
import { assertSchemaAccess } from '@/lib/authz';
import { auth } from '@/auth';
import { HTTPResponses } from '@/config/macros';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import ailogger from '@/ailogger';

export const runtime = 'nodejs';

// DBH growth/shrinkage validations JOIN across large tables and can take
// several minutes on 200K+ row datasets.  Match the cross-census location
// route's 10-minute ceiling so Azure doesn't kill the request early.
export const maxDuration = 600;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { schema, p_CensusID, p_PlotID } = body;

    if (!schema) {
      throw new Error('schema not provided');
    }
    if (!isValidSchema(schema)) {
      return NextResponse.json({ error: 'Invalid schema provided', code: 'INVALID_SCHEMA' }, { status: HTTPResponses.INVALID_REQUEST });
    }

    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: HTTPResponses.UNAUTHORIZED });
    const denied = assertSchemaAccess(session, schema);
    if (denied) return denied;

    const stream = streamWithHeartbeats(() => runCombinedDBHValidations(schema, { p_CensusID, p_PlotID }));

    return new Response(stream, { headers: STREAMING_RESPONSE_HEADERS });
  } catch (error: any) {
    ailogger.error('Error during combined DBH validation:', error.message);
    return Response.json({ error: error.message, success: false }, { status: 500 });
  }
}
