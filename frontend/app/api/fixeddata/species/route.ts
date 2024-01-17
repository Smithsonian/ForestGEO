import {NextRequest, NextResponse} from "next/server";
import sql from "mssql";
import {ErrorMessages, sqlConfig} from "@/config/macros";
import {SpeciesRDS} from "@/config/sqlmacros";

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

export async function GET(): Promise<NextResponse<SpeciesRDS[]>> {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  let results = await runQuery(conn, `SELECT * FROM forestgeo.Species`);
  if (!results) throw new Error("call failed");
  await conn.close();
  let speciesRows: SpeciesRDS[] = []
  Object.values(results.recordset).map((row, index) => {
    speciesRows.push({
      id: index + 1,
      speciesID: row['SpeciesID'],
      genusID: row['GenusID'],
      currentTaxonFlag: row['CurrentTaxonFlag'],
      obsoleteTaxonFlag: row['ObsoleteTaxonFlag'],
      speciesName: row['SpeciesName'],
      speciesCode: row['SpeciesCode'],
      idLevel: row['IDLevel'],
      authority: row['Authority'],
      fieldFamily: row['FieldFamily'],
      description: row['Description'],
      referenceID: row['ReferenceID']
    })
  })
  return new NextResponse(
    JSON.stringify(speciesRows),
    {status: 200}
  );
}

export async function POST(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  const row: SpeciesRDS = {
    id: 0,
    speciesID: parseInt(request.nextUrl.searchParams.get('speciesID')!),
    genusID: request.nextUrl.searchParams.get('genusID') ? parseInt(request.nextUrl.searchParams.get('genusID')!) : null,
    currentTaxonFlag: request.nextUrl.searchParams.get('currentTaxonFlag') ? JSON.parse(request.nextUrl.searchParams.get('currentTaxonFlag')!) : null,
    obsoleteTaxonFlag: request.nextUrl.searchParams.get('obsoleteTaxonFlag') ? JSON.parse(request.nextUrl.searchParams.get('obsoleteTaxonFlag')!) : null,
    speciesName: request.nextUrl.searchParams.get('speciesName'),
    speciesCode: request.nextUrl.searchParams.get('speciesCode'),
    idLevel: request.nextUrl.searchParams.get('idLevel'),
    authority: request.nextUrl.searchParams.get('authority'),
    fieldFamily: request.nextUrl.searchParams.get('fieldFamily'),
    description: request.nextUrl.searchParams.get('description'),
    referenceID: request.nextUrl.searchParams.get('referenceID') ? parseInt(request.nextUrl.searchParams.get('referenceID')!) : null,
  }
  let checkSpeciesID = await runQuery(conn, `SELECT * FROM forestgeo.Species WHERE [SpeciesID] = ${row.speciesID}`);
  if (!checkSpeciesID) return NextResponse.json({message: ErrorMessages.ICF}, {status: 400});
  if (checkSpeciesID.recordset.length !== 0) return NextResponse.json({message: ErrorMessages.UKAE}, {status: 409});
  let insertRow = await runQuery(conn,
    `INSERT INTO forestgeo.Species (SpeciesID, GenusID, CurrentTaxonFlag, ObsoleteTaxonFlag, SpeciesName, SpeciesCode,
    IDLevel, Authority, FieldFamily, Description, ReferenceID) VALUES (${row.speciesID}, ${row.genusID}, '${row.currentTaxonFlag}',
    '${row.obsoleteTaxonFlag}', '${row.speciesName}', '${row.speciesCode}', '${row.idLevel}', '${row.authority}', '${row.fieldFamily}', '${row.description}',
    ${row.referenceID})`);
  if (!insertRow) return NextResponse.json({message: ErrorMessages.ICF}, {status: 400});
  await conn.close();
  return NextResponse.json({message: "Insert successful"}, {status: 200});
}

export async function PATCH(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  const oldSpeciesID = parseInt(request.nextUrl.searchParams.get('oldSpeciesID')!);
  const row: SpeciesRDS = {
    id: 0,
    speciesID: parseInt(request.nextUrl.searchParams.get('speciesID')!),
    genusID: request.nextUrl.searchParams.get('genusID') ? parseInt(request.nextUrl.searchParams.get('genusID')!) : null,
    currentTaxonFlag: request.nextUrl.searchParams.get('currentTaxonFlag') ? JSON.parse(request.nextUrl.searchParams.get('currentTaxonFlag')!) : null,
    obsoleteTaxonFlag: request.nextUrl.searchParams.get('obsoleteTaxonFlag') ? JSON.parse(request.nextUrl.searchParams.get('obsoleteTaxonFlag')!) : null,
    speciesName: request.nextUrl.searchParams.get('speciesName'),
    speciesCode: request.nextUrl.searchParams.get('speciesCode'),
    idLevel: request.nextUrl.searchParams.get('idLevel'),
    authority: request.nextUrl.searchParams.get('authority'),
    fieldFamily: request.nextUrl.searchParams.get('fieldFamily'),
    description: request.nextUrl.searchParams.get('description'),
    referenceID: request.nextUrl.searchParams.get('referenceID') ? parseInt(request.nextUrl.searchParams.get('referenceID')!) : null,
  }
  
  if (row.speciesID !== oldSpeciesID) {
    let newSpeciesIDCheck = await runQuery(conn, `SELECT * FROM forestgeo.Species WHERE [SpeciesID] = '${row.speciesID}'`);
    if (!newSpeciesIDCheck) return NextResponse.json({message: ErrorMessages.SCF}, {status: 400});
    if (newSpeciesIDCheck.recordset.length !== 0) return NextResponse.json({message: ErrorMessages.UKAE}, {status: 409});
    
    let results = await runQuery(conn, `UPDATE forestgeo.Species
    SET [SpeciesID] = ${row.speciesID}, [GenusID] = ${row.genusID}, [CurrentTaxonFlag] = '${row.currentTaxonFlag}',
    [ObsoleteTaxonFlag] = '${row.obsoleteTaxonFlag}', [SpeciesName] = '${row.speciesName}', [SpeciesCode] = '${row.speciesCode}', [IDLevel] = '${row.idLevel}',
    [Authority] = '${row.authority}', [FieldFamily] = '${row.fieldFamily}', [Description] = '${row.description}', [ReferenceID] = ${row.referenceID} WHERE [SpeciesID] = ${oldSpeciesID}`);
    if (!results) return NextResponse.json({message: ErrorMessages.UCF}, {status: 409});
    await conn.close();
    return NextResponse.json({message: "Update successful",}, {status: 200});
  } else {
    let results = await runQuery(conn, `UPDATE forestgeo.Species
    SET [GenusID] = ${row.genusID}, [CurrentTaxonFlag] = '${row.currentTaxonFlag}',
    [ObsoleteTaxonFlag] = '${row.obsoleteTaxonFlag}', [SpeciesName] = '${row.speciesName}', [SpeciesCode] = '${row.speciesCode}', [IDLevel] = '${row.idLevel}',
    [Authority] = '${row.authority}', [FieldFamily] = '${row.fieldFamily}', [Description] = '${row.description}', [ReferenceID] = ${row.referenceID} WHERE [SpeciesID] = ${oldSpeciesID}`);
    if (!results) return NextResponse.json({message: ErrorMessages.UCF}, {status: 409});
    await conn.close();
    return NextResponse.json({message: "Update successful",}, {status: 200});
  }
}

export async function DELETE(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  
  const deleteSpeciesID = parseInt(request.nextUrl.searchParams.get('speciesID')!);
  let deleteRow = await runQuery(conn, `DELETE FROM forestgeo.SpeciesID WHERE [SpeciesID] = ${deleteSpeciesID}`);
  if (!deleteRow) return NextResponse.json({message: ErrorMessages.DCF}, {status: 400});
  await conn.close();
  return NextResponse.json({message: "Delete successful",}, {status: 200});
}