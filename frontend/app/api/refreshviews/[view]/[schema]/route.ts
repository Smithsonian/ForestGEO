import { HTTPResponses } from '@/config/macros';
import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';

export async function POST(_request: NextRequest, { params }: { params: { view: string; schema: string } }) {
  if (!params.schema || params.schema === 'undefined' || !params.view || params.view === 'undefined' || !params) throw new Error('schema not provided');
  const { view, schema } = params;
  const connectionManager = ConnectionManager.getInstance();
  try {
    await connectionManager.beginTransaction();
    const query = `CALL ${schema}.Refresh${view === 'viewfulltable' ? 'ViewFullTable' : view === 'measurementssummary' ? 'MeasurementsSummary' : ''}();`;
    await connectionManager.executeQuery(query);
    return new NextResponse(null, { status: HTTPResponses.OK });
  } catch (e: any) {
    await connectionManager.rollbackTransaction();
    console.error('Error:', e);
    throw new Error('Call failed: ', e);
  } finally {
    await connectionManager.closeConnection();
  }
}
