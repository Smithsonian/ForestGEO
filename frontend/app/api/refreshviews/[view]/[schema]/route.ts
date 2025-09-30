import { HTTPResponses } from '@/config/macros';
import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function POST(_request: NextRequest, props: { params: Promise<{ view: string; schema: string }> }) {
  const params = await props.params;
  if (!params.schema || params.schema === 'undefined' || !params.view || params.view === 'undefined' || !params) throw new Error('schema not provided');
  const { view, schema } = params;
  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;
  try {
    transactionID = await connectionManager.beginTransaction();
    const query = `CALL ${schema}.Refresh${view === 'viewfulltable' ? 'ViewFullTable' : view === 'measurementssummary' ? 'MeasurementsSummary' : ''}();`;
    await connectionManager.executeQuery(query);
    await connectionManager.commitTransaction(transactionID ?? '');
    return new NextResponse(null, { status: HTTPResponses.OK });
  } catch (e: any) {
    await connectionManager.rollbackTransaction(transactionID ?? '');
    ailogger.error('Error:', e);
    throw new Error('Call failed: ', e);
  } finally {
    await connectionManager.closeConnection();
  }
}
