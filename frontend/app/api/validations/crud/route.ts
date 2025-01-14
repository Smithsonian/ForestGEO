import { NextRequest, NextResponse } from 'next/server';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';
import { format } from 'mysql2/promise';
import { HTTPResponses } from '@/config/macros';
import MapperFactory from '@/config/datamapper';
import ConnectionManager from '@/config/connectionmanager';

export async function GET(_request: NextRequest) {
  const connectionManager = ConnectionManager.getInstance();
  try {
    const query = `SELECT * FROM catalog.validationprocedures;`;
    const results = await connectionManager.executeQuery(query);
    return new NextResponse(JSON.stringify(MapperFactory.getMapper<any, any>('validationprocedures').mapData(results)), { status: HTTPResponses.OK });
  } catch (error: any) {
    console.error('Error:', error);
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    await connectionManager.closeConnection();
  }
}

export async function POST(request: NextRequest) {
  const validationProcedure: ValidationProceduresRDS = await request.json();
  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;
  transactionID = await connectionManager.beginTransaction();
  try {
    delete validationProcedure['validationID'];
    const insertQuery = format('INSERT INTO ?? SET ?', [`catalog.validationprocedures`, validationProcedure]);
    const results = await connectionManager.executeQuery(insertQuery);
    const insertID = results.insertId;
    await connectionManager.commitTransaction(transactionID ?? '');
    return NextResponse.json({ insertID }, { status: HTTPResponses.OK });
  } catch (error: any) {
    console.error('Error:', error);
    await connectionManager.rollbackTransaction(transactionID ?? '');
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    await connectionManager.closeConnection();
  }
}

export async function PATCH(request: NextRequest) {
  const validationProcedure: ValidationProceduresRDS = await request.json();
  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;
  transactionID = await connectionManager.beginTransaction();
  try {
    delete validationProcedure['id'];
    const updateQuery = format('UPDATE ?? SET ? WHERE ValidationID = ?', [
      `catalog.validationprocedures`,
      validationProcedure,
      validationProcedure.validationID
    ]);
    await connectionManager.executeQuery(updateQuery);
    await connectionManager.commitTransaction(transactionID ?? '');
    return NextResponse.json({}, { status: HTTPResponses.OK });
  } catch (error: any) {
    console.error('Error:', error);
    await connectionManager.rollbackTransaction(transactionID ?? '');
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    await connectionManager.closeConnection();
  }
}

export async function DELETE(request: NextRequest) {
  const validationProcedure: ValidationProceduresRDS = await request.json();
  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;
  transactionID = await connectionManager.beginTransaction();
  try {
    const deleteQuery = format('DELETE FROM ?? WHERE ValidationID = ?', [`catalog.validationprocedures`, validationProcedure.validationID]);
    await connectionManager.executeQuery(deleteQuery);
    await connectionManager.commitTransaction(transactionID ?? '');
    return NextResponse.json({}, { status: HTTPResponses.OK });
  } catch (error: any) {
    console.error('Error:', error);
    await connectionManager.rollbackTransaction(transactionID ?? '');
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    await connectionManager.closeConnection();
  }
}
