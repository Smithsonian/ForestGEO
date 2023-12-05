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
  const newCode = request.nextUrl.searchParams.get('code')!;
  const newDesc = request.nextUrl.searchParams.get('desc')!;
  const newStat = request.nextUrl.searchParams.get('stat')!;
  let insertRow = await runQuery(conn, `INSERT INTO forestgeo.Attributes (Code, Description, Status) VALUES ('${newCode}', '${newDesc}', '${newStat}')`);
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
  if (!deleteRow) return NextResponse.json({message: ErrorMessages.DCF}, {status: 400})
  await conn.close();
  return NextResponse.json({ message: "Update successful", }, {status: 200});
}

export async function PATCH(request: NextRequest) {
  let i = 0;
  let conn = await getSqlConnection(i);
  if (!conn) throw new Error('sql connection failed');
  const oldCode = request.nextUrl.searchParams.get('oldCode')!;
  const newCode = request.nextUrl.searchParams.get('newCode')!;
  const newDesc = request.nextUrl.searchParams.get('newDesc')!;
  const newStat = request.nextUrl.searchParams.get('newStat')!;
  
  let oldCodeValidation = await runQuery(conn, `SELECT * FROM forestgeo.Attributes WHERE [Code] = '${oldCode}'`);
  if (!oldCodeValidation) return NextResponse.json({message: ErrorMessages.SCF}, {status: 400});
  if (oldCodeValidation.recordset.length !== 0) return NextResponse.json({message: ErrorMessages.UKAE}, {status: 409})
  let results = await runQuery(conn, `UPDATE forestgeo.Attributes SET [Code] = '${newCode}', [Description] = '${newDesc}', [Status] = '${newStat}' WHERE [Code] = '${oldCode}'`);
  if (results) return NextResponse.json({message: ErrorMessages.UCF}, {status: 409});
  await conn.close();
  return NextResponse.json({ message: "Update successful", }, {status: 200});
}