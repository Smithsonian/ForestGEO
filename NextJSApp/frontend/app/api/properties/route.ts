import {NextRequest, NextResponse} from "next/server";
import sql from "mssql";
import {selectAllRows, sqlConfig} from "@/config/macros";

export async function GET(request: NextRequest) {
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
  
  const type = request.nextUrl.searchParams.get('type')!;
  if (type == 'none' || '') throw new Error("blank type rn");
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  let results = await runQuery(conn, `SELECT * FROM [forestgeo].[${type.charAt(0).toUpperCase() + type.slice(1)}]`);
  if (!results) throw new Error("call failed");
  return new NextResponse(
    JSON.stringify({
      responseMessage: "Rows",
      recordsets: results.recordsets,
      recordset: results.recordset,
      output: results.output,
    }),
    {status: 200}
  );
}