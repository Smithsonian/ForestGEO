import { HTTPResponses } from '@/config/macros';
import { format } from 'mysql2/promise';
import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';

// dataType
// slugs: schema, columnName, value ONLY
// needs to match dynamic format established by other slug routes!
// refit to match entire rows, using dataType convention to determine what columns need testing?
export async function GET(request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const params = await props.params;
  // simple dynamic validation to confirm table input values:
  if (!params.slugs || params.slugs.length !== 3) throw new Error('slugs missing -- formvalidation');
  if (!params.dataType || params.dataType === 'undefined') throw new Error('no schema provided');

  const [schema, columnName, value] = params.slugs;

  if (!schema || !columnName || !value) return new NextResponse(null, { status: 404 });

  const connectionManager = ConnectionManager.getInstance();
  try {
    const query = `SELECT 1 FROM ?? WHERE ?? = ? LIMIT 1`;
    const formatted = format(query, [`${schema}.${params.dataType}`, columnName, value]);
    const results = await connectionManager.executeQuery(formatted);
    if (results.length === 0) return new NextResponse(null, { status: 404 });
    return new NextResponse(null, { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error(error);
    throw error;
  } finally {
    await connectionManager.closeConnection();
  }
}
