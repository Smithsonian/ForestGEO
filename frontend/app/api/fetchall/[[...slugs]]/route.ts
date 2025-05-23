import { NextRequest, NextResponse } from 'next/server';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import { cookies } from 'next/headers';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';

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
  const storedPCN =
    storedCensusList.find(
      (oc): oc is OrgCensus => oc !== undefined && oc.dateRanges.some(dr => dr.censusID === parseInt(cookieStore.get('censusID')?.value ?? '0'))
    )?.plotCensusNumber ?? 0;

  const connectionManager = ConnectionManager.getInstance();

  function getGridID(gridType: string): string {
    switch (gridType.trim()) {
      case 'attributes':
        return 'AttributeID';
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
    if (['personnel', 'quadrats', 'species', 'attributes', 'stems'].includes(dataType)) {
      const query = `SELECT dt.* from ${schema}.${dataType} dt
        JOIN ${schema}.census${dataType} cdt ON dt.${getGridID(dataType)} = cdt.${getGridID(dataType)}
        JOIN ${schema}.census c ON cdt.CensusID = c.CensusID
        WHERE c.PlotID = ? AND c.PlotCensusNumber = ?`;
      results = await connectionManager.executeQuery(query, [storedPlotID, storedPCN]);
    } else if (dataType === 'trees') {
      const query = `SELECT t.* from ${schema}.trees t 
      JOIN ${schema}.stems s ON t.TreeID = s.TreeID 
      JOIN ${schema}.censusstems cst on cst.StemID = s.StemID
      JOIN ${schema}.census c ON c.CensusID = cst.CensusID
      WHERE c.PlotID = ? AND c.PlotCensusNumber = ?`;
      results = await connectionManager.executeQuery(query, [storedPlotID, storedPCN]);
    } else if (dataType === 'plots') {
      const query = `
        SELECT p.*, COUNT(q.QuadratID) AS NumQuadrats
        FROM ${schema}.plots p 
        LEFT JOIN ${schema}.quadrats q ON p.PlotID = q.PlotID 
        GROUP BY p.PlotID`;
      results = await connectionManager.executeQuery(query);
    } else if (dataType === 'census') {
      const query = `SELECT * FROM ${schema}.census WHERE PlotID = ?`;
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
