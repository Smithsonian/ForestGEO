import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses, InsertUpdateProcessingProps } from '@/config/macros';
import { FileRow, FileRowSet } from '@/config/macros/formdetails';
import { NextRequest, NextResponse } from 'next/server';
import { Plot } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';
import { insertOrUpdate } from '@/components/processors/processorhelperfunctions';

export async function POST(request: NextRequest) {
  let body;

  try {
    body = await request.json();
  } catch (error: any) {
    console.error('Error parsing JSON body:', error);
    return new NextResponse(
      JSON.stringify({
        responseMessage: 'Invalid or empty JSON body in the request',
        error: error.message
      }),
      { status: HTTPResponses.INVALID_REQUEST }
    );
  }

  const schema: string = body.schema;
  const formType: string = body.formType;
  const plot: Plot = body.plot;
  const census: OrgCensus = body.census;
  const user: string = body.user;
  const fileRowSet: FileRowSet = body.fileRowSet;
  const fileName: string = body.fileName;
  let transactionID: string | undefined = undefined;
  const failingRows: Set<FileRow> = new Set<FileRow>();

  const connectionManager = ConnectionManager.getInstance();
  transactionID = await connectionManager.beginTransaction();
  console.log('sqlpacketload: transation started.');
  let rowId = '';
  try {
    for (rowId in fileRowSet) {
      const row = fileRowSet[rowId];
      const props: InsertUpdateProcessingProps = {
        schema,
        connectionManager: connectionManager,
        formType,
        rowData: row,
        plot,
        census,
        fullName: user
      };
      try {
        await insertOrUpdate(props);
      } catch (e: any) {
        console.error(`Error processing row for file ${fileName}:`, e.message);
        failingRows.add(row); // saving this for future processing
      }
    }
    await connectionManager.commitTransaction(transactionID ?? '');
    console.log('sqlpacketload: transaction committed');
  } catch (error: any) {
    await connectionManager.rollbackTransaction(transactionID ?? '');
    console.log('CATASTROPHIC ERROR: sqlpacketload: transaction rolled back.');
    console.log(`Row ${rowId} failed processing:`, error);
    if (error instanceof Error) {
      console.error(`Error processing row for file ${fileName}:`, error.message);
      return new NextResponse(
        JSON.stringify({
          responseMessage: `Error processing row in file ${fileName}`,
          error: error.message,
          failingRows: Array.from(failingRows)
        }),
        { status: HTTPResponses.SERVICE_UNAVAILABLE }
      );
    } else {
      console.error('Unknown error processing row:', error);
      return new NextResponse(
        JSON.stringify({
          responseMessage: `Unknown processing error at row, in file ${fileName}`,
          failingRows: Array.from(failingRows)
        }),
        { status: HTTPResponses.SERVICE_UNAVAILABLE }
      );
    }
  }
  return new NextResponse(
    JSON.stringify({
      responseMessage: `Bulk insert to SQL completed`,
      failingRows: Array.from(failingRows)
    }),
    { status: HTTPResponses.OK }
  );
}
