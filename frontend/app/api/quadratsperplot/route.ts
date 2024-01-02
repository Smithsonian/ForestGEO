import {NextRequest, NextResponse} from "next/server";
import sql from "mssql";
import {sqlConfig} from "@/config/macros";

async function getSqlConnection(tries: number) {
  return await sql.connect(sqlConfig).catch((err) => {
    console.error(err);
    if (tries == 5) {
      throw new Error("Connection failure");
    }
    console.log("conn failed --> trying again!");
    getSqlConnection(tries + 1);
  });
}

async function runQuery(conn: sql.ConnectionPool, query: string) {
  if (!conn) {
    throw new Error("invalid ConnectionPool object. check connection string settings.")
  }
  return await conn.request().query(query);
}

export async function GET(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  
  let plotID = request.nextUrl.searchParams.get('plotID')!;
  let results = await runQuery(conn, `SELECT COUNT(*) FROM forestgeo.Quadrats WHERE PlotID = ${plotID}`);
  if (!results) throw new Error("call failed");
  await conn.close();
  return new NextResponse(JSON.stringify(Object.values(results.recordset[0])));
}