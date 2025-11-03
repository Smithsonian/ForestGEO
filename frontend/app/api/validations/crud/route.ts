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
  const validationProcedure: ValidationProceduresRDS = await request.json();
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('No schema variable provided!');
  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;
  transactionID = await connectionManager.beginTransaction();
  try {
    // Map the validation object to database format and exclude id/validationID from update
    const mapper = MapperFactory.getMapper<ValidationProceduresRDS, any>('sitespecificvalidations');
    const [mappedData] = mapper.demapData([validationProcedure]);

    // Remove ValidationID from the update data (it's the WHERE clause, not SET)
    delete mappedData['ValidationID'];

    const updateQuery = format('UPDATE ?? SET ? WHERE ValidationID = ?', [
      `${schema}.sitespecificvalidations`,
      mappedData,
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
