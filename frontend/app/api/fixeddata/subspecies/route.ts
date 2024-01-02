import {NextRequest, NextResponse} from "next/server";
import sql from "mssql";
import {ErrorMessages, sqlConfig} from "@/config/macros";
import {SubSpeciesRDS} from "@/config/sqlmacros";

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

export async function GET(): Promise<NextResponse<SubSpeciesRDS[]>> {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  let results = await runQuery(conn, `SELECT * FROM forestgeo.SubSpecies`);
  if (!results) throw new Error("call failed");
  await conn.close();
  let subSpeciesRows: SubSpeciesRDS[] = []
  Object.values(results.recordset).map((row, index) => {
    subSpeciesRows.push({
      id: index + 1,
      subSpeciesID: row['SubSpeciesID'],
      speciesID: row['SpeciesID'],
      currentTaxonFlag: row['CurrentTaxonFlag'],
      obsoleteTaxonFlag: row['ObsoleteTaxonFlag'],
      subSpeciesName: row['SubSpeciesName'],
      subSpeciesCode: row['SubSpeciesCode'],
      authority: row['Authority'],
      infraSpecificLevel: row['InfraSpecificLevel']
    })
  })
  return new NextResponse(
    JSON.stringify(subSpeciesRows),
    {status: 200}
  );
}

export async function POST(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  const row: SubSpeciesRDS = {
    id: 0,
    subSpeciesID: parseInt(request.nextUrl.searchParams.get('subSpeciesID')!),
    speciesID: request.nextUrl.searchParams.get('speciesID') ? parseInt(request.nextUrl.searchParams.get('speciesID')!) : null,
    currentTaxonFlag: request.nextUrl.searchParams.get('currentTaxonFlag') ? JSON.parse(request.nextUrl.searchParams.get('currentTaxonFlag')!) : null,
    obsoleteTaxonFlag: request.nextUrl.searchParams.get('obsoleteTaxonFlag') ? JSON.parse(request.nextUrl.searchParams.get('obsoleteTaxonFlag')!) : null,
    subSpeciesName: request.nextUrl.searchParams.get('subSpeciesName'),
    subSpeciesCode: request.nextUrl.searchParams.get('subSpeciesCode'),
    authority: request.nextUrl.searchParams.get('authority'),
    infraSpecificLevel: request.nextUrl.searchParams.get('infraSpecificLevel'),
  }
  let checkSubSpeciesID = await runQuery(conn, `SELECT * FROM forestgeo.SubSpecies WHERE [SubSpeciesID] = ${row.subSpeciesID}`);
  if (!checkSubSpeciesID) return NextResponse.json({message: ErrorMessages.ICF}, {status: 400});
  if (checkSubSpeciesID.recordset.length !== 0) return NextResponse.json({message: ErrorMessages.UKAE}, {status: 409});
  let insertRow = await runQuery(conn,
    `INSERT INTO forestgeo.SubSpecies (SubSpeciesID, SpeciesID, CurrentTaxonFlag, ObsoleteTaxonFlag, SubSpeciesName, SubSpeciesCode,
    Authority, InfraSpecificLevel) VALUES (${row.subSpeciesID}, ${row.speciesID}, '${row.currentTaxonFlag}',
    '${row.obsoleteTaxonFlag}', '${row.subSpeciesName}', '${row.subSpeciesCode}', '${row.authority}', '${row.infraSpecificLevel}')`);
  if (!insertRow) return NextResponse.json({message: ErrorMessages.ICF}, {status: 400});
  await conn.close();
  return NextResponse.json({message: "Insert successful"}, {status: 200});
}

export async function PATCH(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  const oldSubSpeciesID = parseInt(request.nextUrl.searchParams.get('oldSpeciesID')!);
  const row: SubSpeciesRDS = {
    id: 0,
    subSpeciesID: parseInt(request.nextUrl.searchParams.get('subSpeciesID')!),
    speciesID: request.nextUrl.searchParams.get('speciesID') ? parseInt(request.nextUrl.searchParams.get('speciesID')!) : null,
    currentTaxonFlag: request.nextUrl.searchParams.get('currentTaxonFlag') ? JSON.parse(request.nextUrl.searchParams.get('currentTaxonFlag')!) : null,
    obsoleteTaxonFlag: request.nextUrl.searchParams.get('obsoleteTaxonFlag') ? JSON.parse(request.nextUrl.searchParams.get('obsoleteTaxonFlag')!) : null,
    subSpeciesName: request.nextUrl.searchParams.get('subSpeciesName'),
    subSpeciesCode: request.nextUrl.searchParams.get('subSpeciesCode'),
    authority: request.nextUrl.searchParams.get('authority'),
    infraSpecificLevel: request.nextUrl.searchParams.get('infraSpecificLevel'),
  }
  
  if (row.subSpeciesID !== oldSubSpeciesID) {
    let newSubSpeciesIDCheck = await runQuery(conn, `SELECT * FROM forestgeo.SubSpecies WHERE [SubSpeciesID] = '${row.subSpeciesID}'`);
    if (!newSubSpeciesIDCheck) return NextResponse.json({message: ErrorMessages.SCF}, {status: 400});
    if (newSubSpeciesIDCheck.recordset.length !== 0) return NextResponse.json({message: ErrorMessages.UKAE}, {status: 409});
    
    let results = await runQuery(conn, `UPDATE forestgeo.SubSpecies
    SET [SubSpeciesID] = ${row.subSpeciesID}, [SpeciesID] = ${row.speciesID}, [CurrentTaxonFlag] = '${row.currentTaxonFlag}',
    [ObsoleteTaxonFlag] = '${row.obsoleteTaxonFlag}', [SubSpeciesName] = '${row.subSpeciesName}', [SubSpeciesCode] = '${row.subSpeciesCode}', [Authority] = '${row.authority}',
    [InfraSpecificLevel] = '${row.infraSpecificLevel}' WHERE [SubSpeciesID] = ${oldSubSpeciesID}`);
    if (!results) return NextResponse.json({message: ErrorMessages.UCF}, {status: 409});
    await conn.close();
    return NextResponse.json({message: "Update successful",}, {status: 200});
  } else {
    let results = await runQuery(conn, `UPDATE forestgeo.SubSpecies
    SET [SpeciesID] = ${row.speciesID}, [CurrentTaxonFlag] = '${row.currentTaxonFlag}',
    [ObsoleteTaxonFlag] = '${row.obsoleteTaxonFlag}', [SubSpeciesName] = '${row.subSpeciesName}', [SubSpeciesCode] = '${row.subSpeciesCode}', [Authority] = '${row.authority}',
    [InfraSpecificLevel] = '${row.infraSpecificLevel}' WHERE [SubSpeciesID] = ${oldSubSpeciesID}`);
    if (!results) return NextResponse.json({message: ErrorMessages.UCF}, {status: 409});
    await conn.close();
    return NextResponse.json({message: "Update successful",}, {status: 200});
  }
}

export async function DELETE(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  
  const deleteSubSpeciesID = parseInt(request.nextUrl.searchParams.get('subSpeciesID')!);
  let deleteRow = await runQuery(conn, `DELETE FROM forestgeo.SubSpecies WHERE [SubSpeciesID] = ${deleteSubSpeciesID}`);
  if (!deleteRow) return NextResponse.json({message: ErrorMessages.DCF}, {status: 400});
  await conn.close();
  return NextResponse.json({message: "Delete successful",}, {status: 200});
}