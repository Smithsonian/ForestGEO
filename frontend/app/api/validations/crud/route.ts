import { NextRequest, NextResponse } from 'next/server';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';
import { format } from 'mysql2/promise';
import { HTTPResponses } from '@/config/macros';
import MapperFactory from '@/config/datamapper';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';
import { auth } from '@/auth';
import { requireAdmin } from '@/lib/auth-helpers';
import { validateSchemaOrThrow } from '@/config/utils/sqlsecurity';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

function getValidatedSchema(request: NextRequest): string | NextResponse {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) {
    return NextResponse.json({ error: 'No schema variable provided' }, { status: HTTPResponses.INVALID_REQUEST });
  }
  try {
    validateSchemaOrThrow(schema);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid schema';
    return NextResponse.json({ error: message }, { status: HTTPResponses.INVALID_REQUEST });
  }
  return schema;
}

export async function GET(request: NextRequest) {
  const authError = requireAdmin(await auth());
  if (authError) return authError;

  const connectionManager = ConnectionManager.getInstance();
  const schema = getValidatedSchema(request);
  if (typeof schema !== 'string') return schema;
  try {
    const query = format('SELECT * FROM ??.sitespecificvalidations;', [schema]);
    const results = await connectionManager.executeQuery(query);
    return new NextResponse(JSON.stringify(MapperFactory.getMapper<any, any>('sitespecificvalidations').mapData(results)), { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Error:', error);
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    await connectionManager.closeConnection();
  }
}

export async function POST(request: NextRequest) {
  const authError = requireAdmin(await auth());
  if (authError) return authError;

  const validationProcedure: ValidationProceduresRDS = await request.json();
  const schema = getValidatedSchema(request);
  if (typeof schema !== 'string') return schema;
  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;
  transactionID = await connectionManager.beginTransaction();
  try {
    // Map the validation object to database format
    const mapper = MapperFactory.getMapper<ValidationProceduresRDS, any>('sitespecificvalidations');
    const [mappedData] = mapper.demapData([validationProcedure]);

    // Remove ValidationID - let the database auto-increment handle it
    delete mappedData['ValidationID'];

    const insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.sitespecificvalidations`, mappedData]);
    const results = await connectionManager.executeQuery(insertQuery);
    const insertID = results.insertId;
    await connectionManager.commitTransaction(transactionID ?? '');
    return NextResponse.json({ insertID, validationID: insertID }, { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Error:', error);
    await connectionManager.rollbackTransaction(transactionID ?? '');
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    await connectionManager.closeConnection();
  }
}

export async function PATCH(request: NextRequest) {
  const authError = requireAdmin(await auth());
  if (authError) return authError;

  const validationProcedure: ValidationProceduresRDS = await request.json();
  const schema = getValidatedSchema(request);
  if (typeof schema !== 'string') return schema;
  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;
  transactionID = await connectionManager.beginTransaction();
  try {
    // Map the validation object to database format and exclude id/validationID from update
    const mapper = MapperFactory.getMapper<ValidationProceduresRDS, any>('sitespecificvalidations');
    const [mappedData] = mapper.demapData([validationProcedure]);

    // Remove ValidationID from the update data (it's the WHERE clause, not SET)
    delete mappedData['ValidationID'];

    const updateQuery = format('UPDATE ?? SET ? WHERE ValidationID = ?', [`${schema}.sitespecificvalidations`, mappedData, validationProcedure.validationID]);
    await connectionManager.executeQuery(updateQuery);
    await connectionManager.commitTransaction(transactionID ?? '');
    return NextResponse.json({}, { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Error:', error);
    await connectionManager.rollbackTransaction(transactionID ?? '');
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    await connectionManager.closeConnection();
  }
}

export async function DELETE(request: NextRequest) {
  const authError = requireAdmin(await auth());
  if (authError) return authError;

  const validationProcedure: ValidationProceduresRDS = await request.json();
  const schema = getValidatedSchema(request);
  if (typeof schema !== 'string') return schema;
  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;
  transactionID = await connectionManager.beginTransaction();
  try {
    const deleteQuery = format('DELETE FROM ?? WHERE ValidationID = ?', [`${schema}.sitespecificvalidations`, validationProcedure.validationID]);
    await connectionManager.executeQuery(deleteQuery);
    await connectionManager.commitTransaction(transactionID ?? '');
    return NextResponse.json({}, { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Error:', error);
    await connectionManager.rollbackTransaction(transactionID ?? '');
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    await connectionManager.closeConnection();
  }
}
