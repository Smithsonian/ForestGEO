import {NextRequest, NextResponse} from "next/server";
import {getConn, getSchema, runQuery} from "@/components/processors/processormacros";
import {PoolConnection} from "mysql2/promise";

export async function GET(request: NextRequest) {
  const schema = getSchema();
  const cmID = parseInt(request.nextUrl.searchParams.get('cmid')!);
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    let query = `
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
          ${schema}.plots p ON cm.PlotID = p.PlotID
      INNER JOIN 
          ${schema}.quadrats q ON cm.QuadratID = q.QuadratID
      INNER JOIN 
          ${schema}.census c ON cm.CensusID = c.CensusID
      INNER JOIN 
          ${schema}.personnel per ON cm.PersonnelID = per.PersonnelID
      INNER JOIN 
          ${schema}.trees t ON cm.TreeID = t.TreeID
      INNER JOIN 
          ${schema}.species s ON t.SpeciesID = s.SpeciesID
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
      ), {status: 200});
  } catch (error: any) {
    throw new Error('SQL query failed: ' + error.message);
  } finally {
    if (conn) conn.release();
  }
}