import {NextRequest, NextResponse} from "next/server";
import sql from "mssql";
import {ErrorMessages, sqlConfig} from "@/config/macros";
import {AttributeRDS} from "@/config/sqlmacros";

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


export async function GET(): Promise<NextResponse<AttributeRDS[]>> {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  let results = await runQuery(conn, `SELECT * FROM forestgeo.Attributes`);
  if (!results) throw new Error("call failed");
  await conn.close();
  let attributeRows: AttributeRDS[] = []
  Object.values(results.recordset).map((row, index) => {
    attributeRows.push({
      id: index + 1,
      code: row['Code'],
      description: row['Description'],
      status: row['Status']
    })
  })
  return new NextResponse(
    JSON.stringify(attributeRows),
    {status: 200}
  );
}

export async function POST(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  const row: AttributeRDS = {
    id: 0,
    code: request.nextUrl.searchParams.get('code')!,
    description: request.nextUrl.searchParams.get('desc'),
    status: request.nextUrl.searchParams.get('stat')
  }
  
  let validateCode = await runQuery(conn, `SELECT * FROM forestgeo.Attributes WHERE [Code] = '${row.code}'`);
  if (!validateCode) return NextResponse.json({message: ErrorMessages.SCF}, {status: 400});
  if (validateCode.recordset.length !== 0) return NextResponse.json({message: ErrorMessages.UKAE}, {status: 409});
  
  let insertRow = await runQuery(conn, `INSERT INTO forestgeo.Attributes (Code, Description, Status) VALUES ('${row.code}', '${row.description}', '${row.status}')`);
  if (!insertRow) return NextResponse.json({message: ErrorMessages.ICF}, {status: 400});
  await conn.close();
  return NextResponse.json({message: "Insert successful"}, {status: 200});
}

export async function DELETE(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  
  const deleteCode = request.nextUrl.searchParams.get('code')!;
  let deleteRow = await runQuery(conn, `DELETE FROM forestgeo.Attributes WHERE [Code] = '${deleteCode}'`);
  if (!deleteRow) return NextResponse.json({message: ErrorMessages.DCF}, {status: 400});
  await conn.close();
  return NextResponse.json({message: "Update successful",}, {status: 200});
}

export async function PATCH(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  
  const oldCode = request.nextUrl.searchParams.get('oldCode')!;
  const row: AttributeRDS = {
    id: 0,
    code: request.nextUrl.searchParams.get('newCode')!,
    description: request.nextUrl.searchParams.get('newDesc')!,
    status: request.nextUrl.searchParams.get('newStat')!
  };
  
  // check to ensure new code is not already taken
  if (row.code !== oldCode) { // if CODE is being updated, this check needs to happen
    let newCodeCheck = await runQuery(conn, `SELECT * FROM forestgeo.Attributes WHERE [Code] = '${row.code}'`);
    if (!newCodeCheck) return NextResponse.json({message: ErrorMessages.SCF}, {status: 400});
    if (newCodeCheck.recordset.length !== 0) return NextResponse.json({message: ErrorMessages.UKAE}, {status: 409});
    
    let results = await runQuery(conn, `UPDATE forestgeo.Attributes SET [Code] = '${row.code}', [Description] = '${row.description}', [Status] = '${row.status}' WHERE [Code] = '${oldCode}'`);
    if (!results) return NextResponse.json({message: ErrorMessages.UCF}, {status: 409});
    await conn.close();
    return NextResponse.json({message: "Update successful",}, {status: 200});
  } else { // otherwise updating can focus solely on other columns
    let results = await runQuery(conn, `UPDATE forestgeo.Attributes SET [Description] = '${row.description}', [Status] = '${row.status}' WHERE [Code] = '${oldCode}'`);
    if (!results) return NextResponse.json({message: ErrorMessages.UCF}, {status: 409});
    await conn.close();
    return NextResponse.json({message: "Update successful",}, {status: 200});
  }
}