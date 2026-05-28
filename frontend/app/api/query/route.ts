import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { format } from 'mysql2/promise';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { auth } from '@/auth';
import { requireSession } from '@/lib/auth-helpers';
import { hasSchemaAccess, isAdminSession } from '@/lib/authz';
import type { Session } from 'next-auth';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

interface QueryRequest {
  query: string;
  params?: any[];
  format?: boolean; // Whether to format the query with parameters
}

const SYSTEM_SCHEMAS = new Set(['catalog', 'information_schema', 'mysql', 'performance_schema', 'sys']);

function stripSqlComments(query: string): string {
  return query
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/#[^\r\n]*/g, ' ');
}

function hasMultipleStatements(query: string): boolean {
  return stripSqlComments(query).trim().replace(/;+$/g, '').includes(';');
}

function isReadOnlySelect(query: string): boolean {
  return stripSqlComments(query).trimStart().toLowerCase().startsWith('select ');
}

function extractTableSchemas(query: string): string[] {
  const schemas = new Set<string>();
  const tableReferencePattern = /\b(?:from|join)\s+(?:`([a-zA-Z0-9_]+)`|([a-zA-Z0-9_]+))\s*\./gi;
  let match: RegExpExecArray | null;

  while ((match = tableReferencePattern.exec(query)) !== null) {
    schemas.add((match[1] ?? match[2]).toLowerCase());
  }

  return [...schemas];
}

function authorizeQuery(session: Session, query: string): NextResponse | null {
  if (hasMultipleStatements(query)) {
    return NextResponse.json({ error: 'Multiple SQL statements are not allowed' }, { status: HTTPResponses.FORBIDDEN });
  }

  if (isAdminSession(session)) {
    return null;
  }

  if (!isReadOnlySelect(query)) {
    return NextResponse.json({ error: 'Only administrators may execute write SQL' }, { status: HTTPResponses.FORBIDDEN });
  }

  const referencedSchemas = extractTableSchemas(query);
  if (referencedSchemas.length === 0) {
    return NextResponse.json({ error: 'Non-admin SQL must reference an authorized site schema' }, { status: HTTPResponses.FORBIDDEN });
  }

  if (referencedSchemas.some(schema => SYSTEM_SCHEMAS.has(schema) || !hasSchemaAccess(session, schema))) {
    return NextResponse.json({ error: 'SQL references a schema outside the authenticated user scope' }, { status: HTTPResponses.FORBIDDEN });
  }

  return null;
}

/**
 * Unified query execution endpoint
 * Handles both direct query execution and parameterized query formatting
 *
 * Request body can be:
 * 1. String - Direct query execution (legacy compatibility)
 * 2. Object with { query, params?, format? } - Parameterized or direct execution
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  const authError = requireSession(session);
  if (authError) return authError;

  let body: string | QueryRequest;

  try {
    body = await request.json();
  } catch (error: any) {
    ailogger.error('Error parsing request body:', error);
    return new NextResponse(
      JSON.stringify({
        error: 'Invalid JSON in request body',
        details: error.message
      }),
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  let queryToExecute: string;
  let shouldFormat = false;
  let params: any[] = [];

  try {
    // Handle legacy string format (direct query)
    if (typeof body === 'string') {
      queryToExecute = body;
    }
    // Handle new object format
    else if (typeof body === 'object' && body !== null) {
      const { query, params: queryParams, format: shouldFormatQuery } = body as QueryRequest;

      if (!query || typeof query !== 'string') {
        return new NextResponse(JSON.stringify({ error: 'Query is required and must be a string' }), { status: HTTPResponses.INVALID_REQUEST });
      }

      queryToExecute = query;
      params = queryParams || [];
      shouldFormat = shouldFormatQuery === true || (queryParams !== undefined && queryParams.length > 0);
    } else {
      return new NextResponse(JSON.stringify({ error: 'Request body must be a string (query) or object with query property' }), {
        status: HTTPResponses.INVALID_REQUEST
      });
    }

    // Format query with parameters if needed
    if (shouldFormat && params.length > 0) {
      try {
        queryToExecute = format(queryToExecute, params);
      } catch (formatError: any) {
        ailogger.error('Error formatting query with parameters:', formatError);
        return new NextResponse(
          JSON.stringify({
            error: 'Failed to format query with provided parameters',
            details: formatError.message
          }),
          { status: HTTPResponses.INVALID_REQUEST }
        );
      }
    }

    const queryAuthError = authorizeQuery(session!, queryToExecute);
    if (queryAuthError) return queryAuthError;

    // Execute the query
    const connectionManager = ConnectionManager.getInstance();
    const results = await connectionManager.executeQuery(queryToExecute);

    return new NextResponse(JSON.stringify(results), {
      status: HTTPResponses.OK,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    ailogger.error('Error executing query:', error);
    return new NextResponse(
      JSON.stringify({
        error: 'Failed to execute query',
        details: error.message
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  }
}
