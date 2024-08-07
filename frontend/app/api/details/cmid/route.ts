import { NextRequest, NextResponse } from 'next/server';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { PoolConnection } from 'mysql2/promise';
import { HTTPResponses } from '@/config/macros';

export async function GET(request: NextRequest) {
  const cmID = parseInt(request.nextUrl.searchParams.get('cmid')!);
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const query = `
        SELECT
            cm.CoreMeasurementID,
            p.PlotName,
            q.QuadratName,
            c.PlotCensusNumber,
            c.StartDate,
            c.EndDate,
            per.FirstName,
            per.LastName,
            s.SpeciesName
        FROM
            ${schema}.coremeasurements cm
                INNER JOIN
            ${schema}.stems st ON cm.StemID = st.StemID
                INNER JOIN
            ${schema}.trees t ON st.TreeID = t.TreeID
                INNER JOIN
            ${schema}.species s ON t.SpeciesID = s.SpeciesID
                INNER JOIN
            ${schema}.quadrats q ON st.QuadratID = q.QuadratID
                INNER JOIN
            ${schema}.plots p ON q.PlotID = p.PlotID
                INNER JOIN
            ${schema}.census c ON cm.CensusID = c.CensusID
                INNER JOIN
            ${schema}.personnel per ON cm.PersonnelID = per.PersonnelID
        WHERE
            cm.CoreMeasurementID = ?;`;
    const results = await runQuery(conn, query, [cmID]);
    return new NextResponse(
      JSON.stringify(
        results.map((row: any) => ({
          coreMeasurementID: row.CoreMeasurementID,
          plotName: row.PlotName,
          quadratName: row.QuadratName,
          plotCensusNumber: row.PlotCensusNumber,
          censusStart: row.StartDate,
          censusEnd: row.EndDate,
          personnelName: row.FirstName + ' ' + row.LastName,
          speciesName: row.SpeciesName
        }))
      ),
      { status: HTTPResponses.OK }
    );
  } catch (error: any) {
    throw new Error('SQL query failed: ' + error.message);
  } finally {
    if (conn) conn.release();
  }
}
