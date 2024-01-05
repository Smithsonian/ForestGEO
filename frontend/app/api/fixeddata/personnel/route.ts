import {NextRequest, NextResponse} from "next/server";
import sql from "mssql";
import {ErrorMessages, sqlConfig} from "@/config/macros";
import {PersonnelRDS} from "@/config/sqlmacros";

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


export async function GET(): Promise<NextResponse<PersonnelRDS[]>> {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  let results = await runQuery(conn, `SELECT * FROM forestgeo.Personnel`);
  if (!results) throw new Error("call failed");
  await conn.close();
  let personnelRows: PersonnelRDS[] = []
  Object.values(results.recordset).map((row, index) => {
    personnelRows.push({
      id: index + 1,
      personnelID: row['PersonnelID'],
      firstName: row['FirstName'],
      lastName: row['LastName'],
      role: row['Role']
    })
  })
  return new NextResponse(
    JSON.stringify(personnelRows),
    {status: 200}
  );
}

export async function POST(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  const row: PersonnelRDS = {
    id: 0,
    personnelID: parseInt(request.nextUrl.searchParams.get('personnelID')!),
    firstName: request.nextUrl.searchParams.get('firstName'),
    lastName: request.nextUrl.searchParams.get('lastName'),
    role: request.nextUrl.searchParams.get('role'),
  }
  
  let checkPersonnelID = await runQuery(conn, `SELECT * FROM forestgeo.Personnel WHERE [PersonnelID] = ${row.personnelID}`);
  if (!checkPersonnelID) return NextResponse.json({message: ErrorMessages.ICF}, {status: 400});
  if (checkPersonnelID.recordset.length !== 0) return NextResponse.json({message: ErrorMessages.UKAE}, {status: 409});
  let insertRow = await runQuery(conn, `INSERT INTO forestgeo.Personnel (PersonnelID, FirstName, LastName, Role) VALUES
    (${row.personnelID}, '${row.firstName}', '${row.lastName}', '${row.role}')`);
  if (!insertRow) return NextResponse.json({message: ErrorMessages.ICF}, {status: 400});
  await conn.close();
  return NextResponse.json({message: "Insert successful"}, {status: 200});
}

export async function PATCH(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  
  const oldPersonnelID = parseInt(request.nextUrl.searchParams.get('oldPersonnelID')!);
  const row: PersonnelRDS = {
    id: 0,
    personnelID: parseInt(request.nextUrl.searchParams.get('personnelID')!),
    firstName: request.nextUrl.searchParams.get('firstName')!,
    lastName: request.nextUrl.searchParams.get('lastName')!,
    role: request.nextUrl.searchParams.get('role')!,
  };
  
  // check to ensure new code is not already taken
  if (row.personnelID !== oldPersonnelID) { // if CODE is being updated, this check needs to happen
    let newCodeCheck = await runQuery(conn, `SELECT * FROM forestgeo.Personnel WHERE [PersonnelID] = '${row.personnelID}'`);
    if (!newCodeCheck) return NextResponse.json({message: ErrorMessages.SCF}, {status: 400});
    if (newCodeCheck.recordset.length !== 0) return NextResponse.json({message: ErrorMessages.UKAE}, {status: 409});
    
    let results = await runQuery(conn,
      `UPDATE forestgeo.Personnel SET [PersonnelID] = ${row.personnelID}, [FirstName] = '${row.firstName}', [LastName] = '${row.lastName}', [Role] = '${row.role}' WHERE [PersonnelID] = '${oldPersonnelID}'`);
    if (!results) return NextResponse.json({message: ErrorMessages.UCF}, {status: 409});
    await conn.close();
    return NextResponse.json({message: "Update successful",}, {status: 200});
  } else { // otherwise updating can focus solely on other columns
    let results = await runQuery(conn, `UPDATE forestgeo.Personnel SET [FirstName] = '${row.firstName}', [LastName] = '${row.lastName}', [Role] = '${row.role}' WHERE [PersonnelID] = '${oldPersonnelID}'`);
    if (!results) return NextResponse.json({message: ErrorMessages.UCF}, {status: 409});
    await conn.close();
    return NextResponse.json({message: "Update successful",}, {status: 200});
  }
}

export async function DELETE(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  
  const deletePersonnelID = parseInt(request.nextUrl.searchParams.get('personnelID')!);
  let deleteRow = await runQuery(conn, `DELETE FROM forestgeo.Personnel WHERE [PersonnelID] = ${deletePersonnelID}`);
  if (!deleteRow) return NextResponse.json({message: ErrorMessages.DCF}, {status: 400});
  await conn.close();
  return NextResponse.json({message: "Delete successful",}, {status: 200});
}