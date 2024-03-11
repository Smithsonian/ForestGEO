import {NextRequest, NextResponse} from "next/server";
import {PoolConnection} from "mysql2/promise";
import {getConn, getSchema, getSqlConnection, QuadratsResult, runQuery} from "@/components/processors/processormacros";
import {QuadratsRDS} from "@/config/sqlmacros";
import {generateHash} from "@/config/crypto-actions";

export async function GET(request: NextRequest) {
  const schema = getSchema();
  let conn: PoolConnection | null = null;
  try {
    conn = await getSqlConnection(0);
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