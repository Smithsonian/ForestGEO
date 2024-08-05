import { NextRequest, NextResponse } from "next/server";
import { PoolConnection } from "mysql2/promise";
import { getConn, runQuery } from "@/components/processors/processormacros";
import { generateHash } from "@/config/crypto-actions";
import { HTTPResponses } from "@/config/macros";

export async function GET(request: NextRequest) {
  let conn: PoolConnection | null = null;
  const schema = request.nextUrl.searchParams.get("schema");
  if (!schema) throw new Error("no schema provided!");
  try {
    conn = await getConn();
    // Query to get plots
    const plotQuery = `
      SELECT * FROM ${schema}.plots
    `;
    const plotResults = await runQuery(conn, plotQuery, []);

    return new NextResponse(JSON.stringify(generateHash(plotResults)), {
      status: HTTPResponses.OK
    });
  } catch (error) {
    console.error("Error in GET:", error);
    throw new Error("Failed to fetch plot data");
  } finally {
    if (conn) conn.release();
  }
}
