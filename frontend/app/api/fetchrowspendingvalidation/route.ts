import { NextRequest, NextResponse } from 'next/server';
import { PoolConnection } from 'mysql2/promise';
import { getConn, runQuery } from '@/components/processors/processormacros';
import MapperFactory from '@/config/datamapper';

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  const plotIDParam = request.nextUrl.searchParams.get('plotID');
  const censusIDParam = request.nextUrl.searchParams.get('censusID');
  const plotID = plotIDParam ? parseInt(plotIDParam) : null;
  const censusID = censusIDParam ? parseInt(censusIDParam) : null;
  const query = `
  SELECT 
      cm.*
  FROM 
      ${schema}.coremeasurements cm
  JOIN 
      ${schema}.stems s ON cm.StemID = s.StemID
  JOIN 
      ${schema}.quadrats q ON s.QuadratID = q.QuadratID
  WHERE 
      cm.IsValidated IS NULL
      ${plotID !== null ? `AND q.PlotID = ${plotID}` : ''}
      ${censusID !== null ? `AND cm.CensusID = ${censusID}` : ''} ORDER BY MeasurementDate LIMIT 10;`;
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const results = await runQuery(conn, query);
    return new NextResponse(JSON.stringify(MapperFactory.getMapper<any, any>('coremeasurements').mapData(results)), {
      status: 200
    });
  } catch (error: any) {
    console.error('Error in update operation:', error.message);
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: 500
    });
  }
}
