import {NextRequest, NextResponse} from "next/server";
import {getConn, runQuery, UpdateValidationResponse} from "@/components/processors/processormacros";

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

    // Run the stored procedure
    await runQuery(conn, callQuery, callParams);

    // Retrieve the IDs of the updated rows
    const updatedIDsResult = await runQuery(conn, 'SELECT * FROM TempUpdatedIDs;');

    // Retrieve the count of updated rows
    const rowCountResult = await runQuery(conn, 'SELECT @RowsValidated AS RowsValidated;');

    await conn.commit();

    // Format the response
    const response: UpdateValidationResponse = {
      updatedIDs: updatedIDsResult.map((row: any) => row.CoreMeasurementID),
      rowsValidated: rowCountResult[0].RowsValidated
    };

    return new NextResponse(JSON.stringify(response), {status: 200});
  } catch (error: any) {
    await conn.rollback();
    return new NextResponse(JSON.stringify({error: error.message}), {status: 500});
  } finally {
    if (conn) conn.release();
  }
}
