import { NextRequest, NextResponse } from "next/server";
import { getConn, runQuery } from "@/components/processors/processormacros";
import { PoolConnection } from "mysql2/promise";
import { HTTPResponses } from "@/config/macros";

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get("schema");
  if (!schema) throw new Error("no schema variable provided!");
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();

    const queries = {
      numRecordsByQuadrat: `SELECT QuadratID, COUNT(CoreMeasurementID) AS MeasurementCount FROM ${schema}.coremeasurements GROUP BY QuadratID;`,
      allStemRecords: `SELECT COUNT(s.StemID) AS TotalStems FROM ${schema}.stems s JOIN ${schema}.cmattributes cma ON s.StemID = cma.CoreMeasurementID JOIN ${schema}.attributes a ON cma.Code = a.Code;`,
      liveStemRecords: `SELECT COUNT(s.StemID) AS LiveStems FROM ${schema}.stems s JOIN ${schema}.cmattributes cma ON s.StemID = cma.CoreMeasurementID JOIN ${schema}.attributes a ON cma.Code = a.Code WHERE a.Status = 'alive';`,
      treeCount: `SELECT COUNT(TreeID) AS TotalTrees FROM ${schema}.trees;`,
      countNumDeadMissingByCensus: `SELECT cm.CensusID, COUNT(s.StemID) AS DeadOrMissingStems FROM ${schema}.stems s JOIN ${schema}.cmattributes cma ON s.StemID = cma.CoreMeasurementID JOIN ${schema}.attributes a ON cma.Code = a.Code JOIN ${schema}.coremeasurements cm ON s.StemID = cm.StemID WHERE a.Status IN ('dead', 'missing') GROUP BY cm.CensusID;`,
      treesOutsideLimits: `SELECT t.TreeID, s.LocalX, s.LocalY, p.DimensionX, p.DimensionY FROM ${schema}.trees t JOIN ${schema}.stems s ON t.TreeID = s.TreeID JOIN ${schema}.quadrats q ON s.QuadratID = q.QuadratID JOIN ${schema}.plots p ON q.PlotID = p.PlotID WHERE s.LocalX IS NULL OR s.LocalY IS NULL OR s.LocalX > p.DimensionX OR s.LocalY > p.DimensionY;`,
      largestDBHHOMBySpecies: `SELECT sp.SpeciesID, sp.SpeciesName, MAX(cm.MeasuredDBH) AS LargestDBH, MAX(cm.MeasuredHOM) AS LargestHOM FROM ${schema}.species sp JOIN ${schema}.trees t ON sp.SpeciesID = t.SpeciesID JOIN ${schema}.coremeasurements cm ON t.TreeID = cm.TreeID GROUP BY sp.SpeciesID, sp.SpeciesName;`
    };

    const results = await Promise.all([
      runQuery(conn, queries.numRecordsByQuadrat),
      runQuery(conn, queries.allStemRecords),
      runQuery(conn, queries.liveStemRecords),
      runQuery(conn, queries.treeCount),
      runQuery(conn, queries.countNumDeadMissingByCensus),
      runQuery(conn, queries.treesOutsideLimits),
      runQuery(conn, queries.largestDBHHOMBySpecies)
    ]);

    const totalMeasurementCount = results[0].reduce((sum: number, record: { MeasurementCount: number }) => sum + record.MeasurementCount, 0);

    const response = {
      numRecordsByQuadrat: {
        totalMeasurementCount,
        data: results[0]
      },
      allStemRecords: {
        count: results[1].length,
        data: results[1]
      },
      liveStemRecords: {
        count: results[2].length,
        data: results[2]
      },
      treeCount: {
        count: results[3].length,
        data: results[3]
      },
      countNumDeadMissingByCensus: {
        count: results[4].length,
        data: results[4]
      },
      treesOutsideLimits: {
        count: results[5].length,
        data: results[5]
      },
      largestDBHHOMBySpecies: {
        count: results[6].length,
        data: results[6]
      }
    };

    return new NextResponse(JSON.stringify(response), {
      status: HTTPResponses.OK
    });
  } catch (error: any) {
    throw new Error("SQL query failed: " + error.message);
  } finally {
    if (conn) conn.release();
  }
}
