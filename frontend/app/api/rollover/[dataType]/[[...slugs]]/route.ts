import { HTTPResponses } from '@/config/macros';
import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { format } from 'mysql2/promise';

/**
 * Handles the POST request for the rollover API endpoint, which allows users to roll over quadrat or personnel data from one census to another within a specified schema.
 *
 * @param request - The NextRequest object containing the incoming request data.
 * @param props
 * @returns A NextResponse with a success message or an error message, along with the appropriate HTTP status code.
 */
export async function POST(request: NextRequest, props: { params: Promise<{ dataType: string; slugs?: string[] }> }) {
  const params = await props.params;
  if (!params.slugs) throw new Error('slugs not provided');
  const [schema, plotID, sourceCensusID, newCensusID] = params.slugs;
  if (!schema || !plotID || !sourceCensusID || !newCensusID) throw new Error('no schema or plotID or censusID provided');

  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;
  try {
    const { incoming } = await request.json();

    let query = ``;
    let queryParams = [];

    transactionID = await connectionManager.beginTransaction();

    switch (params.dataType) {
      case 'quadrats':
        query = `INSERT INTO ${schema}.censusquadrats (CensusID, QuadratID) 
        SELECT distinct ?, q.QuadratID
        from ${schema}.quadrats q                                                                                                    
        LEFT JOIN ${schema}.censusquadrats cq ON cq.QuadratID = q.QuadratID and cq.CensusID = ?
        WHERE q.PlotID = ? and q.IsActive is true AND cq.CQID IS NULL;`;
        queryParams = [Number(newCensusID), Number(newCensusID), Number(plotID)];
        console.log('rollover query: ', format(query, queryParams));
        await connectionManager.executeQuery(query, queryParams);
        break;
      case 'personnel':
        query = `INSERT IGNORE INTO ${schema}.censuspersonnel (CensusID, PersonnelID)
          SELECT distinct ?, p.PersonnelID 
          FROM ${schema}.personnel p
          left join ${schema}.censuspersonnel cp ON cp.PersonnelID = p.PersonnelID and cp.CensusID = ?
          WHERE p.IsActive IS TRUE and cp.CPID IS NULL;`;
        queryParams = [Number(newCensusID), Number(newCensusID)];
        await connectionManager.executeQuery(query, queryParams);
        break;
      case 'attributes':
        query = `INSERT IGNORE INTO ${schema}.censusattributes (CensusID, Code)
          SELECT distinct ?, a.Code
          FROM ${schema}.attributes a
          left join ${schema}.censusattributes ca on ca.Code = a.Code and ca.CensusID = ?
          WHERE a.IsActive IS TRUE and ca.CAID is null`;
        queryParams = [Number(newCensusID), Number(newCensusID)];
        await connectionManager.executeQuery(query, queryParams);
        break;
      case 'species':
        query = `INSERT IGNORE INTO ${schema}.censusspecies (CensusID, SpeciesID)
          SELECT distinct ?, s.SpeciesID
          FROM ${schema}.species s
          left join ${schema}.censusspecies cs on cs.SpeciesID = s.SpeciesID and cs.CensusID = ?
          WHERE s.IsActive IS TRUE and cs.CSID is null;`;
        queryParams = [Number(newCensusID), Number(newCensusID)];
        await connectionManager.executeQuery(query, queryParams);
        break;
      default:
        throw new Error('Invalid data type');
    }
    await connectionManager.commitTransaction(transactionID ?? '');
    return new NextResponse(JSON.stringify({ message: 'Rollover successful' }), { status: HTTPResponses.OK });
  } catch (error: any) {
    await connectionManager.rollbackTransaction(transactionID ?? '');
    console.error('Error in rollover API:', error.message);
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: 500
    });
  } finally {
    await connectionManager.closeConnection();
  }
}
