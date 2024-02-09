import {NextRequest, NextResponse} from "next/server";
import {getConn, runQuery} from "@/components/processors/processormacros";

export async function GET(request: NextRequest) {
  const conn = await getConn();
  try {
    const plotIDParam = request.nextUrl.searchParams.get('plotID');
    const censusIDParam = request.nextUrl.searchParams.get('censusID');
    const plotID = plotIDParam ? parseInt(plotIDParam) : null;
    const censusID = censusIDParam ? parseInt(censusIDParam) : null;
    await conn.beginTransaction();
    const callQuery = 'CALL UpdateValidationStatus(?, ?, @RowsValidated);';
    const callParams = [plotID, censusID];
    await runQuery(conn, callQuery, callParams);

    const output = await runQuery(conn, 'SELECT @RowsValidated AS RowsValidated;');
    await conn.commit();
    return new NextResponse(JSON.stringify(output[0].RowsValidated), { status: 200 });
  } catch (error: any) {
    await conn.rollback();
    return new NextResponse(JSON.stringify({ error: error.message }), { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}
