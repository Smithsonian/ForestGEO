import { getConn, runQuery } from "@/components/processors/processormacros";
import { HTTPResponses } from "@/config/macros";
import { PoolConnection } from "mysql2/promise";
import { NextResponse } from "next/server";

type ValidationProcedure = {
  ProcedureName: string;
  Description: string;
};

type ValidationMessages = {
  [key: string]: string;
};

export async function GET(): Promise<NextResponse<ValidationMessages>> {
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const query = `SELECT ProcedureName, Description FROM catalog.validationprocedures WHERE IsEnabled = 1;`;
    const results: ValidationProcedure[] = await runQuery(conn, query);

    const validationMessages: ValidationMessages = results.reduce((acc, { ProcedureName, Description }) => {
      acc[ProcedureName] = Description;
      return acc;
    }, {} as ValidationMessages);

    return new NextResponse(JSON.stringify(validationMessages), {
      status: HTTPResponses.OK,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error: any) {
    console.error("Error in GET request:", error.message);
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: 500
    });
  } finally {
    if (conn) conn.release();
  }
}
