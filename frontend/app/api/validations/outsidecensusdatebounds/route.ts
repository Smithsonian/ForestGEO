import {NextRequest, NextResponse} from "next/server";
import {getConn, runQuery, ValidationResponse} from "@/components/processors/processormacros";

// Function to call and handle the stored procedure
async function ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat(plotID: number | null, censusID: number | null) {
  const conn = await getConn();
  try {
    await conn.beginTransaction();
    const query = 'CALL ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat(?, ?)';
    const result = await runQuery(conn, query, [censusID, plotID]); // Pass censusID and plotID as parameters
    const validationResponse: ValidationResponse = {
      expectedRows: result[0].ExpectedRows,
      insertedRows: result[0].InsertedRows,
      updatedRows: result[0].UpdatedRows,
      message: result[0].Message
    };
    await conn.commit();
    return validationResponse;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

export async function GET(request: NextRequest) {
  try {
    const plotIDParam = request.nextUrl.searchParams.get('plotID');
    const censusIDParam = request.nextUrl.searchParams.get('censusID');
    const plotID = plotIDParam ? parseInt(plotIDParam) : null;
    const censusID = censusIDParam ? parseInt(censusIDParam) : null;

    const validationResponse = await ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat(plotID, censusID);
    return new NextResponse(JSON.stringify(validationResponse), { status: 200 });
  } catch (error: any) {
    return new NextResponse(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
