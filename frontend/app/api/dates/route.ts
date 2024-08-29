import { NextRequest, NextResponse } from 'next/server';
import { PoolConnection } from 'mysql2/promise';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { HTTPResponses } from '@/config/macros';

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) {
    return NextResponse.json({ message: 'No schema variable provided!' }, { status: HTTPResponses.INVALID_REQUEST });
  }

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    await conn.beginTransaction();

    // Combine the SELECT and UPDATE queries
    const combinedQuery = `
      UPDATE ${schema}.census c
      JOIN (
        SELECT CensusID, MIN(MeasurementDate) AS FirstMeasurementDate, MAX(MeasurementDate) AS LastMeasurementDate
        FROM ${schema}.coremeasurements
        GROUP BY CensusID
      ) m ON c.CensusID = m.CensusID
      SET c.StartDate = m.FirstMeasurementDate, c.EndDate = m.LastMeasurementDate;
    `;

    const result = await runQuery(conn, combinedQuery);

    await conn.commit();
    return NextResponse.json({ message: 'Census dates updated successfully.', updatedRows: result.affectedRows }, { status: HTTPResponses.OK });
  } catch (error: any) {
    await conn?.rollback();
    return NextResponse.json({ message: error.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    if (conn) conn.release();
  }
}
