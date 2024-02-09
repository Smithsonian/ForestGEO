import {NextRequest, NextResponse} from "next/server";
import {getSqlConnection} from "@/components/processors/processormacros";
import {PoolConnection} from "mysql2/promise";
import {HTTPResponses} from "@/config/macros";
import {insertOrUpdate} from "@/components/processors/processorhelperfunctions";

export async function POST(request: NextRequest) {
  const fileRowSet = await request.json();
  const fileName = request.nextUrl.searchParams.get('fileName')!.trim();
  const plot = request.nextUrl.searchParams.get("plot")!.trim();
  const census = request.nextUrl.searchParams.get("census")!.trim();
  const user = request.nextUrl.searchParams.get("user")!;
  const formType = request.nextUrl.searchParams.get("formType")!.trim();

  let conn: PoolConnection | null = null; // Use PoolConnection type

  try {
    let i = 0;
    conn = await getSqlConnection(i);
    if (!conn) {
      throw new Error("SQL connection failed");
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error processing files:", error.message);
      return new NextResponse(
        JSON.stringify({
          responseMessage: `Failure in connecting to SQL with ${error.message}`,
          error: error.message,
        }),
        {status: HTTPResponses.SQL_CONNECTION_FAILURE}
      );
    } else {
      console.error("Unknown error in connecting to SQL:", error);
      return new NextResponse(
        JSON.stringify({
          responseMessage: `Unknown SQL connection error with error: ${error}`,
        }),
        {status: HTTPResponses.SQL_CONNECTION_FAILURE}
      );
    }
  }

  if (!conn) {
    console.error("Container client or SQL connection is undefined.");
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Container client or SQL connection is undefined",
      }),
      {status: HTTPResponses.SERVICE_UNAVAILABLE}
    );
  }

  for (const rowId in fileRowSet) {
    const row = fileRowSet[rowId];
    try {
      await insertOrUpdate(conn, formType, row, plot, census, user);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error processing row for file ${fileName}:`, error.message);
        return new NextResponse(
          JSON.stringify({
            responseMessage: `Error processing row in file ${fileName}`,
            error: error.message,
          }),
          {status: HTTPResponses.SERVICE_UNAVAILABLE}
        );
      } else {
        console.error("Unknown error processing row:", error);
        return new NextResponse(
          JSON.stringify({
            responseMessage: `Unknown processing error at row, in file ${fileName}`,
          }),
          {status: HTTPResponses.SERVICE_UNAVAILABLE}
        );
      }
    }
  }
  return new NextResponse(JSON.stringify({message: "Insert to SQL successful"}), {status: 200});
}