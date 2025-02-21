import { NextRequest } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('schema not provided');
  const connectionManager = ConnectionManager.getInstance();
  try {
    void connectionManager.executeQuery(`CALL ${schema}.ingestion();`);
  } catch (e: any) {
    console.error('Error in GET request:', e);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
  return new Response(JSON.stringify({ message: 'Ingestion started' }), { status: 200 });
}
