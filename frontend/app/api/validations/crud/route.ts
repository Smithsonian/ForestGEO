import { NextRequest, NextResponse } from 'next/server';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';
import { format, PoolConnection } from 'mysql2/promise';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { HTTPResponses } from '@/config/macros';
import MapperFactory from '@/config/datamapper';

export async function GET(_request: NextRequest) {
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const query = `SELECT * FROM catalog.validationprocedures;`;
    const results = await runQuery(conn, query);
    conn.release();
    return new NextResponse(JSON.stringify(MapperFactory.getMapper<any, any>('validationprocedures').mapData(results)), { status: HTTPResponses.OK });
  } catch (error: any) {
    console.error('Error:', error);
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    if (conn) conn.release();
  }
}

export async function POST(request: NextRequest) {
  const { validationProcedure }: { validationProcedure: ValidationProceduresRDS } = await request.json();
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    delete validationProcedure['validationID'];
    const insertQuery = format('INSERT INTO ?? SET ?', [`catalog.validationprocedures`, validationProcedure]);
    const results = await runQuery(conn, insertQuery);
    const insertID = results.insertId;
    conn.release();
    return NextResponse.json({ insertID }, { status: HTTPResponses.OK });
  } catch (error: any) {
    console.error('Error:', error);
    conn?.release();
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    if (conn) conn.release();
  }
}

export async function PATCH(request: NextRequest) {
  const { validationProcedure }: { validationProcedure: ValidationProceduresRDS } = await request.json();
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const updatedValidationProcedure = delete validationProcedure['validationID'];
    const updateQuery = format('UPDATE ?? SET ? WHERE ValidationID = ?', [
      `catalog.validationprocedures`,
      updatedValidationProcedure,
      validationProcedure.validationID
    ]);
    await runQuery(conn, updateQuery);
    conn.release();
    return NextResponse.json({}, { status: HTTPResponses.OK });
  } catch (error: any) {
    console.error('Error:', error);
    conn?.release();
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    if (conn) conn.release();
  }
}

export async function DELETE(request: NextRequest) {
  const { validationProcedure }: { validationProcedure: ValidationProceduresRDS } = await request.json();
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const deleteQuery = format('DELETE FROM ?? WHERE ValidationID = ?', [`catalog.validationprocedures`, validationProcedure.validationID]);
    await runQuery(conn, deleteQuery);
    conn.release();
    return NextResponse.json({}, { status: HTTPResponses.OK });
  } catch (error: any) {
    console.error('Error:', error);
    conn?.release();
    return NextResponse.json({}, { status: HTTPResponses.CONFLICT });
  } finally {
    if (conn) conn.release();
  }
}
