import { NextRequest, NextResponse } from 'next/server';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';
import { validateContextualValues } from '@/lib/contextvalidation';
import { getCookie } from '@/app/actions/cookiemanager';
import ailogger from '@/ailogger';
import { getErrorMessage, getErrorCode, errorMessageContains, toError } from '@/lib/errorhelpers';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value || value === 'undefined') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed;
}

// ordering: PCQ
export async function GET(request: NextRequest, props: { params: Promise<{ slugs?: string[] }> }) {
  const params = await props.params;
  const [dataType, plotIDParam, pcnParam] = params.slugs ?? [];
  const slugPlotID = parsePositiveInt(plotIDParam);
  const slugPCN = parsePositiveInt(pcnParam);

  // Validate contextual values first
  const validation = await validateContextualValues(request, {
    requireSchema: true,
    requirePlot: false,
    requireCensus: false,
    allowFallback: true,
    fallbackMessage: `Data type '${dataType}' requires active site/plot/census selections.`
  });

  if (!validation.success) {
    return validation.response!;
  }

  const { schema, plotID: storedPlotID, censusID } = validation.values!;
  const effectivePlotID = storedPlotID ?? slugPlotID;

  // Get additional context values for specific operations
  let storedCensusList: OrgCensus[] = [];
  let storedPCN = slugPCN ?? 0;

  try {
    storedCensusList = JSON.parse((await getCookie('censusList')) || '[]');
    storedPCN =
      storedCensusList.find((oc): oc is OrgCensus => oc !== undefined && oc.dateRanges.some(dr => dr.censusID === censusID))?.plotCensusNumber ?? slugPCN ?? 0;
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
      if (!effectivePlotID || !storedPCN) {
        return NextResponse.json(
          {
            error: `Data type '${dataType}' requires a valid plotID and plot census number.`,
            code: 'MISSING_PLOT_OR_CENSUS'
          },
          { status: HTTPResponses.BAD_REQUEST }
        );
      }
      const query = `SELECT st.* FROM ${schema}.${dataType} st 
      JOIN ${schema}.census c ON c.CensusID = st.CensusID and c.IsActive IS TRUE
      WHERE st.IsActive IS TRUE and c.PlotID = ? AND c.PlotCensusNumber = ?`;
      results = await connectionManager.executeQuery(query, [effectivePlotID, storedPCN]);
    } else if (dataType === 'plots') {
      const query = `
        SELECT p.*, COUNT(q.QuadratID) AS NumQuadrats
        FROM ${schema}.plots p 
        LEFT JOIN ${schema}.quadrats q ON p.PlotID = q.PlotID and q.IsActive IS TRUE
        GROUP BY p.PlotID`;
      results = await connectionManager.executeQuery(query);
    } else if (dataType === 'personnel') {
      if (!effectivePlotID || !storedPCN) {
        return NextResponse.json(
          {
            error: `Data type '${dataType}' requires a valid plotID and plot census number.`,
            code: 'MISSING_PLOT_OR_CENSUS'
          },
          { status: HTTPResponses.BAD_REQUEST }
        );
      }
      const query = `SELECT p.*, EXISTS( 
        SELECT 1 FROM ${schema}.censusactivepersonnel cap 
          JOIN ${schema}.census c ON cap.CensusID = c.CensusID 
          WHERE cap.PersonnelID = p.PersonnelID 
            AND c.PlotCensusNumber = ? and c.PlotID = ? 
        ) AS CensusActive 
      FROM ${schema}.personnel p;`;
      results = await connectionManager.executeQuery(query, [storedPCN, effectivePlotID]);
    } else if (dataType === 'census') {
      if (!effectivePlotID) {
        return NextResponse.json(
          {
            error: `Data type '${dataType}' requires a valid plotID.`,
            code: 'MISSING_PLOT'
          },
          { status: HTTPResponses.BAD_REQUEST }
        );
      }
      const query = `SELECT c.CensusID,
                            c.PlotID,
                            c.PlotCensusNumber,
                            COALESCE(m.FirstMeasurementDate, c.StartDate) AS StartDate,
                            COALESCE(m.LastMeasurementDate, c.EndDate) AS EndDate,
                            c.Description,
                            c.IsActive
                     FROM ${schema}.census c
                     LEFT JOIN (
                       SELECT cm.CensusID,
                              MIN(cm.MeasurementDate) AS FirstMeasurementDate,
                              MAX(cm.MeasurementDate) AS LastMeasurementDate
                       FROM ${schema}.coremeasurements cm
                       JOIN ${schema}.census c1 ON cm.CensusID = c1.CensusID
                       WHERE c1.PlotID = ?
                       GROUP BY cm.CensusID
                     ) m ON c.CensusID = m.CensusID
                     WHERE c.PlotID = ?
                     ORDER BY c.PlotCensusNumber DESC, c.CensusID DESC`;
      results = await connectionManager.executeQuery(query, [effectivePlotID, effectivePlotID]);
    } else {
      const query = `SELECT * FROM ${schema}.${dataType}`;
      results = await connectionManager.executeQuery(query);
    }
    return new NextResponse(JSON.stringify(MapperFactory.getMapper<any, any>(dataType).mapData(results)), { status: HTTPResponses.OK });
  } catch (error: unknown) {
    const errorObj = toError(error);
    ailogger.error('Error:', errorObj);

    // Provide user-friendly error messages for common database errors
    const errorMessage = getErrorMessage(error);
    const errorCode = getErrorCode(error);

    // Check for unknown database error (ER_BAD_DB_ERROR)
    if (errorCode === 'ER_BAD_DB_ERROR' || errorMessageContains(error, 'Unknown database')) {
      return new NextResponse(
        JSON.stringify({
          error: `The database for site '${schema}' does not exist or is not configured.`,
          details: 'Please contact an administrator to set up this site or select a different site.',
          code: 'DATABASE_NOT_FOUND'
        }),
        { status: HTTPResponses.BAD_REQUEST }
      );
    }

    // Check for table not found error
    if (errorCode === 'ER_NO_SUCH_TABLE' || errorMessageContains(error, "doesn't exist")) {
      return new NextResponse(
        JSON.stringify({
          error: `The requested data table '${dataType}' is not available for this site.`,
          details: 'The site database may not be fully configured.',
          code: 'TABLE_NOT_FOUND'
        }),
        { status: HTTPResponses.BAD_REQUEST }
      );
    }

    // Check for connection errors
    if (errorCode === 'ECONNREFUSED' || errorCode === 'ETIMEDOUT' || errorMessageContains(error, 'connect')) {
      return new NextResponse(
        JSON.stringify({
          error: 'Unable to connect to the database server.',
          details: 'Please try again later or contact support if the issue persists.',
          code: 'CONNECTION_ERROR'
        }),
        { status: HTTPResponses.SERVICE_UNAVAILABLE }
      );
    }

    return new NextResponse(JSON.stringify({ error: errorMessage }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
  } finally {
    await connectionManager.closeConnection();
  }
}
