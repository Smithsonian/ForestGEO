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
  const { validationProcedure }: { validationProcedure: ValidationProceduresRDS } = await request.json();
  const connectionManager = ConnectionManager.getInstance();
  try {
    delete validationProcedure['validationID'];
    const insertQuery = format('INSERT INTO ?? SET ?', [`catalog.validationprocedures`, validationProcedure]);
    const results = await connectionManager.executeQuery(insertQuery);
    const insertID = results.insertId;
    return NextResponse.json({ insertID }, { status: HTTPResponses.OK });
  } catch (error: any) {
    console.error('Error:', error);
    await connectionManager.rollbackTransaction();
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    await connectionManager.closeConnection();
  }
}

export async function PATCH(request: NextRequest) {
  const { validationProcedure }: { validationProcedure: ValidationProceduresRDS } = await request.json();
  const connectionManager = ConnectionManager.getInstance();
  try {
    const updatedValidationProcedure = delete validationProcedure['validationID'];
    const updateQuery = format('UPDATE ?? SET ? WHERE ValidationID = ?', [
      `catalog.validationprocedures`,
      updatedValidationProcedure,
      validationProcedure.validationID
    ]);
    await connectionManager.executeQuery(updateQuery);
    return NextResponse.json({}, { status: HTTPResponses.OK });
  } catch (error: any) {
    console.error('Error:', error);
    await connectionManager.rollbackTransaction();
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    await connectionManager.closeConnection();
  }
}

export async function DELETE(request: NextRequest) {
  const { validationProcedure }: { validationProcedure: ValidationProceduresRDS } = await request.json();
  const connectionManager = ConnectionManager.getInstance();
  try {
    const deleteQuery = format('DELETE FROM ?? WHERE ValidationID = ?', [`catalog.validationprocedures`, validationProcedure.validationID]);
    await connectionManager.executeQuery(deleteQuery);
    return NextResponse.json({}, { status: HTTPResponses.OK });
  } catch (error: any) {
    console.error('Error:', error);
    await connectionManager.rollbackTransaction();
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    await connectionManager.closeConnection();
  }
}
