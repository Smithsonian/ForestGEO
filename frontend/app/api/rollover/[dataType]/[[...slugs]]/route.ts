import { HTTPResponses } from '@/config/macros';
import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';

/**
 * Handles the POST request for the rollover API endpoint, which allows users to roll over quadrat or personnel data from one census to another within a specified schema.
 *
 * @param request - The NextRequest object containing the incoming request data.
 * @param params - The route parameters, including the `dataType` (either 'quadrats' or 'personnel') and the `slugs` (an array containing the schema, plotID, sourceCensusID, and newCensusID).
 * @returns A NextResponse with a success message or an error message, along with the appropriate HTTP status code.
 */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ dataType: string; slugs?: string[] }> }
) {
  const params = await props.params;
  if (!params.slugs) throw new Error('slugs not provided');
  const [schema, plotID, sourceCensusID, newCensusID] = params.slugs;
  if (!schema || !plotID || !sourceCensusID || !newCensusID) throw new Error('no schema or plotID or censusID provided');

  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;
  try {
    const { incoming } = await request.json();
    if (!Array.isArray(incoming) || incoming.length === 0) throw new Error('No quadrat or personnel IDs provided');

    let query = ``;
    let queryParams = [];

    transactionID = await connectionManager.beginTransaction();

    switch (params.dataType) {
      case 'quadrats':
        query = `
          INSERT INTO ${schema}.censusquadrat (CensusID, QuadratID)
          SELECT ?, q.QuadratID
          FROM ${schema}.quadrats q
          WHERE q.QuadratID IN (${incoming.map(() => '?').join(', ')});`;
        queryParams = [Number(newCensusID), ...incoming];
        await connectionManager.executeQuery(query, queryParams);
        break;
      case 'personnel':
        query = `
          INSERT INTO ${schema}.personnel (CensusID, FirstName, LastName, RoleID)
          SELECT 
              ?, 
              FirstName, 
              LastName, 
              RoleID
          FROM ${schema}.personnel
          WHERE CensusID = ? AND PersonnelID IN (${incoming.map(() => '?').join(', ')});`;
        queryParams = [Number(newCensusID), Number(sourceCensusID), ...incoming];
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
