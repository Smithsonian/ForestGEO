import { getConn, runQuery } from '@/components/processors/processormacros';
import { HTTPResponses } from '@/config/macros';
import { PoolConnection } from 'mysql2/promise';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(_request: NextRequest, { params }: { params: { view: string; schema: string } }) {
  if (!params.schema || params.schema === 'undefined' || !params.view || params.view === 'undefined' || !params) throw new Error('schema not provided');
  const { view, schema } = params;
  let connection: PoolConnection | null = null;
  try {
    connection = await getConn();
    await connection.beginTransaction();
    const query = `CALL ${schema}.Refresh${view === 'viewfulltable' ? 'ViewFullTable' : view === 'measurementssummary' ? 'MeasurementsSummary' : ''}();`;
    await runQuery(connection, query);
    await connection.commit();
    return new NextResponse(null, { status: HTTPResponses.OK });
  } catch (e: any) {
    await connection?.rollback();
    console.error('Error:', e);
    throw new Error('Call failed: ', e);
  } finally {
    if (connection) connection.release();
  }
}
