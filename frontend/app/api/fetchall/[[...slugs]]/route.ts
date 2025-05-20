import { NextRequest, NextResponse } from 'next/server';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import { cookies } from 'next/headers';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';

const buildQuery = (schema: string, fetchType: string, plotID?: string, plotCensusNumber?: string, quadratID?: string): string => {
  if (fetchType === 'plots') {
    return `
        SELECT p.*,
               COUNT(q.QuadratID) AS NumQuadrats
        FROM ${schema}.plots p
                 LEFT JOIN
             ${schema}.quadrats q ON p.PlotID = q.PlotID and q.IsActive IS TRUE
        GROUP BY p.PlotID
            ${plotID && plotID !== 'undefined' && !isNaN(parseInt(plotID)) ? `HAVING p.PlotID = ${plotID}` : ''}`;
  } else if (fetchType === 'roles') {
    return `SELECT *
                 FROM ${schema}.${fetchType}`;
  } else if (fetchType === 'quadrats') {
    return `
      SELECT * FROM ${schema}.quadrats q
        JOIN ${schema}.censusquadrats cq ON cq.QuadratID = q.QuadratID
        JOIN ${schema}.census c ON cq.CensusID = c.CensusID
        WHERE q.IsActive IS TRUE AND q.PlotID = ${plotID} AND c.PlotID = ${plotID} AND c.PlotCensusNumber = ${plotCensusNumber}`;
  } else {
    let query = `SELECT *
                 FROM ${schema}.${fetchType}`;
    const conditions = [];

    if (plotID && plotID !== 'undefined' && !isNaN(parseInt(plotID)) && fetchType !== 'personnel') {
      conditions.push(`PlotID = ${plotID}`);
    }
    if (plotCensusNumber && plotCensusNumber !== 'undefined' && !isNaN(parseInt(plotCensusNumber))) {
      conditions.push(`CensusID IN (SELECT c.CensusID FROM ${schema}.census c WHERE c.PlotID = ${plotID} AND c.PlotCensusNumber = ${plotCensusNumber})`);
    }
    if (quadratID && quadratID !== 'undefined' && !isNaN(parseInt(quadratID))) {
      conditions.push(`QuadratID = ${quadratID}`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    return query;
  }
};

// ordering: PCQ
export async function GET(request: NextRequest, props: { params: Promise<{ slugs?: string[] }> }) {
  const params = await props.params;
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema || schema === 'undefined') {
    throw new Error('Schema selection was not provided to API endpoint');
  }

  const [dataType] = params.slugs ?? [];
  if (!dataType) {
    throw new Error('fetchType was not correctly provided');
  }

  const cookieStore = await cookies();
  const storedCensusList: OrgCensus[] = JSON.parse(cookieStore.get('censusList')?.value ?? JSON.stringify([]));
  const storedPlotID = parseInt(cookieStore.get('plotID')?.value ?? '0');
  const storedQuadratID = parseInt(cookieStore.get('quadratID')?.value ?? '0');
  const storedPCN =
    storedCensusList.find(
      (oc): oc is OrgCensus => oc !== undefined && oc.dateRanges.some(dr => dr.censusID === parseInt(cookieStore.get('censusID')?.value ?? '0'))
    )?.plotCensusNumber ?? 0;

  const query = buildQuery(schema, dataType, String(storedPlotID), String(storedPCN), String(storedQuadratID));
  const connectionManager = ConnectionManager.getInstance();

  function getGridID(gridType: string): string {
    switch (gridType.trim()) {
      case 'attributes':
        return 'Code';
      case 'personnel':
        return 'PersonnelID';
      case 'quadrats':
        return 'QuadratID';
      case 'alltaxonomiesview':
      case 'species':
        return 'SpeciesID';
      default:
        return 'breakage';
    }
  }

  try {
    let results: any;
    if (['personnel', 'quadrats', 'species', 'attributes'].includes(dataType)) {
      const query = `SELECT dt.* FROM ${schema}.${dataType} dt
        JOIN ${schema}.census${dataType} cdt ON dt.${getGridID(dataType)} = cdt.${getGridID(dataType)}
        JOIN ${schema}.census c ON cdt.CensusID = c.CensusID and c.IsActive IS TRUE
        WHERE dt.IsActive IS TRUE and c.PlotID = ? AND c.PlotCensusNumber = ?`;
      results = await connectionManager.executeQuery(query, [storedPlotID, storedPCN]);
    } else if (dataType === 'stems') {
      const query = `SELECT st.* FROM ${schema}.stems st 
      JOIN ${schema}.quadrats q ON q.QuadratID = st.QuadratID and q.IsActive IS TRUE
      JOIN ${schema}.censusquadrats cq ON cq.QuadratID = q.QuadratID
      JOIN ${schema}.census c ON c.CensusID = cq.CensusID and c.IsActive IS TRUE
      WHERE st.IsActive IS TRUE and c.PlotID = ? AND c.PlotCensusNumber = ?`;
      results = await connectionManager.executeQuery(query, [storedPlotID, storedPCN]);
    } else if (dataType === 'trees') {
      const query = `SELECT t.* from ${schema}.trees t 
      JOIN ${schema}.stems s ON t.TreeID = s.TreeID AND s.IsActive IS TRUE
      JOIN ${schema}.quadrats q ON q.QuadratID = s.QuadratID and q.IsActive IS TRUE
      JOIN ${schema}.censusquadrats cq ON cq.QuadratID = q.QuadratID
      JOIN ${schema}.census c ON c.CensusID = cq.CensusID and c.IsActive IS TRUE
      WHERE t.IsActive IS TRUE and c.PlotID = ? AND c.PlotCensusNumber = ?`;
      results = await connectionManager.executeQuery(query, [storedPlotID, storedPCN]);
    } else if (dataType === 'roles' || dataType === 'postvalidationqueries') {
      const query = `SELECT * FROM ${schema}.${dataType}`;
      results = await connectionManager.executeQuery(query);
    } else if (dataType === 'plots') {
      const query = `
        SELECT p.*, COUNT(q.QuadratID) AS NumQuadrats
        FROM ${schema}.plots p 
        LEFT JOIN ${schema}.quadrats q ON p.PlotID = q.PlotID and q.IsActive IS TRUE
        GROUP BY p.PlotID`;
      results = await connectionManager.executeQuery(query);
    } else if (dataType === 'census') {
      const query = `SELECT * FROM ${schema}.census WHERE PlotID = ? AND IsActive IS TRUE`;
      results = await connectionManager.executeQuery(query, [storedPlotID]);
    } else {
      results = await connectionManager.executeQuery(query);
    }
    return new NextResponse(JSON.stringify(MapperFactory.getMapper<any, any>(dataType).mapData(results)), { status: HTTPResponses.OK });
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Call failed');
  } finally {
    await connectionManager.closeConnection();
  }
}
