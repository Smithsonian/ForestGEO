// bulk data CRUD flow API endpoint -- intended to allow multiline interactions and bulk updates via datagrid
import { NextRequest, NextResponse } from 'next/server';
import { FileRowSet } from '@/config/macros/formdetails';
import { insertOrUpdate } from '@/components/processors/processorhelperfunctions';
import { HTTPResponses, InsertUpdateProcessingProps } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import { Plot } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';
import { v4 } from 'uuid';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const dataType: string = body.gridType;
  const schema: string = body.schema;
  const plot: Plot = body.plot;
  const census: OrgCensus = body.census;
  const rows: FileRowSet = body.fileRowSet;
  if (!dataType || !plot || !census) {
    return new NextResponse('No dataType or SLUGS provided', { status: HTTPResponses.INVALID_REQUEST });
  }
  if (!rows) {
    return new NextResponse('No rows provided', { status: 400 });
  }
  const connectionManager = ConnectionManager.getInstance();
  let transactionID: string | undefined = undefined;
  try {
    transactionID = await connectionManager.beginTransaction();
    if (['measurementssummary', 'measurementssummaryview'].includes(dataType)) {
      const batchID = v4();
      await connectionManager.executeQuery(`INSERT INTO ?? SET ?`, [
        `${schema}.temporarymeasurements`,
        Object.values(rows).map(row => ({
          FileID: 'sample_bulk_insert.csv',
          BatchID: batchID,
          PlotID: plot.plotID,
          CensusID: census.dateRanges[0].censusID,
          TreeTag: row.tag,
          StemTag: row.stemtag,
          SpeciesCode: row.spcode,
          QuadratName: row.quadrat,
          LocalX: row.lx,
          LocalY: row.ly,
          DBH: row.dbh,
          HOM: row.hom,
          MeasurementDate: row.date,
          Codes: row.codes,
          Comments: row.description
        }))
      ]);
      await connectionManager.executeQuery(`CALL ${schema}.bulkingestionprocess(?, ?);`, ['sample_bulk_insert.csv', batchID]);
    } else {
      for (const rowID in rows) {
        const rowData = rows[rowID];
        const props: InsertUpdateProcessingProps = {
          schema,
          connectionManager: connectionManager,
          formType: dataType,
          rowData,
          plot: plot,
          census: census,
          quadratID: undefined,
          fullName: undefined
        };
        await insertOrUpdate(props);
      }
    }
    await connectionManager.commitTransaction(transactionID ?? '');
    return new NextResponse(JSON.stringify({ message: 'Insert to SQL successful' }), { status: HTTPResponses.OK });
  } catch (e: any) {
    await connectionManager.rollbackTransaction(transactionID ?? '');
    return new NextResponse(
      JSON.stringify({
        responseMessage: `Failure in connecting to SQL with ${e.message}`,
        error: e.message
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  } finally {
    await connectionManager.closeConnection();
  }
}
