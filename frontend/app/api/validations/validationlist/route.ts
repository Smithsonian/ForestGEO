import { HTTPResponses } from '@/config/macros';
import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
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

export async function GET(request: NextRequest): Promise<NextResponse<ValidationMessages>> {
  const conn = ConnectionManager.getInstance();
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('No schema variable provided!');
  try {
    const siteQuery = `SELECT ValidationID, ProcedureName, Description, Definition FROM ${schema}.sitespecificvalidations WHERE IsEnabled = 1;`;

    const results: ValidationProcedure[] = await conn.executeQuery(siteQuery);

    const validationMessages: ValidationMessages = results.reduce((acc, { ValidationID, ProcedureName, Description, Definition }) => {
      acc[ProcedureName] = { id: ValidationID, description: Description, definition: Definition };
      return acc;
    }, {} as ValidationMessages);

    return new NextResponse(JSON.stringify({ coreValidations: validationMessages }), {
      status: HTTPResponses.OK,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    ailogger.error('Error in GET request:', error.message);
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: 500
    });
  }
}
