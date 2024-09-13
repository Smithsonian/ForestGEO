import { NextRequest, NextResponse } from 'next/server';
import { getConn, runQuery } from '@/components/processors/processormacros';
import { PoolConnection } from 'mysql2/promise';
import { HTTPResponses } from '@/config/macros';

export async function GET(request: NextRequest) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema variable provided!');
  const currentPlotParam = request.nextUrl.searchParams.get('currentPlotParam');
  if (!currentPlotParam) throw new Error('no current PlotParam');
  const currentCensusParam = request.nextUrl.searchParams.get('currentCensusParam');
  if (!currentCensusParam) throw new Error('no current CensusParam');
  const currentPlotID = parseInt(currentPlotParam);
  const currentCensusID = parseInt(currentCensusParam);
  const queries = {
    numRecordsByQuadrat: `SELECT q.QuadratID, COUNT(cm.CoreMeasurementID) AS MeasurementCount
                          FROM ${schema}.coremeasurements cm
                                   JOIN ${schema}.quadrats q ON q.CensusID = cm.CensusID
                          WHERE cm.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID}
                          GROUP BY QuadratID;`,
    allStemRecords: `SELECT COUNT(s.StemID) AS TotalStems
                     FROM ${schema}.stems s
                              JOIN ${schema}.cmattributes cma ON s.StemID = cma.CoreMeasurementID
                              JOIN ${schema}.attributes a ON cma.Code = a.Code
                              JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID
                     WHERE q.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID};`,
    liveStemRecords: `SELECT COUNT(s.StemID) AS LiveStems
                      FROM ${schema}.stems s
                               JOIN ${schema}.cmattributes cma ON s.StemID = cma.CoreMeasurementID
                               JOIN ${schema}.attributes a ON cma.Code = a.Code
                               JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID
                      WHERE a.Status = 'alive'
                        AND q.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID};`,
    treeCount: `SELECT COUNT(t.TreeID) AS TotalTrees
                FROM ${schema}.trees t
                         JOIN ${schema}.stems s ON s.TreeID = t.TreeID
                         JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID
                WHERE q.CensusID = ${currentCensusID} AND q.PlotID = ${currentPlotID};`,
    countNumDeadMissingByCensus: `SELECT cm.CensusID, COUNT(s.StemID) AS DeadOrMissingStems
                                  FROM ${schema}.stems s
                                           JOIN ${schema}.cmattributes cma ON s.StemID = cma.CoreMeasurementID
                                           JOIN ${schema}.attributes a ON cma.Code = a.Code
                                           JOIN ${schema}.coremeasurements cm ON s.StemID = cm.StemID
                                  WHERE a.Status IN ('dead', 'missing')
                                  GROUP BY cm.CensusID;`,
    treesOutsideLimits: `SELECT t.TreeID, s.LocalX, s.LocalY, p.DimensionX, p.DimensionY
                         FROM ${schema}.trees t
                                  JOIN ${schema}.stems s ON t.TreeID = s.TreeID
                                  JOIN ${schema}.quadrats q ON s.QuadratID = q.QuadratID
                                  JOIN ${schema}.plots p ON q.PlotID = p.PlotID
                         WHERE s.LocalX IS NULL
                            OR s.LocalY IS NULL
                            OR s.LocalX > p.DimensionX
                            OR s.LocalY > p.DimensionY 
                            AND p.PlotID = ${currentPlotID};`,
    largestDBHHOMBySpecies: `SELECT sp.SpeciesID, sp.SpeciesName, MAX(cm.MeasuredDBH) AS LargestDBH, MAX(cm.MeasuredHOM) AS LargestHOM
                             FROM ${schema}.species sp
                                      JOIN ${schema}.trees t ON sp.SpeciesID = t.SpeciesID
                                      JOIN ${schema}.stems s ON s.TreeID = t.TreeID
                                      JOIN ${schema}.coremeasurements cm ON cm.StemID = s.StemID
                             GROUP BY sp.SpeciesID, sp.SpeciesName;`,
    allTreesFromLastCensusPresent: `SELECT t.TreeID,
                                           t.TreeTag,
                                           t.SpeciesID
                                    FROM ${schema}.trees t
                                             JOIN
                                         ${schema}.stems s_last ON t.TreeID = s_last.TreeID
                                             JOIN
                                         ${schema}.coremeasurements cm_last ON s_last.StemID = cm_last.StemID
                                    WHERE cm_last.CensusID = ${currentCensusID} - 1
                                      AND NOT EXISTS (SELECT 1
                                                      FROM ${schema}.stems s_current
                                                               JOIN
                                                           ${schema}.coremeasurements cm_current ON s_current.StemID = cm_current.StemID
                                                      WHERE t.TreeID = s_current.TreeID
                                                        AND cm_current.CensusID = ${currentCensusID})
                                    GROUP BY t.TreeID, t.TreeTag, t.SpeciesID;`,
    numNewStemsPerQuadratPerCensus: `SELECT q.QuadratName,
                                            s_current.StemID,
                                            s_current.StemTag,
                                            s_current.TreeID,
                                            s_current.QuadratID,
                                            s_current.LocalX,
                                            s_current.LocalY,
                                            s_current.CoordinateUnits
                                     FROM ${schema}.quadrats q
                                              JOIN
                                          ${schema}.stems s_current ON q.QuadratID = s_current.QuadratID
                                              JOIN
                                          ${schema}.coremeasurements cm_current ON s_current.StemID = cm_current.StemID
                                     WHERE cm_current.CensusID = ${currentCensusID}
                                       AND NOT EXISTS (SELECT 1
                                                       FROM ${schema}.stems s_last
                                                                JOIN
                                                            ${schema}.coremeasurements cm_last ON s_last.StemID = cm_last.StemID
                                                       WHERE s_current.StemID = s_last.StemID
                                                         AND cm_last.CensusID = ${currentCensusID} - 1)
                                     ORDER BY q.QuadratName, s_current.StemID;`,
    numNewStemsMinMaxByQuadratPerCensus: `WITH NewStems AS (SELECT s_current.QuadratID,
                                                                   s_current.StemID
                                                            FROM ${schema}.stems s_current
                                                                     JOIN
                                                                 ${schema}.coremeasurements cm_current ON s_current.StemID = cm_current.StemID
                                                            WHERE cm_current.CensusID = ${currentCensusID}
                                                              AND NOT EXISTS (SELECT 1
                                                                              FROM ${schema}.stems s_last
                                                                                       JOIN
                                                                                   ${schema}.coremeasurements cm_last ON s_last.StemID = cm_last.StemID
                                                                              WHERE s_current.StemID = s_last.StemID
                                                                                AND cm_last.CensusID = ${currentCensusID} - 1)),
                                               NewStemCounts AS (SELECT q.QuadratID,
                                                                        q.QuadratName,
                                                                        COUNT(ns.StemID) AS NewStemCount
                                                                 FROM ${schema}.quadrats q
                                                                          LEFT JOIN
                                                                      NewStems ns ON q.QuadratID = ns.QuadratID
                                                                 GROUP BY q.QuadratID, q.QuadratName),
                                               LeastNewStems AS (SELECT 'Least New Stems' AS StemType,
                                                                        QuadratName,
                                                                        NewStemCount
                                                                 FROM NewStemCounts
                                                                 ORDER BY NewStemCount, QuadratName
                                                                 LIMIT 1),
                                               MostNewStems AS (SELECT 'Most New Stems' AS StemType,
                                                                       QuadratName,
                                                                       NewStemCount
                                                                FROM NewStemCounts
                                                                ORDER BY NewStemCount DESC, QuadratName DESC
                                                                LIMIT 1)
                                          SELECT *
                                          FROM LeastNewStems
                                          UNION ALL
                                          SELECT *
                                          FROM MostNewStems;`,
    numDeadStemsPerQuadratPerCensus: `SELECT q.QuadratName,
                                             s.StemID,
                                             s.StemTag,
                                             s.TreeID,
                                             s.QuadratID,
                                             s.LocalX,
                                             s.LocalY,
                                             s.CoordinateUnits,
                                             a.Code        AS AttributeCode,
                                             a.Description AS AttributeDescription,
                                             a.Status      AS AttributeStatus
                                      FROM ${schema}.quadrats q
                                               JOIN
                                           ${schema}.stems s ON q.QuadratID = s.QuadratID
                                               JOIN
                                           ${schema}.coremeasurements cm ON s.StemID = cm.StemID
                                               JOIN
                                           ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
                                               JOIN
                                           ${schema}.attributes a ON cma.Code = a.Code
                                      WHERE cm.CensusID = ${currentCensusID}
                                        AND a.Status = 'dead'
                                      ORDER BY q.QuadratName, s.StemID;`,
    numDeadStemsPerSpeciesPerCensus: `SELECT sp.SpeciesName,
                                             sp.SpeciesCode,
                                             s.StemID,
                                             s.StemTag,
                                             s.TreeID,
                                             s.QuadratID,
                                             s.LocalX,
                                             s.LocalY,
                                             s.CoordinateUnits,
                                             a.Code        AS AttributeCode,
                                             a.Description AS AttributeDescription,
                                             a.Status      AS AttributeStatus
                                      FROM ${schema}.stems s
                                               JOIN
                                           ${schema}.coremeasurements cm ON s.StemID = cm.StemID
                                               JOIN
                                           ${schema}.cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
                                               JOIN
                                           ${schema}.attributes a ON cma.Code = a.Code
                                               JOIN
                                           ${schema}.trees t ON s.TreeID = t.TreeID
                                               JOIN
                                           ${schema}.species sp ON t.SpeciesID = sp.SpeciesID
                                      WHERE cm.CensusID = @currentCensusID
                                        AND a.Status = 'dead'
                                      ORDER BY sp.SpeciesName, s.StemID;`
  };

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const results = await Promise.all([
      runQuery(conn, queries.numRecordsByQuadrat),
      runQuery(conn, queries.allStemRecords),
      runQuery(conn, queries.liveStemRecords),
      runQuery(conn, queries.treeCount),
      runQuery(conn, queries.countNumDeadMissingByCensus),
      runQuery(conn, queries.treesOutsideLimits),
      runQuery(conn, queries.largestDBHHOMBySpecies),
      runQuery(conn, queries.allTreesFromLastCensusPresent),
      runQuery(conn, queries.numNewStemsPerQuadratPerCensus),
      runQuery(conn, queries.numNewStemsMinMaxByQuadratPerCensus),
      runQuery(conn, queries.numDeadStemsPerQuadratPerCensus),
      runQuery(conn, queries.numDeadStemsPerSpeciesPerCensus)
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
      },
      allTreesFromLastCensusPresent: {
        count: results[7].length,
        data: results[7]
      },
      numNewStemsPerQuadratPerCensus: {
        count: results[8].length,
        data: results[8]
      },
      numNewStemsMinMaxByQuadratPerCensus: {
        count: results[9].length,
        data: results[9]
      },
      numDeadStemsPerQuadratPerCensus: {
        count: results[10].length,
        data: results[10]
      },
      numDeadStemsPerSpeciesPerCensus: {
        count: results[11].length,
        data: results[11]
      }
    };

    return new NextResponse(JSON.stringify(response), {
      status: HTTPResponses.OK
    });
  } catch (error: any) {
    throw new Error('Post-Summary Census Staistics: SQL query failed: ' + error.message);
  } finally {
    if (conn) conn.release();
  }
}
