import {NextRequest, NextResponse} from "next/server";
import {getConn, InsertUpdateProcessingProps} from "@/components/processors/processormacros";
import {PoolConnection} from "mysql2/promise";
import {HTTPResponses} from "@/config/macros";
import {FileRow, FileRowSet} from "@/config/macros/formdetails";
import {insertOrUpdate} from "@/components/processors/processorhelperfunctions";

export async function POST(request: NextRequest) {
  const fileRowSet: FileRowSet = await request.json();
  console.log(`file row set: ${Object.keys(fileRowSet)}`);
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
  const plotIDParam = request.nextUrl.searchParams.get("plot");
  if (!plotIDParam) throw new Error('no plot id provided!');
  const plotID = parseInt(plotIDParam.trim());
  // census ID
  const censusIDParam = request.nextUrl.searchParams.get("census");
  if (!censusIDParam) throw new Error('no census id provided!');
  const censusID = parseInt(censusIDParam.trim());
  // quadrat ID
  const quadratIDParam = request.nextUrl.searchParams.get("quadrat");
  if (!quadratIDParam) throw new Error("no quadrat ID provided");
  const quadratID = parseInt(quadratIDParam.trim());
  // form type
  let formType = request.nextUrl.searchParams.get("formType");
  if (!formType) throw new Error('no formType provided!');
  formType = formType.trim();
// full name
  const fullName = request.nextUrl.searchParams.get("user") ?? undefined;
  // if (!fullName) throw new Error('no full name provided!');
  // fullName = fullName.trim();
  // unit of measurement --> use has been incorporated into form
  // let dbhUnit = request.nextUrl.searchParams.get('dbhUnit');
  // if (!dbhUnit) throw new Error('no DBH unitOfMeasurement provided!');
  // dbhUnit = dbhUnit.trim();
  // let homUnit = request.nextUrl.searchParams.get('homUnit');
  // if (!homUnit) throw new Error('no HOM unitOfMeasurement provided!');
  // dbhUnit = dbhUnit.trim();
  // let coordUnit = request.nextUrl.searchParams.get('coordUnit');
  // if (!coordUnit) throw new Error('no Coordinate unitOfMeasurement provided!');
  // dbhUnit = dbhUnit.trim();

  let connection: PoolConnection | null = null; // Use PoolConnection type

  try {
    const i = 0;
    connection = await getConn();
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error processing files:", error.message);
      return new NextResponse(
        JSON.stringify({
          responseMessage: `Failure in connecting to SQL with ${error.message}`,
          error: error.message,
        }),
        {status: HTTPResponses.SQL_CONNECTION_FAILURE}
      );
    } else {
      console.error("Unknown error in connecting to SQL:", error);
      return new NextResponse(
        JSON.stringify({
          responseMessage: `Unknown SQL connection error with error: ${error}`,
        }),
        {status: HTTPResponses.SQL_CONNECTION_FAILURE}
      );
    }
  }

  if (!connection) {
    console.error("Container client or SQL connection is undefined.");
    return new NextResponse(
      JSON.stringify({
        responseMessage: "Container client or SQL connection is undefined",
      }),
      {status: HTTPResponses.SERVICE_UNAVAILABLE}
    );
  }

  const idToRows: { coreMeasurementID: number; fileRow: FileRow }[] = [];
  for (const rowId in fileRowSet) {
    console.log(`rowID: ${rowId}`);
    const row = fileRowSet[rowId];
    console.log('row for row ID: ', row);
    try {
      const props: InsertUpdateProcessingProps = {
        schema,
        connection,
        formType,
        rowData: row,
        plotID,
        censusID,
        quadratID,
        fullName,
        // dbhUnit: dbhUnit,
        // homUnit: homUnit,
        // coordUnit: coordUnit,
      };
      const coreMeasurementID = await insertOrUpdate(props);
      if (formType === 'measurements' && coreMeasurementID) {
        idToRows.push({coreMeasurementID: coreMeasurementID, fileRow: row});
      } else if (formType === 'measurements' && coreMeasurementID === undefined) {
        throw new Error("CoreMeasurement insertion failure at row: " + row);
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Error processing row for file ${fileName}:`, error.message);
        return new NextResponse(
          JSON.stringify({
            responseMessage: `Error processing row in file ${fileName}`,
            error: error.message,
          }),
          {status: HTTPResponses.SERVICE_UNAVAILABLE}
        );
      } else {
        console.error("Unknown error processing row:", error);
        return new NextResponse(
          JSON.stringify({
            responseMessage: `Unknown processing error at row, in file ${fileName}`,
          }),
          {status: HTTPResponses.SERVICE_UNAVAILABLE}
        );
      }
    } finally {
      if (connection) connection.release();
    }
  }
  return new NextResponse(JSON.stringify({message: "Insert to SQL successful", idToRows: idToRows}), {status: 200});
}