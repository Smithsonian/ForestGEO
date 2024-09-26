import { NextRequest, NextResponse } from 'next/server';
import { PoolConnection } from 'mysql2/promise';
import { getConn, runQuery } from '@/components/processors/processormacros';
import MapperFactory from '@/config/datamapper';
import { HTTPResponses } from '@/config/macros';

export async function GET(request: NextRequest, { params }: { params: { speciesID: string } }) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('Schema not provided');
  if (params.speciesID === 'undefined') throw new Error('SpeciesID not provided');

  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    const query = `SELECT * FROM ${schema}.specieslimits WHERE SpeciesID = ?`;
    const results = await runQuery(conn, query, [params.speciesID]);
    return new NextResponse(JSON.stringify(MapperFactory.getMapper<any, any>('specieslimits').mapData(results)), { status: HTTPResponses.OK });
  } catch (error: any) {
    throw new Error(error);
  } finally {
    if (conn) conn.release();
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { speciesID: string } }) {
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('Schema not provided');
  if (params.speciesID === 'undefined') throw new Error('SpeciesID not provided');
  const { newRow } = await request.json();
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    await conn.beginTransaction();
    const newRowData = MapperFactory.getMapper<any, any>('specieslimits').demapData([newRow])[0];
    const { ['SpeciesLimitID']: gridIDKey, ...remainingProperties } = newRowData;
    const query = `UPDATE ${schema}.specieslimits SET ? WHERE ?? = ?`;
    const results = await runQuery(conn, query, [remainingProperties, 'SpeciesLimitID', gridIDKey]);
  } catch (e: any) {
    await conn?.rollback();
    throw new Error(e);
  } finally {
    if (conn) conn.release();
  }
}
