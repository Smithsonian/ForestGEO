import { NextRequest, NextResponse } from "next/server";
import { getConn, runQuery } from "@/components/processors/processormacros";
import { PoolConnection } from "mysql2/promise";

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();

    const numRecordsByQuadrat = `SELECT QuadratID, COUNT(CoreMeasurementID) AS MeasurementCount FROM ${schema}.coremeasurements GROUP BY QuadratID;`;
    const allStemRecords = `SELECT COUNT(s.StemID) AS TotalStems FROM ${schema}.stems s JOIN ${schema}.cmattributes cma ON s.StemID = cma.StemID JOIN ${schema}.attributes a ON cma.Code = a.Code;`;
    const liveStemRecords = `SELECT COUNT(s.StemID) AS LiveStems FROM ${schema}.stems s JOIN ${schema}.cmattributes cma ON s.StemID = cma.StemID JOIN ${schema}.attributes a ON cma.Code = a.Code WHERE a.Status = 'alive';`;
    const treeCount = `SELECT COUNT(TreeID) AS TotalTrees FROM ${schema}.trees;`;
    const countNumDeadMissingByCensus = `SELECT cm.CensusID, COUNT(s.StemID) AS DeadOrMissingStems FROM ${schema}.stems s JOIN ${schema}.cmattributes cma ON s.StemID = cma.StemID JOIN ${schema}.attributes a ON cma.Code = a.Code JOIN ${schema}.coremeasurements cm ON s.StemID = cm.StemID WHERE a.Status IN ('dead', 'missing') GROUP BY cm.CensusID;`;
    const treesOutsideLimits = `SELECT t.TreeID, s.LocalX, s.LocalY, p.DimensionX, p.DimensionY FROM ${schema}.trees t JOIN ${schema}.stems s ON t.TreeID = s.TreeID JOIN ${schema}.quadrats q ON s.QuadratID = q.QuadratID JOIN ${schema}.plots p ON q.PlotID = p.PlotID WHERE s.LocalX IS NULL OR s.LocalY IS NULL OR s.LocalX > p.DimensionX OR s.LocalY > p.DimensionY;`;
    const largestDBHHOMBySpecies = `SELECT sp.SpeciesID, sp.SpeciesName, MAX(cm.MeasuredDBH) AS LargestDBH, MAX(cm.MeasuredHOM) AS LargestHOM FROM ${schema}.species sp JOIN ${schema}.trees t ON sp.SpeciesID = t.SpeciesID JOIN ${schema}.coremeasurements cm ON t.TreeID = cm.TreeID GROUP BY sp.SpeciesID, sp.SpeciesName;`;

    const [numRecordsByQuadratResults, allStemRecordsResults, liveStemRecordsResults, treeCountResults, countNumDeadMissingByCensusResults, treesOutsideLimitsResults, largestDBHHOMBySpeciesResults] = await Promise.all([
      runQuery(conn, numRecordsByQuadrat),
      runQuery(conn, allStemRecords),
      runQuery(conn, liveStemRecords),
      runQuery(conn, treeCount),
      runQuery(conn, countNumDeadMissingByCensus),
      runQuery(conn, treesOutsideLimits),
      runQuery(conn, largestDBHHOMBySpecies)
    ]);

    return new NextResponse(
      JSON.stringify({
        numRecordsByQuadrat: numRecordsByQuadratResults,
        allStemRecords: allStemRecordsResults,
        liveStemRecords: liveStemRecordsResults,
        treeCount: treeCountResults,
        countNumDeadMissingByCensus: countNumDeadMissingByCensusResults,
        treesOutsideLimits: treesOutsideLimitsResults,
        largestDBHHOMBySpecies: largestDBHHOMBySpeciesResults
      }), 
      { status: 200 }
    );
  } catch (error: any) {
    throw new Error('SQL query failed: ' + error.message);
  } finally {
    if (conn) conn.release();
  }
}
