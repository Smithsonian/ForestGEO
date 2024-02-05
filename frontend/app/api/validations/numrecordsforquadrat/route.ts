import {NextRequest, NextResponse} from "next/server";
import {getConn, runQuery} from "@/components/processors/processorhelpers";

export async function GET(request: NextRequest) {
  const plotID = request.nextUrl.searchParams.get('plotID')!.trim();
  const censusID = request.nextUrl.searchParams.get("censusID")!.trim();

  /**
   * #1 -- Counting all stem records, dead or alive
   * SELECT PlotID,CensusID,QuadratName,COUNT() FROM ViewFullTable GROUP BY PlotID,CensusID,QuadratName;
   *
   * #2 -- Counting all live stem records only
   * SELECT PlotID,CensusID,QuadratName,count() FROM ViewFullTable WHERE status<>'dead' and status<>'stem dead' and status<>'missing' GROUP BY PlotID,CensusID,QuadratName;
   *
   * #3 -- Counting number of trees
   * SELECT PlotID,CensusID,QuadratName,count(DISTINCT TreeID) FROM ViewFullTable GROUP BY PlotID,CensusID,QuadratName;
   */

  let conn = await getConn();

  // need to get all quadratNames
  let allQuadratNamesQuery = `
  SELECT DISTINCT q.QuadratName
  FROM forestgeo_bci.quadrats q
  JOIN forestgeo_bci.coremeasurements cm ON q.QuadratID = cm.QuadratID
  WHERE cm.PlotID = ? AND cm.CensusID = ?;
  `
  const aqnResults = await runQuery(conn, allQuadratNamesQuery, [plotID, censusID]);

  let calculationsPerQuadratName: {
    [quadratName: string]: { totalStems: number, totalLivingStems: number, totalTrees: number }
  } = {};

  for (let row of aqnResults) {
    let quadratName = row.QuadratName;

    // query 1:
    let totalNumStemsQuery = `
    SELECT COUNT(s.StemID) AS NumberOfStems
    FROM forestgeo_bci.stems s
    JOIN forestgeo_bci.quadrats q ON s.QuadratID = q.QuadratID
    JOIN forestgeo_bci.coremeasurements cm ON s.StemID = cm.StemID
    JOIN forestgeo_bci.census c ON cm.CensusID = c.CensusID
    JOIN forestgeo_bci.plots p ON q.PlotID = p.PlotID
    WHERE q.QuadratName = ?
      AND c.CensusID = ?
      AND p.PlotID = ?
    `;
    const numStemsResults = await runQuery(conn, totalNumStemsQuery, [quadratName, censusID, plotID]);
    const numStems = numStemsResults[0].NumberOfStems;

    // query 2:
    let totalLivingStemsQuery = `
    SELECT COUNT(s.StemID) AS NumberOfLivingStems
    FROM forestgeo_bci.stems s
    JOIN forestgeo_bci.quadrats q ON s.QuadratID = q.QuadratID
    JOIN forestgeo_bci.coremeasurements cm ON s.StemID = cm.StemID
    JOIN forestgeo_bci.census c ON cm.CensusID = c.CensusID
    JOIN forestgeo_bci.plots p ON q.PlotID = p.PlotID
    JOIN forestgeo_bci.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
    JOIN forestgeo_bci.attributes a ON cma.Code = a.Code
    WHERE q.QuadratName = ?
      AND c.CensusID = ?
      AND p.PlotID = ?
      AND a.Status NOT IN ('dead', 'missing', 'stem dead');
    `
    const numLivingStemsResults = await runQuery(conn, totalLivingStemsQuery, [quadratName, censusID, plotID]);
    const numLivingStems = numLivingStemsResults[0].NumberOfLivingStems;

    // query 3:
    let totalNumTreesQuery = `
    SELECT COUNT(DISTINCT t.TreeID) AS NumberOfTrees
    FROM forestgeo_bci.trees t
    JOIN forestgeo_bci.coremeasurements cm ON t.TreeID = cm.TreeID
    JOIN forestgeo_bci.census c ON cm.CensusID = c.CensusID
    JOIN forestgeo_bci.quadrats q ON cm.QuadratID = q.QuadratID
    JOIN forestgeo_bci.plots p ON q.PlotID = p.PlotID
    WHERE q.QuadratName = ?
      AND c.CensusID = ?
      AND p.PlotID = ?;
    `
    const numTreesResults = await runQuery(conn, totalNumTreesQuery, [quadratName, censusID, plotID]);
    const numTrees = numTreesResults[0].NumberOfTrees;
    calculationsPerQuadratName[quadratName] = {
      totalStems: numStems,
      totalLivingStems: numLivingStems,
      totalTrees: numTrees
    };
  }
  return new NextResponse(JSON.stringify(calculationsPerQuadratName), {status: 200});
}