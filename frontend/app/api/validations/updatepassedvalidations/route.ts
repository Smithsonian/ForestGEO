import { NextRequest, NextResponse } from "next/server";
import {getConn, getSchema, runQuery, UpdateValidationResponse} from "@/components/processors/processormacros";

export async function GET(request: NextRequest) {
  const conn = await getConn();
  const schema = getSchema();
  try {
    const plotIDParam = request.nextUrl.searchParams.get('plotID');
    const censusIDParam = request.nextUrl.searchParams.get('censusID');
    const plotID = plotIDParam ? parseInt(plotIDParam) : null;
    const censusID = censusIDParam ? parseInt(censusIDParam) : null;

    await conn.beginTransaction();

    // Call the stored procedure and get the updated IDs
    const callQuery = `CALL ${schema}.UpdateValidationStatus(?, ?, @RowsValidated);`;
    const [updatedIDsResult, _] = await runQuery(conn, callQuery, [plotID, censusID]);

    // Retrieve the number of rows validated
    const rowsValidatedResult = await runQuery(conn, 'SELECT @RowsValidated as RowsValidated;');
    const rowsValidated = rowsValidatedResult[0].RowsValidated;

    await conn.commit();

    // Prepare the response with the updated IDs
    const updatedIDs = updatedIDsResult.map((row: any) => row.CoreMeasurementID);
    const response: UpdateValidationResponse = {
      updatedIDs: updatedIDs,
      rowsValidated: rowsValidated
    };

    return new NextResponse(JSON.stringify(response), {status: 200});
  } catch (error: any) {
    await conn.rollback();
    return new NextResponse(JSON.stringify({error: error.message}), {status: 500});
  } finally {
    if (conn) conn.release();
  }
}
