import {NextRequest, NextResponse} from "next/server";
import {getConn, getSchema, runQuery, UpdateValidationResponse} from "@/components/processors/processormacros";

export async function GET(request: NextRequest) {
  const conn = await getConn();
  const schema = getSchema();
  const plotIDParam = request.nextUrl.searchParams.get('plotID');
  const censusIDParam = request.nextUrl.searchParams.get('censusID');

  try {
    await conn.beginTransaction();

    // Update query to toggle IsValidated status
    const updateQuery = `
      UPDATE ${schema}.coremeasurements cm
      LEFT JOIN ${schema}.cmverrors cme ON cm.CoreMeasurementID = cme.CoreMeasurementID
      SET cm.IsValidated = TRUE
      WHERE cm.IsValidated = FALSE
        AND (cm.PlotID = ? OR ? IS NULL)
        AND (cm.CensusID = ? OR ? IS NULL)
        AND cme.CoreMeasurementID IS NULL;
    `;

    const updateResult = await runQuery(conn, updateQuery, [plotIDParam, plotIDParam, censusIDParam, censusIDParam]);
    const rowsValidated = updateResult.affectedRows;
    console.log(`Rows Updated: ${rowsValidated}`);

    await conn.commit();

    const response: UpdateValidationResponse = {
      rowsValidated: rowsValidated
    };

    return new NextResponse(JSON.stringify(response), {status: 200});
  } catch (error: any) {
    await conn.rollback();
    console.error('Error in update operation:', error.message);
    return new NextResponse(JSON.stringify({error: error.message}), {status: 500});
  } finally {
    if (conn) conn.release();
  }
}
