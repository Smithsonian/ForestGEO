import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses, InsertUpdateProcessingProps } from '@/config/macros';
import { FileRowSet } from '@/config/macros/formdetails';
import { NextRequest, NextResponse } from 'next/server';
import { Plot } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';
import { insertOrUpdate } from '@/components/processors/processorhelperfunctions';
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment';

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
  const connectionManager = ConnectionManager.getInstance();
  if (formType === 'measurements') {
    const batchID = uuidv4();
    const rows = Object.values(fileRowSet);
    const placeholders = rows.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(', ');
    const values = rows.flatMap(row => {
      const transformedRow = { ...row, date: row.date ? moment(row.date).format('YYYY-MM-DD') : row.date };
      return [batchID, fileName, plot?.plotID ?? -1, census?.dateRanges[0].censusID ?? -1, ...Object.values(transformedRow)];
    });
    const insertSQL = `INSERT INTO ${schema}.ingest_temporarymeasurements 
(BatchID, FileID, PlotID, CensusID, TreeTag, StemTag, SpeciesCode, QuadratName, LocalX, LocalY, DBH, HOM, MeasurementDate, Codes) 
VALUES ${placeholders}`;
    try {
      await connectionManager.executeQuery(insertSQL, values);
    } catch (e) {
      console.error('error encountered. e: ', e);
      console.error('adding re-try attempt here:');
      await connectionManager.executeQuery(insertSQL, values);
    }
    return new NextResponse(
      JSON.stringify({
        responseMessage: `Bulk insert to SQL completed`
      }),
      { status: HTTPResponses.OK }
    );
  } else {
    transactionID = await connectionManager.beginTransaction();
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
        await insertOrUpdate(props);
        // console.log(chalk.magenta(`Row ${rowId} processed successfully`));
      }
      await connectionManager.commitTransaction(transactionID ?? '');
      console.log('sqlpacketload: transaction committed');
    } catch (error: any) {
      await connectionManager.rollbackTransaction(transactionID ?? '');
      console.log('sqlpacketload: transation rolled back.');
      console.log(`Row ${rowId} failed processing:`, error);
      if (error instanceof Error) {
        console.error(`Error processing row for file ${fileName}:`, error.message);
        return new NextResponse(
          JSON.stringify({
            responseMessage: `Error processing row in file ${fileName}`,
            error: error.message
          }),
          { status: HTTPResponses.SERVICE_UNAVAILABLE }
        );
      } else {
        console.error('Unknown error processing row:', error);
        return new NextResponse(
          JSON.stringify({
            responseMessage: `Unknown processing error at row, in file ${fileName}`
          }),
          { status: HTTPResponses.SERVICE_UNAVAILABLE }
        );
      }
    }
    return new NextResponse(
      JSON.stringify({
        responseMessage: `Bulk insert to SQL completed`
      }),
      { status: HTTPResponses.OK }
    );
  }
}
