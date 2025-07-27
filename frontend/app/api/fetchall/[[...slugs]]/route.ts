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
    storedPlotID = 0;
    storedPCN = 0;
  }

  const connectionManager = ConnectionManager.getInstance();
  try {
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
