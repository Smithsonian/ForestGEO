import { NextRequest } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';

export async function GET(_request: NextRequest, props: { params: Promise<{ schema: string }> }) {
  const params = await props.params;
  const schema = params.schema;
  if (!schema) throw new Error('no schema variable provided!');
  const query = `SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = ?`;
  const connectionManager = ConnectionManager.getInstance();
  try {
    const results = await connectionManager.executeQuery(query, [schema]);
    return new Response(JSON.stringify(results), { status: 200 });
  } catch (e: any) {
    ailogger.error('Error:', e);
    throw new Error('Call failed: ', e);
  } finally {
    await connectionManager.closeConnection();
  }
}
