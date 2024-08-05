import { getConn, runQuery } from "@/components/processors/processormacros";
import { HTTPResponses } from "@/config/macros";
import { PoolConnection } from "mysql2/promise";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, { params }: { params: { view: string; schema: string } }) {
  if (!params.schema || params.schema === "undefined" || !params.view || params.view === "undefined" || !params) throw new Error("schema not provided");
  const { view, schema } = params;
  let connection: PoolConnection | null = null;

  // subfunction to convert lowercased view names to internally capitalized ones ==> measurementssummary becomes MeasurementsSummary
  const formattedView = view
    .split(/(?=[A-Z])|[^a-zA-Z0-9]+/) // Split by non-alphanumeric characters or before capital letters
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) // Capitalize each word
    .join(""); // Join them back without spaces

  try {
    connection = await getConn();
    const query = `CALL ${schema}.Refresh${formattedView}();`;
    await runQuery(connection, query);
    return new NextResponse(null, { status: HTTPResponses.OK });
  } catch (e: any) {
    console.error("Error:", e);
    throw new Error("Call failed: ", e);
  } finally {
    if (connection) connection.release();
  }
}
