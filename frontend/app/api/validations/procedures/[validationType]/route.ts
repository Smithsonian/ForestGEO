import { NextRequest, NextResponse } from 'next/server';
import { loadValidationDefinition, runValidation } from '@/components/processors/processorhelperfunctions';
import { streamWithHeartbeats, STREAMING_RESPONSE_HEADERS } from '@/components/processors/streamingvalidation';
import { HTTPResponses } from '@/config/macros';
import { fromBody, type RouteContext, withRouteAuthz } from '@/lib/route-authz';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

async function handler(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  try {
    const validationType = Array.isArray(params.validationType) ? params.validationType[0] : params.validationType;
    if (!validationType) throw new Error('validationProcedureName not provided');
    const body = await request.json();
    const { schema, validationProcedureID, p_CensusID, p_PlotID } = body;

    if (!schema) return NextResponse.json({ error: 'schema not provided' }, { status: HTTPResponses.INVALID_REQUEST });
    if (validationProcedureID === undefined || validationProcedureID === null) {
      return NextResponse.json({ error: 'validationProcedureID not provided' }, { status: HTTPResponses.INVALID_REQUEST });
    }
    if (!Number.isInteger(Number(validationProcedureID))) {
      return NextResponse.json({ error: 'validationProcedureID must be an integer', code: 'INVALID_REQUEST' }, { status: HTTPResponses.INVALID_REQUEST });
    }

    // Load the server-owned validation SQL by ID; never execute a client-supplied query body.
    const validationProcedure = await loadValidationDefinition(schema, Number(validationProcedureID));
    if (!validationProcedure) {
      return NextResponse.json({ error: `No enabled validation found for ValidationID ${validationProcedureID}` }, { status: HTTPResponses.INVALID_REQUEST });
    }
    if (validationProcedure.procedureName !== validationType) {
      return NextResponse.json(
        {
          error: `ValidationID ${validationProcedureID} does not match procedure '${validationType}'`,
          code: 'VALIDATION_PROCEDURE_MISMATCH'
        },
        { status: HTTPResponses.INVALID_REQUEST }
      );
    }

    const stream = streamWithHeartbeats(() =>
      runValidation(Number(validationProcedureID), validationProcedure.procedureName, schema, validationProcedure.definition, {
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

export const POST = withRouteAuthz('validations/procedures/[validationType]', handler, { schema: fromBody('schema') });
