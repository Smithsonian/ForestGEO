import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';

// this is intended as a dedicated server-side execution pipeline for a given query. Results will be returned as-is to caller.
export async function POST(request: NextRequest) {
  const query = await request.json(); // receiving query already formatted and prepped for execution

  const connectionManager = new ConnectionManager();
  const results = await connectionManager.executeQuery(query);
  return new NextResponse(JSON.stringify(results), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
