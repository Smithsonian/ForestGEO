import {NextRequest, NextResponse} from "next/server";
import {PoolConnection} from "mysql2/promise";
import {getConn, runQuery} from "@/components/processors/processormacros";
import {generateHash} from "@/config/crypto-actions";

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema provided!');
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const query = `SELECT * FROM ${schema}.Quadrats`;
    const results = await runQuery(conn, query);
    return new NextResponse(JSON.stringify(generateHash(results)), {status: 200});
  } catch (error) {
    console.error('Error:', error);
    throw new Error("Call failed");
  } finally {
    if (conn) conn.release();
  }
}