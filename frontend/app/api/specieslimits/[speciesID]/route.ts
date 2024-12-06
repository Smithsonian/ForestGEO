import { NextRequest, NextResponse } from 'next/server';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';

export async function GET(request: NextRequest, { params }: { params: { speciesID: string } }) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('Schema not provided');
  if (params.speciesID === 'undefined') throw new Error('SpeciesID not provided');

  const connectionManager = ConnectionManager.getInstance();
  try {
    const query = `SELECT * FROM ${schema}.specieslimits WHERE SpeciesID = ?`;
    const results = await connectionManager.executeQuery(query, [params.speciesID]);
    return new NextResponse(JSON.stringify(MapperFactory.getMapper<any, any>('specieslimits').mapData(results)), { status: HTTPResponses.OK });
  } catch (error: any) {
    throw new Error(error);
  } finally {
    await connectionManager.closeConnection();
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { speciesID: string } }) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('Schema not provided');
  if (params.speciesID === 'undefined') throw new Error('SpeciesID not provided');
  const { newRow } = await request.json();
  const connectionManager = ConnectionManager.getInstance();
  try {
    await connectionManager.beginTransaction();
    const newRowData = MapperFactory.getMapper<any, any>('specieslimits').demapData([newRow])[0];
    const { ['SpeciesLimitID']: gridIDKey, ...remainingProperties } = newRowData;
    const query = `UPDATE ${schema}.specieslimits SET ? WHERE ?? = ?`;
    await connectionManager.executeQuery(query, [remainingProperties, 'SpeciesLimitID', gridIDKey]);
    return new NextResponse(null, { status: HTTPResponses.OK });
  } catch (e: any) {
    await connectionManager.rollbackTransaction();
    throw new Error(e);
  } finally {
    await connectionManager.closeConnection();
  }
}
