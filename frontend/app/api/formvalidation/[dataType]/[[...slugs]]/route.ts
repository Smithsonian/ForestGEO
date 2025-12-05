import { HTTPResponses } from '@/config/macros';
import { format } from 'mysql2/promise';
import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import { isValidSchema } from '@/config/utils/sqlsecurity';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Valid data types (table names) that can be queried
const VALID_DATA_TYPES = ['attributes', 'census', 'coremeasurements', 'personnel', 'plots', 'quadrats', 'species', 'stems', 'trees'] as const;

function isValidDataType(dataType: string): boolean {
  return VALID_DATA_TYPES.includes(dataType as (typeof VALID_DATA_TYPES)[number]);
}

// dataType
// slugs: schema, columnName, value ONLY
// needs to match dynamic format established by other slug routes!
// refit to match entire rows, using dataType convention to determine what columns need testing?
export async function GET(_request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const params = await props.params;

  // Validate slugs parameter
  if (!params.slugs || params.slugs.length !== 3) {
    return new NextResponse(JSON.stringify({ error: 'Invalid parameters: expected schema, columnName, and value' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  // Validate dataType parameter
  if (!params.dataType || params.dataType === 'undefined') {
    return new NextResponse(JSON.stringify({ error: 'Data type parameter is required' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  const [schema, columnName, value] = params.slugs;

  if (!schema || !columnName || !value) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  // SQL Injection Prevention: Validate schema against whitelist
  if (!isValidSchema(schema)) {
    ailogger.warn(`Invalid schema attempted in formvalidation: ${schema}`);
    return new NextResponse(JSON.stringify({ error: 'Invalid schema' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // Validate dataType against whitelist to prevent arbitrary table access
  if (!isValidDataType(params.dataType)) {
    ailogger.warn(`Invalid data type attempted in formvalidation: ${params.dataType}`);
    return new NextResponse(JSON.stringify({ error: 'Invalid data type' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();
  try {
    const query = `SELECT 1 FROM ?? WHERE ?? = ? LIMIT 1`;
    const formatted = format(query, [`${schema}.${params.dataType}`, columnName, value]);
    const results = await connectionManager.executeQuery(formatted);
    if (results.length === 0) return new NextResponse(null, { status: 404 });
    return new NextResponse(null, { status: HTTPResponses.OK });
  } catch (error: unknown) {
    const errObj = error instanceof Error ? error : new Error(String(error));
    ailogger.error('Form validation error:', errObj);
    return new NextResponse(JSON.stringify({ error: 'Validation query failed' }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  } finally {
    await connectionManager.closeConnection();
  }
}
