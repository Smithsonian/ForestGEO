import ConnectionManager from '@/config/connectionmanager';

// utils/errorHandler.ts
export function handleError(error: any, conn: ConnectionManager, row: any) {
  console.error('SQL Error:', error);
  conn.rollbackTransaction().then(_ => {
    return new Response(
      JSON.stringify({
        message: 'SQL Error: ' + (error.message || 'Unknown error'),
        row
      }),
      { status: 500 }
    );
  });
}
