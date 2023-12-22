import {NextRequest, NextResponse} from "next/server";
import sql from "mssql";
import {ErrorMessages, sqlConfig} from "@/config/macros";
import {CensusRDS, QuadratRDS} from "@/config/sqlmacros";

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

export async function GET(): Promise<NextResponse<QuadratRDS[]>> {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  let results = await runQuery(conn, `SELECT * FROM forestgeo.Quadrats`);
  if (!results) throw new Error("call failed");
  await conn.close();
  let quadratRows: QuadratRDS[] = []
  Object.values(results.recordset).map((row, index) => {
    quadratRows.push({
      id: index + 1,
      quadratID: row['QuadratID'],
      plotID: row['PlotID'],
      quadratName: row['QuadratName'],
      quadratX: row['QuadratX'],
      quadratY: row['QuadratY'],
      quadratZ: row['QuadratZ'],
      dimensionX: row['DimensionX'],
      dimensionY: row['DimensionY'],
      area: row['Area'],
      quadratShape: row['QuadratShape']
    })
  })
  return new NextResponse(
    JSON.stringify(quadratRows),
    {status: 200}
  );
}

export async function POST(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  const row: QuadratRDS = {
    id: 0,
    quadratID: parseInt(request.nextUrl.searchParams.get('quadratID')!),
    plotID: request.nextUrl.searchParams.get('plotID') ? parseInt(request.nextUrl.searchParams.get('plotID')!) : null,
    quadratName: request.nextUrl.searchParams.get('quadratName') ? request.nextUrl.searchParams.get('quadratName')! : null,
    quadratX: request.nextUrl.searchParams.get('quadratX') ? parseFloat(request.nextUrl.searchParams.get('quadratX')!) : null,
    quadratY: request.nextUrl.searchParams.get('quadratY') ? parseFloat(request.nextUrl.searchParams.get('quadratY')!) : null,
    quadratZ: request.nextUrl.searchParams.get('quadratZ') ? parseFloat(request.nextUrl.searchParams.get('quadratZ')!) : null,
    dimensionX: request.nextUrl.searchParams.get('dimensionX') ? parseFloat(request.nextUrl.searchParams.get('dimensionX')!) : null,
    dimensionY: request.nextUrl.searchParams.get('dimensionY') ? parseFloat(request.nextUrl.searchParams.get('dimensionY')!) : null,
    area: request.nextUrl.searchParams.get('area') ? parseFloat(request.nextUrl.searchParams.get('area')!) : null,
    quadratShape: request.nextUrl.searchParams.get('quadratShape') ? request.nextUrl.searchParams.get('quadratShape')! : null,
  }
  
  let checkQuadratID = await runQuery(conn, `SELECT * FROM forestgeo.Quadrats WHERE [QuadratID] = ${row.quadratID}`);
  if (!checkQuadratID) return NextResponse.json({message: ErrorMessages.ICF}, {status: 400});
  if (checkQuadratID.recordset.length !== 0) return NextResponse.json({message: ErrorMessages.UKAE}, {status: 409});
  let insertRow = await runQuery(conn,
    `INSERT INTO forestgeo.Quadrats (QuadratID, PlotID, QuadratName, QuadratX, QuadratY, QuadratZ,
    DimensionX, DimensionY, Area, QuadratShape) VALUES (${row.quadratID}, ${row.plotID}, '${row.quadratName}',
    ${row.quadratX}, ${row.quadratY}, ${row.quadratZ}, ${row.dimensionX}, ${row.dimensionY}, ${row.area}, '${row.quadratShape}')`);
  if (!insertRow) return NextResponse.json({message: ErrorMessages.ICF}, {status: 400});
  await conn.close();
  return NextResponse.json({message: "Insert successful"}, {status: 200});
}

export async function DELETE(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  
  const deleteQuadratID = parseInt(request.nextUrl.searchParams.get('quadratID')!);
  let deleteRow = await runQuery(conn, `DELETE FROM forestgeo.Quadrats WHERE [QuadratID] = ${deleteQuadratID}`);
  if (!deleteRow) return NextResponse.json({message: ErrorMessages.DCF}, {status: 400});
  await conn.close();
  return NextResponse.json({message: "Delete successful",}, {status: 200});
}

export async function PATCH(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  
  const oldQuadratID = parseInt(request.nextUrl.searchParams.get('oldQuadratID')!);
  const row: QuadratRDS = {
    id: 0,
    quadratID: parseInt(request.nextUrl.searchParams.get('quadratID')!),
    plotID: request.nextUrl.searchParams.get('plotID') ? parseInt(request.nextUrl.searchParams.get('plotID')!) : null,
    quadratName: request.nextUrl.searchParams.get('quadratName') ? request.nextUrl.searchParams.get('quadratName')! : null,
    quadratX: request.nextUrl.searchParams.get('quadratX') ? parseFloat(request.nextUrl.searchParams.get('quadratX')!) : null,
    quadratY: request.nextUrl.searchParams.get('quadratY') ? parseFloat(request.nextUrl.searchParams.get('quadratY')!) : null,
    quadratZ: request.nextUrl.searchParams.get('quadratZ') ? parseFloat(request.nextUrl.searchParams.get('quadratZ')!) : null,
    dimensionX: request.nextUrl.searchParams.get('dimensionX') ? parseFloat(request.nextUrl.searchParams.get('dimensionX')!) : null,
    dimensionY: request.nextUrl.searchParams.get('dimensionY') ? parseFloat(request.nextUrl.searchParams.get('dimensionY')!) : null,
    area: request.nextUrl.searchParams.get('area') ? parseFloat(request.nextUrl.searchParams.get('area')!) : null,
    quadratShape: request.nextUrl.searchParams.get('quadratShape') ? request.nextUrl.searchParams.get('quadratShape')! : null,
  }
  
  if (row.quadratID !== oldQuadratID) { // PRIMARY KEY is being updated, unique key check needs to happen
    let newQuadratIDCheck = await runQuery(conn, `SELECT * FROM forestgeo.Quadrats WHERE [QuadratID] = '${row.quadratID}'`);
    if (!newQuadratIDCheck) return NextResponse.json({message: ErrorMessages.SCF}, {status: 400});
    if (newQuadratIDCheck.recordset.length !== 0) return NextResponse.json({message: ErrorMessages.UKAE}, {status: 409});
    
    let results = await runQuery(conn, `UPDATE forestgeo.Quadrats
    SET [QuadratID] = ${row.quadratID}, [PlotID] = ${row.plotID}, [quadratName] = '${row.quadratName}',
    [QuadratX] = ${row.quadratX}, [QuadratY] = ${row.quadratY}, [QuadratZ] = ${row.quadratZ}, [DimensionX] = ${row.dimensionX},
    [DimensionY] = ${row.dimensionY}, [Area] = ${row.area}, [QuadratShape] = '${row.quadratShape}' WHERE [QuadratID] = ${oldQuadratID}`);
    if (!results) return NextResponse.json({message: ErrorMessages.UCF}, {status: 409});
    await conn.close();
    return NextResponse.json({message: "Update successful",}, {status: 200});
  } else { // other column information is being updated, no PK check required
    let results = await runQuery(conn, `UPDATE forestgeo.Quadrats
    SET [PlotID] = ${row.plotID}, [quadratName] = '${row.quadratName}',
    [QuadratX] = ${row.quadratX}, [QuadratY] = ${row.quadratY}, [QuadratZ] = ${row.quadratZ}, [DimensionX] = ${row.dimensionX},
    [DimensionY] = ${row.dimensionY}, [Area] = ${row.area}, [QuadratShape] = '${row.quadratShape}' WHERE [QuadratID] = ${oldQuadratID}`);
    if (!results) return NextResponse.json({message: ErrorMessages.UCF}, {status: 409});
    await conn.close();
    return NextResponse.json({message: "Update successful",}, {status: 200});
  }
}