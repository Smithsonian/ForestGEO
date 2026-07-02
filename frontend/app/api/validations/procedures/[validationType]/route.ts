import { NextRequest, NextResponse } from 'next/server';
import { loadValidationDefinition, runValidation } from '@/components/processors/processorhelperfunctions';
import { streamWithHeartbeats, STREAMING_RESPONSE_HEADERS } from '@/components/processors/streamingvalidation';
import { HTTPResponses } from '@/config/macros';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { assertSchemaAccess } from '@/lib/authz';
import { auth } from '@/auth';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function POST(request: NextRequest, props: { params: Promise<{ validationType: string }> }) {
  const params = await props.params;
  try {
    if (!params.validationType) throw new Error('validationProcedureName not provided');
    const body = await request.json();
    const { schema, validationProcedureID, p_CensusID, p_PlotID } = body;

    if (!schema) return NextResponse.json({ error: 'schema not provided' }, { status: HTTPResponses.INVALID_REQUEST });
    if (!isValidSchema(schema)) {
      return NextResponse.json({ error: 'Invalid schema provided', code: 'INVALID_SCHEMA' }, { status: HTTPResponses.INVALID_REQUEST });
    }
    if (validationProcedureID === undefined || validationProcedureID === null) {
      return NextResponse.json({ error: 'validationProcedureID not provided' }, { status: HTTPResponses.INVALID_REQUEST });
    }
    if (!Number.isInteger(Number(validationProcedureID))) {
      return NextResponse.json({ error: 'validationProcedureID must be an integer', code: 'INVALID_REQUEST' }, { status: HTTPResponses.INVALID_REQUEST });
    }

    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: HTTPResponses.UNAUTHORIZED });
    const denied = assertSchemaAccess(session, schema);
    if (denied) return denied;

    // Load the server-owned validation SQL by ID; never execute a client-supplied query body.
    const definition = await loadValidationDefinition(schema, Number(validationProcedureID));
    if (!definition) {
      return NextResponse.json({ error: `No enabled validation found for ValidationID ${validationProcedureID}` }, { status: HTTPResponses.INVALID_REQUEST });
    }

    const stream = streamWithHeartbeats(() =>
      runValidation(validationProcedureID, params.validationType, schema, definition, {
        p_CensusID,
        p_PlotID
      })
    );

    return new Response(stream, { headers: STREAMING_RESPONSE_HEADERS });
  } catch (error: any) {
    ailogger.error('Error during validation:', error.message);
    return NextResponse.json({ error: error.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
