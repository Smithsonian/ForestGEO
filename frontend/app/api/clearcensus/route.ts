import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/lib/db/connectionmanager';
import ailogger from '@/ailogger';
import { format } from 'mysql2/promise';
import { validateSchemaOrThrow } from '@/lib/db/sqlsecurity';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/auth-helpers';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Valid census clear types - must match actual stored procedure names
const VALID_CENSUS_TYPES = ['msmts', 'full', 'measurements', 'attributes', 'personnel', 'quadrats'] as const;
type CensusType = (typeof VALID_CENSUS_TYPES)[number];

interface ClearCensusRequestBody {
  schema?: unknown;
  censusID?: unknown;
  type?: unknown;
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function readRequestBody(request: NextRequest): Promise<ClearCensusRequestBody | NextResponse> {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return new NextResponse(JSON.stringify({ error: 'Request body must be a JSON object' }), { status: HTTPResponses.INVALID_REQUEST });
    }
    return body as ClearCensusRequestBody;
  } catch {
    return new NextResponse(JSON.stringify({ error: 'Invalid JSON request body' }), { status: HTTPResponses.INVALID_REQUEST });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  const adminError = requireAdmin(session);
  if (adminError) return adminError;

  const body = await readRequestBody(request);
  if (body instanceof NextResponse) return body;

  const schema = typeof body.schema === 'string' ? body.schema : undefined;
  const censusID = parsePositiveInteger(body.censusID);
  const type = typeof body.type === 'string' ? body.type : undefined;

  if (!schema || !censusID || !type) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters: schema, censusID, type' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  // Validate schema to prevent SQL injection
  try {
    validateSchemaOrThrow(schema);
  } catch (error: any) {
    ailogger.error(`Invalid schema in clearcensus: ${schema}`);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INVALID_REQUEST });
  }

  // Validate type to prevent SQL injection
  if (!VALID_CENSUS_TYPES.includes(type as CensusType)) {
    ailogger.error(`Invalid census type in clearcensus: ${type}`);
    return new NextResponse(
      JSON.stringify({
        error: 'Invalid census type',
        validTypes: VALID_CENSUS_TYPES
      }),
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  const connectionManager = ConnectionManager.getInstance();
  let transactionID = '';
  try {
    const latestCensusSQL = format(
      `SELECT c.PlotID, c.PlotCensusNumber, latest.MaxPlotCensusNumber
       FROM ??.census c
       JOIN (
         SELECT PlotID, MAX(PlotCensusNumber) AS MaxPlotCensusNumber
         FROM ??.census
         WHERE IsActive IS TRUE
         GROUP BY PlotID
       ) latest ON latest.PlotID = c.PlotID
       WHERE c.CensusID = ? AND c.IsActive IS TRUE`,
      [schema, schema, censusID]
    );
    const censusRows = await connectionManager.executeQuery(latestCensusSQL);
    const censusRow = censusRows[0];
    if (!censusRow) {
      return new NextResponse(JSON.stringify({ error: 'Census not found' }), { status: HTTPResponses.NOT_FOUND });
    }
    if (Number(censusRow.PlotCensusNumber) !== Number(censusRow.MaxPlotCensusNumber)) {
      return new NextResponse(JSON.stringify({ error: 'Only the latest census can be cleared. Delete newer censuses first.' }), {
        status: HTTPResponses.CONFLICT
      });
    }

    // Construct safe procedure name and call
    const procedureName = `clearcensus${type}`;
    const callSQL = format('CALL ??.??(?)', [schema, procedureName, censusID]);

    transactionID = await connectionManager.beginTransaction();
    await connectionManager.executeQuery(callSQL, [], transactionID);
    await connectionManager.commitTransaction(transactionID);
    ailogger.info(`Census cleared successfully: ${schema}.${procedureName}(${censusID})`);
    return NextResponse.json({ message: 'Census cleared successfully' }, { status: HTTPResponses.OK });
  } catch (e: any) {
    ailogger.error('Census clear failed:', e);
    if (transactionID) {
      await connectionManager.rollbackTransaction(transactionID);
    }
    return new NextResponse(JSON.stringify({ error: e.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    try {
      await connectionManager.closeConnection();
    } catch (closeError) {
      ailogger.warn('Failed to close clearcensus connection:', closeError instanceof Error ? closeError : undefined);
    }
  }
}
