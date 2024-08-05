import { PoolConnection } from 'mysql2/promise';

// utils/errorHandler.ts
export function handleError(error: any, conn: PoolConnection | null, row: any) {
  if (conn) {
    conn.rollback().catch(() => {});
  }
  console.error('SQL Error:', error);
  return new Response(
    JSON.stringify({
      message: 'SQL Error: ' + (error.message || 'Unknown error'),
      row
    }),
    { status: 500 }
  );
}
