import { NextRequest, NextResponse } from 'next/server';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';

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
  } else if (fetchType === 'roles' || fetchType === 'attributes') {
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

  const [dataType, plotID, plotCensusNumber, quadratID] = params.slugs ?? [];
  if (!dataType) {
    throw new Error('fetchType was not correctly provided');
  }

  const plotIDTrimmed = plotID === 'undefined' ? undefined : plotID;
  const plotCensusNumberTrimmed = plotCensusNumber === 'undefined' ? undefined : plotCensusNumber;
  const quadratIDTrimmed = quadratID === 'undefined' ? undefined : quadratID;

  const query = buildQuery(schema, dataType, plotIDTrimmed, plotCensusNumberTrimmed, quadratIDTrimmed);
  const connectionManager = ConnectionManager.getInstance();

  try {
    let results: any;
    if (dataType === 'personnel') {
      const query = `SELECT p.* FROM ${schema}.personnel p 
      JOIN ${schema}.censuspersonnel cp ON cp.PersonnelID = p.PersonnelID
      JOIN ${schema}.census c ON cp.CensusID = c.CensusID and c.IsActive is true
      WHERE p.IsActive IS TRUE AND c.PlotID = ? AND c.PlotCensusNumber = ?`;
      results = await connectionManager.executeQuery(query, [plotIDTrimmed, plotCensusNumberTrimmed]);
    } else if (dataType === 'roles') {
      const query = `SELECT * FROM ${schema}.roles`;
      results = await connectionManager.executeQuery(query);
    } else if (dataType === 'species') {
      const query = `SELECT s.* FROM ${schema}.species s 
      JOIN ${schema}.censusspecies cs ON cs.SpeciesID = s.SpeciesID
      JOIN ${schema}.census c ON cs.CensusID = c.CensusID
      WHERE s.IsActive is true and c.IsActive is true and c.PlotID = ? and c.PlotCensusNumber = ?`;
      results = await connectionManager.executeQuery(query, [plotIDTrimmed, plotCensusNumberTrimmed]);
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
