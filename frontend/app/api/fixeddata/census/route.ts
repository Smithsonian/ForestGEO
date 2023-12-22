import {NextRequest, NextResponse} from "next/server";
import sql from "mssql";
import {ErrorMessages, sqlConfig} from "@/config/macros";
import {CensusRDS} from "@/config/sqlmacros";

async function getSqlConnection(tries: number) {
  return await sql.connect(sqlConfig).catch((err) => {
    console.error(err);
    if (tries == 5) {
      throw new Error("Connection failure");
    }
    console.log("conn failed --> trying again!");
    getSqlConnection(tries + 1);
  });
}

async function runQuery(conn: sql.ConnectionPool, query: string) {
  if (!conn) {
    throw new Error("invalid ConnectionPool object. check connection string settings.")
  }
  return await conn.request().query(query);
}

export async function GET(): Promise<NextResponse<CensusRDS[]>> {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  let results = await runQuery(conn, `SELECT * FROM forestgeo.Census`);
  if (!results) throw new Error("call failed");
  await conn.close();
  let censusRows: CensusRDS[] = []
  Object.values(results.recordset).map((row, index) => {
    censusRows.push({
      id: index + 1,
      censusID: row['CensusID'],
      plotID: row['PlotID'],
      plotCensusNumber: row['PlotCensusNumber'],
      startDate: row['StartDate'],
      endDate: row['EndDate'],
      description: row['Description'],
    })
  })
  return new NextResponse(
    JSON.stringify(censusRows),
    {status: 200}
  );
}

export async function POST(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  const row: CensusRDS = {
    id: 0,
    censusID: parseInt(request.nextUrl.searchParams.get('censusID')!),
    plotID: request.nextUrl.searchParams.get('plotID') ? parseInt(request.nextUrl.searchParams.get('plotID')!) : null,
    plotCensusNumber: request.nextUrl.searchParams.get('plotCensusNumber') ? parseInt(request.nextUrl.searchParams.get('plotCensusNumber')!) : null,
    startDate: request.nextUrl.searchParams.get('censusID') ? new Date(request.nextUrl.searchParams.get('censusID')!) : null,
    endDate: request.nextUrl.searchParams.get('endDate') ? new Date(request.nextUrl.searchParams.get('censusID')!) : null,
    description: request.nextUrl.searchParams.get('description') ? request.nextUrl.searchParams.get('description')! : null
  }
  
  let checkCensusID = await runQuery(conn, `SELECT * FROM forestgeo.Census WHERE [CensusID] = ${row.censusID}`);
  if (!checkCensusID) return NextResponse.json({message: ErrorMessages.ICF}, {status: 400});
  if (checkCensusID.recordset.length !== 0) return NextResponse.json({message: ErrorMessages.UKAE}, {status: 409});
  let insertRow = await runQuery(conn, `INSERT INTO forestgeo.Census (CensusID, PlotID, PlotCensusNumber, StartDate, EndDate, Description) VALUES
    (${row.censusID}, ${row.plotID}, ${row.plotCensusNumber}, ${row.startDate}, ${row.endDate}, '${row.description}')`);
  if (!insertRow) return NextResponse.json({message: ErrorMessages.ICF}, {status: 400});
  await conn.close();
  return NextResponse.json({message: "Insert successful"}, {status: 200});
}

export async function DELETE(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  
  const deleteID = parseInt(request.nextUrl.searchParams.get('censusID')!);
  let deleteRow = await runQuery(conn, `DELETE FROM forestgeo.Census WHERE [CensusID] = ${deleteID}`);
  if (!deleteRow) return NextResponse.json({message: ErrorMessages.DCF}, {status: 400})
  await conn.close();
  return NextResponse.json({message: "Update successful",}, {status: 200});
}

export async function PATCH(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  
  const oldCensus = parseInt(request.nextUrl.searchParams.get('oldCensusID')!);
  const row: CensusRDS = {
    id: 0,
    censusID: parseInt(request.nextUrl.searchParams.get('censusID')!),
    plotID: request.nextUrl.searchParams.get('plotID') ? parseInt(request.nextUrl.searchParams.get('plotID')!) : null,
    plotCensusNumber: request.nextUrl.searchParams.get('plotCensusNumber') ? parseInt(request.nextUrl.searchParams.get('plotCensusNumber')!) : null,
    startDate: request.nextUrl.searchParams.get('startDate') ? new Date(request.nextUrl.searchParams.get('startDate')!) : null,
    endDate: request.nextUrl.searchParams.get('endDate') ? new Date(request.nextUrl.searchParams.get('endDate')!) : null,
    description: request.nextUrl.searchParams.get('description') ? request.nextUrl.searchParams.get('description')! : null
  }
  
  if (row.censusID !== oldCensus) { // PRIMARY KEY is being updated, unique key check needs to happen
    let newCensusIDCheck = await runQuery(conn, `SELECT * FROM forestgeo.Census WHERE [CensusID] = '${row.censusID}'`);
    if (!newCensusIDCheck) return NextResponse.json({message: ErrorMessages.SCF}, {status: 400});
    if (newCensusIDCheck.recordset.length !== 0) return NextResponse.json({message: ErrorMessages.UKAE}, {status: 409});
    
    let results = await runQuery(conn, `UPDATE forestgeo.Census
    SET [CensusID] = ${row.censusID}, [PlotID] = ${row.plotID}, [PlotCensusNumber] = ${row.plotCensusNumber},
    [StartDate] = ${row.startDate}, [EndDate] = ${row.endDate}, [Description] = '${row.description}' WHERE [CensusID] = '${oldCensus}'`);
    if (!results) return NextResponse.json({message: ErrorMessages.UCF}, {status: 409});
    await conn.close();
    return NextResponse.json({message: "Update successful",}, {status: 200});
  } else { // other column information is being updated, no PK check required
    let results = await runQuery(conn, `UPDATE forestgeo.Census
    SET [PlotID] = ${row.plotID}, [PlotCensusNumber] = ${row.plotCensusNumber},
    [StartDate] = ${row.startDate}, [EndDate] = ${row.endDate}, [Description] = '${row.description}' WHERE [CensusID] = '${row.censusID}'`);
    if (!results) return NextResponse.json({message: ErrorMessages.UCF}, {status: 409});
    await conn.close();
    return NextResponse.json({message: "Update successful",}, {status: 200});
  }
}