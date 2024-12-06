import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses, InsertUpdateProcessingProps } from '@/config/macros';
import { FileRow, FileRowSet } from '@/config/macros/formdetails';
import { insertOrUpdate } from '@/components/processors/processorhelperfunctions';
import ConnectionManager from '@/config/connectionmanager';

export async function POST(request: NextRequest) {
  const fileRowSet: FileRowSet = await request.json();
  // request parameter handling:
  // schema
  let schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('no schema provided!');
  schema = schema.trim();
  // file name
  let fileName = request.nextUrl.searchParams.get('fileName');
  if (!fileName) throw new Error('no file name provided!');
  fileName = fileName.trim();
  // plot ID
  const plotIDParam = request.nextUrl.searchParams.get('plot');
  if (!plotIDParam) throw new Error('no plot id provided!');
  const plotID = parseInt(plotIDParam.trim());
  // census ID
  const censusIDParam = request.nextUrl.searchParams.get('census');
  if (!censusIDParam) throw new Error('no census id provided!');
  const censusID = parseInt(censusIDParam.trim());
  // quadrat ID
  const quadratIDParam = request.nextUrl.searchParams.get('quadrat');
  if (!quadratIDParam) console.error('no quadrat ID provided');
  const quadratID = quadratIDParam ? parseInt(quadratIDParam.trim()) : undefined;
  // form type
  let formType = request.nextUrl.searchParams.get('formType');
  if (!formType) throw new Error('no formType provided!');
  formType = formType.trim();
  // full name
  const fullName = request.nextUrl.searchParams.get('user') ?? undefined;

  const connectionManager = ConnectionManager.getInstance();

  const idToRows: { coreMeasurementID: number; fileRow: FileRow }[] = [];
  for (const rowId in fileRowSet) {
    await connectionManager.beginTransaction();
    const row = fileRowSet[rowId];
    try {
      const props: InsertUpdateProcessingProps = {
        schema,
        connectionManager: connectionManager,
        formType,
        rowData: row,
        plotID,
        censusID,
        quadratID,
        fullName
      };
      const coreMeasurementID = await insertOrUpdate(props);
      if (formType === 'measurements' && coreMeasurementID) {
        idToRows.push({ coreMeasurementID: coreMeasurementID, fileRow: row });
      } else if (formType === 'measurements' && coreMeasurementID === undefined) {
        throw new Error('CoreMeasurement insertion failure at row: ' + row);
      }
      await connectionManager.commitTransaction();
    } catch (error) {
      await connectionManager.rollbackTransaction();
      await connectionManager.closeConnection();
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
  }
  await connectionManager.closeConnection();
  return new NextResponse(JSON.stringify({ message: 'Insert to SQL successful', idToRows: idToRows }), { status: HTTPResponses.OK });
}
