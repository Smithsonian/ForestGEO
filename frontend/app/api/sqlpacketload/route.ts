import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses, InsertUpdateProcessingProps } from '@/config/macros';
import { FileRow, FileRowSet } from '@/config/macros/formdetails';
import { NextRequest, NextResponse } from 'next/server';
import { Plot } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';
import { insertOrUpdate } from '@/components/processors/processorhelperfunctions';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const schema: string = body.schema;
  const formType: string = body.formType;
  const plot: Plot = body.plot;
  const census: OrgCensus = body.census;
  const user: string = body.user;
  const fileRowSet: FileRowSet = body.fileRowSet;

  const connectionManager = ConnectionManager.getInstance();

  const errorRows: FileRow[] = [];
  for (const rowId in fileRowSet) {
    // await connectionManager.beginTransaction();
    const row = fileRowSet[rowId];
    try {
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
      // await connectionManager.commitTransaction();
    } catch (error: any) {
      errorRows.push({ ...row, error: error }); // add error rows to list of broken arrays
      // await connectionManager.rollbackTransaction();
      // await connectionManager.closeConnection();
      // if (error instanceof Error) {
      //   console.error(`Error processing row for file ${fileName}:`, error.message);
      //   return new NextResponse(
      //     JSON.stringify({
      //       responseMessage: `Error processing row in file ${fileName}`,
      //       error: error.message
      //     }),
      //     { status: HTTPResponses.SERVICE_UNAVAILABLE }
      //   );
      // } else {
      //   console.error('Unknown error processing row:', error);
      //   return new NextResponse(
      //     JSON.stringify({
      //       responseMessage: `Unknown processing error at row, in file ${fileName}`
      //     }),
      //     { status: HTTPResponses.SERVICE_UNAVAILABLE }
      //   );
      // }
    }
  }

  // Update Census Start/End Dates
  // const combinedQuery = `
  //           UPDATE ${schema}.census c
  //           JOIN (
  //             SELECT CensusID, MIN(MeasurementDate) AS FirstMeasurementDate, MAX(MeasurementDate) AS LastMeasurementDate
  //             FROM ${schema}.coremeasurements
  //             WHERE CensusID = ${censusID}
  //             GROUP BY CensusID
  //           ) m ON c.CensusID = m.CensusID
  //           SET c.StartDate = m.FirstMeasurementDate, c.EndDate = m.LastMeasurementDate
  //           WHERE c.CensusID = ${censusID};`;
  //
  // await connectionManager.executeQuery(combinedQuery);
  // await connectionManager.closeConnection();
  return new NextResponse(JSON.stringify({ message: `Insert to SQL completed with ${errorRows.length} errors`, errorRows: errorRows }), {
    status: HTTPResponses.OK
  });
}
