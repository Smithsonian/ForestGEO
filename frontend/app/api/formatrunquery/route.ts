import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { format } from 'mysql2/promise';

// this is intended as a dedicated server-side execution pipeline for a given query. Results will be returned as-is to caller.
export async function POST(request: NextRequest) {
  const body = await request.json(); // receiving query already formatted and prepped for execution
  const { query, params } = body;
  const connectionManager = ConnectionManager.getInstance();
  const formattedQuery = format(query, params);
  const results = await connectionManager.executeQuery(formattedQuery);
  return new NextResponse(JSON.stringify(results), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
