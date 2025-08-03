import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { getContainerClient } from '@/config/macros/azurestorage';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';

export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{ metric: string; schema: string; plotIDParam: string; censusIDParam: string }>;
  }
) {
  const { metric, schema, plotIDParam, censusIDParam } = await props.params;
  const plotName = request.nextUrl.searchParams.get('plot');
  if (!metric || !schema || !plotIDParam || !censusIDParam || !plotName) throw new Error('Missing core slugs');
  const plotID = parseInt(plotIDParam);
  const censusID = parseInt(censusIDParam);
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
        const cauResults = (await connectionManager.executeQuery(query, [censusID, plotID]))[0].PersonnelCount;
        return NextResponse.json({ CountActiveUsers: cauResults }, { status: HTTPResponses.OK });
      case 'ProgressTachometer':
        query = `
          WITH measured_quads AS (
            SELECT DISTINCT s.QuadratID
            FROM ${schema}.coremeasurements cm
            JOIN ${schema}.stems s ON cm.StemID = s.StemID
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
          TotalQuadrats: ptResults[0].total_quadrats,
          PopulatedQuadrats: ptResults[0].populated_quadrats,
          PopulatedPercent: ptResults[0].populated_pct,
          UnpopulatedQuadrats: ptResults[0].unpopulated_quadrats
        });
      case 'FilesUploaded':
        const blobData: any = [];
        let i = 0;
        const containerClient = await getContainerClient(`${plotName}-${censusID}`);
        const listOptions = {
          includeMetadata: true,
          includeVersions: false
        };
        for await (const blob of containerClient?.listBlobsFlat(listOptions) ?? []) {
          if (!blob) ailogger.error('blob is undefined');
          blobData.push({
            key: ++i,
            name: blob.name,
            user: blob.metadata?.user,
            formType: blob.metadata?.FormType,
            fileErrors: blob.metadata?.FileErrorState ? JSON.parse(blob.metadata?.FileErrorState as string) : '',
            date: blob.properties.lastModified
          });
        }
        return NextResponse.json({ FilesUploaded: blobData }, { status: HTTPResponses.OK });
      case 'CountTrees':
        query = `SELECT COUNT(t.TreeID) AS CountTrees FROM ${schema}.trees t JOIN ${schema}.census c ON t.CensusID = c.CensusID WHERE t.CensusID = ? AND c.PlotID = ?`;
        const ctResults = await connectionManager.executeQuery(query, [censusID, plotID]);
        return NextResponse.json({ CountTrees: ctResults[0].CountTrees }, { status: HTTPResponses.OK });
      case 'CountStems':
        query = `SELECT COUNT(st.StemID)AS CountStems FROM ${schema}.stems st JOIN ${schema}.census c ON st.CensusID = c.CensusID WHERE st.CensusID = ? AND c.PlotID = ?`;
        const csResults = await connectionManager.executeQuery(query, [censusID, plotID]);
        return NextResponse.json({ CountStems: csResults[0].CountStems }, { status: HTTPResponses.OK });
      default:
        return NextResponse.json({}, { status: HTTPResponses.OK });
    }
  } catch (e) {
    return NextResponse.json({}, { status: HTTPResponses.INVALID_REQUEST });
  }
}
