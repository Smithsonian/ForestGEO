import { NextRequest, NextResponse } from 'next/server';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';
import { validateContextualValues } from '@/lib/contextvalidation';
import { getCookie } from '@/app/actions/cookiemanager';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// ordering: PCQ
export async function GET(request: NextRequest, props: { params: Promise<{ slugs?: string[] }> }) {
  const params = await props.params;
  const [dataType, plotIDParam, pcnParam] = params.slugs ?? [];

  // Validate contextual values first
  const validation = await validateContextualValues(request, {
    requireSchema: true,
    requirePlot: dataType === 'stems' || dataType === 'trees' || dataType === 'personnel' || dataType === 'census',
    requireCensus: dataType === 'stems' || dataType === 'trees' || dataType === 'personnel',
    allowFallback: true,
    fallbackMessage: `Data type '${dataType}' requires active site/plot/census selections.`
  });

  if (!validation.success) {
    return validation.response!;
  }

  const { schema, plotID: storedPlotID, censusID } = validation.values!;

  // Get additional context values for specific operations
  let storedCensusList: OrgCensus[];
  let storedPCN: number = parseInt(pcnParam);

  try {
    storedCensusList = JSON.parse((await getCookie('censusList')) ?? JSON.stringify([]));
    storedPCN =
      storedCensusList.find((oc): oc is OrgCensus => oc !== undefined && oc.dateRanges.some(dr => dr.censusID === censusID))?.plotCensusNumber ??
      parseInt(pcnParam) ??
      0;
  } catch (e: any) {
    ailogger.warn('Failed to parse census list from cookies', e);
  }

  const connectionManager = ConnectionManager.getInstance();
  try {
    if (!dataType) {
      return NextResponse.json({ error: 'Data type not specified in request parameters' }, { status: HTTPResponses.BAD_REQUEST });
    }
    let results: any;
    if (dataType === 'stems' || dataType === 'trees') {
      const query = `SELECT st.* FROM ${schema}.${dataType} st 
      JOIN ${schema}.census c ON c.CensusID = st.CensusID and c.IsActive IS TRUE
      WHERE st.IsActive IS TRUE and c.PlotID = ? AND c.PlotCensusNumber = ?`;
      results = await connectionManager.executeQuery(query, [storedPlotID, storedPCN]);
    } else if (dataType === 'plots') {
      const query = `
        SELECT p.*, COUNT(q.QuadratID) AS NumQuadrats
        FROM ${schema}.plots p 
        LEFT JOIN ${schema}.quadrats q ON p.PlotID = q.PlotID and q.IsActive IS TRUE
        GROUP BY p.PlotID`;
      results = await connectionManager.executeQuery(query);
    } else if (dataType === 'personnel') {
      const query = `SELECT p.*, EXISTS( 
        SELECT 1 FROM ${schema}.censusactivepersonnel cap 
          JOIN ${schema}.census c ON cap.CensusID = c.CensusID 
          WHERE cap.PersonnelID = p.PersonnelID 
            AND c.PlotCensusNumber = ? and c.PlotID = ? 
        ) AS CensusActive 
      FROM ${schema}.personnel p;`;
      results = await connectionManager.executeQuery(query, [storedPCN, storedPlotID]);
    } else if (dataType === 'census') {
      // Optionally, run a combined query to update census dates
      const updateQuery = `UPDATE ${schema}.census c
            JOIN (SELECT c1.PlotCensusNumber,
                         MIN(cm.MeasurementDate) AS FirstMeasurementDate,
                         MAX(cm.MeasurementDate) AS LastMeasurementDate
                  FROM ${schema}.coremeasurements cm
                         JOIN ${schema}.census c1 ON cm.CensusID = c1.CensusID
                  GROUP BY c1.PlotCensusNumber) m ON c.PlotCensusNumber = m.PlotCensusNumber
          SET c.StartDate = m.FirstMeasurementDate,
              c.EndDate   = m.LastMeasurementDate;`;
      await connectionManager.executeQuery(updateQuery);
      const query = `SELECT * FROM ${schema}.census WHERE PlotID = ?`;
      results = await connectionManager.executeQuery(query, [storedPlotID]);
    } else {
      const query = `SELECT * FROM ${schema}.${dataType}`;
      results = await connectionManager.executeQuery(query);
    }
    return new NextResponse(JSON.stringify(MapperFactory.getMapper<any, any>(dataType).mapData(results)), { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Error:', error);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
