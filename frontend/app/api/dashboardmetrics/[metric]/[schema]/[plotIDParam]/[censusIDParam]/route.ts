import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { validateContextualValues } from '@/lib/contextvalidation';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{ metric: string; schema: string; plotIDParam: string; censusIDParam: string }>;
  }
) {
  const { metric, schema: schemaParam, plotIDParam, censusIDParam } = await props.params;
  const plotName = request.nextUrl.searchParams.get('plot');

  if (!metric) {
    return NextResponse.json({ error: 'Metric parameter is required' }, { status: HTTPResponses.BAD_REQUEST });
  }

  if (!plotName) {
    return NextResponse.json({ error: 'Plot name query parameter is required' }, { status: HTTPResponses.BAD_REQUEST });
  }

  // Validate contextual values with fallback to URL params
  const validation = await validateContextualValues(request, {
    requireSchema: true,
    requirePlot: true,
    requireCensus: true,
    allowFallback: true,
    fallbackMessage: 'Dashboard metrics require active site, plot, and census selections.'
  });

  if (!validation.success) {
    // Try to use URL parameters as fallback
    if (schemaParam && plotIDParam && censusIDParam) {
      const plotID = parseInt(plotIDParam);
      const censusID = parseInt(censusIDParam);

      if (isNaN(plotID) || isNaN(censusID)) {
        return NextResponse.json({ error: 'Invalid plot ID or census ID parameters' }, { status: HTTPResponses.BAD_REQUEST });
      }

      // Continue with URL parameters
      return await processMetrics(metric, schemaParam, plotID, censusID, plotName);
    }
    return validation.response!;
  }

  const { schema, plotID, censusID } = validation.values!;
  return await processMetrics(metric, schema!, plotID!, censusID!, plotName);
}

async function processMetrics(metric: string, schema: string, plotID: number, censusID: number, _plotName: string): Promise<NextResponse> {
  const connectionManager = ConnectionManager.getInstance();

  // count active users?
  // files uploaded?
  // number of stems
  // number of trees
  // postvalidationstatistics?

  let query = '';

  try {
    switch (metric) {
      case 'CountActiveUsers':
        query = `SELECT COUNT(p.PersonnelID) as PersonnelCount FROM ${schema}.personnel p
                    JOIN ${schema}.censusactivepersonnel cap ON p.PersonnelID = cap.PersonnelID
                    JOIN ${schema}.census c ON c.CensusID = cap.CensusID
                  WHERE c.CensusID = ? AND c.PlotID = ?`;
        const cauResults = await connectionManager.executeQuery(query, [censusID, plotID]);
        return NextResponse.json({ CountActiveUsers: cauResults[0]?.PersonnelCount ?? 0 }, { status: HTTPResponses.OK });
      case 'ProgressTachometer':
        query = `
          WITH measured_quads AS (
            SELECT DISTINCT s.QuadratID
            FROM ${schema}.coremeasurements cm
            JOIN ${schema}.stems s ON cm.StemGUID = s.StemGUID
            JOIN ${schema}.quadrats q2 ON s.QuadratID = q2.QuadratID
            WHERE cm.CensusID = ? AND q2.PlotID = ?
          )
          SELECT
            COUNT(*) AS total_quadrats,
            COUNT(mq.QuadratID) AS populated_quadrats,
            ROUND(COUNT(mq.QuadratID) / NULLIF(COUNT(*),0) * 100, 2) AS populated_pct,
            GROUP_CONCAT(CASE WHEN mq.QuadratID IS NULL THEN q.QuadratName END ORDER BY q.QuadratName SEPARATOR ';') AS unpopulated_quadrats
          FROM ${schema}.quadrats q
          LEFT JOIN measured_quads mq ON mq.QuadratID = q.QuadratID
          WHERE q.PlotID = ? GROUP BY q.PlotID;`;
        const ptResults = await connectionManager.executeQuery(query, [censusID, plotID, plotID]);
        return NextResponse.json({
          TotalQuadrats: ptResults[0]?.total_quadrats ?? 0,
          PopulatedQuadrats: ptResults[0]?.populated_quadrats ?? 0,
          PopulatedPercent: ptResults[0]?.populated_pct ?? 0,
          UnpopulatedQuadrats: ptResults[0]?.unpopulated_quadrats ?? ''
        });
      // case 'FilesUploaded':
      //   if (!process.env.AZURE_STORAGE_CONNECTION_STRING) return NextResponse.json({ FilesUploaded: [] }, { status: HTTPResponses.SERVICE_UNAVAILABLE });
      //   const blobData: any = [];
      //   let i = 0;
      //   const containerClient = await getContainerClient(`${plotName}-${censusID}`);
      //   const listOptions = {
      //     includeMetadata: true,
      //     includeVersions: false
      //   };
      //   for await (const blob of containerClient?.listBlobsFlat(listOptions) ?? []) {
      //     if (!blob) ailogger.error('blob is undefined');
      //     blobData.push({
      //       key: ++i,
      //       name: blob.name,
      //       user: blob.metadata?.user,
      //       formType: blob.metadata?.FormType,
      //       fileErrors: blob.metadata?.FileErrorState ? JSON.parse(blob.metadata?.FileErrorState as string) : '',
      //       date: blob.properties.lastModified
      //     });
      //   }
      //   return NextResponse.json({ FilesUploaded: blobData }, { status: HTTPResponses.OK });
      case 'CountTrees':
        query = `SELECT COUNT(t.TreeID) AS CountTrees FROM ${schema}.trees t JOIN ${schema}.census c ON t.CensusID = c.CensusID WHERE t.CensusID = ? AND c.PlotID = ?`;
        const ctResults = await connectionManager.executeQuery(query, [censusID, plotID]);
        return NextResponse.json({ CountTrees: ctResults[0]?.CountTrees ?? 0 }, { status: HTTPResponses.OK });
      case 'CountStems':
        query = `SELECT COUNT(st.StemGUID)AS CountStems FROM ${schema}.stems st JOIN ${schema}.census c ON st.CensusID = c.CensusID WHERE st.CensusID = ? AND c.PlotID = ?`;
        const csResults = await connectionManager.executeQuery(query, [censusID, plotID]);
        return NextResponse.json({ CountStems: csResults[0]?.CountStems ?? 0 }, { status: HTTPResponses.OK });
      case 'StemTypes':
        // First check if previous census exists (fast path for first census)
        const prevCensusQuery = `SELECT MAX(c.CensusID) as PrevCensusID FROM ${schema}.census c WHERE c.PlotID = ? AND c.CensusID < ?`;
        const prevCensusResult = await connectionManager.executeQuery(prevCensusQuery, [plotID, censusID]);
        const previousCensusID = prevCensusResult[0]?.PrevCensusID;

        if (!previousCensusID) {
          // First census: all measured stems are new recruits
          const countQuery = `SELECT COUNT(DISTINCT s.StemGUID) as CountNewRecruits
            FROM ${schema}.coremeasurements cm
            JOIN ${schema}.stems s ON cm.StemGUID = s.StemGUID
            WHERE cm.CensusID = ? AND s.CensusID = ?`;
          const countResult = await connectionManager.executeQuery(countQuery, [censusID, censusID]);
          return NextResponse.json(
            { CountOldStems: 0, CountMultiStems: 0, CountNewRecruits: countResult[0]?.CountNewRecruits || 0 },
            { status: HTTPResponses.OK }
          );
        }

        // Subsequent census: use optimized comparison query with explicit census ID
        query = `
          WITH measured_stems AS (
            SELECT DISTINCT s.StemGUID, t.TreeTag, s.StemTag
            FROM ${schema}.coremeasurements cm
            JOIN ${schema}.stems s ON cm.StemGUID = s.StemGUID
            JOIN ${schema}.trees t ON s.TreeID = t.TreeID
            WHERE cm.CensusID = ? AND s.CensusID = ?
          ),
          previous_stems AS (
            SELECT t_prev.TreeTag, s_prev.StemTag
            FROM ${schema}.trees t_prev
            JOIN ${schema}.stems s_prev ON s_prev.TreeID = t_prev.TreeID
            WHERE t_prev.CensusID = ? AND s_prev.CensusID = ?
              AND t_prev.IsActive = 1 AND s_prev.IsActive = 1
          ),
          previous_trees AS (
            SELECT DISTINCT t_prev.TreeTag
            FROM ${schema}.trees t_prev
            WHERE t_prev.CensusID = ? AND t_prev.IsActive = 1
          )
          SELECT
            COALESCE(SUM(CASE WHEN ps.TreeTag IS NOT NULL THEN 1 ELSE 0 END), 0) as CountOldStems,
            COALESCE(SUM(CASE WHEN ps.TreeTag IS NULL AND pt.TreeTag IS NOT NULL THEN 1 ELSE 0 END), 0) as CountMultiStems,
            COALESCE(SUM(CASE WHEN ps.TreeTag IS NULL AND pt.TreeTag IS NULL THEN 1 ELSE 0 END), 0) as CountNewRecruits
          FROM measured_stems ms
          LEFT JOIN previous_stems ps ON ms.TreeTag = ps.TreeTag AND ms.StemTag = ps.StemTag
          LEFT JOIN previous_trees pt ON ms.TreeTag = pt.TreeTag
        `;
        const stResults = await connectionManager.executeQuery(query, [censusID, censusID, previousCensusID, previousCensusID, previousCensusID]);
        return NextResponse.json(
          {
            CountOldStems: stResults[0]?.CountOldStems ?? 0,
            CountMultiStems: stResults[0]?.CountMultiStems ?? 0,
            CountNewRecruits: stResults[0]?.CountNewRecruits ?? 0
          },
          { status: HTTPResponses.OK }
        );
      default:
        return NextResponse.json({}, { status: HTTPResponses.OK });
    }
  } catch (e: any) {
    ailogger.error('Dashboard metrics error:', e);
    return NextResponse.json({ error: 'Failed to retrieve metrics', details: e.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
