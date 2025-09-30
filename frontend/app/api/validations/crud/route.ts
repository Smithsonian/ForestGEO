import { NextRequest, NextResponse } from 'next/server';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';
import { format } from 'mysql2/promise';
import { HTTPResponses } from '@/config/macros';
import MapperFactory from '@/config/datamapper';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const connectionManager = ConnectionManager.getInstance();
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('No schema variable provided!');
  try {
    const query = `SELECT * FROM ${schema}.sitespecificvalidations;`;
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
  const validationProcedure: ValidationProceduresRDS = await request.json();
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('No schema variable provided!');
  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;
  transactionID = await connectionManager.beginTransaction();
  try {
    // Get the next available ValidationID
    const maxIdQuery = format('SELECT COALESCE(MAX(ValidationID), 0) + 1 as nextValidationID FROM ??', [`${schema}.sitespecificvalidations`]);
    const maxIdResult = await connectionManager.executeQuery(maxIdQuery);
    const nextValidationID = maxIdResult[0].nextValidationID;

    // Set the ValidationID for the new procedure
    validationProcedure.validationID = nextValidationID;
    delete validationProcedure['id']; // Remove any 'id' field if present

    const insertQuery = format('INSERT INTO ?? SET ?', [`${schema}.sitespecificvalidations`, validationProcedure]);
    const results = await connectionManager.executeQuery(insertQuery);
    const insertID = results.insertId;
    await connectionManager.commitTransaction(transactionID ?? '');
    return NextResponse.json({ insertID, validationID: nextValidationID }, { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Error:', error);
    await connectionManager.rollbackTransaction(transactionID ?? '');
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    await connectionManager.closeConnection();
  }
}

export async function PATCH(request: NextRequest) {
  const validationProcedure: ValidationProceduresRDS = await request.json();
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('No schema variable provided!');
  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;
  transactionID = await connectionManager.beginTransaction();
  try {
    delete validationProcedure['id'];
    const updateQuery = format('UPDATE ?? SET ? WHERE ValidationID = ?', [
      `${schema}.sitespecificvalidations`,
      validationProcedure,
      validationProcedure.validationID
    ]);
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
  const validationProcedure: ValidationProceduresRDS = await request.json();
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('No schema variable provided!');
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
