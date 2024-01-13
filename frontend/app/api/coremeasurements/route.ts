import {NextRequest, NextResponse} from "next/server";
import sql from "mssql";
import {ErrorMessages} from "@/config/macros";
import {CoreMeasurementRDS} from "@/config/sqlmacros";
import {getSqlConnection, runQuery, sqlConfig} from "@/components/processors/processorhelpers";



export async function GET(): Promise<NextResponse<CoreMeasurementRDS[]>> {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("environmental variable extraction for schema failed");
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  let results = await runQuery(conn, `SELECT *
                                      FROM ${schema}.CoreMeasurements`);
  if (!results) throw new Error("call failed");
  await conn.close();
  let coreMeasurementRows: CoreMeasurementRDS[] = []
  /**
   *   coreMeasurementID: number;
   *   censusID: number | null;
   *   plotID: number | null;
   *   quadratID: number | null;
   *   treeID: number | null;
   *   stemID: number | null;
   *   personnelID: number | null;
   *   measurementTypeID: number | null;
   *   measurementDate: Date | null;
   *   measurement: string | null;
   *   isRemeasurement: boolean | null;
   *   isCurrent: boolean | null;
   *   userDefinedFields: string | null;
   */
  Object.values(results.recordset).forEach((row, index) => {
    coreMeasurementRows.push({
      id: index + 1,
      coreMeasurementID: row['CoreMeasurementID'],
      censusID: row['CensusID'],
      plotID: row['PlotID'],
      quadratID: row['QuadratID'],
      treeID: row['TreeID'],
      stemID: row['StemID'],
      personnelID: row['PersonnelID'],
      measurementTypeID: row['MeasurementTypeID'],
      measurementDate: row['MeasurementDate'],
      measurement: row['Measurement'],
      isRemeasurement: row['IsRemeasurement'],
      isCurrent: row['IsCurrent'],
      userDefinedFields: row['UserDefinedFields'],
    })
  })
  return new NextResponse(
    JSON.stringify(coreMeasurementRows),
    {status: 200}
  );
}

export async function POST(request: NextRequest) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("environmental variable extraction for schema failed");
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  const row: CoreMeasurementRDS = {
    id: 0,
    coreMeasurementID: parseInt(request.nextUrl.searchParams.get('coreMeasurementID')!),
    censusID: request.nextUrl.searchParams.get('censusID') ? parseInt(request.nextUrl.searchParams.get('censusID')!) : null,
    plotID: request.nextUrl.searchParams.get('plotID') ? parseInt(request.nextUrl.searchParams.get('plotID')!) : null,
    quadratID: request.nextUrl.searchParams.get('quadratID') ? parseInt(request.nextUrl.searchParams.get('quadratID')!) : null,
    treeID: request.nextUrl.searchParams.get('treeID') ? parseInt(request.nextUrl.searchParams.get('treeID')!) : null,
    stemID: request.nextUrl.searchParams.get('stemID') ? parseInt(request.nextUrl.searchParams.get('stemID')!) : null,
    personnelID: request.nextUrl.searchParams.get('personnelID') ? parseInt(request.nextUrl.searchParams.get('personnelID')!) : null,
    measurementTypeID: request.nextUrl.searchParams.get('measurementTypeID') ? parseInt(request.nextUrl.searchParams.get('measurementTypeID')!) : null,
    measurementDate: request.nextUrl.searchParams.get('measurementDate') ? new Date(request.nextUrl.searchParams.get('measurementDate')!) : null,
    measurement: request.nextUrl.searchParams.get('measurement') ? request.nextUrl.searchParams.get('measurement')! : null,
    isRemeasurement: request.nextUrl.searchParams.get('isRemeasurement') ? (request.nextUrl.searchParams.get('isRemeasurement')!.toLowerCase() === 'true') : null,
    isCurrent: request.nextUrl.searchParams.get('isCurrent') ? (request.nextUrl.searchParams.get('isCurrent')!.toLowerCase() === 'true') : null,
    userDefinedFields: request.nextUrl.searchParams.get('userDefinedFields') ? request.nextUrl.searchParams.get('userDefinedFields') : null,
  }

  let checkCoreMeasurementID = await runQuery(conn, `SELECT *
                                                     FROM ${schema}.CoreMeasurements
                                                     WHERE [CoreMeasurementID] = ${row.coreMeasurementID}`);
  if (!checkCoreMeasurementID) return NextResponse.json({message: ErrorMessages.ICF}, {status: 400});
  if (checkCoreMeasurementID.recordset.length !== 0) return NextResponse.json({message: ErrorMessages.UKAE}, {status: 409});
  let insertRow = await runQuery(conn, `INSERT INTO ${schema}.CoreMeasurements
                                        (CoreMeasurementID, CensusID, PlotID, QuadratID, TreeID, StemID, PersonnelID,
                                         MeasurementTypeID,
                                         MeasurementDate, Measurement, IsRemeasurement, IsCurrent, UserDefinedFields)
                                        VALUES (${row.coreMeasurementID}, ${row.censusID}, ${row.plotID},
                                                ${row.quadratID}, ${row.treeID}, ${row.stemID},
                                                ${row.personnelID}, ${row.measurementTypeID}, ${row.measurementDate},
                                                '${row.measurement}', ${row.isRemeasurement},
                                                ${row.isCurrent}, '${row.userDefinedFields}')`);
  if (!insertRow) return NextResponse.json({message: ErrorMessages.ICF}, {status: 400});
  await conn.close();
  return NextResponse.json({message: "Insert successful"}, {status: 200});
}

export async function DELETE(request: NextRequest) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("environmental variable extraction for schema failed");
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');

  const deleteID = parseInt(request.nextUrl.searchParams.get('coreMeasurementID')!);
  let deleteRow = await runQuery(conn, `DELETE
                                        FROM ${schema}.CoreMeasurements
                                        WHERE [CoreMeasurementID] = ${deleteID}`);
  if (!deleteRow) return NextResponse.json({message: ErrorMessages.DCF}, {status: 400})
  await conn.close();
  return NextResponse.json({message: "Update successful",}, {status: 200});
}

export async function PATCH(request: NextRequest) {
  const schema = process.env.AZURE_SQL_SCHEMA;
  if (!schema) throw new Error("environmental variable extraction for schema failed");
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');

  const oldCoreMeasurement = parseInt(request.nextUrl.searchParams.get('oldCoreMeasurementID')!);
  const row: CoreMeasurementRDS = {
    id: 0,
    coreMeasurementID: parseInt(request.nextUrl.searchParams.get('coreMeasurementID')!),
    censusID: request.nextUrl.searchParams.get('censusID') ? parseInt(request.nextUrl.searchParams.get('censusID')!) : null,
    plotID: request.nextUrl.searchParams.get('plotID') ? parseInt(request.nextUrl.searchParams.get('plotID')!) : null,
    quadratID: request.nextUrl.searchParams.get('quadratID') ? parseInt(request.nextUrl.searchParams.get('quadratID')!) : null,
    treeID: request.nextUrl.searchParams.get('treeID') ? parseInt(request.nextUrl.searchParams.get('treeID')!) : null,
    stemID: request.nextUrl.searchParams.get('stemID') ? parseInt(request.nextUrl.searchParams.get('stemID')!) : null,
    personnelID: request.nextUrl.searchParams.get('personnelID') ? parseInt(request.nextUrl.searchParams.get('personnelID')!) : null,
    measurementTypeID: request.nextUrl.searchParams.get('measurementTypeID') ? parseInt(request.nextUrl.searchParams.get('measurementTypeID')!) : null,
    measurementDate: request.nextUrl.searchParams.get('measurementDate') ? new Date(request.nextUrl.searchParams.get('measurementDate')!) : null,
    measurement: request.nextUrl.searchParams.get('measurement') ? request.nextUrl.searchParams.get('measurement')! : null,
    isRemeasurement: request.nextUrl.searchParams.get('isRemeasurement') ? (request.nextUrl.searchParams.get('isRemeasurement')!.toLowerCase() === 'true') : null,
    isCurrent: request.nextUrl.searchParams.get('isCurrent') ? (request.nextUrl.searchParams.get('isCurrent')!.toLowerCase() === 'true') : null,
    userDefinedFields: request.nextUrl.searchParams.get('userDefinedFields') ? request.nextUrl.searchParams.get('userDefinedFields') : null,
  }

  if (row.coreMeasurementID !== oldCoreMeasurement) { // PRIMARY KEY is being updated, unique key check needs to happen
    let newCoreMeasurementIDCheck = await runQuery(conn, `SELECT *
                                                          FROM ${schema}.CoreMeasurements
                                                          WHERE [CoreMeasurementID] = '${row.coreMeasurementID}'`);
    if (!newCoreMeasurementIDCheck) return NextResponse.json({message: ErrorMessages.SCF}, {status: 400});
    if (newCoreMeasurementIDCheck.recordset.length !== 0) return NextResponse.json({message: ErrorMessages.UKAE}, {status: 409});

    let results = await runQuery(conn, `UPDATE ${schema}.CoreMeasurements
                                        SET [CoreMeasurementID] = ${row.coreMeasurementID}, [CensusID] = ${row.censusID}, [PlotID] = ${row.plotID}, [QuadratID] = ${row.quadratID}, [TreeID] = ${row.treeID}, [StemID] = ${row.stemID}, [PersonnelID] = ${row.personnelID}, [MeasurementTypeID] = ${row.measurementTypeID}, [MeasurementDate] = ${row.measurementDate}, [Measurement] = '${row.measurement}', [IsRemeasurement] = ${row.isRemeasurement}, [IsCurrent] = ${row.isCurrent}, [UserDefinedFields] = '${row.userDefinedFields}'
                                        WHERE [CoreMeasurementID] = '${oldCoreMeasurement}'`);
    if (!results) return NextResponse.json({message: ErrorMessages.UCF}, {status: 409});
    await conn.close();
    return NextResponse.json({message: "Update successful",}, {status: 200});
  } else { // other column information is being updated, no PK check required
    let results = await runQuery(conn, `UPDATE ${schema}.CoreMeasurements
                                        SET [CensusID] = ${row.censusID}, [PlotID] = ${row.plotID}, [QuadratID] = ${row.quadratID}, [TreeID] = ${row.treeID}, [StemID] = ${row.stemID}, [PersonnelID] = ${row.personnelID}, [MeasurementTypeID] = ${row.measurementTypeID}, [MeasurementDate] = ${row.measurementDate}, [Measurement] = '${row.measurement}', [IsRemeasurement] = ${row.isRemeasurement}, [IsCurrent] = ${row.isCurrent}, [UserDefinedFields] = '${row.userDefinedFields}'
                                        WHERE [CoreMeasurementID] = '${oldCoreMeasurement}'`);
    if (!results) return NextResponse.json({message: ErrorMessages.UCF}, {status: 409});
    await conn.close();
    return NextResponse.json({message: "Update successful",}, {status: 200});
  }
}