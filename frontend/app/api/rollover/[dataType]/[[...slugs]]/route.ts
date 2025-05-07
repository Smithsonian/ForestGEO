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
        if (incoming.length !== 0) {
          query = `
          INSERT IGNORE INTO ${schema}.censusquadrats (CensusID, QuadratID)
          SELECT ?, q.QuadratID
          FROM ${schema}.quadrats q
          WHERE q.IsActive IS TRUE AND q.QuadratID IN (${incoming.map(() => '?').join(', ')});`;
          queryParams = [Number(newCensusID), ...incoming];
        } else {
          query = `INSERT IGNORE ${schema}.censusquadrats (CensusID, QuadratID)
          SELECT ?, q.QuadratID 
          FROM ${schema}.quadrats q
          JOIN ${schema}.censusquadrats cq ON cq.QuadratID = q.QuadratID
          JOIN ${schema}.census c ON cq.CensusID = c.CensusID 
          WHERE q.IsActive IS TRUE AND c.IsActive IS TRUE AND c.CensusID = ?;`;
          queryParams = [Number(newCensusID), Number(sourceCensusID)];
        }
        console.log('rollover query: ', format(query, queryParams));
        await connectionManager.executeQuery(query, queryParams);
        break;
      case 'personnel':
        if (incoming.length !== 0) {
          query = `
          INSERT IGNORE INTO ${schema}.censuspersonnel (CensusID, PersonnelID)
          SELECT ?, p.PersonnelID
          FROM ${schema}.personnel p
          WHERE p.IsActive IS TRUE AND p.PersonnelID IN (${incoming.map(() => '?').join(', ')});`;
          queryParams = [Number(newCensusID), ...incoming];
        } else {
          query = `INSERT IGNORE ${schema}.censuspersonnel (CensusID, PersonnelID)
          SELECT ?, p.PersonnelID 
          FROM ${schema}.personnel p
          JOIN ${schema}.censuspersonnel cp ON cp.PersonnelID = p.PersonnelID
          JOIN ${schema}.census c ON cp.CensusID = c.CensusID 
          WHERE p.IsActive IS TRUE AND c.IsActive IS TRUE AND c.CensusID = ?;`;
          queryParams = [Number(newCensusID), Number(sourceCensusID)];
        }
        await connectionManager.executeQuery(query, queryParams);
        break;
      case 'attributes':
        if (incoming.length !== 0) {
          query = `
          INSERT IGNORE INTO ${schema}.censusattributes (CensusID, AttributeID)
          SELECT ?, a.Code
          FROM ${schema}.attributes a
          WHERE a.Code IN (${incoming.map(() => '?').join(', ')});`;
          queryParams = [Number(newCensusID), ...incoming];
        } else {
          query = `INSERT IGNORE ${schema}.censusattributes (CensusID, Code)
          SELECT ?, a.Code
          FROM ${schema}.attributes a
          JOIN ${schema}.censusattributes ca ON ca.Code = a.Code
          JOIN ${schema}.census c ON ca.CensusID = c.CensusID 
          WHERE a.IsActive IS TRUE AND c.IsActive IS TRUE AND c.CensusID = ?;`;
          queryParams = [Number(newCensusID), Number(sourceCensusID)];
        }
        await connectionManager.executeQuery(query, queryParams);
        break;
      case 'species':
        if (incoming.length !== 0) {
          query = `INSERT IGNORE INTO ${schema}.censusspecies (CensusID, SpeciesID)
          SELECT ?, s.SpeciesID
          FROM ${schema}.species s
          WHERE s.SpeciesID IN (${incoming.map(() => '?').join(', ')});`;
          queryParams = [Number(newCensusID), ...incoming];
        } else {
          query = `INSERT IGNORE ${schema}.censusspecies (CensusID, SpeciesID)
          SELECT ?, s.SpeciesID
          FROM ${schema}.species s
          JOIN ${schema}.censusspecies cs ON cs.SpeciesID = s.SpeciesID
          JOIN ${schema}.census c ON cs.CensusID = c.CensusID 
          WHERE s.IsActive IS TRUE AND c.IsActive IS TRUE AND c.CensusID = ?;`;
          queryParams = [Number(newCensusID), Number(sourceCensusID)];
        }
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
