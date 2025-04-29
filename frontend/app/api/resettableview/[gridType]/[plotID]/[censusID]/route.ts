import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';

export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{ gridType: string; plotID: string; censusID: string }>;
  }
) {
  const { gridType, plotID, censusID } = await props.params;
  if (!gridType || !plotID || !censusID) throw new Error('missing core params');
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('schema was not provided');
  const connectionManager = ConnectionManager.getInstance();
  let transactionID = '';
  try {
    transactionID = await connectionManager.beginTransaction();
    switch (gridType) {
      case 'alltaxonomiesview':
        await connectionManager.executeQuery(`update ${schema}.trees set SpeciesID = null;`);
        await connectionManager.executeQuery('set foreign_key_checks = 0;');
        await connectionManager.executeQuery(`truncate ${schema}.species`);
        await connectionManager.executeQuery(`truncate ${schema}.genus`);
        await connectionManager.executeQuery(`truncate ${schema}.family`);
        await connectionManager.executeQuery('set foreign_key_checks = 1;');
        break;
      case 'quadrats':
        await connectionManager.executeQuery(``);
        break;
      case 'attributes':
        break;
      case 'personnel':
        break;
    }
    await connectionManager.commitTransaction(transactionID);
    return NextResponse.json({ message: 'Species reset completed' }, { status: HTTPResponses.OK });
  } catch (e) {
    await connectionManager.rollbackTransaction(transactionID);
    throw e;
  }
}
