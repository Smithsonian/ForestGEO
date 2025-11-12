import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import { format } from 'mysql2/promise';
import { validateSchemaOrThrow } from '@/config/utils/sqlsecurity';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Valid census clear types - must match actual stored procedure names
const VALID_CENSUS_TYPES = ['msmts', 'full', 'measurements', 'attributes', 'personnel', 'quadrats'] as const;
type CensusType = (typeof VALID_CENSUS_TYPES)[number];

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  const censusIDParam = request.nextUrl.searchParams.get('censusID');
  const type = request.nextUrl.searchParams.get('type');

  if (!schema || !censusIDParam || !type) {
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

  // Construct safe procedure name and call
  const procedureName = `clearcensus${type}`;
  const callSQL = format('CALL ??.??(?)', [schema, procedureName, censusIDParam]);

  const connectionManager = ConnectionManager.getInstance();
  let transactionID = '';
  try {
    transactionID = await connectionManager.beginTransaction();
    await connectionManager.executeQuery(callSQL, [], transactionID);
    await connectionManager.commitTransaction(transactionID);
    ailogger.info(`Census cleared successfully: ${schema}.${procedureName}(${censusIDParam})`);
    return NextResponse.json({ message: 'Census cleared successfully' }, { status: HTTPResponses.OK });
  } catch (e: any) {
    ailogger.error('Census clear failed:', e);
    if (transactionID) {
      await connectionManager.rollbackTransaction(transactionID);
    }
    return new NextResponse(JSON.stringify({ error: e.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  }
}
