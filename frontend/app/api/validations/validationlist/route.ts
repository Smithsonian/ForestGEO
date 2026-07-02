import { HTTPResponses } from '@/config/macros';
import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/lib/db/connectionmanager';
import { isValidSchema, safeFormatQuery } from '@/lib/db/sqlsecurity';
import { assertSchemaAccess } from '@/lib/authz';
import { auth } from '@/auth';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

interface ValidationProcedure {
  ValidationID: number;
  ProcedureName: string;
  Description: string;
  Definition: string;
}

type ValidationMessages = Record<string, { id: number; description: string; definition: string }>;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const conn = ConnectionManager.getInstance();
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) {
    return NextResponse.json({ error: 'No schema variable provided' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  if (!isValidSchema(schema)) {
    return NextResponse.json({ error: 'Invalid schema provided', code: 'INVALID_SCHEMA' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: HTTPResponses.UNAUTHORIZED });
  }
  const denied = assertSchemaAccess(session, schema);
  if (denied) return denied;

  try {
    const siteQuery = safeFormatQuery(
      schema,
      'SELECT ValidationID, ProcedureName, Description, Definition FROM ??.sitespecificvalidations WHERE IsEnabled = 1;'
    );
    const results: ValidationProcedure[] = await conn.executeQuery(siteQuery);

    const validationMessages: ValidationMessages = results.reduce((acc, { ValidationID, ProcedureName, Description, Definition }) => {
      acc[ProcedureName] = { id: ValidationID, description: Description, definition: Definition };
      return acc;
    }, {} as ValidationMessages);

    return NextResponse.json({ coreValidations: validationMessages }, { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Error in validationlist GET request:', error.message);
    return NextResponse.json({ error: error.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
