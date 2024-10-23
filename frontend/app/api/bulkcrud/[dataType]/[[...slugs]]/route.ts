// bulk data CRUD flow API endpoint -- intended to allow multiline interactions and bulk updates via datagrid
import { NextRequest, NextResponse } from 'next/server';
import { FileRowSet } from '@/config/macros/formdetails';
import { PoolConnection } from 'mysql2/promise';
import { getConn, InsertUpdateProcessingProps } from '@/components/processors/processormacros';
import { insertOrUpdate } from '@/components/processors/processorhelperfunctions';
import { HTTPResponses } from '@/config/macros';

export async function POST(request: NextRequest, { params }: { params: { dataType: string; slugs?: string[] } }) {
  const { dataType, slugs } = params;
  if (!dataType || !slugs) {
    return new NextResponse('No dataType or SLUGS provided', { status: HTTPResponses.INVALID_REQUEST });
  }
  const [schema, plotIDParam, censusIDParam] = slugs;
  const plotID = parseInt(plotIDParam);
  const censusID = parseInt(censusIDParam);
  console.log('params: schema: ', schema, ', plotID: ', plotID, ', censusID: ', censusID);
  const rows: FileRowSet = await request.json();
  if (!rows) {
    return new NextResponse('No rows provided', { status: 400 });
  }
  console.log('rows produced: ', rows);
  let conn: PoolConnection | null = null;
  try {
    conn = await getConn();
    for (const rowID in rows) {
      const rowData = rows[rowID];
      console.log('rowData obtained: ', rowData);
      const props: InsertUpdateProcessingProps = {
        schema,
        connection: conn,
        formType: dataType,
        rowData,
        plotID,
        censusID,
        quadratID: undefined,
        fullName: undefined
      };
      console.log('assembled props: ', props);
      await insertOrUpdate(props);
      conn.release();
    }
  } catch (e: any) {
    return new NextResponse(
      JSON.stringify({
        responseMessage: `Failure in connecting to SQL with ${e.message}`,
        error: e.message
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  } finally {
    if (conn) conn.release();
  }
  return new NextResponse(JSON.stringify({ message: 'Insert to SQL successful' }), { status: HTTPResponses.OK });
}
