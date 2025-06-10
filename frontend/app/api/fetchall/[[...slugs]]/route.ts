import { NextRequest, NextResponse } from 'next/server';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';
import { getCookie } from '@/app/actions/cookiemanager';

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

  let storedCensusList: OrgCensus[];
  let storedPlotID: number;
  let storedPCN: number;

  try {
    storedCensusList = JSON.parse((await getCookie('censusList')) ?? JSON.stringify([]));
    storedPlotID = parseInt((await getCookie('plotID')) ?? '0');
    storedPCN =
      storedCensusList.find(
        (oc): oc is OrgCensus => oc !== undefined && oc.dateRanges.some(async dr => dr.censusID === parseInt((await getCookie('censusID')) ?? '0'))
      )?.plotCensusNumber ?? 0;
  } catch (e) {
    // system either hasn't populated the cookie yet or something else has happened. either way, shouldn't break anything here.
    storedCensusList = [];
    storedPlotID = 0;
    storedPCN = 0;
  }

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

  function getGridVersionID(gridType: string): string {
    switch (gridType.trim()) {
      case 'attributes':
        return 'AttributesVersioningID';
      case 'personnel':
        return 'PersonnelVersioningID';
      case 'quadrats':
        return 'QuadratsVersioningID';
      case 'species':
        return 'SpeciesVersioningID';
      default:
        return 'breakage';
    }
  }

  try {
    let results: any;
    if (['personnel', 'quadrats', 'species', 'attributes'].includes(dataType)) {
      // versioning has been added for the testing schema. gonna test against this:
      const storedMax = storedCensusList?.filter(c => c !== undefined)?.reduce((prev, curr) => (curr.plotCensusNumber > prev.plotCensusNumber ? curr : prev));
      const isCensusMax = storedPCN === storedMax?.plotCensusNumber;
      const query = `SELECT dtv.* FROM ${schema}.${dataType}versioning dtv
        JOIN ${schema}.census${dataType} cdt ON dtv.${getGridVersionID(dataType)} = cdt.${getGridVersionID(dataType)}
        JOIN ${schema}.census c ON cdt.CensusID = c.CensusID and c.IsActive IS TRUE
        ${isCensusMax ? ` JOIN ${schema}.${dataType} dtmaster ON dtmaster.${getGridID(dataType)} = dtv.${getGridID(dataType)} AND dtmaster.IsActive IS TRUE` : ''}
        WHERE c.PlotID = ? AND c.PlotCensusNumber = ?`;
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
      const query = `SELECT * FROM ${schema}.${dataType}`;
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
